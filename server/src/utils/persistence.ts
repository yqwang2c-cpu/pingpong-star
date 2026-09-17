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
  highlightFrame?: number;
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
// Snapshots share the disk holding the scores file, so they outlive a rebuild.
const HIGHLIGHTS_DIR =
  process.env.HIGHLIGHTS_DIR ?? path.join(path.dirname(SCORES_FILE), 'highlights');

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

export function getScoresFilePath(): string {
  return SCORES_FILE;
}

export function readScores(): ScoreEntry[] {
  return readJsonFile<ScoreEntry[]>(SCORES_FILE, []);
}

export function writeScores(scores: ScoreEntry[]) {
  writeJsonFile(SCORES_FILE, scores);
}

export function highlightFileName(analysisKey: string): string {
  return `${analysisKey.replace(/[^a-zA-Z0-9]+/g, '_')}.jpg`;
}

export function getHighlightPath(analysisKey: string): string {
  return path.join(HIGHLIGHTS_DIR, highlightFileName(analysisKey));
}

export function hasHighlight(analysisKey: string | undefined | null): boolean {
  if (!analysisKey) return false;
  return fs.existsSync(getHighlightPath(analysisKey));
}

/**
 * The board row for a player is their earliest clip at that score, but the
 * snapshot shown is meant to be their most recent one, so a player who just
 * matched their best is not represented by a stale photo.
 */
export function resolveHighlightEntry(
  row: ScoreEntry,
  scores: ScoreEntry[] = readScores()
): ScoreEntry | null {
  const playerKey = normalizePlayerName(row.name);
  const tied = scores.filter(
    (item) => normalizePlayerName(item.name) === playerKey && item.score === row.score
  );
  if (tied.length === 0) return null;

  const withSnapshot = tied.filter((item) => hasHighlight(item.analysisKey));
  const pool = withSnapshot.length > 0 ? withSnapshot : tied;

  return pool.reduce((newest, item) => (item.createdAt > newest.createdAt ? item : newest), pool[0]);
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

export interface PersonalStanding {
  isPersonalBest: boolean;
  personalBestScore: number;
  personalRank: number;
  personalTotal: number;
  pointsToBest: number;
}

interface LeaderboardPlacement {
  rankedAll: RankedScoreEntry[];
  leaderboard: RankedScoreEntry[];
  qualified: boolean;
  rank: number | null;
  rankedEntry: RankedScoreEntry | null;
  personal: PersonalStanding | null;
}

function getLeaderboardPlacement(entryId: string, scores: ScoreEntry[]): LeaderboardPlacement {
  // The board keeps one row per player holding only their best clip, so the
  // place quoted after a submission has to describe THIS clip. Reading it off
  // the player's row would report their older high score's position instead.
  const rankedAll = rankScores(bestScorePerPlayer(scores));
  const leaderboard = rankedAll.filter((item) => item.rank <= 5);

  const targetEntry = scores.find((item) => item.id === entryId) ?? null;
  if (!targetEntry) {
    return {
      rankedAll,
      leaderboard,
      qualified: false,
      rank: null,
      rankedEntry: null,
      personal: null,
    };
  }

  const playerKey = normalizePlayerName(targetEntry.name);
  const playerEntries = scores.filter((item) => normalizePlayerName(item.name) === playerKey);
  const personalBestScore = playerEntries.reduce(
    (best, item) => (item.score > best ? item.score : best),
    targetEntry.score
  );
  const aheadCount = playerEntries.filter((item) => item.score > targetEntry.score).length;

  const rankedEntry = rankedAll.find((item) => normalizePlayerName(item.name) === playerKey) ?? null;
  const isPersonalBest = targetEntry.score >= personalBestScore;
  // Claiming a place on the board is only honest when this clip is the row the
  // board already shows for that player, since the two screens would otherwise
  // quote different numbers for the same submission.
  const qualified = Boolean(rankedEntry) && isPersonalBest && rankedEntry!.rank <= 5;

  return {
    rankedAll,
    leaderboard,
    qualified,
    rank: qualified && rankedEntry ? rankedEntry.rank : null,
    rankedEntry,
    personal: {
      isPersonalBest,
      personalBestScore,
      personalRank: aheadCount + 1,
      personalTotal: playerEntries.length,
      pointsToBest: Math.max(0, personalBestScore - targetEntry.score),
    },
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
      personal: placement.personal,
      scores: placement.leaderboard,
    },
  };
}
