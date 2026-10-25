import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE, signSession } from '@/lib/auth';
import { clearTmdbCacheForTests } from './tmdb';
import { tmdbQueryKey } from './tmdb-filters';
import { GET } from '@/app/api/tmdb/route';

function request(query: string): Request {
  const cookie = `${SESSION_COOKIE}=${signSession().token}`;
  return new Request(`https://local.test/api/tmdb?${query}`, { headers: { cookie } });
}

function page(page: number, totalPages: number, items: unknown[]) {
  return Response.json({ page, total_pages: totalPages, total_results: totalPages * 20, results: items });
}

function result(id: number, date = '2024-03-04') {
  return { id, title: `影片${id}`, poster_path: null, release_date: date, first_air_date: date, vote_average: 8.2 };
}

beforeAll(() => { process.env.PASSWORD = 'tmdb-filter-test-password'; });
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.TMDB_API_KEY;
  delete process.env.TMDB_API_READ_ACCESS_TOKEN;
  clearTmdbCacheForTests();
});

describe('GET /api/tmdb filters and batch loading', () => {
  it('changes client query identity when type, list, region, or era changes', () => {
    const base = tmdbQueryKey('movie', 'popular', 'all', 'all');
    expect(tmdbQueryKey('tv', 'popular', 'all', 'all')).not.toEqual(base);
    expect(tmdbQueryKey('movie', 'top_rated', 'all', 'all')).not.toEqual(base);
    expect(tmdbQueryKey('movie', 'popular', 'CN', 'all')).not.toEqual(base);
    expect(tmdbQueryKey('movie', 'popular', 'all', '2020s')).not.toEqual(base);
  });

  it('sends Mainland and movie decade filters to discover and batches three pages with ID dedupe', async () => {
    process.env.TMDB_API_KEY = 'test-api-key';
    const pages = new Map<number, unknown[]>([
      [1, Array.from({ length: 20 }, (_, i) => result(i + 1))],
      [2, [result(1), ...Array.from({ length: 19 }, (_, i) => result(i + 21))]],
      [3, [result(1), ...Array.from({ length: 19 }, (_, i) => result(i + 40))]],
    ]);
    const calls: URL[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      calls.push(url);
      return page(Number(url.searchParams.get('page')), 5, pages.get(Number(url.searchParams.get('page'))) ?? []);
    }));

    const response = await GET(request('type=movie&list=popular&page=1&region=CN&era=2020s'));
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.items).toHaveLength(58);
    expect(data).toMatchObject({ page: 1, totalPages: 5, nextPage: 4 });
    expect(calls).toHaveLength(3);
    expect(calls.map((url) => url.searchParams.get('page')).sort()).toEqual(['1', '2', '3']);
    for (const url of calls) {
      expect(url.pathname).toBe('/3/discover/movie');
      expect(url.searchParams.get('with_origin_country')).toBe('CN');
      expect(url.searchParams.get('primary_release_date.gte')).toBe('2020-01-01');
      expect(url.searchParams.get('primary_release_date.lte')).toBe('2029-12-31');
      expect(url.searchParams.get('sort_by')).toBe('popularity.desc');
    }
  });

  it('returns up to 60 items for the default first batch and exposes the next cursor', async () => {
    process.env.TMDB_API_KEY = 'test-api-key';
    const calls: URL[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      calls.push(url);
      const pageNumber = Number(url.searchParams.get('page'));
      const results = Array.from({ length: 20 }, (_, index) => result((pageNumber - 1) * 20 + index + 1));
      return page(pageNumber, 4, results);
    }));

    const response = await GET(request('type=movie&list=popular&page=1'));
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.items).toHaveLength(60);
    expect(data).toMatchObject({ page: 1, totalPages: 4, nextPage: 4 });
    expect(calls.map((url) => url.searchParams.get('page')).sort()).toEqual(['1', '2', '3']);
  });

  it('uses JP-or-KR and TV premiere years with a real popularity threshold for high ratings', async () => {
    process.env.TMDB_API_KEY = 'test-api-key';
    const calls: URL[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      calls.push(url);
      return page(Number(url.searchParams.get('page')), 1, [result(9, '2015-01-02')]);
    }));

    const response = await GET(request('type=tv&list=top_rated&page=1&region=JP_KR&era=2010s'));
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.items[0]).toMatchObject({ id: 9, year: '2015' });
    expect(data.nextPage).toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls[0].pathname).toBe('/3/discover/tv');
    expect(calls[0].searchParams.get('with_origin_country')).toBe('JP|KR');
    expect(calls[0].searchParams.get('first_air_date.gte')).toBe('2010-01-01');
    expect(calls[0].searchParams.get('first_air_date.lte')).toBe('2019-12-31');
    expect(calls[0].searchParams.get('sort_by')).toBe('vote_average.desc');
    expect(calls[0].searchParams.get('vote_count.gte')).toBe('100');
  });

  it('does not advance or cache a failed batch; retry requests the same page range', async () => {
    process.env.TMDB_API_KEY = 'test-api-key';
    const pageCalls: number[] = [];
    let failed = false;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const pageNumber = Number(url.searchParams.get('page'));
      pageCalls.push(pageNumber);
      if (pageNumber === 2 && !failed) {
        failed = true;
        return new Response('temporary failure', { status: 503 });
      }
      return page(pageNumber, 4, [result(pageNumber)]);
    }));

    const first = await GET(request('type=movie&list=popular&page=1&region=all&era=all'));
    expect(first.status).toBe(502);
    const retry = await GET(request('type=movie&list=popular&page=1&region=all&era=all'));
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ page: 1, nextPage: 4 });
    expect(pageCalls.filter((value) => value === 1)).toHaveLength(2);
    expect(pageCalls.filter((value) => value === 2)).toHaveLength(2);
    expect(pageCalls.filter((value) => value === 3)).toHaveLength(2);
  });

  it('keeps weekly trends unavailable under filters and separates cache entries by filter key', async () => {
    process.env.TMDB_API_KEY = 'test-api-key';
    const calls: URL[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      calls.push(url);
      return page(Number(url.searchParams.get('page')), 1, []);
    }));
    const unsupported = await GET(request('type=movie&list=trending&region=CN&era=all'));
    expect(unsupported.status).toBe(400);
    expect(await GET(request('type=movie&list=popular&page=1&region=CN&era=all'))).toHaveProperty('status', 200);
    expect(await GET(request('type=movie&list=popular&page=1&region=JP&era=all'))).toHaveProperty('status', 200);
    expect(await GET(request('type=movie&list=popular&page=1&region=WESTERN&era=all'))).toHaveProperty('status', 200);
    expect(calls).toHaveLength(3);
    expect(calls.map((url) => url.searchParams.get('with_origin_country'))).toEqual([
      'CN', 'JP', 'US|CA|GB|IE|FR|DE|IT|ES|PT|NL|BE|LU|CH|AT|DK|SE|NO|FI|IS|PL|CZ|GR|RO|HU|UA',
    ]);
  });
});
