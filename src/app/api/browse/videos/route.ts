import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/api-guard';
import { cmsRequestHeaders, parseSearchList } from '@/lib/cms-parser';
import { fetchUpstream } from '@/lib/fetch-utils';
import { checkUpstreamAllowed } from '@/lib/ssrf';
import type { SearchResultItem } from '@/lib/types';

export const runtime = 'nodejs';

export interface BrowseVideosResponse {
  list: SearchResultItem[];
  total: number;
  page: number;
  pagecount: number;
}

/**
 * 片源分类视频列表：GET /api/browse/videos?source=<片源URL>&t=<type_id>&pg=<页码>
 * t 缺省时返回该源最新全部（?ac=videolist 不带 t 参数）。
 * 返回 {list, total, page, pagecount}，list 为标准 SearchResultItem，可直接用于详情弹窗。
 */
export async function GET(req: Request) {
  const guarded = guardRequest(req);
  if (guarded) return guarded;

  const params = new URL(req.url).searchParams;
  const source = params.get('source')?.trim() || '';
  if (!/^https?:\/\//.test(source)) {
    return NextResponse.json({ error: '片源地址无效' }, { status: 400 });
  }
  const verdict = await checkUpstreamAllowed(source);
  if (!verdict.ok) {
    return NextResponse.json({ error: verdict.reason }, { status: 400 });
  }

  const t = params.get('t')?.trim() || '';
  const pg = Math.max(1, parseInt(params.get('pg') || '1', 10) || 1);

  const base = source.replace(/\/+$/, '');
  const api = t
    ? `${base}?ac=videolist&t=${encodeURIComponent(t)}&pg=${pg}`
    : `${base}?ac=videolist&pg=${pg}`;

  try {
    const res = await fetchUpstream(api, {
      timeoutMs: 10000,
      headers: cmsRequestHeaders(),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as Record<string, unknown>;

    // 用源地址当 key/name 兜底：详情弹窗靠 sourceUrl 回填真实源
    const list = parseSearchList(data, { key: base, name: '片源', url: base });
    const total = parseInt(String(data.total ?? '0'), 10) || 0;
    const pagecount = parseInt(String(data.pagecount ?? '1'), 10) || 1;

    const payload: BrowseVideosResponse = {
      list,
      total: Number.isFinite(total) ? total : 0,
      page: pg,
      pagecount: Number.isFinite(pagecount) && pagecount > 0 ? pagecount : 1,
    };
    return NextResponse.json(payload);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '获取视频列表失败' },
      { status: 502 }
    );
  }
}
