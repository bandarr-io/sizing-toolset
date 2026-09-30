// Elastic Cloud Hosted (ECH) data, extracted from the internal "ECH Ballpark Estimator" spreadsheet by
// scripts/ech-import.mjs. The data holds internal pricing, so it is never committed (D40): the engine takes it
// as an argument and the web app loads it from a local file.

export type EchProvider = 'aws' | 'gcp' | 'azure';
export type EchTier = 'Standard' | 'Gold' | 'Platinum' | 'Enterprise';
export type EchChannel = 'Elastic Direct' | 'AWS MP' | 'GCP MP' | 'AZURE MP';
export type EchSkuType = 'data_hot' | 'data_warm' | 'data_cold' | 'data_frozen' | 'master' | 'coordinating' | 'ml' | 'kibana' | 'apm' | string;

/** One instance configuration (Specs!A:Q). */
export interface EchSku {
  id: string;
  provider: EchProvider;
  /** Specs col C; a trailing `*` marks a variant. */
  type: EchSkuType;
  /** Largest node RAM per zone (col D). */
  sellableRamGb: number;
  vcpu: number;
  /** GB of disk per GB of RAM (col F). */
  ramDisk: number;
  /** Col I: the SKU is not offered in a region whose display name appears in this text. */
  excludedRegions: string;
  /** Col J: max ingest per day per GB of RAM, GB/day. */
  ingestPerGbRamPerDay: number;
  /** Specs col O, e.g. Hot_in_Production, CPU Optimized, Vector Search. */
  status?: string;
  /** Specs col Q, e.g. Hot_in_Production: the role this instance is offered for in default lists. */
  selection?: string;
  /** Allowed per-zone node sizes, ascending (SpecsIncrements). */
  increments: number[];
}

/** $/GB of RAM per hour, by price column. Missing = not sold. */
export interface EchPrice {
  direct?: number;
  awsMp?: number;
  gcpMp?: number;
  azureMp?: number;
}

export interface EchRegion {
  provider: EchProvider;
  /** Display name used as the price key, e.g. "AWS-us-east-1 (N. Virginia)". */
  name: string;
  status: string;
}

export type EchDtsItem = 'Data inter-node' | 'Data out' | 'Snapshot storage' | 'Storage api';

export interface EchData {
  source: { file: string; version: string; extractedAt: string };
  skus: EchSku[];
  /** Key `${sku}|${region}|${tier}`. */
  prices: Record<string, EchPrice>;
  regions: EchRegion[];
  /** Ref!B18:D38: which tiers each channel sells on each provider. */
  channelTiers: { channel: EchChannel; tier: EchTier; provider: string }[];
  /** Ref!B157:E180: unit prices ($/GB, $/GB-month, $/1K calls) by provider, item and channel. */
  dts: { provider: string; item: EchDtsItem; channel: string; price: number }[];
  /** Region-specific overrides hardcoded in Logs!I73:I74 (FedRAMP High data out and snapshot storage). */
  dtsOverrides: { provider: string; region: string; item: EchDtsItem; price: number }[];
  /** Default instance per role, per provider, from the spreadsheet's own selections (Logs!E24:E34). */
  defaults: Partial<Record<EchProvider, Partial<Record<EchRole, string>>>>;
  /** Metrics!H321:K350: hot-tier ingest benchmark (datapoints/s for one node). */
  metricsBenchmark: { sku: string; eps: number; vcpu: number; ramGb: number }[];
  /** Use-case specific tables from scripts/ech-import/<name>.mjs, typed by each use case's engine module. */
  extras?: Partial<Record<'security' | 'apm' | 'search', unknown>>;
}

export type EchRole = 'hot' | 'warm' | 'cold' | 'frozen' | 'master' | 'coordinating' | 'ml' | 'kibana';

export type EchUseCase = 'logs' | 'metrics' | 'siem' | 'endpoint' | 'apm' | 'search' | 'vector';

export interface EchLine {
  /** Data tier (hot, warm, cold, frozen), node role (master, coordinating, ml, kibana, apm, ...), 'transfer' or 'storage'. */
  key: string;
  label: string;
  sku?: string;
  /** Priced RAM across all zones. */
  ramGb?: number;
  nodesPerZone?: number;
  nodeSizeGb?: number;
  zones?: number;
  diskGb?: number;
  /** Frozen: snapshot (blob) data in object storage behind the local cache, GB. */
  blobGb?: number;
  constraint?: 'disk' | 'cpu';
  monthlyPerGb?: number;
  annual: number;
  annualRounded: number;
  math: import('../types.ts').MathStep[];
  /** The spreadsheet shows "#NA" for this line and leaves it out of the total. */
  error?: string;
}

export interface EchResult {
  kind: EchUseCase;
  /** GB ingested per day, where the use case has one. */
  dailyGb: number;
  lines: EchLine[];
  total: number;
  /** Sum of the lines rounded up to $1,000 (the spreadsheet's J42). */
  totalRounded: number;
  y1Spend: number;
  y1SpendRounded: number;
  warnings: string[];
  source: EchData['source'];
  /** Extra figures a use case reports (for example SIEM events/s or vector counts), label → value. */
  facts?: { label: string; value: number; unit: string }[];
}


export const priceKey = (sku: string, region: string, tier: string) => `${sku}|${region}|${tier}`;
