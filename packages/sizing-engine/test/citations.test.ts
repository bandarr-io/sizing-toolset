// "Show the math" audit: every formula cites the constants it used, and only those.
// 1. cited ⊆ read: a constant named in a MathStep was actually read to produce the result.
// 2. read and influential ⊆ cited: nudging a constant that moves a headline number must be explained
//    by a MathStep that cites it. Constants that only feed warnings or assumption text are exempt.
import { buildConstantSet, defaultConstants, type Constant, type ConstantSet } from '@sizing/constants';
import { describe, expect, it } from 'vitest';
import {
  forward, reverse, type ForwardRequest, type NodeGroup, type ReverseRequest, type SizingResult, type WorkloadProfile,
} from '../src/index.ts';

type Run = (c: ConstantSet) => SizingResult;

function tracking(base: ConstantSet): { set: ConstantSet; reads: Set<string> } {
  const reads = new Set<string>();
  const byKey = new Map(base.byKey);
  const get = byKey.get.bind(byKey);
  byKey.get = (k: string) => { reads.add(k); return get(k); };
  return { set: { byKey, hash: base.hash }, reads };
}

function cited(r: SizingResult): Set<string> {
  const out = new Set<string>();
  const walk = (x: unknown): void => {
    if (Array.isArray(x)) { x.forEach(walk); return; }
    if (x && typeof x === 'object') {
      const o = x as Record<string, unknown>;
      if (Array.isArray(o.constantKeys) && typeof o.expr === 'string') (o.constantKeys as string[]).forEach((k) => out.add(k));
      Object.values(o).forEach(walk);
    }
  };
  walk(r);
  return out;
}

/** The numbers a person reads off the result. Warnings and assumption text are deliberately excluded. */
function headline(r: SizingResult): string {
  const round = (n: number | undefined) => (n === undefined || !Number.isFinite(n) ? String(n) : n.toPrecision(10));
  return JSON.stringify({
    tiers: r.tiers.map((t) => [t.tier, t.nodes, round(t.ramGb), round(t.diskGb), round(t.vcpu)]),
    overhead: r.overhead.map((o) => [o.role, o.count, round(o.ramGb), round(o.vcpu)]),
    ram: round(r.totalRamGb), eru: r.licenseUnits.value, floor: r.licenseFloor,
    answer: r.answer ? [round(r.answer.value), r.answer.binding, r.answer.dataStreams] : null,
    object: round(r.objectStorage?.gb),
    shards: r.shards ? [r.shards.total, r.shards.indices] : null,
    constraints: r.constraints.map((k) => [k.name, k.tier, round(k.maxValue), round(k.utilization)]),
  });
}

function nudge(v: unknown): unknown {
  if (typeof v === 'number') return v === 0 ? 1 : v * 1.37;
  if (Array.isArray(v)) return v.map(nudge);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, nudge(x)]));
  return v;
}

function withNudged(key: string): ConstantSet {
  const items = [...defaultConstants.byKey.values()].map((c): Constant => (c.key === key ? { ...c, value: nudge(c.value) } : c));
  return buildConstantSet(items);
}

// ---- scenarios: §11 cases plus every feature that has its own formulas -------------------------------

const SM = { model: 'self_managed' as const };
const w = (p: Partial<WorkloadProfile> & Pick<WorkloadProfile, 'id' | 'kind'>): WorkloadProfile => ({ retentionDays: {}, replicas: {}, ...p });
const fwd = (workloads: WorkloadProfile[], options: ForwardRequest['options'] = SM): Run => (c) => forward({ workloads, options }, c);
const hot = (count: number, extra: Partial<NodeGroup> = {}): NodeGroup => ({ role: 'hot', count, ramGb: 64, diskGb: 1920, diskType: 'nvme', vcpu: 8, ...extra });
const rev = (groups: NodeGroup[], fixed: WorkloadProfile[], solve: ReverseRequest['solve'], extra: Partial<ReverseRequest> = {}): Run =>
  (c) => reverse({ hardware: { model: 'self_managed', groups }, fixed, solve, ...extra }, c);
const logs = (p: Partial<WorkloadProfile>) => w({ id: 'logs', kind: 'logs', ...p });

const SCENARIOS: Record<string, Run> = {
  F1: fwd([logs({ rawGbPerDay: 30, indexMode: 'standard', retentionDays: { hot: 30 } })]),
  F2: fwd([logs({ rawGbPerDay: 150, indexMode: 'logsdb', retentionDays: { hot: 30, warm: 90 } }), w({ id: 'm', kind: 'metrics', rawGbPerDay: 50, indexMode: 'tsds', retentionDays: { hot: 30, warm: 90 } })]),
  F3: fwd([w({ id: 's', kind: 'siem', rawGbPerDay: 2000, indexMode: 'logsdb', retentionDays: { hot: 30, frozen: 335 } })]),
  F4: fwd([w({ id: 'm', kind: 'metrics', rawGbPerDay: 500, indexMode: 'tsds', retentionDays: { hot: 7, warm: 30, frozen: 365 }, downsampleFactor: { warm: 0.1, frozen: 0.1 } })]),
  F5: fwd([w({ id: 'apm', kind: 'apm', rawGbPerDay: 200, indexMode: 'standard', retentionDays: { hot: 7, warm: 8 } })]),
  F6: fwd([w({ id: 'search', kind: 'search', totalGb: 2000, indexRatioOverride: 1.0, replicas: { content: 2 } })], { ...SM, coordinatingNodes: 2 }),
  F7bbq: fwd([w({ id: 'v', kind: 'vector', vector: { count: 100_000_000, dims: 1024, quant: 'bbq', hnswM: 16 } })]),
  F7diskbbq: fwd([w({ id: 'v', kind: 'vector', vector: { count: 100_000_000, dims: 1024, quant: 'bbq_disk' } })]),
  F8: fwd([logs({ rawGbPerDay: 30, indexMode: 'standard', retentionDays: { hot: 30 } }), w({ id: 'ml', kind: 'ml', ml: { anomalyJobs: 60, trainedModelsGb: 20 } })]),
  F9: fwd([logs({ rawGbPerDay: 500, indexMode: 'logsdb', retentionDays: { hot: 30, frozen: 335 } })], { ...SM, sites: 2, ccrMode: 'bidirectional', airGapped: true }),
  F10: fwd([logs({ rawGbPerDay: 600, indexMode: 'logsdb', retentionDays: { hot: 30, frozen: 335 } }), w({ id: 'f', kind: 'fleet', fleet: { agents: 40_000, defend: true } })]),
  growthColdRatio: fwd([logs({ rawGbPerDay: 300, indexMode: 'logsdb', growthPctPerYear: 20, ingestPipelines: true, retentionDays: { hot: 3, cold: 27, frozen: 335 } })],
    { ...SM, growthHorizonYears: 3, concurrentSearch: true, nodes: { cold: { memDiskRatio: 120 } } }),
  fixedRollover: fwd([logs({ rawGbPerDay: 100, indexMode: 'standard', rolloverDays: 1, primaryShards: 2, retentionDays: { hot: 14 } })]),
  // Every override path: hand-set node size and vCPU, CPU and disk-write overrides, set event size, set horizon, HA Kibana.
  overrides: fwd([logs({ rawGbPerDay: 800, indexMode: 'logsdb', avgEventKb: 2, growthPctPerYear: 10, rolloverDays: 0.5, primaryShards: 3, retentionDays: { hot: 14, frozen: 351 } })],
    { ...SM, growthHorizonYears: 2, eventsPerSecondPerVcpu: 2500, frozenCacheFraction: 0.2,
      nodes: { hot: { ramGb: 128, vcpu: 32, diskGb: 3840, diskWriteMBps: 400 }, frozen: { ramGb: 32 } } }),
  R1: rev([hot(3, { diskGb: 2000 })], [logs({ indexMode: 'standard', retentionDays: { hot: 30 }, replicas: { hot: 1 } })], 'max_gb_day'),
  R1frozen: rev([hot(41, { vcpu: 64 }), { role: 'frozen', count: 2, ramGb: 64, diskGb: 1920, diskType: 'ssd', vcpu: 8 }],
    [logs({ indexMode: 'logsdb', retentionDays: { hot: 30, frozen: 335 } })], 'max_gb_day'),
  R3: rev([hot(11)], [logs({ indexMode: 'logsdb', rawGbPerDay: 500, retentionDays: { hot: 30 }, replicas: { hot: 1 } })], 'max_retention'),
  R4: rev([hot(13), { role: 'fleet', count: 2, ramGb: 8, diskGb: 0, diskType: 'ssd', vcpu: 8 }], [], 'max_agents'),
  R5: rev([hot(3)], [w({ id: 'v', kind: 'vector', tier: 'hot', vector: { count: 0, dims: 1024, quant: 'bbq', hnswM: 16 }, replicas: { hot: 1 } })], 'max_vectors'),
  R6: rev([hot(3)], [logs({ rawGbPerDay: 100, retentionDays: { hot: 30 }, replicas: { hot: 1 } })], 'max_shards'),
  R7: rev([hot(3), { role: 'ml', count: 3, ramGb: 64, diskGb: 0, diskType: 'ssd', vcpu: 8 }], [], 'max_ml_jobs'),
  years: rev([hot(3, { diskGb: 2000 })], [logs({ indexMode: 'standard', rawGbPerDay: 20, growthPctPerYear: 20, retentionDays: { hot: 30 }, replicas: { hot: 1 } })], 'years_to_capacity'),
  reverseRatio: rev([hot(3, { diskGb: 2000 })], [logs({ indexMode: 'standard', retentionDays: { hot: 30 }, replicas: { hot: 1 } })], 'max_gb_day',
    { hardware: { model: 'self_managed', groups: [hot(3, { diskGb: 2000 })], memDiskRatio: { hot: 25 } } }),
};

describe('show-the-math citations', () => {
  for (const [name, run] of Object.entries(SCENARIOS)) {
    describe(name, () => {
      const t = tracking(defaultConstants);
      const result = run(t.set);
      const cites = cited(result);

      it('cites only constants it actually used', () => {
        expect([...cites].filter((k) => !t.reads.has(k))).toEqual([]);
      });

      it('cites every constant that moves a headline number', () => {
        const base = headline(result);
        const missing: string[] = [];
        for (const key of t.reads) {
          if (cites.has(key)) continue;
          let changed = false;
          try {
            changed = headline(run(withNudged(key))) !== base;
          } catch {
            changed = false; // nudged value is invalid input for this scenario; not a citation question
          }
          if (changed) missing.push(key);
        }
        expect(missing).toEqual([]);
      });
    });
  }
});
