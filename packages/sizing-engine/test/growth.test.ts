// Growth: forward sizes for the horizon; reverse "years until full" (D24).
import { describe, expect, it } from 'vitest';
import { forward, reverse, type NodeGroup, type ReverseRequest, type WorkloadProfile } from '../src/index.ts';

// §11.2 R1 hardware: 3 × 64 GB hot, 2 TB disk → 42.67 GB/day at 30 d, 1 replica, ratio 1.2.
const hot: NodeGroup = { role: 'hot', count: 3, ramGb: 64, diskGb: 2000, diskType: 'nvme', vcpu: 8 };
const logs = (p: Partial<WorkloadProfile>): WorkloadProfile => ({
  id: 'w', kind: 'logs', indexMode: 'standard', retentionDays: { hot: 30 }, replicas: { hot: 1 }, ...p,
});
const years = (fixed: WorkloadProfile[], extra: Partial<ReverseRequest> = {}) =>
  reverse({ hardware: { model: 'self_managed', groups: [hot] }, fixed, solve: 'years_to_capacity', ...extra });
const MAX = 3072 / 72;

describe('forward growth', () => {
  it('compounds GB/day over the horizon: 500 GB/day at 20% for 3 years sizes for 864 GB/day', () => {
    const w = logs({ rawGbPerDay: 500, growthPctPerYear: 20 });
    const grown = forward({ workloads: [w], options: { model: 'self_managed', growthHorizonYears: 3 } });
    const flat = forward({ workloads: [logs({ rawGbPerDay: 864 })], options: { model: 'self_managed' } });
    expect(grown.tiers).toEqual(flat.tiers.map((t) => ({ ...t, math: expect.any(Array) })));
    const step = grown.tiers[0]!.math.find((s) => s.label.includes('after growth'))!;
    expect(step.value).toBeCloseTo(864, 9);
  });

  it('a horizon of 0 sizes for today', () => {
    const w = logs({ rawGbPerDay: 500, growthPctPerYear: 20 });
    const today = forward({ workloads: [w], options: { model: 'self_managed', growthHorizonYears: 0 } });
    const flat = forward({ workloads: [logs({ rawGbPerDay: 500 })], options: { model: 'self_managed' } });
    expect(today.totalRamGb).toBe(flat.totalRamGb);
  });
});

describe('reverse: years until full', () => {
  it('20 GB/day growing 20% a year fills 42.67 GB/day in ln(42.67/20)/ln(1.2) ≈ 4.16 years', () => {
    const r = years([logs({ rawGbPerDay: 20, growthPctPerYear: 20 })]);
    expect(r.answer!.value).toBeCloseTo(Math.log(MAX / 20) / Math.log(1.2), 6);
    expect(r.answer!.unit).toBe('years');
    expect(r.answer!.binding).toBe('storage');
    expect(r.answer!.confidence).toBe('high');
  });

  it('other workloads grow at their own rate and fill the cluster sooner', () => {
    const r = years([logs({ rawGbPerDay: 20, growthPctPerYear: 20 }), logs({ id: 'other', rawGbPerDay: 10, growthPctPerYear: 20 })], { targetProfileId: 'w' });
    // (20 + 10) × 1.2^t = 42.67 → t = ln(1.4222) / ln(1.2) ≈ 1.93
    expect(r.answer!.value).toBeCloseTo(Math.log(MAX / 30) / Math.log(1.2), 6);
  });

  it('is 0 when today\'s volume already exceeds the hardware', () => {
    expect(years([logs({ rawGbPerDay: 50, growthPctPerYear: 20 })]).answer!.value).toBe(0);
  });

  it('is unbounded with no growth, and says so', () => {
    const r = years([logs({ rawGbPerDay: 20 })]);
    expect(r.answer!.value).toBe(Infinity);
    expect(r.assumptions.join(' ')).toMatch(/No growth/);
  });

  it('reports utilization of each constraint at the moment the cluster fills', () => {
    const r = years([logs({ rawGbPerDay: 20, growthPctPerYear: 20 })]);
    expect(r.constraints.find((k) => k.binding)!.utilization).toBeCloseTo(1, 6);
    const cpu = r.constraints.find((k) => k.name === 'cpu_ingest')!;
    expect(cpu.utilization!).toBeLessThan(1);
  });

  it('needs today\'s GB/day', () => {
    expect(() => years([logs({ growthPctPerYear: 20 })])).toThrow(/today's GB\/day/);
  });
});
