import { defaultConstants as c } from '@sizing/constants';
import { forward, type EchData, type EchSku } from '@sizing/engine';
import { describe, expect, it } from 'vitest';
import { defaultEch, newEchItem, runEch } from '../src/ech/state.ts';
import { romHtml, scenarioEcu, summaryRows, type RomInput } from '../src/rom/rom.ts';
import { romPdfDefinition } from '../src/rom/romPdf.ts';
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

describe('D51 executive summary', () => {
  it('comes right after the contents, with one row per scenario', () => {
    const html = romHtml(input());
    const at = (x: string) => html.indexOf(x);
    expect(at('<h2>EXECUTIVE SUMMARY</h2>')).toBeGreaterThan(at('Elastic Sizing Estimation'));
    expect(at('<h2>EXECUTIVE SUMMARY</h2>')).toBeLessThan(at('<h2>CAVEATS &amp; CONSIDERATIONS</h2>'));
    expect(html).toContain('<li class="main">EXECUTIVE SUMMARY</li><li class="main">CAVEATS');
    const rows = summaryRows(input());
    expect(rows.map((r) => r.deployment)).toEqual(['Elastic Cloud Hosted', 'Self-managed']);
    expect(rows[0]!.data).toBe('106GB / Day, 365 Days');
    expect(rows[0]!.license).toMatch(/^[\d,]+ ECU$/);
    expect(rows[0]!.year1).toMatch(/^\$[\d,]+$/);
    expect(rows[1]!.year1).toBe('[PRICE]'); // no ERU price
    expect(html).toContain('Term: 08/01/2026 to 07/31/2027.');
  });

  it('uses the SA\'s opening when given, and a standard sentence otherwise', () => {
    expect(romHtml(input())).toContain('This document gives a budgetary estimate for Skyward &lt;Federal&gt; across 2 scenarios.');
    const mine = romHtml({ ...input(), summary: 'We recommend option A.\n\nIt keeps a year of data.' });
    expect(mine).toContain('<h2>EXECUTIVE SUMMARY</h2><p>We recommend option A.</p><p>It keeps a year of data.</p>');
    expect(mine).not.toContain('This document gives a budgetary estimate');
  });

  it('adds services billed in year 1 to the year 1 figure', () => {
    const base = input();
    const s = base.scenarios[1]!;
    const withPrice = { ...base, scenarios: [{ ...s, eruPrice: 1000, services: [{ line: { serviceId: 'x', quantity: 2 }, item: { id: 'x', name: 'X', mpn: '', unit: 'day', billing: 'one_time' as const, description: '', dated: false }, unitPrice: 500, total: 1000 }] } as typeof s] };
    const eru = s.kind === 'self_managed' ? s.result.licenseUnits.value : 0;
    expect(summaryRows(withPrice)[0]!.year1).toBe(`$${(eru * 1000 + 1000).toLocaleString('en-US')}`);
    const unpriced = { ...withPrice, scenarios: [{ ...withPrice.scenarios[0]!, services: [...(withPrice.scenarios[0]!.services ?? []), { line: { serviceId: 'y', quantity: 1 }, item: { id: 'y', name: 'Y', mpn: '', unit: 'day', billing: 'one_time' as const, description: '', dated: false }, unitPrice: undefined, total: undefined }] }] };
    expect(summaryRows(unpriced)[0]!.year1).toBe(`$${(eru * 1000 + 1000).toLocaleString('en-US')} + [PRICE]`);
  });
});

describe('D52 recommended scenario', () => {
  it('highlights the recommended scenario in the executive summary and names it in the notes', () => {
    const base = input();
    const html = romHtml({ ...base, scenarios: [base.scenarios[0]!, { ...base.scenarios[1]!, recommended: true }] });
    expect(html).toContain('<tr class="recommended"><th scope="row">Scenario - Self-managed<div class="tag">RECOMMENDED</div></th>');
    expect(html).toContain('<li>Recommended: Scenario - Self-managed.</li>');
    expect(romHtml(base)).not.toContain('RECOMMENDED');
  });
});

describe('ROM branding', () => {
  it('puts the official logo on the cover in both versions', () => {
    const html = romHtml(input());
    expect(html).toMatch(/<div class="logo"><svg[^>]*viewBox="0 0 421 82"/);
    expect(html).not.toContain('[Elastic logo]');
    expect(JSON.stringify(romPdfDefinition(input()).content)).toContain('viewBox=\\"0 0 421 82\\"');
  });

  it('D53 puts the 3D glyph cover artwork bottom right in both versions', () => {
    expect(romHtml(input())).toMatch(/<div class="cover-art"><svg[^>]*viewBox="0 0 640 640"/);
    const art = (romPdfDefinition(input()).content as { svg?: string; absolutePosition?: { x: number; y: number } }[]).find((c) => c.svg?.includes('0 0 640 640'));
    expect(art?.absolutePosition).toEqual({ x: 3.03 * 72, y: 4.58 * 72 });
  });
});
