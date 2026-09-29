// ECH security rules (D40) on a small made-up data set; prices are invented round numbers, not Elastic prices.
import { buildConstantSet, defaultConstants, type Constant } from '@sizing/constants';
import { describe, expect, it } from 'vitest';
import { echSecurity, type EchData, type EchSku } from '../../src/index.ts';

const R = 'AWS-test-1 (Testland)';
const sku = (id: string, type: string, ramDisk: number, increments: number[]): EchSku => ({
  id, provider: 'aws', type, sellableRamGb: increments.at(-1)!, vcpu: 8, ramDisk, excludedRegions: '', ingestPerGbRamPerDay: 10, increments,
});
const ids = { hot: 'aws.es.datahot.x', warm: 'aws.es.datawarm.x', cold: 'aws.es.datacold.x', frozen: 'aws.es.datafrozen.x', master: 'aws.es.master.x', coordinating: 'aws.es.coordinating.x', ml: 'aws.es.ml.x', kibana: 'aws.kibana.x' };
const data: EchData = {
  source: { file: 'fixture', version: 'test', extractedAt: '2026-09-28T00:00:00Z' },
  skus: [
    sku(ids.hot, 'data_hot', 30, [1, 2, 4, 8, 15, 30, 60]), sku(ids.warm, 'data_warm', 100, [2, 4, 8, 15, 30, 60]),
    sku(ids.cold, 'data_cold', 200, [2, 4, 8, 15, 30, 60]), sku(ids.frozen, 'data_frozen', 90, [4, 8, 15, 30, 60]),
    sku(ids.master, 'master', 10, [1, 2, 4, 8]), sku(ids.coordinating, 'coordinating', 10, [1, 2, 4, 8]),
    sku(ids.ml, 'ml', 10, [1, 2, 4, 8]), sku(ids.kibana, 'kibana', 10, [1, 2, 4, 8]),
  ],
  prices: {},
  regions: [{ provider: 'aws', name: R, status: 'Launched' }],
  channelTiers: (['Gold', 'Enterprise'] as const).map((tier) => ({ channel: 'Elastic Direct' as const, tier, provider: 'aws' })),
  dts: (['Data inter-node', 'Data out', 'Snapshot storage', 'Storage api'] as const).map((item) => ({ provider: 'aws', item, channel: 'Elastic Direct', price: 0.01 })),
  dtsOverrides: [],
  defaults: { aws: ids },
  metricsBenchmark: [],
};
for (const k of data.skus) for (const t of ['Gold', 'Enterprise']) data.prices[`${k.id}|${R}|${t}`] = { direct: 0.1 };
const c = buildConstantSet([...defaultConstants.byKey.values()].map((x): Constant => (x.key === 'ech.price_adjustment' ? { ...x, value: 1 } : x)));
const at = { provider: 'aws', region: R, channel: 'Elastic Direct', tier: 'Enterprise' } as const;
const byKey = (r: ReturnType<typeof echSecurity>) => Object.fromEntries(r.lines.map((l) => [l.key, l]));

describe('ECH SIEM (made-up prices)', () => {
  it('uses the larger of GB/day and events/s × 500 bytes', () => {
    const r = echSecurity(c, data, { ...at, kind: 'siem', gbPerDay: 10, eventsPerSecond: 1000, totalDays: 7, logsdb: true, availability: 'high' });
    expect(r.dailyGb).toBeCloseTo((1000 * 500 * 86_400) / 1e9, 9); // 43.2 > 10
  });
  it('maps total days to 1 hot + 6 cold + the rest frozen, and warns when under 7', () => {
    const long = byKey(echSecurity(c, data, { ...at, kind: 'siem', gbPerDay: 100, totalDays: 90, logsdb: true, availability: 'high' }));
    expect(Object.keys(long)).toEqual(expect.arrayContaining(['hot', 'cold', 'frozen']));
    expect(long.warm).toBeUndefined();
    const short = echSecurity(c, data, { ...at, kind: 'siem', gbPerDay: 100, totalDays: 3, logsdb: true, availability: 'high' });
    expect(byKey(short).frozen).toBeUndefined();
    expect(short.warnings.join(' ')).toMatch(/sized as 7/);
  });
  it('availability sets zones and replicas: Maximum puts hot on 3 zones with 2 replicas', () => {
    const r = byKey(echSecurity(c, data, { ...at, kind: 'siem', gbPerDay: 100, totalDays: 7, logsdb: false, availability: 'maximum' }));
    expect(r.hot!.zones).toBe(3);
    // 100 × 1 × 3 copies × 0.9 / 0.8 = 337.5 GB → / 30 = 11.25 GB RAM; ingest 100 / 8 = 12.5 GB wins.
    expect(r.hot!.constraint).toBe('cpu');
    expect(r.cold!.zones).toBe(2);
  });
  it('enterprise ML and Kibana follow rule instances and analysts', () => {
    const r = byKey(echSecurity(c, data, { ...at, kind: 'siem', siemUseCase: 'enterprise', gbPerDay: 10, totalDays: 7, logsdb: true, availability: 'high', detectionRuleInstances: 4, analystsPerShift: 25 }));
    expect([r.master!.ramGb, r.ml!.ramGb, r.kibana!.ramGb]).toEqual([3, 32, 32 + 3 * 8]);
    expect(r.coordinating).toBeUndefined();
  });
  it('off the Enterprise tier, LogsDB saves 19% and ingest runs 15% slower', () => {
    const r = echSecurity(c, data, { ...at, tier: 'Gold', kind: 'siem', gbPerDay: 100, totalDays: 7, logsdb: true, availability: 'standard' });
    const hot = byKey(r).hot!;
    // ingest RAM = 100 / (10 × 0.85 × 0.8) = 14.71 GB vs disk 100 × 0.81 × 0.9 / 0.8 / 30 = 3.04 GB
    expect(hot.constraint).toBe('cpu');
    expect(hot.math.find((m) => m.label === 'hot RAM for ingest')!.value).toBeCloseTo(100 / (10 * 0.85 * 0.8), 9);
    expect(r.warnings.join(' ')).toMatch(/Enterprise subscription/);
  });
});

describe('ECH Endpoint (made-up prices)', () => {
  it('blends MB/day by OS mix: Complete EDR 75/25 = 105.75 MB per endpoint', () => {
    const r = echSecurity(c, data, { ...at, kind: 'endpoint', endpointUseCase: 'complete_edr', endpoints: 1000, totalDays: 7, logsdb: true, availability: 'high' });
    expect(r.dailyGb).toBeCloseTo(105.75, 9);
    expect(byKey(r).ml!.ramGb).toBe((2 + 1) * 8);
  });
  it('NGAV has no ML node; Essential EDR adds 8 GB per 10,000 endpoints', () => {
    const ngav = byKey(echSecurity(c, data, { ...at, kind: 'endpoint', endpointUseCase: 'ngav', endpoints: 25_000, totalDays: 7, logsdb: true, availability: 'high' }));
    expect(ngav.ml).toBeUndefined();
    expect(ngav.kibana!.ramGb).toBe(4);
    const edr = byKey(echSecurity(c, data, { ...at, kind: 'endpoint', endpointUseCase: 'essential_edr', endpoints: 25_000, totalDays: 7, logsdb: true, availability: 'high' }));
    expect(edr.ml!.ramGb).toBe(3 * 8);
  });
  it('the user OS mix applies to Cloud Workload too (sheet quirk kept): 35 MB/day at any mix', () => {
    const r = echSecurity(c, data, { ...at, kind: 'endpoint', endpointUseCase: 'cwp_protect', endpoints: 1000, totalDays: 7, logsdb: true, availability: 'high' });
    expect(r.dailyGb).toBeCloseTo((25 * 35) / 100, 9); // 75% "Windows" at 0 MB/day
  });
});
