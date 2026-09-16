import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

export interface PointSelection {
  x: number;
  y: number;
}

export interface AnalysisResultPayload {
  frames: string[];
  score: number;
  strengths: string[];
  improvements: string[];
}

export interface ScoreEntry {
  id: string;
  name: string;
  nameKey: string;
  score: number;
  createdAt: number;
  dedupeKey?: string;
  analysisKey?: string;
}

export type RankedScoreEntry = ScoreEntry & { rank: number };

interface AnalysisCacheEntry {
  analysisKey: string;
  createdAt: number;
  result: AnalysisResultPayload;
}

type AnalysisCacheFile = {
  entries: Record<string, AnalysisCacheEntry>;
};

const FALLBACK_SCORES_FILE = path.join(__dirname, '../../scores.json');
const SCORES_FILE =
  process.env.SCORES_FILE ??
  (fs.existsSync('/var/data') ? '/var/data/scores.json' : FALLBACK_SCORES_FILE);
const ANALYSIS_CACHE_FILE =
  process.env.ANALYSIS_CACHE_FILE ?? path.join(path.dirname(SCORES_FILE), 'analysis-cache.json');

function ensureDirectoryExists(filePath: string) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  } catch {
    return;
  }
}

function readJsonFile<T>(filePath: string, fallback: T): T {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
  } catch {
    return fallback;
  }
}

function writeJsonFile(filePath: string, value: unknown) {
  ensureDirectoryExists(filePath);
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf-8');
}

export function normalizePlayerName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function makePointKey(point: PointSelection): string {
  const x = Math.round(point.x * 1000);
  const y = Math.round(point.y * 1000);
  return `${x}:${y}`;
}

export function makeAnalysisKey(videoHash: string, point: PointSelection): string {
  return `${videoHash}:${makePointKey(point)}`;
}

export function readScores(): ScoreEntry[] {
  return readJsonFile<ScoreEntry[]>(SCORES_FILE, []);
}

function writeScores(scores: ScoreEntry[]) {
  writeJsonFile(SCORES_FILE, scores);
}

function readAnalysisCache(): AnalysisCacheFile {
  const parsed = readJsonFile<AnalysisCacheFile>(ANALYSIS_CACHE_FILE, { entries: {} });
  if (!parsed || typeof parsed !== 'object' || !parsed.entries || typeof parsed.entries !== 'object') {
    return { entries: {} };
  }
  return parsed;
}

function writeAnalysisCache(cache: AnalysisCacheFile) {
  writeJsonFile(ANALYSIS_CACHE_FILE, cache);
}

export function getCachedAnalysis(analysisKey: string): AnalysisCacheEntry | null {
  const cache = readAnalysisCache();
  return cache.entries[analysisKey] ?? null;
}

export function setCachedAnalysis(analysisKey: string, result: AnalysisResultPayload): void {
  const cache = readAnalysisCache();
  cache.entries[analysisKey] = {
    analysisKey,
    createdAt: Date.now(),
    result,
  };
  writeAnalysisCache(cache);
}

export function rankScores(allScores: ScoreEntry[]): RankedScoreEntry[] {
  const sorted = [...allScores].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.createdAt - b.createdAt;
  });

  let previousScore: number | null = null;
  let previousRank = 0;

  return sorted.map((entry, index) => {
    const rank = previousScore === entry.score ? previousRank : index + 1;
    previousScore = entry.score;
    previousRank = rank;

    return { ...entry, rank };
  });
}

export function bestScorePerPlayer(scores: ScoreEntry[]): ScoreEntry[] {
  const bestByName = new Map<string, ScoreEntry>();

  for (const entry of scores) {
    const playerKey = normalizePlayerName(entry.name);
    if (!playerKey) continue;

    const existing = bestByName.get(playerKey);
    if (!existing) {
      bestByName.set(playerKey, entry);
      continue;
    }

    const higherScore = entry.score > existing.score;
    const sameScoreButOlder =
      entry.score === existing.score && entry.createdAt < existing.createdAt;

    if (higherScore || sameScoreButOlder) {
      bestByName.set(playerKey, entry);
    }
  }

  return [...bestByName.values()];
}

export function getLeaderboard(scores: ScoreEntry[] = readScores()): RankedScoreEntry[] {
  return rankScores(bestScorePerPlayer(scores)).filter((entry) => entry.rank <= 5);
}

function getLeaderboardPlacement(entryId: string, scores: ScoreEntry[]) {
  // Rank by each player's best score so one child cannot occupy the whole board
  // with duplicate entries recorded under name variants.
  const rankedAll = rankScores(bestScorePerPlayer(scores));
  const targetEntry = scores.find((item) => item.id === entryId) ?? null;
  const targetKey = targetEntry ? normalizePlayerName(targetEntry.name) : null;
  const rankedEntry =
    targetKey !== null
      ? rankedAll.find((item) => normalizePlayerName(item.name) === targetKey) ?? null
      : null;
  const qualified = rankedEntry ? rankedEntry.rank <= 5 : false;

  return {
    rankedAll,
    leaderboard: rankedAll.filter((item) => item.rank <= 5),
    qualified,
    rank: qualified && rankedEntry ? rankedEntry.rank : null,
    rankedEntry,
  };
}

export function saveScoreOnce({
  name,
  score,
  analysisKey,
}: {
  name: string;
  score: number;
  analysisKey?: string;
}) {
  const scores = readScores();
  const nameKey = normalizePlayerName(name);
  const dedupeKey = analysisKey ? `${nameKey}:${analysisKey}` : undefined;
  const existingEntry = dedupeKey
    ? scores.find((entry) => entry.dedupeKey === dedupeKey)
    : undefined;

  const entry =
    existingEntry ??
    ({
      id: randomUUID(),
      name,
      nameKey,
      score,
      createdAt: Date.now(),
      dedupeKey,
      analysisKey,
    } satisfies ScoreEntry);

  if (!existingEntry) {
    scores.push(entry);
    writeScores(scores);
  }

  const placement = getLeaderboardPlacement(entry.id, scores);

  return {
    reused: Boolean(existingEntry),
    entry,
    leaderboard: {
      qualified: placement.qualified,
      rank: placement.rank,
      scores: placement.leaderboard,
    },
  };
}
