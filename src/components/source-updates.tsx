'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/client-api';
import { groupSourceUpdates, type SourceUpdateCursor, type SourceUpdateGroup, type SourceUpdatesResponse } from '@/lib/source-updates';
import type { SearchResultItem, SourceConfig } from '@/lib/types';
import { AggregatedCard, type AggregatedGroup } from '@/components/video-card';
import { cn } from '@/lib/utils';

const KIND_OPTIONS = [
  { value: 'movie', label: '电影' },
  { value: 'tv', label: '剧集' },
  { value: 'all', label: '全部' },
] as const;

function timeText(timestamp?: number): string {
  if (!timestamp) return '更新时间未知';
  return `更新于 ${new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(timestamp)}`;
}

function UpdateCard({ group, sources, onPick }: { group: SourceUpdateGroup; sources: SourceConfig[]; onPick: (item: SearchResultItem) => void }) {
  return (
    <div className="min-w-0">
      <AggregatedCard group={group as AggregatedGroup} sources={sources} onOpen={onPick} />
      <p className="px-1 pt-1 text-[11px] text-faint">{timeText(group.latestAt)}</p>
    </div>
  );
}

function cursorKey(cursor: SourceUpdateCursor | null): string {
  return JSON.stringify(cursor ?? { sourceOffset: 0, pendingPages: [] });
}

/** Home feed for the latest entries reported by the user's enabled video sources. */
export function SourceUpdatesSection({
  sources,
  filterAdult,
  onPick,
}: {
  sources: SourceConfig[];
  filterAdult: boolean;
  onPick: (item: SearchResultItem) => void;
}) {
  const [kind, setKind] = useState<(typeof KIND_OPTIONS)[number]['value']>('movie');
  const [cursor, setCursor] = useState<SourceUpdateCursor | null>(null);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [batches, setBatches] = useState<Record<string, SourceUpdatesResponse>>({});
  const [batchOrder, setBatchOrder] = useState<string[]>([]);
  const sourceSignature = sources.map((source) => `${source.key}:${source.name}:${source.url}:${source.isAdult ? 1 : 0}`).join('|');
  const batchKey = cursorKey(cursor);

  const query = useQuery({
    queryKey: ['source-updates', sourceSignature, filterAdult, kind, refreshVersion, batchKey],
    queryFn: ({ signal }) => api.sourceUpdates(sources, cursor, filterAdult, kind, signal),
    enabled: sources.length > 0,
    staleTime: 0,
  });

  useEffect(() => {
    if (!query.data) return;
    setBatches((previous) => ({ ...previous, [batchKey]: query.data }));
    setBatchOrder((previous) => previous.includes(batchKey) ? previous : [...previous, batchKey]);
  }, [batchKey, query.data]);

  const allItems = useMemo(
    () => batchOrder.flatMap((key) => batches[key]?.items ?? []),
    [batches, batchOrder]
  );
  const groups = useMemo(() => groupSourceUpdates(allItems), [allItems]);
  const sourceStates = batchOrder.flatMap((key) => batches[key]?.sourceStates ?? []);
  const latestStateBySource = new Map<string, SourceUpdatesResponse['sourceStates'][number]>();
  for (const state of sourceStates) latestStateBySource.set(state.sourceKey, state);
  const failedSourceCount = [...latestStateBySource.values()].filter((state) => state.status === 'failed').length;
  const latestBatch = batchOrder.length ? batches[batchOrder[batchOrder.length - 1]] : undefined;
  const nextCursor = latestBatch?.nextCursor ?? null;
  const hasMore = nextCursor !== null;
  const limitedSources = new Set(sourceStates.filter((state) => state.status === 'page-limit').map((state) => state.sourceKey));

  const changeKind = (next: (typeof KIND_OPTIONS)[number]['value']) => {
    if (next === kind) return;
    setCursor(null);
    setBatches({});
    setBatchOrder([]);
    setKind(next);
  };

  const refresh = () => {
    setCursor(null);
    setBatches({});
    setBatchOrder([]);
    setRefreshVersion((version) => version + 1);
  };

  const continueReading = () => {
    if (query.isError) {
      void query.refetch();
      return;
    }
    if (!nextCursor) return;
    if (cursorKey(nextCursor) === batchKey) void query.refetch();
    else setCursor(nextCursor);
  };

  return (
    <section aria-label="片源最近更新" className="mb-10">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-content">片源最近更新</h2>
          <p className="mt-0.5 text-xs text-faint">按源上报的更新时间排序；时间字段缺失的条目排在后面。每批检查最多 6 页。</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 rounded-lg bg-chip p-0.5" aria-label="更新内容类型">
            {KIND_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={kind === option.value}
                onClick={() => changeKind(option.value)}
                className={cn('rounded-md px-3 py-1.5 text-xs transition-colors', kind === option.value ? 'bg-accent text-on-accent' : 'text-muted hover:text-content')}
              >
                {option.label}
              </button>
            ))}
          </div>
          <button type="button" className="btn-ghost btn-sm" disabled={query.isFetching || sources.length === 0} onClick={refresh}>
            刷新
          </button>
        </div>
      </div>

      {sources.length === 0 ? (
        <p className="rounded-lg bg-chip px-4 py-6 text-center text-sm text-muted">请在设置中勾选可用片源后查看最近更新。</p>
      ) : query.isLoading && allItems.length === 0 ? (
        <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
          {Array.from({ length: 8 }).map((_, index) => <div key={index} className="aspect-[2/3] animate-pulse rounded-lg bg-chip" />)}
        </div>
      ) : null}

      {groups.length > 0 && (
        <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
          {groups.map((group) => <UpdateCard key={group.key} group={group} sources={sources} onPick={onPick} />)}
        </div>
      )}

      {!query.isLoading && !query.isError && groups.length === 0 && sources.length > 0 && (
        <p className="rounded-lg bg-chip px-4 py-6 text-center text-sm text-muted">
          {kind === 'movie' ? '当前已扫描页面没有可识别的电影；仍可继续读取后续页面或片源。' : '当前已扫描页面暂无更新内容。'}
        </p>
      )}

      {(query.isError || failedSourceCount > 0) && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-chip px-3 py-2 text-xs text-muted">
          <span>{query.isError ? '读取这批片源失败。' : `${failedSourceCount} 个源暂时无法读取，其他源结果仍可用。`}</span>
        </div>
      )}

      {limitedSources.size > 0 && <p className="mt-3 text-xs text-faint">{limitedSources.size} 个源达到每源 5 页的扫描上限，刷新后可重新从最新页开始。</p>}
      {(hasMore || query.isError) && (
        <div className="mt-4 flex justify-center">
          <button type="button" className="btn-ghost btn-sm" disabled={query.isFetching} onClick={continueReading}>
            {query.isFetching ? '正在读取…' : query.isError ? '重试当前批次' : '继续查看后续页面和片源'}
          </button>
        </div>
      )}
    </section>
  );
}
