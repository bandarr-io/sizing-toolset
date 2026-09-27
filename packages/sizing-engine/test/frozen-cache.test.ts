// D27: frozen tier sized as a local disk cache over searchable snapshots.
import { describe, expect, it } from 'vitest';
import { forward, reverse, type NodeGroup, type WorkloadProfile } from '../src/index.ts';

const SM = { model: 'self_managed' as const };
const siem: WorkloadProfile = { id: 's', kind: 'siem', rawGbPerDay: 2000, indexMode: 'logsdb', retentionDays: { hot: 30, frozen: 335 }, replicas: {} };
const frozenNodes = (r: ReturnType<typeof forward>) => r.tiers.find((t) => t.tier === 'frozen')!.nodes;

describe('forward: frozen cache fraction (D27)', () => {
  it('a 20% cache fraction halves capacity per node: 335,000 / (48,000 / 1.25 / 0.2) = 1.74 → 2 + 1 = 3 nodes', () => {
    expect(frozenNodes(forward({ workloads: [siem], options: { ...SM, frozenCacheFraction: 0.2 } }))).toBe(3);
  });

  it('a frozen mem:disk override has no effect on frozen node count', () => {
    const base = forward({ workloads: [siem], options: SM });
    const overridden = forward({ workloads: [siem], options: { ...SM, nodes: { frozen: { memDiskRatio: 100 } } } });
    expect(frozenNodes(overridden)).toBe(frozenNodes(base));
  });

  it('rejects a cache fraction of 0 or above 1', () => {
    expect(() => forward({ workloads: [siem], options: { ...SM, frozenCacheFraction: 0 } })).toThrow(/cache fraction/);
    expect(() => forward({ workloads: [siem], options: { ...SM, frozenCacheFraction: 1.5 } })).toThrow(/cache fraction/);
  });
});

describe('reverse: frozen cache fraction (D27)', () => {
  const groups: NodeGroup[] = [
    { role: 'hot', count: 41, ramGb: 64, diskGb: 1920, diskType: 'nvme', vcpu: 64 },
    { role: 'frozen', count: 2, ramGb: 64, diskGb: 1920, diskType: 'ssd', vcpu: 8 },
  ];
  const target: WorkloadProfile = { id: 'l', kind: 'logs', indexMode: 'logsdb', retentionDays: { hot: 30, frozen: 335 }, replicas: {} };

  it('rejects a cache fraction of 0', () => {
    expect(() => reverse({ hardware: { model: 'self_managed', groups }, fixed: [target], solve: 'max_gb_day', frozenCacheFraction: 0 })).toThrow(/cache fraction/);
  });
});
