import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/api-guard';
import { cmsRequestHeaders, parseSearchList } from '@/lib/cms-parser';
import { fetchUpstream } from '@/lib/fetch-utils';
import { checkUpstreamAllowed } from '@/lib/ssrf';
import { areaMatches, createBrowseKindMatcher, type BrowseKind } from '@/lib/browse-filters';
import type { SearchResultItem } from '@/lib/types';

export const runtime = 'nodejs';

export interface BrowseVideosResponse {
  list: SearchResultItem[];
  total: number;
  page: number;
  pagecount: number;
  /** Next upstream page cursor for bounded filtered searches; null means exhausted. */
  nextPage: number | null;
  scannedPages: number;
  filtered: boolean;
  kindMetadataMissing: boolean;
  areas: string[];
}

const categoryCache = new Map<string, { expiresAt: number; categories: { type_id: number; type_name: string; type_pid?: number }[] }>();

/**
 * t 缺省时返回该源最新全部。地区/类型筛选以真实列表字段逐页核验，每次最多查 3 页。
 */
export async function GET(req: Request) {
  const guarded = guardRequest(req);
  if (guarded) return guarded;

  const params = new URL(req.url).searchParams;
  const source = params.get('source')?.trim() || '';
  if (!/^https?:\/\//.test(source)) {
    return NextResponse.json({ error: '片源地址无效' }, { status: 400 });
  }
  const verdict = await checkUpstreamAllowed(source);
  if (!verdict.ok) {
    return NextResponse.json({ error: verdict.reason }, { status: 400 });
  }

  const t = params.get('t')?.trim() || '';
  const pg = Math.max(1, parseInt(params.get('pg') || '1', 10) || 1);
  const area = params.get('area')?.trim() || '';
  const requestedKind = params.get('kind') || '';
  const kind = ['movie', 'tv', 'variety', 'anime', 'short'].includes(requestedKind) ? requestedKind as BrowseKind : '';
  const filtered = Boolean(area || kind);

  const base = source.replace(/\/+$/, '');
  const upstream = new URL(base);
  upstream.searchParams.set('ac', 'videolist');
  if (t) upstream.searchParams.set('t', t);
  else upstream.searchParams.delete('t');
  const budgetSignal = AbortSignal.any([req.signal, AbortSignal.timeout(20000)]);
  try {
    let categories: { type_id: number; type_name: string; type_pid?: number }[] = [];
    if (kind) {
      for (const [url, entry] of categoryCache) {
        if (entry.expiresAt <= Date.now()) categoryCache.delete(url);
      }
      const cached = categoryCache.get(base);
      if (cached && cached.expiresAt > Date.now()) categories = cached.categories;
      else {
        try {
          const classUrl = new URL(base);
          classUrl.searchParams.set('ac', 'list');
          const classRes = await fetchUpstream(classUrl.toString(), {
            timeoutMs: 5000,
            signal: budgetSignal,
            headers: cmsRequestHeaders(),
          });
          if (classRes.ok) {
            const classData = await classRes.json() as { class?: unknown };
            const raw = Array.isArray(classData.class) ? classData.class : [];
            categories = raw.map((entry) => {
              const item = entry as Record<string, unknown>;
              const type_pid = Number(item.type_pid);
              return {
                type_id: Number(item.type_id),
                type_name: String(item.type_name ?? '').trim(),
                ...(Number.isSafeInteger(type_pid) && type_pid > 0 ? { type_pid } : {}),
              };
            }).filter((item) => Number.isSafeInteger(item.type_id) && item.type_id > 0 && item.type_name.length > 0);
            if (categoryCache.size >= 100 && !categoryCache.has(base)) {
              const oldest = categoryCache.keys().next().value;
              if (oldest) categoryCache.delete(oldest);
            }
            categoryCache.set(base, { expiresAt: Date.now() + 60_000, categories });
          }
        } catch {
          // Explicit type_name labels remain usable when a source omits its class endpoint.
        }
      }
    }
    const scanned: SearchResultItem[] = [];
    let pagecount: number | undefined;
    let upstreamTotal = 0;
    let scannedPages = 0;
    let stoppedOnEmptyPage = false;
    const maxPages = filtered ? 3 : 1;
    let cursor = pg;
    for (; scannedPages < maxPages; scannedPages++, cursor++) {
      upstream.searchParams.set('pg', String(cursor));
      const res = await fetchUpstream(upstream.toString(), {
        timeoutMs: 10000,
        signal: budgetSignal,
        headers: cmsRequestHeaders(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as Record<string, unknown>;
      const list = parseSearchList(data, { key: base, name: '片源', url: base });
      scanned.push(...list);
      const parsedTotal = Number(data.total);
      if (scannedPages === 0 && Number.isFinite(parsedTotal) && parsedTotal >= 0) upstreamTotal = parsedTotal;
      const parsedPagecount = Number(data.pagecount);
      if (Number.isSafeInteger(parsedPagecount) && parsedPagecount > 0) pagecount = parsedPagecount;
      // Without pagecount, stop only on an empty page; otherwise expose a bounded continuation cursor.
      if ((pagecount !== undefined && cursor >= pagecount) || (pagecount === undefined && list.length === 0)) {
        if (pagecount === undefined && list.length === 0) stoppedOnEmptyPage = true;
        scannedPages++;
        cursor++;
        break;
      }
    }
    const kindMatches = kind ? createBrowseKindMatcher(categories, kind) : null;
    const list = scanned.filter((item) =>
      (!area || areaMatches(item.area, area)) &&
      (!kind || kindMatches?.(item))
    );
    const hasMore = pagecount !== undefined ? cursor <= pagecount : !stoppedOnEmptyPage && scanned.length > 0 && scannedPages >= maxPages;
    const areas = [...new Set(scanned.flatMap((item) => (item.area || '').split(/[,，、/／|｜;；]+/).map((part) => part.trim()).filter(Boolean)))];

    const payload: BrowseVideosResponse = {
      list,
      total: filtered ? 0 : upstreamTotal,
      page: pg,
      pagecount: pagecount ?? 1,
      nextPage: filtered && hasMore ? cursor : null,
      scannedPages,
      filtered,
      kindMetadataMissing: Boolean(kind && categories.length === 0),
      areas,
    };
    return NextResponse.json(payload);
  } catch (err) {
    if (req.signal.aborted) return new Response(null, { status: 499 });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '获取视频列表失败' },
      { status: 502 }
    );
  }
}
