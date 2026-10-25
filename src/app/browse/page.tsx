'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getBrowsableSources } from '@/lib/browse-sources';
import { Header } from '@/components/header';
import { SiteFooter } from '@/components/site-footer';
import { VideoCard } from '@/components/video-card';
import { DetailModal } from '@/components/detail-modal';
import { useAppStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import type { SearchResultItem } from '@/lib/types';
import type { BrowseCategory } from '../api/browse/categories/route';
import type { BrowseVideosResponse } from '../api/browse/videos/route';
import { BROWSE_KINDS, getAreaOptions, getKindTypeIds, getKnownKinds, type BrowseKind } from '@/lib/browse-filters';

/** 片源分类浏览：侧边栏选源 → 分类 → 地区筛选，右侧视频网格 + 翻页 */

interface CategoryState {
  loading: boolean;
  error: string;
  list: BrowseCategory[];
}

export default function BrowsePage() {
  const customAPIs = useAppStore((s) => s.customAPIs);
  const envSources = useAppStore((s) => s.envSources);
  const yellowFilter = useAppStore((s) => s.yellowFilter);
  const selectedKeys = useAppStore((s) => s.selectedKeys);
  const subscriptions = useAppStore((s) => s.subscriptions);

  // 同步设置页已勾选源；订阅总开关和成人过滤即时生效。
  const sources = useMemo(
    () => getBrowsableSources({ envSources, customAPIs, selectedKeys, subscriptions, yellowFilter }),
    [envSources, customAPIs, selectedKeys, subscriptions, yellowFilter]
  );

  const [sourceKey, setSourceKey] = useState<string>('');
  const [categories, setCategories] = useState<CategoryState>({ loading: false, error: '', list: [] });
  const [typeId, setTypeId] = useState<string>(''); // '' = 全部最新
  const [kind, setKind] = useState<BrowseKind | ''>('');
  const [area, setArea] = useState<string>(''); // '' = 全部地区
  const [page, setPage] = useState(1);
  const [videos, setVideos] = useState<BrowseVideosResponse | null>(null);
  const [videosLoading, setVideosLoading] = useState(false);
  const [videosError, setVideosError] = useState('');
  const [detailItem, setDetailItem] = useState<SearchResultItem | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [cursorHistory, setCursorHistory] = useState<number[]>([]);
  const [discoveredAreas, setDiscoveredAreas] = useState<string[]>([]);
  const [hadEarlierMatches, setHadEarlierMatches] = useState(false);

  const selectedSource = useMemo(
    () => sources.find((s) => s.key === sourceKey),
    [sources, sourceKey]
  );
  const knownKinds = useMemo(() => getKnownKinds(categories.list), [categories.list]);
  const visibleCategories = useMemo(() => !kind ? categories.list : categories.list.filter((item) => getKindTypeIds(categories.list, kind).includes(item.type_id)), [categories.list, kind]);

  // 当前片源被删除、取消勾选或订阅停用后，自动切换到下一个已启用源。
  useEffect(() => {
    if (!sources.some((source) => source.key === sourceKey)) {
      setSourceKey(sources[0]?.key ?? '');
    }
  }, [sourceKey, sources]);

  // 切换源时重置原源的分类和地区选择。
  useEffect(() => {
    setTypeId('');
    setKind('');
    setArea('');
    setPage(1);
    setCursorHistory([]);
    setDiscoveredAreas([]);
    setHadEarlierMatches(false);
    setLastUpdated(null);
  }, [selectedSource]);

  // 分类随刷新请求实时获取，旧请求取消；刷新时保留用户分类选择。
  useEffect(() => {
    if (!selectedSource) {
      setCategories({ loading: false, error: '', list: [] });
      setVideos(null);
      setVideosError('');
      return;
    }
    const controller = new AbortController();
    setCategories({ loading: true, error: '', list: [] });
    fetch('/api/browse/categories?source=' + encodeURIComponent(selectedSource.url), { signal: controller.signal })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || '获取分类失败');
        if (!controller.signal.aborted) {
          const list: BrowseCategory[] = Array.isArray(data.categories) ? data.categories : [];
          setCategories({ loading: false, error: '', list });
          setTypeId((current) => current && !list.some((item) => String(item.type_id) === current) ? '' : current);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setCategories({ loading: false, error: e instanceof Error ? e.message : '获取分类失败', list: [] });
        }
      });
    return () => controller.abort();
  }, [selectedSource, refreshVersion]);

  const loadVideos = useCallback((signal: AbortSignal) => {
    if (!selectedSource) {
      setVideos(null);
      setVideosError('');
      setVideosLoading(false);
      return;
    }
    setVideosLoading(true);
    setVideosError('');
    const params = new URLSearchParams({ source: selectedSource.url, pg: String(page) });
    if (typeId) params.set('t', typeId);
    if (kind) params.set('kind', kind);
    if (area) params.set('area', area);
    fetch('/api/browse/videos?' + params.toString(), { signal })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || '获取视频列表失败');
        if (signal.aborted) return;
        const fixed: BrowseVideosResponse = {
          ...data,
          list: (data.list || []).map((item: SearchResultItem) => ({
            ...item,
            sourceKey: selectedSource.key,
            sourceName: selectedSource.name,
            sourceUrl: selectedSource.url,
          })),
        };
        setVideos(fixed);
        setDiscoveredAreas((current) => [...new Set([...current, ...(fixed.areas || [])])]);
        if (fixed.list.length > 0) setHadEarlierMatches(true);
        setLastUpdated(Date.now());
      })
      .catch((e) => {
        if (signal.aborted) return;
        setVideosError(e instanceof Error ? e.message : '获取视频列表失败');
        setVideos(null);
      })
      .finally(() => {
        if (!signal.aborted) setVideosLoading(false);
      });
  }, [selectedSource, typeId, kind, area, page]);

  useEffect(() => {
    const controller = new AbortController();
    loadVideos(controller.signal);
    return () => controller.abort();
  }, [loadVideos, refreshVersion]);

  // 页面打开时每 15 分钟自动刷新；隐藏页面不会持续请求点播源。
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') setRefreshVersion((v) => v + 1);
    }, 15 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  const areas = useMemo(() => getAreaOptions([...new Set([...discoveredAreas, ...(videos?.areas || []), ...(area ? [area] : [])])].map((item) => ({ area: item }))), [videos, discoveredAreas, area]);
  const filteredList = videos?.list || [];
  const filteredMode = Boolean(kind || area);

  const selectSource = (key: string) => {
    setSourceKey(key);
    setSidebarOpen(false);
  };

  const selectType = (id: string) => {
    setTypeId(id);
    setPage(1);
    setCursorHistory([]);
    setHadEarlierMatches(false);
  };

  const selectKind = (value: BrowseKind | '') => {
    setKind(value);
    if (typeId && value && !getKindTypeIds(categories.list, value).includes(Number(typeId))) setTypeId('');
    setPage(1);
    setCursorHistory([]);
    setHadEarlierMatches(false);
  };

  const selectArea = (value: string) => {
    setArea(value === area ? '' : value);
    setPage(1);
    setCursorHistory([]);
    setHadEarlierMatches(false);
  };

  const continueSearch = () => {
    if (!videos?.nextPage) return;
    setCursorHistory((history) => [...history, page]);
    setPage(videos.nextPage);
  };
  const previousBatch = () => {
    const previous = cursorHistory.at(-1);
    if (previous === undefined) return;
    setCursorHistory((history) => history.slice(0, -1));
    setPage(previous);
  };

  const sidebar = (
    <div className="flex flex-col gap-5">
      {/* 片源选择 */}
      <section>
        <h3 className="text-sm font-medium text-muted mb-2">片源</h3>
        <div className="flex flex-col gap-2 max-h-64 overflow-y-auto pr-1">
          {sources.map((s) => (
            <button
              key={s.key}
              onClick={() => selectSource(s.key)}
              className={cn(
                'flex w-full min-h-11 shrink-0 items-center rounded-md px-3 py-2.5 text-left text-sm leading-6 transition-colors',
                s.key === sourceKey
                  ? 'bg-accent/15 text-accent font-medium'
                  : 'text-content hover:bg-hover'
              )}
            >
              <span className="block min-w-0 flex-1 truncate">{s.name}</span>
            </button>
          ))}
          {sources.length === 0 && (
            <p className="text-sm text-muted px-1">暂无可用片源，请先在设置中添加。</p>
          )}
        </div>
      </section>

      {/* 分类 */}
      <section>
        <h3 className="text-sm font-medium text-muted mb-2">内容类型</h3>
        <div className="flex flex-wrap gap-1.5 mb-3">
          <button onClick={() => selectKind('')} className={cn('px-2.5 py-1 rounded-full text-xs transition-colors', !kind ? 'bg-accent text-white' : 'bg-chip text-muted hover:text-content')}>全部</button>
          {BROWSE_KINDS.map((item) => (
            <button key={item.id} onClick={() => selectKind(item.id)} className={cn('px-2.5 py-1 rounded-full text-xs transition-colors', kind === item.id ? 'bg-accent text-white' : 'bg-chip text-muted hover:text-content')}>{item.label}</button>
          ))}
        </div>
        <h3 className="text-sm font-medium text-muted mb-2">源分类</h3>
        {kind && !knownKinds.includes(kind) && !categories.loading && (
          <p className="text-xs leading-5 text-muted px-1 mb-2">该源没有可识别的分类元数据；只按影片自身明确的类型名称筛选。</p>
        )}
        {categories.loading && <p className="text-sm text-muted px-1">加载分类中…</p>}
        {categories.error && <p className="text-sm text-danger px-1">{categories.error}。可尝试「全部最新」或换源。</p>}
        {!categories.loading && !categories.error && categories.list.length === 0 && selectedSource && (
          <p className="text-xs leading-5 text-muted px-1 mb-2">该片源未返回分类，可尝试「全部最新」浏览。</p>
        )}
        {!categories.loading && (
          <div className="flex flex-col gap-2 max-h-80 overflow-y-auto pr-1">
            <button
              onClick={() => selectType('')}
              className={cn(
                'flex w-full min-h-11 shrink-0 items-center rounded-md px-3 py-2.5 text-left text-sm leading-6 transition-colors',
                typeId === '' ? 'bg-accent/15 text-accent font-medium' : 'text-content hover:bg-hover'
              )}
            >
              <span className="block min-w-0 flex-1 truncate">{kind ? `${BROWSE_KINDS.find((item) => item.id === kind)?.label}全部` : '全部最新'}</span>
            </button>
            {visibleCategories.map((c) => (
              <button
                key={c.type_id}
                onClick={() => selectType(String(c.type_id))}
                className={cn(
                  'flex w-full min-h-11 shrink-0 items-center rounded-md px-3 py-2.5 text-left text-sm leading-6 transition-colors',
                  typeId === String(c.type_id)
                    ? 'bg-accent/15 text-accent font-medium'
                    : 'text-content hover:bg-hover'
                )}
              >
                <span className="block min-w-0 flex-1 truncate">{c.type_name}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* 地区筛选 */}
      {areas.length > 0 && (
        <section>
          <h3 className="text-sm font-medium text-muted mb-2">地区</h3>
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => selectArea('')}
              className={cn(
                'px-2.5 py-1 rounded-full text-xs transition-colors',
                area === '' ? 'bg-accent text-white' : 'bg-chip text-muted hover:text-content'
              )}
            >
              全部
            </button>
            {areas.map((a) => (
              <button
                key={a}
                onClick={() => selectArea(a)}
                className={cn(
                  'px-2.5 py-1 rounded-full text-xs transition-colors',
                  area === a ? 'bg-accent text-white' : 'bg-chip text-muted hover:text-content'
                )}
              >
                {a}
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );

  const pagecount = videos?.pagecount || 1;

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <div className="flex-1 max-w-7xl w-full mx-auto px-4 py-4 flex gap-6">
        {/* 桌面端侧边栏 */}
        <aside className="hidden md:block w-52 shrink-0">
          <div className="sticky top-20">{sidebar}</div>
        </aside>

        {/* 移动端抽屉 */}
        {sidebarOpen && (
          <div className="fixed inset-0 z-50 md:hidden">
            <div
              className="absolute inset-0 bg-black/60"
              onClick={() => setSidebarOpen(false)}
            />
            <div className="absolute left-0 top-0 bottom-0 w-72 max-w-[85vw] bg-surface border-r border-line p-4 overflow-y-auto">
              <div className="flex items-center justify-between mb-4">
                <span className="font-medium">浏览筛选</span>
                <button
                  onClick={() => setSidebarOpen(false)}
                  className="px-2 py-1 text-sm text-muted hover:text-content"
                >
                  关闭
                </button>
              </div>
              {sidebar}
            </div>
          </div>
        )}

        {/* 右侧内容 */}
        <main className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-4">
            <button
              onClick={() => setSidebarOpen(true)}
              className="md:hidden px-3 py-1.5 rounded-md bg-chip text-sm text-content"
            >
              筛选
            </button>
            <h1 className="text-lg font-semibold truncate">
              {selectedSource ? selectedSource.name : '浏览'}
              {typeId && categories.list.find((c) => String(c.type_id) === typeId)
                ? ` · ${categories.list.find((c) => String(c.type_id) === typeId)?.type_name}`
                : typeId === '' ? ' · 全部最新' : ''}
              {kind ? ` · ${BROWSE_KINDS.find((item) => item.id === kind)?.label}` : ''}
              {area ? ` · ${area}` : ''}
            </h1>
            {videos && !filteredMode && videos.total > 0 && (
              <span className="text-xs text-muted shrink-0">共 {videos.total} 部</span>
            )}
            {videos && filteredMode && <span className="text-xs text-muted shrink-0">本批匹配 {videos.list.length} 部</span>}
            {selectedSource && (
              <button
                type="button"
                onClick={() => setRefreshVersion((v) => v + 1)}
                disabled={videosLoading}
                className="ml-auto shrink-0 rounded-md border border-line bg-chip px-3 py-1.5 text-sm text-content hover:bg-hover disabled:opacity-50"
                aria-label="刷新影片列表"
                title={lastUpdated ? '上次更新：' + new Date(lastUpdated).toLocaleTimeString() : '刷新影片列表'}
              >
                {videosLoading ? '更新中…' : '刷新'}
              </button>
            )}
          </div>

          {kind && videos?.kindMetadataMissing && (
            <p className="mb-3 rounded-md bg-chip px-3 py-2 text-xs text-muted">该源未返回可用的类型分类数据；仅能识别影片自身明确标注的类型，其他条目保持未分类。</p>
          )}

          {!selectedSource && (
            <div className="py-16 text-center text-muted text-sm">
              没有已启用的点播源，请到「设置 → 源管理」勾选或添加点播源。
            </div>
          )}

          {selectedSource && videosLoading && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
              {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className="aspect-[2/3] rounded-lg bg-chip animate-pulse" />
              ))}
            </div>
          )}

          {selectedSource && videosError && (
            <div className="py-16 text-center">
              <p className="text-danger text-sm mb-3">{videosError}</p>
              <button
                onClick={() => setRefreshVersion((v) => v + 1)}
                className="px-4 py-2 rounded-md bg-accent text-white text-sm"
              >
                重试
              </button>
            </div>
          )}

          {selectedSource && !videosLoading && !videosError && filteredList.length === 0 && (
            <div className="py-16 text-center text-muted text-sm">
              {filteredMode && videos?.nextPage ? '当前批次没有匹配项，还可以继续查找后续片源页面。' : filteredMode && hadEarlierMatches ? '本批没有匹配项，已到列表末尾或没有可确认的后续页面。' : filteredMode ? '当前批次没有匹配项。' : '暂无影片'}
            </div>
          )}

          {selectedSource && !videosLoading && !videosError && filteredList.length > 0 && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                {filteredList.map((item) => (
                  <VideoCard
                    key={`${item.sourceKey}_${item.vodId}`}
                    item={item}
                    onClick={() => setDetailItem(item)}
                  />
                ))}
              </div>

              {/* 普通分页；过滤模式通过服务端游标分批检查有限页数 */}
              {!filteredMode && pagecount > 1 && (
                <div className="flex items-center justify-center gap-2 mt-6">
                  <button
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="px-3 py-1.5 rounded-md bg-chip text-sm disabled:opacity-40"
                  >
                    上一页
                  </button>
                  <span className="text-sm text-muted px-2">
                    {page} / {pagecount}
                  </span>
                  <button
                    disabled={page >= pagecount}
                    onClick={() => setPage((p) => Math.min(pagecount, p + 1))}
                    className="px-3 py-1.5 rounded-md bg-chip text-sm disabled:opacity-40"
                  >
                    下一页
                  </button>
                </div>
              )}
            </>
          )}
          {selectedSource && filteredMode && !videosLoading && !videosError && videos && (
            <div className="flex items-center justify-center gap-3 mt-6">
              <button disabled={cursorHistory.length === 0} onClick={previousBatch} className="px-3 py-1.5 rounded-md bg-chip text-sm disabled:opacity-40">上一批</button>
              <span className="text-xs text-muted">{videos.nextPage ? `已检查 ${videos.scannedPages} 页，可继续查找` : '当前源没有可确认的后续页面'}</span>
              <button disabled={!videos.nextPage} onClick={continueSearch} className="px-3 py-1.5 rounded-md bg-accent text-white text-sm disabled:opacity-40">继续查找</button>
            </div>
          )}
        </main>
      </div>

      <SiteFooter />
      <DetailModal item={detailItem} onClose={() => setDetailItem(null)} />
    </div>
  );
}
