import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE, signSession } from '@/lib/auth';

vi.mock('@/lib/fetch-utils', () => ({ fetchUpstream: vi.fn() }));
vi.mock('@/lib/ssrf', () => ({ checkUpstreamAllowed: vi.fn(async () => ({ ok: true })) }));

import { fetchUpstream } from '@/lib/fetch-utils';
import { checkUpstreamAllowed } from '@/lib/ssrf';
import { GET } from './route';

const fetchMock = vi.mocked(fetchUpstream);
const allowMock = vi.mocked(checkUpstreamAllowed);

function makeRequest(search: string, authenticated = true, signal?: AbortSignal): Request {
  const cookie = authenticated ? `${SESSION_COOKIE}=${signSession().token}` : '';
  return new Request(`https://local.test/api/browse/videos?${search}`, { headers: { cookie }, signal });
}

function json(data: unknown): Response {
  return Response.json(data);
}

beforeAll(() => { process.env.PASSWORD = 'browse-test-password'; });
afterEach(() => { vi.resetAllMocks(); allowMock.mockResolvedValue({ ok: true }); });

describe('GET /api/browse/videos filtered paging', () => {
  it('combines real movie category and Mainland area across bounded pages, then resumes by cursor', async () => {
    const calls: URL[] = [];
    fetchMock.mockImplementation(async (url) => {
      const parsed = new URL(String(url));
      calls.push(parsed);
      if (parsed.searchParams.get('ac') === 'list') {
        return json({ class: [{ type_id: 10, type_name: '电影' }, { type_id: 11, type_name: '动作', type_pid: 10 }] });
      }
      const pg = Number(parsed.searchParams.get('pg'));
      const lists: Record<number, unknown[]> = {
        1: [{ vod_id: 1, vod_name: '日本动作片', type_id: 11, type_name: '动作', vod_area: '日本' }],
        2: [{ vod_id: 2, vod_name: '合拍片', type_id: 11, type_name: '动作', vod_area: '中国大陆/香港' }],
        3: [{ vod_id: 3, vod_name: '大陆综艺', type_id: 30, type_name: '综艺', vod_area: '大陆' }],
        4: [{ vod_id: 4, vod_name: '内地电影', type_id: 11, type_name: '动作', vod_area: '内地' }],
        5: [{ vod_id: 5, vod_name: '美国电影', type_id: 11, type_name: '动作', vod_area: '美国' }],
      };
      return json({ pagecount: 5, total: 500, list: lists[pg] || [] });
    });

    const first = await GET(makeRequest('source=https%3A%2F%2Fcms.test%2Fapi.php%3Ftoken%3Dkeep%26t%3Dold%26ac%3Dold%26pg%3D99&kind=movie&area=%E5%A4%A7%E9%99%86'));
    expect(first.status).toBe(200);
    const firstData = await first.json();
    expect(firstData.list.map((item: { vodId: string }) => item.vodId)).toEqual(['2']);
    expect(firstData).toMatchObject({ total: 0, filtered: true, scannedPages: 3, nextPage: 4 });
    expect(calls.filter((url) => url.searchParams.get('ac') === 'videolist')).toHaveLength(3);
    expect(calls.at(-1)?.searchParams.get('token')).toBe('keep');
    expect(calls.at(-1)?.searchParams.get('t')).toBeNull();
    expect(calls.at(-1)?.searchParams.get('ac')).toBe('videolist');
    expect(calls.at(-1)?.searchParams.get('pg')).toBe('3');

    const second = await GET(makeRequest('source=https%3A%2F%2Fcms.test%2Fapi.php%3Ftoken%3Dkeep&kind=movie&area=%E5%A4%A7%E9%99%86&pg=4'));
    const secondData = await second.json();
    expect(secondData.list.map((item: { vodId: string }) => item.vodId)).toEqual(['4']);
    expect(secondData.scannedPages).toBe(2);
    expect(secondData.nextPage).toBeNull();
  });

  it('continues past an empty page when pagecount confirms more pages', async () => {
    fetchMock.mockImplementation(async (url) => {
      const parsed = new URL(String(url));
      if (parsed.searchParams.get('ac') === 'list') return json({ class: [] });
      const pg = Number(parsed.searchParams.get('pg'));
      return json({ pagecount: 4, list: pg === 3 ? [{ vod_id: 8, vod_name: '动作片', type_name: '动作片', vod_area: '大陆' }] : [] });
    });
    const response = await GET(makeRequest('source=https%3A%2F%2Fempty-page.test%2Fapi.php&kind=movie&area=%E5%A4%A7%E9%99%86'));
    const data = await response.json();
    expect(data.list).toHaveLength(1);
    expect(data.scannedPages).toBe(3);
    expect(data.nextPage).toBe(4);
  });

  it('returns an empty filtered batch with a cursor so the UI can continue searching', async () => {
    fetchMock.mockImplementation(async (url) => {
      const parsed = new URL(String(url));
      if (parsed.searchParams.get('ac') === 'list') return json({ class: [] });
      return json({ pagecount: 5, list: [] });
    });
    const response = await GET(makeRequest('source=https%3A%2F%2Fempty-batch.test%2Fapi.php&area=%E5%A4%A7%E9%99%86'));
    expect(await response.json()).toMatchObject({ list: [], nextPage: 4, scannedPages: 3 });
  });

  it('uses an empty page as the explicit stop rule when pagecount is missing', async () => {
    fetchMock.mockImplementation(async (url) => {
      const parsed = new URL(String(url));
      if (parsed.searchParams.get('ac') === 'list') return json({ class: [] });
      const pg = Number(parsed.searchParams.get('pg'));
      return json({ list: pg === 1 ? [{ vod_id: 1, vod_name: '动作片', type_name: '动作片', vod_area: '大陆' }] : [] });
    });
    const response = await GET(makeRequest('source=https%3A%2F%2Fno-pagecount.test%2Fapi.php&kind=movie&area=%E5%A4%A7%E9%99%86'));
    expect((await response.json()).nextPage).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(3); // categories plus video pages 1 and 2
  });

  it('keeps the original unfiltered pagination and rejects unauthenticated or SSRF targets', async () => {
    fetchMock.mockResolvedValue(json({ list: [{ vod_id: 1, vod_name: '条目' }], pagecount: 7, total: 123 }));
    const ordinary = await GET(makeRequest('source=https%3A%2F%2Fplain.test%2Fapi.php%3Fx%3D1&pg=2'));
    expect(await ordinary.json()).toMatchObject({ total: 123, page: 2, pagecount: 7, filtered: false });
    expect(new URL(String(fetchMock.mock.calls[0][0])).searchParams.get('x')).toBe('1');
    const unauthorized = await GET(makeRequest('source=https%3A%2F%2Fplain.test%2Fapi.php', false));
    expect(unauthorized.status).toBe(401);
    allowMock.mockResolvedValueOnce({ ok: false, reason: 'blocked' } as never);
    const blocked = await GET(makeRequest('source=https%3A%2F%2Fblocked.test%2Fapi.php'));
    expect(blocked.status).toBe(400);
  });

  it('passes client abort through to the upstream request', async () => {
    const controller = new AbortController();
    fetchMock.mockImplementation(async (url, options) => {
      const parsed = new URL(String(url));
      if (parsed.searchParams.get('ac') === 'list') return json({ class: [] });
      controller.abort();
      expect(options?.signal?.aborted).toBe(true);
      throw new DOMException('Aborted', 'AbortError');
    });
    const response = await GET(makeRequest('source=https%3A%2F%2Fabort.test%2Fapi.php&kind=movie', true, controller.signal));
    expect(response.status).toBe(499);
  });
});
