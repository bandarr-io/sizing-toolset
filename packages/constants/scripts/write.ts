import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Constant } from '../src/types.ts';
import { checkConstants } from './check.ts';

export interface WriteResult {
  ok: boolean;
  errors: string[];
  /** File names in data/ that changed. */
  written: string[];
}

/**
 * Replace existing constants in data/*.json by key. Validates the full merged set with the same
 * rules CI uses before touching any file, so a failed write changes nothing. Never adds or deletes keys.
 */
export function writeOverrides(dataDir: string, overrides: readonly Constant[], today: string): WriteResult {
  const files = readdirSync(dataDir).filter((f) => f.endsWith('.json')).sort();
  const parsed = files.map((file) => ({ file, items: JSON.parse(readFileSync(join(dataDir, file), 'utf8')) as Constant[] }));
  const byKey = new Map(overrides.map((o) => [o.key, o]));

  const known = new Set(parsed.flatMap((f) => f.items.map((c) => c.key)));
  const unknown = [...byKey.keys()].filter((k) => !known.has(k));
  if (unknown.length) return { ok: false, errors: unknown.map((k) => `${k}: not an existing constant`), written: [] };

  const merged = parsed.map((f) => ({ file: f.file, items: f.items.map((c) => byKey.get(c.key) ?? c) }));
  const errors = checkConstants(merged.flatMap((f) => f.items), today);
  if (errors.length) return { ok: false, errors, written: [] };

  const written: string[] = [];
  for (const f of merged) {
    const before = readFileSync(join(dataDir, f.file), 'utf8');
    const after = `${JSON.stringify(f.items, null, 2)}\n`;
    if (before !== after) {
      writeFileSync(join(dataDir, f.file), after);
      written.push(f.file);
    }
  }
  return { ok: true, errors: [], written };
}
