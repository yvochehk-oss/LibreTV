import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// store.ts 运行时引用 db.ts（IndexedDB），node 测试环境下 mock 掉
vi.mock('./db', () => ({
  db: {},
  clearLiveProbeResultsDb: vi.fn(async () => {}),
  loadLiveProbeResults: vi.fn(async () => ({})),
  saveLiveProbeResults: vi.fn(async () => {}),
}));

// 订阅内容由服务端代理拉取（需登录），测试中直接 mock
vi.mock('./client-api', () => ({
  api: { fetchSourceList: vi.fn() },
}));

import { api } from './client-api';
import { applyEnvPresets, syncStaleSubscriptions } from './subscription-sync';
import { useAppStore } from './store';
import type { AuthStatusResponse, SourceListPayload } from './types';

/**
 * applyEnvPresets 单测：覆盖「首屏未登录时预置订阅 401 静默失败，登录后补跑」这一修复路径。
 * 补跑是否发生由 auth.tsx 负责，这里保证补跑本身是幂等且安全的。
 */

const SUB_URL = 'https://paste.rs/JsI9D';

const status = (over: Partial<AuthStatusResponse> = {}): AuthStatusResponse => ({
  passwordRequired: true,
  verified: false,
  version: 'test',
  defaultSources: [],
  defaultLiveSources: [],
  defaultSubscriptions: [],
  defaultRecommendSource: null,
  defaultImageMode: null,
  ...over,
});

const payload: SourceListPayload = {
  name: 'LibreTV-List',
  sources: [
    { name: '非凡影视', url: 'https://cj.ffzyapi.com/api.php/provide/vod/from/ffm3u8' },
    { name: '如意资源', url: 'https://cj.rycjapi.com/api.php/provide/vod' },
  ],
  liveSources: [],
};

const fetchSourceList = vi.mocked(api.fetchSourceList);

beforeEach(() => {
  vi.clearAllMocks();
  useAppStore.setState({
    customAPIs: [],
    selectedKeys: [],
    envSources: [],
    envKeysSeen: [],
    subscriptions: [],
    envSubsSeen: [],
    liveEnvSources: [],
    liveEnvKeysSeen: [],
    liveSubscriptions: [],
    liveSelectedUrls: [],
    yellowFilter: false,
    recommendSource: 'tmdb',
    recommendSourceTouched: false,
    doubanEnabled: true,
    sourceUpdatesEnabled: true,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('applyEnvPresets', () => {
  it('写入预置点播源与直播源，并自动勾选/启用', async () => {
    await applyEnvPresets(
      status({
        defaultSources: [{ key: 'env_0', name: '预置源', url: 'https://example.com/api.php/provide/vod' }],
        defaultLiveSources: [{ key: 'env_1', name: '预置直播', url: 'https://example.com/list.m3u' }],
      })
    );

    const s = useAppStore.getState();
    expect(s.envSources.map((x) => x.key)).toEqual(['env_0']);
    expect(s.selectedKeys).toContain('env_0');
    expect(s.liveEnvSources.map((x) => x.key)).toEqual(['env_1']);
    expect(s.liveSelectedUrls).toContain('https://example.com/list.m3u');
    // 没有预置订阅时不应触发订阅拉取
    expect(fetchSourceList).not.toHaveBeenCalled();
  });

  it('预置订阅：拉取并导入源，写入订阅条目与 seen 标记', async () => {
    fetchSourceList.mockResolvedValue(payload);

    await applyEnvPresets(status({ defaultSubscriptions: [{ url: SUB_URL, name: 'LibreTV-List' }] }));

    expect(fetchSourceList).toHaveBeenCalledWith(SUB_URL);
    const s = useAppStore.getState();
    expect(s.subscriptions.map((x) => x.url)).toEqual([SUB_URL]);
    expect(s.customAPIs.map((x) => x.url)).toEqual(payload.sources.map((x) => x.url));
    expect(s.customAPIs.map((x) => x.name)).toEqual(['非凡影视', '如意资源']);
    expect(s.envSubsSeen).toContain(SUB_URL);
  });

  it('幂等：已同步（24h 内）的预置订阅补跑时不会重复拉取', async () => {
    fetchSourceList.mockResolvedValue(payload);

    await applyEnvPresets(status({ defaultSubscriptions: [{ url: SUB_URL }] }));
    await applyEnvPresets(status({ defaultSubscriptions: [{ url: SUB_URL }] }));

    expect(fetchSourceList).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().customAPIs).toHaveLength(payload.sources.length);
  });

  it('登录前那次失败的典型形态（401）不会抛出，也不会留下半截数据', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fetchSourceList.mockRejectedValue(new Error('需要登录'));

    await expect(applyEnvPresets(status({ defaultSubscriptions: [{ url: SUB_URL }] }))).resolves.toBeUndefined();

    const s = useAppStore.getState();
    expect(s.subscriptions).toHaveLength(0);
    expect(s.customAPIs).toHaveLength(0);
    // 失败不写 seen：下次（登录成功后的补跑）仍会重试
    expect(s.envSubsSeen).not.toContain(SUB_URL);
    expect(warn).toHaveBeenCalled();
  });

  it('用户删除过的预置订阅不会被重新导入', async () => {
    useAppStore.setState({ envSubsSeen: [SUB_URL] });
    fetchSourceList.mockResolvedValue(payload);

    await applyEnvPresets(status({ defaultSubscriptions: [{ url: SUB_URL }] }));

    expect(fetchSourceList).not.toHaveBeenCalled();
  });
});

describe('applyEnvPresets · DEFAULT_RECOMMEND_SOURCE（issue #918）', () => {
  it('无服务端默认和TMDB凭证时，新装TMDB默认回退到免配置热榜', async () => {
    useAppStore.setState({ recommendSource: 'tmdb', recommendSourceTouched: false });
    await applyEnvPresets(status());
    expect(useAppStore.getState().recommendSource).toBe('hot-list');
    expect(useAppStore.getState().recommendSourceTouched).toBe(false);
  });

  it('对未主动选择过的用户应用部署者默认值，且不打「已选择」标记', async () => {
    useAppStore.setState({ recommendSource: 'hot-list', recommendSourceTouched: false });
    await applyEnvPresets(status({ defaultRecommendSource: 'douban' }));
    expect(useAppStore.getState().recommendSource).toBe('douban');
    // 自动预置不算用户主动选择：部署者日后调整默认值时该用户应跟随
    expect(useAppStore.getState().recommendSourceTouched).toBe(false);
  });

  it('已主动选择过的用户（如 bangumi）不被覆盖', async () => {
    useAppStore.setState({ recommendSource: 'bangumi', recommendSourceTouched: true });
    await applyEnvPresets(status({ defaultRecommendSource: 'douban' }));
    expect(useAppStore.getState().recommendSource).toBe('bangumi');
  });

  it('显式选回 hot-list 的用户（带「已选择」标记）不被覆盖', async () => {
    useAppStore.setState({ recommendSource: 'hot-list', recommendSourceTouched: true });
    await applyEnvPresets(status({ defaultRecommendSource: 'douban' }));
    expect(useAppStore.getState().recommendSource).toBe('hot-list');
  });

  it('旧touched=false无法区分的值视作自动默认，可迁移到部署默认', async () => {
    useAppStore.setState({ recommendSource: 'bangumi', recommendSourceTouched: false });
    await applyEnvPresets(status({ defaultRecommendSource: 'douban' }));
    expect(useAppStore.getState().recommendSource).toBe('douban');
    expect(useAppStore.getState().recommendSourceTouched).toBe(false);
  });

  it('服务端TMDB默认覆盖旧的自动豆瓣，已手动选回豆瓣后则保留', async () => {
    useAppStore.setState({ recommendSource: 'douban', recommendSourceTouched: false });
    await applyEnvPresets(status({ defaultRecommendSource: 'tmdb' }));
    expect(useAppStore.getState().recommendSource).toBe('tmdb');

    useAppStore.getState().updateSettings({ recommendSource: 'douban' });
    await applyEnvPresets(status({ defaultRecommendSource: 'tmdb' }));
    expect(useAppStore.getState().recommendSource).toBe('douban');
    expect(useAppStore.getState().recommendSourceTouched).toBe(true);
  });

  it('应用默认或无key回退时不改动首页总开关和片源更新开关', async () => {
    useAppStore.setState({ recommendSource: 'tmdb', recommendSourceTouched: false, doubanEnabled: false, sourceUpdatesEnabled: false });
    await applyEnvPresets(status());
    expect(useAppStore.getState().recommendSource).toBe('hot-list');
    expect(useAppStore.getState().doubanEnabled).toBe(false);
    expect(useAppStore.getState().sourceUpdatesEnabled).toBe(false);
  });

  it('重复调用幂等：应用一次后再调用不改变结果', async () => {
    useAppStore.setState({ recommendSource: 'hot-list', recommendSourceTouched: false });
    await applyEnvPresets(status({ defaultRecommendSource: 'douban' }));
    await applyEnvPresets(status({ defaultRecommendSource: 'douban' }));
    expect(useAppStore.getState().recommendSource).toBe('douban');
    expect(useAppStore.getState().recommendSourceTouched).toBe(false);
  });
});

describe('applyEnvPresets · DEFAULT_IMAGE_MODE', () => {
  it('未配置时不改动封面图加载方式', async () => {
    useAppStore.setState({ imageProxyMode: 'direct', imageProxyModeTouched: false });
    await applyEnvPresets(status());
    expect(useAppStore.getState().imageProxyMode).toBe('direct');
  });

  it('对未主动选择过的用户应用部署者默认值，且不打「已选择」标记', async () => {
    useAppStore.setState({ imageProxyMode: 'direct', imageProxyModeTouched: false });
    await applyEnvPresets(status({ defaultImageMode: 'proxy' }));
    expect(useAppStore.getState().imageProxyMode).toBe('proxy');
    // 自动预置不算用户主动选择：部署者日后调整默认值时该用户应跟随
    expect(useAppStore.getState().imageProxyModeTouched).toBe(false);
  });

  it('已主动选择过的用户（如 proxy）不被覆盖', async () => {
    useAppStore.setState({ imageProxyMode: 'proxy', imageProxyModeTouched: true });
    await applyEnvPresets(status({ defaultImageMode: 'proxy' }));
    expect(useAppStore.getState().imageProxyMode).toBe('proxy');
  });

  it('显式选回 direct 的用户（带「已选择」标记）不被覆盖', async () => {
    useAppStore.setState({ imageProxyMode: 'direct', imageProxyModeTouched: true });
    await applyEnvPresets(status({ defaultImageMode: 'proxy' }));
    expect(useAppStore.getState().imageProxyMode).toBe('direct');
  });

  it('存量用户：从未打过标记但偏好已不是出厂默认值的（老版本手动改过）不被覆盖', async () => {
    useAppStore.setState({ imageProxyMode: 'proxy', imageProxyModeTouched: false });
    await applyEnvPresets(status({ defaultImageMode: 'direct' }));
    expect(useAppStore.getState().imageProxyMode).toBe('proxy');
  });

  it('custom 模式（需手填模板，视为明确选择）不被覆盖', async () => {
    useAppStore.setState({ imageProxyMode: 'custom', imageProxyModeTouched: false });
    await applyEnvPresets(status({ defaultImageMode: 'direct' }));
    expect(useAppStore.getState().imageProxyMode).toBe('custom');
  });

  it('重复调用幂等：应用一次后再调用不改变结果', async () => {
    useAppStore.setState({ imageProxyMode: 'direct', imageProxyModeTouched: false });
    await applyEnvPresets(status({ defaultImageMode: 'proxy' }));
    await applyEnvPresets(status({ defaultImageMode: 'proxy' }));
    expect(useAppStore.getState().imageProxyMode).toBe('proxy');
    expect(useAppStore.getState().imageProxyModeTouched).toBe(false);
  });
});

describe('手动订阅后台过期同步', () => {
  it('24h 内不重复同步，超过 24h 后自动更新已订阅片源', async () => {
    useAppStore.getState().addSubscription(SUB_URL);
    useAppStore.getState().markSubscriptionSynced(SUB_URL);
    fetchSourceList.mockResolvedValue(payload);
    await syncStaleSubscriptions();
    expect(fetchSourceList).not.toHaveBeenCalled();
    useAppStore.setState({
      subscriptions: [{ url: SUB_URL, lastSync: Date.now() - 25 * 60 * 60 * 1000 }],
    });
    await syncStaleSubscriptions();
    expect(fetchSourceList).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().customAPIs.map((x) => x.name)).toEqual(['非凡影视', '如意资源']);
  });
  it('订阅关闭时不自动同步', async () => {
    useAppStore.setState({ subscriptions: [{ url: SUB_URL, enabled: false }] });
    await syncStaleSubscriptions();
    expect(fetchSourceList).not.toHaveBeenCalled();
  });
  it('同步失败保留历史源和订阅，保存错误状态', async () => {
    useAppStore.getState().addCustomApi({ name: '历史源', url: 'https://old.example/vod' });
    const original = useAppStore.getState().customAPIs;
    useAppStore.setState({ subscriptions: [{ url: SUB_URL, lastSync: Date.now() - 30 * 60 * 60 * 1000 }] });
    fetchSourceList.mockRejectedValue(new Error('远端网络故障'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await syncStaleSubscriptions();
    expect(useAppStore.getState().customAPIs).toEqual(original);
    expect(useAppStore.getState().subscriptions[0].lastStatus).toBe('error');
    expect(warn).toHaveBeenCalled();
  });
  it('同一订阅同时触发两次后台同步也只拉取一次', async () => {
    useAppStore.setState({ subscriptions: [{ url: SUB_URL }] });
    fetchSourceList.mockResolvedValue(payload);
    await Promise.all([syncStaleSubscriptions(), syncStaleSubscriptions()]);
    expect(fetchSourceList).toHaveBeenCalledTimes(1);
  });
  it('订阅拉取期间被删除，不允许迟到的请求将其复活', async () => {
    useAppStore.setState({ subscriptions: [{ url: SUB_URL }] });
    let finish!: (value: SourceListPayload) => void;
    fetchSourceList.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const task = syncStaleSubscriptions();
    useAppStore.getState().removeSubscription(SUB_URL);
    finish(payload);
    await task;
    expect(useAppStore.getState().subscriptions).toHaveLength(0);
    expect(useAppStore.getState().customAPIs).toHaveLength(0);
    expect(warn).toHaveBeenCalled();
  });
});
