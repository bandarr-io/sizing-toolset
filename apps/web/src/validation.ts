import type { ConstantSet } from '@sizing/constants';
import { forward, type ForwardRequest, type SizingResult, type Tier } from '@sizing/engine';
import { migrate } from './migrate.ts';

/**
 * Validation sheet (SPEC §12 MVP exit: SAs check the calculator against real deals).
 * Each record keeps the Size a workload inputs and the cluster the customer actually runs. Estimates are
 * recalculated with the current settings on every view, so a settings change shows its effect on accuracy.
 */

/** SPEC §12 v3 target: calibrated results within ±15%. Used here as the "close enough" line. */
export const TOLERANCE_PCT = 15;

export const VALIDATION_TIERS: Tier[] = ['content', 'hot', 'warm', 'cold', 'frozen'];

export interface ActualCluster {
  /** Data nodes per tier, per site. Blank tiers are not compared. */
  nodes: Partial<Record<Tier, number>>;
  totalRamGb?: number;
  eru?: number;
}

export interface ValidationRecord {
  id: string;
  deal: string;
  checkedBy?: string;
  addedAt: string;
  request: ForwardRequest;
  actual: ActualCluster;
  notes?: string;
}

export interface Comparison {
  key: string;
  label: string;
  estimated: number;
  actual?: number;
  /** (estimated − actual) / actual × 100; positive means the calculator asks for more than they run. */
  diffPct?: number;
  within?: boolean;
}

const TIER_NAME: Record<Tier, string> = { content: 'Content', hot: 'Hot', warm: 'Warm', cold: 'Cold', frozen: 'Frozen' };

export function diffPct(estimated: number, actual: number | undefined): number | undefined {
  if (actual === undefined || !(actual > 0)) return undefined;
  return ((estimated - actual) / actual) * 100;
}

function row(key: string, label: string, estimated: number, actual: number | undefined): Comparison {
  const d = diffPct(estimated, actual);
  return { key, label, estimated, ...(actual !== undefined ? { actual } : {}), ...(d !== undefined ? { diffPct: d, within: Math.abs(d) <= TOLERANCE_PCT } : {}) };
}

/** Estimate against actual for one deal. Tiers appear if either side has nodes there. */
export function compareRecord(c: ConstantSet, rec: ValidationRecord): { rows: Comparison[]; result: SizingResult } | { error: string } {
  let result: SizingResult;
  try {
    result = forward(rec.request, c);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  const rows: Comparison[] = [];
  for (const t of VALIDATION_TIERS) {
    const est = result.tiers.find((x) => x.tier === t)?.nodes ?? 0;
    const act = rec.actual.nodes[t];
    if (est > 0 || act !== undefined) rows.push(row(`nodes.${t}`, `${TIER_NAME[t]} nodes`, est, act));
  }
  rows.push(row('totalRamGb', 'Total memory (GB)', result.totalRamGb, rec.actual.totalRamGb));
  rows.push(row('eru', 'License units (ERU)', result.licenseUnits.value, rec.actual.eru));
  return { rows, result };
}

export interface MetricSummary {
  key: string;
  label: string;
  deals: number;
  /** Median of |difference %| across deals with an actual value. */
  medianAbsDiffPct: number;
  /** Median signed difference: positive means the calculator tends to ask for more. */
  medianDiffPct: number;
  withinShare: number;
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/** Accuracy per metric across every deal that has an actual value for it. */
export function summarize(c: ConstantSet, records: readonly ValidationRecord[]): MetricSummary[] {
  const by = new Map<string, { label: string; diffs: number[] }>();
  for (const rec of records) {
    const cmp = compareRecord(c, rec);
    if ('error' in cmp) continue;
    for (const r of cmp.rows) {
      if (r.diffPct === undefined) continue;
      const e = by.get(r.key) ?? { label: r.label, diffs: [] };
      e.diffs.push(r.diffPct);
      by.set(r.key, e);
    }
  }
  const order = [...VALIDATION_TIERS.map((t) => `nodes.${t}`), 'totalRamGb', 'eru'];
  return [...by.entries()]
    .sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
    .map(([key, { label, diffs }]) => ({
      key, label, deals: diffs.length,
      medianAbsDiffPct: median(diffs.map(Math.abs)),
      medianDiffPct: median(diffs),
      withinShare: diffs.filter((d) => Math.abs(d) <= TOLERANCE_PCT).length / diffs.length,
    }));
}

const csvCell = (v: string | number | undefined): string => {
  if (v === undefined) return '';
  const s = typeof v === 'number' ? String(Math.round(v * 10) / 10) : v;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** One line per deal and metric, for a spreadsheet. */
export function toCsv(c: ConstantSet, records: readonly ValidationRecord[]): string {
  const lines = [['Deal', 'Checked by', 'Added', 'Metric', 'Estimated', 'Actual', 'Difference %', `Within ±${TOLERANCE_PCT}%`, 'Settings', 'Notes'].join(',')];
  for (const rec of records) {
    const cmp = compareRecord(c, rec);
    if ('error' in cmp) {
      lines.push([rec.deal, rec.checkedBy, rec.addedAt.slice(0, 10), 'error', undefined, undefined, undefined, undefined, c.hash.slice(0, 8), cmp.error].map(csvCell).join(','));
      continue;
    }
    for (const r of cmp.rows) {
      lines.push([rec.deal, rec.checkedBy, rec.addedAt.slice(0, 10), r.label, r.estimated, r.actual, r.diffPct, r.within === undefined ? undefined : r.within ? 'yes' : 'no', c.hash.slice(0, 8), rec.notes].map(csvCell).join(','));
    }
  }
  return lines.join('\n') + '\n';
}

/** Records from an exported file, or undefined if it is not one. Requests go through scenario migration. */
export function parseRecords(x: unknown): ValidationRecord[] | undefined {
  const list = (x && typeof x === 'object' && 'records' in x ? (x as { records: unknown }).records : x) as unknown;
  if (!Array.isArray(list)) return undefined;
  const out: ValidationRecord[] = [];
  for (const r of list as Partial<ValidationRecord>[]) {
    if (!r || typeof r.id !== 'string' || typeof r.deal !== 'string' || !r.request || !r.actual) return undefined;
    const migrated = migrate({ version: 2, name: r.deal, mode: 'forward', forward: r.request, reverse: { hardware: { model: 'self_managed', groups: [] }, fixed: [], solve: 'max_gb_day' } });
    if (!migrated) return undefined;
    out.push({ ...(r as ValidationRecord), request: migrated.forward, actual: { nodes: r.actual.nodes ?? {}, ...(r.actual.totalRamGb !== undefined ? { totalRamGb: r.actual.totalRamGb } : {}), ...(r.actual.eru !== undefined ? { eru: r.actual.eru } : {}) } });
  }
  return out;
}

/** Imported records replace ones with the same id and add the rest. */
export function mergeRecords(existing: readonly ValidationRecord[], incoming: readonly ValidationRecord[]): ValidationRecord[] {
  const ids = new Set(incoming.map((r) => r.id));
  return [...existing.filter((r) => !ids.has(r.id)), ...incoming];
}

// ---- Browser storage (per-browser until shared scenarios arrive with apps/api) -----------------------

const KEY = 'sizing.validation.v1';

export function loadRecords(): ValidationRecord[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    return (raw && parseRecords(JSON.parse(raw))) || [];
  } catch {
    return [];
  }
}

export function saveRecords(records: readonly ValidationRecord[]): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(records));
  } catch {
    // Storage blocked or full: the sheet keeps working for this visit.
  }
}
