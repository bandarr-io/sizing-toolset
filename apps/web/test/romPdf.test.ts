import { defaultConstants as c } from '@sizing/constants';
import { forward } from '@sizing/engine';
import { describe, expect, it } from 'vitest';
import { CAVEATS, romHtml, type RomInput } from '../src/rom/rom.ts';
import { CAVEAT_RUNS, romPdfDefinition } from '../src/rom/romPdf.ts';
import { priceLines, type ServiceItem } from '../src/services.ts';
import { defaultState } from '../src/state.ts';
import { renderPdf } from './helpers/renderPdf.ts';

const plain = (html: string) => html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const catalog: ServiceItem[] = [{ id: 'flex', name: 'Flex Consulting', mpn: 'SV-FLEX', unit: 'hour', unitPrice: 300, billing: 'one_time', description: 'Hands-on help.', dated: false }];

function input(): RomInput {
  const state = defaultState();
  return {
    customer: 'Acme', date: '2026-09-29', termStart: '2026-10-01',
    team: [{ name: 'Pat Lee', role: 'Solution Architect', email: 'pat@example.com' }],
    scenarios: [{ kind: 'self_managed', title: 'Main', notes: 'Pilot first', services: priceLines(catalog, { lines: [{ serviceId: 'flex', quantity: 40 }] }), workloads: state.forward.workloads, result: forward(state.forward, c) }],
  };
}

describe('D47 ROM as PDF', () => {
  it('uses the caveats word for word', () => {
    const pdfText = CAVEAT_RUNS.map((runs) => runs.map((r) => r.text).join('')).join(' ');
    expect(pdfText).toBe(plain(CAVEATS));
  });

  it('has the same sections as the print version', () => {
    const def = JSON.stringify(romPdfDefinition(input()).content);
    for (const h of ['CAVEATS & CONSIDERATIONS', 'TEAM INFORMATION', 'LICENSING OVERVIEW', 'SERVICE DESCRIPTIONS', 'SCOPE', 'ASSUMPTIONS', 'Snapshot Considerations', 'ELASTIC CLUSTER CONFIGURATION - Main', 'Services: Main', 'NOTE: Pilot first', '10/01/2026', '09/30/2027']) expect(def).toContain(h);
    expect(romHtml(input())).toContain('ELASTIC CLUSTER CONFIGURATION - Main');
  });

  it('renders a Letter PDF with the Inter fonts', async () => {
    const buf = await renderPdf(romPdfDefinition(input()));
    const text = buf.toString('latin1');
    expect(text.startsWith('%PDF-')).toBe(true);
    expect(text).toMatch(/\/MediaBox \[0 0 612 792\]/);
    expect(text).toMatch(/Inter/);
    expect((text.match(/\/Type \/Page\b/g) ?? []).length).toBeGreaterThanOrEqual(6);
  }, 20_000);
});
