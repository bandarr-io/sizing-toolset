import { defaultConstants as c } from '@sizing/constants';
import { forward } from '@sizing/engine';
import { describe, expect, it } from 'vitest';
import { costReport } from '../src/cost.ts';
import { customerSummaryHtml } from '../src/customerSummary.ts';
import { toMarkdown } from '../src/export.ts';
import { romHtml } from '../src/rom/rom.ts';
import { newServiceId, parseCatalog, priceLines, SEED_CATALOG, servicesForYear, type ServiceItem, type ServiceLine } from '../src/services.ts';
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
    expect(html).toContain('<h2>SERVICE DESCRIPTIONS</h2><div class="keep"><h3>Flex Consulting</h3><p>Hands-on help.</p><p>Billed by the hour.</p></div></section>');
    expect(html).toContain('<li class="main">SERVICE DESCRIPTIONS</li>');
  });

  it('leaves the services parts out of the ROM when the scenario has none', () => {
    const state = defaultState();
    const html = romHtml({ customer: 'Acme', date: '2026-09-29', termStart: '2026-10-01', team: [], scenarios: [{ kind: 'self_managed', title: 'Main', workloads: state.forward.workloads, result: forward(state.forward, c) }] });
    expect(html).not.toMatch(/Services:|SERVICE DESCRIPTIONS/);
  });
});
