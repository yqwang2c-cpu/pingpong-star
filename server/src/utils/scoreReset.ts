import fs from 'fs';
import path from 'path';
import { getScoresFilePath, readScores, writeScores } from './persistence';

const FLAG_FILE = '.scores-cleared-v1';

/**
 * Every stored record predates snapshots, so none of them can show a best
 * moment. The scores are dropped once rather than left on the board as rows
 * that open to an empty card. No backup is kept: the clips behind them were
 * discarded after analysis and cannot be rebuilt.
 */
export function runScoreReset(): void {
  const scoresPath = getScoresFilePath();
  const flagPath = path.join(path.dirname(scoresPath), FLAG_FILE);

  if (fs.existsSync(flagPath)) return;

  const existing = readScores();

  if (existing.length === 0) {
    markDone(flagPath);
    return;
  }

  writeScores([]);
  markDone(flagPath);

  console.log(`🧹 Cleared ${existing.length} score records recorded before snapshots existed`);
}

function markDone(flagPath: string): void {
  try {
    fs.mkdirSync(path.dirname(flagPath), { recursive: true });
    fs.writeFileSync(flagPath, new Date().toISOString(), 'utf-8');
  } catch {
    console.warn('⚠️  Could not persist the reset flag; the reset may rerun on next boot');
  }
}
