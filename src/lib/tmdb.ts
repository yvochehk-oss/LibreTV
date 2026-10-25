export type TmdbMediaType = 'movie' | 'tv';
export type TmdbList = 'popular' | 'top_rated' | 'trending';

export interface TmdbItem {
  id: number;
  title: string;
  cover: string;
  rating?: string;
  year?: string;
  mediaType: TmdbMediaType;
}

export interface TmdbResponse {
  items: TmdbItem[];
  page: number;
  totalPages: number;
  totalResults: number;
}

const cache = new Map<string, { expiresAt: number; value: TmdbResponse }>();
const CACHE_TTL_MS = 5 * 60_000;
const MAX_CACHE_ENTRIES = 100;

export function hasTmdbCredentials(): boolean {
  return Boolean(process.env.TMDB_API_READ_ACCESS_TOKEN?.trim() || process.env.TMDB_API_KEY?.trim());
}

export async function fetchTmdbRecommendations(
  mediaType: TmdbMediaType,
  list: TmdbList,
  page: number,
  signal?: AbortSignal,
): Promise<TmdbResponse> {
  const token = process.env.TMDB_API_READ_ACCESS_TOKEN?.trim();
  const apiKey = process.env.TMDB_API_KEY?.trim();
  if (!token && !apiKey) throw new Error('TMDB 尚未配置 API 凭证');

  const safePage = Math.max(1, Math.min(500, Math.trunc(page)));
  const cacheKey = `${mediaType}:${list}:${safePage}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const path = list === 'trending' ? `/trending/${mediaType}/week` : `/${mediaType}/${list}`;
  const url = new URL(`/3${path}`, 'https://api.themoviedb.org');
  url.searchParams.set('language', 'zh-CN');
  url.searchParams.set('page', String(safePage));
  if (!token && apiKey) url.searchParams.set('api_key', apiKey);

  const timeout = AbortSignal.timeout(8_000);
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const response = await fetch(url, {
    signal: requestSignal,
    headers: token ? { Authorization: `Bearer ${token}`, Accept: 'application/json' } : { Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`TMDB 暂时无法提供推荐（HTTP ${response.status}）`);

  const data = await response.json() as Record<string, unknown>;
  const raw = Array.isArray(data.results) ? data.results : [];
  const items: TmdbItem[] = raw.flatMap((entry): TmdbItem[] => {
    if (!entry || typeof entry !== 'object') return [];
    const item = entry as Record<string, unknown>;
    const id = Number(item.id);
    const title = String(item.title ?? item.name ?? '').trim();
    if (!Number.isSafeInteger(id) || id <= 0 || !title) return [];
    const poster = typeof item.poster_path === 'string' ? item.poster_path : '';
    const date = String(item.release_date ?? item.first_air_date ?? '');
    const rating = Number(item.vote_average);
    return [{
      id,
      title,
      cover: poster ? `https://image.tmdb.org/t/p/w342${poster}` : '',
      ...(Number.isFinite(rating) && rating > 0 ? { rating: rating.toFixed(1) } : {}),
      ...(date.match(/^\d{4}/) ? { year: date.slice(0, 4) } : {}),
      mediaType,
    }];
  });

  const result: TmdbResponse = {
    items,
    page: Number.isSafeInteger(Number(data.page)) ? Number(data.page) : safePage,
    totalPages: Math.max(1, Math.min(500, Number(data.total_pages) || 1)),
    totalResults: Math.max(0, Number(data.total_results) || items.length),
  };
  if (cache.size >= MAX_CACHE_ENTRIES && !cache.has(cacheKey)) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey) cache.delete(oldestKey);
  }
  cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, value: result });
  return result;
}

export function clearTmdbCacheForTests(): void {
  cache.clear();
}
