import type { SearchResultItem } from './types';

export const BROWSE_KINDS = [
  { id: 'movie', label: '电影' },
  { id: 'tv', label: '电视剧' },
  { id: 'variety', label: '综艺' },
  { id: 'anime', label: '动漫' },
  { id: 'short', label: '短剧' },
] as const;

export type BrowseKind = (typeof BROWSE_KINDS)[number]['id'];
export interface BrowseCategoryLike {
  type_id: number;
  type_name: string;
  type_pid?: number;
}

export const COMMON_AREAS = ['大陆', '香港', '台湾', '日本', '韩国', '美国', '英国', '法国', '泰国', '印度', '其他'];

const AREA_ALIASES: Record<string, string> = {
  大陆: '大陆', 中国大陆: '大陆', 内地: '大陆', 中国内地: '大陆', 大陆地区: '大陆', 中国: '大陆',
  香港: '香港', 中国香港: '香港', 香港地区: '香港', 香港特别行政区: '香港',
  台湾: '台湾', 中国台湾: '台湾', 台湾地区: '台湾',
  日本: '日本', 韩国: '韩国', 南韩: '韩国', 美国: '美国', 美国地区: '美国',
  英国: '英国', 法国: '法国', 泰国: '泰国', 印度: '印度', 其他: '其他', 其他地区: '其他',
};

function compact(s: string): string {
  return s.trim().replace(/[\s\u3000]/g, '').toLowerCase();
}

export function directKind(name: string): BrowseKind | undefined {
  const n = compact(name);
  if (/(微短剧|短剧)/.test(n)) return 'short';
  if (/(电影|影片)/.test(n)) return 'movie';
  if (/(综艺|真人秀)/.test(n)) return 'variety';
  if (/(电视剧|电视连续剧|连续剧|国产剧|港台剧|香港剧|台湾剧|日韩剧|日剧|韩剧|日本剧|韩国剧|欧美剧|海外剧)/.test(n)) return 'tv';
  if (/(动漫|番剧|动画)/.test(n)) return 'anime';
  if (/^(动作|喜剧|爱情|科幻|剧情|悬疑|犯罪|战争|恐怖|纪录|冒险|奇幻|家庭|灾难|武侠|运动|音乐|传记|历史)片$/.test(n)) return 'movie';
  return undefined;
}

/** Classifies only from explicit source names or an explicit known parent chain. */
export function classifyCategories<T extends BrowseCategoryLike>(categories: T[]): Map<number, BrowseKind> {
  const byId = new Map(categories.map((category) => [category.type_id, category]));
  const result = new Map<number, BrowseKind>();
  const resolve = (category: BrowseCategoryLike, path = new Set<number>()): BrowseKind | undefined => {
    const cached = result.get(category.type_id);
    if (cached) return cached;
    if (path.has(category.type_id)) return undefined;
    const next = new Set(path).add(category.type_id);
    const parent = category.type_pid ? byId.get(category.type_pid) : undefined;
    const inherited = parent ? resolve(parent, next) : undefined;
    return inherited ?? directKind(category.type_name);
  };
  for (const category of categories) {
    const kind = resolve(category);
    if (kind) result.set(category.type_id, kind);
  }
  return result;
}

export function getKindTypeIds(categories: BrowseCategoryLike[], kind: BrowseKind): number[] {
  const kinds = classifyCategories(categories);
  return categories.filter((category) => kinds.get(category.type_id) === kind).map((category) => category.type_id);
}

export function getKnownKinds(categories: BrowseCategoryLike[]): BrowseKind[] {
  const kinds = classifyCategories(categories);
  return BROWSE_KINDS.map((item) => item.id).filter((kind) => [...kinds.values()].includes(kind));
}

export function matchesKind(item: SearchResultItem, kindIds: number[], categories: BrowseCategoryLike[]): boolean {
  if (kindIds.length === 0) return false;
  const ids = new Set(kindIds);
  if (item.typeId) return ids.has(item.typeId);
  const byName = new Map(categories.map((category) => [compact(category.type_name), category.type_id]));
  const fallbackId = item.typeName ? byName.get(compact(item.typeName)) : undefined;
  return fallbackId !== undefined && ids.has(fallbackId);
}

export function normalizeAreaToken(token: string): string | undefined {
  return AREA_ALIASES[compact(token)];
}

export function areaMatches(value: string | undefined, selectedArea: string): boolean {
  if (!value?.trim()) return false;
  const parts = value.split(/[,，、/／|｜;；]+/).map((part) => part.trim()).filter(Boolean);
  const candidates = parts.length > 1 ? parts : [value.trim()];
  const selected = normalizeAreaToken(selectedArea) ?? compact(selectedArea);
  return candidates.some((candidate) => (normalizeAreaToken(candidate) ?? compact(candidate)) === selected);
}

export function getAreaOptions(items: Pick<SearchResultItem, 'area'>[]): string[] {
  const seen = new Set<string>(COMMON_AREAS);
  for (const item of items) {
    const area = item.area?.trim();
    if (!area) continue;
    const parts = area.split(/[,，、/／|｜;；]+/).map((part) => part.trim()).filter(Boolean);
    for (const part of parts) {
      const known = normalizeAreaToken(part);
      if (known) seen.add(known);
      else seen.add(part.trim());
    }
  }
  return [...seen];
}

export function matchesBrowseKind(item: SearchResultItem, kind: BrowseKind, categories: BrowseCategoryLike[]): boolean {
  const classification = classifyCategories(categories);
  const classified = item.typeId ? classification.get(item.typeId) : undefined;
  if (classified) return classified === kind;
  const root = item.typeRootId ? classification.get(item.typeRootId) : undefined;
  if (root) return root === kind;
  return Boolean(item.typeName && directKind(item.typeName) === kind);
}

export function createBrowseKindMatcher(categories: BrowseCategoryLike[], kind: BrowseKind): (item: SearchResultItem) => boolean {
  const classification = classifyCategories(categories);
  return (item) => {
    const typeKind = item.typeId ? classification.get(item.typeId) : undefined;
    if (typeKind) return typeKind === kind;
    const rootKind = item.typeRootId ? classification.get(item.typeRootId) : undefined;
    if (rootKind) return rootKind === kind;
    return Boolean(item.typeName && directKind(item.typeName) === kind);
  };
}
