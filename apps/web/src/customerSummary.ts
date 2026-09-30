import type { EchData, EchLine, SizingResult, Tier, WorkloadProfile } from '@sizing/engine';
import type { CostReport } from './cost.ts';
import { echTotals, placementSummary, useCaseLabel, type EchItem, type EchOutcome, type EchState } from './ech/state.ts';
import { constraintWithTier } from './export.ts';
import { fmtMoney, fmtNum, fmtStorage } from './format.ts';
import { KINDS, type AppState } from './state.ts';
import { byRoleOrder } from './ui/tiers.ts';

/**
 * A one-page summary written for the customer: what they asked for, what they need, what it costs when prices are
 * set, and what the estimate depends on. A self-contained HTML file (inline CSS, no external requests) that prints
 * on one A4 or Letter page. Every piece of text the user typed is escaped.
 */
export type SummaryInput =
  | { kind: 'self_managed'; state: AppState; result: SizingResult; cost?: CostReport | { error: string } }
  | { kind: 'ech'; state: AppState; ech: EchState; data: EchData; outcomes: readonly EchOutcome[] };

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const TIER_WORDS: Record<Tier, string> = {
  hot: 'fast storage', warm: 'standard storage', cold: 'lower-cost storage', frozen: 'low-cost storage that stays searchable', content: 'search storage',
};

const ROLE_WORDS: Record<string, string> = {
  content: 'Search data', hot: 'Newest data (hot)', warm: 'Older data (warm)', cold: 'Older data (cold)', frozen: 'Oldest data (frozen)',
  kibana: 'Kibana (dashboards and user interface)', master: 'Master (keeps the cluster organized)', ml: 'Machine learning',
  coordinating: 'Coordinating (routes searches)', fleet: 'Fleet Server (manages agents)', apm: 'APM Server (receives traces)',
};

/** "kept 90 days: 7 on fast storage, 83 on low-cost storage that stays searchable". */
function retentionWords(r: Partial<Record<Tier, number>>): string {
  const parts = (['hot', 'warm', 'cold', 'frozen'] as Tier[]).filter((t) => (r[t] ?? 0) > 0);
  if (parts.length === 0) return '';
  const total = parts.reduce((s, t) => s + (r[t] ?? 0), 0);
  if (parts.length === 1) return `kept ${fmtNum(total, 1)} days on ${TIER_WORDS[parts[0]!]}`;
  return `kept ${fmtNum(total, 1)} days: ${parts.map((t) => `${fmtNum(r[t]!, 1)} on ${TIER_WORDS[t]}`).join(', ')}`;
}

/** One workload in plain words: "Logs: 500 GB of new data a day, kept 90 days: ...". */
export function describeWorkload(w: WorkloadProfile): string {
  const what: string[] = [];
  if (w.rawGbPerDay !== undefined) what.push(`${fmtNum(w.rawGbPerDay, 1)} GB of new data a day`);
  else if (w.totalGb !== undefined) what.push(`${fmtStorage(w.totalGb)} of documents`);
  if (w.vector) what.push(`${fmtNum(w.vector.count, 0)} vectors of ${fmtNum(w.vector.dims, 0)} dimensions`);
  if (w.ml) what.push(`${fmtNum(w.ml.anomalyJobs, 0)} machine learning jobs`);
  if (w.fleet) what.push(`${fmtNum(w.fleet.agents, 0)} Elastic Agents`);
  const kept = retentionWords(w.retentionDays);
  if (kept) what.push(kept);
  if (w.growthPctPerYear) what.push(`growing ${fmtNum(w.growthPctPerYear, 1)}% a year`);
  const kind = KINDS[w.kind]?.label ?? w.kind;
  const name = w.id === kind ? kind : `${w.id} (${kind})`;
  return `${escapeHtml(name)}: ${escapeHtml(what.join(', ') || 'no volume set')}`;
}

/** One Elastic Cloud use case in plain words. */
export function describeEchItem(item: EchItem): string {
  const label = useCaseLabel(item.useCase);
  const name = item.name === label ? label : `${item.name} (${label})`;
  let what: string;
  switch (item.useCase) {
    case 'logs': what = [`${fmtNum(item.req.gbPerDay ?? 0, 1)} GB of logs a day`, retentionWords(item.req.retentionDays)].filter(Boolean).join(', '); break;
    case 'metrics': what = [`${fmtNum(item.req.datapointsPerSecond ?? 0, 0)} datapoints a second`, retentionWords(item.req.retentionDays)].filter(Boolean).join(', '); break;
    case 'siem': what = `${item.req.eventsPerSecond ? `${fmtNum(item.req.eventsPerSecond, 0)} events a second` : `${fmtNum(item.req.gbPerDay ?? 0, 1)} GB of security data a day`}, searchable for ${fmtNum(item.req.totalDays, 0)} days`; break;
    case 'endpoint': what = `${fmtNum(item.req.endpoints ?? 0, 0)} protected endpoints, data kept ${fmtNum(item.req.totalDays, 0)} days`; break;
    case 'apm': what = [`${fmtNum(item.req.tracesPerMinute, 0)} traces a minute`, retentionWords(item.req.retentionDays)].filter(Boolean).join(', '); break;
    case 'search': what = `${fmtNum(item.req.documents, 0)} documents of about ${fmtNum(item.req.avgDocKb, 1)} KB, ${fmtNum(item.req.peakOpsPerSecond, 0)} operations a second at peak`; break;
    case 'vector': what = `${fmtNum(item.req.documents * item.req.vectorsPerDoc, 0)} vectors of ${fmtNum(item.req.dims, 0)} dimensions`; break;
  }
  return `${escapeHtml(name)}: ${escapeHtml(what)}`;
}

const CSS = `
@page { margin: 12mm; }
* { box-sizing: border-box; }
body { margin: 0; background: #ffffff; color: #1d2330; font: 10pt/1.4 "Helvetica Neue", Helvetica, Arial, sans-serif; }
main { max-width: 180mm; margin: 0 auto; padding: 8mm 0; }
header { border-bottom: 2px solid #1d2330; padding-bottom: 8px; margin-bottom: 14px; }
.kicker { font-size: 9pt; letter-spacing: 0.06em; text-transform: uppercase; color: #4a5263; }
h1 { font-size: 18pt; margin: 2px 0 2px; line-height: 1.2; }
.sub { color: #4a5263; font-size: 10pt; }
h2 { font-size: 11pt; margin: 11px 0 5px; }
ul { margin: 0; padding-left: 18px; }
li { margin: 2px 0; }
.figures { display: flex; gap: 10px; margin: 4px 0 8px; }
.figure { flex: 1; border: 1px solid #d5dbe5; border-radius: 6px; padding: 7px 10px; }
.figure .v { font-size: 15pt; font-weight: 700; }
.figure .l { font-size: 8.5pt; color: #4a5263; }
table { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
th { text-align: left; font-size: 8.5pt; color: #4a5263; font-weight: 600; border-bottom: 1px solid #1d2330; padding: 4px 6px; }
td { border-bottom: 1px solid #e3e7ee; padding: 3px 6px; vertical-align: top; }
td.n, th.n { text-align: right; white-space: nowrap; }
tr.total td { font-weight: 700; border-top: 1px solid #1d2330; border-bottom: 0; }
.note { font-size: 9pt; color: #4a5263; margin: 4px 0 0; }
.caveat { margin-top: 11px; border: 1px solid #c9d0db; background: #f4f6f9; border-radius: 6px; padding: 8px 10px; font-size: 9.5pt; }
footer { margin-top: 11px; padding-top: 6px; border-top: 1px solid #e3e7ee; font-size: 8.5pt; color: #4a5263; display: flex; justify-content: space-between; }
@media print { main { padding: 0; } }
`;

const figure = (value: string, label: string) => `<div class="figure"><div class="v">${value}</div><div class="l">${label}</div></div>`;

function page(title: string, subtitle: string, body: string, date: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}: sizing summary</title>
<style>${CSS}</style>
</head>
<body>
<main>
<header>
<div class="kicker">Cluster sizing summary</div>
<h1>${title}</h1>
<div class="sub">${subtitle} · ${date}</div>
</header>
${body}
<footer><span>Prepared with the Elastic Ballpark Editor</span><span>${date}</span></footer>
</main>
</body>
</html>
`;
}

function selfManaged(state: AppState, r: SizingResult, cost: CostReport | { error: string } | undefined): { subtitle: string; body: string } {
  const perSite = r.sites > 1 ? ' per site' : '';
  const rows = byRoleOrder([
    ...r.tiers.map((t) => ({ role: t.tier as string, nodes: t.nodes, ram: t.ramGb, disk: t.diskGb })),
    ...r.overhead.filter((o) => o.count > 0).map((o) => ({ role: o.role as string, nodes: o.count, ram: o.ramGb, disk: o.diskGb })),
  ]);
  const nodes = rows.reduce((s, x) => s + x.nodes, 0);
  const license = r.licenseFloor === 'basic'
    ? figure('Basic', 'Subscription: free, no license units')
    : figure(`${fmtNum(r.licenseUnits.value, 0)} ERU`, 'Enterprise license units (blocks of memory)');
  const binding = r.constraints.find((k) => k.binding);
  const years = state.forward.options.growthHorizonYears;
  const growing = state.forward.workloads.some((w) => (w.growthPctPerYear ?? 0) > 0);
  // Hot, warm and content keep one replica unless the workload sets 0 (the engine's default).
  const hasReplicas = state.forward.workloads.some((w) => (['hot', 'warm', 'content'] as Tier[]).some((t) => {
    const used = (w.retentionDays[t] ?? 0) > 0 || (t === 'content' && (w.totalGb !== undefined || w.vector !== undefined));
    return used && (w.replicas?.[t] ?? 1) > 0;
  }));

  const L: string[] = [];
  L.push('<h2>What you asked for</h2>', '<ul>', ...state.forward.workloads.map((w) => `<li>${describeWorkload(w)}</li>`), '</ul>');
  if (r.sites > 1) L.push(`<p class="note">Sized for ${r.sites} sites that copy data between them; the figures below are for each site.</p>`);

  L.push('<h2>What you need</h2>', '<div class="figures">',
    figure(fmtNum(nodes, 0), `Elasticsearch and supporting nodes${perSite}`),
    figure(`${fmtNum(r.totalRamGb, 0)} GB`, `Total memory${perSite}`),
    license,
    ...(r.objectStorage ? [figure(fmtStorage(r.objectStorage.gb), 'Object storage for older data')] : []),
    '</div>');
  L.push('<table><thead><tr><th>Part</th><th class="n">Nodes</th><th class="n">Memory each</th><th class="n">Disk each</th></tr></thead><tbody>');
  for (const x of rows) L.push(`<tr><td>${escapeHtml(ROLE_WORDS[x.role] ?? x.role)}</td><td class="n">${fmtNum(x.nodes, 0)}</td><td class="n">${fmtNum(x.ram, 0)} GB</td><td class="n">${x.disk ? fmtStorage(x.disk) : '–'}</td></tr>`);
  L.push('</tbody></table>', '<p class="note">A node is one running copy of Elasticsearch. Several can share a large server.</p>');

  if (cost && !('error' in cost) && cost.total > 0) {
    L.push('<h2>Estimated cost</h2>', '<table><thead><tr><th>Year</th><th class="n">Cost</th></tr></thead><tbody>');
    for (const y of cost.years) L.push(`<tr><td>Year ${y.year}</td><td class="n">${fmtMoney(y.total)}</td></tr>`);
    L.push(`<tr class="total"><td>${cost.termYears}-year total</td><td class="n">${fmtMoney(cost.total)}</td></tr>`, '</tbody></table>');
    L.push(`<p class="note">From the prices entered for this estimate${cost.partial ? '; parts without a price are left out' : ''}.</p>`);
  }

  const assumptions = [
    'Each part keeps one spare node, so the cluster keeps running and holds all its data if a node fails.',
    'Disks are never planned completely full: about a fifth is kept free so the cluster can move and grow data safely.',
    ...(hasReplicas ? ['Recent data keeps a spare copy on a second node, so nothing is lost if one fails.'] : []),
    growing && years ? `Sized for the data volume ${fmtNum(years, 0)} year${years === 1 ? '' : 's'} from now, at the growth rates above.` : 'Sized for today\'s data volume, with no growth.',
    ...(binding ? [`What sets the size: ${escapeHtml(constraintWithTier(binding.name, binding.tier))} runs out first.`] : []),
  ].slice(0, 5);
  L.push('<h2>What this depends on</h2>', '<ul>', ...assumptions.map((a) => `<li>${a}</li>`), '</ul>');
  L.push('<div class="caveat"><strong>This is an estimate, not a quote.</strong> Disk space figures are dependable. Processing and search speed depend on your data, so they should be confirmed with a test on your own data before hardware is bought.</div>');
  return { subtitle: `Self-managed Elasticsearch${r.sites > 1 ? `, ${r.sites} sites` : ''}`, body: L.join('\n') };
}

function sizeWords(l: EchLine): string {
  if (l.nodesPerZone !== undefined && l.nodeSizeGb !== undefined && l.zones !== undefined) {
    return `${l.nodesPerZone} × ${fmtNum(l.nodeSizeGb, 0)} GB × ${l.zones} zone${l.zones === 1 ? '' : 's'}`;
  }
  return l.ramGb !== undefined ? `${fmtNum(l.ramGb, 0)} GB` : '';
}

function elasticCloud(ech: EchState, data: EchData, outcomes: readonly EchOutcome[]): { subtitle: string; body: string } {
  const rounded = ech.roundLines;
  const t = echTotals(outcomes, rounded);
  const L: string[] = [];
  L.push('<h2>What you asked for</h2>', '<ul>', ...outcomes.map((o) => `<li>${describeEchItem(o.item)}</li>`), '</ul>');
  L.push('<h2>What you need</h2>', '<div class="figures">',
    figure(fmtMoney(t.annual), 'List price per year'),
    figure(fmtMoney(t.annual / 12), 'Per month'),
    figure(fmtMoney(t.y1), 'In the first year'),
    '</div>');
  const DATA = new Set(['hot', 'warm', 'cold', 'frozen', 'content']);
  const unpriced: string[] = [];
  L.push('<table><thead><tr><th>Use case</th><th>What it runs on</th><th class="n">Per year</th></tr></thead><tbody>');
  for (const o of outcomes) {
    if (!('result' in o)) {
      L.push(`<tr><td>${escapeHtml(o.item.name)}</td><td>Not priced: ${escapeHtml(o.error)}</td><td class="n">–</td></tr>`);
      continue;
    }
    const lines = o.result.lines;
    for (const l of lines) if (l.error) unpriced.push(`${o.item.name}: ${l.label}`);
    const data = lines.filter((l) => DATA.has(l.key) && !l.error).map((l) => `${l.label} ${sizeWords(l)}`);
    const support = lines.filter((l) => !DATA.has(l.key) && l.key !== 'transfer' && l.key !== 'storage' && !l.error);
    const supportGb = support.reduce((sum, l) => sum + (l.ramGb ?? 0), 0);
    const parts = [
      ...data,
      ...(support.length ? [`${support.map((l) => l.label.toLowerCase()).join(', ')} (${fmtNum(supportGb, 0)} GB)`] : []),
      'data transfer and snapshot storage',
    ];
    L.push(`<tr><td>${escapeHtml(o.item.name)}</td><td>${escapeHtml(parts.join('; '))}</td><td class="n">${fmtMoney(rounded ? o.result.totalRounded : o.result.total)}</td></tr>`);
  }
  L.push(`<tr class="total"><td colspan="2">Total per year</td><td class="n">${fmtMoney(t.annual)}</td></tr>`, '</tbody></table>');
  L.push('<p class="note">Sizes read as nodes × memory per node in each availability zone (a separate data center in the same region).</p>');
  if (unpriced.length) L.push(`<p class="note">Not priced and left out: ${escapeHtml(unpriced.join(', '))}.</p>`);
  const assumptions = [
    'Each use case is priced as its own Elastic Cloud deployment, and the costs add up.',
    `List prices before any discount, from the Elastic Cloud price list (ballpark estimator version ${escapeHtml(data.source.version)}).`,
    'Data transfer and snapshot storage are included in the totals.',
    'The first year costs a little less because stored snapshots build up over the retention period.',
    ...(rounded ? ['Each line is rounded up to the next $1,000.'] : []),
  ].slice(0, 5);
  L.push('<h2>What this depends on</h2>', '<ul>', ...assumptions.map((a) => `<li>${a}</li>`), '</ul>');
  L.push('<div class="caveat"><strong>This is an estimate, not a quote.</strong> Final prices, discounts and terms come from an official quote from Elastic.</div>');
  return { subtitle: `Elastic Cloud Hosted · ${escapeHtml(placementSummary(ech.placement))}`, body: L.join('\n') };
}

/** The whole summary page. `at` is an ISO timestamp; only its date is shown. */
export function customerSummaryHtml(input: SummaryInput, at: string): string {
  const date = at.slice(0, 10);
  const title = escapeHtml(input.state.name);
  const { subtitle, body } = input.kind === 'self_managed'
    ? selfManaged(input.state, input.result, input.cost)
    : elasticCloud(input.ech, input.data, input.outcomes);
  return page(title, subtitle, body, date);
}
