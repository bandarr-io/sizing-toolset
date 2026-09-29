import {
  allConstants, buildConstantSet, canonicalJson, defaultConstants, type Constant, type ConstantSet,
} from '@sizing/constants';
import { checkConstants } from '@sizing/constants/check';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type Overrides = Record<string, Constant>;

const STORAGE_KEY = 'sizing.constants.overrides.v1';

/** Constants the engine divides by; zero would produce ∞ or NaN node counts. */
const POSITIVE = new Set([
  'index_ratio.standard', 'index_ratio.logsdb', 'index_ratio.tsds',
  'mem_disk.hot', 'mem_disk.content', 'mem_disk.warm', 'mem_disk.cold',
  'mem_disk.hot_min', 'mem_disk.hot_max', 'mem_disk.warm_min', 'mem_disk.warm_max',
  'heap_fraction', 'heap_cap_gb', 'node_ram_default_gb', 'node_ram_practical_max_gb', 'vcpu_per_ram_gb',
  'shard_size_gb_max', 'max_shards_per_nonfrozen_node', 'master_indices_per_gb_heap',
  'datastream.rollover_max_primary_shard_gb', 'datastream.rollover_max_age_days', 'datastream.default_primary_shards',
  'kibana.node_ram_gb', 'coordinating.node_ram_gb', 'apm.node_ram_gb', 'ml.node_ram_gb', 'ml.jobs_per_node',
  'knn.hnsw_m', 'eru_gb', 'ev_per_s_per_vcpu', 'ingest.default_avg_event_kb',
]);

/** Fractions that must stay below 1 (a derate of 1 would mean zero throughput). */
const BELOW_ONE = new Set(['heap_fraction', 'ingest.derate.pipelines', 'ingest.derate.logsdb', 'ingest.derate.concurrent_search']);

const LICENSE_TIERS = ['basic', 'enterprise'];

/** Tables the engine scans in order: key → column that must strictly increase (and the first row's required value). */
const ORDERED_TABLES: Record<string, { column: string; first?: number }> = {
  'fleet.table': { column: 'agents' },
  'masters.sizing': { column: 'minDataNodes', first: 0 },
};

function orderProblems(key: string, value: unknown): string[] {
  const rule = ORDERED_TABLES[key];
  if (!rule || !Array.isArray(value)) return [];
  const col = value.map((r) => (r as Record<string, number>)[rule.column]!);
  const errors: string[] = [];
  if (rule.first !== undefined && col[0] !== rule.first) errors.push(`${key}: first row must have ${rule.column} = ${rule.first}`);
  if (col.some((v, i) => i > 0 && v <= col[i - 1]!)) errors.push(`${key}: rows must be sorted by ${rule.column}, each row larger than the one before`);
  return errors;
}

export function localToday(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export function sameValue(a: unknown, b: unknown): boolean {
  return canonicalJson(a) === canonicalJson(b);
}

export function sameConstant(a: Constant, b: Constant): boolean {
  return canonicalJson(a) === canonicalJson(b);
}

/** Structural type match: same primitive types, same object keys, array rows shaped like the original's first row. */
export function sameShape(original: unknown, draft: unknown): boolean {
  if (Array.isArray(original)) {
    if (!Array.isArray(draft) || draft.length === 0) return false;
    const proto = original[0];
    return proto === undefined || draft.every((row) => sameShape(proto, row));
  }
  if (original !== null && typeof original === 'object') {
    if (draft === null || typeof draft !== 'object' || Array.isArray(draft)) return false;
    const a = Object.keys(original).sort();
    const b = Object.keys(draft).sort();
    return a.length === b.length && a.every((k, i) => k === b[i] && sameShape((original as Record<string, unknown>)[k], (draft as Record<string, unknown>)[k]));
  }
  return typeof original === typeof draft;
}

function numericProblems(key: string, value: unknown, path = ''): string[] {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return [`${key}${path}: must be a finite number`];
    if (value < 0) return [`${key}${path}: must not be negative`];
    if (!path && POSITIVE.has(key) && value <= 0) return [`${key}: must be greater than 0`];
    if (!path && BELOW_ONE.has(key) && value >= 1) return [`${key}: must be less than 1`];
    return [];
  }
  if (Array.isArray(value)) return value.flatMap((v, i) => numericProblems(key, v, `${path}[${i}]`));
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) => numericProblems(key, v, `${path}.${k}`));
  }
  return [];
}

/** Everything a draft must pass before it becomes an override: the CI rules plus type and range checks. */
export function validateDraft(original: Constant, draft: Constant, today: string): string[] {
  const errors = checkConstants([draft], today);
  if (!sameShape(original.value, draft.value)) errors.push(`${draft.key}: value must keep the original shape (${describeShape(original.value)})`);
  errors.push(...numericProblems(draft.key, draft.value));
  errors.push(...orderProblems(draft.key, draft.value));
  if (draft.key.startsWith('license.floor.') && !LICENSE_TIERS.includes(String(draft.value))) {
    errors.push(`${draft.key}: must be one of ${LICENSE_TIERS.join(', ')}`);
  }
  if (!sameValue(original.value, draft.value) && sameValue(original.source_url, draft.source_url) && draft.as_of_date === original.as_of_date) {
    errors.push(`${draft.key}: a changed value needs a new checked date or a new source link`);
  }
  return errors;
}

export function describeShape(v: unknown): string {
  if (Array.isArray(v)) return `table of ${v.length} rows`;
  if (v !== null && typeof v === 'object') return `object with ${Object.keys(v).join(', ')}`;
  return typeof v;
}

export function applyOverrides(base: readonly Constant[], overrides: Overrides): Constant[] {
  return base.map((c) => overrides[c.key] ?? c);
}

/** Drop overrides that match the shipped constants (e.g. after writing them to the repo) or name unknown keys. */
export function pruneOverrides(base: readonly Constant[], overrides: Overrides): Overrides {
  const byKey = new Map(base.map((c) => [c.key, c]));
  const out: Overrides = {};
  for (const [k, c] of Object.entries(overrides)) {
    const b = byKey.get(k);
    if (b && !sameConstant(b, c)) out[k] = c;
  }
  return out;
}

function load(): Overrides {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? pruneOverrides(allConstants, JSON.parse(raw) as Overrides) : {};
  } catch {
    return {};
  }
}

function persist(o: Overrides): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(o));
  } catch {
    // Storage unavailable: overrides last for this page view only.
  }
}

interface ConstantsState {
  /** Effective set the engine uses: shipped constants with overrides applied. */
  set: ConstantSet;
  overrides: Overrides;
  isOverridden: (key: string) => boolean;
  setOverride: (c: Constant) => void;
  revert: (key: string) => void;
  replaceAll: (o: Overrides) => void;
}

const Ctx = createContext<ConstantsState>({
  set: defaultConstants, overrides: {}, isOverridden: () => false, setOverride: () => {}, revert: () => {}, replaceAll: () => {},
});

export function ConstantsProvider({ children }: { children: ReactNode }) {
  const [overrides, setOverrides] = useState<Overrides>(load);
  useEffect(() => persist(overrides), [overrides]);
  const set = useMemo(
    () => (Object.keys(overrides).length ? buildConstantSet(applyOverrides(allConstants, overrides)) : defaultConstants),
    [overrides],
  );
  const setOverride = useCallback((c: Constant) => {
    setOverrides((o) => pruneOverrides(allConstants, { ...o, [c.key]: c }));
  }, []);
  const revert = useCallback((key: string) => setOverrides(({ [key]: _drop, ...rest }) => rest), []);
  const replaceAll = useCallback((o: Overrides) => {
    const next = pruneOverrides(allConstants, o);
    persist(next);
    setOverrides(next);
  }, []);
  const value = useMemo<ConstantsState>(() => ({
    set, overrides, isOverridden: (k) => k in overrides, setOverride, revert, replaceAll,
  }), [set, overrides, setOverride, revert, replaceAll]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useConstants(): ConstantsState {
  return useContext(Ctx);
}
