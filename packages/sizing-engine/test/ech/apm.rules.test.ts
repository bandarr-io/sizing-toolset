// ECH APM rules (D40) on a small made-up data set. Prices are invented round numbers, not Elastic prices.
import { buildConstantSet, defaultConstants, type Constant } from '@sizing/constants';
import { describe, expect, it } from 'vitest';
import { apmServerGb, echApm, type EchApmExtras, type EchData, type EchSku } from '../../src/index.ts';

const R = 'AWS-test-1 (Testland)';
const sku = (id: string, type: string, ramDisk: number, increments: number[]): EchSku => ({
  id, provider: 'aws', type, sellableRamGb: increments.at(-1)!, vcpu: 8, ramDisk, excludedRegions: '', ingestPerGbRamPerDay: 10, increments,
});
const ladder = [1, 2, 4, 8, 15, 30, ...Array.from({ length: 20 }, (_, i) => 60 + 30 * i)];
const apm: EchApmExtras = {
  eventsPerSecPerGb: 300, ladder, secondLadder: [1, 2, 4, 8, 16, 32, 64], secondLadderSkus: ['aws.integrationsserver.big.2'],
  defaults: { aws: { apm: 'aws.integrationsserver.x' } },
};
const data: EchData = {
  source: { file: 'fixture', version: 'test', extractedAt: '2026-09-28T00:00:00Z' },
  skus: [
    sku('aws.es.datahot.x', 'data_hot', 30, [1, 2, 4, 8, 15, 30, 60]),
    sku('aws.es.datawarm.x', 'data_warm', 100, [2, 4, 8, 15, 30, 60]),
    sku('aws.integrationsserver.x', 'apm', 10, [1, 2, 4, 8]),
    sku('aws.integrationsserver.big.2', 'apm', 10, [1, 2, 4, 8]),
    sku('aws.es.master.x', 'master', 10, [1, 2, 4]),
    sku('aws.es.coordinating.x', 'coordinating', 10, [1, 2, 4]),
    sku('aws.es.ml.x', 'ml', 10, [1, 2, 4]),
    sku('aws.kibana.x', 'kibana', 10, [1, 2, 4, 8]),
  ],
  prices: {},
  regions: [{ provider: 'aws', name: R, status: 'Launched' }],
  channelTiers: [{ channel: 'Elastic Direct', tier: 'Enterprise', provider: 'aws' }, { channel: 'Elastic Direct', tier: 'Gold', provider: 'aws' }],
  dts: [], dtsOverrides: [],
  defaults: { aws: { hot: 'aws.es.datahot.x', warm: 'aws.es.datawarm.x', master: 'aws.es.master.x', coordinating: 'aws.es.coordinating.x', ml: 'aws.es.ml.x', kibana: 'aws.kibana.x' } },
  metricsBenchmark: [],
  extras: { apm },
};
for (const k of data.skus) for (const t of ['Enterprise', 'Gold']) data.prices[`${k.id}|${R}|${t}`] = { direct: 0.1 };
const c = buildConstantSet([...defaultConstants.byKey.values()].map((x): Constant => (x.key === 'ech.price_adjustment' ? { ...x, value: 1 } : x)));
const at = { provider: 'aws', region: R, channel: 'Elastic Direct', tier: 'Enterprise' } as const;

describe('ECH APM Server size (K148)', () => {
  it('takes the smallest size whose throughput covers the events/s', () => {
    expect(apmServerGb(4863.3, ladder, 300)).toBe(30);
    expect(apmServerGb(299, ladder, 300)).toBe(1);
  });
  it('a value exactly on a step takes that step (the sheet returns #N/A and drops the line)', () => {
    expect(apmServerGb(4500, ladder, 300)).toBe(15);
  });
  it('no events means no APM Server line', () => {
    expect(apmServerGb(0, ladder, 300)).toBeUndefined();
  });
});

describe('ECH APM (made-up prices)', () => {
  // 1,000 traces/min, all defaults: average trace (4×650 + 20×500) × 0.07 + 300 = 1,182 B; chatty 70,482 B.
  // GB/day = (1,182 × 0.99 + 70,482 × 0.01) × 1,000 × 1,440 / 1e9 = 2.7000432.
  const r = echApm(c, data, { ...at, tracesPerMinute: 1000, retentionDays: { hot: 1, warm: 10 } });
  const by = Object.fromEntries(r.lines.map((l) => [l.key, l]));
  it('turns traces into GB/day and events/s', () => {
    expect(r.dailyGb).toBeCloseTo((1182 * 0.99 + 70482 * 0.01) * 1000 * 1440 / 1e9, 9);
    // events/s = ((4 + 20 × 0.07) × 0.99 + (4 + 2,000 × 0.07) × 0.01) × 1,000 / 60 = 113.1
    expect(r.facts!.find((f) => f.label === 'APM events per second')!.value).toBeCloseTo(113.1, 9);
    expect(by.apm).toMatchObject({ ramGb: 1, monthlyPerGb: 73 });
  });
  it('shrinks LogsDB data by 15% on Enterprise only', () => {
    const gold = echApm(c, data, { ...at, tier: 'Gold', tracesPerMinute: 100_000, retentionDays: { hot: 1, warm: 10 } });
    const ent = echApm(c, data, { ...at, tracesPerMinute: 100_000, retentionDays: { hot: 1, warm: 10 } });
    const warm = (x: typeof r) => x.lines.find((l) => l.key === 'warm')!.math.find((m) => m.label === 'warm data, one copy')!.value;
    expect(warm(ent) / warm(gold)).toBeCloseTo(0.85, 9);
  });
  it('data transfer is 10% of the data tiers and APM Server, on the rounded lines when rounded', () => {
    const base = ['hot', 'warm', 'apm'].map((k) => by[k]!);
    expect(by.transfer!.annual).toBeCloseTo(0.1 * base.reduce((s, l) => s + l.annual, 0), 9);
    expect(by.transfer!.annualRounded).toBe(Math.ceil(0.1 * base.reduce((s, l) => s + l.annualRounded, 0) / 1000) * 1000);
  });
  it('year-one spend equals the total (no storage line)', () => {
    expect(r.y1Spend).toBe(r.total);
    expect(r.y1SpendRounded).toBe(r.totalRounded);
  });
  it('the two special instance types use the 16/32 ladder', () => {
    const big = echApm(c, data, { ...at, tracesPerMinute: 60_000, retentionDays: { hot: 1 }, skus: { apm: 'aws.integrationsserver.big.2' } });
    // events/s = 113.1 × 60 = 6,786 → 1st ladder 30 GB, 2nd ladder 32 GB
    expect(big.lines.find((l) => l.key === 'apm')!.ramGb).toBe(32);
  });
  it('reports a missing APM table instead of pricing without it', () => {
    expect(() => echApm(c, { ...data, extras: {} }, { ...at, tracesPerMinute: 1, retentionDays: { hot: 1 } })).toThrow(/no APM tables/);
  });
});
