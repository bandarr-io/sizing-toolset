// Plain-language results: a one-sentence summary, change indicators and warning groups. Pure, so tests need no UI.
import type { Constraint, SizingResult } from '@sizing/engine';
import { constraintLabel } from '../export.ts';
import { fmtCompact, fmtMoney, fmtNum } from '../format.ts';
import { byRoleOrder } from '../ui/tiers.ts';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "a, b and c" */
export function joinAnd(parts: readonly string[]): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** Supporting roles in words: "3 masters", "2 Kibana", "1 machine learning node". */
const ROLE_WORDS: Record<string, [string, string]> = {
  master: ['master', 'masters'], kibana: ['Kibana', 'Kibana'], ml: ['machine learning node', 'machine learning nodes'],
  coordinating: ['coordinating node', 'coordinating nodes'], fleet: ['Fleet Server', 'Fleet Servers'], apm: ['APM Server', 'APM Servers'],
};
const roleText = (role: string, n: number) => {
  const w = ROLE_WORDS[role] ?? [role, role];
  return `${n} ${n === 1 ? w[0] : w[1]}`;
};

/** "Hot disk runs out first." from a constraint name and tier. */
export function runsOutFirst(name: string, tier?: string): string {
  const label = constraintLabel(name).replace(/\s*\(.*\)$/, '').toLowerCase();
  return tier && name !== 'frozen' ? `${cap(tier)} ${label} runs out first.` : `The ${label} runs out first.`;
}

const measurable = (k: Constraint) => k.name !== 'query' && k.utilization !== undefined && Number.isFinite(k.utilization);

/** Size a workload: "You need 11 nodes: 3 hot and 2 frozen for the data, plus 3 masters and 2 Kibana. Hot disk runs out first." */
function sizingSentence(r: SizingResult): string {
  const data = byRoleOrder(r.tiers.filter((t) => t.nodes > 0).map((t) => ({ role: t.tier as string, text: `${t.nodes} ${t.tier}` })));
  const support = byRoleOrder(r.overhead.filter((o) => o.count > 0).map((o) => ({ role: o.role as string, text: roleText(o.role, o.count) })));
  const total = r.tiers.reduce((s, t) => s + t.nodes, 0) + r.overhead.reduce((s, o) => s + o.count, 0);
  let s = `You need ${total} ${total === 1 ? 'node' : 'nodes'}${r.sites > 1 ? ' per site' : ''}`;
  if (data.length) s += `: ${joinAnd(data.map((x) => x.text))} for the data`;
  if (support.length) s += `${data.length ? ', plus' : ':'} ${joinAnd(support.map((x) => x.text))}`;
  s += '.';
  const top = [...r.constraints].filter(measurable).sort((a, b) => b.utilization! - a.utilization!)[0];
  return top ? `${s} ${runsOutFirst(top.name, top.tier)}` : s;
}

/** Test hardware limits: "This hardware can take about 153 GB a day. Hot disk runs out first." */
function limitsSentence(r: SizingResult): string {
  const a = r.answer!;
  const v = a.value;
  let s: string;
  switch (a.unit) {
    case 'GB/day': s = `This hardware can take about ${fmtNum(v, v < 100 ? 1 : 0)} GB a day.`; break;
    case 'days': s = `This hardware can keep the data for about ${fmtNum(v, 0)} days.`; break;
    case 'vectors': s = `This hardware can hold about ${fmtCompact(v)} vectors.`; break;
    case 'shards': s = `This hardware can hold about ${fmtNum(v, 0)} shards.`; break;
    case 'agents': s = `This hardware can manage about ${fmtNum(v, 0)} agents.`; break;
    case 'jobs': s = `This hardware can run about ${fmtNum(v, 0)} machine learning jobs.`; break;
    case 'years':
      s = !Number.isFinite(v) ? 'At this growth the hardware never fills up.'
        : v === 0 ? 'This hardware is already full.'
          : v < 1 ? `This hardware fills up in about ${fmtNum(v * 12, 0)} months.` : `This hardware fills up in about ${fmtNum(v, 1)} years.`;
      break;
    default: s = `The answer is about ${fmtCompact(v)} ${a.unit}.`;
  }
  return `${s} ${runsOutFirst(a.binding, a.bindingTier)}`;
}

export function resultSentence(r: SizingResult): string {
  return r.answer ? limitsSentence(r) : sizingSentence(r);
}

/** Elastic Cloud: "About $102,993 a year at list price for 2 use cases." */
export function echSentence(annual: number, useCases: number, failed = 0): string {
  const s = `About ${fmtMoney(annual)} a year at list price for ${useCases} ${useCases === 1 ? 'use case' : 'use cases'}.`;
  return failed ? `${s} ${failed} ${failed === 1 ? 'use case' : 'use cases'} could not be priced yet.` : s;
}

// ---- Change indicators ------------------------------------------------------------------------------

export type DeltaKind = 'count' | 'gb' | 'money' | 'number';

/** "+2", "−48 GB", "+$18,000"; undefined when nothing moved or there is nothing to compare. */
export function formatDelta(prev: number | undefined, next: number | undefined, kind: DeltaKind): string | undefined {
  if (prev === undefined || next === undefined || !Number.isFinite(prev) || !Number.isFinite(next)) return undefined;
  const d = next - prev;
  if (Math.abs(d) < 1e-9 || (kind !== 'count' && Math.abs(d) < 0.5)) return undefined;
  const sign = d > 0 ? '+' : '−';
  const abs = Math.abs(d);
  switch (kind) {
    case 'count': return `${sign}${fmtNum(abs, 0)}`;
    case 'gb': return `${sign}${fmtNum(abs, abs < 10 ? 1 : 0)} GB`;
    case 'money': return `${sign}${fmtMoney(abs)}`;
    case 'number': return `${sign}${fmtCompact(abs)}`;
  }
}

/** The headline numbers each view watches for changes. */
export function sizingHeadlines(r: SizingResult): Record<string, number> {
  const out: Record<string, number> = { memory: r.totalRamGb, eru: r.licenseUnits.value };
  if (r.answer) out.answer = r.answer.value;
  else out.nodes = r.tiers.reduce((s, t) => s + t.nodes, 0) + r.overhead.reduce((s, o) => s + o.count, 0);
  return out;
}

/**
 * Deltas between the last two different sets of headline numbers. `memo` carries the state between renders:
 * the last values seen and the deltas of the last change, so a re-render with the same values keeps showing them.
 */
export interface DeltaMemo { key: string; values: Record<string, number>; deltas: Record<string, number> }
export function nextDeltas(memo: DeltaMemo | undefined, values: Record<string, number>): DeltaMemo {
  const key = JSON.stringify(values);
  if (!memo) return { key, values, deltas: {} };
  if (memo.key === key) return memo;
  const deltas: Record<string, number> = {};
  for (const [k, v] of Object.entries(values)) {
    const p = memo.values[k];
    if (p !== undefined && Number.isFinite(p) && Number.isFinite(v) && Math.abs(v - p) > 1e-9) deltas[k] = p;
  }
  return { key, values, deltas };
}

// ---- Warnings by severity -----------------------------------------------------------------------------

export type Severity = 'error' | 'warn' | 'info';

/** Elastic Cloud warnings are sentences: an unpriced line is a problem, region facts are notes, the rest worth a look. */
export function echSeverity(message: string): Severity {
  if (/leaves this line out of the total|Cannot price/i.test(message)) return 'error';
  if (/US government region|not listed as authorized|Marketplace prices/i.test(message)) return 'info';
  return 'warn';
}
