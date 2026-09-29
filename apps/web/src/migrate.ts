import type { ForwardRequest, NodeGroup, ReverseRequest, Tier, WorkloadProfile } from '@sizing/engine';
import { normalizeReverse, type AppState } from './state.ts';

// Scenario format v1 (fast/expert split). Kept only to read saved scenarios and exports.
type UseCaseV1 = 'logs' | 'siem' | 'metrics' | 'apm' | 'search';
interface FastForwardV1 { useCase: UseCaseV1; gbPerDay: number; hotDays: number; totalRetentionDays: number; replicas: number; model: ForwardRequest['options']['model'] }
interface FastReverseV1 {
  useCase: Exclude<UseCaseV1, 'search'>; nodes: number; ramGb: number; diskGb: number; vcpu: number; hotDays: number; replicas: number;
  solve: 'max_gb_day' | 'max_retention'; gbPerDay: number; model: ForwardRequest['options']['model'];
}
interface AppStateV1 {
  version: 1; name: string; mode: 'forward' | 'reverse'; inputMode: 'fast' | 'expert';
  fastForward: FastForwardV1; fastReverse: FastReverseV1; expertForward: ForwardRequest; expertReverse: ReverseRequest;
}

const DOWNSAMPLE_DEFAULT = 0.1;

/** D13: v1 fast mode sent retention past hot to frozen (logs, SIEM) or warm (metrics, APM). */
export function fastForwardV1ToRequest(f: FastForwardV1): ForwardRequest {
  const options = { model: f.model };
  if (f.useCase === 'search') {
    return { workloads: [{ id: 'Search', kind: 'search', totalGb: f.gbPerDay, retentionDays: {}, replicas: { content: f.replicas } }], options };
  }
  const rest = Math.max(0, f.totalRetentionDays - f.hotDays);
  const tier: Tier = f.useCase === 'logs' || f.useCase === 'siem' ? 'frozen' : 'warm';
  const retentionDays: Partial<Record<Tier, number>> = { hot: f.hotDays };
  if (rest > 0) retentionDays[tier] = rest;
  const profile: WorkloadProfile = { id: f.useCase, kind: f.useCase, rawGbPerDay: f.gbPerDay, retentionDays, replicas: { hot: f.replicas, warm: f.replicas } };
  if (f.useCase === 'metrics' && rest > 0) profile.downsampleFactor = { [tier]: DOWNSAMPLE_DEFAULT };
  return { workloads: [profile], options };
}

function fastReverseV1ToRequest(f: FastReverseV1): ReverseRequest {
  const group: NodeGroup = { role: 'hot', count: f.nodes, ramGb: f.ramGb, diskGb: f.diskGb, diskType: 'nvme', vcpu: f.vcpu };
  const profile: WorkloadProfile = {
    id: f.useCase, kind: f.useCase, retentionDays: { hot: f.hotDays }, replicas: { hot: f.replicas },
    ...(f.solve === 'max_retention' ? { rawGbPerDay: f.gbPerDay } : {}),
  };
  return { hardware: { model: f.model, groups: [group] }, fixed: [profile], solve: f.solve };
}

function isV2(x: Partial<AppState>): x is AppState {
  return x.version === 2 && !!x.forward?.workloads && !!x.forward.options && !!x.reverse?.hardware && Array.isArray(x.reverse.fixed);
}

function isV1(x: Partial<AppStateV1>): x is AppStateV1 {
  return x.version === 1 && !!x.fastForward && !!x.fastReverse && !!x.expertForward && !!x.expertReverse;
}

/** D26: 'object' was once offered as a node disk type. Nodes use local disk; object storage is separate. */
function localDisksOnly(s: AppState): AppState {
  const fix = <T extends { diskType?: string }>(n: T): T => (n.diskType === 'object' ? { ...n, diskType: 'ssd' } : n);
  const nodes = s.forward.options.nodes;
  return {
    ...s,
    forward: nodes
      ? { ...s.forward, options: { ...s.forward.options, nodes: Object.fromEntries(Object.entries(nodes).map(([t, n]) => [t, n ? fix(n) : n])) } }
      : s.forward,
    reverse: { ...s.reverse, hardware: { ...s.reverse.hardware, groups: s.reverse.hardware.groups.map(fix) } },
  };
}

/**
 * D35: the "Full LogsDB capabilities" switch was removed. Drop the flag from older scenarios so it cannot
 * keep raising the license floor with no control left to turn it off.
 */
function withoutFullLogsdb(s: AppState): AppState {
  const strip = <T extends { fullLogsdb?: boolean }>(o: T): T => {
    if (o.fullLogsdb === undefined) return o;
    const { fullLogsdb: _drop, ...rest } = o;
    return rest as T;
  };
  return {
    ...s,
    forward: { ...s.forward, options: strip(s.forward.options) },
    reverse: strip(s.reverse),
    ...(s.multisite ? { multisite: { ...s.multisite, options: strip(s.multisite.options) } } : {}),
    ...(s.models ? { models: { ...s.models, options: strip(s.models.options) } } : {}),
  };
}

/** Any saved or exported scenario → current format, or undefined if it is not a scenario. */
export function migrate(x: unknown): AppState | undefined {
  if (!x || typeof x !== 'object') return undefined;
  if (isV2(x as Partial<AppState>)) {
    const raw = x as AppState;
    // D43: the Elastic Cloud mode became a choice inside Size a workload.
    const unified: AppState = (raw.mode as string) === 'ech' ? { ...raw, mode: 'forward', sizeOn: 'ech' } : raw;
    const s = withoutFullLogsdb(localDisksOnly(unified));
    // "Already running on this cluster" was removed: drop saved extra workloads so they cannot use capacity unseen.
    return { ...s, reverse: normalizeReverse(s.reverse) };
  }
  const v1 = x as Partial<AppStateV1>;
  if (!isV1(v1)) return undefined;
  const fast = v1.inputMode === 'fast';
  return {
    version: 2,
    name: v1.name,
    mode: v1.mode,
    forward: fast ? fastForwardV1ToRequest(v1.fastForward) : v1.expertForward,
    reverse: normalizeReverse(fast ? fastReverseV1ToRequest(v1.fastReverse) : v1.expertReverse),
  };
}
