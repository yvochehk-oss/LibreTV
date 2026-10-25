'use client';

import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import Image from 'next/image';
import { api } from '@/lib/client-api';
import { TMDB_ERAS, TMDB_REGIONS, tmdbQueryKey, type TmdbEra, type TmdbList, type TmdbMediaType, type TmdbRegion } from '@/lib/tmdb-filters';
import { DoubanCard } from '@/components/video-card';
import { cn } from '@/lib/utils';

const LISTS: { id: TmdbList; label: string }[] = [
  { id: 'popular', label: '热门' },
  { id: 'top_rated', label: '高分' },
  { id: 'trending', label: '本周趋势' },
];

export function TmdbSection({ onPick }: { onPick: (title: string) => void }) {
  const [type, setType] = useState<TmdbMediaType>('movie');
  const [list, setList] = useState<TmdbList>('popular');
  const [region, setRegion] = useState<TmdbRegion>('all');
  const [era, setEra] = useState<TmdbEra>('all');
  const [trendNotice, setTrendNotice] = useState(false);
  const hasFilters = region !== 'all' || era !== 'all';
  const query = useInfiniteQuery({
    queryKey: tmdbQueryKey(type, list, region, era),
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) => api.tmdb(type, list, pageParam, region, era, signal),
    getNextPageParam: (lastPage) => lastPage.nextPage ?? undefined,
    staleTime: 5 * 60_000,
  });
  const pages = query.data?.pages ?? [];
  const items = [...new Map(pages.flatMap((page) => page.items).map((item) => [item.id, item])).values()];

  const changeType = (next: TmdbMediaType) => setType(next);
  const changeList = (next: TmdbList) => {
    setList(next);
    setTrendNotice(false);
  };
  const changeRegion = (next: TmdbRegion) => {
    setRegion(next);
    if (next !== 'all' && era !== 'all' && list === 'trending') {
      setList('popular');
      setTrendNotice(true);
    } else if (next !== 'all' && list === 'trending') {
      setList('popular');
      setTrendNotice(true);
    } else if (next === 'all' && era === 'all') {
      setTrendNotice(false);
    }
  };
  const changeEra = (next: TmdbEra) => {
    setEra(next);
    if (next !== 'all' && list === 'trending') {
      setList('popular');
      setTrendNotice(true);
    } else if (next === 'all' && region === 'all') {
      setTrendNotice(false);
    }
  };

  return (
    <section aria-label="TMDB 电影推荐" className="mb-10">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-content">{type === 'movie' ? '电影推荐' : '剧集推荐'} <span className="text-xs font-normal text-faint">TMDB</span></h2>
          <p className="mt-0.5 text-xs text-faint">浏览 TMDB 目录；点击影片后在已配置片源中搜索。</p>
        </div>
        <div className="flex rounded-lg bg-chip p-0.5">
          {(['movie', 'tv'] as const).map((value) => (
            <button key={value} type="button" aria-pressed={type === value} onClick={() => changeType(value)}
              className={cn('rounded-md px-3 py-1.5 text-xs', type === value ? 'bg-accent text-on-accent' : 'text-muted hover:text-content')}>
              {value === 'movie' ? '电影' : '剧集'}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {LISTS.filter((option) => option.id !== 'trending' || !hasFilters).map((option) => (
          <button key={option.id} type="button" aria-pressed={list === option.id} onClick={() => changeList(option.id)}
            className={cn('rounded-full px-2.5 py-1 text-xs transition-colors', list === option.id ? 'bg-accent text-on-accent' : 'bg-chip text-muted hover:bg-hover hover:text-content')}>
            {option.label}
          </button>
        ))}
      </div>

      <div className="mb-3">
        <p className="mb-1.5 text-xs text-muted">地区</p>
        <div className="flex flex-wrap gap-1.5">
          {TMDB_REGIONS.map((option) => (
            <button key={option.id} type="button" aria-pressed={region === option.id} onClick={() => changeRegion(option.id)}
              className={cn('rounded-full px-2.5 py-1 text-xs transition-colors', region === option.id ? 'bg-accent text-on-accent' : 'bg-chip text-muted hover:bg-hover hover:text-content')}>
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-4">
        <p className="mb-1.5 text-xs text-muted">首映/首播年代</p>
        <div className="flex flex-wrap gap-1.5">
          {TMDB_ERAS.map((option) => (
            <button key={option.id} type="button" aria-pressed={era === option.id} onClick={() => changeEra(option.id)}
              className={cn('rounded-full px-2.5 py-1 text-xs transition-colors', era === option.id ? 'bg-accent text-on-accent' : 'bg-chip text-muted hover:bg-hover hover:text-content')}>
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {trendNotice && hasFilters && <p role="status" className="mb-3 text-xs text-muted">本周趋势暂不支持地区或年代筛选，已切换为热门。</p>}

      {query.isError && pages.length === 0 ? (
        <div className="rounded-lg bg-chip px-4 py-8 text-center text-sm text-muted">
          <p>{query.error.message.includes('尚未配置') ? 'TMDB 尚未配置，请在服务端设置 API Key 或 API Read Access Token。' : 'TMDB 推荐暂时无法加载。'}</p>
          <button type="button" className="btn-ghost btn-sm mt-3" onClick={() => void query.refetch()}>重试</button>
        </div>
      ) : query.isLoading ? (
        <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
          {Array.from({ length: 8 }).map((_, index) => <div key={index} className="aspect-[2/3] animate-pulse rounded-lg bg-chip" />)}
        </div>
      ) : items.length === 0 ? (
        <p className="py-8 text-center text-sm text-faint">当前暂无推荐内容</p>
      ) : (
        <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
          {items.map((item) => <DoubanCard key={`${item.mediaType}:${item.id}`} item={{ title: item.title, cover: item.cover, rating: item.rating, year: item.year }} onClick={() => onPick(item.title)} />)}
        </div>
      )}

      {query.isFetchNextPageError && pages.length > 0 && (
        <p role="alert" className="mt-3 text-center text-sm text-danger">继续加载失败，已保留当前内容。<button type="button" className="underline ml-1" onClick={() => void query.fetchNextPage()}>重试</button></p>
      )}
      {query.hasNextPage && !query.isError && (
        <div className="mt-4 flex justify-center">
          <button type="button" className="btn-ghost btn-sm" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
            {query.isFetchingNextPage ? '加载中…' : '继续加载'}
          </button>
        </div>
      )}
      <p className="mt-2 text-center text-[11px] text-faint">每次加载最多 60 部</p>
      <p className="mt-4 text-center text-[11px] text-faint">
        <a href="https://www.themoviedb.org" target="_blank" rel="noreferrer" className="mb-2 inline-flex" aria-label="TMDB 官网">
          <Image src="/tmdb-logo.svg" width={110} height={15} alt="TMDB" />
        </a>
        <br />
        This product uses the TMDB API but is not endorsed or certified by TMDB.
      </p>
    </section>
  );
}
