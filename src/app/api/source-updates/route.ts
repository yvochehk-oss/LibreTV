import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/api-guard';
import { cmsRequestHeaders, filterAdultResults, parseSearchList } from '@/lib/cms-parser';
import { fetchUpstream } from '@/lib/fetch-utils';
import { checkUpstreamAllowed } from '@/lib/ssrf';
import { classifyCategories, directKind, type BrowseKind } from '@/lib/browse-filters';
import { parseSourceTimestamp, type SourceUpdateCursor, type SourceUpdatesResponse } from '@/lib/source-updates';
import type { SourceConfig } from '@/lib/types';

export const runtime = 'nodejs';

const MAX_SOURCES = 100;
const MAX_JOBS_PER_REQUEST = 6;
const MAX_CONCURRENT_JOBS = 3;
const MAX_PAGES_PER_SOURCE = 5;
const SOURCE_TIMEOUT_MS = 4_000;
const CATEGORY_TIMEOUT_MS = 2_000;
const CATEGORY_CACHE_TTL_MS = 60_000;

type PendingPage = SourceUpdateCursor['pendingPages'][number];
type SourceState = SourceUpdatesResponse['sourceStates'][number];
const categoryCache = new Map<string, { categories: { type_id: number; type_name: string; type_pid?: number }[]; expiresAt: number }>();

function validSource(value: unknown): value is SourceConfig {
  if (!value || typeof value !== 'object') return false;
  const source = value as Partial<SourceConfig>;
  return typeof source.key === 'string' && source.key.length <= 200 &&
    typeof source.name === 'string' && source.name.length <= 200 &&
    typeof source.url === 'string' && source.url.length <= 2048 && /^https?:\/\//i.test(source.url);
}

function cmsUrl(sourceUrl: string, action: 'list' | 'detail' | 'videolist', page = 1): URL {
  const url = new URL(sourceUrl);
  for (const key of ['ac', 'pg', 't', 'wd', 'ids']) url.searchParams.delete(key);
  url.searchParams.set('ac', action);
  if (action !== 'list') url.searchParams.set('pg', String(page));
  return url;
}

async function fetchJson(url: string, signal: AbortSignal): Promise<Record<string, unknown>> {
  const response = await fetchUpstream(url, { timeoutMs: SOURCE_TIMEOUT_MS, signal, headers: cmsRequestHeaders() });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json() as unknown;
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('JSON 格式无效');
  const result = data as Record<string, unknown>;
  if (result.code !== undefined && Number(result.code) !== 1) throw new Error(`CMS code ${String(result.code)}`);
  if (result.list !== undefined && result.list !== null && !Array.isArray(result.list)) throw new Error('CMS list 格式无效');
  if (!Array.isArray(result.list)) throw new Error('CMS 未返回影片列表');
  return result;
}

async function getCategories(base: string, signal: AbortSignal) {
  const cached = categoryCache.get(base);
  if (cached && cached.expiresAt > Date.now()) return cached.categories;
  let categories: { type_id: number; type_name: string; type_pid?: number }[] = [];
  try {
    const response = await fetchUpstream(cmsUrl(base, 'list').toString(), {
      timeoutMs: CATEGORY_TIMEOUT_MS,
      signal,
      headers: cmsRequestHeaders(),
    });
    if (response.ok) {
      const data = await response.json() as { class?: unknown };
      if (Array.isArray(data.class)) {
        categories = data.class.map((value) => {
          const entry = value as Record<string, unknown>;
          const typeId = Number(entry.type_id);
          const parentId = Number(entry.type_pid);
          return {
            type_id: typeId,
            type_name: String(entry.type_name ?? '').trim(),
            ...(Number.isSafeInteger(parentId) && parentId > 0 ? { type_pid: parentId } : {}),
          };
        }).filter((entry) => Number.isSafeInteger(entry.type_id) && entry.type_id > 0 && entry.type_name.length > 0);
      }
    }
  } catch {
    // Category data improves type labels but is optional for update discovery.
  }
  if (categoryCache.size >= 100 && !categoryCache.has(base)) {
    const oldest = categoryCache.keys().next().value;
    if (oldest) categoryCache.delete(oldest);
  }
  categoryCache.set(base, { categories, expiresAt: Date.now() + CATEGORY_CACHE_TTL_MS });
  return categories;
}

async function fetchSourcePage(
  source: SourceConfig,
  page: number,
  parentSignal: AbortSignal,
  filterAdult: boolean,
  kind: BrowseKind | '',
) {
  const verdict = await checkUpstreamAllowed(source.url);
  if (!verdict.ok) throw new Error(verdict.reason);
  const signal = AbortSignal.any([parentSignal, AbortSignal.timeout(SOURCE_TIMEOUT_MS * 3)]);
  const base = source.url.replace(/\/+$/, '');
  const categories = await getCategories(base, signal);

  let payload: Record<string, unknown>;
  try {
    // Prefer Apple CMS detail mode. Incompatible CMS versions get one videolist fallback for this page.
    payload = await fetchJson(cmsUrl(base, 'detail', page).toString(), signal);
  } catch (error) {
    if (parentSignal.aborted) throw error;
    payload = await fetchJson(cmsUrl(base, 'videolist', page).toString(), signal);
  }

  const rawList = payload.list as Record<string, unknown>[];
  const parsed = parseSearchList(payload, { key: source.key, name: source.name, url: base, isAdult: source.isAdult });
  const typeById = classifyCategories(categories);
  const items = rawList.map((raw, index) => {
    const item = parsed[index];
    const sourceAddedAt = parseSourceTimestamp(raw.vod_time_add ?? raw.vod_addtime);
    const sourceUpdatedAt = parseSourceTimestamp(raw.vod_time ?? raw.vod_time_update ?? raw.vod_time_increment);
    const browseKind = (item.typeId ? typeById.get(item.typeId) : undefined)
      ?? (item.typeRootId ? typeById.get(item.typeRootId) : undefined)
      ?? (item.typeName ? directKind(item.typeName) : undefined);
    return {
      ...item,
      ...(sourceAddedAt ? { sourceAddedAt } : {}),
      ...(sourceUpdatedAt ? { sourceUpdatedAt } : {}),
      ...(browseKind ? { browseKind } : {}),
    };
  });
  const adultFiltered = filterAdult ? filterAdultResults(items, true) : items;
  const filtered = kind ? adultFiltered.filter((item) => item.browseKind === kind) : adultFiltered;
  const parsedPageCount = Number(payload.pagecount);
  const pagecount = Number.isSafeInteger(parsedPageCount) && parsedPageCount > 0 ? parsedPageCount : undefined;
  const hasMore = rawList.length > 0 && (pagecount === undefined || page < pagecount);
  const status: SourceState['status'] = !hasMore
    ? 'exhausted'
    : page >= MAX_PAGES_PER_SOURCE
      ? 'page-limit'
      : 'more';
  return { items: filtered, rawCount: rawList.length, pagecount, status };
}

async function mapConcurrent<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const result = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      result[index] = await fn(items[index]);
    }
  }));
  return result;
}

function parseCursor(value: unknown, sourceCount: number): SourceUpdateCursor {
  if (!value || typeof value !== 'object') return { sourceOffset: 0, pendingPages: [] };
  const cursor = value as Partial<SourceUpdateCursor>;
  const sourceOffset = Number(cursor.sourceOffset);
  const safeOffset = Number.isSafeInteger(sourceOffset) && sourceOffset >= 0 && sourceOffset <= sourceCount ? sourceOffset : 0;
  const seenSources = new Set<number>();
  const pendingPages: PendingPage[] = [];
  if (Array.isArray(cursor.pendingPages)) {
    for (const entry of cursor.pendingPages) {
      if (!entry || typeof entry !== 'object') continue;
      const sourceIndex = Number(entry.sourceIndex);
      const page = Number(entry.page);
      if (!Number.isSafeInteger(sourceIndex) || sourceIndex < 0 || sourceIndex >= safeOffset ||
        !Number.isSafeInteger(page) || page < 1 || page > MAX_PAGES_PER_SOURCE || seenSources.has(sourceIndex)) continue;
      seenSources.add(sourceIndex);
      pendingPages.push({ sourceIndex, page });
    }
  }
  return { sourceOffset: safeOffset, pendingPages };
}

export async function POST(req: Request) {
  const guarded = guardRequest(req);
  if (guarded) return guarded;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求格式无效' }, { status: 400 });
  }
  if (!body || typeof body !== 'object') return NextResponse.json({ error: '请求格式无效' }, { status: 400 });
  const input = body as { sources?: unknown; cursor?: unknown; filterAdult?: unknown; kind?: unknown };
  if (!Array.isArray(input.sources) || input.sources.length > MAX_SOURCES || !input.sources.every(validSource)) {
    return NextResponse.json({ error: `片源列表无效（最多 ${MAX_SOURCES} 个）` }, { status: 400 });
  }
  const filterAdult = input.filterAdult === true;
  const sources = (input.sources as SourceConfig[]).filter((source) => !(filterAdult && source.isAdult));
  const requestedKind = input.kind === 'movie' || input.kind === 'tv' ? input.kind : '';
  const cursor = parseCursor(input.cursor, sources.length);
  const pending = [...cursor.pendingPages];
  const newCandidates = sources.slice(cursor.sourceOffset, cursor.sourceOffset + MAX_JOBS_PER_REQUEST)
    .map((_, index) => cursor.sourceOffset + index);
  let sourceOffset = cursor.sourceOffset;
  const jobs: { sourceIndex: number; page: number }[] = [];
  let preferPending = true;
  while (jobs.length < MAX_JOBS_PER_REQUEST && (pending.length > 0 || newCandidates.length > 0)) {
    if (preferPending && pending.length > 0) {
      jobs.push(pending.shift()!);
    } else if (newCandidates.length > 0) {
      const sourceIndex = newCandidates.shift()!;
      jobs.push({ sourceIndex, page: 1 });
      sourceOffset = sourceIndex + 1;
    } else if (pending.length > 0) {
      jobs.push(pending.shift()!);
    }
    preferPending = !preferPending;
  }

  const settled = await mapConcurrent(jobs, MAX_CONCURRENT_JOBS, async (job) => {
    const source = sources[job.sourceIndex];
    try {
      const pageResult = await fetchSourcePage(source, job.page, req.signal, filterAdult, requestedKind);
      return { ...job, source, ...pageResult, error: undefined as string | undefined };
    } catch (error) {
      return { ...job, source, items: [], rawCount: 0, pagecount: undefined, status: 'failed' as const, error: error instanceof Error ? error.message : '获取片源更新失败' };
    }
  });

  const sourceStates: SourceState[] = settled.map((entry) => ({
    sourceKey: entry.source.key,
    sourceName: entry.source.name,
    page: entry.page,
    status: entry.status,
    matchingCount: entry.items.length,
  }));
  for (const entry of settled) {
    if (entry.status === 'more' && entry.page < MAX_PAGES_PER_SOURCE) pending.push({ sourceIndex: entry.sourceIndex, page: entry.page + 1 });
    if (entry.status === 'failed') pending.push({ sourceIndex: entry.sourceIndex, page: entry.page });
  }
  const uniquePending = [...new Map(pending.map((entry) => [`${entry.sourceIndex}:${entry.page}`, entry])).values()];
  const nextCursor = uniquePending.length > 0 || sourceOffset < sources.length
    ? { sourceOffset, pendingPages: uniquePending }
    : null;
  const failedSources = settled.filter((entry) => entry.status === 'failed').map((entry) => ({
    sourceKey: entry.source.key,
    sourceName: entry.source.name,
    error: entry.error || '获取片源更新失败',
  }));
  const response: SourceUpdatesResponse = {
    items: settled.flatMap((entry) => entry.items),
    scannedSources: new Set(settled.map((entry) => entry.sourceIndex)).size,
    scannedPages: settled.length,
    totalSources: sources.length,
    nextCursor,
    failedSources,
    sourceStates,
  };
  if (req.signal.aborted) return new Response(null, { status: 499 });
  return NextResponse.json(response);
}
