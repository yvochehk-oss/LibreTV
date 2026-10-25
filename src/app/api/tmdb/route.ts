import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/api-guard';
import { fetchTmdbRecommendations, hasTmdbCredentials } from '@/lib/tmdb';
import { isTmdbEra, isTmdbRegion, type TmdbEra, type TmdbList, type TmdbMediaType, type TmdbRegion } from '@/lib/tmdb-filters';

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
  const requestedRegion = params.get('region') || 'all';
  const region: TmdbRegion = isTmdbRegion(requestedRegion) ? requestedRegion : 'all';
  const requestedEra = params.get('era') || 'all';
  const era: TmdbEra = isTmdbEra(requestedEra) ? requestedEra : 'all';

  if (list === 'trending' && (region !== 'all' || era !== 'all')) {
    return NextResponse.json({ error: 'TMDB 本周趋势暂不支持地区或年代筛选', configured: true }, { status: 400 });
  }

  try {
    const data = await fetchTmdbRecommendations(mediaType, list, page, region, era, req.signal);
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
