import { num, type ConstantSet } from '@sizing/constants';
import type { CostSettings } from './cost.ts';
import type {
  CcrMode, DeploymentModel, ForwardOptions, ForwardRequest, IndexMode, NodeGroup, ReverseRequest, Solve, Tier, WorkloadKind, WorkloadProfile,
} from '@sizing/engine';

export type Mode = 'forward' | 'reverse';

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
}

export const MODELS: { value: DeploymentModel; text: string; disabled?: boolean }[] = [
  { value: 'self_managed', text: 'Self-managed' },
  { value: 'eck', text: 'ECK (coming in v2)', disabled: true },
  { value: 'ece', text: 'ECE (coming in v2)', disabled: true },
  { value: 'ech', text: 'Elastic Cloud Hosted (coming in v2)', disabled: true },
  { value: 'serverless', text: 'Serverless (coming in v2)', disabled: true },
];

export interface KindMeta { label: string; icon: string; blurb: string; stream: boolean }

export const KINDS: Record<WorkloadKind, KindMeta> = {
  logs: { label: 'Logs', icon: 'logoLogging', blurb: 'Application and infrastructure logs', stream: true },
  siem: { label: 'Security', icon: 'logoSecurity', blurb: 'SIEM and security analytics', stream: true },
  metrics: { label: 'Metrics', icon: 'logoMetrics', blurb: 'Time series metrics (TSDS)', stream: true },
  apm: { label: 'APM', icon: 'apmApp', blurb: 'Traces and APM events', stream: true },
  search: { label: 'Search', icon: 'logoEnterpriseSearch', blurb: 'Fixed content corpus', stream: false },
  vector: { label: 'Vectors', icon: 'logoVectorDB', blurb: 'Dense vectors for kNN search', stream: false },
  ml: { label: 'Machine learning', icon: 'machineLearningApp', blurb: 'Anomaly detection jobs, models', stream: false },
  fleet: { label: 'Fleet agents', icon: 'fleetApp', blurb: 'Elastic Agents managed by Fleet', stream: false },
};

export const KIND_ORDER: WorkloadKind[] = ['logs', 'siem', 'metrics', 'apm', 'search', 'vector', 'ml', 'fleet'];

export const SOLVES: { value: Solve; title: string; blurb: string; icon: string }[] = [
  { value: 'max_gb_day', title: 'Max daily ingest', blurb: 'GB/day this hardware can retain', icon: 'storage' },
  { value: 'max_retention', title: 'Max retention', blurb: 'Days of data at a given ingest', icon: 'clock' },
  { value: 'years_to_capacity', title: 'Years until full', blurb: 'When growth outgrows this hardware', icon: 'timeline' },
  { value: 'max_agents', title: 'Max Elastic Agents', blurb: 'Fleet Server and hot-tier limits', icon: 'fleetApp' },
  { value: 'max_vectors', title: 'Max vectors', blurb: 'Off-heap memory and disk limits', icon: 'logoVectorDB' },
  { value: 'max_shards', title: 'Max shards', blurb: 'Shards and data streams', icon: 'indexManagementApp' },
  { value: 'max_ml_jobs', title: 'Max ML jobs', blurb: 'Anomaly detection capacity', icon: 'machineLearningApp' },
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

/** A new workload with defaults that produce a sensible first result. */
export function newWorkload(kind: WorkloadKind, taken: readonly string[] = []): WorkloadProfile {
  const id = uniqueName(KINDS[kind].label, taken);
  switch (kind) {
    case 'logs': return { id, kind, rawGbPerDay: 100, indexMode: 'logsdb', retentionDays: { hot: 7, frozen: 83 }, replicas: { hot: 1, warm: 1 } };
    case 'siem': return { id, kind, rawGbPerDay: 100, indexMode: 'logsdb', retentionDays: { hot: 30, frozen: 335 }, replicas: { hot: 1, warm: 1 } };
    case 'metrics': return { id, kind, rawGbPerDay: 50, indexMode: 'tsds', retentionDays: { hot: 7, frozen: 83 }, replicas: { hot: 1, warm: 1 }, downsampleFactor: { frozen: 0.1 } };
    case 'apm': return { id, kind, rawGbPerDay: 50, indexMode: 'standard', retentionDays: { hot: 7, frozen: 83 }, replicas: { hot: 1, warm: 1 } };
    case 'search': return { id, kind, totalGb: 500, retentionDays: {}, replicas: { content: 1 } };
    case 'vector': return { id, kind, vector: { count: 10_000_000, dims: 1024, quant: 'bbq' }, retentionDays: {}, replicas: { content: 1 } };
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
  hot: { count: 3, ramGb: 64, diskGb: 1920, diskType: 'nvme', vcpu: 8 },
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
export function newGroup(role: NodeGroup['role'], c?: ConstantSet): NodeGroup {
  const g: NodeGroup = { role, ...GROUP_DEFAULTS[role] };
  if (role === 'frozen' && c) g.diskGb = g.ramGb * num(c, 'frozen_local_disk_ratio');
  return g;
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
  fixed[0] = target;
  return { ...r, fixed, targetProfileId: target.id };
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
  return (['hot', 'warm', 'cold', 'frozen', 'content'] as Tier[]).filter((t) => used.has(t));
}
