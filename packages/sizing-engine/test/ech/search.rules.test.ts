// ECH Search and Vector rules (D40) on a small made-up data set, so CI covers them without the internal
// price table. Prices are invented round numbers, not Elastic prices.
import { defaultConstants as c } from '@sizing/constants';
import { describe, expect, it } from 'vitest';
import { echSearch, echVector, type EchData, type EchSku } from '../../src/index.ts';

const R = 'AWS-test-1 (Testland)';
const inc = [1, 2, 4, 8, 15, 30, 60];
const sku = (id: string, type: string, extra: Partial<EchSku> = {}): EchSku => ({
  id, provider: 'aws', type, sellableRamGb: 60, vcpu: 8, ramDisk: 30, excludedRegions: '', ingestPerGbRamPerDay: 10, increments: inc, ...extra,
});
const data: EchData = {
  source: { file: 'fixture', version: 'test', extractedAt: '2026-09-28T00:00:00Z' },
  skus: [
    sku('aws.es.datahot.cpu', 'data_hot', { status: 'CPU Optimized', selection: 'Hot_in_Production', vcpu: 32, ramDisk: 60 }),
    sku('aws.es.datahot.vec', 'data_hot*', { status: 'Vector Search', ramDisk: 60 }),
    sku('aws.es.datahot.plain', 'data_hot', { status: 'Hot_in_Production' }),
    sku('aws.enterprisesearch.x', 'enterprisesearch', { selection: 'Enterprisesearch_in_Production', increments: [2, 4, 8, 16] }),
    sku('aws.es.master.x', 'master', { selection: 'Master_in_Production' }),
    sku('aws.es.coordinating.x', 'coordinating', { selection: 'Coordinating_in_Production' }),
    sku('aws.es.ml.x', 'ml', { selection: 'ML_in_Production' }),
    sku('aws.kibana.x', 'kibana', { selection: 'Kibana_in_Production' }),
  ],
  prices: {},
  regions: [{ provider: 'aws', name: R, status: 'Launched' }],
  channelTiers: [{ channel: 'Elastic Direct', tier: 'Enterprise', provider: 'aws' }],
  dts: [], dtsOverrides: [], defaults: {}, metricsBenchmark: [],
};
// $0.10 per GB-hour → $73.00 per GB-month, everywhere.
for (const k of data.skus) data.prices[`${k.id}|${R}|Enterprise`] = { direct: 0.1 };
const at = { provider: 'aws', region: R, channel: 'Elastic Direct', tier: 'Enterprise' } as const;

describe('ECH search (Search sheet)', () => {
  // 32 vCPU: threads/vCPU = (48 + 1) / 32; 100 ms × 400 ops/s / 1000 = 40 threads → 26.12 vCPU → / (32/60) = 48.98 GB.
  // Storage: 1M × 20 KB = 20 GB / 0.8 × 2 = 50 GB → / 60 = 0.83 GB. CPU wins: 24.49 per zone → 30 GB nodes × 2.
  const r = echSearch(c, data, { ...at, documents: 1_000_000, avgDocKb: 20, peakOpsPerSecond: 400 });
  const by = Object.fromEntries(r.lines.map((l) => [l.key, l]));
  it('sizes data RAM by the larger of CPU and storage, rounded to node sizes', () => {
    expect(by.hot).toMatchObject({ sku: 'aws.es.datahot.cpu', constraint: 'cpu', nodeSizeGb: 30, nodesPerZone: 1, zones: 2, ramGb: 60 });
    expect(r.facts!.find((f) => f.label === 'vCPU needed')!.value).toBeCloseTo(40 / (49 / 32), 9);
  });
  it('prices data transfer and storage as 15% of the data line (rounded total uses the rounded line)', () => {
    expect(by.transfer!.annual).toBeCloseTo(0.15 * 73 * 60 * 12, 6);
    expect(by.transfer!.annualRounded).toBe(Math.ceil((0.15 * by.hot!.annualRounded) / 1000) * 1000);
  });
  it('Custom Search has no Enterprise Search nodes; Ingest keeps them within 2 to 8 GB', () => {
    expect(by.enterprisesearch).toBeUndefined();
    const ingest = echSearch(c, data, { ...at, useCase: 'Ingest', documents: 1_000_000, avgDocKb: 20, peakOpsPerSecond: 400 });
    expect(ingest.lines.find((l) => l.key === 'enterprisesearch')!.ramGb).toBe(8); // 60 × 0.25 = 15 → 16 GB rounded → capped at 8
  });
});

describe('ECH vector search (Vector sheet)', () => {
  const corpus = { documents: 1_000_000, vectorsPerDoc: 10, dims: 512 };
  it('int8: 10M × (512 + 48) bytes = 5.6 → 6 GB; one 8 GB node (6 GB off-heap), ×2 replicas', () => {
    const r = echVector(c, data, { ...at, method: 'int8', ...corpus, sku: 'aws.es.datahot.vec' });
    expect(r.lines[0]).toMatchObject({ ramGb: 16, nodeSizeGb: 8 });
  });
  it('the HNSW block counts zones twice, as the sheet does', () => {
    const one = echVector(c, data, { ...at, method: 'int8', ...corpus, sku: 'aws.es.datahot.vec', zones: 1 });
    const two = echVector(c, data, { ...at, method: 'int8', ...corpus, sku: 'aws.es.datahot.vec', zones: 2 });
    // 2 zones: per-zone 3 GB fits a 4 GB node (3 GB off-heap), but nodes/zone = ROUNDUP(6 / 3) = 2, × 2 zones × 4 GB.
    expect([one.lines[0]!.ramGb, two.lines[0]!.ramGb]).toEqual([16, 32]);
  });
  it('BBQ uses the 75% vector table for vector-profile instances and the 50% table otherwise', () => {
    const big = { documents: 100_000_000, vectorsPerDoc: 10, dims: 1024 }; // off-heap 1e9 × (128 + 14 + 64) bytes = 206 GB: vector table 300 GB (225 off-heap) vs generic 420 GB (210)
    const vec = echVector(c, data, { ...at, method: 'bbq', ...big, sku: 'aws.es.datahot.vec' });
    const gen = echVector(c, data, { ...at, method: 'bbq', ...big, sku: 'aws.es.datahot.cpu' });
    expect(vec.facts!.find((f) => f.label === 'Off-heap needed')!.value).toBe(206);
    expect(vec.lines[0]!.ramGb!).toBeLessThan(gen.lines[0]!.ramGb!);
  });
  it('BBQ and Disk BBQ only accept the calculator\'s instance types', () => {
    expect(() => echVector(c, data, { ...at, method: 'bbq', ...corpus, sku: 'aws.es.datahot.plain' })).toThrow(/not one of the BBQ calculator/);
  });
  it('Disk BBQ reports the off-heap range and node count', () => {
    const r = echVector(c, data, { ...at, method: 'disk_bbq', ...corpus, sku: 'aws.es.datahot.cpu' });
    const fact = (l: string) => r.facts!.find((f) => f.label === l)!.value;
    expect(fact('Off-heap needed, low estimate')).toBeLessThanOrEqual(fact('Off-heap needed, high estimate'));
    expect(fact('Nodes')).toBe(2);
    expect(r.lines[0]!.annual).toBeCloseTo(73 * r.lines[0]!.ramGb! * 12, 6);
  });
});
