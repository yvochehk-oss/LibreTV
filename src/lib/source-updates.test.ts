import { describe, expect, it } from 'vitest';
import { groupSourceUpdates, parseSourceTimestamp, type SourceUpdateItem } from './source-updates';

function item(overrides: Partial<SourceUpdateItem> = {}): SourceUpdateItem {
  return {
    sourceKey: 'source-a',
    sourceName: 'Source A',
    vodId: '1',
    name: 'Example Movie',
    year: '2025',
    typeName: '电影',
    browseKind: 'movie',
    ...overrides,
  };
}

describe('source update normalization and grouping', () => {
  it('parses CMS date strings and Unix timestamps without using release years', () => {
    expect(parseSourceTimestamp('2026-10-24 12:30:00')).toBe(Date.parse('2026-10-24T12:30:00'));
    expect(parseSourceTimestamp('1792845000')).toBe(1_792_845_000_000);
    expect(parseSourceTimestamp('not a date')).toBeUndefined();
    expect(parseSourceTimestamp(undefined)).toBeUndefined();
  });

  it('deduplicates repeated source IDs and merges only matching explicit title, year, and kind', () => {
    const groups = groupSourceUpdates([
      item({ sourceUpdatedAt: 1000 }),
      item({ sourceUpdatedAt: 1000 }),
      item({ sourceKey: 'source-b', sourceName: 'Source B', vodId: '2', sourceUpdatedAt: 2000 }),
      item({ sourceKey: 'source-c', sourceName: 'Source C', vodId: '3', year: '2024' }),
      item({ sourceKey: 'source-d', sourceName: 'Source D', vodId: '4', typeName: '专题', browseKind: undefined }),
    ]);
    expect(groups).toHaveLength(3);
    expect(groups[0].items.map((entry) => entry.sourceKey)).toEqual(['source-a', 'source-b']);
    expect(groups[0].latestAt).toBe(2000);
    expect(groups.some((group) => group.items.some((entry) => entry.sourceKey === 'source-c'))).toBe(true);
    expect(groups.some((group) => group.items.some((entry) => entry.sourceKey === 'source-d'))).toBe(true);
  });

  it('does not treat placeholder or implausible years as reliable cross-source identity', () => {
    const groups = groupSourceUpdates([
      item({ sourceKey: 'source-a', vodId: 'a', year: '未知' }),
      item({ sourceKey: 'source-b', vodId: 'b', year: '未知' }),
      item({ sourceKey: 'source-c', vodId: 'c', year: '0' }),
      item({ sourceKey: 'source-d', vodId: 'd', year: '3025' }),
    ]);
    expect(groups).toHaveLength(4);
    expect(groups.every((group) => group.items.length === 1 && group.year === undefined)).toBe(true);
  });

  it('sorts by update time before add time, and interleaves entries whose sources omit times', () => {
    const groups = groupSourceUpdates([
      item({ sourceKey: 'a', vodId: 'a1', sourceAddedAt: 100, sourceUpdatedAt: 300 }),
      item({ sourceKey: 'a', vodId: 'a2', sourceAddedAt: 200 }),
      item({ sourceKey: 'a', vodId: 'a3' }),
      item({ sourceKey: 'a', vodId: 'a4' }),
      item({ sourceKey: 'b', vodId: 'b1', name: 'Another Movie' }),
    ]);
    expect(groups.slice(0, 2).map((group) => group.latestAt)).toEqual([300, 200]);
    expect(groups.slice(2).map((group) => group.items[0].sourceKey)).toEqual(['a', 'b', 'a']);
  });
});
