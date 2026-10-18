import type { SourceConfig } from './types';
import { keyBelongsToSubscription, subKeyPrefix, type SourceSubscription } from './store';

/** 浏览功能尊重设置页的勾选、订阅总开关和成人内容过滤。 */
export function getBrowsableSources(state: {
  envSources: SourceConfig[];
  customAPIs: SourceConfig[];
  selectedKeys: string[];
  subscriptions: SourceSubscription[];
  yellowFilter: boolean;
}): SourceConfig[] {
  const selected = new Set(state.selectedKeys);
  const disabledPrefixes = state.subscriptions
    .filter((sub) => sub.enabled === false)
    .map((sub) => subKeyPrefix(sub.url));
  const seen = new Set<string>();
  return [...state.envSources, ...state.customAPIs].filter((source) => {
    if (!selected.has(source.key) || (state.yellowFilter && source.isAdult)) return false;
    if (disabledPrefixes.some((prefix) => keyBelongsToSubscription(source.key, prefix))) return false;
    const url = source.url.trim().replace(/\/+$/, '');
    if (seen.has(url)) return false;
    seen.add(url);
    return true;
  });
}
