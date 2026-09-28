import type { Constant } from '@sizing/constants';
import type { ModelRow, SizingResult, TopologyResult, WorkloadProfile } from '@sizing/engine';
import type { CostReport } from './cost.ts';
import { fmtMoney } from './format.ts';
import { byRoleOrder } from './ui/tiers.ts';
import type { AppState } from './state.ts';

const n = (x: number, d = 2) =>
  Number.isFinite(x) ? x.toLocaleString('en-US', { maximumFractionDigits: d }) : x > 0 ? 'not limiting' : String(x);

const CONSTRAINT_LABEL: Record<string, string> = {
  storage: 'Storage', disk: 'Disk', frozen: 'Frozen local cache', heap_shards: 'Shard count (memory)', masters: 'Master node memory',
  vector_offheap: 'Vector search memory', cpu_ingest: 'Processor', disk_write: 'Disk write speed', query: 'Search load',
  fleet: 'Fleet (agent management)', ml: 'Machine learning',
};
export const constraintLabel = (name: string) => CONSTRAINT_LABEL[name] ?? name;
/** Label plus tier, without repeating it ("Frozen cache" already names its tier). */
export const constraintWithTier = (name: string, tier?: string) => (tier && name !== 'frozen' ? `${constraintLabel(name)} (${tier})` : constraintLabel(name));

const SOLVE_LABEL: Record<string, string> = {
  max_gb_day: 'Most GB per day', max_retention: 'Longest retention', max_agents: 'Most Elastic Agents',
  max_vectors: 'Most vectors', max_shards: 'Most shards', max_ml_jobs: 'Most machine learning jobs', years_to_capacity: 'Years until full',
};
export const solveLabel = (s: string) => SOLVE_LABEL[s] ?? s;

/** SPEC §14 Rally tracks per workload kind. */
export function rallyPlan(workloads: readonly WorkloadProfile[]): string[] {
  const tracks = new Set<string>();
  for (const w of workloads) {
    if (w.kind === 'logs') tracks.add('`elastic/logs` (`logging-indexing`, `logging-indexing-querying`)');
    if (w.kind === 'siem') tracks.add('`elastic/security`');
    if (w.kind === 'metrics') tracks.add('`metricbeat` / TSDB');
    if (w.kind === 'apm' || w.kind === 'search') tracks.add('`http_logs` (set `enable_logsdb` to compare LogsDB)');
    if (w.kind === 'vector' || w.vector) tracks.add('`dense_vector` / `so_vector`');
  }
  if (tracks.size === 0) tracks.add('`elastic/logs` (`logging-indexing`)');
  return [
    ...[...tracks].map((t) => `- Run ${t}.`),
    '- Run against the customer\'s hardware with `--pipeline=benchmark-only`, ideally with a custom track on their data.',
    '- After deployment, calibrate with AutoOps (internet-connected) or Stack Monitoring (air-gapped).',
  ];
}

export function toJson(state: AppState, result: SizingResult, exportedAt: string, constantOverrides: readonly Constant[] = []): string {
  return JSON.stringify({
    exportedAt,
    engineVersion: result.engineVersion,
    constantsHash: result.constantsHash,
    /** Constants changed in the browser at export time; empty means the shipped set. */
    constantOverrides,
    scenario: state,
    result,
  }, null, 2);
}

function costSection(cost: CostReport | { error: string }): string[] {
  if ('error' in cost) return ['## Estimated cost', '', `Not available: ${cost.error}`, ''];
  const years = cost.years.map((y) => `Year ${y.year}`);
  const money = (x: number | undefined) => (x === undefined ? 'not priced' : fmtMoney(x));
  const L = ['## Estimated cost', '', '> Indicative only, from the prices entered for this scenario. Not a quote.', ''];
  L.push(`| Component | ${years.join(' | ')} | ${cost.termYears}-year total |`, `|---|${years.map(() => '---:').join('|')}|---:|`);
  cost.years[0]!.lines.forEach((l, i) => {
    const perYear = cost.years.map((y) => y.lines[i]!.annual);
    const total = perYear.every((v) => v !== undefined) ? perYear.reduce((s, v) => s + v!, 0) : undefined;
    L.push(`| ${l.label} | ${perYear.map(money).join(' | ')} | ${money(total)} |`);
  });
  L.push(`| **Total** | ${cost.years.map((y) => `**${fmtMoney(y.total)}**`).join(' | ')} | **${fmtMoney(cost.total)}** |`, '');
  if (cost.partial) L.push('Components marked "not priced" are left out of the totals.', '');
  return L;
}

export function toMarkdown(state: AppState, result: SizingResult, workloads: readonly WorkloadProfile[], exportedAt: string, cost?: CostReport | { error: string }): string {
  const L: string[] = [];
  const perSite = result.sites > 1 ? ' (per site)' : '';
  L.push(`# ${state.name}`, '');
  L.push('> **Estimate, not benchmark.** Disk space figures are dependable. Processor, search speed and machine learning figures are rough. Test them with Rally, Elastic\'s benchmarking tool, before buying hardware.', '');

  if (result.mode === 'reverse' && result.answer) {
    const a = result.answer;
    L.push('## Capacity answer', '');
    L.push(`**${solveLabel(a.solve)}: ${n(a.value)} ${a.unit}**${a.dataStreams !== undefined ? ` (${n(a.dataStreams, 0)} data streams)` : ''}`, '');
    L.push(`Runs out first: ${constraintLabel(a.binding)}${a.bindingTier ? ` (${a.bindingTier})` : ''}. Confidence in this figure: ${a.confidence}.`, '');
  }

  L.push(`## Cluster summary${perSite}`, '');
  L.push(`- Total memory (RAM): **${n(result.totalRamGb)} GB**`);
  L.push(result.licenseFloor === 'basic'
    ? '- Subscription: **Basic**, no paid features used, so no license units to buy'
    : `- Subscription: **Enterprise, ${n(result.licenseUnits.value, 0)} ${result.licenseUnits.unit}** (self-managed). Needed for: ${result.licenseFloorReasons.join('; ')}. An ERU (Enterprise Resource Unit) is the unit Elastic licenses by, a block of memory.`);
  if (result.objectStorage) L.push(`- Object storage (cheap bulk storage such as S3, holding the cold and frozen data): **${n(result.objectStorage.gb, 0)} GB**${result.objectStorage.overridden ? ` (set by hand for this scenario; calculated ${n(result.objectStorage.calculatedGb, 0)} GB)` : ''}`);
  if (result.sites > 1) L.push(`- All ${result.sites} sites: ${n(result.allSites.totalRamGb)} GB memory, ${n(result.allSites.licenseUnits, 0)} ERU`);
  L.push('');

  L.push(`## Nodes${perSite}`, '', 'A node is one running copy of Elasticsearch on a server.', '', '| Role | Nodes | Memory each (GB) | Disk each (GB) | Cores each |', '|---|---:|---:|---:|---:|');
  const nodeRows = byRoleOrder([
    ...result.tiers.map((t) => ({ role: t.tier as string, line: `| ${t.tier} | ${t.nodes} | ${n(t.ramGb)} | ${n(t.diskGb)} | ${n(t.vcpu)} |` })),
    ...result.overhead.map((o) => ({ role: o.role as string, line: `| ${o.role}${o.countsTowardLicense ? '' : ' (no license needed)'} | ${o.count} | ${n(o.ramGb)} | ${o.diskGb ? n(o.diskGb) : '–'} | ${n(o.vcpu)} |` })),
  ]);
  for (const x of nodeRows) L.push(x.line);
  L.push('');

  L.push('## Limits', '', 'How full each resource is. The one marked "runs out first" sets the size.', '', '| Resource | Tier | Value | How full | Confidence | Runs out first |', '|---|---|---:|---:|---|---|');
  for (const k of result.constraints) {
    const value = k.maxValue !== undefined ? `up to ${n(k.maxValue)} ${k.unit}` : k.demand !== undefined ? `${n(k.demand)} / ${n(k.capacity)} ${k.unit}` : 'not estimated';
    const util = k.utilization !== undefined && Number.isFinite(k.utilization) ? `${n(k.utilization * 100, 1)}%` : '–';
    L.push(`| ${constraintLabel(k.name)}${k.rallyRequired ? ' (needs a Rally test)' : ''} | ${k.tier ?? ''} | ${value} | ${util} | ${k.confidence} | ${k.binding ? '**yes**' : ''} |`);
  }
  L.push('');

  L.push('## Hardware checks', '');
  if (result.warnings.length === 0) L.push('No hardware problems found.');
  for (const w of result.warnings) L.push(`- **${SEVERITY_WORD[w.severity]}:** ${w.message} (check ${w.id})`);
  L.push('');

  if (cost) L.push(...costSection(cost));

  L.push('## Assumptions', '', ...result.assumptions.map((a) => `- ${a}`), '');
  L.push('## Recommended Rally tests', '', 'Rally is Elastic\'s benchmarking tool. These steps are for the technical team.', '', ...rallyPlan(workloads), '');
  L.push('---', `Engine ${result.engineVersion} · constants ${result.constantsHash.slice(0, 12)} · exported ${exportedAt}`);
  return L.join('\n');
}

const SEVERITY_WORD: Record<string, string> = { error: 'Problem to fix', warn: 'Worth a look', info: 'Note' };
const STATUS_WORD: Record<string, string> = { ok: 'fits', short: 'not enough', missing: 'no servers', unplaced: 'not placed', idle: 'unused' };
const RELATIONSHIP_WORD: Record<string, string> = { independent: 'independent clusters', dr: 'disaster recovery (a standby site takes over if the main one fails)', active_active: 'active-active (every site serves traffic and holds all the data)' };

export function download(filename: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'scenario';
}

/** D32: Markdown for a multi-site scenario: verdict, headroom, per-site server fit and assumptions. */
export function topologyMarkdown(name: string, t: TopologyResult, exportedAt: string): string {
  const L: string[] = [`# ${name}`, ''];
  L.push('> **Estimate, not benchmark.** Disk space figures are dependable. Processor, search speed and machine learning figures are rough. Test them with Rally, Elastic\'s benchmarking tool, before buying hardware.', '');
  L.push('## Summary', '');
  L.push(`- Site setup: **${RELATIONSHIP_WORD[t.relationship] ?? t.relationship}**, ${t.sites.length} sites`);
  L.push(`- Verdict: **${t.fitsAll ? 'fits on these servers' : 'short of servers'}**`);
  if (t.headroom) {
    const s = t.headroom.scale;
    L.push(`- Headroom (spare room): ${Number.isFinite(s) ? `${n(s, 2)}× today's data volume` : 'not limited by these servers'}${t.headroom.binding ? ` (${t.headroom.binding.site} ${t.headroom.binding.role} runs out first)` : ''}`);
  }
  L.push(`- Servers needed: ${t.totals.neededServers} of ${t.totals.availableServers}; memory ${n(t.totals.ramGb)} GB; ${t.totals.eru} ERU (each site licensed separately, added up). An ERU (Enterprise Resource Unit) is the unit Elastic licenses by, a block of memory.`);
  if (t.totals.objectStorageGb > 0) L.push(`- Object storage (cheap bulk storage for cold and frozen data): ${n(t.totals.objectStorageGb, 0)} GB`);
  L.push('');
  for (const s of t.sites) {
    L.push(`## ${s.name}`, '', `Holds: ${s.holds.join(', ') || 'no data'}`, '');
    L.push('| Role | Servers needed | Available | Nodes per server | Status |', '|---|---:|---:|---:|---|');
    for (const f of byRoleOrder(s.fit)) L.push(`| ${f.role} | ${f.status === 'idle' ? '–' : f.neededServers} | ${f.availableServers} | ${f.nodesPerServer} | ${STATUS_WORD[f.status] ?? f.status} |`);
    L.push('');
  }
  L.push('## Assumptions', '', ...[...t.assumptions, ...(t.sites[0]?.result.assumptions ?? [])].map((a) => `- ${a}`), '');
  L.push('---', `Engine ${t.sites[0]?.result.engineVersion ?? ''} · constants ${t.sites[0]?.result.constantsHash.slice(0, 12) ?? ''} · exported ${exportedAt}`);
  return L.join('\n');
}

const MODEL_LABEL: Record<string, string> = { self_managed: 'Self-managed', eck: 'ECK (Kubernetes)', ece: 'ECE' };
const BEST_WORD: Record<string, string> = { eru: 'fewest license units', headroom: 'most spare room', servers: 'fewest servers' };

/** D33: Markdown for a deployment-model comparison on one site's servers. */
export function modelsMarkdown(name: string, rows: readonly ModelRow[], exportedAt: string): string {
  const L: string[] = [`# ${name}: deployment models compared`, ''];
  L.push('> **Estimate, not benchmark.** ECK and ECE need some servers and memory for themselves; those amounts are cautious defaults. Test with Rally and check with the platform team.', '');
  L.push('Self-managed installs Elasticsearch directly on the servers. ECK runs it in containers managed by Kubernetes. ECE is Elastic\'s private-cloud platform, installed on your servers. An ERU (Enterprise Resource Unit) is the unit Elastic licenses by, a block of memory.', '');
  L.push('| Model | Fits | Spare room | Servers needed | ERU | Best on |', '|---|---|---:|---:|---:|---|');
  for (const r of rows) {
    const s = r.topology.headroom?.scale;
    const head = s === undefined ? '–' : Number.isFinite(s) ? `${n(s, 2)}×` : 'unlimited';
    L.push(`| ${MODEL_LABEL[r.model]} | ${r.topology.fitsAll ? 'yes' : 'no'} | ${head} | ${r.topology.totals.neededServers} / ${r.topology.totals.availableServers} | ${r.eru} | ${r.best.map((b) => BEST_WORD[b] ?? b).join(', ') || '–'} |`);
  }
  L.push('');
  for (const r of rows) {
    L.push(`## ${MODEL_LABEL[r.model]}`, '', ...r.requirements.map((q) => `- ${q}`), '');
    L.push('| Role | Servers needed | Available | Nodes per server | Status |', '|---|---:|---:|---:|---|');
    for (const f of byRoleOrder(r.topology.sites[0]!.fit)) L.push(`| ${f.role} | ${f.status === 'idle' ? '–' : f.neededServers} | ${f.availableServers} | ${f.nodesPerServer} | ${STATUS_WORD[f.status] ?? f.status} |`);
    L.push('');
  }
  L.push('---', `Engine ${rows[0]?.topology.sites[0]?.result.engineVersion ?? ''} · constants ${rows[0]?.topology.sites[0]?.result.constantsHash.slice(0, 12) ?? ''} · exported ${exportedAt}`);
  return L.join('\n');
}
