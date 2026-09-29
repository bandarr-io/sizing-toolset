// One-page customer summary: plain content, key numbers, the caveat, and escaped user text.
import { defaultConstants as c } from '@sizing/constants';
import { forward, type EchData, type EchSku } from '@sizing/engine';
import { describe, expect, it } from 'vitest';
import type { CostReport } from '../src/cost.ts';
import { customerSummaryHtml, describeWorkload, escapeHtml } from '../src/customerSummary.ts';
import { defaultEch, echTotals, runEch } from '../src/ech/state.ts';
import { fmtMoney } from '../src/format.ts';
import { defaultState } from '../src/state.ts';

const AT = '2026-09-29T12:00:00Z';
const EVIL = '<script>alert("x")</script> & Co';

describe('customer summary: self-managed', () => {
  const base = defaultState();
  const state = { ...base, name: EVIL, forward: { ...base.forward, workloads: [{ ...base.forward.workloads[0]!, id: '<b>Web logs</b>' }] } };
  const result = forward(state.forward, c);
  const html = customerSummaryHtml({ kind: 'self_managed', state, result }, AT);

  it('is a standalone page with the headings a customer reads', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true);
    for (const h of ['What you asked for', 'What you need', 'What this depends on']) expect(html).toContain(h);
    expect(html).toContain('This is an estimate, not a quote.');
    expect(html).toContain('Prepared with the Elastic Ballpark Editor');
    expect(html).toContain('2026-09-29');
  });

  it('shows the key numbers: total memory and node count', () => {
    const nodes = result.tiers.reduce((s, t) => s + t.nodes, 0) + result.overhead.reduce((s, o) => s + o.count, 0);
    expect(html).toContain(`${result.totalRamGb.toLocaleString('en-US')} GB`);
    expect(html).toContain(`<div class="v">${nodes}</div>`);
  });

  it('escapes everything the user typed', () => {
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b>Web logs</b>');
    expect(html).toContain(escapeHtml(EVIL));
    expect(html).toContain('&lt;b&gt;Web logs&lt;/b&gt;');
  });

  it('makes no external requests and uses no em dashes', () => {
    expect(html).not.toMatch(/<(link|script|img)\b/);
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toContain('—');
  });

  it('adds cost only when prices are set', () => {
    expect(html).not.toContain('Estimated cost');
    const cost: CostReport = { termYears: 2, years: [{ year: 1, lines: [], total: 1000 }, { year: 2, lines: [], total: 1200 }], total: 2200, partial: true };
    const priced = customerSummaryHtml({ kind: 'self_managed', state, result, cost }, AT);
    expect(priced).toContain('Estimated cost');
    expect(priced).toContain('$2,200');
    expect(priced).toContain('parts without a price are left out');
  });

  it('describes a workload in plain words', () => {
    expect(describeWorkload({ id: 'Logs', kind: 'logs', rawGbPerDay: 500, retentionDays: { hot: 7, frozen: 83 }, replicas: {} }))
      .toBe('Logs: 500 GB of new data a day, kept 90 days: 7 on fast storage, 83 on low-cost storage that stays searchable');
  });
});

describe('customer summary: Elastic Cloud', () => {
  const R = 'AWS-us-east-1 (N. Virginia)';
  const roles: [string, string, number[]][] = [
    ['aws.es.datahot.x', 'data_hot', [1, 2, 4, 8, 15, 30, 60]], ['aws.es.datafrozen.x', 'data_frozen', [4, 8, 15, 30, 60]],
    ['aws.es.master.x', 'master', [1, 2, 4, 8]], ['aws.es.coordinating.x', 'coordinating', [1, 2, 4, 8]],
    ['aws.es.ml.x', 'ml', [1, 2, 4, 8]], ['aws.kibana.x', 'kibana', [1, 2, 4, 8]],
  ];
  const skus: EchSku[] = roles.map(([id, type, increments]) => ({ id, provider: 'aws', type, sellableRamGb: 60, vcpu: 8, ramDisk: 30, excludedRegions: '', ingestPerGbRamPerDay: 10, increments }));
  const data: EchData = {
    source: { file: 'fixture', version: 'test', extractedAt: AT },
    skus,
    prices: Object.fromEntries(skus.map((s) => [`${s.id}|${R}|Enterprise`, { direct: 0.1 }])),
    regions: [{ provider: 'aws', name: R, status: 'Launched' }],
    channelTiers: [{ channel: 'Elastic Direct', tier: 'Enterprise', provider: 'aws' }],
    dts: (['Data inter-node', 'Data out', 'Snapshot storage', 'Storage api'] as const).map((item) => ({ provider: 'aws', item, channel: 'Elastic Direct', price: 0.01 })),
    dtsOverrides: [],
    defaults: { aws: { hot: 'aws.es.datahot.x', frozen: 'aws.es.datafrozen.x', master: 'aws.es.master.x', coordinating: 'aws.es.coordinating.x', ml: 'aws.es.ml.x', kibana: 'aws.kibana.x' } },
    metricsBenchmark: [],
  };
  const ech = defaultEch();
  ech.items = [{ ...ech.items[0]!, name: EVIL }];
  const outcomes = runEch(c, data, ech);
  const html = customerSummaryHtml({ kind: 'ech', state: { ...defaultState(), name: 'Cloud estimate' }, ech, data, outcomes }, AT);

  it('shows the list price per year, the deployment and the caveat', () => {
    expect(html).toContain(fmtMoney(echTotals(outcomes, false).annual));
    expect(html).toContain('Elastic Cloud Hosted');
    expect(html).toContain('This is an estimate, not a quote.');
    expect(html).toContain('1,000 GB of logs a day');
  });

  it('escapes use case names and uses no em dashes', () => {
    expect(html).not.toContain('<script>');
    expect(html).toContain(escapeHtml(EVIL));
    expect(html).not.toContain('—');
  });
});
