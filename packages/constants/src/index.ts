import ech from '../data/ech.json' with { type: 'json' };
import federal from '../data/federal.json' with { type: 'json' };
import fleet from '../data/fleet.json' with { type: 'json' };
import ingest from '../data/ingest.json' with { type: 'json' };
import knn from '../data/knn.json' with { type: 'json' };
import license from '../data/license.json' with { type: 'json' };
import memory from '../data/memory.json' with { type: 'json' };
import overhead from '../data/overhead.json' with { type: 'json' };
import shards from '../data/shards.json' with { type: 'json' };
import storage from '../data/storage.json' with { type: 'json' };
import { canonicalJson, sha256Hex } from './hash.ts';
import type { Constant } from './types.ts';

export * from './types.ts';
export { canonicalJson, sha256Hex } from './hash.ts';

/** A keyed, immutable set of constants. The engine takes one of these as an argument. */
export interface ConstantSet {
  readonly byKey: ReadonlyMap<string, Constant>;
  readonly hash: string;
}

/** Constants grouped by their source file in data/, in display order. */
export const constantFiles: readonly { file: string; items: readonly Constant[] }[] = [
  { file: 'storage.json', items: storage as Constant[] },
  { file: 'memory.json', items: memory as Constant[] },
  { file: 'shards.json', items: shards as Constant[] },
  { file: 'overhead.json', items: overhead as Constant[] },
  { file: 'fleet.json', items: fleet as Constant[] },
  { file: 'knn.json', items: knn as Constant[] },
  { file: 'license.json', items: license as Constant[] },
  { file: 'ingest.json', items: ingest as Constant[] },
  { file: 'federal.json', items: federal as Constant[] },
  { file: 'ech.json', items: ech as Constant[] },
];

export const allConstants: readonly Constant[] = constantFiles.flatMap((f) => f.items);

export function buildConstantSet(items: readonly Constant[]): ConstantSet {
  const byKey = new Map<string, Constant>();
  for (const item of items) {
    if (byKey.has(item.key)) throw new Error(`Duplicate constant key: ${item.key}`);
    byKey.set(item.key, item);
  }
  const sorted = [...items].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return { byKey, hash: sha256Hex(canonicalJson(sorted)) };
}

export const defaultConstants: ConstantSet = buildConstantSet(allConstants);
export const constantsHash: string = defaultConstants.hash;

export function getConstant(set: ConstantSet, key: string): Constant {
  const c = set.byKey.get(key);
  if (!c) throw new Error(`Unknown constant: ${key}`);
  return c;
}

export function num(set: ConstantSet, key: string): number {
  const { value } = getConstant(set, key);
  if (typeof value !== 'number') throw new Error(`Constant ${key} is not a number`);
  return value;
}

/** Structured value (table, object). The caller names the shape; the constants tests check each shape. */
export function val<T>(set: ConstantSet, key: string): T {
  return getConstant(set, key).value as T;
}
