import { describe, expect, it, vi } from 'vitest';
import type { SourceConfig } from './types';
vi.mock('./db', () => ({
  db: {}, clearLiveProbeResultsDb: vi.fn(async () => {}),
  loadLiveProbeResults: vi.fn(async () => ({})), saveLiveProbeResults: vi.fn(async () => {}),
}));
import { subKeyPrefix } from './store';
import { getBrowsableSources } from './browse-sources';

const env: SourceConfig = { key: 'env_1', name: '环境源', url: 'https://a.example/vod' };
const manual: SourceConfig = { key: 'custom_1', name: '手动源', url: 'https://b.example/vod' };
const adult: SourceConfig = { key: 'custom_2', name: '成人源', url: 'https://c.example/vod', isAdult: true };
const url = 'https://example.com/subs.json';
const subscriptionSource: SourceConfig = { key: subKeyPrefix(url) + '_0', name: '订阅源', url: 'https://d.example/vod' };

const defaults = () => ({
  envSources: [env], customAPIs: [manual, adult, subscriptionSource],
  selectedKeys: [env.key, manual.key, adult.key, subscriptionSource.key],
  subscriptions: [{ url }], yellowFilter: false,
});

describe('getBrowsableSources', () => {
  it('已添加且勾选的预置/手动/订阅源均可出现', () => {
    expect(getBrowsableSources(defaults()).map((s) => s.key)).toEqual(
      [env.key, manual.key, adult.key, subscriptionSource.key]
    );
  });
  it('取消勾选立即消失', () => {
    expect(getBrowsableSources({ ...defaults(), selectedKeys: [manual.key] })).toEqual([manual]);
  });
  it('成人过滤仅移除成人源', () => {
    expect(getBrowsableSources({ ...defaults(), yellowFilter: true })).not.toContain(adult);
  });
  it('订阅总开关禁用时移除其源，但仍显示手动源', () => {
    const state = { ...defaults(), subscriptions: [{ url, enabled: false }] };
    expect(getBrowsableSources(state).map((s) => s.key)).toEqual([env.key, manual.key, adult.key]);
  });
  it('重复 URL 只出现一次（预置源优先）', () => {
    const state = defaults();
    state.customAPIs = [{ ...manual, url: env.url + '/' }];
    expect(getBrowsableSources(state)).toEqual([env]);
  });
  it('全部关闭时为空，由页面提示去源管理开启', () => {
    expect(getBrowsableSources({ ...defaults(), selectedKeys: [] })).toEqual([]);
  });
});
