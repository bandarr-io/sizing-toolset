import type { EchData, EchLine, SizingResult, Tier, WorkloadProfile } from '@sizing/engine';
import { escapeHtml } from '../customerSummary.ts';
import { useCaseLabel, type EchItem, type EchOutcome, type EchState } from '../ech/state.ts';
import { fmtMoney, fmtNum } from '../format.ts';
import { fillDescription, parseDescription, type DescriptionBlock, type PricedServiceLine, type ServiceItem } from '../services.ts';
import { byRoleOrder } from '../ui/tiers.ts';
import { BRAND } from './brand.ts';

/**
 * Budgetary ROM (rough order of magnitude): the branded customer deliverable, built from one or more scenarios.
 * Mirrors the Elastic "Budgetary ROM" template: cover, contents, caveats and considerations (verbatim), team,
 * licensing overview, then per scenario its scope, assumptions, retention breakdown, snapshot considerations and
 * cluster configuration. A self-contained, print-ready HTML document (Letter pages); the browser saves it as PDF.
 */

export interface RomTeamMember { name: string; role: string; email: string }

/** D46: `services` are the scenario's priced service lines. D52: `recommended` marks the scenario the SA recommends. */
export type RomScenario =
  | { kind: 'ech'; title: string; notes?: string; recommended?: boolean; services?: readonly PricedServiceLine[]; ech: EchState; data: EchData; outcomes: readonly EchOutcome[] }
  | { kind: 'self_managed'; title: string; notes?: string; recommended?: boolean; services?: readonly PricedServiceLine[]; workloads: readonly WorkloadProfile[]; result: SizingResult; eruPrice?: number };

export interface RomInput {
  customer: string;
  /** ISO date the document is dated. */
  date: string;
  /** ISO start of the subscription term; the end is one year later, less a day. */
  termStart: string;
  team: RomTeamMember[];
  scenarios: RomScenario[];
  /** The executive summary's opening, written by the SA; a standard sentence when blank (D51). */
  summary?: string;
}

const e = escapeHtml;
export const usDate = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split('-'); return `${m}/${d}/${y}`; };
export function termEnd(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
export const tb = (gb: number) => `${fmtNum(gb / 1000, 2)} TB`;
export const gbText = (gb: number) => `${fmtNum(gb, gb < 10 ? 1 : 0)} GB`;

// ---- Fixed wording from the template ----------------------------------------------------------------

export const CAVEATS = `
<p>The recommendations provided <strong><em><u>serve as a starting point</u></em></strong>, subject to adjustments based on actual system configurations and evolving business needs. They offer guidance for optimal configurations but should be adapted as necessary.</p>
<p><strong><em>Sizing parameters are dynamic and may vary due to hardware/software factors.</em></strong> Regular reassessment is crucial to ensure alignment with changing requirements.</p>
<p>Recommendations should be tailored to meet specific business objectives. Engaging with account representatives ensures solutions are aligned with organizational goals. Stakeholders are encouraged to seek clarification from representatives for a deeper understanding of recommendations and informed decision-making.</p>
<p>Monitoring and adjusting sizing parameters over time are essential for sustained efficiency and resource optimization.</p>
<p><strong><em>It's important to note that sizings <u class="accent">should not</u> be considered facts and will require an adjustment period and staged implementation plan to achieve optimal results.</em></strong></p>
<p>In summary, while the recommendations offer valuable initial guidance, stakeholders should remain adaptable, align solutions with business goals, consult representatives for clarity, and continuously adapt sizing strategies to changing needs.</p>`;

export const SCOPE_ECH = `This sizing estimate is for an ECH-Commercial Cloud deployment based upon a subscription for pre-paid Committed Enterprise Cloud Units (ECU). ECUs are based upon the amount of projected RAM, Data Transfer, and Storage to be consumed for the term. The cost of the underlying environment, virtual machines and supporting back-end network, is included in the ECU subscription costs. It is also inclusive of Elastic support for customers and the platform operational maintenance and ongoing service operations. Please see https://www.elastic.co/cloud/shared-responsibility.`;

// Not in the template: written for self-managed scenarios in the same voice. Review before sending.
export const SCOPE_SELF_MANAGED = `This sizing estimate is for a self-managed deployment of the Elastic Stack on infrastructure you provide and operate, based upon an Enterprise subscription licensed by Enterprise Resource Units (ERU). ERUs are based upon the amount of memory allocated to various components of the deployment. The cost of the underlying servers, storage, network and their operation is not included in the subscription. The subscription includes Elastic support for your deployment.`;

export const ASSUMPTIONS_INTRO = 'The following assumptions have been made about your environment based on the information available at the time of this estimate:';
export const RETENTION_INTRO = 'Generally, Elastic recommends a multi-tier data architecture. This allows for optimization of data storage based on the relative importance of the data as it changes over time, allowing for more cost-effective data management. With this in mind, this sizing estimation recommends the following data tiering strategy for each network:';
export const SNAPSHOTS = 'As a best practice, Elastic recommends routine snapshots of the indices within your cluster. This would require additional object-compatible (e.g., NFS/MinIO/Amazon S3) storage space to snapshot the entirety of your data (this is required if utilizing the Frozen Tier).';

// ---- What each scenario holds ----------------------------------------------------------------------

export type Tiers = Partial<Record<Tier, number>>;
export interface DataLine { name: string; gbPerDay?: number; volume?: string; tiers?: Tiers }

/** SIEM and Endpoint on Elastic Cloud: 1 day hot, 6 days cold, the rest frozen (ECH front ends). */
function securityTiers(totalDays: number): Tiers {
  const total = Math.max(7, totalDays);
  return { hot: 1, warm: 0, cold: 6, frozen: total - 7 };
}

function echData(item: EchItem): DataLine {
  const name = item.name === useCaseLabel(item.useCase) ? item.name : `${item.name} (${useCaseLabel(item.useCase)})`;
  switch (item.useCase) {
    case 'logs': return { name, gbPerDay: item.req.gbPerDay ?? 0, tiers: item.req.retentionDays };
    case 'metrics': return { name, volume: `${fmtNum(item.req.datapointsPerSecond ?? 0, 0)} datapoints per second`, tiers: item.req.retentionDays };
    case 'apm': return { name, volume: `${fmtNum(item.req.tracesPerMinute, 0)} traces per minute`, tiers: item.req.retentionDays };
    case 'siem': return { name, ...(item.req.eventsPerSecond ? { volume: `${fmtNum(item.req.eventsPerSecond, 0)} events per second` } : { gbPerDay: item.req.gbPerDay ?? 0 }), tiers: securityTiers(item.req.totalDays) };
    case 'endpoint': return { name, volume: `${fmtNum(item.req.endpoints ?? 0, 0)} endpoints`, tiers: securityTiers(item.req.totalDays) };
    case 'search': return { name, volume: `${fmtNum(item.req.documents, 0)} documents of about ${fmtNum(item.req.avgDocKb, 1)} KB` };
    case 'vector': return { name, volume: `${fmtNum(item.req.documents * item.req.vectorsPerDoc, 0)} vectors of ${fmtNum(item.req.dims, 0)} dimensions` };
  }
}

function workloadData(w: WorkloadProfile): DataLine {
  const volume = w.rawGbPerDay === undefined
    ? w.totalGb !== undefined ? `${fmtNum(w.totalGb, 0)} GB of documents`
      : w.vector ? `${fmtNum(w.vector.count, 0)} vectors of ${fmtNum(w.vector.dims, 0)} dimensions`
        : w.ml ? `${fmtNum(w.ml.anomalyJobs, 0)} machine learning jobs`
          : w.fleet ? `${fmtNum(w.fleet.agents, 0)} Elastic Agents` : undefined
    : undefined;
  return { name: w.id, ...(w.rawGbPerDay !== undefined ? { gbPerDay: w.rawGbPerDay } : {}), ...(volume ? { volume } : {}), ...(Object.keys(w.retentionDays).length ? { tiers: w.retentionDays } : {}) };
}

export function dataLines(s: RomScenario): DataLine[] {
  return s.kind === 'ech' ? s.ech.items.map(echData) : s.workloads.map(workloadData);
}

export const totalDays = (t: Tiers | undefined) => (['hot', 'warm', 'cold', 'frozen'] as Tier[]).reduce((sum, k) => sum + (t?.[k] ?? 0), 0);

/** The heading the template puts on a licensing table: "106GB / Day (365 Days Retention)". */
export function volumeParts(s: RomScenario): { volume: string; retention: string } | undefined {
  const lines = dataLines(s).filter((d) => d.gbPerDay !== undefined);
  if (lines.length === 0) return undefined;
  const gb = lines.reduce((sum, d) => sum + (d.gbPerDay ?? 0), 0);
  const days = Math.max(...lines.map((d) => totalDays(d.tiers)));
  return { volume: `${fmtNum(gb, 0)}GB / Day`, retention: `(${fmtNum(days, 0)} Days Retention)` };
}

function volumeHeading(s: RomScenario): string {
  const v = volumeParts(s);
  return v ? `${v.volume} <strong>${v.retention}</strong>` : e(s.title);
}

// ---- Numbers --------------------------------------------------------------------------------------

/** ECUs for an Elastic Cloud scenario: the annual list price in USD, each line rounded up to $1,000 as in the ballpark tool. */
export function scenarioEcu(s: Extract<RomScenario, { kind: 'ech' }>): number {
  return s.outcomes.reduce((sum, o) => sum + ('result' in o ? o.result.totalRounded : 0), 0);
}

export const TIER_ROW: Record<string, string> = { hot: 'Hot', warm: 'Warm', cold: 'Cold', frozen: 'Frozen', master: 'Master', coordinating: 'Coordinating', ml: 'ML', kibana: 'Kibana', apm: 'APM Server', data: 'Data', enterprisesearch: 'Crawlers and connectors' };

/** One row of a cluster configuration table; `storage` undefined prints as a blank (blue) cell on Elastic Cloud. */
export interface ConfigTable {
  head: string[];
  rows: { tier: string; cells: (string | undefined)[]; blobTb?: string }[];
  /** Columns the footer labels span. */
  labelSpan: number;
  ram: string;
  storage: string;
}

export function echConfig(lines: readonly EchLine[]): ConfigTable {
  const rows = lines.filter((l) => l.key !== 'transfer' && l.key !== 'storage');
  const disk = rows.reduce((s, l) => s + (l.diskGb ?? 0), 0);
  const blob = rows.reduce((s, l) => s + (l.blobGb ?? 0), 0);
  const ram = rows.reduce((s, l) => s + (l.ramGb ?? 0), 0);
  return {
    head: ['Tier', 'Availability Zones', 'Total RAM', 'Storage', 'Instance Type'],
    rows: rows.map((l) => ({
      tier: TIER_ROW[l.key] ?? l.label,
      cells: [l.zones === undefined ? '' : String(l.zones), l.error ? 'n/a' : gbText(l.ramGb ?? 0), l.diskGb === undefined ? undefined : tb(l.diskGb), l.sku ?? ''],
      ...(l.diskGb !== undefined && l.blobGb ? { blobTb: tb(l.blobGb) } : {}),
    })),
    labelSpan: 2,
    ram: gbText(ram),
    storage: `${tb(disk)}${blob ? `, Blob: ${tb(blob)}` : ''}`,
  };
}

export function selfManagedConfig(r: SizingResult): ConfigTable {
  const rows = byRoleOrder([
    ...r.tiers.map((t) => ({ role: t.tier as string, n: t.nodes, ram: t.ramGb, disk: t.diskGb })),
    ...r.overhead.filter((o) => o.count > 0).map((o) => ({ role: o.role as string, n: o.count, ram: o.ramGb, disk: o.diskGb })),
  ]);
  const disk = rows.reduce((s, x) => s + x.n * (x.disk ?? 0), 0);
  return {
    head: ['Tier', 'Nodes', 'RAM per node', 'Total RAM', 'Storage per node', 'Total storage'],
    rows: rows.map((x) => ({ tier: TIER_ROW[x.role] ?? x.role, cells: [String(x.n), gbText(x.ram), gbText(x.n * x.ram), x.disk ? tb(x.disk) : '', x.disk ? tb(x.n * x.disk) : ''] })),
    labelSpan: 3,
    ram: gbText(r.totalRamGb),
    storage: `${tb(disk)}${r.objectStorage ? `, Object storage: ${tb(r.objectStorage.gb)}` : ''}`,
  };
}

function configTable(t: ConfigTable): string {
  const cols = t.head.length;
  const body = t.rows.map((r) => `<tr><th scope="row">${e(r.tier)}</th>${r.cells.map((c, i) => (c === undefined ? '<td class="blank"></td>' : `<td>${e(c)}${r.blobTb && i === 2 ? `, <strong>Blob Storage:</strong> ${r.blobTb}` : ''}</td>`)).join('')}</tr>`).join('');
  return `<table class="config"><thead><tr>${t.head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${body}</tbody>
<tfoot><tr><th colspan="${t.labelSpan}">Total Calculated RAM</th><td colspan="${cols - t.labelSpan}" class="accent">${t.ram}</td></tr>
<tr><th colspan="${t.labelSpan}">Total Calculated Storage</th><td colspan="${cols - t.labelSpan}" class="accent">${t.storage}</td></tr></tfoot></table>`;
}

// ---- Pages ----------------------------------------------------------------------------------------


function cover(input: RomInput): string {
  const kinds = [...new Set(input.scenarios.map((s) => (s.kind === 'ech' ? 'Elastic Cloud Hosted' : 'Self-Managed')))];
  return `<section class="cover">
  <div class="logo">${BRAND.logoSvg || '<div class="placeholder">[Elastic logo]</div>'}</div>
  <h1>${e(input.customer || '[CUSTOMER NAME]')}</h1>
  <div class="cover-kicker">BUDGETARY ROM</div>
  <p class="cover-text">This document provides a budgetary Rough Order of Magnitude (ROM) estimate for ${/^[AEIOU]/i.test(kinds[0] ?? '') ? 'an' : 'a'} ${e(kinds.join(' and '))} deployment. It includes projected pricing, resource sizing, and service descriptions to support early-stage planning and internal discussions.</p>
  <div class="cover-site">elastic.co</div>
  ${BRAND.coverArtSvg ? `<div class="cover-art">${BRAND.coverArtSvg}</div>` : ''}
</section>`;
}

function contents(input: RomInput): string {
  const scenarioItems = input.scenarios.map((s) => `<li class="main">${e(s.title)}<ul><li>SCOPE</li><li>ASSUMPTIONS</li><li>Data Volume and Retention</li><li>Data Retention Breakdown</li><li>ELASTIC CLUSTER CONFIGURATION - ${e(s.title)}</li></ul></li>`).join('');
  return `<section class="page">
  <div class="customer">${e(input.customer || '[CUSTOMER NAME]')}</div>
  <h1 class="doc-title">Elastic Sizing Estimation</h1>
  <ul class="toc"><li class="main">EXECUTIVE SUMMARY</li><li class="main">CAVEATS &amp; CONSIDERATIONS</li>${input.team.length ? '<li class="main">TEAM INFORMATION</li>' : ''}<li class="main">LICENSING OVERVIEW</li>${hasServices(input) ? '<li class="main">SERVICES</li>' : ''}${scenarioItems}${serviceDescriptionList(input).length ? '<li class="main">SERVICE DESCRIPTIONS</li>' : ''}</ul>
</section>`;
}

function caveatsAndTeam(input: RomInput): string {
  const team = input.team.filter((m) => m.name.trim());
  return `<section class="page">
  <h2>CAVEATS &amp; CONSIDERATIONS</h2>
  <div class="caveats">${CAVEATS}</div>
  ${team.length ? `<h2 class="team-heading">TEAM INFORMATION</h2><div class="team">${team.map((m) => `<div><div class="who">${e(m.name)}</div><div>${e(m.role)}</div><div>${e(m.email)}</div></div>`).join('')}</div>` : ''}
</section>`;
}

function licensing(input: RomInput): string {
  const start = usDate(input.termStart);
  const end = usDate(termEnd(input.termStart));
  const tables = input.scenarios.map((s) => {
    if (s.kind === 'ech') {
      const ecu = scenarioEcu(s);
      return `<table class="lic"><caption>Enterprise Cloud Credits: ${volumeHeading(s)}</caption>
<thead><tr><th>Annual</th><th>MPN</th><th>Description</th><th>Start Date</th><th>End Date</th><th>Quantity</th><th>List Unit Price</th><th>Total</th></tr></thead>
<tbody><tr><td>Yr. 1</td><td>ESSCLOUD</td><td>ESS-ANNUAL-PREPAID</td><td class="accent">${start}</td><td class="accent">${end}</td><td>${fmtNum(ecu, 0)}</td><td>1.00</td><td>${fmtMoney(ecu)}</td></tr></tbody></table>`;
    }
    const eru = s.result.licenseUnits.value;
    const total = s.eruPrice !== undefined ? fmtMoney(eru * s.eruPrice) : '[PRICE]';
    return `<table class="lic"><caption>Enterprise Subscription: ${volumeHeading(s)}</caption>
<thead><tr><th>Annual</th><th>MPN</th><th>Description</th><th>Start Date</th><th>End Date</th><th>Quantity</th><th>List Unit Price</th><th>Total</th></tr></thead>
<tbody><tr><td>Yr. 1</td><td>[MPN]</td><td>Enterprise Resource Units (ERU)</td><td class="accent">${start}</td><td class="accent">${end}</td><td>${fmtNum(eru, 0)}</td><td>${s.eruPrice !== undefined ? fmtMoney(s.eruPrice) : '[PRICE]'}</td><td>${total}</td></tr></tbody></table>`;
  }).join('');
  return `<section class="page"><h2>LICENSING OVERVIEW</h2>${tables}${servicesSection(input)}</section>`;
}

/** D50: services are priced up front, right after the licensing tables: one table per scenario that has any. */
function servicesSection(input: RomInput): string {
  if (!hasServices(input)) return '';
  const start = usDate(input.termStart);
  const end = usDate(termEnd(input.termStart));
  return `<h2 class="services">SERVICES</h2>${input.scenarios.map((s) => servicesTable(s, start, end)).join('')}`;
}

export const scenarioServices = (s: RomScenario) => (s.services ?? []).filter((p): p is PricedServiceLine & { item: ServiceItem } => !!p.item);

/** D46: the scenario's services, laid out like the licensing tables. Dates only on services marked as dated. */
function servicesTable(s: RomScenario, start: string, end: string): string {
  const rows = scenarioServices(s);
  if (rows.length === 0) return '';
  const body = rows.map((p) => {
    const dated = p.item.dated;
    const total = p.total !== undefined ? fmtMoney(p.total) : '[PRICE]';
    return `<tr><td>${p.item.billing === 'annual' ? 'Yr. 1' : 'One-time'}</td><td>${e(p.item.mpn || '[MPN]')}</td><td>${e(p.item.name)}</td><td class="accent">${dated ? start : ''}</td><td class="accent">${dated ? end : ''}</td><td>${fmtNum(p.line.quantity, 2)}</td><td>${p.unitPrice !== undefined ? fmtMoney(p.unitPrice, 2) : '[PRICE]'}</td><td>${total}</td></tr>`;
  }).join('');
  return `<table class="lic"><caption>Services: ${e(s.title)}</caption>
<thead><tr><th>Term</th><th>MPN</th><th>Description</th><th>Start Date</th><th>End Date</th><th>Quantity</th><th>List Unit Price</th><th>Total</th></tr></thead>
<tbody>${body}</tbody></table>`;
}

// ---- Executive summary (D51) ------------------------------------------------------------------

export const SUMMARY_HEAD = ['Scenario', 'Deployment', 'Data', 'Cluster', 'License', 'Year 1'];

export interface SummaryRow { recommended: boolean; scenario: string; deployment: string; data: string; cluster: string; license: string; year1: string }

/** The standard opening when the SA writes none. */
export function defaultSummary(input: RomInput): string {
  const n = input.scenarios.length;
  return `This document gives a budgetary estimate for ${input.customer || 'the customer'} across ${n === 1 ? 'one scenario' : `${n} scenarios`}. The table below summarizes each; the sections that follow give the licensing, services, sizing and assumptions behind these figures.`;
}

/** One line per scenario: what it holds, how big the cluster is, what it licenses and what year 1 costs. */
export function summaryRows(input: RomInput): SummaryRow[] {
  return input.scenarios.map((s) => {
    const v = volumeParts(s);
    const lines = dataLines(s);
    const data = v ? `${v.volume}, ${v.retention.replace(/[()]/g, '').replace(' Retention', '')}` : lines.map((d) => d.volume ?? d.name).join('; ');
    let ramGb = 0; let diskGb = 0; let objectGb = 0; let license: string; let licenseCost: number | undefined;
    if (s.kind === 'ech') {
      for (const o of s.outcomes) {
        if (!('result' in o)) continue;
        for (const l of o.result.lines) {
          if (l.key === 'transfer' || l.key === 'storage') continue;
          ramGb += l.ramGb ?? 0; diskGb += l.diskGb ?? 0; objectGb += l.blobGb ?? 0;
        }
      }
      const ecu = scenarioEcu(s);
      license = `${fmtNum(ecu, 0)} ECU`;
      licenseCost = ecu;
    } else {
      const t = s.result.tiers.reduce((sum, x) => sum + x.nodes * (x.diskGb ?? 0), 0) + s.result.overhead.reduce((sum, o) => sum + o.count * (o.diskGb ?? 0), 0);
      ramGb = s.result.totalRamGb; diskGb = t; objectGb = s.result.objectStorage?.gb ?? 0;
      license = `${fmtNum(s.result.licenseUnits.value, 0)} ERU`;
      licenseCost = s.eruPrice !== undefined ? s.result.licenseUnits.value * s.eruPrice : undefined;
    }
    const services = scenarioServices(s);
    // What is priced adds up; anything without a price shows as "+ [PRICE]" so the known part still reads.
    const known = (licenseCost ?? 0) + services.reduce((sum, p) => sum + (p.total ?? 0), 0);
    const missing = licenseCost === undefined || services.some((p) => p.total === undefined);
    const year1 = !missing ? fmtMoney(known) : known > 0 ? `${fmtMoney(known)} + [PRICE]` : '[PRICE]';
    return {
      recommended: !!s.recommended,
      scenario: s.title,
      deployment: s.kind === 'ech' ? 'Elastic Cloud Hosted' : 'Self-managed',
      data,
      cluster: `${gbText(ramGb)} RAM, ${tb(diskGb)} storage${objectGb ? `, ${tb(objectGb)} ${s.kind === 'ech' ? 'blob' : 'object'}` : ''}`,
      license,
      year1,
    };
  });
}

export const SUMMARY_NOTES = (input: RomInput) => [
  ...input.scenarios.filter((s) => s.recommended).map((s) => `Recommended: ${s.title}.`),
  `Term: ${usDate(input.termStart)} to ${usDate(termEnd(input.termStart))}.`,
  'Year 1 is the license plus the services billed in year 1, at the prices in this document. Each scenario is priced on its own.',
  'These are budgetary figures, not a quote; see Caveats & Considerations.',
];

function executiveSummary(input: RomInput): string {
  const opening = (input.summary?.trim() || defaultSummary(input)).split(/\n\s*\n/).map((p) => `<p>${e(p.trim())}</p>`).join('');
  const rows = summaryRows(input).map((r) => `<tr${r.recommended ? ' class="recommended"' : ''}><th scope="row">${e(r.scenario)}${r.recommended ? '<div class="tag">RECOMMENDED</div>' : ''}</th><td>${r.deployment}</td><td>${e(r.data)}</td><td>${r.cluster}</td><td>${r.license}</td><td class="accent"><strong>${r.year1}</strong></td></tr>`).join('');
  return `<section class="page"><h2>EXECUTIVE SUMMARY</h2>${opening}
<table class="config summary"><thead><tr>${SUMMARY_HEAD.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>
<ul class="svc">${SUMMARY_NOTES(input).map((n) => `<li>${e(n)}</li>`).join('')}</ul></section>`;
}

export const hasServices = (input: RomInput) => input.scenarios.some((s) => scenarioServices(s).length > 0);

export interface RomServiceDescription { title: string; blocks: DescriptionBlock[] }

/**
 * The service descriptions to print, filled in with each scenario's values (D49), in first-use order. The same
 * service with the same filled-in text prints once; when scenarios fill it differently, each copy is named after
 * its scenario.
 */
export function serviceDescriptionList(input: RomInput): RomServiceDescription[] {
  const found: { id: string; name: string; scenario: string; text: string }[] = [];
  for (const s of input.scenarios) {
    for (const p of scenarioServices(s)) {
      if (!p.item.description.trim()) continue;
      const text = fillDescription(p.item, p.line, { quantity: p.line.quantity, unit: p.item.unit, customer: input.customer, deployment: s.kind === 'ech' ? 'Elastic Cloud' : 'Elastic Stack' });
      if (!found.some((f) => f.id === p.item.id && f.text === text)) found.push({ id: p.item.id, name: p.item.title?.trim() || p.item.name, scenario: s.title, text });
    }
  }
  return found.map((f) => ({
    title: found.filter((g) => g.id === f.id).length > 1 ? `${f.name} (${f.scenario})` : f.name,
    blocks: parseDescription(f.text),
  }));
}

function serviceDescriptions(input: RomInput): string {
  const items = serviceDescriptionList(input);
  if (items.length === 0) return '';
  return `<section class="page"><h2>SERVICE DESCRIPTIONS</h2>${items.map((x) => `<div class="svc"><h3 class="svc">${e(x.title)}</h3>${x.blocks.map((b) => (b.kind === 'heading' ? `<h4 class="svc">${e(b.text)}</h4>` : b.kind === 'list' ? `<ul class="svc">${b.items.map((i) => `<li>${e(i)}</li>`).join('')}</ul>` : `<p>${e(b.text)}</p>`)).join('')}</div>`).join('')}</section>`;
}

function scenarioPage(s: RomScenario): string {
  const lines = dataLines(s);
  const volume = lines.map((d) => `<li>${lines.length > 1 ? `<strong>${e(d.name)}:</strong> ` : ''}${d.gbPerDay !== undefined ? `<span class="accent">${fmtNum(d.gbPerDay, 0)}</span> GB Daily Ingestion (Raw)` : e(d.volume ?? '')}${d.tiers ? `; <span class="accent">${fmtNum(totalDays(d.tiers), 0)}</span> Days` : ''}</li>`).join('');
  const breakdown = lines.filter((d) => d.tiers).map((d) => `${lines.length > 1 ? `<p class="sub">${e(d.name)}</p>` : ''}<ul class="tiers">${(['hot', 'warm', 'cold', 'frozen'] as Tier[]).map((t) => `<li>${TIER_ROW[t]} Tier: ${fmtNum(d.tiers![t] ?? 0, 0)} Days</li>`).join('')}</ul>`).join('');

  let config: string;
  if (s.kind === 'ech') {
    config = s.outcomes.map((o) => {
      if ('error' in o) return `<p><strong>${e(o.item.name)}:</strong> could not be priced: ${e(o.error)}</p>`;
      const ecu = o.result.totalRounded;
      return `${s.outcomes.length > 1 ? `<h4>${e(o.item.name)}</h4>` : ''}<p>Based on the information and assumptions above, we have estimated the cost of your deployment to be <strong>${fmtNum(ecu, 0)}</strong> ECUs, and configured as follows:</p>${configTable(echConfig(o.result.lines))}`;
    }).join('');
  } else {
    config = `<p>Based on the information and assumptions above, we have estimated your deployment to need <strong>${fmtNum(s.result.licenseUnits.value, 0)}</strong> Enterprise Resource Units (ERU), configured as follows:</p>${configTable(selfManagedConfig(s.result))}`;
  }

  return `<section class="page">
  <h2 class="scenario">${e(s.title)}</h2>
  <h3>SCOPE</h3><p>${e(s.kind === 'ech' ? SCOPE_ECH : SCOPE_SELF_MANAGED)}</p>
  <h3>ASSUMPTIONS</h3><p>${ASSUMPTIONS_INTRO}</p>
  <h4>Data Volume and Retention</h4><ul class="volume">${volume}</ul>
  ${breakdown ? `<h4>Data Retention Breakdown</h4><p>${RETENTION_INTRO}</p>${breakdown}` : ''}
  ${s.notes?.trim() ? `<p class="note">NOTE: ${e(s.notes.trim())}</p>` : ''}
  <h4>Snapshot Considerations</h4><p>${SNAPSHOTS}</p>
  <div class="keep"><h3>ELASTIC CLUSTER CONFIGURATION - ${e(s.title)}</h3>
  ${config}</div>
</section>`;
}

const CSS = `
@page { size: letter; margin: 1in 0.5in 0.6in;
  @top-left { content: 'ELASTIC BUDGETARY ROM'; font-family: Inter, 'Helvetica Neue', Arial, sans-serif; font-size: 7.5pt; font-weight: 700; color: #1d2330; vertical-align: top; padding-top: 0.47in; } }
@page :first { margin: 0; @top-left { content: none; } @top-right { content: none; } }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; font-family: ${BRAND.fontStack}; color: #2b2f38; font-size: 10.5pt; line-height: 1.55; background: #ffffff; }
.accent { color: ${BRAND.blue}; }
section.page { break-before: page; }
section.cover { position: relative; z-index: 2; width: 8.5in; height: 11in; overflow: hidden; background: ${BRAND.blue}; color: #ffffff; padding: 1.05in 1in; }
.cover .logo { height: 0.66in; margin-bottom: 1.29in; }
.cover .logo svg, .cover .logo img { height: 100%; width: auto; }
.cover .placeholder { display: inline-flex; align-items: center; justify-content: center; height: 100%; padding: 0 0.4in; border: 2px dashed rgba(255,255,255,0.8); border-radius: 8px; font-weight: 600; }
.cover h1 { font-size: 34pt; line-height: 1.1; margin: 0 0 0.2in; font-weight: 800; }
.cover-kicker { font-size: 15pt; font-weight: 700; margin-bottom: 0.18in; }
.cover-text { font-size: 12pt; line-height: 1.7; max-width: 6.2in; margin: 0; }
.cover-site { position: absolute; left: 1in; top: 7.05in; font-weight: 700; }
.cover-art { position: absolute; left: 2.2in; top: 5.9in; width: 6.4in; }
.cover-art svg { display: block; width: 100%; height: auto; }
.customer { color: ${BRAND.blue}; font-size: 17pt; font-weight: 700; margin-top: 0.1in; }
.doc-title { font-size: 38pt; line-height: 1.1; margin: 0.6in 0 0.6in; font-weight: 800; color: #1d2330; }
.toc { list-style: none; padding: 0; margin: 0; font-size: 10.5pt; }
.toc li.main { font-weight: 700; padding: 3px 0; border-bottom: 1px dotted #9aa3b2; }
.toc ul { list-style: none; padding-left: 0.3in; margin: 2px 0; }
.toc ul li { font-weight: 400; padding: 2px 0; border-bottom: 1px dotted #c4cad4; }
h2 { font-size: 22pt; font-weight: 800; color: #3a3f4a; margin: 0 0 0.2in; }
h2.scenario { font-size: 20pt; }
table.summary th[scope=row] { text-align: left; }
table.summary tr.recommended td, table.summary tr.recommended th { background: #e6f0fc; }
table.summary .tag { color: ${BRAND.blue}; font-size: 7.5pt; font-weight: 800; letter-spacing: 0.05em; margin-top: 2px; }
table.summary td, table.summary tbody th { vertical-align: top; }
h2.team-heading { margin-top: 0.45in; }
h2.services { margin-top: 0.3in; break-after: avoid; }
h3 { font-size: 11pt; font-weight: 700; color: #4a4f5a; margin: 0.25in 0 0.1in; }
h4 { font-size: 11pt; font-weight: 700; color: #4a4f5a; margin: 0.18in 0 0.06in; }
p { margin: 0 0 0.1in; }
.keep { break-inside: avoid; }
h3, h4 { break-after: avoid; }
p.sub { font-weight: 700; margin: 0.08in 0 0.02in; }
.caveats p { margin: 0 0 0.14in; line-height: 1.8; }
u.accent { color: ${BRAND.blue}; }
.team { display: flex; gap: 0.5in; }
.team .who { color: ${BRAND.blue}; font-weight: 700; font-size: 12pt; }
h3.svc { font-size: 13pt; color: #3a3f4a; }
h4.svc { font-size: 9.5pt; letter-spacing: 0.04em; color: ${BRAND.blue}; margin: 0.14in 0 0.04in; }
ul.svc { margin: 0.02in 0 0.1in; }
ul.volume, ul.tiers { font-weight: 700; margin: 0.04in 0 0.1in; }
.note { color: ${BRAND.blue}; font-style: italic; }
table { width: 100%; border-collapse: collapse; margin: 0.12in 0 0.3in; font-size: 9.5pt; break-inside: avoid; }
table.lic caption { background: ${BRAND.blue}; color: #ffffff; padding: 6px; font-size: 11pt; border: 1px solid #1d2330; border-bottom: 0; }
table.lic th, table.lic td { border: 1px solid #1d2330; padding: 6px; text-align: center; vertical-align: top; }
table.config thead th { background: ${BRAND.blue}; color: #ffffff; padding: 8px 6px; font-weight: 700; }
table.config td, table.config tbody th { text-align: center; padding: 7px 6px; }
table.config td.blank { background: ${BRAND.blue}; }
table.config tfoot th { text-align: left; background: #eeeeee; padding: 7px 8px; border-top: 1px solid #ffffff; }
table.config tfoot td { text-align: left; background: #eeeeee; font-weight: 700; border-top: 1px solid #ffffff; }
@media screen { body { background: #d9dde4; } section.page, section.cover { background-clip: padding-box; } section.page { width: 8.5in; min-height: 11in; margin: 0.3in auto; padding: 1in 0.5in 0.6in; background: #ffffff; position: relative; } section.cover { margin: 0.3in auto 0; } }
`;

export function romHtml(input: RomInput): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Sizing Summary - ${e(input.customer || 'Customer')} - ${input.date.slice(0, 10)}</title>
${BRAND.fontLink}
<style>${CSS}
@page { @top-right { content: 'DATE: ${usDate(input.date)}'; font-family: ${BRAND.fontStack.replace(/"/g, "'")}; font-size: 7.5pt; font-weight: 700; color: #1d2330; vertical-align: top; padding-top: 0.47in; } }</style></head>
<body>
${cover(input)}
${contents(input)}
${executiveSummary(input)}
${caveatsAndTeam(input)}
${licensing(input)}
${input.scenarios.map(scenarioPage).join('\n')}
${serviceDescriptions(input)}
</body></html>`;
}
