// Per-scenario mem:disk ratio overrides (D25). Blank = constants default.
import { describe, expect, it } from 'vitest';
import { forward, reverse, type NodeGroup, type WorkloadProfile } from '../src/index.ts';

const f1: WorkloadProfile = { id: 'a', kind: 'logs', rawGbPerDay: 30, indexMode: 'standard', retentionDays: { hot: 30 }, replicas: {} };
const hot = (diskGb: number): NodeGroup => ({ role: 'hot', count: 3, ramGb: 64, diskGb, diskType: 'nvme', vcpu: 8 });
const r1: WorkloadProfile = { id: 'w', kind: 'logs', indexMode: 'standard', retentionDays: { hot: 30 }, replicas: { hot: 1 } };

describe('forward: tier ratio override', () => {
  it('F1 at hot 1:20 needs 4 nodes: 2,700 / (64 × 20) = 2.1 → 3 + 1', () => {
    const r = forward({ workloads: [f1], options: { model: 'self_managed', nodes: { hot: { memDiskRatio: 20 } } } });
    expect(r.tiers[0]!.nodes).toBe(4);
    expect(r.tiers[0]!.diskGb).toBe(1280); // default disk follows the ratio
  });

  it('the math names the override instead of the constant', () => {
    const r = forward({ workloads: [f1], options: { model: 'self_managed', nodes: { hot: { memDiskRatio: 20 } } } });
    const cap = r.tiers[0]!.math.find((s) => s.label === 'node capacity GB')!;
    expect(cap.expr).toMatch(/scenario override/);
    expect(cap.constantKeys).not.toContain('mem_disk.hot');
    expect(r.assumptions.join(' ')).toMatch(/hot 1:20/);
  });

  it('blank keeps the default (§11.1 F1: 2 hot at 1:50, D38)', () => {
    expect(forward({ workloads: [f1], options: { model: 'self_managed', nodes: { hot: {} } } }).tiers[0]!.nodes).toBe(2);
  });

  it('rejects a ratio that is not a positive number', () => {
    expect(() => forward({ workloads: [f1], options: { model: 'self_managed', nodes: { hot: { memDiskRatio: 0 } } } })).toThrow(/hot mem:disk ratio must be greater than 0/);
  });
});

describe('reverse: tier ratio override', () => {
  it('R1 at hot 1:25: 2 × min(1,600, 2,000) / 1.25 / 72 = 35.56 GB/day', () => {
    const r = reverse({ hardware: { model: 'self_managed', groups: [hot(2000)], memDiskRatio: { hot: 25 } }, fixed: [r1], solve: 'max_gb_day' });
    expect(r.answer!.value).toBeCloseTo(3200 / 1.25 / 72, 9);
    expect(r.answer!.binding).toBe('storage');
  });

  it('a higher ratio makes the same disk the limit, and HV5 follows the override', () => {
    const r = reverse({ hardware: { model: 'self_managed', groups: [hot(2000)], memDiskRatio: { hot: 40 } }, fixed: [r1], solve: 'max_gb_day' });
    expect(r.answer!.binding).toBe('disk'); // 64 × 40 = 2,560 > 2,000 GB disk
    expect(r.warnings.map((w) => w.id)).toContain('HV5');
    const plain = reverse({ hardware: { model: 'self_managed', groups: [hot(2000)], memDiskRatio: { hot: 30 } }, fixed: [r1], solve: 'max_gb_day' });
    expect(plain.warnings.map((w) => w.id)).not.toContain('HV5');
  });
});
