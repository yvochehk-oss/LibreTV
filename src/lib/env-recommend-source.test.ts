import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./tmdb', () => ({ hasTmdbCredentials: vi.fn() }));

import { hasTmdbCredentials } from './tmdb';
import { getEnvRecommendSource } from './env-recommend-source';

const KEY = 'DEFAULT_RECOMMEND_SOURCE';
const original = process.env[KEY];
const credentialsMock = vi.mocked(hasTmdbCredentials);

beforeEach(() => { credentialsMock.mockReturnValue(false); });

afterEach(() => {
  if (original === undefined) delete process.env[KEY];
  else process.env[KEY] = original;
  vi.clearAllMocks();
});

describe('getEnvRecommendSource', () => {
  it('未配置时返回 undefined', () => {
    delete process.env[KEY];
    expect(getEnvRecommendSource()).toBeUndefined();
  });

  it('空值与纯空白视为未配置', () => {
    for (const v of ['', '   ']) {
      process.env[KEY] = v;
      expect(getEnvRecommendSource()).toBeUndefined();
    }
  });

  it('三个合法取值（大小写不敏感，自动去空白）', () => {
    for (const [raw, expected] of [
      ['douban', 'douban'],
      ['BANGUMI', 'bangumi'],
      [' hot-list ', 'hot-list'],
      ['TMDB', 'tmdb'],
    ] as const) {
      process.env[KEY] = raw;
      expect(getEnvRecommendSource()).toBe(expected);
    }
  });

  it('非法取值返回 undefined 而非抛错', () => {
    process.env[KEY] = 'maoyan';
    expect(getEnvRecommendSource()).toBeUndefined();
  });

  it('仅在没有有效显式选择时，凭证自动将 TMDB 设为默认推荐', () => {
    delete process.env[KEY];
    credentialsMock.mockReturnValue(true);
    expect(getEnvRecommendSource()).toBe('tmdb');
    process.env[KEY] = 'hot-list';
    expect(getEnvRecommendSource()).toBe('hot-list');
  });
});
