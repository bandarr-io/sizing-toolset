// ECH packaging and pricing rules (D40) on a small made-up data set, so CI covers them without the
// internal price table. Prices here are invented round numbers, not Elastic prices.
import { buildConstantSet, defaultConstants, type Constant } from '@sizing/constants';
import { describe, expect, it } from 'vitest';
import { fitToIncrements } from '../../src/ech/common.ts';
import { echObservability, type EchData, type EchSku } from '../../src/index.ts';

const R = 'AWS-test-1 (Testland)';
const sku = (id: string, type: string, ramDisk: number, increments: number[], extra: Partial<EchSku> = {}): EchSku => ({
  id, provider: 'aws', type, sellableRamGb: increments.at(-1)!, vcpu: 8, ramDisk, excludedRegions: '', ingestPerGbRamPerDay: 10, increments, ...extra,
});
const roles = ['hot', 'warm', 'cold', 'frozen', 'master', 'coordinating', 'ml', 'kibana'] as const;
const data: EchData = {
  source: { file: 'fixture', version: 'test', extractedAt: '2026-09-28T00:00:00Z' },
  skus: [
    sku('aws.es.datahot.x', 'data_hot', 30, [1, 2, 4, 8, 15, 30, 60]),
    sku('aws.es.datawarm.x', 'data_warm', 100, [2, 4, 8, 15, 30, 60]),
    sku('aws.es.datacold.x', 'data_cold', 100, [2, 4, 8, 15, 30, 60]),
    sku('aws.es.datafrozen.x', 'data_frozen', 75, [4, 8, 15, 30, 60]),
    sku('aws.es.master.x', 'master', 10, [1, 2, 4, 8]),
    sku('aws.es.coordinating.x', 'coordinating', 10, [1, 2, 4, 8]),
    sku('aws.es.ml.x', 'ml', 10, [1, 2, 4, 8]),
    sku('aws.kibana.x', 'kibana', 10, [1, 2, 4, 8]),
    sku('aws.es.datahot.nowhere', 'data_hot', 30, [1, 2, 4], { excludedRegions: `{ ${R} }` }),
  ],
  prices: {}, // filled below: $0.10 per GB-hour for every instance
  regions: [{ provider: 'aws', name: R, status: 'Launched' }],
  channelTiers: [{ channel: 'Elastic Direct', tier: 'Enterprise', provider: 'aws' }],
  dts: (['Data inter-node', 'Data out', 'Snapshot storage', 'Storage api'] as const).map((item) => ({ provider: 'aws', item, channel: 'Elastic Direct', price: 0.01 })),
  dtsOverrides: [],
  defaults: { aws: Object.fromEntries(roles.map((r) => [r, r === 'kibana' ? 'aws.kibana.x' : ['master', 'coordinating', 'ml'].includes(r) ? `aws.es.${r}.x` : `aws.es.data${r}.x`])) },
  metricsBenchmark: [{ sku: 'aws.es.datahot.x', eps: 100_000, vcpu: 8, ramGb: 60 }],
};
for (const k of data.skus) data.prices[`${k.id}|${R}|Enterprise`] = { direct: 0.1 };
// Most checks use the table as-is (adjustment 1): $0.10 × 730 = $73.00 per GB-month.
const c = buildConstantSet([...defaultConstants.byKey.values()].map((x): Constant => (x.key === 'ech.price_adjustment' ? { ...x, value: 1 } : x)));
const at = { provider: 'aws', region: R, channel: 'Elastic Direct', tier: 'Enterprise' } as const;

describe('ECH node sizes (Logs!H185:K193)', () => {
  it('picks the smallest size that holds the per-zone need', () => {
    expect(fitToIncrements(51.11, 2, [1, 2, 4, 8, 15, 30, 60])).toEqual({ nodeSizeGb: 30, nodesPerZone: 1, zones: 2, roundedGb: 60 });
  });
  it('above the largest size, adds whole nodes of that size per zone', () => {
    expect(fitToIncrements(250, 2, [1, 2, 4, 8, 15, 30, 60])).toEqual({ nodeSizeGb: 60, nodesPerZone: 3, zones: 2, roundedGb: 360 });
  });
});

describe('ECH logs (made-up prices)', () => {
  // 100 GB/day, 1 d hot, all LogsDB: 100 × 0.46 × 2 × 1.2 / 0.8 = 138 GB disk → 138 / 30 = 4.6 GB RAM;
  // ingest 100 / (10 × 0.8) = 12.5 GB RAM wins → 6.25 per zone → 8 GB nodes × 2 zones = 16 GB.
  const r = echObservability(c, data, { ...at, kind: 'logs', gbPerDay: 100, retentionDays: { hot: 1 } });
  const hot = r.lines.find((l) => l.key === 'hot')!;
  it('sizes hot by the larger of disk and ingest, then rounds to node sizes', () => {
    expect(hot).toMatchObject({ constraint: 'cpu', nodeSizeGb: 8, nodesPerZone: 1, zones: 2, ramGb: 16, monthlyPerGb: 73 });
    expect(hot.annual).toBeCloseTo(73 * 16 * 12, 9);
  });
  it('rounds each line up to $1,000 only in the rounded total', () => {
    expect(hot.annualRounded).toBe(15000);
    expect(r.totalRounded).toBe(r.lines.reduce((s, l) => s + l.annualRounded, 0));
    expect(r.total).toBeLessThan(r.totalRounded);
  });
  it('bills master, coordinating, ML and Kibana at their fixed sizes', () => {
    expect(r.lines.filter((l) => ['master', 'coordinating', 'ml', 'kibana'].includes(l.key)).map((l) => l.ramGb)).toEqual([3, 4, 4, 8]);
  });
  it('an instance not offered in the region is shown as an error line, not dropped silently', () => {
    const x = echObservability(c, data, { ...at, kind: 'logs', gbPerDay: 100, retentionDays: { hot: 1 }, skus: { hot: 'aws.es.datahot.nowhere' } });
    const line = x.lines.find((l) => l.key === 'hot')!;
    expect(line.error).toMatch(/not offered/);
    expect(line.annual).toBe(0);
    expect(x.warnings.join(' ')).toMatch(/leaves this line out/);
  });
  it('rejects a tier the channel does not sell', () => {
    expect(() => echObservability(c, data, { ...at, tier: 'Gold', kind: 'logs', gbPerDay: 1, retentionDays: { hot: 1 } })).toThrow(/does not sell Gold/);
  });
  it('applies the default price adjustment (D40) to the hourly price before rounding to cents', () => {
    const adjusted = echObservability(defaultConstants, data, { ...at, kind: 'logs', gbPerDay: 100, retentionDays: { hot: 1 } });
    expect(adjusted.lines.find((l) => l.key === 'hot')!.monthlyPerGb).toBe(78.95); // ROUND(0.1 × 1.0815 × 730, 2)
  });
});
