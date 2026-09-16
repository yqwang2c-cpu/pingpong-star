import { Router } from 'express';
import { getLeaderboard, readScores, saveScoreOnce } from '../utils/persistence';

const router = Router();

router.get('/', (_req, res) => {
  const all = readScores();
  const leaderboard = getLeaderboard(all);

  res.json({ scores: leaderboard });
});

router.post('/', (req, res): void => {
  const { name, score, analysisKey } = req.body as {
    name?: string;
    score?: unknown;
    analysisKey?: unknown;
  };
  if (!name || typeof score !== 'number') {
    res.status(400).json({ error: 'Both name (string) and score (number) are required.' });
    return;
  }

  if (analysisKey !== undefined && typeof analysisKey !== 'string') {
    res.status(400).json({ error: 'analysisKey must be a string when provided.' });
    return;
  }

  const result = saveScoreOnce({
    name,
    score,
    analysisKey,
  });

  res.json({
    status: 'ok',
    reused: result.reused,
    entry: result.entry,
    leaderboard: result.leaderboard,
  });
});

export default router;
