import { hasTmdbCredentials } from './tmdb';

export type RecommendSourceValue = 'douban' | 'bangumi' | 'hot-list' | 'tmdb';

/**
 * 部署者通过 DEFAULT_RECOMMEND_SOURCE 环境变量指定的首页推荐数据源默认值。
 * 显式配置的有效值优先；未显式配置时，只有服务端已配置 TMDB 凭证才默认选择 tmdb。
 * 无显式值且没有凭证时返回 undefined（沿用内置默认 hot-list）。
 */
export function getEnvRecommendSource(): RecommendSourceValue | undefined {
  const raw = process.env.DEFAULT_RECOMMEND_SOURCE?.trim().toLowerCase();
  if (raw === 'douban' || raw === 'bangumi' || raw === 'hot-list' || raw === 'tmdb') return raw;
  if (raw) console.warn('[LibreTV] DEFAULT_RECOMMEND_SOURCE 取值无效，已忽略（可选 douban / bangumi / hot-list / tmdb）：', raw);
  return hasTmdbCredentials() ? 'tmdb' : undefined;
}
