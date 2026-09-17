import fs from 'fs';
import { Router } from 'express';
import {
  getHighlightPath,
  getLeaderboard,
  hasHighlight,
  readScores,
  resolveHighlightEntry,
  saveScoreOnce,
} from '../utils/persistence';

const router = Router();

router.get('/', (_req, res) => {
  const all = readScores();
  const leaderboard = getLeaderboard(all);

  res.json({
    scores: leaderboard.map((row) => {
      const snapshotOwner = resolveHighlightEntry(row, all);
      const analysisKey = snapshotOwner?.analysisKey;

      return {
        ...row,
        highlightUrl:
          analysisKey && hasHighlight(analysisKey)
            ? `/api/scores/highlight/${snapshotOwner?.id}`
            : undefined,
      };
    }),
  });
});

router.get('/highlight/:entryId', (req, res): void => {
  const entry = readScores().find((item) => item.id === req.params.entryId);

  if (!entry?.analysisKey) {
    res.status(404).json({ error: 'No snapshot was stored for this entry.' });
    return;
  }

  const filePath = getHighlightPath(entry.analysisKey);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: 'The snapshot for this entry is no longer available.' });
    return;
  }

  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.sendFile(filePath);
});

router.post('/', (req, res): void => {
  const { name, score, analysisKey, playerId, accountId } = req.body as {
    name?: string;
    score?: unknown;
    analysisKey?: unknown;
    playerId?: unknown;
    accountId?: unknown;
  };
  if (!name || typeof score !== 'number') {
    res.status(400).json({ error: 'Both name (string) and score (number) are required.' });
    return;
  }

  if (analysisKey !== undefined && typeof analysisKey !== 'string') {
    res.status(400).json({ error: 'analysisKey must be a string when provided.' });
    return;
  }

  if (playerId !== undefined && typeof playerId !== 'string') {
    res.status(400).json({ error: 'playerId must be a string when provided.' });
    return;
  }

  if (accountId !== undefined && typeof accountId !== 'string') {
    res.status(400).json({ error: 'accountId must be a string when provided.' });
    return;
  }

  // TODO(user-system): once the requireAccount middleware lands, derive the
  // name from the player profile instead of trusting the request body, and
  // reject any playerId that does not belong to the caller's account.
  const result = saveScoreOnce({
    name,
    score,
    analysisKey,
    playerId,
    accountId,
  });

  res.json({
    status: 'ok',
    reused: result.reused,
    entry: result.entry,
    leaderboard: result.leaderboard,
  });
});

export default router;
