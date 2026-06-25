import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';

const router = Router();
const SCORES_FILE = path.join(__dirname, '../../scores.json');

interface ScoreEntry {
  id?: string;
  name: string;
  score: number;
  createdAt: number;
}

type RankedScoreEntry = ScoreEntry & { rank: number };

function readScores(): ScoreEntry[] {
  if (!fs.existsSync(SCORES_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(SCORES_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function rankScores(allScores: ScoreEntry[]): RankedScoreEntry[] {
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

function getLeaderboard(scores: ScoreEntry[]): RankedScoreEntry[] {
  return rankScores(scores).filter((entry) => entry.rank <= 5);
}

router.get('/', (_req, res) => {
  const all = readScores();
  const leaderboard = getLeaderboard(all);

  res.json({ scores: leaderboard });
});

router.post('/', (req, res): void => {
  const { name, score } = req.body as { name?: string; score?: unknown };
  if (!name || typeof score !== 'number') {
    res.status(400).json({ error: 'Both name (string) and score (number) are required.' });
    return;
  }

  const scores = readScores();
  const entry: ScoreEntry = {
    id: randomUUID(),
    name,
    score,
    createdAt: Date.now(),
  };

  scores.push(entry);
  fs.writeFileSync(SCORES_FILE, JSON.stringify(scores, null, 2), 'utf-8');

  const rankedAll = rankScores(scores);
  const leaderboard = rankedAll.filter((item) => item.rank <= 5);
  const rankedEntry = rankedAll.find((item) => item.id === entry.id) ?? null;
  const qualified = rankedEntry ? rankedEntry.rank <= 5 : false;

  res.json({
    status: 'ok',
    entry,
    leaderboard: {
      qualified,
      rank: qualified && rankedEntry ? rankedEntry.rank : null,
      scores: leaderboard,
    },
  });
});

export default router;
