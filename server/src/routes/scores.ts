import { Router } from 'express';
import path from 'path';
import fs from 'fs';

const router = Router();
const SCORES_FILE = path.join(__dirname, '../../scores.json');

interface ScoreEntry {
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

// GET /api/scores — 返回每人最高分 Top 5
router.get('/', (_req, res) => {
  const all = readScores();

  const top5 = [...all]
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  res.json({ scores: top5 });
});

// POST /api/scores — 保存一条新分数
router.post('/', (req, res): void => {
  const { name, score } = req.body as { name?: string; score?: unknown };
  if (!name || typeof score !== 'number') {
    res.status(400).json({ error: '需要 name（字符串）和 score（数字）字段' });
    return;
  }

  const scores = readScores();
  scores.push({ name, score, createdAt: Date.now() });
  fs.writeFileSync(SCORES_FILE, JSON.stringify(scores, null, 2), 'utf-8');

  res.json({ status: 'ok' });
});

export default router;
