// Input validation: values that would silently distort a sizing are rejected with a message.
import { describe, expect, it } from 'vitest';
import { downsampleProblem, forward, reverse, type WorkloadProfile } from '../src/index.ts';

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
    expect(() => forward({ workloads: [metrics(f)], options: { model: 'self_managed' } })).toThrow(/\[m\] frozen: downsample factor must be greater than 0 and at most 1/);
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

describe('downsampling is TSDS-only', () => {
  const logs = (patch: Partial<WorkloadProfile>): WorkloadProfile => ({
    id: 'l', kind: 'logs', rawGbPerDay: 500, indexMode: 'logsdb', retentionDays: { hot: 7, frozen: 83 }, replicas: {}, ...patch,
  });

  it.each(['logsdb', 'standard'] as const)('rejects a downsample factor on a %s workload', (indexMode) => {
    expect(() => forward({ workloads: [logs({ indexMode, downsampleFactor: { frozen: 0.5 } })], options: { model: 'self_managed' } }))
      .toThrow(/\[l\] frozen: downsampling only applies to TSDS/);
  });

  it('rejects it in reverse mode too', () => {
    const { rawGbPerDay: _drop, ...target } = logs({ downsampleFactor: { frozen: 0.5 } });
    expect(() => reverse({ hardware: hw, fixed: [target], solve: 'max_gb_day' })).toThrow(/only applies to TSDS/);
  });

  it('allows a factor of 1 (no downsampling) on any index mode', () => {
    expect(() => forward({ workloads: [logs({ downsampleFactor: { frozen: 1 } })], options: { model: 'self_managed' } })).not.toThrow();
  });

  it('allows downsampling when the index mode is TSDS, including metrics that default to TSDS', () => {
    expect(() => forward({ workloads: [logs({ indexMode: 'tsds', downsampleFactor: { frozen: 0.1 } })], options: { model: 'self_managed' } })).not.toThrow();
    const { indexMode: _m, ...defaulted } = metrics(0.1);
    expect(() => forward({ workloads: [defaulted], options: { model: 'self_managed' } })).not.toThrow();
  });

  it('downsampleProblem explains both kinds of error and is silent when fine', () => {
    expect(downsampleProblem(logs({ downsampleFactor: { frozen: 0.5 } }), 'frozen')).toMatch(/only applies to TSDS/);
    expect(downsampleProblem(metrics(0), 'frozen')).toMatch(/greater than 0 and at most 1/);
    expect(downsampleProblem(metrics(0.1), 'frozen')).toBeUndefined();
    expect(downsampleProblem(logs({}), 'frozen')).toBeUndefined();
  });
});
