// Object storage for searchable snapshots (D26): one copy of cold + frozen data, added automatically.
import { describe, expect, it } from 'vitest';
import { forward, reverse, type NodeGroup, type WorkloadProfile } from '../src/index.ts';

const SM = { model: 'self_managed' as const };
const siem: WorkloadProfile = { id: 's', kind: 'siem', rawGbPerDay: 2000, indexMode: 'logsdb', retentionDays: { hot: 30, frozen: 335 }, replicas: {} };

describe('forward: object storage', () => {
  it('F3: frozen holds 1,000 GB/day indexed × 335 days = 335,000 GB in the object store', () => {
    const r = forward({ workloads: [siem], options: SM });
    expect(r.objectStorage).toMatchObject({ gb: 335_000, calculatedGb: 335_000, overridden: false });
  });

  it('cold and frozen add up without double counting: 120 GB/day × (23 + 335) days', () => {
    const w: WorkloadProfile = { id: 'l', kind: 'logs', rawGbPerDay: 100, indexMode: 'standard', retentionDays: { hot: 7, cold: 23, frozen: 335 }, replicas: {} };
    const r = forward({ workloads: [w], options: SM });
    expect(r.objectStorage!.gb).toBeCloseTo(120 * 23 + 120 * 335, 6);
    expect(r.objectStorage!.math.map((s) => s.label).join(' ')).toMatch(/cold.*frozen|frozen.*cold/);
  });

  it('F4: downsampled metrics shrink the object store too (15 GB/day × 365 days)', () => {
    const m: WorkloadProfile = { id: 'm', kind: 'metrics', rawGbPerDay: 500, indexMode: 'tsds', retentionDays: { hot: 7, warm: 30, frozen: 365 }, replicas: {}, downsampleFactor: { warm: 0.1, frozen: 0.1 } };
    expect(forward({ workloads: [m], options: SM }).objectStorage!.gb).toBeCloseTo(5475, 6);
  });

  it('an override replaces the size but keeps the calculated value for reference', () => {
    const r = forward({ workloads: [siem], options: { ...SM, objectStorageGb: 400_000 } });
    expect(r.objectStorage).toMatchObject({ gb: 400_000, calculatedGb: 335_000, overridden: true });
    expect(r.assumptions.join(' ')).toMatch(/Object storage/);
  });

  it('is absent without cold or frozen data, and does not count toward RAM or ERU', () => {
    const hotOnly: WorkloadProfile = { ...siem, retentionDays: { hot: 30 } };
    expect(forward({ workloads: [hotOnly], options: SM }).objectStorage).toBeUndefined();
    expect(forward({ workloads: [siem], options: SM }).totalRamGb).toBe(3056); // §11.1 F3 unchanged
  });

  it('rejects a negative override', () => {
    expect(() => forward({ workloads: [siem], options: { ...SM, objectStorageGb: -1 } })).toThrow(/Object storage/);
  });
});

describe('reverse: object storage at the answer', () => {
  it('reports the object store the solved workload would need', () => {
    const groups: NodeGroup[] = [
      { role: 'hot', count: 41, ramGb: 64, diskGb: 1920, diskType: 'nvme', vcpu: 64 },
      { role: 'frozen', count: 2, ramGb: 64, diskGb: 1920, diskType: 'ssd', vcpu: 8 },
    ];
    const target: WorkloadProfile = { id: 'l', kind: 'logs', indexMode: 'logsdb', retentionDays: { hot: 30, frozen: 335 }, replicas: {} };
    const r = reverse({ hardware: { model: 'self_managed', groups }, fixed: [target], solve: 'max_gb_day' });
    // frozen binds at (2 − 1) × 64 × 1,500 = 96,000 GB of object-store data
    expect(r.objectStorage!.gb).toBeCloseTo(96_000, 6);
  });
});
