// SPEC §5.7 hardware validation (HV1–HV12) and §5.8 bottleneck + confidence.
import { defaultConstants } from '@sizing/constants';
import { describe, expect, it } from 'vitest';
import { forward, reverse, type NodeGroup, type Warning } from '../src/index.ts';
import { validateHardware, type ValidationInput } from '../src/validation.ts';

const hot = (count: number, extra: Partial<NodeGroup> = {}): NodeGroup => ({
  role: 'hot', count, ramGb: 64, diskGb: 1920, diskType: 'nvme', vcpu: 8, ...extra,
});
const base: ValidationInput = { groups: [hot(3)], airGapped: false, autoOps: false, replicasByTier: { hot: 1 }, agents: 0 };
const run = (v: Partial<ValidationInput>) => validateHardware(defaultConstants, { ...base, ...v });
const ids = (w: Warning[]) => w.map((x) => `${x.id}/${x.severity}`);

describe('§5.7 hardware validation', () => {
  it('baseline 3×64 GB hot, 1:30, 1:8 vCPU raises nothing', () => {
    expect(run({})).toEqual([]);
  });

  it('HV1: data node > 64 GB warns; ML and frozen get an info note', () => {
    expect(ids(run({ groups: [hot(3, { ramGb: 128, diskGb: 3840, vcpu: 16, heapGbOverride: 30 })] }))).toContain('HV1/warn');
    const ml: NodeGroup = { role: 'ml', count: 2, ramGb: 128, diskGb: 0, diskType: 'ssd', vcpu: 16 };
    expect(ids(run({ groups: [hot(3), ml] }))).toContain('HV1/info');
  });

  it('HV2: heap > 30 GB (D19) or > 50% RAM is an error', () => {
    expect(ids(run({ groups: [hot(3, { heapGbOverride: 31 })] }))).toContain('HV2/error');
    expect(ids(run({ groups: [hot(3, { ramGb: 32, diskGb: 960, vcpu: 4, heapGbOverride: 20 })] }))).toContain('HV2/error');
    expect(ids(run({ groups: [hot(3, { heapGbOverride: 30 })] }))).not.toContain('HV2/error');
  });

  it('HV3: HDD on hot or content is an error; HDD on warm is fine', () => {
    expect(ids(run({ groups: [hot(3, { diskType: 'hdd' })] }))).toContain('HV3/error');
    const warm: NodeGroup = { role: 'warm', count: 2, ramGb: 64, diskGb: 10240, diskType: 'hdd', vcpu: 8 };
    expect(ids(run({ groups: [hot(3), warm] }))).not.toContain('HV3/error');
  });

  it('HV4: mem:disk outside the tier band warns with the effective ratio', () => {
    const w = run({ groups: [hot(3, { diskGb: 64 * 50 })] });
    expect(ids(w)).toContain('HV4/warn');
    expect(w.find((x) => x.id === 'HV4')!.message).toMatch(/1:50/);
    const warm: NodeGroup = { role: 'warm', count: 2, ramGb: 64, diskGb: 64 * 90, diskType: 'ssd', vcpu: 8 };
    expect(ids(run({ groups: [hot(3), warm] }))).toContain('HV4/warn');
  });

  it('HV4 does not fire inside the band (D1: 1:15.6 is inside 1:15–1:45)', () => {
    expect(ids(run({ groups: [hot(3, { diskGb: 1000 })] }))).not.toContain('HV4/warn');
  });

  it('HV5: disk below RAM × ratio is info (disk-bound)', () => {
    expect(ids(run({ groups: [hot(3, { diskGb: 1000 })] }))).toContain('HV5/info');
  });

  it('HV6: master topology', () => {
    const masters = (count: number): NodeGroup => ({ role: 'master', count, ramGb: 16, diskGb: 0, diskType: 'ssd', vcpu: 2 });
    expect(ids(run({ groups: [hot(6), masters(2)] }))).toContain('HV6/error');
    expect(ids(run({ groups: [hot(6), masters(4)] }))).toContain('HV6/warn');
    expect(ids(run({ groups: [hot(6), masters(3)] }))).not.toContain('HV6/warn');
    expect(ids(run({ groups: [hot(6)] }))).toContain('HV6/warn');
    expect(ids(run({ groups: [hot(2)] }))).toContain('HV6/error');
  });

  it('HV7: projected disk above the 85% low watermark warns', () => {
    // 3 × 1,920 GB; after losing one node, 3,840 GB usable. 3,500 GB of data = 91%.
    expect(ids(run({ dataGbByTier: { hot: 3500 } }))).toContain('HV7/warn');
    expect(ids(run({ dataGbByTier: { hot: 3000 } }))).not.toContain('HV7/warn');
  });

  it('HV8: too many shards per node, or shards outside 10–50 GB', () => {
    const shards = { indices: 10, nonFrozenShards: 4000, frozenShards: 0, shardSizes: [] };
    expect(ids(run({ shards }))).toContain('HV8/warn');
    const big = { indices: 1, nonFrozenShards: 2, frozenShards: 0, shardSizes: [{ profileId: 'x', tier: 'hot' as const, shardGb: 300, primaries: 1 }] };
    const w = run({ shards: big });
    expect(ids(w)).toContain('HV8/warn');
    expect(w.find((x) => x.id === 'HV8')!.message).toMatch(/≥ 6 primaries/);
  });

  it('HV9: single node per tier with replicas ≥ 1 is an error', () => {
    const warm: NodeGroup = { role: 'warm', count: 1, ramGb: 64, diskGb: 10240, diskType: 'ssd', vcpu: 8 };
    expect(ids(run({ groups: [hot(3), warm], replicasByTier: { hot: 1, warm: 1 } }))).toContain('HV9/error');
    expect(ids(run({ groups: [hot(3), warm], replicasByTier: { hot: 1, warm: 0 } }))).not.toContain('HV9/error');
  });

  it('HV10: air-gapped with AutoOps is an error', () => {
    expect(ids(run({ airGapped: true, autoOps: true }))).toContain('HV10/error');
    expect(ids(run({ airGapped: true, autoOps: false }))).not.toContain('HV10/error');
  });

  it('HV11: hot vCPU:RAM below 1:8 warns; exactly 1:8 does not', () => {
    expect(ids(run({ groups: [hot(3, { vcpu: 4 })] }))).toContain('HV11/warn');
    expect(ids(run({ groups: [hot(3, { vcpu: 8 })] }))).not.toContain('HV11/warn');
  });

  it('HV12: agents above the Fleet memory row, or hot tier below the table floor', () => {
    const fleet = (ramGb: number): NodeGroup => ({ role: 'fleet', count: 2, ramGb, diskGb: 0, diskType: 'ssd', vcpu: 8 });
    expect(ids(run({ groups: [hot(13), fleet(4)], agents: 8000 }))).toContain('HV12/warn');
    expect(ids(run({ groups: [hot(3), fleet(8)], agents: 40000 }))).toContain('HV12/warn');
    expect(ids(run({ groups: [hot(13), fleet(8)], agents: 40000 })).filter((x) => x === 'HV12/warn')).toEqual([]);
  });
});

describe('§5.8 bottleneck and confidence', () => {
  it('forward: binding = highest utilization; query is never binding', () => {
    const r = forward({
      workloads: [{ id: 'a', kind: 'logs', rawGbPerDay: 30, indexMode: 'standard', retentionDays: { hot: 30 }, replicas: {} }],
      options: { model: 'self_managed' },
    });
    const binding = r.constraints.filter((k) => k.binding);
    expect(binding).toHaveLength(1);
    const max = Math.max(...r.constraints.filter((k) => k.utilization !== undefined).map((k) => k.utilization!));
    expect(binding[0]!.utilization).toBe(max);
    expect(r.constraints.find((k) => k.name === 'query')!.binding).toBe(false);
  });

  it('confidence per constraint follows §5.8', () => {
    const r = forward({
      workloads: [
        { id: 'l', kind: 'logs', rawGbPerDay: 600, retentionDays: { hot: 30, frozen: 335 }, replicas: {} },
        { id: 'f', kind: 'fleet', fleet: { agents: 40_000, defend: true }, retentionDays: {}, replicas: {} },
        { id: 'm', kind: 'ml', ml: { anomalyJobs: 20 }, retentionDays: {}, replicas: {} },
      ],
      options: { model: 'self_managed' },
    });
    const conf = Object.fromEntries(r.constraints.map((k) => [k.name, k.confidence]));
    expect(conf).toMatchObject({
      storage: 'high', frozen: 'medium', heap_shards: 'medium', masters: 'medium', fleet: 'medium', cpu_ingest: 'low', query: 'low', ml: 'low',
    });
    for (const k of r.constraints.filter((x) => x.name === 'cpu_ingest' || x.name === 'query')) expect(k.rallyRequired).toBe(true);
  });

  it('DiskBBQ vectors are Low confidence in reverse mode', () => {
    const r = reverse({
      hardware: { model: 'self_managed', groups: [hot(3)] },
      fixed: [{ id: 'v', kind: 'vector', tier: 'hot', vector: { count: 0, dims: 1024, quant: 'bbq_disk' }, retentionDays: {}, replicas: {} }],
      solve: 'max_vectors',
    });
    expect(r.constraints.find((k) => k.name === 'vector_offheap')!.confidence).toBe('low');
  });

  it('reverse: every constraint reports utilization so headroom is visible', () => {
    const r = reverse({
      hardware: { model: 'self_managed', groups: [hot(3, { diskGb: 2000 })] },
      fixed: [{ id: 'w', kind: 'logs', indexMode: 'standard', retentionDays: { hot: 30 }, replicas: {} }],
      solve: 'max_gb_day',
    });
    for (const k of r.constraints) expect(k.utilization).toBeDefined();
    expect(r.constraints.find((k) => k.binding)!.utilization).toBe(1);
  });
});
