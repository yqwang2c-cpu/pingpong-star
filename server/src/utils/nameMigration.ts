import fs from 'fs';
import path from 'path';
import {
  getScoresFilePath,
  normalizePlayerName,
  readScores,
  writeScores,
  type ScoreEntry,
} from './persistence';

const FLAG_FILE = '.names-normalized-v1';

interface MergeRule {
  from: string;
  to: string;
}

/**
 * Duplicate players that a human has explicitly confirmed to be the same person.
 * Never infer these automatically: two children can share a given name.
 */
const CONFIRMED_MERGES: MergeRule[] = [{ from: 'yanyi', to: 'wang yanyi' }];

function canonicalDisplayName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toUpperCase();
}

function isBetterCandidate(candidate: ScoreEntry, incumbent: ScoreEntry): boolean {
  if (candidate.score !== incumbent.score) return candidate.score > incumbent.score;
  return candidate.createdAt < incumbent.createdAt;
}

export function runNameNormalizationMigration(): void {
  const scoresPath = getScoresFilePath();
  const flagPath = path.join(path.dirname(scoresPath), FLAG_FILE);

  if (fs.existsSync(flagPath)) return;

  const original = readScores();

  if (original.length === 0) {
    markMigrationDone(flagPath);
    return;
  }

  let scores = original.map((entry) => {
    const name = canonicalDisplayName(entry.name);
    return { ...entry, name, nameKey: normalizePlayerName(name) };
  });

  for (const rule of CONFIRMED_MERGES) {
    const pool = scores.filter((entry) => {
      const key = normalizePlayerName(entry.name);
      return key === rule.from || key === rule.to;
    });

    if (pool.length < 2) continue;

    const keeper = pool.reduce((best, entry) => (isBetterCandidate(entry, best) ? entry : best));
    const merged: ScoreEntry = {
      ...keeper,
      name: canonicalDisplayName(rule.to),
      nameKey: normalizePlayerName(rule.to),
    };

    scores = scores
      .filter((entry) => !pool.some((duplicate) => duplicate.id === entry.id))
      .concat(merged);

    console.log(
      `🔗 Merged ${pool.length} records into "${merged.name}" (score ${merged.score})`
    );
  }

  scores.sort((a, b) => a.createdAt - b.createdAt);
  writeScores(scores);
  markMigrationDone(flagPath);

  console.log(`✅ Normalized ${scores.length} score records to capitals`);
}

function markMigrationDone(flagPath: string): void {
  try {
    fs.mkdirSync(path.dirname(flagPath), { recursive: true });
    fs.writeFileSync(flagPath, new Date().toISOString(), 'utf-8');
  } catch {
    console.warn('⚠️  Could not persist migration flag; migration may rerun on next boot');
  }
}
