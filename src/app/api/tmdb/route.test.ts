import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE, signSession } from '@/lib/auth';
import { clearTmdbCacheForTests } from '@/lib/tmdb';

import { GET } from './route';

function request(query = '', authenticated = true): Request {
  const cookie = authenticated ? `${SESSION_COOKIE}=${signSession().token}` : '';
  return new Request(`https://local.test/api/tmdb${query}`, { headers: { cookie } });
}

beforeAll(() => { process.env.PASSWORD = 'tmdb-route-test-password'; });
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.TMDB_API_KEY;
  delete process.env.TMDB_API_READ_ACCESS_TOKEN;
  clearTmdbCacheForTests();
});

describe('GET /api/tmdb', () => {
  it('requires authentication and reports missing server credentials clearly', async () => {
    expect((await GET(request('', false))).status).toBe(401);
    delete process.env.TMDB_API_KEY;
    delete process.env.TMDB_API_READ_ACCESS_TOKEN;
    const response = await GET(request());
    expect(response.status).toBe(424);
    expect(await response.json()).toMatchObject({ configured: false, error: expect.stringContaining('TMDB') });
  });

  it('bounds page size, maps movie data, and caches the same request', async () => {
    process.env.TMDB_API_KEY = 'test-api-key';
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      expect(url.hostname).toBe('api.themoviedb.org');
      expect(url.pathname).toBe('/3/movie/top_rated');
      expect(url.searchParams.get('language')).toBe('zh-CN');
      expect(url.searchParams.get('page')).toBe('500');
      return Response.json({ page: 500, total_pages: 600, total_results: 12000, results: [{ id: 321, title: '测试电影', poster_path: '/poster.jpg', release_date: '2025-06-01', vote_average: 8.4 }] });
    });
    vi.stubGlobal('fetch', fetchMock);

    const query = '?type=movie&list=top_rated&page=999';
    const first = await GET(request(query));
    const data = await first.json();
    expect(first.status).toBe(200);
    expect(data).toMatchObject({ configured: true, page: 500, totalPages: 500, items: [{ id: 321, title: '测试电影', year: '2025', rating: '8.4', mediaType: 'movie', cover: 'https://image.tmdb.org/t/p/w342/poster.jpg' }] });

    await GET(request(query));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('supports TV weekly trends with read access token auth and reports upstream errors safely', async () => {
    process.env.TMDB_API_READ_ACCESS_TOKEN = 'test-read-token';
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe('/3/trending/tv/week');
      expect(url.searchParams.get('language')).toBe('zh-CN');
      expect(url.searchParams.has('api_key')).toBe(false);
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer test-read-token');
      return Response.json({ page: 1, total_pages: 2, results: [] });
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await GET(request('?type=tv&list=trending&page=1'));
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ configured: true, page: 1, totalPages: 2, items: [] });

    clearTmdbCacheForTests();
    fetchMock.mockImplementationOnce(async () => new Response('upstream error', { status: 429 }));
    const failed = await GET(request('?type=tv&list=trending&page=2'));
    expect(failed.status).toBe(502);
    expect(await failed.json()).toMatchObject({ configured: true, error: expect.stringContaining('HTTP 429') });
  });
});
