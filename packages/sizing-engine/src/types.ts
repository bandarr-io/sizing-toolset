// SPEC §7 data model, extended by docs/DECISIONS.md (D2, D8, D9, D18).

export type Tier = 'hot' | 'warm' | 'cold' | 'frozen' | 'content';
export const TIERS: readonly Tier[] = ['hot', 'warm', 'cold', 'frozen', 'content'];
export type DeploymentModel = 'self_managed' | 'eck' | 'ece' | 'ech' | 'serverless';
export type IndexMode = 'standard' | 'logsdb' | 'tsds';
export type Quant = 'float32' | 'int8' | 'int4' | 'bbq' | 'bbq_disk' | 'bfloat16';
export type DiskType = 'nvme' | 'ssd' | 'hdd' | 'object';
export type Confidence = 'high' | 'medium' | 'low';
export type WorkloadKind = 'logs' | 'metrics' | 'siem' | 'apm' | 'search' | 'vector' | 'ml' | 'fleet';
export type CcrMode = 'none' | 'unidirectional' | 'bidirectional';

export interface WorkloadProfile {
  id: string;
  kind: WorkloadKind;
  rawGbPerDay?: number;
  /** D9: fixed corpus size (search/content). Stored once, no retention multiplier. */
  totalGb?: number;
  /** Tier that holds `totalGb` and vectors. Default 'content'. */
  tier?: Tier;
  indexMode?: IndexMode;
  indexRatioOverride?: number;
  retentionDays: Partial<Record<Tier, number>>;
  replicas: Partial<Record<Tier, number>>;
  downsampleFactor?: Partial<Record<Tier, number>>;
  growthPctPerYear?: number;
  vector?: { count: number; dims: number; quant: Quant; hnswM?: number };
  ml?: { anomalyJobs: number; trainedModelsGb?: number };
  fleet?: { agents: number; defend: boolean };
  avgEventKb?: number;
  ingestPipelines?: boolean;
  airGapped?: boolean;
  /** D18 */
  rolloverDays?: number;
  primaryShards?: number;
}

export interface NodeGroup {
  role: Tier | 'master' | 'ml' | 'coordinating' | 'kibana' | 'fleet' | 'apm';
  count: number;
  ramGb: number;
  diskGb: number;
  diskType: DiskType;
  vcpu: number;
  heapGbOverride?: number;
}

export interface HardwareConfig {
  model: DeploymentModel;
  groups: NodeGroup[];
  sites?: number;
  ccr?: boolean;
  airGapped?: boolean;
  autoOps?: boolean;
}

/** D8: node template for one tier in forward mode. Omitted fields use constants. */
export interface NodeTemplate {
  ramGb?: number;
  /** Disk per node. Default: RAM × tier ratio (never the binding term). */
  diskGb?: number;
  vcpu?: number;
  diskType?: DiskType;
}

/** D8: scenario-level forward inputs that are not part of any one workload. */
export interface ForwardOptions {
  model: DeploymentModel;
  nodes?: Partial<Record<Tier, NodeTemplate>>;
  sites?: number;
  ccrMode?: CcrMode;
  airGapped?: boolean;
  autoOps?: boolean;
  fullLogsdb?: boolean;
  fips?: boolean;
  coordinatingNodes?: number;
  growthHorizonYears?: number;
  concurrentSearch?: boolean;
}

export interface ForwardRequest {
  workloads: WorkloadProfile[];
  options: ForwardOptions;
}

export type Solve = 'max_gb_day' | 'max_retention' | 'max_agents' | 'max_vectors' | 'max_shards' | 'max_ml_jobs' | 'years_to_capacity';

export interface ReverseRequest {
  hardware: HardwareConfig;
  fixed: WorkloadProfile[];
  solve: Solve;
  targetProfileId?: string;
  /** Tier whose retention is solved for `max_retention`. Default: first tier with retention. */
  targetTier?: Tier;
  fullLogsdb?: boolean;
  fips?: boolean;
  concurrentSearch?: boolean;
}

export type ConstraintName =
  | 'storage' | 'disk' | 'frozen' | 'heap_shards' | 'masters' | 'vector_offheap'
  | 'cpu_ingest' | 'query' | 'fleet' | 'ml';

export interface MathStep {
  label: string;
  expr: string;
  value: number;
  constantKeys: string[];
}

export interface Constraint {
  name: ConstraintName;
  tier?: Tier;
  capacity: number;
  demand?: number;
  maxValue?: number;
  /** demand / capacity (forward) or answer / maxValue (reverse). */
  utilization?: number;
  unit: string;
  confidence: Confidence;
  binding: boolean;
  rallyRequired?: boolean;
  math: MathStep[];
}

export interface Warning {
  id: string;
  severity: 'info' | 'warn' | 'error';
  message: string;
}

export interface TierResult {
  tier: Tier;
  nodes: number;
  ramGb: number;
  diskGb: number;
  vcpu: number;
  math: MathStep[];
}

export interface OverheadResult extends NodeGroup {
  countsTowardLicense: boolean;
  math: MathStep[];
}

export type LicenseTier = 'basic' | 'platinum' | 'enterprise';

export interface SizingResult {
  engineVersion: string;
  constantsHash: string;
  mode: 'forward' | 'reverse';
  /** Per site. */
  tiers: TierResult[];
  /** Per site. */
  overhead: OverheadResult[];
  /** Per site, counted components only (D3). */
  totalRamGb: number;
  totalRamMath: MathStep[];
  licenseUnits: { unit: 'ERU' | 'ECU_hr' | 'VCU'; value: number; math: MathStep[] };
  licenseFloor: LicenseTier;
  licenseFloorReasons: string[];
  /** D2: totals across all sites. */
  sites: number;
  allSites: { totalRamGb: number; licenseUnits: number };
  shards?: { total: number; perNonFrozenNode: number; indices: number; math: MathStep[] };
  constraints: Constraint[];
  warnings: Warning[];
  assumptions: string[];
  /** Reverse mode only. */
  answer?: {
    solve: Solve;
    value: number;
    unit: string;
    binding: ConstraintName;
    bindingTier?: Tier;
    confidence: Confidence;
    /** max_shards also reports data streams (D18). */
    dataStreams?: number;
  };
}
