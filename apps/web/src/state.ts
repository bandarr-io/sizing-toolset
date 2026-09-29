import { defaultConstants, num, val, type ConstantSet, type MasterSizingRow } from '@sizing/constants';
import { nodesPerServer } from '@sizing/engine';
import type { CostSettings } from './cost.ts';
import { defaultEch, newEchItem, type EchItem } from './ech/state.ts';
import type {
  HostModel, ServerGroup, SiteInput, SiteRelationship, TopologyRequest,
  CcrMode, DeploymentModel, ForwardOptions, ForwardRequest, IndexMode, NodeGroup, ReverseRequest, Solve, Tier, WorkloadKind, WorkloadProfile,
} from '@sizing/engine';

export type Mode = 'forward' | 'reverse' | 'multisite' | 'models';

const fmt1 = (x: number) => x.toLocaleString('en-US', { maximumFractionDigits: 1 });

/** One workload in a few words: "Logs 500 GB/day", "Search 500 GB", "Vectors 10M". */
export function workloadBrief(w: WorkloadProfile): string {
  if (w.rawGbPerDay !== undefined) return `${w.id} ${fmt1(w.rawGbPerDay)} GB/day`;
  if (w.totalGb !== undefined) return `${w.id} ${fmt1(w.totalGb)} GB`;
  if (w.vector) return `${w.id} ${w.vector.count >= 1e6 ? `${fmt1(w.vector.count / 1e6)}M` : fmt1(w.vector.count)} vectors`;
  if (w.ml) return `${w.id} ${w.ml.anomalyJobs} ML jobs`;
  if (w.fleet) return `${w.id} ${fmt1(w.fleet.agents)} agents`;
  return w.id;
}

/** Folded workload step: "2 workloads: Logs 500 GB/day, Metrics 50 GB/day". */
export function workloadsSummary(ws: readonly WorkloadProfile[]): string {
  if (ws.length === 0) return 'No workloads yet';
  return `${ws.length} workload${ws.length === 1 ? '' : 's'}: ${ws.map(workloadBrief).join(', ')}`;
}

/** Folded server or hardware step: "35 servers: 3 master, 22 hot × 256 GB, 8 frozen × 128 GB". */
export function groupsSummary(groups: readonly { role: string; count: number; ramGb: number }[], noun = 'servers'): string {
  const total = groups.reduce((s, g) => s + g.count, 0);
  if (total === 0) return `No ${noun} yet`;
  return `${total} ${noun}: ${groups.filter((g) => g.count > 0).map((g) => `${g.count} ${g.role} × ${fmt1(g.ramGb)} GB`).join(', ')}`;
}

/** A starting point for Size a workload: realistic workloads that replace the current list. */
export interface WorkloadTemplate { id: string; label: string; blurb: string; icon: string; build: (c: ConstantSet) => WorkloadProfile[] }

/** Built from newWorkload so settings-driven defaults (downsampling, vector compression) still apply. */
export const TEMPLATES: WorkloadTemplate[] = [
  {
    id: 'siem', label: 'SIEM: 500 GB/day for a year', blurb: 'Security events in LogsDB, 30 days hot and the rest of the year frozen', icon: 'logoSecurity',
    build: (c) => [{ ...newWorkload('siem', [], c), rawGbPerDay: 500, retentionDays: { hot: 30, frozen: 335 } }],
  },
  {
    id: 'observability', label: 'Observability: logs, metrics and APM', blurb: 'Logs 200 GB/day, metrics 50 GB/day and traces 50 GB/day, kept 90 days', icon: 'logoObservability',
    build: (c) => {
      const logs = { ...newWorkload('logs', [], c), rawGbPerDay: 200 };
      const metrics = { ...newWorkload('metrics', [logs.id], c), rawGbPerDay: 50 };
      const apm = { ...newWorkload('apm', [logs.id, metrics.id], c), rawGbPerDay: 50 };
      return [logs, metrics, apm];
    },
  },
  {
    id: 'search', label: 'Search app: 500 GB of documents', blurb: 'A catalog or knowledge base that does not age, with one spare copy', icon: 'search',
    build: (c) => [{ ...newWorkload('search', [], c), totalGb: 500 }],
  },
  {
    id: 'vector', label: 'Vector search: 10 million vectors', blurb: '1,024 dimensions, compressed with BBQ', icon: 'sparkles',
    build: (c) => {
      const w = newWorkload('vector', [], c);
      return [{ ...w, vector: { ...w.vector!, count: 10_000_000, dims: 1024, quant: 'bbq' } }];
    },
  },
];

export function applyTemplate(id: string, c: ConstantSet = defaultConstants): WorkloadProfile[] {
  const t = TEMPLATES.find((x) => x.id === id);
  if (!t) throw new Error(`Unknown template: ${id}`);
  return t.build(c);
}

/** True when no workload has a growth rate, so the Plan for growth step can start folded. */
export function isDefaultGrowth(f: ForwardRequest): boolean {
  return !f.workloads.some((w) => (w.growthPctPerYear ?? 0) > 0);
}

/** One line for the folded Plan for growth step: "Sized for 3 years · Logs 20%/yr, Metrics 10%/yr". */
export function growthSummary(c: ConstantSet, f: ForwardRequest): string {
  const rated = f.workloads.filter((w) => (w.growthPctPerYear ?? 0) > 0);
  if (rated.length === 0) return "No growth set: sized for today's data";
  const years = f.options.growthHorizonYears ?? num(c, 'growth.default_horizon_years');
  const horizon = years === 0 ? 'Sized for today' : `Sized for ${years} year${years === 1 ? '' : 's'}`;
  const pct = (x: number) => x.toLocaleString('en-US', { maximumFractionDigits: 1 });
  return `${horizon} · ${rated.map((w) => `${w.id} ${pct(w.growthPctPerYear!)}% a year`).join(', ')}`;
}

/**
 * One input model per mode: the engine request itself. Simple and advanced inputs edit the same data;
 * advanced fields are only hidden, never a second copy.
 * Reverse convention: `reverse.fixed[0]` is the workload being solved; later entries already run on the cluster.
 */
export interface AppState {
  version: 2;
  name: string;
  mode: Mode;
  forward: ForwardRequest;
  reverse: ReverseRequest;
  /** Prices, term and export choice for this scenario; blank prices fall back to the browser's cost defaults. */
  cost?: CostSettings;
  /** D32: several clusters on physical servers. Absent until the mode is first used. */
  multisite?: MultiSiteState;
  /** D33: one site's servers, compared across self-managed, ECK and ECE. */
  models?: ModelsState;
  /** D40: Elastic Cloud Hosted, priced like the ECH Ballpark Estimator. */
  ech?: import('./ech/state.ts').EchState;
  /** D43: Size a workload runs on self-managed (the sizing engine) or Elastic Cloud (the ECH inputs). */
  sizeOn?: 'self_managed' | 'ech';
}

export type ModelOption = { value: DeploymentModel; text: string; disabled?: boolean };

/** Default list; see modelOptionsFor for what each mode offers. */
export const MODELS: ModelOption[] = [
  { value: 'self_managed', text: 'Self-managed' },
  { value: 'eck', text: 'ECK (coming later)', disabled: true },
  { value: 'ece', text: 'ECE (coming later)', disabled: true },
  { value: 'ech', text: 'Elastic Cloud Hosted (coming later)', disabled: true },
  { value: 'serverless', text: 'Serverless (coming later)', disabled: true },
];

export interface KindMeta { label: string; icon: string; blurb: string; stream: boolean }

export const KINDS: Record<WorkloadKind, KindMeta> = {
  logs: { label: 'Logs', icon: 'logoLogging', blurb: 'Records of what apps and systems did', stream: true },
  siem: { label: 'Security', icon: 'logoSecurity', blurb: 'Security events for spotting threats', stream: true },
  metrics: { label: 'Metrics', icon: 'logoMetrics', blurb: 'Measurements over time, like CPU use', stream: true },
  apm: { label: 'APM', icon: 'apmApp', blurb: 'Application performance monitoring data', stream: true },
  search: { label: 'Search', icon: 'logoEnterpriseSearch', blurb: 'Documents to search, like a catalog', stream: false },
  vector: { label: 'Vectors', icon: 'logoVectorDB', blurb: 'Numeric fingerprints for AI search', stream: false },
  ml: { label: 'Machine learning', icon: 'machineLearningApp', blurb: 'Jobs that spot unusual activity', stream: false },
  fleet: { label: 'Fleet agents', icon: 'fleetApp', blurb: 'Elastic Agents, which collect data on each machine', stream: false },
};

export const KIND_ORDER: WorkloadKind[] = ['logs', 'siem', 'metrics', 'apm', 'search', 'vector', 'ml', 'fleet'];

export const SOLVES: { value: Solve; title: string; blurb: string; icon: string }[] = [
  { value: 'max_gb_day', title: 'Most data per day', blurb: 'How many GB a day this hardware can keep', icon: 'storage' },
  { value: 'max_retention', title: 'Longest retention', blurb: 'How many days of data it can keep', icon: 'clock' },
  { value: 'years_to_capacity', title: 'Years until full', blurb: 'When growing data will fill this hardware', icon: 'timeline' },
  { value: 'max_agents', title: 'Most Elastic Agents', blurb: 'How many data-collecting agents it can manage', icon: 'fleetApp' },
  { value: 'max_vectors', title: 'Most vectors', blurb: 'How many AI search fingerprints fit', icon: 'logoVectorDB' },
  { value: 'max_shards', title: 'Most shards', blurb: 'How many slices of data (shards) it can hold', icon: 'indexManagementApp' },
  { value: 'max_ml_jobs', title: 'Most machine learning jobs', blurb: 'How many jobs that spot unusual activity it can run', icon: 'machineLearningApp' },
];

/** Workload kinds that can be the subject of each reverse question. Empty = hardware-only question. */
export const SOLVE_KINDS: Record<Solve, WorkloadKind[]> = {
  max_gb_day: ['logs', 'siem', 'metrics', 'apm'],
  max_retention: ['logs', 'siem', 'metrics', 'apm'],
  years_to_capacity: ['logs', 'siem', 'metrics', 'apm'],
  max_shards: ['logs', 'siem', 'metrics', 'apm'],
  max_vectors: ['vector'],
  max_agents: [],
  max_ml_jobs: [],
};

export function uniqueName(base: string, taken: readonly string[]): string {
  if (!taken.includes(base)) return base;
  let i = 2;
  while (taken.includes(`${base} ${i}`)) i++;
  return `${base} ${i}`;
}

/**
 * A new workload with defaults that produce a sensible first result. Metrics downsample to
 * `downsample.default_factor`; vectors use BBQ from `knn.bbq_default_min_dims` dimensions up, as Elasticsearch does.
 */
export function newWorkload(kind: WorkloadKind, taken: readonly string[] = [], c: ConstantSet = defaultConstants): WorkloadProfile {
  const id = uniqueName(KINDS[kind].label, taken);
  switch (kind) {
    case 'logs': return { id, kind, rawGbPerDay: 100, indexMode: 'logsdb', retentionDays: { hot: 7, frozen: 83 }, replicas: { hot: 1, warm: 1 } };
    case 'siem': return { id, kind, rawGbPerDay: 100, indexMode: 'logsdb', retentionDays: { hot: 30, frozen: 335 }, replicas: { hot: 1, warm: 1 } };
    case 'metrics': return { id, kind, rawGbPerDay: 50, indexMode: 'tsds', retentionDays: { hot: 7, frozen: 83 }, replicas: { hot: 1, warm: 1 }, downsampleFactor: { frozen: num(c, 'downsample.default_factor') } };
    case 'apm': return { id, kind, rawGbPerDay: 50, indexMode: 'standard', retentionDays: { hot: 7, frozen: 83 }, replicas: { hot: 1, warm: 1 } };
    case 'search': return { id, kind, totalGb: 500, retentionDays: {}, replicas: { content: 1 } };
    case 'vector': {
      const dims = 1024;
      return { id, kind, vector: { count: 10_000_000, dims, quant: dims >= num(c, 'knn.bbq_default_min_dims') ? 'bbq' : 'int8' }, retentionDays: {}, replicas: { content: 1 } };
    }
    case 'ml': return { id, kind, ml: { anomalyJobs: 10 }, retentionDays: {}, replicas: {} };
    case 'fleet': return { id, kind, fleet: { agents: 5000, defend: false }, retentionDays: {}, replicas: {} };
  }
}

/** Change index mode. Downsampling is TSDS-only, so leaving TSDS drops any downsample factors. */
export function withIndexMode(p: WorkloadProfile, indexMode: IndexMode): WorkloadProfile {
  if (indexMode === 'tsds' || !p.downsampleFactor) return { ...p, indexMode };
  const { downsampleFactor: _drop, ...rest } = p;
  return { ...rest, indexMode };
}

// ---- Deployment settings shared by both modes -----------------------------------------------------

export interface Deployment {
  model: DeploymentModel;
  sites: number;
  ccrMode: CcrMode;
  airGapped: boolean;
  autoOps: boolean;
  fips: boolean;
  fullLogsdb: boolean;
  concurrentSearch: boolean;
}

export function deploymentOfForward(o: ForwardOptions): Deployment {
  return {
    model: o.model, sites: o.sites ?? 1, ccrMode: o.ccrMode ?? 'none', airGapped: o.airGapped ?? false, autoOps: o.autoOps ?? false,
    fips: o.fips ?? false, fullLogsdb: o.fullLogsdb ?? false, concurrentSearch: o.concurrentSearch ?? false,
  };
}

export function withForwardDeployment(o: ForwardOptions, d: Deployment): ForwardOptions {
  return { ...o, ...d };
}

export function deploymentOfReverse(r: ReverseRequest): Deployment {
  const h = r.hardware;
  return {
    model: h.model, sites: h.sites ?? 1, ccrMode: h.ccr ? 'unidirectional' : 'none', airGapped: h.airGapped ?? false, autoOps: h.autoOps ?? false,
    fips: r.fips ?? false, fullLogsdb: r.fullLogsdb ?? false, concurrentSearch: r.concurrentSearch ?? false,
  };
}

export function withReverseDeployment(r: ReverseRequest, d: Deployment): ReverseRequest {
  return {
    ...r,
    fips: d.fips, fullLogsdb: d.fullLogsdb, concurrentSearch: d.concurrentSearch,
    hardware: { ...r.hardware, model: d.model, sites: d.sites, ccr: d.ccrMode !== 'none', airGapped: d.airGapped, autoOps: d.autoOps },
  };
}

/** Local disk a tier gets when the scenario does not choose one: NVMe where data is written, SSD elsewhere. */
export function defaultDiskType(tier: Tier): 'nvme' | 'ssd' {
  return tier === 'hot' || tier === 'content' ? 'nvme' : 'ssd';
}

// ---- Reverse helpers ------------------------------------------------------------------------------

export const GROUP_DEFAULTS: Record<NodeGroup['role'], Omit<NodeGroup, 'role'>> = {
  hot: { count: 3, ramGb: 64, diskGb: 3200, diskType: 'nvme', vcpu: 8 },
  warm: { count: 2, ramGb: 64, diskGb: 10240, diskType: 'ssd', vcpu: 8 },
  cold: { count: 2, ramGb: 64, diskGb: 10240, diskType: 'ssd', vcpu: 8 },
  frozen: { count: 2, ramGb: 64, diskGb: 1920, diskType: 'ssd', vcpu: 8 },
  content: { count: 3, ramGb: 64, diskGb: 1920, diskType: 'nvme', vcpu: 8 },
  master: { count: 3, ramGb: 16, diskGb: 100, diskType: 'ssd', vcpu: 2 },
  ml: { count: 2, ramGb: 64, diskGb: 200, diskType: 'ssd', vcpu: 8 },
  coordinating: { count: 2, ramGb: 32, diskGb: 100, diskType: 'ssd', vcpu: 4 },
  kibana: { count: 1, ramGb: 8, diskGb: 50, diskType: 'ssd', vcpu: 1 },
  fleet: { count: 2, ramGb: 8, diskGb: 50, diskType: 'ssd', vcpu: 8 },
  apm: { count: 2, ramGb: 8, diskGb: 50, diskType: 'ssd', vcpu: 1 },
};

/** With constants, a frozen group's disk follows `frozen_local_disk_ratio` (D27) so it matches forward sizing. */
/** A new node group. Data tiers get the disk their default mem:disk ratio calls for (D38: hot 64 × 50 = 3,200 GB). */
export function newGroup(role: NodeGroup['role'], c: ConstantSet = defaultConstants): NodeGroup {
  const g: NodeGroup = { role, ...GROUP_DEFAULTS[role] };
  if (role === 'frozen') g.diskGb = g.ramGb * num(c, 'frozen_local_disk_ratio');
  if (role === 'hot' || role === 'warm' || role === 'cold' || role === 'content') g.diskGb = g.ramGb * num(c, `mem_disk.${role}`);
  return g;
}

// ---- Automatic dedicated masters -------------------------------------------------------------------

const DATA_ROLES = new Set<string>(['hot', 'warm', 'cold', 'frozen', 'content']);

/** The `masters.sizing` row for this many data nodes (count 0 means masters run on the data nodes). */
export function masterRowFor(c: ConstantSet, dataNodes: number): MasterSizingRow {
  const rows = val<MasterSizingRow[]>(c, 'masters.sizing');
  return rows.reduce((acc, r) => (r.minDataNodes <= dataNodes ? r : acc), rows[0]!);
}

/**
 * Dedicated masters follow the `masters.sizing` threshold (the same table forward mode uses), but only on
 * the crossing. Going from below it to at or above it adds a master group when none is left; going back
 * below it removes the master groups, since masters then run on the data nodes. Edits that stay on one
 * side leave masters alone, so adding or deleting them by hand sticks. `canRemove` is false where master
 * servers are also the ECE control plane (Compare models, or Multiple sites on ECE).
 */
export function withAutoMasters<T extends { role: string; count: number }>(
  c: ConstantSet, prev: readonly T[], next: T[], dataNodes: (gs: readonly T[]) => number, make: (row: MasterSizingRow) => T,
  canRemove = true,
): { groups: T[]; added?: MasterSizingRow; removed?: number } {
  const wanted = masterRowFor(c, dataNodes(next)).count > 0;
  const had = masterRowFor(c, dataNodes(prev)).count > 0;
  const masters = next.filter((g) => g.role === 'master');
  if (wanted && !had && !masters.some((g) => g.count > 0)) {
    const row = masterRowFor(c, dataNodes(next));
    return { groups: [...next.filter((g) => g.role !== 'master'), make(row)], added: row };
  }
  if (canRemove && !wanted && had && masters.length > 0) {
    return { groups: next.filter((g) => g.role !== 'master'), removed: masters.reduce((s, g) => s + g.count, 0) };
  }
  return { groups: next };
}

/** Data nodes in a hardware table (Test hardware limits): one node per row count. */
export const dataNodesOfGroups = (gs: readonly NodeGroup[]) => gs.filter((g) => DATA_ROLES.has(g.role)).reduce((s, g) => s + g.count, 0);

/** Data nodes on physical servers: servers × nodes per server; an invalid typed layout counts one node. */
export function dataNodesOfServers(c: ConstantSet, gs: readonly ServerGroup[]): number {
  return gs.filter((g) => DATA_ROLES.has(g.role)).reduce((s, g) => {
    let per = 1;
    try { per = nodesPerServer(c, g); } catch { /* shown as an error on the row */ }
    return s + g.count * per;
  }, 0);
}

export function masterGroup(c: ConstantSet, row: MasterSizingRow): NodeGroup {
  return { ...GROUP_DEFAULTS.master, role: 'master', count: row.count, ramGb: row.ramGb, vcpu: row.ramGb * num(c, 'vcpu_per_ram_gb') };
}

export function masterServers(c: ConstantSet, row: MasterSizingRow): ServerGroup {
  return { role: 'master', count: row.count, ramGb: row.ramGb, diskGb: GROUP_DEFAULTS.master.diskGb, diskType: GROUP_DEFAULTS.master.diskType, vcpu: row.ramGb * num(c, 'vcpu_per_ram_gb') };
}

/** Keep the solved workload first, of a kind the question can use, and name it as the target. */
export function normalizeReverse(r: ReverseRequest): ReverseRequest {
  const kinds = SOLVE_KINDS[r.solve];
  if (kinds.length === 0) {
    const { targetProfileId: _drop, ...rest } = r;
    return rest;
  }
  let fixed = [...r.fixed];
  const byId = r.targetProfileId ? fixed.findIndex((p) => p.id === r.targetProfileId) : -1;
  if (byId > 0) fixed = [fixed[byId]!, ...fixed.filter((_, i) => i !== byId)];
  if (!fixed[0] || !kinds.includes(fixed[0].kind)) {
    const reuse = fixed.findIndex((p) => kinds.includes(p.kind));
    fixed = reuse >= 0
      ? [fixed[reuse]!, ...fixed.filter((_, i) => i !== reuse)]
      : [newWorkload(kinds[0]!, fixed.map((p) => p.id)), ...fixed];
  }
  const target = { ...fixed[0]! };
  // The solved quantity is an output; keep what the question needs as input.
  if ((r.solve === 'max_retention' || r.solve === 'years_to_capacity') && !target.rawGbPerDay) target.rawGbPerDay = 100;
  // A starting rate so the first answer is a date, not "never"; the card shows it for editing.
  if (r.solve === 'years_to_capacity' && target.growthPctPerYear === undefined) target.growthPctPerYear = 20;
  // Only the solved workload: capacity used by anything else is not an input any more.
  return { ...r, fixed: [target], targetProfileId: target.id };
}

export function withSolve(r: ReverseRequest, solve: Solve): ReverseRequest {
  let next: ReverseRequest = { ...r, solve };
  const roles = new Set(r.hardware.groups.map((g) => g.role));
  // Add the node group a hardware-only question depends on, so the first answer is not a bare zero.
  if (solve === 'max_agents' && !roles.has('fleet')) next = { ...next, hardware: { ...next.hardware, groups: [...next.hardware.groups, newGroup('fleet')] } };
  if (solve === 'max_ml_jobs' && !roles.has('ml')) next = { ...next, hardware: { ...next.hardware, groups: [...next.hardware.groups, newGroup('ml')] } };
  return normalizeReverse(next);
}

// ---- Defaults ---------------------------------------------------------------------------------------

export function defaultForward(): ForwardRequest {
  return { workloads: [{ ...newWorkload('logs'), rawGbPerDay: 500 }], options: { model: 'self_managed' } };
}

export function defaultReverse(): ReverseRequest {
  const target = { ...newWorkload('logs'), retentionDays: { hot: 30 } };
  delete (target as Partial<WorkloadProfile>).rawGbPerDay;
  return normalizeReverse({
    hardware: { model: 'self_managed', groups: [newGroup('hot')] }, fixed: [target], solve: 'max_gb_day',
  });
}

export function defaultState(): AppState {
  return { version: 2, name: 'Untitled scenario', mode: 'forward', forward: defaultForward(), reverse: defaultReverse() };
}

/** Tiers a forward request places data on, in display order. */
export function tiersInUse(req: ForwardRequest): Tier[] {
  const used = new Set<Tier>();
  for (const p of req.workloads) {
    for (const [t, d] of Object.entries(p.retentionDays) as [Tier, number][]) if (d > 0) used.add(t);
    if (p.totalGb || p.vector) used.add(p.tier ?? 'content');
  }
  return (['content', 'hot', 'warm', 'cold', 'frozen'] as Tier[]).filter((t) => used.has(t));
}

// ---- Multiple sites (D32) --------------------------------------------------------------------------

export interface MultiSiteState {
  relationship: SiteRelationship;
  /** Also compute the other two relationships side by side. */
  compare: boolean;
  /** One set of servers and workloads for every site. */
  identical: boolean;
  /** DR only: the site that ingests. */
  leader: number;
  /** When identical, sites[0] holds the servers and workloads used for every site; names still come from each entry. */
  sites: SiteInput[];
  options: ForwardOptions;
}

export const RELATIONSHIPS: { value: SiteRelationship; title: string; blurb: string }[] = [
  { value: 'independent', title: 'Independent', blurb: 'Each site keeps only its own data' },
  { value: 'dr', title: 'Disaster recovery', blurb: 'One site takes in data. Standby sites keep a copy and take over if it fails.' },
  { value: 'active_active', title: 'Active-active', blurb: 'Every site serves users and holds all the data' },
];

export function siteName(i: number): string {
  return `Site ${String.fromCharCode(65 + i)}`;
}

/** A 35-server site: 3 masters, 22 hot servers of 4 × 64 GB nodes, 8 frozen, 2 Kibana. Edit to the customer's layout. */
export function defaultServers(): ServerGroup[] {
  return [
    { role: 'master', count: 3, ramGb: 32, diskGb: 500, diskType: 'ssd', vcpu: 8 },
    { role: 'hot', count: 22, ramGb: 256, diskGb: 12800, diskType: 'nvme', vcpu: 64 }, // 256 × 50 (D38)
    { role: 'frozen', count: 8, ramGb: 128, diskGb: 7680, diskType: 'ssd', vcpu: 16 },
    { role: 'kibana', count: 2, ramGb: 32, diskGb: 200, diskType: 'ssd', vcpu: 8 },
  ];
}

export function defaultMultiSite(): MultiSiteState {
  const workloads = [{ ...newWorkload('logs'), rawGbPerDay: 2000, retentionDays: { hot: 30, frozen: 335 } }];
  return {
    relationship: 'independent', compare: true, identical: true, leader: 0,
    sites: [0, 1].map((i) => ({ name: siteName(i), workloads: i === 0 ? workloads : [], servers: i === 0 ? defaultServers() : [] })),
    options: { model: 'self_managed' },
  };
}

/**
 * The engine request for one relationship. Identical sites copy site 0's servers to every site; its
 * workloads go to every site, except in DR where only the primary ingests.
 */
export function topologyRequest(ms: MultiSiteState, relationship: SiteRelationship = ms.relationship): TopologyRequest {
  const template = ms.sites[0] ?? { name: siteName(0), workloads: [], servers: [] };
  const sites = ms.sites.map((s, i): SiteInput => {
    if (!ms.identical) return s;
    const ingests = relationship !== 'dr' || i === ms.leader;
    return { name: s.name, servers: template.servers, workloads: ingests ? template.workloads : [] };
  });
  const hostModel = (HOST_MODEL_VALUES as string[]).includes(ms.options.model) ? (ms.options.model as HostModel) : 'self_managed';
  return { relationship, sites, options: ms.options, leader: ms.leader, hostModel };
}

/** Add or remove sites, keeping existing ones. */
export function withSiteCount(ms: MultiSiteState, n: number): MultiSiteState {
  const count = Math.max(1, Math.min(8, Math.round(n)));
  const sites = Array.from({ length: count }, (_, i) => ms.sites[i] ?? { name: siteName(i), workloads: [], servers: [] });
  return { ...ms, sites, leader: Math.min(ms.leader, count - 1) };
}

// ---- Compare deployment models (D33) ----------------------------------------------------------------

export interface ModelsState {
  workloads: WorkloadProfile[];
  servers: ServerGroup[];
  options: ForwardOptions;
}

export const MODEL_NAMES: Record<HostModel, string> = { self_managed: 'Self-managed', eck: 'ECK (Kubernetes)', ece: 'ECE' };

export function defaultModels(): ModelsState {
  return {
    workloads: [{ ...newWorkload('logs'), rawGbPerDay: 2000, retentionDays: { hot: 30, frozen: 335 } }],
    servers: defaultServers(),
    options: { model: 'self_managed' },
  };
}

// ---- Deployment model selector per mode (D34) -----------------------------------------------------

/** Models that run on the customer's servers; the server-based modes size them directly. */
export const HOST_MODEL_VALUES: DeploymentModel[] = ['self_managed', 'eck', 'ece'];

/**
 * What the selector offers in each mode. Node-based modes (forward, reverse) size self-managed; choosing
 * ECK or ECE there opens Compare models, which needs servers. Server-based modes size all three.
 */
export function modelOptionsFor(mode: Mode): ModelOption[] {
  const cloud: ModelOption[] = [
    { value: 'ech', text: 'Elastic Cloud Hosted' },
    { value: 'serverless', text: 'Serverless (coming later)', disabled: true },
  ];
  if (mode === 'multisite' || mode === 'models') {
    return [
      { value: 'self_managed', text: 'Self-managed' },
      { value: 'eck', text: 'ECK (Kubernetes)' },
      { value: 'ece', text: 'ECE' },
      ...cloud.map((o) => ({ ...o, disabled: true, text: `${o.value === 'ech' ? 'Elastic Cloud Hosted' : 'Serverless'} (Elastic's cloud, not your servers)` })),
    ];
  }
  return [
    { value: 'self_managed', text: 'Self-managed' },
    { value: 'eck', text: 'ECK (Kubernetes): compare on your servers →' },
    { value: 'ece', text: 'ECE (private cloud): compare on your servers →' },
    ...cloud,
  ];
}

/**
 * D40/D43: Elastic Cloud Hosted picked in Where will it run?: Size a workload switches to the Elastic Cloud inputs. The first time, it starts
 * from the workloads it can carry over (logs and SIEM daily volume and retention); otherwise it keeps its own.
 */
export function redirectToEch(s: AppState, workloads: readonly WorkloadProfile[]): AppState {
  if (s.ech) return { ...s, mode: 'forward', sizeOn: 'ech' };
  const base = defaultEch();
  const items: EchItem[] = [];
  for (const w of workloads) {
    if (!w.rawGbPerDay) continue;
    const r = w.retentionDays;
    if (w.kind === 'logs') items.push({ ...newEchItem('logs', items.map((x) => x.name)), name: w.id, useCase: 'logs', req: { gbPerDay: w.rawGbPerDay, retentionDays: { ...r } } });
    if (w.kind === 'siem') {
      const totalDays = (r.hot ?? 0) + (r.warm ?? 0) + (r.cold ?? 0) + (r.frozen ?? 0);
      items.push({ ...newEchItem('siem', items.map((x) => x.name)), name: w.id, useCase: 'siem', req: { siemUseCase: 'enterprise', gbPerDay: w.rawGbPerDay, totalDays: Math.max(7, totalDays), logsdb: true, availability: 'high' } });
    }
  }
  return { ...s, mode: 'forward', sizeOn: 'ech', ech: { ...base, items: items.length ? items : base.items } };
}

/** ECK or ECE picked in a node-based mode: open Compare models with the same workloads and settings. */
export function redirectToModels(s: AppState, workloads: WorkloadProfile[], options: ForwardOptions): AppState {
  const base = s.models ?? defaultModels();
  return { ...s, mode: 'models', models: { ...base, workloads, options: { ...options, model: 'self_managed', sites: 1, ccrMode: 'none' } } };
}
