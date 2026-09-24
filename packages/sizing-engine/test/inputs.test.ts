// Input validation: values that would silently distort a sizing are rejected with a message.
import { describe, expect, it } from 'vitest';
import { forward, reverse, type WorkloadProfile } from '../src/index.ts';

const metrics = (factor: number): WorkloadProfile => ({
  id: 'm', kind: 'metrics', rawGbPerDay: 500, retentionDays: { hot: 7, frozen: 83 }, replicas: {}, downsampleFactor: { frozen: factor },
});
const hw = {
  model: 'self_managed' as const,
  groups: [
    { role: 'hot' as const, count: 3, ramGb: 64, diskGb: 1920, diskType: 'nvme' as const, vcpu: 8 },
    { role: 'frozen' as const, count: 2, ramGb: 64, diskGb: 1920, diskType: 'ssd' as const, vcpu: 8 },
  ],
};

describe('downsample factor', () => {
  it.each([0, -0.1, 1.5, Number.NaN])('rejects %s in forward mode instead of dropping the tier', (f) => {
    expect(() => forward({ workloads: [metrics(f)], options: { model: 'self_managed' } })).toThrow(/\[m\] frozen downsample factor must be greater than 0 and at most 1/);
  });

  it('rejects 0 in reverse mode instead of reporting an infinite frozen limit', () => {
    const { rawGbPerDay: _drop, ...target } = metrics(0);
    expect(() => reverse({ hardware: hw, fixed: [target], solve: 'max_gb_day' })).toThrow(/downsample factor/);
  });

  it('keeps the tier for a small valid factor', () => {
    const r = forward({ workloads: [metrics(0.01)], options: { model: 'self_managed' } });
    expect(r.tiers.map((t) => t.tier)).toEqual(['hot', 'frozen']);
  });

  it('accepts exactly 1 (no downsampling)', () => {
    expect(() => forward({ workloads: [metrics(1)], options: { model: 'self_managed' } })).not.toThrow();
  });
});
