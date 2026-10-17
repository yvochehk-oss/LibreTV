'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Header } from '@/components/header';
import { SiteFooter } from '@/components/site-footer';
import { VideoCard } from '@/components/video-card';
import { DetailModal } from '@/components/detail-modal';
import { useAppStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import type { SearchResultItem, SourceConfig } from '@/lib/types';
import type { BrowseCategory } from './api/browse/categories/route';
import type { BrowseVideosResponse } from './api/browse/videos/route';

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

  // 可用片源：预置 + 自定义，成人源受黄色过滤器控制
  const sources: SourceConfig[] = useMemo(() => {
    const all = [...envSources, ...customAPIs];
    return yellowFilter ? all.filter((s) => !s.isAdult) : all;
  }, [envSources, customAPIs, yellowFilter]);

  const [sourceKey, setSourceKey] = useState<string>('');
  const [categories, setCategories] = useState<CategoryState>({ loading: false, error: '', list: [] });
  const [typeId, setTypeId] = useState<string>(''); // '' = 全部最新
  const [area, setArea] = useState<string>(''); // '' = 全部地区
  const [page, setPage] = useState(1);
  const [videos, setVideos] = useState<BrowseVideosResponse | null>(null);
  const [videosLoading, setVideosLoading] = useState(false);
  const [videosError, setVideosError] = useState('');
  const [detailItem, setDetailItem] = useState<SearchResultItem | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const selectedSource = useMemo(
    () => sources.find((s) => s.key === sourceKey),
    [sources, sourceKey]
  );

  // 默认选中第一个片源
  useEffect(() => {
    if (!sourceKey && sources.length > 0) {
      setSourceKey(sources[0].key);
    }
  }, [sourceKey, sources]);

  // 选源后拉取分类
  useEffect(() => {
    if (!selectedSource) return;
    setCategories({ loading: true, error: '', list: [] });
    setTypeId('');
    setArea('');
    setPage(1);
    fetch(`/api/browse/categories?source=${encodeURIComponent(selectedSource.url)}`)
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || '获取分类失败');
        setCategories({ loading: false, error: '', list: data.categories || [] });
      })
      .catch((e) => {
        setCategories({ loading: false, error: e instanceof Error ? e.message : '获取分类失败', list: [] });
      });
  }, [selectedSource]);

  // 拉取视频列表
  const loadVideos = useCallback(() => {
    if (!selectedSource) return;
    setVideosLoading(true);
    setVideosError('');
    const params = new URLSearchParams({
      source: selectedSource.url,
      pg: String(page),
    });
    if (typeId) params.set('t', typeId);
    fetch(`/api/browse/videos?${params.toString()}`)
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || '获取视频列表失败');
        // 用真实源信息修正，便于详情弹窗解析源
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
      })
      .catch((e) => {
        setVideosError(e instanceof Error ? e.message : '获取视频列表失败');
        setVideos(null);
      })
      .finally(() => setVideosLoading(false));
  }, [selectedSource, typeId, page]);

  useEffect(() => {
    loadVideos();
  }, [loadVideos]);

  // 地区筛选：从当前列表收集去重
  const areas = useMemo(() => {
    const set = new Set<string>();
    (videos?.list || []).forEach((v) => {
      const a = (v.area || '').trim();
      if (a) set.add(a);
    });
    return [...set].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
  }, [videos]);

  const filteredList = useMemo(() => {
    if (!area) return videos?.list || [];
    return (videos?.list || []).filter((v) => (v.area || '').trim() === area);
  }, [videos, area]);

  const selectSource = (key: string) => {
    setSourceKey(key);
    setSidebarOpen(false);
  };

  const selectType = (id: string) => {
    setTypeId(id);
    setArea('');
    setPage(1);
    setSidebarOpen(false);
  };

  const sidebar = (
    <div className="flex flex-col gap-5">
      {/* 片源选择 */}
      <section>
        <h3 className="text-sm font-medium text-muted mb-2">片源</h3>
        <div className="flex flex-col gap-1 max-h-56 overflow-y-auto pr-1">
          {sources.map((s) => (
            <button
              key={s.key}
              onClick={() => selectSource(s.key)}
              className={cn(
                'text-left px-3 py-2 rounded-md text-sm transition-colors truncate',
                s.key === sourceKey
                  ? 'bg-accent/15 text-accent font-medium'
                  : 'text-content hover:bg-hover'
              )}
            >
              {s.name}
            </button>
          ))}
          {sources.length === 0 && (
            <p className="text-sm text-muted px-1">暂无可用片源，请先在设置中添加。</p>
          )}
        </div>
      </section>

      {/* 分类 */}
      <section>
        <h3 className="text-sm font-medium text-muted mb-2">分类</h3>
        {categories.loading && <p className="text-sm text-muted px-1">加载分类中…</p>}
        {categories.error && <p className="text-sm text-danger px-1">{categories.error}</p>}
        {!categories.loading && !categories.error && (
          <div className="flex flex-col gap-1 max-h-72 overflow-y-auto pr-1">
            <button
              onClick={() => selectType('')}
              className={cn(
                'text-left px-3 py-2 rounded-md text-sm transition-colors',
                typeId === '' ? 'bg-accent/15 text-accent font-medium' : 'text-content hover:bg-hover'
              )}
            >
              全部最新
            </button>
            {categories.list.map((c) => (
              <button
                key={c.type_id}
                onClick={() => selectType(String(c.type_id))}
                className={cn(
                  'text-left px-3 py-2 rounded-md text-sm transition-colors truncate',
                  typeId === String(c.type_id)
                    ? 'bg-accent/15 text-accent font-medium'
                    : 'text-content hover:bg-hover'
                )}
              >
                {c.type_name}
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
              onClick={() => setArea('')}
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
                onClick={() => setArea(a === area ? '' : a)}
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
            </h1>
            {videos && videos.total > 0 && (
              <span className="text-xs text-muted shrink-0">共 {videos.total} 部</span>
            )}
          </div>

          {videosLoading && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
              {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className="aspect-[2/3] rounded-lg bg-chip animate-pulse" />
              ))}
            </div>
          )}

          {videosError && (
            <div className="py-16 text-center">
              <p className="text-danger text-sm mb-3">{videosError}</p>
              <button
                onClick={loadVideos}
                className="px-4 py-2 rounded-md bg-accent text-white text-sm"
              >
                重试
              </button>
            </div>
          )}

          {!videosLoading && !videosError && filteredList.length === 0 && (
            <div className="py-16 text-center text-muted text-sm">
              {area ? '该地区暂无影片，换个地区试试' : '暂无影片'}
            </div>
          )}

          {!videosLoading && filteredList.length > 0 && (
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

              {/* 翻页 */}
              {pagecount > 1 && (
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
        </main>
      </div>

      <SiteFooter />
      <DetailModal item={detailItem} onClose={() => setDetailItem(null)} />
    </div>
  );
}
