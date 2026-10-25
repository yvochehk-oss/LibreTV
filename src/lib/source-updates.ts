import type { SearchResultItem } from './types';
import { directKind, type BrowseKind } from './browse-filters';

export type SourceUpdateItem = SearchResultItem & {
  sourceAddedAt?: number;
  sourceUpdatedAt?: number;
  browseKind?: BrowseKind;
};

export interface SourceUpdateGroup {
  key: string;
  name: string;
  year?: string;
  typeName?: string;
  pic?: string;
  remarks?: string;
  latestAt?: number;
  items: SourceUpdateItem[];
}

export interface SourceUpdateCursor {
  sourceOffset: number;
  pendingPages: { sourceIndex: number; page: number }[];
}

export type SourceUpdateScanStatus = 'more' | 'exhausted' | 'page-limit' | 'failed';

export interface SourceUpdatesResponse {
  items: SourceUpdateItem[];
  scannedSources: number;
  scannedPages: number;
  totalSources: number;
  nextCursor: SourceUpdateCursor | null;
  failedSources: { sourceKey: string; sourceName: string; error: string }[];
  sourceStates: { sourceKey: string; sourceName: string; page: number; status: SourceUpdateScanStatus; matchingCount: number }[];
}

/** Parse only explicit CMS timestamps; never infer freshness from the release year. */
export function parseSourceTimestamp(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value < 100_000_000_000 ? value * 1000 : value;
    return Number.isFinite(new Date(ms).getTime()) ? ms : undefined;
  }
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const raw = value.trim();
  if (/^\d{9,13}$/.test(raw)) return parseSourceTimestamp(Number(raw));
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw) ? raw.replace(' ', 'T') : raw;
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : undefined;
}

function explicitKind(item: SourceUpdateItem): BrowseKind | undefined {
  return item.browseKind ?? (item.typeName ? directKind(item.typeName) : undefined);
}

function normalizedTitle(title: string): string {
  return title.trim().normalize('NFKC').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

function reliableYear(value: string | undefined): string | undefined {
  const year = value?.trim();
  if (!year || !/^\d{4}$/.test(year)) return undefined;
  const numeric = Number(year);
  const currentYear = new Date().getFullYear();
  return numeric >= 1888 && numeric <= currentYear + 2 ? year : undefined;
}

function timestamp(item: SourceUpdateItem): number | undefined {
  return item.sourceUpdatedAt ?? item.sourceAddedAt;
}

/**
 * Deduplicate repeated source IDs, then merge across sources only when title,
 * release year, and explicitly classified content kind all agree.
 */
export function groupSourceUpdates(items: SourceUpdateItem[]): SourceUpdateGroup[] {
  const sourceIds = new Set<string>();
  const unique: SourceUpdateItem[] = [];
  for (const item of items) {
    const id = `${item.sourceKey}\u0000${item.vodId}`;
    if (item.vodId && sourceIds.has(id)) continue;
    if (item.vodId) sourceIds.add(id);
    unique.push(item);
  }

  const groups: SourceUpdateGroup[] = [];
  const reliable = new Map<string, SourceUpdateGroup[]>();
  for (const item of unique) {
    const kind = explicitKind(item);
    const title = normalizedTitle(item.name);
    const year = reliableYear(item.year);
    const key = title && year && kind ? `${title}\u0000${year}\u0000${kind}` : '';
    const candidates = key ? reliable.get(key) : undefined;
    const existing = candidates?.find((group) => !group.items.some((entry) => entry.sourceKey === item.sourceKey));
    if (existing) {
      existing.items.push(item);
      existing.latestAt = Math.max(existing.latestAt ?? 0, timestamp(item) ?? 0) || undefined;
      existing.pic ||= item.pic;
      existing.remarks ||= item.remarks;
      continue;
    }
    const group: SourceUpdateGroup = {
      key: `${item.sourceKey}_${item.vodId || groups.length}`,
      name: item.name,
      year,
      typeName: item.typeName,
      pic: item.pic,
      remarks: item.remarks,
      latestAt: timestamp(item),
      items: [item],
    };
    groups.push(group);
    if (key) reliable.set(key, [...(reliable.get(key) ?? []), group]);
  }

  const dated = groups.filter((group) => group.latestAt !== undefined)
    .sort((a, b) => (b.latestAt ?? 0) - (a.latestAt ?? 0));
  const unknownBySource = new Map<string, SourceUpdateGroup[]>();
  for (const group of groups.filter((candidate) => candidate.latestAt === undefined)) {
    const sourceKey = group.items[0]?.sourceKey ?? '';
    const queue = unknownBySource.get(sourceKey) ?? [];
    queue.push(group);
    unknownBySource.set(sourceKey, queue);
  }
  const unknown: SourceUpdateGroup[] = [];
  while ([...unknownBySource.values()].some((queue) => queue.length > 0)) {
    for (const queue of unknownBySource.values()) {
      const next = queue.shift();
      if (next) unknown.push(next);
    }
  }
  return [...dated, ...unknown];
}
