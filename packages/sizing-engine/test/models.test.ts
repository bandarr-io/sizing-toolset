// Comparing self-managed, ECK and ECE on the same servers (D33).
import { defaultConstants } from '@sizing/constants';
import { describe, expect, it } from 'vitest';
import { compareModels, gbToGib, gibToGb, serverLayout, type ServerGroup, type WorkloadProfile } from '../src/index.ts';

// D38: 256 GB × 50 = 12,800 GB, so each 64 GB node's disk matches the hot 1:50 default.
const hot = (count: number, ramGb = 256, diskGb = 12800, vcpu = 64): ServerGroup => ({ role: 'hot', count, ramGb, diskGb, diskType: 'nvme', vcpu });
const master = (count: number, ramGb: number): ServerGroup => ({ role: 'master', count, ramGb, diskGb: 500, diskType: 'ssd', vcpu: 16 });
const logs = (gbDay: number): WorkloadProfile => ({ id: 'logs', kind: 'logs', rawGbPerDay: gbDay, indexMode: 'standard', retentionDays: { hot: 30 }, replicas: { hot: 1 } });
const SM = { model: 'self_managed' as const };
const c = defaultConstants;

describe('per-server layout by model', () => {
  it('256 GB server: self-managed 4 × 64 GB nodes; ECK 250 GB after the Kubernetes reserve → 4 × 62.5 GB pods; ECE 85% = 217.6 GB → 3 × 64 GB instances', () => {
    expect(serverLayout(c, hot(1), 'self_managed')).toMatchObject({ nodes: 4, nodeRamGb: 64 });
    expect(serverLayout(c, hot(1), 'eck')).toMatchObject({ nodes: 4, nodeRamGb: 62.5, nodeVcpu: 63 / 4 });
    expect(serverLayout(c, hot(1), 'ece')).toMatchObject({ nodes: 3, nodeRamGb: 64 });
  });

  it('128 GB server: ECK 122 GB → 2 × 61 GB; ECE 108.8 GB → 1 × 64 GB', () => {
    expect(serverLayout(c, hot(1, 128), 'eck')).toMatchObject({ nodes: 2, nodeRamGb: 61 });
    expect(serverLayout(c, hot(1, 128), 'ece')).toMatchObject({ nodes: 1, nodeRamGb: 64 });
  });

  it('a nodes-per-server value set on the row wins in every model', () => {
    for (const m of ['self_managed', 'eck', 'ece'] as const) expect(serverLayout(c, { ...hot(1), nodesPerServer: 2 }, m).nodes).toBe(2);
  });
});

describe('P6 units: GiB/GB round-trip within 0.1%', () => {
  it.each([1, 62.5, 64, 1000, 123456.789])('%s GB', (gb) => {
    expect(Math.abs(gibToGb(gbToGib(gb)) - gb) / gb).toBeLessThan(0.001);
    expect(gbToGib(64)).toBeCloseTo(59.6046, 4);
  });
});

describe('compareModels', () => {
  const servers = [master(3, 128), hot(11)];
  const rows = compareModels({ workloads: [logs(500)], servers, options: SM });
  const by = (m: string) => rows.find((r) => r.model === m)!;

  it('returns one row per model, each with a fit verdict, headroom, ERU and requirements', () => {
    expect(rows.map((r) => r.model)).toEqual(['self_managed', 'eck', 'ece']);
    for (const r of rows) {
      expect(r.topology.headroom).toBeDefined();
      expect(r.eru).toBeGreaterThan(0);
      expect(r.requirements.length).toBeGreaterThan(0);
    }
  });

  it('ECE packs fewer nodes per 256 GB server, so it needs more hot servers than self-managed', () => {
    // 500 × 1.2 × 30 × 2 × 1.25 = 45,000 GB / 3,200 (D38) = 14.1 → 15 nodes
    const need = (m: string) => by(m).topology.sites[0]!.fit.find((f) => f.role === 'hot')!.neededServers;
    expect(need('self_managed')).toBe(4 + 1); // 15 / 4
    expect(need('ece')).toBe(5 + 1); // 15 / 3
  });

  it('ECK licenses pod memory in GiB; ECE licenses the allocator capacity of the hosts it uses', () => {
    const eck = by('eck');
    expect(eck.eruMath.map((s) => s.expr).join(' ')).toMatch(/GiB/);
    // ECE: 6 hot allocators × 256 GB + 3 control-plane hosts × 128 GB = 1,920 GB / 64 = 30 ERU
    expect(by('ece').eru).toBe(30);
  });

  it('ECE needs 3 control-plane hosts of at least 80 GB; 32 GB master servers fall short', () => {
    const small = compareModels({ workloads: [logs(500)], servers: [master(3, 32), hot(11)], options: SM });
    const ece = small.find((r) => r.model === 'ece')!;
    const cp = ece.topology.sites[0]!.fit.find((f) => f.role === 'master')!;
    expect(cp.fits).toBe(false);
    expect(cp.math.map((s) => s.label).join(' ')).toMatch(/control plane/);
    expect(small.find((r) => r.model === 'self_managed')!.topology.fitsAll).toBe(true);
  });

  it('highlights the best model on each measure', () => {
    expect(rows.filter((r) => r.best.includes('eru')).length).toBeGreaterThanOrEqual(1);
    expect(rows.filter((r) => r.best.includes('headroom')).length).toBeGreaterThanOrEqual(1);
  });
});

describe('masters and HA pairs never share a server', () => {
  it('a 128 GB master server runs one master, in every model', () => {
    const rows = compareModels({ workloads: [logs(500)], servers: [master(3, 128), hot(11), { role: 'kibana', count: 2, ramGb: 64, diskGb: 200, diskType: 'ssd', vcpu: 8 }], options: SM });
    for (const r of rows) {
      const fit = r.topology.sites[0]!.fit;
      expect(fit.find((f) => f.role === 'master')!.nodesPerServer).toBe(1);
      expect(fit.find((f) => f.role === 'kibana')!.nodesPerServer).toBe(1);
    }
    expect(serverLayout(c, master(1, 128), 'self_managed').nodes).toBe(1);
  });
});
