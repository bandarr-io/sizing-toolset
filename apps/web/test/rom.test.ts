import { defaultConstants as c } from '@sizing/constants';
import { forward, type EchData, type EchSku } from '@sizing/engine';
import { describe, expect, it } from 'vitest';
import { defaultEch, newEchItem, runEch } from '../src/ech/state.ts';
import { romHtml, scenarioEcu, type RomInput } from '../src/rom/rom.ts';
import { defaultState } from '../src/state.ts';

// Invented Elastic Cloud data: $0.10 per GB-hour everywhere.
const R = 'AWS-us-east-1 (N. Virginia)';
const roles: [string, string, number[]][] = [
  ['aws.es.datahot.x', 'data_hot', [1, 2, 4, 8, 15, 30, 60]], ['aws.es.datacold.x', 'data_cold', [2, 4, 8, 15, 30, 60]],
  ['aws.es.datafrozen.x', 'data_frozen', [4, 8, 15, 30, 60]], ['aws.es.datawarm.x', 'data_warm', [2, 4, 8, 15, 30, 60]],
  ['aws.es.master.x', 'master', [1, 2, 4, 8]], ['aws.es.coordinating.x', 'coordinating', [1, 2, 4, 8]], ['aws.es.ml.x', 'ml', [1, 2, 4, 8]], ['aws.kibana.x', 'kibana', [1, 2, 4, 8]],
];
const skus: EchSku[] = roles.map(([id, type, increments]) => ({ id, provider: 'aws', type, sellableRamGb: 60, vcpu: 8, ramDisk: 30, excludedRegions: '', ingestPerGbRamPerDay: 10, increments }));
const data: EchData = {
  source: { file: 'fixture', version: 'test', extractedAt: '2026-09-29T00:00:00Z' }, skus,
  prices: Object.fromEntries(skus.map((s) => [`${s.id}|${R}|Enterprise`, { direct: 0.1 }])),
  regions: [{ provider: 'aws', name: R, status: 'Launched' }],
  channelTiers: [{ channel: 'Elastic Direct', tier: 'Enterprise', provider: 'aws' }],
  dts: (['Data inter-node', 'Data out', 'Snapshot storage', 'Storage api'] as const).map((item) => ({ provider: 'aws', item, channel: 'Elastic Direct', price: 0.01 })),
  dtsOverrides: [],
  defaults: { aws: Object.fromEntries(roles.map(([id]) => [id.includes('kibana') ? 'kibana' : id.split('.')[2]!.replace('data', ''), id])) },
  metricsBenchmark: [],
};

function input(): RomInput {
  const ech = { ...defaultEch(), items: [{ ...newEchItem('logs'), req: { gbPerDay: 106, retentionDays: { hot: 1, cold: 6, frozen: 358 } } }] } as ReturnType<typeof defaultEch>;
  const state = defaultState();
  return {
    customer: 'Skyward <Federal>', date: '2026-07-13', termStart: '2026-08-01',
    team: [{ name: 'Dan Barr', role: 'Solution Architect', email: 'dan@example.com' }],
    scenarios: [
      { kind: 'ech', title: 'Scenario - Hot, Cold, Frozen (365 DAYS)', notes: 'Pilot first & expand', ech, data, outcomes: runEch(c, data, ech) },
      { kind: 'self_managed', title: 'Scenario - Self-managed', workloads: state.forward.workloads, result: forward(state.forward, c) },
    ],
  };
}

describe('Budgetary ROM', () => {
  const html = romHtml(input());

  it('keeps the caveats word for word, with their emphasis', () => {
    expect(html).toContain('<strong><em><u>serve as a starting point</u></em></strong>');
    expect(html).toContain('<strong><em>Sizing parameters are dynamic and may vary due to hardware/software factors.</em></strong>');
    expect(html).toContain("It's important to note that sizings <u class=\"accent\">should not</u> be considered facts");
    expect(html).toContain('continuously adapt sizing strategies to changing needs.');
  });

  it('has the template sections for every scenario, and the term dates', () => {
    for (const h of ['CAVEATS &amp; CONSIDERATIONS', 'TEAM INFORMATION', 'LICENSING OVERVIEW', 'SCOPE', 'ASSUMPTIONS', 'Data Retention Breakdown', 'Snapshot Considerations']) expect(html).toContain(h);
    expect(html).toContain('ELASTIC CLUSTER CONFIGURATION - Scenario - Hot, Cold, Frozen (365 DAYS)');
    expect(html).toContain('106GB / Day <strong>(365 Days Retention)</strong>');
    expect(html).toContain('08/01/2026');
    expect(html).toContain('07/31/2027');
    expect(html).toContain('DATE: 07/13/2026');
  });

  it('licenses Elastic Cloud in ECUs (rounded annual list price) and self-managed in ERUs', () => {
    const s = input().scenarios[0]!;
    if (s.kind !== 'ech') throw new Error('expected ech');
    const ecu = scenarioEcu(s);
    expect(ecu % 1000).toBe(0);
    expect(html).toContain(`<td>ESSCLOUD</td><td>ESS-ANNUAL-PREPAID</td>`);
    expect(html).toMatch(/Enterprise Resource Units \(ERU\)/);
    expect(html).toContain('[PRICE]'); // no ERU price given
    expect(html).not.toContain('#DIV/0!');
    expect(html).not.toMatch(/NaN|undefined/);
  });

  it('escapes what the user typed', () => {
    expect(html).toContain('Skyward &lt;Federal&gt;');
    expect(html).not.toContain('Skyward <Federal>');
    expect(html).toContain('NOTE: Pilot first &amp; expand');
  });
});
