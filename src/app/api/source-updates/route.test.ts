import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE, signSession } from '@/lib/auth';

vi.mock('@/lib/fetch-utils', () => ({ fetchUpstream: vi.fn() }));
vi.mock('@/lib/ssrf', () => ({ checkUpstreamAllowed: vi.fn(async () => ({ ok: true })) }));

import { fetchUpstream } from '@/lib/fetch-utils';
import { checkUpstreamAllowed } from '@/lib/ssrf';
import { POST } from './route';

const fetchMock = vi.mocked(fetchUpstream);
const allowMock = vi.mocked(checkUpstreamAllowed);

function request(body: unknown, authenticated = true): Request {
  const cookie = authenticated ? `${SESSION_COOKIE}=${signSession().token}` : '';
  return new Request('https://local.test/api/source-updates', {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

const source = { key: 'one', name: 'Source One', url: 'https://cms.test/api.php/provide/vod?token=kept' };

beforeAll(() => { process.env.PASSWORD = 'source-updates-test-password'; });
afterEach(() => { vi.resetAllMocks(); allowMock.mockResolvedValue({ ok: true }); });

describe('POST /api/source-updates', () => {
  it('prefers ac=detail, preserves source parameters, and normalizes update timestamps', async () => {
    const calls: URL[] = [];
    fetchMock.mockImplementation(async (url) => {
      const parsed = new URL(String(url));
      calls.push(parsed);
      if (parsed.searchParams.get('ac') === 'list') return json({ class: [{ type_id: 10, type_name: '电影' }, { type_id: 11, type_name: '动作', type_pid: 10 }] });
      return json({ code: 1, pagecount: 1, list: [{ vod_id: 'm1', vod_name: 'Movie', vod_year: '2024', type_id: 11, type_name: '动作', vod_time_add: '2026-10-20 10:00:00', vod_time: '2026-10-24 10:00:00' }] });
    });

    const response = await POST(request({ sources: [source] }));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.items).toHaveLength(1);
    expect(data.items[0]).toMatchObject({ sourceAddedAt: Date.parse('2026-10-20T10:00:00'), sourceUpdatedAt: Date.parse('2026-10-24T10:00:00'), browseKind: 'movie' });
    expect(data.nextCursor).toBeNull();
    expect(calls.some((url) => url.searchParams.get('ac') === 'detail')).toBe(true);
    expect(calls.some((url) => url.searchParams.get('ac') === 'videolist')).toBe(false);
    expect(calls.find((url) => url.searchParams.get('ac') === 'detail')?.searchParams.get('token')).toBe('kept');
  });

  it('falls back once to videolist for a CMS that rejects detail mode', async () => {
    const modes: string[] = [];
    fetchMock.mockImplementation(async (url) => {
      const mode = new URL(String(url)).searchParams.get('ac') || '';
      modes.push(mode);
      if (mode === 'list') return json({ class: [] });
      if (mode === 'detail') return json({ code: 0, msg: 'unsupported mode' });
      return json({ code: 1, pagecount: 1, list: [{ vod_id: 'v1', vod_name: 'Fallback Movie', vod_time: '2026-10-24 12:00:00' }] });
    });

    const response = await POST(request({ sources: [source] }));
    expect(response.status).toBe(200);
    expect((await response.json()).items[0].name).toBe('Fallback Movie');
    expect(modes.filter((mode) => mode === 'detail')).toHaveLength(1);
    expect(modes.filter((mode) => mode === 'videolist')).toHaveLength(1);
  });

  it('returns bounded source continuation and isolates failures', async () => {
    const sources = Array.from({ length: 8 }, (_, index) => ({ ...source, key: `s${index}`, name: `Source ${index}`, url: `https://cms${index}.test/api.php` }));
    fetchMock.mockImplementation(async (url) => {
      const parsed = new URL(String(url));
      if (parsed.hostname === 'cms1.test' && parsed.searchParams.get('ac') === 'detail') return json({ code: 0, msg: 'bad' });
      if (parsed.hostname === 'cms1.test' && parsed.searchParams.get('ac') === 'videolist') return json({ code: 0, msg: 'bad' });
      if (parsed.searchParams.get('ac') === 'list') return json({ class: [] });
      return json({ code: 1, pagecount: 1, list: [{ vod_id: parsed.hostname, vod_name: parsed.hostname }] });
    });

    const response = await POST(request({ sources }));
    const data = await response.json();
    expect(data.scannedSources).toBe(6);
    expect(data.totalSources).toBe(8);
    expect(data.nextCursor).toEqual({ sourceOffset: 6, pendingPages: [{ sourceIndex: 1, page: 1 }] });
    expect(data.items).toHaveLength(5);
    expect(data.failedSources).toHaveLength(1);
  });

  it('requires authentication and checks source URLs before fetching', async () => {
    expect((await POST(request({ sources: [source] }, false))).status).toBe(401);
    allowMock.mockResolvedValueOnce({ ok: false, reason: 'blocked' } as never);
    const response = await POST(request({ sources: [source] }));
    expect((await response.json()).failedSources).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not request a source marked adult when the adult filter is enabled', async () => {
    const adultSource = { ...source, key: 'adult', isAdult: true };
    const response = await POST(request({ sources: [adultSource], filterAdult: true }));
    const data = await response.json();
    expect(data.totalSources).toBe(0);
    expect(data.items).toHaveLength(0);
    expect(data.nextCursor).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('continues after a zero-match movie page and stops an exhausted source', async () => {
    const pages: string[] = [];
    const pagedSource = { ...source, key: 'paged', url: 'https://paged-source.test/api.php' };
    fetchMock.mockImplementation(async (url) => {
      const parsed = new URL(String(url));
      const mode = parsed.searchParams.get('ac');
      if (mode === 'list') return json({ class: [{ type_id: 1, type_name: '电影' }, { type_id: 2, type_name: '电视剧' }] });
      if (mode === 'detail') {
        const pg = parsed.searchParams.get('pg') || '1';
        pages.push(pg);
        return pg === '1'
          ? json({ code: 1, pagecount: 2, list: [{ vod_id: 'tv1', vod_name: 'Drama', type_id: 2, type_name: '电视剧' }] })
          : json({ code: 1, pagecount: 2, list: [{ vod_id: 'movie1', vod_name: 'Movie', type_id: 1, type_name: '电影' }] });
      }
      throw new Error('Unexpected fallback');
    });

    const first = await POST(request({ sources: [pagedSource], kind: 'movie' }));
    const firstData = await first.json();
    expect(firstData.items).toHaveLength(0);
    expect(firstData.nextCursor).toEqual({ sourceOffset: 1, pendingPages: [{ sourceIndex: 0, page: 2 }] });
    expect(firstData.sourceStates[0]).toMatchObject({ page: 1, status: 'more', matchingCount: 0 });

    const second = await POST(request({ sources: [pagedSource], kind: 'movie', cursor: firstData.nextCursor }));
    const secondData = await second.json();
    expect(secondData.items.map((item: { vodId: string }) => item.vodId)).toEqual(['movie1']);
    expect(secondData.nextCursor).toBeNull();
    expect(secondData.sourceStates[0].status).toBe('exhausted');
    expect(pages).toEqual(['1', '2']);
  });

  it('caps a continuing source at five pages and reports that it was truncated', async () => {
    const cappedSource = { ...source, key: 'cap', url: 'https://cap-source.test/api.php' };
    fetchMock.mockImplementation(async (url) => {
      const parsed = new URL(String(url));
      if (parsed.searchParams.get('ac') === 'list') return json({ class: [] });
      return json({ code: 1, pagecount: 20, list: [{ vod_id: `p${parsed.searchParams.get('pg')}`, vod_name: 'Item' }] });
    });

    let cursor: unknown = null;
    let data: Record<string, unknown> = {};
    for (let page = 1; page <= 5; page++) {
      const response = await POST(request({ sources: [cappedSource], cursor }));
      data = await response.json();
      cursor = data.nextCursor;
    }
    expect(data.sourceStates).toMatchObject([{ page: 5, status: 'page-limit' }]);
    expect(data.nextCursor).toBeNull();
  });

  it('stops on an empty page even when the source reports later pages', async () => {
    const emptySource = { ...source, key: 'empty', url: 'https://empty-late-page.test/api.php' };
    fetchMock.mockImplementation(async (url) => {
      const parsed = new URL(String(url));
      if (parsed.searchParams.get('ac') === 'list') return json({ class: [] });
      return json({ code: 1, pagecount: 9, list: [] });
    });

    const response = await POST(request({ sources: [emptySource] }));
    const data = await response.json();
    expect(data.nextCursor).toBeNull();
    expect(data.sourceStates).toMatchObject([{ page: 1, status: 'exhausted' }]);
  });

  it('normalizes cursor indexes/pages and retains only one pending page per source', async () => {
    const pages: string[] = [];
    const pagedSource = { ...source, key: 'cursor', url: 'https://cursor-normalize.test/api.php' };
    fetchMock.mockImplementation(async (url) => {
      const parsed = new URL(String(url));
      if (parsed.searchParams.get('ac') === 'list') return json({ class: [] });
      pages.push(parsed.searchParams.get('pg') || '');
      return json({ code: 1, pagecount: 4, list: [{ vod_id: 'x', vod_name: 'X' }] });
    });

    const response = await POST(request({
      sources: [pagedSource],
      cursor: { sourceOffset: '1', pendingPages: [{ sourceIndex: '0', page: '2' }, { sourceIndex: 0, page: 3 }] },
    }));
    const data = await response.json();
    expect(pages).toEqual(['2']);
    expect(data.sourceStates).toMatchObject([{ page: 2, status: 'more' }]);
    expect(data.nextCursor).toEqual({ sourceOffset: 1, pendingPages: [{ sourceIndex: 0, page: 3 }] });
  });

  it('alternates continuation pages with newly encountered sources', async () => {
    const sources = Array.from({ length: 9 }, (_, index) => ({ ...source, key: `round${index}`, name: `Round ${index}`, url: `https://round${index}.test/api.php` }));
    fetchMock.mockImplementation(async (url) => {
      const parsed = new URL(String(url));
      if (parsed.searchParams.get('ac') === 'list') return json({ class: [] });
      return json({ code: 1, pagecount: 4, list: [{ vod_id: parsed.searchParams.get('pg'), vod_name: parsed.hostname }] });
    });

    const first = await POST(request({ sources }));
    const firstData = await first.json();
    const second = await POST(request({ sources, cursor: firstData.nextCursor }));
    const secondData = await second.json();
    expect(secondData.sourceStates).toHaveLength(6);
    expect(secondData.sourceStates.map((state: { page: number }) => state.page)).toEqual([2, 1, 2, 1, 2, 1]);
    expect(secondData.nextCursor?.sourceOffset).toBe(9);
  });
});
