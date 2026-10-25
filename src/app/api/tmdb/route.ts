import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/api-guard';
import { fetchTmdbRecommendations, hasTmdbCredentials, type TmdbList, type TmdbMediaType } from '@/lib/tmdb';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const guarded = guardRequest(req);
  if (guarded) return guarded;

  if (!hasTmdbCredentials()) {
    return NextResponse.json({ error: 'TMDB 尚未配置 API 凭证', configured: false }, { status: 424 });
  }

  const params = new URL(req.url).searchParams;
  const mediaType: TmdbMediaType = params.get('type') === 'tv' ? 'tv' : 'movie';
  const requestedList = params.get('list');
  const list: TmdbList = requestedList === 'top_rated' || requestedList === 'trending' ? requestedList : 'popular';
  const requestedPage = Number.parseInt(params.get('page') || '1', 10);
  const page = Number.isSafeInteger(requestedPage) ? Math.max(1, Math.min(500, requestedPage)) : 1;

  try {
    const data = await fetchTmdbRecommendations(mediaType, list, page, req.signal);
    return NextResponse.json({ ...data, configured: true });
  } catch (error) {
    if (req.signal.aborted) return new Response(null, { status: 499 });
    return NextResponse.json(
      { error: error instanceof Error && error.message.startsWith('TMDB 暂时无法提供')
        ? error.message
        : 'TMDB 推荐暂时无法加载，请稍后重试', configured: true },
      { status: 502 },
    );
  }
}
