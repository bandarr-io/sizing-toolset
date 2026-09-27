import { forward, reverse } from '@sizing/engine';
import { describe, expect, it } from 'vitest';
import { toJson, toMarkdown } from '../src/export.ts';
import { fastForwardV1ToRequest, migrate } from '../src/migrate.ts';
import {
  withIndexMode,
  defaultState, deploymentOfForward, deploymentOfReverse, newWorkload, normalizeReverse, tiersInUse, uniqueName,
  withForwardDeployment, withReverseDeployment, withSolve,
} from '../src/state.ts';

describe('defaults', () => {
  it('forward default sizes a 500 GB/day LogsDB logs workload', () => {
    const r = forward(defaultState().forward);
    expect(r.tiers.map((t) => [t.tier, t.nodes])).toEqual([['hot', 4], ['frozen', 2]]);
  });
  it('reverse default reproduces §11.2 R1 shape with LogsDB (3 × 64 GB → 102.4 GB/day)', () => {
    const r = reverse(defaultState().reverse);
    expect(r.answer!.value).toBeCloseTo(102.4, 9);
  });
  it('new workload names never collide', () => {
    expect(uniqueName('Logs', ['Logs', 'Logs 2'])).toBe('Logs 3');
    expect(newWorkload('siem', ['Security']).id).toBe('Security 2');
  });
  it('no new workload starts with a warm tier', () => {
    for (const k of ['logs', 'siem', 'metrics', 'apm'] as const) expect(newWorkload(k).retentionDays.warm).toBeUndefined();
    expect(newWorkload('metrics')).toMatchObject({ retentionDays: { hot: 7, frozen: 83 }, downsampleFactor: { frozen: 0.1 } });
  });
  it('leaving TSDS drops downsample factors; staying keeps them', () => {
    const m = newWorkload('metrics');
    expect(withIndexMode(m, 'logsdb').downsampleFactor).toBeUndefined();
    expect(withIndexMode(m, 'logsdb').indexMode).toBe('logsdb');
    expect(withIndexMode(m, 'tsds').downsampleFactor).toEqual({ frozen: 0.1 });
  });
  it('tiersInUse lists only tiers with data, in order', () => {
    expect(tiersInUse({ workloads: [newWorkload('metrics'), newWorkload('vector')], options: { model: 'self_managed' } })).toEqual(['hot', 'frozen', 'content']);
  });
});

describe('reverse question handling', () => {
  const base = defaultState().reverse;
  it('keeps a compatible target first and names it', () => {
    const n = normalizeReverse({ ...base, fixed: [newWorkload('ml'), newWorkload('logs')] });
    expect(n.fixed[0]!.kind).toBe('logs');
    expect(n.targetProfileId).toBe(n.fixed[0]!.id);
  });
  it('switching to max vectors creates a vector target and keeps the other workloads', () => {
    const n = withSolve(base, 'max_vectors');
    expect(n.fixed[0]!.kind).toBe('vector');
    expect(n.fixed.some((p) => p.kind === 'logs')).toBe(true);
    expect(reverse(n).answer!.unit).toBe('vectors');
  });
  it('hardware-only questions add the node group they need', () => {
    expect(withSolve(base, 'max_agents').hardware.groups.some((g) => g.role === 'fleet')).toBe(true);
    expect(reverse(withSolve(base, 'max_ml_jobs')).answer!.value).toBe(30);
  });
  it("years until full starts with today's GB/day and a growth rate, and answers in years", () => {
    const n = withSolve(base, 'years_to_capacity');
    expect(n.fixed[0]).toMatchObject({ rawGbPerDay: 100, growthPctPerYear: 20 });
    const r = reverse(n);
    expect(r.answer!.unit).toBe('years');
    // default hardware (3 × 64 GB hot, LogsDB, 30 d) holds 102.4 GB/day: 100 → 102.4 at 20%/yr
    expect(r.answer!.value).toBeCloseTo(Math.log(102.4 / 100) / Math.log(1.2), 6);
  });
  it('max retention gets a GB/day input', () => {
    expect(withSolve(base, 'max_retention').fixed[0]!.rawGbPerDay).toBeGreaterThan(0);
  });
});

describe('deployment settings round-trip through both modes', () => {
  const d = { model: 'self_managed' as const, sites: 2, ccrMode: 'unidirectional' as const, airGapped: true, autoOps: false, fips: true, fullLogsdb: false, concurrentSearch: true };
  it('forward', () => {
    expect(deploymentOfForward(withForwardDeployment({ model: 'self_managed' }, d))).toEqual(d);
  });
  it('reverse', () => {
    expect(deploymentOfReverse(withReverseDeployment(defaultState().reverse, d))).toEqual(d);
  });
});

describe('migration from v1 scenarios', () => {
  const v1 = {
    version: 1, name: 'Old', mode: 'forward', inputMode: 'fast',
    fastForward: { useCase: 'siem', gbPerDay: 2000, hotDays: 30, totalRetentionDays: 365, replicas: 1, model: 'self_managed' },
    fastReverse: { useCase: 'logs', nodes: 3, ramGb: 64, diskGb: 2000, vcpu: 8, hotDays: 30, replicas: 1, solve: 'max_gb_day', gbPerDay: 100, model: 'self_managed' },
    expertForward: { workloads: [], options: { model: 'self_managed' } },
    expertReverse: { hardware: { model: 'self_managed', groups: [] }, fixed: [], solve: 'max_gb_day' },
    expertDirty: false,
  };
  it('fast v1 scenarios become the equivalent request (D13) and reproduce §11.1 F3', () => {
    const s = migrate(v1)!;
    expect(s.version).toBe(2);
    expect(s.forward.workloads[0]!.retentionDays).toEqual({ hot: 30, frozen: 335 });
    expect(forward(s.forward).tiers.map((t) => t.nodes)).toEqual([41, 2]); // D27: frozen re-baselined
  });
  it('v1 metrics remainder goes to warm with downsampling', () => {
    const req = fastForwardV1ToRequest({ useCase: 'metrics', gbPerDay: 100, hotDays: 7, totalRetentionDays: 37, replicas: 1, model: 'self_managed' });
    expect(req.workloads[0]!.retentionDays).toEqual({ hot: 7, warm: 30 });
    expect(req.workloads[0]!.downsampleFactor).toEqual({ warm: 0.1 });
  });
  it("'object' is no longer a node disk type: saved scenarios get SSD (D26)", () => {
    const s = defaultState();
    s.forward.options.nodes = { frozen: { diskType: 'object' as never, ramGb: 64 } };
    s.reverse.hardware.groups = [{ role: 'frozen', count: 2, ramGb: 64, diskGb: 1920, diskType: 'object' as never, vcpu: 8 }];
    const m = migrate(s)!;
    expect(m.forward.options.nodes!.frozen).toEqual({ diskType: 'ssd', ramGb: 64 });
    expect(m.reverse.hardware.groups[0]!.diskType).toBe('ssd');
  });
  it('v2 passes through and junk is rejected', () => {
    const s = defaultState();
    expect(migrate(s)).toEqual(s);
    expect(migrate({ version: 3 })).toBeUndefined();
    expect(migrate(null)).toBeUndefined();
  });
});

describe('export', () => {
  const state = defaultState();
  const result = forward(state.forward);
  it('Markdown has the disclaimer, node table, assumptions and a Rally plan', () => {
    const md = toMarkdown(state, result, state.forward.workloads, '2026-09-24T00:00:00Z');
    expect(md).toContain('Estimate, not benchmark');
    expect(md).toContain('| hot |');
    expect(md).toContain('## Assumptions');
    expect(md).toContain('elastic/logs');
  });
  it('JSON reproduces the result from the exported scenario (FR-E2)', () => {
    const j = JSON.parse(toJson(state, result, '2026-09-24T00:00:00Z'));
    expect(j.constantsHash).toBe(result.constantsHash);
    expect(forward(migrate(j.scenario)!.forward)).toEqual(result);
  });
});
