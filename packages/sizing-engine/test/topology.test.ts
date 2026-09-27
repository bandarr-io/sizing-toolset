// Multi-site topology on physical servers (D32).
import { defaultConstants } from '@sizing/constants';
import { describe, expect, it } from 'vitest';
import { nodesPerServer, sizeTopology, type ServerGroup, type TopologyRequest, type WorkloadProfile } from '../src/index.ts';

const SM = { model: 'self_managed' as const };
const logs = (gbDay: number, id = 'logs'): WorkloadProfile => ({
  id, kind: 'logs', rawGbPerDay: gbDay, indexMode: 'standard', retentionDays: { hot: 30 }, replicas: { hot: 1 },
});
const hotServers = (count: number, ramGb = 64, diskGb = 1920, vcpu = 8): ServerGroup => ({ role: 'hot', count, ramGb, diskGb, diskType: 'nvme', vcpu });
const two = (relationship: TopologyRequest['relationship'], a: WorkloadProfile[], b: WorkloadProfile[], servers: ServerGroup[]): TopologyRequest => ({
  relationship, options: SM,
  sites: [{ name: 'Site A', workloads: a, servers }, { name: 'Site B', workloads: b, servers }],
});

describe('server layout', () => {
  it('data and master servers split into nodes of at most 64 GB; frozen, ML, Kibana, Fleet and APM stay one node', () => {
    expect(nodesPerServer(defaultConstants, hotServers(1, 256))).toBe(4);
    expect(nodesPerServer(defaultConstants, hotServers(1, 96))).toBe(1);
    expect(nodesPerServer(defaultConstants, { ...hotServers(1, 256), role: 'frozen' })).toBe(1);
    expect(nodesPerServer(defaultConstants, { ...hotServers(1, 256), role: 'ml' })).toBe(1);
    expect(nodesPerServer(defaultConstants, { ...hotServers(1, 256), nodesPerServer: 2 })).toBe(2);
  });

  it('rejects a nodes-per-server count that is not a whole number of at least 1', () => {
    expect(() => nodesPerServer(defaultConstants, { ...hotServers(1), nodesPerServer: 0 })).toThrow(/nodes per server/);
    expect(() => nodesPerServer(defaultConstants, { ...hotServers(1), nodesPerServer: 1.5 })).toThrow(/nodes per server/);
  });
});

describe('fit check', () => {
  it('independent: each site sized for its own data; 100 GB/day needs 5 + 1 hot servers of 64 GB', () => {
    const t = sizeTopology(two('independent', [logs(100)], [logs(100)], [hotServers(11)]));
    // 100 × 1.2 × 30 × 2 × 1.25 = 9,000 GB / 1,920 = 4.7 → 5 nodes + 1 failover server
    const hot = t.sites[0]!.fit.find((f) => f.role === 'hot')!;
    expect(hot).toMatchObject({ neededServers: 6, availableServers: 11, fits: true });
    expect(t.fitsAll).toBe(true);
  });

  it('failover reserves a whole server: 5 nodes on 4-node servers need 2 + 1 servers', () => {
    const t = sizeTopology(two('independent', [logs(100)], [logs(100)], [hotServers(3, 256, 7680, 64)]));
    expect(t.sites[0]!.fit.find((f) => f.role === 'hot')).toMatchObject({ nodesPerServer: 4, neededServers: 3, availableServers: 3, fits: true });
  });

  it('DR: the standby holds the primary\'s data, so it needs the same hot servers with no ingest of its own', () => {
    const t = sizeTopology(two('dr', [logs(100)], [], [hotServers(11)]));
    const need = (i: number) => t.sites[i]!.fit.find((f) => f.role === 'hot')!.neededServers;
    expect(need(1)).toBe(need(0));
    expect(t.sites[1]!.holds).toEqual(['Site A: logs']);
  });

  it('active-active: every site holds both sites\' data', () => {
    const t = sizeTopology(two('active_active', [logs(100)], [logs(100)], [hotServers(11)]));
    // 18,000 GB / 1,920 = 9.4 → 10 + 1
    expect(t.sites[0]!.fit.find((f) => f.role === 'hot')!.neededServers).toBe(11);
    expect(t.sites[0]!.holds).toEqual(['logs', 'Site B: logs']);
  });

  it('reports a shortfall and does not fail the sizing', () => {
    const t = sizeTopology(two('active_active', [logs(300)], [logs(300)], [hotServers(11)]));
    expect(t.fitsAll).toBe(false);
    expect(t.sites[0]!.fit.find((f) => f.role === 'hot')!.fits).toBe(false);
  });

  it('roles with no servers listed are reported as not placed, not as a shortfall', () => {
    const t = sizeTopology(two('independent', [logs(100)], [logs(100)], [hotServers(11)]));
    const kibana = t.sites[0]!.fit.find((f) => f.role === 'kibana')!;
    expect(kibana.status).toBe('unplaced');
    expect(t.fitsAll).toBe(true);
  });
});

describe('headroom: how much more the servers hold', () => {
  it('independent: (11 − 1) × 1,920 / 1.25 = 15,360 GB → 213.3 GB/day, 2.13× today', () => {
    const t = sizeTopology(two('independent', [logs(100)], [logs(100)], [hotServers(11)]));
    expect(t.headroom!.scale).toBeCloseTo(15360 / (30 * 2 * 1.2) / 100, 4);
    expect(t.headroom!.binding).toMatchObject({ site: 'Site A', role: 'hot' });
  });

  it('active-active halves it: each site holds both, 1.07×', () => {
    const t = sizeTopology(two('active_active', [logs(100)], [logs(100)], [hotServers(11)]));
    expect(t.headroom!.scale).toBeCloseTo(15360 / (30 * 2 * 1.2) / 200, 4);
  });

  it('whole-server failover on 4-node servers: 8 usable nodes → 1.71×', () => {
    const t = sizeTopology(two('independent', [logs(100)], [logs(100)], [hotServers(3, 256, 7680, 64)]));
    expect(t.headroom!.scale).toBeCloseTo((8 * 1920) / 1.25 / (30 * 2 * 1.2) / 100, 4);
  });

  it('under 1 when today\'s workload already does not fit', () => {
    const t = sizeTopology(two('active_active', [logs(300)], [logs(300)], [hotServers(11)]));
    expect(t.headroom!.scale).toBeLessThan(1);
    expect(t.headroom!.scale).toBeCloseTo(15360 / (30 * 2 * 1.2) / 600, 4);
  });
});
