import type { Constant } from '@sizing/constants';
import type { SizingResult, WorkloadProfile } from '@sizing/engine';
import type { AppState } from './state.ts';

const n = (x: number, d = 2) =>
  Number.isFinite(x) ? x.toLocaleString('en-US', { maximumFractionDigits: d }) : x > 0 ? 'not limiting' : String(x);

const CONSTRAINT_LABEL: Record<string, string> = {
  storage: 'Storage', disk: 'Disk', frozen: 'Frozen (object store)', heap_shards: 'Shards / heap', masters: 'Master heap (indices)',
  vector_offheap: 'Vector off-heap', cpu_ingest: 'CPU / ingest', query: 'Query', fleet: 'Fleet', ml: 'ML',
};
export const constraintLabel = (name: string) => CONSTRAINT_LABEL[name] ?? name;

const SOLVE_LABEL: Record<string, string> = {
  max_gb_day: 'Max GB/day', max_retention: 'Max retention', max_agents: 'Max Elastic Agents',
  max_vectors: 'Max vectors', max_shards: 'Max shards', max_ml_jobs: 'Max ML jobs', years_to_capacity: 'Years until full',
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

export function toMarkdown(state: AppState, result: SizingResult, workloads: readonly WorkloadProfile[], exportedAt: string): string {
  const L: string[] = [];
  const perSite = result.sites > 1 ? ' (per site)' : '';
  L.push(`# ${state.name}`, '');
  L.push('> **Estimate, not benchmark.** Storage math is reliable; CPU, query latency and ML are not. Validate with Rally before committing hardware.', '');

  if (result.mode === 'reverse' && result.answer) {
    const a = result.answer;
    L.push('## Capacity answer', '');
    L.push(`**${solveLabel(a.solve)}: ${n(a.value)} ${a.unit}**${a.dataStreams !== undefined ? ` (${n(a.dataStreams, 0)} data streams)` : ''}`, '');
    L.push(`Binding constraint: ${constraintLabel(a.binding)}${a.bindingTier ? ` (${a.bindingTier})` : ''}, ${a.confidence} confidence.`, '');
  }

  L.push(`## Architecture summary${perSite}`, '');
  L.push(`- Total RAM: **${n(result.totalRamGb)} GB**`);
  L.push(`- License units: **${n(result.licenseUnits.value, 0)} ${result.licenseUnits.unit}** (self-managed)`);
  L.push(`- License floor: **${result.licenseFloor}**${result.licenseFloorReasons.length ? ` (${result.licenseFloorReasons.join('; ')})` : ''}`);
  if (result.sites > 1) L.push(`- All ${result.sites} sites: ${n(result.allSites.totalRamGb)} GB RAM, ${n(result.allSites.licenseUnits, 0)} ERU`);
  L.push('');

  L.push(`## Node table${perSite}`, '', '| Role | Nodes | RAM/node (GB) | Disk/node (GB) | vCPU/node |', '|---|---:|---:|---:|---:|');
  for (const t of result.tiers) L.push(`| ${t.tier} | ${t.nodes} | ${n(t.ramGb)} | ${n(t.diskGb)} | ${n(t.vcpu)} |`);
  for (const o of result.overhead) L.push(`| ${o.role}${o.countsTowardLicense ? '' : ' (not licensed)'} | ${o.count} | ${n(o.ramGb)} | ${o.diskGb ? n(o.diskGb) : '–'} | ${n(o.vcpu)} |`);
  L.push('');

  L.push('## Constraints', '', '| Constraint | Tier | Value | Utilization | Confidence | Binding |', '|---|---|---:|---:|---|---|');
  for (const k of result.constraints) {
    const value = k.maxValue !== undefined ? `max ${n(k.maxValue)} ${k.unit}` : k.demand !== undefined ? `${n(k.demand)} / ${n(k.capacity)} ${k.unit}` : 'not modeled';
    const util = k.utilization !== undefined && Number.isFinite(k.utilization) ? `${n(k.utilization * 100, 1)}%` : '–';
    L.push(`| ${constraintLabel(k.name)}${k.rallyRequired ? ' (Rally required)' : ''} | ${k.tier ?? ''} | ${value} | ${util} | ${k.confidence} | ${k.binding ? '**yes**' : ''} |`);
  }
  L.push('');

  L.push('## Warnings', '');
  if (result.warnings.length === 0) L.push('None.');
  for (const w of result.warnings) L.push(`- **${w.id}** (${w.severity}): ${w.message}`);
  L.push('');

  L.push('## Assumptions', '', ...result.assumptions.map((a) => `- ${a}`), '');
  L.push('## Recommended Rally plan', '', ...rallyPlan(workloads), '');
  L.push('---', `Engine ${result.engineVersion} · constants ${result.constantsHash.slice(0, 12)} · exported ${exportedAt}`);
  return L.join('\n');
}

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
