import type { Content, ContentText, TableCell, TDocumentDefinitions } from 'pdfmake/interfaces';
import { fmtMoney, fmtNum } from '../format.ts';
import { BRAND } from './brand.ts';
import {
  ASSUMPTIONS_INTRO, dataLines, echConfig, hasServices, serviceDescriptionList, RETENTION_INTRO, scenarioEcu, scenarioServices, SCOPE_ECH, SCOPE_SELF_MANAGED,
  selfManagedConfig, SNAPSHOTS, defaultSummary, SUMMARY_HEAD, SUMMARY_NOTES, summaryRows, termEnd, TIER_ROW, totalDays, usDate, volumeParts, type ConfigTable, type RomInput, type RomScenario,
} from './rom.ts';

/**
 * D47: the Budgetary ROM as a PDF file, laid out like the print version (romHtml) but built directly with pdfmake,
 * so the button downloads a file instead of opening the print dialog. Wording and numbers come from rom.ts; only
 * the layout lives here. Pure: fonts are registered by the caller (romPdfDownload.ts in the browser, tests in Node).
 */

const BLUE = BRAND.blue;
const DARK = '#1d2330';
const TEXT = '#2b2f38';
const HEAD = '#3a3f4a';
const SUB = '#4a4f5a';
const WHITE = '#ffffff';
const PT = 72; // points per inch

/** Font names the definition uses; the caller maps them to files. */
export const PDF_FONTS = {
  Inter: { normal: 'Inter-400.woff', bold: 'Inter-700.woff', italics: 'Inter-400i.woff', bolditalics: 'Inter-700i.woff' },
  InterHeavy: { normal: 'Inter-800.woff', bold: 'Inter-800.woff', italics: 'Inter-800i.woff', bolditalics: 'Inter-800i.woff' },
};

type Run = { text: string; bold?: boolean; italics?: boolean; decoration?: 'underline'; color?: string };

/** CAVEATS from rom.ts as styled runs. `test/romPdf.test.ts` checks the words match the HTML exactly. */
export const CAVEAT_RUNS: Run[][] = [
  [{ text: 'The recommendations provided ' }, { text: 'serve as a starting point', bold: true, italics: true, decoration: 'underline' }, { text: ', subject to adjustments based on actual system configurations and evolving business needs. They offer guidance for optimal configurations but should be adapted as necessary.' }],
  [{ text: 'Sizing parameters are dynamic and may vary due to hardware/software factors.', bold: true, italics: true }, { text: ' Regular reassessment is crucial to ensure alignment with changing requirements.' }],
  [{ text: 'Recommendations should be tailored to meet specific business objectives. Engaging with account representatives ensures solutions are aligned with organizational goals. Stakeholders are encouraged to seek clarification from representatives for a deeper understanding of recommendations and informed decision-making.' }],
  [{ text: 'Monitoring and adjusting sizing parameters over time are essential for sustained efficiency and resource optimization.' }],
  [{ text: 'It\'s important to note that sizings ', bold: true, italics: true }, { text: 'should not', bold: true, italics: true, decoration: 'underline', color: BLUE }, { text: ' be considered facts and will require an adjustment period and staged implementation plan to achieve optimal results.', bold: true, italics: true }],
  [{ text: 'In summary, while the recommendations offer valuable initial guidance, stakeholders should remain adaptable, align solutions with business goals, consult representatives for clarity, and continuously adapt sizing strategies to changing needs.' }],
];

const h2 = (text: string, extra: Partial<ContentText> = {}): ContentText => ({ text, font: 'InterHeavy', fontSize: 22, color: HEAD, margin: [0, 0, 0, 14], ...extra });
const h3 = (text: string): ContentText => ({ text, bold: true, fontSize: 11, color: SUB, margin: [0, 18, 0, 7], headlineLevel: 1 });
const h4 = (text: string): ContentText => ({ text, bold: true, fontSize: 11, color: SUB, margin: [0, 13, 0, 4], headlineLevel: 1 });
const p = (text: string | Run[] | ContentText['text']): ContentText => ({ text, margin: [0, 0, 0, 7] });

function cover(input: RomInput): Content[] {
  const kinds = [...new Set(input.scenarios.map((s) => (s.kind === 'ech' ? 'Elastic Cloud Hosted' : 'Self-Managed')))];
  const article = /^[AEIOU]/i.test(kinds[0] ?? '') ? 'an' : 'a';
  const dashed = { dash: { length: 4, space: 3 } };
  const logo: Content = BRAND.logoSvg
    ? { svg: BRAND.logoSvg, width: 3.4 * PT }
    : {
      table: { body: [[{ text: '[Elastic logo]', bold: true, color: WHITE, margin: [22, 20, 22, 20] }]] },
      layout: { hLineColor: () => WHITE, vLineColor: () => WHITE, hLineWidth: () => 1.5, vLineWidth: () => 1.5, hLineStyle: () => dashed, vLineStyle: () => dashed },
    };
  return [
    { stack: [logo], margin: [0.5 * PT, 0.05 * PT, 0, 1.05 * PT] },
    {
      margin: [0.5 * PT, 0, 0, 0],
      stack: [
        { text: input.customer || '[CUSTOMER NAME]', font: 'InterHeavy', fontSize: 34, lineHeight: 1.05, color: WHITE, margin: [0, 0, 0, 14] },
        { text: 'BUDGETARY ROM', bold: true, fontSize: 15, color: WHITE, margin: [0, 0, 0, 13] },
        { columns: [{ width: 6.2 * PT, text: `This document provides a budgetary Rough Order of Magnitude (ROM) estimate for ${article} ${kinds.join(' and ')} deployment. It includes projected pricing, resource sizing, and service descriptions to support early-stage planning and internal discussions.`, fontSize: 12, lineHeight: 1.45, color: WHITE }, { width: '*', text: '' }] },
      ],
    },
    { text: 'elastic.co', bold: true, color: WHITE, absolutePosition: { x: 1 * PT, y: 7.05 * PT } },
    ...(BRAND.coverArtSvg ? [{ svg: BRAND.coverArtSvg, width: 6.4 * PT, absolutePosition: { x: 2.2 * PT, y: 5.9 * PT } } as Content] : []),
  ];
}

function contents(input: RomInput): Content[] {
  const rows: TableCell[][] = [['EXECUTIVE SUMMARY', true, 0], ['CAVEATS & CONSIDERATIONS', true, 0], ...(input.team.length ? [['TEAM INFORMATION', true, 0] as const] : []), ['LICENSING OVERVIEW', true, 0],
    ...(hasServices(input) ? [['SERVICES', true, 0] as const] : []),
    ...input.scenarios.flatMap((s) => [[s.title, true, 0] as const, ...['SCOPE', 'ASSUMPTIONS', 'Data Volume and Retention', 'Data Retention Breakdown', `ELASTIC CLUSTER CONFIGURATION - ${s.title}`].map((t) => [t, false, 1] as const)]),
    ...(serviceDescriptionList(input).length ? [['SERVICE DESCRIPTIONS', true, 0] as const] : []),
  ].map(([text, bold, level]) => [{ text: String(text), bold: !!bold, margin: [Number(level) * 0.3 * PT, 0, 0, 0] }]);
  return [
    { text: input.customer || '[CUSTOMER NAME]', color: BLUE, fontSize: 17, bold: true, pageBreak: 'before', margin: [0, 7, 0, 0] },
    { text: 'Elastic Sizing Estimation', font: 'InterHeavy', fontSize: 38, lineHeight: 1.05, color: DARK, margin: [0, 36, 0, 30] },
    {
      fontSize: 10, lineHeight: 1.2,
      table: { widths: ['*'], body: rows },
      layout: {
        hLineWidth: (i) => (i === 0 ? 0 : 0.75), vLineWidth: () => 0, hLineColor: () => '#9aa3b2',
        hLineStyle: () => ({ dash: { length: 1, space: 2 } }), paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 2, paddingBottom: () => 1,
      },
    },
  ];
}

/** D51: the opening, one line per scenario, and the notes that frame the figures. */
function executiveSummary(input: RomInput): Content[] {
  const opening = (input.summary?.trim() || defaultSummary(input)).split(/\n\s*\n/).map((x) => p(x.trim()));
  const cell = { margin: [0, 3, 0, 3] as [number, number, number, number] };
  return [
    h2('EXECUTIVE SUMMARY', { pageBreak: 'before' }),
    ...opening,
    {
      table: {
        widths: ['*', 62, 78, 110, 62, 62], headerRows: 1, dontBreakRows: true,
        body: [
          SUMMARY_HEAD.map((h) => ({ text: h, bold: true, color: WHITE, fillColor: BLUE, margin: [0, 5, 0, 5] })),
          ...summaryRows(input).map((r, i): TableCell[] => {
            const fill = r.recommended ? '#e6f0fc' : i % 2 ? '#f5f7fa' : undefined;
            const first: TableCell = { stack: [{ text: r.scenario, bold: true }, ...(r.recommended ? [{ text: 'RECOMMENDED', color: BLUE, fontSize: 7.5, bold: true, characterSpacing: 0.4 }] : [])], ...cell, fillColor: fill };
            return [first, ...[r.deployment, r.data, r.cluster, r.license].map((t) => ({ text: t, ...cell, fillColor: fill })), { text: r.year1, bold: true, color: BLUE, ...cell, fillColor: fill }];
          }),
        ],
      },
      layout: { hLineWidth: () => 0, vLineWidth: () => 0, paddingLeft: () => 5, paddingRight: () => 5 },
      fontSize: 9.5, margin: [0, 9, 0, 16],
    },
    { ul: SUMMARY_NOTES(input), margin: [0, 0, 0, 7] },
  ];
}

function caveatsAndTeam(input: RomInput): Content[] {
  const team = input.team.filter((m) => m.name.trim());
  return [
    h2('CAVEATS & CONSIDERATIONS', { pageBreak: 'before' }),
    ...CAVEAT_RUNS.map((runs): Content => ({ text: runs, lineHeight: 1.45, margin: [0, 0, 0, 10] })),
    ...(team.length ? [
      h2('TEAM INFORMATION', { margin: [0, 32, 0, 14] }),
      { columnGap: 0.5 * PT, columns: team.map((m) => ({ width: 'auto', stack: [{ text: m.name, color: BLUE, bold: true, fontSize: 12 }, m.role, m.email] })) } as Content,
    ] : []),
  ];
}

const LIC_WIDTHS = [42, 64, '*', 56, 56, 50, 60, 64];
const LIC_HEAD = ['Annual', 'MPN', 'Description', 'Start Date', 'End Date', 'Quantity', 'List Unit Price', 'Total'];
const licLayout = { hLineColor: () => DARK, vLineColor: () => DARK, hLineWidth: () => 0.75, vLineWidth: () => 0.75, paddingTop: () => 4, paddingBottom: () => 4 };

function licTable(caption: ContentText['text'], head: string[], rows: TableCell[][]): Content {
  return {
    table: {
      widths: LIC_WIDTHS, headerRows: 2, dontBreakRows: true,
      body: [
        [{ text: caption, colSpan: 8, fillColor: BLUE, color: WHITE, fontSize: 11, alignment: 'center' }, ...Array.from({ length: 7 }, () => ({}))],
        head.map((h) => ({ text: h, bold: true })),
        ...rows,
      ],
    },
    layout: licLayout, fontSize: 9.5, alignment: 'center', margin: [0, 9, 0, 22], unbreakable: true,
  };
}

function captionFor(label: string, s: RomScenario): ContentText['text'] {
  const v = volumeParts(s);
  return v ? [`${label}: ${v.volume} `, { text: v.retention, bold: true }] : `${label}: ${s.title}`;
}

function licensing(input: RomInput): Content[] {
  const start = usDate(input.termStart);
  const end = usDate(termEnd(input.termStart));
  const date = (x: string) => ({ text: x, color: BLUE });
  const tables = input.scenarios.map((s): Content => {
    if (s.kind === 'ech') {
      const ecu = scenarioEcu(s);
      return licTable(captionFor('Enterprise Cloud Credits', s), LIC_HEAD, [['Yr. 1', 'ESSCLOUD', 'ESS-ANNUAL-PREPAID', date(start), date(end), fmtNum(ecu, 0), '1.00', fmtMoney(ecu)]]);
    }
    const eru = s.result.licenseUnits.value;
    const price = s.eruPrice !== undefined ? fmtMoney(s.eruPrice) : '[PRICE]';
    return licTable(captionFor('Enterprise Subscription', s), LIC_HEAD, [['Yr. 1', '[MPN]', 'Enterprise Resource Units (ERU)', date(start), date(end), fmtNum(eru, 0), price, s.eruPrice !== undefined ? fmtMoney(eru * s.eruPrice) : '[PRICE]']]);
  });
  return [h2('LICENSING OVERVIEW', { pageBreak: 'before' }), ...tables];
}

/** D50: services are priced up front, right after the licensing tables: one table per scenario that has any. */
function servicesSection(input: RomInput): Content[] {
  if (!hasServices(input)) return [];
  const start = usDate(input.termStart);
  const end = usDate(termEnd(input.termStart));
  const date = (x: string) => ({ text: x, color: BLUE });
  const tables = input.scenarios.flatMap((s): Content[] => {
    const services = scenarioServices(s);
    return services.length === 0 ? [] : [licTable(`Services: ${s.title}`, ['Term', ...LIC_HEAD.slice(1)], services.map((x) => [
      x.item.billing === 'annual' ? 'Yr. 1' : 'One-time', x.item.mpn || '[MPN]', x.item.name, date(x.item.dated ? start : ''), date(x.item.dated ? end : ''),
      fmtNum(x.line.quantity, 2), x.unitPrice !== undefined ? fmtMoney(x.unitPrice, 2) : '[PRICE]', x.total !== undefined ? fmtMoney(x.total) : '[PRICE]',
    ]))];
  });
  // The heading stays on the page with the first table.
  return [{ unbreakable: true, stack: [h2('SERVICES', { margin: [0, 14, 0, 14] }), tables[0]!] }, ...tables.slice(1)];
}

function serviceDescriptions(input: RomInput): Content[] {
  const items = serviceDescriptionList(input);
  if (items.length === 0) return [];
  return [h2('SERVICE DESCRIPTIONS', { pageBreak: 'before' }), ...items.map((x): Content => ({
    stack: [{ ...h3(x.title), fontSize: 13, color: HEAD }, ...x.blocks.map((b): Content => (b.kind === 'heading'
      ? { text: b.text, bold: true, fontSize: 9.5, characterSpacing: 0.4, color: BLUE, margin: [0, 9, 0, 3], headlineLevel: 1 }
      : b.kind === 'list' ? { ul: b.items, margin: [0, 0, 0, 7] } : p(b.text)))],
  }))];
}

function configTable(t: ConfigTable): Content {
  const cols = t.head.length;
  const cell = { alignment: 'center' as const, margin: [0, 3, 0, 3] as [number, number, number, number] };
  const foot = (label: string, value: string): TableCell[] => [
    { text: label, bold: true, colSpan: t.labelSpan, fillColor: '#eeeeee', margin: [4, 3, 0, 3] }, ...Array.from({ length: t.labelSpan - 1 }, () => ({})),
    { text: value, bold: true, color: BLUE, colSpan: cols - t.labelSpan, fillColor: '#eeeeee', margin: [0, 3, 0, 3] }, ...Array.from({ length: cols - t.labelSpan - 1 }, () => ({})),
  ];
  return {
    table: {
      // Elastic Cloud's instance names are long, so that column gets the room.
      widths: t.head.length === 5 ? [62, 62, 62, '*', 150] : t.head.map(() => '*'), headerRows: 1,
      body: [
        t.head.map((h) => ({ text: h, bold: true, color: WHITE, fillColor: BLUE, ...cell, margin: [0, 5, 0, 5] })),
        ...t.rows.map((r) => [{ text: r.tier, bold: true, ...cell }, ...r.cells.map((c, i): TableCell => (c === undefined
          ? { text: '', fillColor: BLUE }
          : { text: r.blobTb && i === 2 ? [c, ', ', { text: 'Blob Storage:', bold: true }, ` ${r.blobTb}`] : c, ...cell }))]),
        foot('Total Calculated RAM', t.ram),
        foot('Total Calculated Storage', t.storage),
      ],
    },
    layout: { hLineWidth: (i, node) => (i >= node.table.body.length - 1 && i < node.table.body.length ? 1 : 0), hLineColor: () => WHITE, vLineWidth: () => 0 },
    fontSize: 9.5, margin: [0, 9, 0, 22],
  };
}

function scenarioPage(s: RomScenario): Content[] {
  const lines = dataLines(s);
  const accent = (x: string): Run => ({ text: x, color: BLUE });
  const volume = lines.map((d) => ({
    text: [
      ...(lines.length > 1 ? [{ text: `${d.name}: ` }] : []),
      ...(d.gbPerDay !== undefined ? [accent(fmtNum(d.gbPerDay, 0)), { text: ' GB Daily Ingestion (Raw)' }] : [{ text: d.volume ?? '' }]),
      ...(d.tiers ? [{ text: '; ' }, accent(fmtNum(totalDays(d.tiers), 0)), { text: ' Days' }] : []),
    ],
  }));
  const withTiers = lines.filter((d) => d.tiers);
  const breakdown: Content[] = withTiers.flatMap((d) => [
    ...(lines.length > 1 ? [{ text: d.name, bold: true, margin: [0, 6, 0, 1] } as Content] : []),
    { ul: (['hot', 'warm', 'cold', 'frozen'] as const).map((t) => `${TIER_ROW[t]} Tier: ${fmtNum(d.tiers![t] ?? 0, 0)} Days`), bold: true, margin: [0, 3, 0, 7] } as Content,
  ]);

  const configHead = h3(`ELASTIC CLUSTER CONFIGURATION - ${s.title}`);
  let config: Content[];
  if (s.kind === 'ech') {
    config = s.outcomes.map((o, i): Content => {
      const intro: Content[] = i === 0 ? [configHead] : [];
      if ('error' in o) return { unbreakable: true, stack: [...intro, p([{ text: `${o.item.name}:`, bold: true }, ` could not be priced: ${o.error}`])] };
      return {
        unbreakable: true,
        stack: [
          ...intro,
          ...(s.outcomes.length > 1 ? [h4(o.item.name)] : []),
          p(['Based on the information and assumptions above, we have estimated the cost of your deployment to be ', { text: fmtNum(o.result.totalRounded, 0), bold: true }, ' ECUs, and configured as follows:']),
          configTable(echConfig(o.result.lines)),
        ],
      };
    });
  } else {
    config = [{
      unbreakable: true,
      stack: [configHead, p(['Based on the information and assumptions above, we have estimated your deployment to need ', { text: fmtNum(s.result.licenseUnits.value, 0), bold: true }, ' Enterprise Resource Units (ERU), configured as follows:']), configTable(selfManagedConfig(s.result))],
    }];
  }

  return [
    h2(s.title, { fontSize: 20, pageBreak: 'before' }),
    h3('SCOPE'), p(s.kind === 'ech' ? SCOPE_ECH : SCOPE_SELF_MANAGED),
    h3('ASSUMPTIONS'), p(ASSUMPTIONS_INTRO),
    h4('Data Volume and Retention'), { ul: volume, bold: true, margin: [0, 3, 0, 7] },
    ...(breakdown.length ? [h4('Data Retention Breakdown'), p(RETENTION_INTRO), ...breakdown] : []),
    ...(s.notes?.trim() ? [{ text: `NOTE: ${s.notes.trim()}`, color: BLUE, italics: true, margin: [0, 0, 0, 7] } as Content] : []),
    h4('Snapshot Considerations'), p(SNAPSHOTS),
    ...config,
  ];
}

export function romPdfDefinition(input: RomInput): TDocumentDefinitions {
  const date = `DATE: ${usDate(input.date)}`;
  return {
    info: { title: `Sizing Summary - ${input.customer || 'Customer'} - ${input.date.slice(0, 10)}`, author: 'Elastic', subject: 'Budgetary ROM' },
    pageSize: 'LETTER',
    pageMargins: [0.5 * PT, 1 * PT, 0.5 * PT, 0.6 * PT],
    defaultStyle: { font: 'Inter', fontSize: 10.5, color: TEXT, lineHeight: 1.3 },
    background: (page, size) => (page === 1 ? { canvas: [{ type: 'rect', x: 0, y: 0, w: size.width, h: size.height, color: BLUE }] } : null),
    header: (page) => (page === 1 ? null : {
      columns: [{ text: 'ELASTIC BUDGETARY ROM' }, { text: date, alignment: 'right' }],
      margin: [0.5 * PT, 0.47 * PT, 0.5 * PT, 0], fontSize: 7.5, bold: true, color: DARK,
    }),
    // Keep a heading with what follows it.
    pageBreakBefore: (node, following) => node.headlineLevel === 1 && following.getFollowingNodesOnPage().length === 0,
    content: [...cover(input), ...contents(input), ...executiveSummary(input), ...caveatsAndTeam(input), ...licensing(input), ...servicesSection(input), ...input.scenarios.flatMap(scenarioPage), ...serviceDescriptions(input)],
  };
}
