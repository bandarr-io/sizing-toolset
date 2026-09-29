// Elastic Cloud mode (D40) on an invented data set: dispatch per use case, totals, placement fixes, redirect.
import { defaultConstants as c } from '@sizing/constants';
import type { EchData, EchSku } from '@sizing/engine';
import { describe, expect, it } from 'vitest';
import { defaultEch, echTotals, newEchItem, regionsFor, runEch, tiersFor, withPlacement } from '../src/ech/state.ts';
import { defaultState, newWorkload, redirectToEch } from '../src/state.ts';

const R = 'AWS-us-east-1 (N. Virginia)';
const roles: [string, string, number[]][] = [
  ['aws.es.datahot.x', 'data_hot', [1, 2, 4, 8, 15, 30, 60]], ['aws.es.datawarm.x', 'data_warm', [2, 4, 8, 15, 30, 60]],
  ['aws.es.datacold.x', 'data_cold', [2, 4, 8, 15, 30, 60]], ['aws.es.datafrozen.x', 'data_frozen', [4, 8, 15, 30, 60]],
  ['aws.es.master.x', 'master', [1, 2, 4, 8]], ['aws.es.coordinating.x', 'coordinating', [1, 2, 4, 8]],
  ['aws.es.ml.x', 'ml', [1, 2, 4, 8]], ['aws.kibana.x', 'kibana', [1, 2, 4, 8]],
];
const skus: EchSku[] = roles.map(([id, type, increments]) => ({ id, provider: 'aws', type, sellableRamGb: 60, vcpu: 8, ramDisk: 30, excludedRegions: '', ingestPerGbRamPerDay: 10, increments }));
const data: EchData = {
  source: { file: 'fixture', version: 'test', extractedAt: '2026-09-28T00:00:00Z' },
  skus,
  prices: Object.fromEntries(skus.map((s) => [`${s.id}|${R}|Enterprise`, { direct: 0.1 }])),
  regions: [{ provider: 'aws', name: R, status: 'Launched' }, { provider: 'aws', name: 'AWS-nowhere-1 (Unpriced)', status: 'Planned' }],
  channelTiers: [{ channel: 'Elastic Direct', tier: 'Gold', provider: 'aws' }, { channel: 'Elastic Direct', tier: 'Enterprise', provider: 'aws' }],
  dts: (['Data inter-node', 'Data out', 'Snapshot storage', 'Storage api'] as const).map((item) => ({ provider: 'aws', item, channel: 'Elastic Direct', price: 0.01 })),
  dtsOverrides: [],
  defaults: { aws: { hot: 'aws.es.datahot.x', warm: 'aws.es.datawarm.x', cold: 'aws.es.datacold.x', frozen: 'aws.es.datafrozen.x', master: 'aws.es.master.x', coordinating: 'aws.es.coordinating.x', ml: 'aws.es.ml.x', kibana: 'aws.kibana.x' } },
  metricsBenchmark: [],
};

describe('Elastic Cloud mode', () => {
  it('prices each use case as its own deployment and adds them up', () => {
    const second = newEchItem('logs', ['Logs']);
    if (second.useCase !== 'logs') throw new Error('expected logs');
    const s = { ...defaultEch(), items: [newEchItem('logs'), { ...second, req: { gbPerDay: 10, retentionDays: { hot: 1 } } }] };
    const out = runEch(c, data, s);
    expect(out.map((o) => o.item.name)).toEqual(['Logs', 'Logs 2']);
    const exact = echTotals(out, false).annual;
    const each = out.map((o) => ('result' in o ? o.result.total : 0));
    expect(exact).toBeCloseTo(each[0]! + each[1]!, 6);
    expect(echTotals(out, true).annual).toBeGreaterThanOrEqual(exact);
  });

  it('a use case that cannot be priced reports an error without stopping the others', () => {
    const s = { ...defaultEch(), items: [newEchItem('logs'), newEchItem('metrics')] }; // no metrics benchmark in the fixture
    const out = runEch(c, data, s);
    expect('result' in out[0]!).toBe(true);
    expect(out[1]).toMatchObject({ error: expect.stringMatching(/benchmark/) });
  });

  it('lists only priced regions and keeps the placement valid when the cloud or channel changes', () => {
    expect(regionsFor(data, 'aws').map((r) => r.name)).toEqual([R]);
    expect(tiersFor(data, 'aws', 'Elastic Direct')).toEqual(['Gold', 'Enterprise']);
    const p = withPlacement(data, defaultEch().placement, { tier: 'Platinum' as never });
    expect(p.tier).toBe('Enterprise');
  });

  it('choosing Elastic Cloud in Size a workload carries logs and SIEM volumes over once', () => {
    const s = { ...defaultState(), forward: { ...defaultState().forward, workloads: [{ ...newWorkload('logs'), rawGbPerDay: 200 }, { ...newWorkload('siem'), rawGbPerDay: 50 }] } };
    const next = redirectToEch(s, s.forward.workloads);
    expect(next.mode).toBe('ech');
    expect(next.ech!.items.map((i) => i.useCase)).toEqual(['logs', 'siem']);
    expect(next.ech!.items[0]!.req).toMatchObject({ gbPerDay: 200 });
    expect(redirectToEch({ ...next, mode: 'forward' }, []).ech).toBe(next.ech);
  });
});
