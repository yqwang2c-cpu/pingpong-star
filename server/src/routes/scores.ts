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

function readScores(): ScoreEntry[] {
  if (!fs.existsSync(SCORES_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(SCORES_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function getTopFiveScores(allScores: ScoreEntry[]): ScoreEntry[] {
  return [...allScores]
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.createdAt - b.createdAt;
    })
    .slice(0, 5);
}

router.get('/', (_req, res) => {
  const all = readScores();
  const top5 = getTopFiveScores(all);

  res.json({ scores: top5 });
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

  const top5 = getTopFiveScores(scores);
  const rankIndex = top5.findIndex((item) => item.id === entry.id);

  res.json({
    status: 'ok',
    entry,
    leaderboard: {
      qualified: rankIndex !== -1,
      rank: rankIndex === -1 ? null : rankIndex + 1,
      scores: top5,
    },
  });
});

export default router;
