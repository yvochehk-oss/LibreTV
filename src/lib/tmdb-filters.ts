export type TmdbMediaType = 'movie' | 'tv';
export type TmdbList = 'popular' | 'top_rated' | 'trending';
export type TmdbRegion = 'all' | 'CN' | 'HK' | 'TW' | 'JP' | 'KR' | 'JP_KR' | 'WESTERN';
export type TmdbEra = 'all' | '2020s' | '2010s' | '2000s' | '1990s' | 'before1990';

export interface TmdbItem {
  id: number;
  title: string;
  cover: string;
  rating?: string;
  year?: string;
  mediaType: TmdbMediaType;
}

export interface TmdbResponse {
  items: TmdbItem[];
  /** First upstream page represented by this batch. */
  page: number;
  totalPages: number;
  totalResults: number;
  /** Start page of the next batch, or null when the TMDB result set is exhausted. */
  nextPage: number | null;
}

export const TMDB_REGIONS: { id: TmdbRegion; label: string; countries: string[] }[] = [
  { id: 'all', label: '全部地区', countries: [] },
  { id: 'CN', label: '大陆', countries: ['CN'] },
  { id: 'HK', label: '香港', countries: ['HK'] },
  { id: 'TW', label: '台湾', countries: ['TW'] },
  { id: 'JP', label: '日本', countries: ['JP'] },
  { id: 'KR', label: '韩国', countries: ['KR'] },
  { id: 'JP_KR', label: '日韩', countries: ['JP', 'KR'] },
  { id: 'WESTERN', label: '欧美', countries: ['US', 'CA', 'GB', 'IE', 'FR', 'DE', 'IT', 'ES', 'PT', 'NL', 'BE', 'LU', 'CH', 'AT', 'DK', 'SE', 'NO', 'FI', 'IS', 'PL', 'CZ', 'GR', 'RO', 'HU', 'UA'] },
];

export const TMDB_ERAS: { id: TmdbEra; label: string; from?: string; through: string }[] = [
  { id: 'all', label: '全部年代', through: '' },
  { id: '2020s', label: '2020年代', from: '2020-01-01', through: '2029-12-31' },
  { id: '2010s', label: '2010年代', from: '2010-01-01', through: '2019-12-31' },
  { id: '2000s', label: '2000年代', from: '2000-01-01', through: '2009-12-31' },
  { id: '1990s', label: '1990年代', from: '1990-01-01', through: '1999-12-31' },
  { id: 'before1990', label: '更早', through: '1989-12-31' },
];

const regionById = new Map<TmdbRegion, (typeof TMDB_REGIONS)[number]>(TMDB_REGIONS.map((region) => [region.id, region]));
const eraById = new Map<TmdbEra, (typeof TMDB_ERAS)[number]>(TMDB_ERAS.map((era) => [era.id, era]));

export function isTmdbRegion(value: string): value is TmdbRegion {
  return regionById.has(value as TmdbRegion);
}

export function isTmdbEra(value: string): value is TmdbEra {
  return eraById.has(value as TmdbEra);
}

export function tmdbCountriesForRegion(region: TmdbRegion): string[] {
  return regionById.get(region)?.countries ?? [];
}

export function tmdbDateRangeForEra(era: TmdbEra): { from?: string; through?: string } {
  const range = eraById.get(era);
  return range ? { from: range.from, through: range.through } : {};
}

export function tmdbQueryKey(type: TmdbMediaType, list: TmdbList, region: TmdbRegion, era: TmdbEra) {
  return ['tmdb', type, list, region, era] as const;
}
