import { describe, expect, it } from 'vitest';
import type { SearchResultItem } from './types';
import { areaMatches, classifyCategories, getAreaOptions, matchesBrowseKind } from './browse-filters';

const categories = [
  { type_id: 1, type_name: '电影' },
  { type_id: 11, type_name: '动作', type_pid: 1 },
  { type_id: 12, type_name: '喜剧片', type_pid: 1 },
  { type_id: 2, type_name: '电视剧' },
  { type_id: 3, type_name: '综艺' },
  { type_id: 4, type_name: '动漫' },
  { type_id: 5, type_name: '短剧' },
  { type_id: 99, type_name: '专题' },
];

describe('browse category and area filters', () => {
  it('inherits explicit source movie parent while leaving unknown categories unclassified', () => {
    const kinds = classifyCategories(categories);
    expect(kinds.get(11)).toBe('movie');
    expect(kinds.get(12)).toBe('movie');
    expect(kinds.has(99)).toBe(false);
    const makeItem = (typeId: number, typeName?: string) => ({ typeId, typeName } as SearchResultItem);
    expect(matchesBrowseKind(makeItem(11), 'movie', categories)).toBe(true);
    expect(matchesBrowseKind(makeItem(99, '专题'), 'movie', categories)).toBe(false);
    expect(matchesBrowseKind({ typeName: '动作片' } as SearchResultItem, 'movie', categories)).toBe(true);
    expect(matchesBrowseKind({ typeName: '专题' } as SearchResultItem, 'movie', categories)).toBe(false);
    expect(matchesBrowseKind({ typeRootId: 1, typeName: '动画' } as SearchResultItem, 'movie', categories)).toBe(true);
    expect(matchesBrowseKind({ typeName: '动画电影' } as SearchResultItem, 'movie', [])).toBe(true);
    expect(matchesBrowseKind({ typeName: '香港剧' } as SearchResultItem, 'tv', [])).toBe(true);
    expect(matchesBrowseKind({ typeName: '日剧' } as SearchResultItem, 'tv', [])).toBe(true);
  });

  it('normalizes Mainland aliases and splits co-production regions without accepting missing areas', () => {
    expect(areaMatches('中国大陆/香港', '大陆')).toBe(true);
    expect(areaMatches('中国内地,美国', '大陆')).toBe(true);
    expect(areaMatches('中国香港', '香港')).toBe(true);
    expect(areaMatches(undefined, '大陆')).toBe(false);
    expect(areaMatches('加拿大', '加拿大')).toBe(true);
    expect(getAreaOptions([{ area: '加拿大/中国大陆' } as SearchResultItem])).toContain('加拿大');
  });
});
