import fs from 'fs';
import path from 'path';
import {
  getHighlightPath,
  getScoresFilePath,
  readScores,
  writeScores,
  type ScoreEntry,
} from './persistence';

const FLAG_FILE = '.scores-cleared-v2';

/**
 * Records written before player accounts existed carry no playerId, so nobody
 * owns them: they can never be shown in a personal history and the board would
 * keep mixing them together by name. They are dropped once, deliberately rather
 * than silently - the clips behind them were discarded after analysis and cannot
 * be rebuilt.
 *
 * Two things keep this from being a footgun:
 *
 * - it only runs when CLEAR_LEGACY_SCORES=true, so it fires on the deploy that
 *   ships accounts rather than wiping a board the app is actively using
 * - only records WITHOUT a playerId go, so anything already filed under a
 *   profile survives even if the flag is left set
 *
 * The flag file makes it a one-shot regardless of how long the variable stays
 * configured.
 */
export function runLegacyScoreReset(): void {
  if (process.env.CLEAR_LEGACY_SCORES !== 'true') return;

  const flagPath = path.join(path.dirname(getScoresFilePath()), FLAG_FILE);

  if (fs.existsSync(flagPath)) return;

  const existing = readScores();
  const kept = existing.filter((entry): entry is ScoreEntry => Boolean(entry.playerId));
  const dropped = existing.filter((entry) => !entry.playerId);

  if (dropped.length > 0) {
    writeScores(kept);
    deleteHighlightsFor(dropped);
  }

  markDone(flagPath);

  if (dropped.length > 0) {
    console.log(
      `🧹 Dropped ${dropped.length} record(s) filed before player accounts existed (kept ${kept.length})`
    );
  }
}

function deleteHighlightsFor(entries: ScoreEntry[]): void {
  for (const entry of entries) {
    if (!entry.analysisKey) continue;
    try {
      const filePath = getHighlightPath(entry.analysisKey);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch {
      // A snapshot that cannot be removed is not worth failing the boot over.
    }
  }
}

function markDone(flagPath: string): void {
  try {
    fs.mkdirSync(path.dirname(flagPath), { recursive: true });
    fs.writeFileSync(flagPath, new Date().toISOString(), 'utf-8');
  } catch {
    console.warn('⚠️  Could not persist the v2 reset flag; the reset may rerun on next boot');
  }
}
