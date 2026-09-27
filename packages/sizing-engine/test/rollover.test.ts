// Size-or-age rollover (D31): a data stream rolls over when a primary shard reaches 50 GB or the index
// reaches 30 days, whichever comes first. A days value set on the workload overrides both.
import { defaultConstants } from '@sizing/constants';
import { describe, expect, it } from 'vitest';
import { forward, reverse, type NodeGroup, type WorkloadProfile } from '../src/index.ts';
import { rolloverFor } from '../src/demand.ts';

const logs = (p: Partial<WorkloadProfile>): WorkloadProfile => ({
  id: 'l', kind: 'logs', indexMode: 'logsdb', retentionDays: { hot: 7, frozen: 83 }, replicas: {}, ...p,
});
const SM = { model: 'self_managed' as const };

describe('rolloverFor', () => {
  it('rolls over on size when volume is high: 50 GB × 1 primary / 250 GB/day = 0.2 days', () => {
    const r = rolloverFor(defaultConstants, logs({ rawGbPerDay: 500 }), 0);
    expect(r.days).toBeCloseTo(0.2, 12);
    expect(r.basis).toBe('size');
  });

  it('more primaries roll over less often: 5 primaries → 1 day', () => {
    expect(rolloverFor(defaultConstants, logs({ rawGbPerDay: 500, primaryShards: 5 }), 0).days).toBeCloseTo(1, 12);
  });

  it('rolls over on age when volume is low: 1 GB/day LogsDB would take 100 days, capped at 30', () => {
    const r = rolloverFor(defaultConstants, logs({ rawGbPerDay: 1 }), 0);
    expect(r).toMatchObject({ days: 30, basis: 'age' });
  });

  it('uses the grown volume', () => {
    // 500 × 1.2^1 = 600 raw → 300 indexed → 50 / 300 days
    expect(rolloverFor(defaultConstants, logs({ rawGbPerDay: 500, growthPctPerYear: 20 }), 1).days).toBeCloseTo(50 / 300, 12);
  });

  it('a days value on the workload wins', () => {
    expect(rolloverFor(defaultConstants, logs({ rawGbPerDay: 500, rolloverDays: 1 }), 0)).toMatchObject({ days: 1, basis: 'fixed' });
  });

  it('without GB/day it assumes the max age', () => {
    expect(rolloverFor(defaultConstants, logs({}), 0)).toMatchObject({ days: 30, basis: 'age' });
  });

  it('rejects a rollover of 0 days', () => {
    expect(() => rolloverFor(defaultConstants, logs({ rawGbPerDay: 500, rolloverDays: 0 }), 0)).toThrow(/rollover must be greater than 0/);
  });
});

describe('forward shards follow size-based rollover', () => {
  it('500 GB/day LogsDB, 7 d hot: 35 hot indices of 50 GB shards, and no oversized-shard warning', () => {
    const r = forward({ workloads: [logs({ rawGbPerDay: 500 })], options: SM });
    // hot: ceil(7 / 0.2) = 35 indices × 1 primary × 2 copies; frozen: ceil(83 / 0.2) = 415 indices
    expect(r.shards!.indices).toBe(35 + 415);
    expect(r.shards!.total).toBe(35 * 2 + 415);
    expect(r.warnings.filter((w) => w.id === 'HV8')).toEqual([]);
    expect(r.shards!.math.map((s) => s.label).join(' | ')).toMatch(/\[l\] rollover/);
  });

  it('low-volume streams at max age do not get a small-shard note', () => {
    const r = forward({ workloads: [logs({ rawGbPerDay: 1 })], options: SM });
    expect(r.warnings.filter((w) => w.id === 'HV8')).toEqual([]);
  });
});

describe('reverse: shard count now limits GB/day', () => {
  const hot: NodeGroup = { role: 'hot', count: 3, ramGb: 64, diskGb: 2000, diskType: 'nvme', vcpu: 8 };
  const r1: WorkloadProfile = { id: 'w', kind: 'logs', indexMode: 'standard', retentionDays: { hot: 30 }, replicas: { hot: 1 } };

  it('R1: 2,000 shards / 2 copies = 1,000 indices over 30 days → rollover ≥ 0.03 d → ≤ 50 / (1.2 × 0.03) = 1,388.9 GB/day', () => {
    const r = reverse({ hardware: { model: 'self_managed', groups: [hot] }, fixed: [r1], solve: 'max_gb_day' });
    const shards = r.constraints.find((k) => k.name === 'heap_shards')!;
    expect(shards.maxValue!).toBeCloseTo(50 / (1.2 * 0.03), 1);
    expect(r.answer!.binding).toBe('storage'); // 42.67 GB/day, far below the shard ceiling
  });

  it('R6 (daily rollover set on the workload) is unchanged: 33 data streams', () => {
    const r = reverse({ hardware: { model: 'self_managed', groups: [hot] }, fixed: [{ ...r1, rolloverDays: 1, primaryShards: 1 }], solve: 'max_shards' });
    expect(r.answer!.dataStreams).toBe(33);
  });
});
