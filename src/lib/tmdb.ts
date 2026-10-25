import { tmdbCountriesForRegion, tmdbDateRangeForEra, type TmdbEra, type TmdbItem, type TmdbList, type TmdbMediaType, type TmdbRegion, type TmdbResponse } from './tmdb-filters';

const cache = new Map<string, { expiresAt: number; value: TmdbResponse }>();
const CACHE_TTL_MS = 5 * 60_000;
const MAX_CACHE_ENTRIES = 100;
const BATCH_SIZE = 3;
const MAX_PAGE = 500;
const TOP_RATED_VOTE_COUNT_MIN = 100;

export function hasTmdbCredentials(): boolean {
  return Boolean(process.env.TMDB_API_READ_ACCESS_TOKEN?.trim() || process.env.TMDB_API_KEY?.trim());
}

export async function fetchTmdbRecommendations(
  mediaType: TmdbMediaType,
  list: TmdbList,
  startPage: number,
  region: TmdbRegion = 'all',
  era: TmdbEra = 'all',
  signal?: AbortSignal,
): Promise<TmdbResponse> {
  const token = process.env.TMDB_API_READ_ACCESS_TOKEN?.trim();
  const apiKey = process.env.TMDB_API_KEY?.trim();
  if (!token && !apiKey) throw new Error('TMDB 尚未配置 API 凭证');
  if (list === 'trending' && (region !== 'all' || era !== 'all')) throw new Error('TMDB 本周趋势暂不支持地区或年代筛选');

  const safeStartPage = Math.max(1, Math.min(MAX_PAGE, Math.trunc(startPage)));
  const batchEndPage = Math.min(safeStartPage + BATCH_SIZE - 1, MAX_PAGE);
  const cacheKey = `${mediaType}:${list}:${region}:${era}:${safeStartPage}-${batchEndPage}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const batchController = new AbortController();
  const abortSignals = [AbortSignal.timeout(20_000), batchController.signal];
  if (signal) abortSignals.push(signal);
  const requestSignal = AbortSignal.any(abortSignals);
  let pageResponses: Record<string, unknown>[];
  try {
    const first = await fetchTmdbPage(mediaType, list, safeStartPage, region, era, token, apiKey, requestSignal);
    const totalPages = Math.max(1, Math.min(MAX_PAGE, Number(first.total_pages) || 1));
    const remainingPages = Array.from({ length: Math.min(BATCH_SIZE - 1, Math.max(0, Math.min(MAX_PAGE, totalPages) - safeStartPage)) }, (_, index) => safeStartPage + index + 1);
    const rest = await Promise.all(remainingPages.map((page) => fetchTmdbPage(mediaType, list, page, region, era, token, apiKey, requestSignal)));
    pageResponses = [first, ...rest];
  } catch (error) {
    batchController.abort();
    throw error;
  }
  const first = pageResponses[0];
  const totalPages = Math.max(1, Math.min(MAX_PAGE, Number(first.total_pages) || 1));
  const itemsById = new Map<number, TmdbItem>();
  for (const data of pageResponses) {
    const raw = Array.isArray(data.results) ? data.results : [];
    for (const entry of raw) {
      if (!entry || typeof entry !== 'object') continue;
      const item = entry as Record<string, unknown>;
      const id = Number(item.id);
      const title = String(item.title ?? item.name ?? '').trim();
      if (!Number.isSafeInteger(id) || id <= 0 || !title || itemsById.has(id)) continue;
      const poster = typeof item.poster_path === 'string' ? item.poster_path : '';
      const date = String(item.release_date ?? item.first_air_date ?? '');
      const rating = Number(item.vote_average);
      itemsById.set(id, {
        id,
        title,
        cover: poster ? `https://image.tmdb.org/t/p/w342${poster}` : '',
        ...(Number.isFinite(rating) && rating > 0 ? { rating: rating.toFixed(1) } : {}),
        ...(date.match(/^\d{4}/) ? { year: date.slice(0, 4) } : {}),
        mediaType,
      });
    }
  }
  const fetchedThrough = Math.min(safeStartPage + pageResponses.length - 1, totalPages);
  const result: TmdbResponse = {
    items: [...itemsById.values()],
    page: safeStartPage,
    totalPages,
    totalResults: Math.max(0, Number(first.total_results) || 0),
    nextPage: fetchedThrough < totalPages ? fetchedThrough + 1 : null,
  };
  if (cache.size >= MAX_CACHE_ENTRIES && !cache.has(cacheKey)) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey) cache.delete(oldestKey);
  }
  cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, value: result });
  return result;
}

async function fetchTmdbPage(
  mediaType: TmdbMediaType,
  list: TmdbList,
  page: number,
  region: TmdbRegion,
  era: TmdbEra,
  token: string | undefined,
  apiKey: string | undefined,
  signal: AbortSignal,
): Promise<Record<string, unknown>> {
  const url = new URL(`/3${list === 'trending' ? `/trending/${mediaType}/week` : `/discover/${mediaType}`}`, 'https://api.themoviedb.org');
  url.searchParams.set('language', 'zh-CN');
  url.searchParams.set('page', String(page));
  if (!token && apiKey) url.searchParams.set('api_key', apiKey);
  if (list !== 'trending') {
    url.searchParams.set('sort_by', list === 'top_rated' ? 'vote_average.desc' : 'popularity.desc');
    if (list === 'top_rated') url.searchParams.set('vote_count.gte', String(TOP_RATED_VOTE_COUNT_MIN));
    const countries = tmdbCountriesForRegion(region);
    if (countries.length === 1) url.searchParams.set('with_origin_country', countries[0]);
    else if (countries.length > 1) url.searchParams.set('with_origin_country', countries.join('|'));
    const eraRange = tmdbDateRangeForEra(era);
    if (eraRange?.from || eraRange?.through) {
      const prefix = mediaType === 'movie' ? 'primary_release_date' : 'first_air_date';
      if (eraRange.from) url.searchParams.set(`${prefix}.gte`, eraRange.from);
      if (eraRange.through) url.searchParams.set(`${prefix}.lte`, eraRange.through);
    }
  }
  const response = await fetch(url, {
    signal,
    headers: token ? { Authorization: `Bearer ${token}`, Accept: 'application/json' } : { Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`TMDB 暂时无法提供推荐（HTTP ${response.status}）`);
  return await response.json() as Record<string, unknown>;
}

export function clearTmdbCacheForTests(): void {
  cache.clear();
}
