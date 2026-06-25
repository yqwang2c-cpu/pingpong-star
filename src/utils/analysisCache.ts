import * as FileSystem from 'expo-file-system/legacy';
import type { AnalysisResult } from '../types/analysis';

const CACHE_VERSION = 1 as const;
const CACHE_FILENAME = 'analysis-cache-v1.json';
const CACHE_PATH = `${FileSystem.documentDirectory ?? ''}${CACHE_FILENAME}`;
const MAX_ENTRIES = 40;

export type SelectedPoint = { x: number; y: number };

export const DEFAULT_POINT: SelectedPoint = { x: 0.5, y: 0.5 };

type CachedEntry = {
  createdAt: number;
  result: AnalysisResult;
};

type CacheFile = {
  version: typeof CACHE_VERSION;
  entries: Record<string, CachedEntry>;
};

function safeParseCache(json: string): CacheFile | null {
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const version = (parsed as { version?: unknown }).version;
    const entries = (parsed as { entries?: unknown }).entries;
    if (version !== CACHE_VERSION) return null;
    if (!entries || typeof entries !== 'object') return null;
    return { version: CACHE_VERSION, entries: entries as Record<string, CachedEntry> };
  } catch {
    return null;
  }
}

async function readCacheFile(): Promise<CacheFile> {
  try {
    if (!CACHE_PATH) return { version: CACHE_VERSION, entries: {} };
    const info = await FileSystem.getInfoAsync(CACHE_PATH);
    if (!info.exists) return { version: CACHE_VERSION, entries: {} };
    const content = await FileSystem.readAsStringAsync(CACHE_PATH);
    const parsed = safeParseCache(content);
    return parsed ?? { version: CACHE_VERSION, entries: {} };
  } catch {
    return { version: CACHE_VERSION, entries: {} };
  }
}

async function writeCacheFile(cache: CacheFile): Promise<void> {
  if (!CACHE_PATH) return;
  const trimmed = trimCache(cache.entries);
  await FileSystem.writeAsStringAsync(
    CACHE_PATH,
    JSON.stringify({ version: CACHE_VERSION, entries: trimmed }),
    { encoding: 'utf8' }
  );
}

function trimCache(entries: Record<string, CachedEntry>): Record<string, CachedEntry> {
  const keys = Object.keys(entries);
  if (keys.length <= MAX_ENTRIES) return entries;

  const sorted = keys
    .map((key) => ({ key, createdAt: entries[key]?.createdAt ?? 0 }))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, MAX_ENTRIES);

  return sorted.reduce<Record<string, CachedEntry>>((acc, item) => {
    const value = entries[item.key];
    if (value) acc[item.key] = value;
    return acc;
  }, {});
}

export function makeCacheKey(videoMd5: string, point: SelectedPoint): string {
  const x = Math.round(point.x * 1000);
  const y = Math.round(point.y * 1000);
  return `${videoMd5}:${x}:${y}`;
}

export async function getVideoMd5(uri: string): Promise<string | null> {
  try {
    const info = await FileSystem.getInfoAsync(uri, { md5: true });
    const md5 = (info as { md5?: string | null }).md5;
    if (!md5 || typeof md5 !== 'string' || md5.length === 0) return null;
    return md5;
  } catch {
    return null;
  }
}

export async function getCachedAnalysis(cacheKey: string): Promise<AnalysisResult | null> {
  const cache = await readCacheFile();
  const entry = cache.entries[cacheKey];
  return entry?.result ?? null;
}

export async function setCachedAnalysis(cacheKey: string, result: AnalysisResult): Promise<void> {
  const cache = await readCacheFile();
  cache.entries[cacheKey] = { createdAt: Date.now(), result };
  await writeCacheFile(cache);
}
