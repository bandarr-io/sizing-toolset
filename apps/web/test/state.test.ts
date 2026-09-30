import { forward, reverse, type NodeGroup, type ServerGroup } from '@sizing/engine';
import { describe, expect, it } from 'vitest';
import { toJson, toMarkdown } from '../src/export.ts';
import { fastForwardV1ToRequest, migrate } from '../src/migrate.ts';
import {
  withIndexMode,
  defaultState, deploymentOfForward, deploymentOfReverse, newGroup, newWorkload, normalizeReverse, tiersInUse, uniqueName,
  withForwardDeployment, withReverseDeployment, withSolve,
} from '../src/state.ts';

describe('defaults', () => {
  it('forward default sizes a 500 GB/day LogsDB logs workload', () => {
    const r = forward(defaultState().forward);
    // D38: 250 × 7 × 2 × 1.25 = 4,375 GB / 3,200 = 1.37 → 2 + 1 = 3 hot
    expect(r.tiers.map((t) => [t.tier, t.nodes])).toEqual([['hot', 3], ['frozen', 2]]);
  });
  it('reverse default: 3 × 64 GB hot with 3,200 GB disk (D38), LogsDB, 30 d → 2 × 3,200 / 1.25 / 30 = 170.67 GB/day', () => {
    const r = reverse(defaultState().reverse);
    expect(r.answer!.value).toBeCloseTo(6400 / 1.25 / 30, 9);
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
    expect(tiersInUse({ workloads: [newWorkload('metrics'), newWorkload('vector')], options: { model: 'self_managed' } })).toEqual(['content', 'hot', 'frozen']);
  });
});

describe('starter templates (Size a workload)', () => {
  it('build realistic workloads from newWorkload, replacing the list', async () => {
    const { defaultConstants } = await import('@sizing/constants');
    const { applyTemplate, TEMPLATES } = await import('../src/state.ts');
    expect(TEMPLATES.map((t) => t.id)).toEqual(['siem', 'observability', 'search', 'vector']);
    expect(applyTemplate('siem')).toMatchObject([{ kind: 'siem', rawGbPerDay: 500, indexMode: 'logsdb', retentionDays: { hot: 30, frozen: 335 } }]);
    const obs = applyTemplate('observability');
    expect(obs.map((w) => [w.kind, w.rawGbPerDay])).toEqual([['logs', 200], ['metrics', 50], ['apm', 50]]);
    expect(new Set(obs.map((w) => w.id)).size).toBe(3);
    expect(obs[1]!.downsampleFactor).toEqual({ frozen: 0.1 }); // the settings-driven default is kept
    expect(applyTemplate('search')[0]).toMatchObject({ kind: 'search', totalGb: 500 });
    expect(applyTemplate('vector')[0]!.vector).toMatchObject({ count: 10_000_000, dims: 1024, quant: 'bbq' });
    for (const t of TEMPLATES) expect(() => forward({ workloads: t.build(defaultConstants), options: { model: 'self_managed' } })).not.toThrow();
  });
});

describe('Plan for growth folding', () => {
  it('starts folded with no rates, and summarizes the horizon and rates when set', async () => {
    const { defaultConstants } = await import('@sizing/constants');
    const { growthSummary, isDefaultGrowth } = await import('../src/state.ts');
    const f = defaultState().forward;
    expect(isDefaultGrowth(f)).toBe(true);
    expect(growthSummary(defaultConstants, f)).toMatch(/No growth set/);
    const grown = { ...f, workloads: [{ ...f.workloads[0]!, growthPctPerYear: 20 }], options: { ...f.options, growthHorizonYears: 3 } };
    expect(isDefaultGrowth(grown)).toBe(false);
    expect(growthSummary(defaultConstants, grown)).toBe(`Sized for 3 years · ${f.workloads[0]!.id} 20% a year`);
  });
});

describe('folded card summaries', () => {
  it('lists workloads and server groups in a line', async () => {
    const { groupsSummary, workloadsSummary, defaultServers } = await import('../src/state.ts');
    expect(workloadsSummary([])).toBe('No workloads yet');
    expect(workloadsSummary([{ ...newWorkload('logs'), rawGbPerDay: 500 }])).toBe('1 workload: Logs 500 GB/day');
    expect(groupsSummary(defaultServers())).toMatch(/^35 servers: 3 master × 32 GB, 22 hot × 256 GB/);
    expect(groupsSummary([], 'nodes')).toBe('No nodes yet');
  });
});

describe('reverse question handling', () => {
  const base = defaultState().reverse;
  it('keeps a compatible target first and names it', () => {
    const n = normalizeReverse({ ...base, fixed: [newWorkload('ml'), newWorkload('logs')] });
    expect(n.fixed[0]!.kind).toBe('logs');
    expect(n.targetProfileId).toBe(n.fixed[0]!.id);
  });
  it('switching to max vectors creates a vector target and keeps only the solved workload', () => {
    const n = withSolve(base, 'max_vectors');
    expect(n.fixed.map((p) => p.kind)).toEqual(['vector']);
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
    // default hardware (3 × 64 GB hot, 3,200 GB disk, LogsDB, 30 d) holds 170.67 GB/day: 100 → 170.67 at 20%/yr
    expect(r.answer!.value).toBeCloseTo(Math.log(6400 / 1.25 / 30 / 100) / Math.log(1.2), 6);
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
    expect(forward(s.forward).tiers.map((t) => t.nodes)).toEqual([25, 2]); // D27 frozen, D38 hot re-baselined
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
  it('node table lists roles in display order: data tiers, then Kibana before master', () => {
    const big = { ...state.forward, workloads: [{ ...state.forward.workloads[0]!, rawGbPerDay: 2000 }] };
    const md = toMarkdown(state, forward(big), big.workloads, '2026-09-24T00:00:00Z');
    const at = (row: string) => md.indexOf(`| ${row}`);
    expect(at('hot')).toBeLessThan(at('frozen'));
    expect(at('frozen')).toBeLessThan(at('kibana'));
    expect(at('kibana')).toBeLessThan(at('master'));
  });
  it('JSON reproduces the result from the exported scenario (FR-E2)', () => {
    const j = JSON.parse(toJson(state, result, '2026-09-24T00:00:00Z'));
    expect(j.constantsHash).toBe(result.constantsHash);
    expect(forward(migrate(j.scenario)!.forward)).toEqual(result);
  });
});

describe('role order (node sizes, hardware and server tables)', () => {
  it('sorts content, data tiers, then Kibana, master, ML, coordinating, Fleet and APM, keeping original indices', async () => {
    const { inRoleOrder } = await import('../src/ui/tiers.ts');
    const rows = ['apm', 'hot', 'master', 'frozen', 'kibana', 'content', 'hot', 'fleet', 'ml', 'coordinating', 'cold', 'warm'].map((role) => ({ role: role as never }));
    const sorted = inRoleOrder(rows);
    expect(sorted.map((x) => x.g.role)).toEqual(['content', 'hot', 'hot', 'warm', 'cold', 'frozen', 'kibana', 'master', 'ml', 'coordinating', 'fleet', 'apm']);
    expect(sorted.filter((x) => x.g.role === 'hot').map((x) => x.i)).toEqual([1, 6]);
  });
});

describe('automatic dedicated masters when data nodes cross the threshold', () => {
  it('adds 3 × 16 GB masters at 6 data nodes, sized from masters.sizing', async () => {
    const { defaultConstants: c } = await import('@sizing/constants');
    const { withAutoMasters, dataNodesOfGroups, masterGroup } = await import('../src/state.ts');
    const prev = [newGroup('hot')]; // 3 hot
    const next = [{ ...newGroup('hot'), count: 4 }, newGroup('frozen')]; // 6 data nodes, frozen counts (D4)
    const r = withAutoMasters(c, prev, next, dataNodesOfGroups, (row) => masterGroup(c, row));
    expect(r.added).toMatchObject({ count: 3, ramGb: 16 });
    expect(r.groups.find((g) => g.role === 'master')).toMatchObject({ count: 3, ramGb: 16, vcpu: 2 });
  });
  it('does nothing below the threshold, when masters exist, or when already above it (so deleting them sticks)', async () => {
    const { defaultConstants: c } = await import('@sizing/constants');
    const { withAutoMasters, dataNodesOfGroups, masterGroup } = await import('../src/state.ts');
    const make = (row: Parameters<typeof masterGroup>[1]) => masterGroup(c, row);
    const hotGroups = (n: number): NodeGroup[] => [{ ...newGroup('hot'), count: n }];
        expect(withAutoMasters(c, hotGroups(3), hotGroups(5), dataNodesOfGroups, make).added).toBeUndefined();
    expect(withAutoMasters(c, hotGroups(3), [...hotGroups(8), newGroup('master')], dataNodesOfGroups, make).added).toBeUndefined();
    expect(withAutoMasters(c, [...hotGroups(8), newGroup('master')], hotGroups(8), dataNodesOfGroups, make).added).toBeUndefined();
  });
  it('removes masters when data nodes drop below 6, unless they are the ECE control plane', async () => {
    const { defaultConstants: c } = await import('@sizing/constants');
    const { withAutoMasters, dataNodesOfGroups, masterGroup } = await import('../src/state.ts');
    const make = (row: Parameters<typeof masterGroup>[1]) => masterGroup(c, row);
    const withMasters = [{ ...newGroup('hot'), count: 6 }, newGroup('master')];
    const shrunk = [{ ...newGroup('hot'), count: 5 }, newGroup('master')];
    const r = withAutoMasters(c, withMasters, shrunk, dataNodesOfGroups, make);
    expect(r.removed).toBe(3);
    expect(r.groups.map((g) => g.role)).toEqual(['hot']);
    expect(withAutoMasters(c, withMasters, shrunk, dataNodesOfGroups, make, false).groups).toEqual(shrunk);
    // masters added by hand below the threshold stay
    expect(withAutoMasters(c, [{ ...newGroup('hot'), count: 3 }], [{ ...newGroup('hot'), count: 3 }, newGroup('master')], dataNodesOfGroups, make).removed).toBeUndefined();
  });
  it('counts nodes per server on physical servers: 2 × 256 GB hot servers hold 8 nodes', async () => {
    const { defaultConstants: c } = await import('@sizing/constants');
    const { withAutoMasters, dataNodesOfServers, masterServers } = await import('../src/state.ts');
    const hot = (n: number): ServerGroup[] => [{ role: 'hot', count: n, ramGb: 256, diskGb: 7680, diskType: 'nvme', vcpu: 64 }];
    expect(dataNodesOfServers(c, hot(2))).toBe(8);
    const r = withAutoMasters(c, hot(1), hot(2), (gs) => dataNodesOfServers(c, gs), (row) => masterServers(c, row));
    expect(r.groups.find((g) => g.role === 'master')).toMatchObject({ count: 3, ramGb: 16 });
  });
});

describe('new workloads read their defaults from settings (D41)', () => {
  it('metrics downsample with downsample.default_factor; vectors use BBQ from knn.bbq_default_min_dims', async () => {
    const { buildConstantSet, defaultConstants } = await import('@sizing/constants');
    const set = (key: string, value: unknown) => buildConstantSet([...defaultConstants.byKey.values()].map((x) => (x.key === key ? { ...x, value } : x)));
    expect(newWorkload('metrics', [], set('downsample.default_factor', 0.2)).downsampleFactor).toEqual({ frozen: 0.2 });
    expect(newWorkload('vector').vector!.quant).toBe('bbq');
    expect(newWorkload('vector', [], set('knn.bbq_default_min_dims', 2048)).vector!.quant).toBe('int8');
  });
});
