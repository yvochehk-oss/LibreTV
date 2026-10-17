import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/api-guard';
import { cmsRequestHeaders } from '@/lib/cms-parser';
import { fetchUpstream } from '@/lib/fetch-utils';
import { checkUpstreamAllowed } from '@/lib/ssrf';

export const runtime = 'nodejs';

export interface BrowseCategory {
  type_id: number;
  type_name: string;
}

/**
 * 片源分类列表：GET /api/browse/categories?source=<片源URL>
 * 请求 <source>?ac=list，返回该源的分类 [{type_id, type_name}]。
 * type_id 各源不同，必须实时查询，不能写死。
 */
export async function GET(req: Request) {
  const guarded = guardRequest(req);
  if (guarded) return guarded;

  const source = new URL(req.url).searchParams.get('source')?.trim() || '';
  if (!/^https?:\/\//.test(source)) {
    return NextResponse.json({ error: '片源地址无效' }, { status: 400 });
  }
  const verdict = await checkUpstreamAllowed(source);
  if (!verdict.ok) {
    return NextResponse.json({ error: verdict.reason }, { status: 400 });
  }

  const base = source.replace(/\/+$/, '');
  try {
    const res = await fetchUpstream(`${base}?ac=list`, {
      timeoutMs: 10000,
      headers: cmsRequestHeaders(),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { class?: unknown };
    const raw = Array.isArray(data.class) ? data.class : [];
    const categories: BrowseCategory[] = raw
      .map((c) => {
        const item = c as Record<string, unknown>;
        return {
          type_id: parseInt(String(item.type_id ?? ''), 10),
          type_name: String(item.type_name ?? '').trim(),
        };
      })
      .filter((c) => Number.isFinite(c.type_id) && c.type_name.length > 0);
    return NextResponse.json({ categories });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '获取分类失败' },
      { status: 502 }
    );
  }
}
