import { defaultConstants as c } from '@sizing/constants';
import { forward } from '@sizing/engine';
import { describe, expect, it } from 'vitest';
import { costReport } from '../src/cost.ts';
import { customerSummaryHtml } from '../src/customerSummary.ts';
import { toMarkdown } from '../src/export.ts';
import { romHtml } from '../src/rom/rom.ts';
import { fillDescription, joinWords, missingStandardServices, newServiceId, upgradeCatalog, upgradeServices, parseCatalog, parseDescription, priceLines, SEED_CATALOG, servicesForYear, type ServiceItem, type ServiceLine } from '../src/services.ts';
import { defaultState, type AppState } from '../src/state.ts';

const catalog: ServiceItem[] = [
  { id: 'flex', name: 'Flex Consulting', mpn: 'SV-FLEX', unit: 'hour', unitPrice: 300, billing: 'one_time', description: 'Hands-on help.\n\nBilled by the hour.', dated: false },
  { id: 'dse', name: 'Dedicated Support Engineer', mpn: 'SV-DSE', unit: 'year', unitPrice: 200_000, billing: 'annual', description: '', dated: true },
  { id: 'train', name: 'Private Training', mpn: '', unit: 'package', billing: 'one_time', description: '', dated: true },
];
const withServices = (lines: ServiceLine[]): AppState => ({ ...defaultState(), services: { lines } });

describe('D46 services', () => {
  it('prices a line from the catalog, and a scenario price overrides it', () => {
    const [a, b] = priceLines(catalog, { lines: [{ serviceId: 'flex', quantity: 40 }, { serviceId: 'flex', quantity: 10, unitPrice: 250 }] });
    expect(a!.total).toBe(12_000);
    expect(b!.total).toBe(2_500);
  });

  it('leaves a line unpriced without a price, or when the service left the catalog', () => {
    const [a, b] = priceLines(catalog, { lines: [{ serviceId: 'train', quantity: 1 }, { serviceId: 'gone', quantity: 1 }] });
    expect(a!.total).toBeUndefined();
    expect(b!.item).toBeUndefined();
  });

  it('bills one-time services in year 1 and annual ones every year', () => {
    const s = { lines: [{ serviceId: 'flex', quantity: 40 }, { serviceId: 'dse', quantity: 1 }] };
    expect(servicesForYear(catalog, s, 1)!.annual).toBe(212_000);
    expect(servicesForYear(catalog, s, 2)!.annual).toBe(200_000);
    expect(servicesForYear(catalog, { lines: [{ serviceId: 'flex', quantity: 1 }] }, 2)).toBeUndefined();
  });

  it('adds a Services line to every year of Total cost, 0 after year 1 for one-time only', () => {
    const state = withServices([{ serviceId: 'flex', quantity: 40 }]);
    const withS = costReport(state, c, { eruPerYear: 1000 }, catalog);
    const without = costReport(state, c, { eruPerYear: 1000 }, []);
    if ('error' in withS || 'error' in without) throw new Error('unexpected');
    expect(withS.years.map((y) => y.lines.at(-1)!.annual)).toEqual([12_000, 0, 0]);
    expect(withS.total - without.total).toBe(12_000);
    expect(without.years[0]!.lines.some((l) => l.part === 'services')).toBe(false);
  });

  it('marks the cost partial when a picked service has no price', () => {
    const r = costReport(withServices([{ serviceId: 'train', quantity: 1 }]), c, { eruPerYear: 1000 }, catalog);
    if ('error' in r) throw new Error(r.error);
    expect(r.partial).toBe(true);
  });

  it('reads an exported catalog back, and rejects other files', () => {
    expect(parseCatalog(JSON.parse(JSON.stringify({ services: catalog })))).toEqual(catalog);
    expect(parseCatalog({ hello: 1 })).toBeUndefined();
    expect(parseCatalog(SEED_CATALOG)).toEqual(SEED_CATALOG);
  });

  it('makes a unique id for a new service', () => {
    expect(newServiceId('Flex', ['flex', 'flex-2'])).toBe('flex-3');
  });

  it('lists services in the Markdown export and the customer summary', () => {
    const state = withServices([{ serviceId: 'flex', quantity: 40 }]);
    const r = forward(state.forward, c);
    const services = priceLines(catalog, state.services);
    expect(toMarkdown(state, r, state.forward.workloads, 'x', undefined, services)).toMatch(/## Services[\s\S]*\| Flex Consulting \| SV-FLEX \| 40 hours \| \$300\.00 \| Once \| \$12,000 \|/);
    expect(customerSummaryHtml({ kind: 'self_managed', state, result: r, services }, '2026-09-29T00:00:00Z')).toMatch(/<h2>Services<\/h2>[\s\S]*Flex Consulting/);
  });

  it('puts a services table under the licensing tables and the descriptions on their own page in the ROM', () => {
    const state = withServices([{ serviceId: 'flex', quantity: 40 }, { serviceId: 'dse', quantity: 1 }, { serviceId: 'train', quantity: 1 }]);
    const html = romHtml({
      customer: 'Acme', date: '2026-09-29', termStart: '2026-10-01', team: [],
      scenarios: [{ kind: 'self_managed', title: 'Main', services: priceLines(catalog, state.services), workloads: state.forward.workloads, result: forward(state.forward, c) }],
    });
    expect(html).toContain('<caption>Services: Main</caption>');
    expect(html).toMatch(/<td>One-time<\/td><td>SV-FLEX<\/td><td>Flex Consulting<\/td><td class="accent"><\/td><td class="accent"><\/td><td>40<\/td><td>\$300\.00<\/td><td>\$12,000<\/td>/);
    expect(html).toMatch(/<td>Yr\. 1<\/td><td>SV-DSE<\/td><td>Dedicated Support Engineer<\/td><td class="accent">10\/01\/2026<\/td><td class="accent">09\/30\/2027<\/td>/);
    expect(html).toMatch(/<td>\[MPN\]<\/td><td>Private Training<\/td>[\s\S]*?<td>\[PRICE\]<\/td><td>\[PRICE\]<\/td>/);
    expect(html).toContain('<h2>SERVICE DESCRIPTIONS</h2><div class="svc"><h3 class="svc">Flex Consulting</h3><p>Hands-on help.</p><p>Billed by the hour.</p></div></section>');
    expect(html).toContain('<li class="main">SERVICE DESCRIPTIONS</li>');
  });

  it('leaves the services parts out of the ROM when the scenario has none', () => {
    const state = defaultState();
    const html = romHtml({ customer: 'Acme', date: '2026-09-29', termStart: '2026-10-01', team: [], scenarios: [{ kind: 'self_managed', title: 'Main', workloads: state.forward.workloads, result: forward(state.forward, c) }] });
    expect(html).not.toMatch(/Services:|SERVICE DESCRIPTIONS/);
  });
});

describe('D48 service descriptions', () => {
  it('reads capitals as headings, dashes as one list, and every other line as a paragraph', () => {
    expect(parseDescription('DESCRIPTION\nFirst line.\nSecond line.\n\nCOMMON TASKS\nServices:\n- Install\n• Map data\n\nNOT INCLUDED IN SCOPE')).toEqual([
      { kind: 'heading', text: 'DESCRIPTION' }, { kind: 'paragraph', text: 'First line.' }, { kind: 'paragraph', text: 'Second line.' },
      { kind: 'heading', text: 'COMMON TASKS' }, { kind: 'paragraph', text: 'Services:' }, { kind: 'list', items: ['Install', 'Map data'] },
      { kind: 'heading', text: 'NOT INCLUDED IN SCOPE' },
    ]);
  });

  it('seeds the Professional Services Engagement and training wording', () => {
    const pse = SEED_CATALOG.find((x) => x.id === 'professional-services-engagement')!;
    const heads = parseDescription(pse.description).filter((b) => b.kind === 'heading').map((b) => (b as { text: string }).text);
    expect(heads).toEqual(['DESCRIPTION', 'CUSTOMER PROFILE', 'COMMON TASKS WITHIN THE ENGAGEMENT', 'INCLUDED IN SCOPE', 'NOT INCLUDED IN SCOPE']);
    const training = SEED_CATALOG.find((x) => x.id === 'on-demand-training')!;
    expect(training.title).toBe('Training Recommendations');
    const filled = fillDescription(training, { serviceId: training.id, quantity: 5 }, { quantity: 5, unit: 'seat' });
    expect(parseDescription(filled).filter((b) => b.kind === 'list').map((b) => (b as { items: string[] }).items.length)).toEqual([9, 3]);
  });

  it('offers the standard services a catalog is missing', () => {
    expect(missingStandardServices(SEED_CATALOG.slice(0, 4)).map((x) => x.id)).toEqual(['professional-services-engagement']);
    expect(missingStandardServices(SEED_CATALOG)).toEqual([]);
  });

  it('prints headings and bullets in the ROM', () => {
    const state = withServices([{ serviceId: 'professional-services-engagement', quantity: 8 }]);
    const html = romHtml({ customer: 'Acme', date: '2026-09-29', termStart: '2026-10-01', team: [], scenarios: [{ kind: 'self_managed', title: 'Main', services: priceLines(SEED_CATALOG, state.services), workloads: state.forward.workloads, result: forward(state.forward, c) }] });
    expect(html).toContain('<h4 class="svc">COMMON TASKS WITHIN THE ENGAGEMENT</h4><p>Operational, implementation, and deployment services:</p><ul class="svc"><li>Installation and configuration</li>');
  });
});

describe('D49 fill-in fields', () => {
  const pse = SEED_CATALOG.find((x) => x.id === 'professional-services-engagement')!;
  const training = SEED_CATALOG.find((x) => x.id === 'on-demand-training')!;

  it('reproduces the past-ROM wording with the default values', () => {
    const text = fillDescription(pse, { serviceId: pse.id, quantity: 8 }, { quantity: 8, unit: 'day' });
    expect(text).toContain('including Enterprise Search, Observability, and Security. Whether');
    expect(text).toContain('your Elastic Stack or Elastic Cloud implementation');
    expect(text).toContain('Operational, implementation, and deployment services:\n- Installation and configuration\n- Pipeline / ingestion recommendations and patterns\n- Data modeling / mapping\n- Visualizations / dashboards');
    expect(text).toContain('1 onsite visit every 4 Consulting Days');
    expect(text).toContain('NOT INCLUDED IN SCOPE\nRecommendations, handling or administration of third-party software, software data, or systems');
  });

  it('uses the scenario values: picked courses become bullets, lists in a sentence read as words', () => {
    const line = { serviceId: training.id, quantity: 5, values: { courses: ['Data Analysis with Kibana', 'Elastic Security for SIEM'], audience: ['Analysts'] } };
    const text = fillDescription(training, line, { quantity: 5, unit: 'seat' });
    expect(text).toContain('Recommended Courses:\n- Data Analysis with Kibana\n- Elastic Security for SIEM');
    expect(text).not.toContain('Elasticsearch Engineer');
    expect(text).toContain('insights for Analysts through training');
    expect(fillDescription(training, { ...line, values: { courses: [] } }, { quantity: 5, unit: 'seat' })).toMatch(/Recommended Courses:$/);
  });

  it('fills the built-in fields and leaves unknown ones as typed', () => {
    const item = { ...pse, description: '{quantity} {unit} for {customer} on {deployment}; {nope}', fields: [] };
    expect(fillDescription(item, { serviceId: item.id, quantity: 8 }, { quantity: 8, unit: 'day', customer: 'Acme', deployment: 'Elastic Cloud' })).toBe('8 days for Acme on Elastic Cloud; {nope}');
  });

  it('joins words the way the template writes them', () => {
    expect([joinWords(['A']), joinWords(['A', 'B']), joinWords(['A', 'B', 'C'])]).toEqual(['A', 'A and B', 'A, B, and C']);
  });

  it('merges the retired Professional Training Subscription into On-Demand Training Subscription', () => {
    const old = [{ ...training, description: '', title: undefined, fields: undefined } as unknown as ServiceItem, { ...training, id: 'professional-training-subscription', name: 'Professional Training Subscription' }];
    const up = upgradeCatalog(old);
    expect(up.map((x) => x.id)).toEqual(['on-demand-training']);
    expect(up[0]!.fields?.map((f) => f.key)).toEqual(['audience', 'courses']);
    expect(upgradeServices({ lines: [{ serviceId: 'professional-training-subscription', quantity: 3 }] })!.lines[0]!.serviceId).toBe('on-demand-training');
  });

  it('keeps a catalog entry the user already wrote', () => {
    const mine = { ...training, description: 'My wording', fields: [] };
    expect(upgradeCatalog([mine])[0]!.description).toBe('My wording');
  });

  it('puts services after the scenarios in the ROM, and names a description per scenario when they differ', () => {
    const st = defaultState();
    const mk = (title: string, courses: string[]) => ({ kind: 'self_managed' as const, title, services: priceLines(SEED_CATALOG, { lines: [{ serviceId: training.id, quantity: 5, values: { courses } }] }), workloads: st.forward.workloads, result: forward(st.forward, c) });
    const html = romHtml({ customer: 'Acme', date: '2026-09-29', termStart: '2026-10-01', team: [], scenarios: [mk('A', ['Elasticsearch Engineer']), mk('B', ['Data Analysis with Kibana'])] });
    const at = (x: string) => html.indexOf(x);
    expect(at('LICENSING OVERVIEW')).toBeLessThan(at('<h2 class="scenario">A</h2>'));
    expect(at('<h2 class="scenario">B</h2>')).toBeLessThan(at('<h2>SERVICES</h2>'));
    expect(at('<h2>SERVICES</h2>')).toBeLessThan(at('<h2>SERVICE DESCRIPTIONS</h2>'));
    expect(html).toContain('Training Recommendations (A)');
    expect(html).toContain('Training Recommendations (B)');
    const same = romHtml({ customer: 'Acme', date: '2026-09-29', termStart: '2026-10-01', team: [], scenarios: [mk('A', ['Elasticsearch Engineer']), mk('B', ['Elasticsearch Engineer'])] });
    expect(same).toContain('<h3 class="svc">Training Recommendations</h3>');
    expect(same).not.toContain('Training Recommendations (A)');
  });
});
