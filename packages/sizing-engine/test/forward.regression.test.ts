// SPEC §11.1 forward regression suite. Common assumptions: 64 GB data nodes, hot 1:50 (D38; §11.1 says 1:30),
// warm 1:160, frozen per D27, 1 replica, overhead per §5.2. These are defaults, so options stay minimal.
// D38 re-baselined every case with hot data: 64 × 50 = 3,200 GB per hot node instead of 1,920.
import { describe, expect, it } from 'vitest';
import { forward, type ForwardOptions, type SizingResult, type Tier, type WorkloadProfile } from '../src/index.ts';

const SM: ForwardOptions = { model: 'self_managed' };

function nodes(r: SizingResult, tier: Tier): number {
  return r.tiers.find((t) => t.tier === tier)?.nodes ?? 0;
}
function overheadCount(r: SizingResult, role: string): number {
  return r.overhead.filter((o) => o.role === role).reduce((s, o) => s + o.count, 0);
}
function logs(p: Partial<WorkloadProfile> & Pick<WorkloadProfile, 'id' | 'retentionDays'>): WorkloadProfile {
  return { kind: 'logs', replicas: {}, ...p };
}

describe('§11.1 forward regression', () => {
  // D38: 2,700 / 3,200 = 0.84 → 1 + 1 = 2 hot; 128 + 8 Kibana = 136 GB; 3 ERU.
  it('F1: 30 GB/day, 30d, ratio 1.2 → 2 hot, 136 GB, 3 ERU', () => {
    const r = forward({ workloads: [logs({ id: 'a', rawGbPerDay: 30, indexMode: 'standard', retentionDays: { hot: 30 } })], options: SM });
    expect(nodes(r, 'hot')).toBe(2);
    expect(r.totalRamGb).toBe(136);
    expect(r.licenseUnits.value).toBe(3);
  });

  // D38: 6,750 / 3,200 = 2.11 → 3 + 1 = 4 hot; 256 + 192 warm + 48 masters + 16 Kibana = 512 GB; 8 ERU.
  it('F2: 150 LogsDB + 50 TSDS, 30d hot, 90d warm → 4 hot, 3 warm, 512 GB, 8 ERU', () => {
    const r = forward({
      workloads: [
        logs({ id: 'l', rawGbPerDay: 150, indexMode: 'logsdb', retentionDays: { hot: 30, warm: 90 } }),
        { id: 'm', kind: 'metrics', rawGbPerDay: 50, indexMode: 'tsds', retentionDays: { hot: 30, warm: 90 }, replicas: {} },
      ],
      options: SM,
    });
    expect(nodes(r, 'hot')).toBe(4);
    expect(nodes(r, 'warm')).toBe(3);
    expect(r.totalRamGb).toBe(512);
    expect(r.licenseUnits.value).toBe(8);
  });

  // D27: frozen re-baselined. disk-cache model at 10%: 335,000 GB / (64×750/1.25/0.10) = 0.87 → 1+1 = 2 nodes.
  // D38: 75,000 / 3,200 = 23.4 → 24 + 1 = 25 hot; 1,600 + 128 frozen + 96 masters + 16 Kibana = 1,840 GB; 29 ERU.
  it('F3: 2 TB/day SIEM LogsDB, 30d hot + 335d frozen → 25 hot, 2 frozen, 1,840 GB, 29 ERU', () => {
    const r = forward({
      workloads: [{ id: 's', kind: 'siem', rawGbPerDay: 2000, indexMode: 'logsdb', retentionDays: { hot: 30, frozen: 335 }, replicas: {} }],
      options: SM,
    });
    expect(nodes(r, 'hot')).toBe(25);
    expect(nodes(r, 'frozen')).toBe(2);
    expect(r.totalRamGb).toBe(1840);
    expect(r.licenseUnits.value).toBe(29);
    expect(r.licenseFloor).toBe('enterprise');
  });

  // D38: 2,625 / 3,200 = 0.82 → 1 + 1 = 2 hot; 384 + 48 masters + 16 Kibana = 448 GB; 7 ERU.
  it('F4: 500 GB/day TSDS, 7d hot / 30d warm / 365d frozen, downsample 0.1 → 2/2/2, 448 GB, 7 ERU', () => {
    const r = forward({
      workloads: [{
        id: 'm', kind: 'metrics', rawGbPerDay: 500, indexMode: 'tsds',
        retentionDays: { hot: 7, warm: 30, frozen: 365 }, replicas: {},
        downsampleFactor: { warm: 0.1, frozen: 0.1 },
      }],
      options: SM,
    });
    expect([nodes(r, 'hot'), nodes(r, 'warm'), nodes(r, 'frozen')]).toEqual([2, 2, 2]);
    expect(r.totalRamGb).toBe(448);
    expect(r.licenseUnits.value).toBe(7);
  });

  // D38: 4,200 / 3,200 = 1.31 → 2 + 1 = 3 hot; 5 data nodes, so no dedicated masters: 320 + 8 Kibana + 16 APM = 344 GB; 6 ERU.
  it('F5: APM 200 GB/day, ratio 1.2, 7d hot / 8d warm → 3 hot, 2 warm, 344 GB, 6 ERU (APM counted, D3)', () => {
    const r = forward({
      workloads: [{ id: 'apm', kind: 'apm', rawGbPerDay: 200, indexMode: 'standard', retentionDays: { hot: 7, warm: 8 }, replicas: {} }],
      options: SM,
    });
    expect(nodes(r, 'hot')).toBe(3);
    expect(nodes(r, 'warm')).toBe(2);
    expect(overheadCount(r, 'apm')).toBe(2);
    expect(r.totalRamGb).toBe(344);
    expect(r.licenseUnits.value).toBe(6);
  });

  it('F6: 2 TB indexed search, ratio 1.0, 2 replicas, 2 coordinating → 5 content, 392 GB, 7 ERU (D5, D9)', () => {
    const r = forward({
      workloads: [{ id: 's', kind: 'search', totalGb: 2000, indexRatioOverride: 1.0, retentionDays: {}, replicas: { content: 2 } }],
      options: { ...SM, coordinatingNodes: 2 },
    });
    expect(nodes(r, 'content')).toBe(5);
    expect(overheadCount(r, 'coordinating')).toBe(2);
    expect(r.totalRamGb).toBe(392);
    expect(r.licenseUnits.value).toBe(7);
  });

  describe('F7: 100M × 1024-d vectors, m=16 (D19: 33 GB off-heap per node)', () => {
    const vec = (quant: 'bbq' | 'float32'): WorkloadProfile => ({
      id: 'v', kind: 'vector', vector: { count: 100_000_000, dims: 1024, quant, hnswM: 16 }, retentionDays: {}, replicas: {},
    });
    it('BBQ → 3 nodes, 200 GB, 4 ERU', () => {
      const r = forward({ workloads: [vec('bbq')], options: SM });
      expect(nodes(r, 'content')).toBe(3);
      expect(r.totalRamGb).toBe(200);
      expect(r.licenseUnits.value).toBe(4);
    });
    it('float32 → 27 nodes, 1,840 GB, 29 ERU', () => {
      const r = forward({ workloads: [vec('float32')], options: SM });
      expect(nodes(r, 'content')).toBe(27);
      expect(r.totalRamGb).toBe(1840);
      expect(r.licenseUnits.value).toBe(29);
    });
  });

  it('F8: 60 anomaly jobs on top of F1 → 3 ML, +192 GB, +3 ERU (D6)', () => {
    const base = logs({ id: 'a', rawGbPerDay: 30, indexMode: 'standard', retentionDays: { hot: 30 } });
    const without = forward({ workloads: [base], options: SM });
    const r = forward({
      workloads: [base, { id: 'ml', kind: 'ml', ml: { anomalyJobs: 60 }, retentionDays: {}, replicas: {} }],
      options: SM,
    });
    expect(overheadCount(r, 'ml')).toBe(3);
    expect(r.totalRamGb - without.totalRamGb).toBe(192);
    expect(r.licenseUnits.value - without.licenseUnits.value).toBe(3);
    expect(r.licenseFloor).toBe('enterprise'); // §11.1 F8 said platinum; D29: self-managed has only Basic and Enterprise
  });

  describe('F9: air-gapped, 2 sites, CCR, 500 GB/day/site LogsDB, 30d hot + 335d frozen (D2)', () => {
    const w: WorkloadProfile[] = [logs({ id: 'l', rawGbPerDay: 500, indexMode: 'logsdb', retentionDays: { hot: 30, frozen: 335 }, airGapped: true })];
    // D38: 18,750 / 3,200 = 5.86 → 6 + 1 = 7 hot; 448 + 128 frozen + 48 masters + 16 Kibana = 640 GB; 10 ERU.
    it('unidirectional → per site 7 hot + 2 frozen, 640 GB, 10 ERU', () => {
      const r = forward({ workloads: w, options: { ...SM, sites: 2, ccrMode: 'unidirectional', airGapped: true } });
      expect(nodes(r, 'hot')).toBe(7);
      expect(nodes(r, 'frozen')).toBe(2);
      expect(r.totalRamGb).toBe(640);
      expect(r.licenseUnits.value).toBe(10);
      expect(r.allSites).toEqual({ totalRamGb: 1280, licenseUnits: 20 });
    });
    // D38: 37,500 / 3,200 = 11.7 → 12 + 1 = 13.
    it('bidirectional → 13 hot per site', () => {
      const r = forward({ workloads: w, options: { ...SM, sites: 2, ccrMode: 'bidirectional', airGapped: true } });
      expect(nodes(r, 'hot')).toBe(13);
    });
  });

  // D27: frozen re-baselined. 100,500 GB / 384,000 GB/node = 0.26 → 1+1 = 2 frozen nodes.
  // D38: 22,500 / 3,200 = 7.03 → 8 + 1 = 9 hot; 576 + 128 frozen + 48 masters + 16 Kibana = 768 GB; 12 ERU.
  it('F10: 40k agents + Defend, 600 GB/day LogsDB, 30d hot + 335d frozen → 2 Fleet, 9 hot, 2 frozen, 768 GB, 12 ERU', () => {
    const r = forward({
      workloads: [
        logs({ id: 'l', rawGbPerDay: 600, indexMode: 'logsdb', retentionDays: { hot: 30, frozen: 335 } }),
        { id: 'f', kind: 'fleet', fleet: { agents: 40_000, defend: true }, retentionDays: {}, replicas: {} },
      ],
      options: SM,
    });
    const fleet = r.overhead.filter((o) => o.role === 'fleet');
    expect(fleet.reduce((s, o) => s + o.count, 0)).toBe(2);
    expect(fleet[0]!.ramGb).toBe(8);
    expect(nodes(r, 'hot')).toBe(9);
    expect(nodes(r, 'frozen')).toBe(2);
    expect(r.totalRamGb).toBe(768);
    expect(r.licenseUnits.value).toBe(12);
  });
});

describe('§11.1 show-the-math', () => {
  it('F1 hot math chain names the constants it used', () => {
    const r = forward({ workloads: [logs({ id: 'a', rawGbPerDay: 30, indexMode: 'standard', retentionDays: { hot: 30 } })], options: SM });
    const hot = r.tiers.find((t) => t.tier === 'hot')!;
    const values = hot.math.map((s) => s.value);
    expect(values).toContain(2160);
    expect(values).toContain(2700);
    const keys = hot.math.flatMap((s) => s.constantKeys);
    expect(keys).toEqual(expect.arrayContaining(['index_ratio.standard', 'storage.watermark_headroom', 'storage.margin', 'mem_disk.hot', 'failover_nodes_per_tier']));
  });
});
