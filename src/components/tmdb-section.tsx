'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Image from 'next/image';
import { api } from '@/lib/client-api';
import type { TmdbList, TmdbMediaType } from '@/lib/tmdb';
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
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ['tmdb', type, list, page],
    queryFn: ({ signal }) => api.tmdb(type, list, page, signal),
    staleTime: 5 * 60_000,
  });
  const data = query.data;
  const items = data?.items ?? [];

  const changeType = (next: TmdbMediaType) => {
    setType(next);
    setPage(1);
  };
  const changeList = (next: TmdbList) => {
    setList(next);
    setPage(1);
  };

  return (
    <section aria-label="TMDB 电影推荐" className="mb-10">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-content">电影推荐 <span className="text-xs font-normal text-faint">TMDB</span></h2>
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

      <div className="mb-4 flex flex-wrap gap-1.5">
        {LISTS.map((option) => (
          <button key={option.id} type="button" aria-pressed={list === option.id} onClick={() => changeList(option.id)}
            className={cn('rounded-full px-2.5 py-1 text-xs transition-colors', list === option.id ? 'bg-accent text-on-accent' : 'bg-chip text-muted hover:bg-hover hover:text-content')}>
            {option.label}
          </button>
        ))}
      </div>

      {query.isError ? (
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
          {items.map((item) => <DoubanCard key={`${item.mediaType}:${item.id}`} item={{ title: item.title, cover: item.cover, rating: item.rating }} onClick={() => onPick(item.title)} />)}
        </div>
      )}

      {data && data.totalPages > 1 && (
        <div className="mt-4 flex items-center justify-center gap-3">
          <button type="button" className="btn-ghost btn-sm" disabled={page <= 1 || query.isFetching} onClick={() => setPage((value) => Math.max(1, value - 1))}>上一页</button>
          <span className="text-xs text-faint">{page} / {data.totalPages}</span>
          <button type="button" className="btn-ghost btn-sm" disabled={page >= data.totalPages || query.isFetching} onClick={() => setPage((value) => Math.min(data.totalPages, value + 1))}>下一页</button>
        </div>
      )}
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
