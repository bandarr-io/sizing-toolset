import { defaultConstants, num } from '@sizing/constants';
import type {
  DeploymentModel, ForwardRequest, NodeGroup, ReverseRequest, Solve, Tier, WorkloadProfile,
} from '@sizing/engine';

export type Mode = 'forward' | 'reverse';
export type InputMode = 'fast' | 'expert';
export type UseCase = 'logs' | 'siem' | 'metrics' | 'apm' | 'search';

/** SPEC §10 fast mode: 6 inputs with smart defaults. */
export interface FastForward {
  useCase: UseCase;
  /** GB/day, or corpus GB for search. */
  gbPerDay: number;
  hotDays: number;
  totalRetentionDays: number;
  replicas: number;
  model: DeploymentModel;
}

export interface FastReverse {
  useCase: Exclude<UseCase, 'search'>;
  nodes: number;
  ramGb: number;
  diskGb: number;
  vcpu: number;
  hotDays: number;
  replicas: number;
  solve: Extract<Solve, 'max_gb_day' | 'max_retention'>;
  /** Used when solving for retention. */
  gbPerDay: number;
  model: DeploymentModel;
}

export interface AppState {
  version: 1;
  name: string;
  mode: Mode;
  inputMode: InputMode;
  fastForward: FastForward;
  fastReverse: FastReverse;
  expertForward: ForwardRequest;
  expertReverse: ReverseRequest;
  /** True once the expert inputs were edited by hand; switching from fast then keeps them. */
  expertDirty: boolean;
}

export const USE_CASES: { value: UseCase; text: string }[] = [
  { value: 'logs', text: 'Logs' },
  { value: 'siem', text: 'Security / SIEM' },
  { value: 'metrics', text: 'Metrics' },
  { value: 'apm', text: 'APM / traces' },
  { value: 'search', text: 'Search / content' },
];

export const MODELS: { value: DeploymentModel; text: string; disabled?: boolean }[] = [
  { value: 'self_managed', text: 'Self-managed' },
  { value: 'eck', text: 'ECK (v2)', disabled: true },
  { value: 'ece', text: 'ECE (v2)', disabled: true },
  { value: 'ech', text: 'Elastic Cloud Hosted (v2)', disabled: true },
  { value: 'serverless', text: 'Serverless (v2)', disabled: true },
];

/** D13: retention past hot goes to frozen for logs and SIEM, to warm for metrics and APM. */
export function remainderTier(useCase: UseCase): Tier | undefined {
  if (useCase === 'logs' || useCase === 'siem') return 'frozen';
  if (useCase === 'metrics' || useCase === 'apm') return 'warm';
  return undefined;
}

export function fastToForward(f: FastForward): ForwardRequest {
  const options = { model: f.model };
  if (f.useCase === 'search') {
    return {
      workloads: [{ id: 'search', kind: 'search', totalGb: f.gbPerDay, retentionDays: {}, replicas: { content: f.replicas } }],
      options,
    };
  }
  const rest = Math.max(0, f.totalRetentionDays - f.hotDays);
  const tier = remainderTier(f.useCase)!;
  const retentionDays: Partial<Record<Tier, number>> = { hot: f.hotDays };
  if (rest > 0) retentionDays[tier] = rest;
  const profile: WorkloadProfile = {
    id: f.useCase, kind: f.useCase, rawGbPerDay: f.gbPerDay, retentionDays,
    replicas: { hot: f.replicas, warm: f.replicas },
  };
  if (f.useCase === 'metrics' && rest > 0) {
    profile.downsampleFactor = { [tier]: num(defaultConstants, 'downsample.default_factor') };
  }
  return { workloads: [profile], options };
}

export function fastToReverse(f: FastReverse): ReverseRequest {
  const group: NodeGroup = { role: 'hot', count: f.nodes, ramGb: f.ramGb, diskGb: f.diskGb, diskType: 'nvme', vcpu: f.vcpu };
  const profile: WorkloadProfile = {
    id: f.useCase, kind: f.useCase, retentionDays: { hot: f.hotDays }, replicas: { hot: f.replicas },
    ...(f.solve === 'max_retention' ? { rawGbPerDay: f.gbPerDay } : {}),
  };
  return { hardware: { model: f.model, groups: [group] }, fixed: [profile], solve: f.solve };
}

export function forwardRequest(s: AppState): ForwardRequest {
  return s.inputMode === 'fast' ? fastToForward(s.fastForward) : s.expertForward;
}

export function reverseRequest(s: AppState): ReverseRequest {
  return s.inputMode === 'fast' ? fastToReverse(s.fastReverse) : s.expertReverse;
}

/** Switching fast → expert seeds the expert inputs unless they were edited by hand. */
export function switchInputMode(s: AppState, next: InputMode): AppState {
  if (next === s.inputMode) return s;
  if (next === 'expert' && !s.expertDirty) {
    return { ...s, inputMode: next, expertForward: fastToForward(s.fastForward), expertReverse: fastToReverse(s.fastReverse) };
  }
  return { ...s, inputMode: next };
}

export function defaultState(): AppState {
  const fastForward: FastForward = { useCase: 'logs', gbPerDay: 500, hotDays: 7, totalRetentionDays: 90, replicas: 1, model: 'self_managed' };
  const fastReverse: FastReverse = {
    useCase: 'logs', nodes: 3, ramGb: 64, diskGb: 1920, vcpu: 8, hotDays: 30, replicas: 1, solve: 'max_gb_day', gbPerDay: 100, model: 'self_managed',
  };
  return {
    version: 1, name: 'Untitled scenario', mode: 'forward', inputMode: 'fast',
    fastForward, fastReverse,
    expertForward: fastToForward(fastForward), expertReverse: fastToReverse(fastReverse), expertDirty: false,
  };
}

let counter = 0;
/** Unique-enough workload IDs for the editor (UI only; the engine never generates IDs). */
export function newId(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}
