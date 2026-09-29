import { num, val, type ConstantSet, type VectorBytes, type BbqDiskParams } from '@sizing/constants';
import type { IndexMode, Quant, Tier, WorkloadProfile } from './types.ts';

export function defaultIndexMode(p: WorkloadProfile): IndexMode {
  if (p.indexMode) return p.indexMode;
  if (p.kind === 'logs' || p.kind === 'siem') return 'logsdb';
  if (p.kind === 'metrics') return 'tsds';
  return 'standard';
}

export function indexRatio(c: ConstantSet, p: WorkloadProfile): { value: number; keys: string[]; label: string } {
  if (p.indexRatioOverride !== undefined) return { value: p.indexRatioOverride, keys: [], label: 'index ratio (override)' };
  const mode = defaultIndexMode(p);
  const key = `index_ratio.${mode}`;
  return { value: num(c, key), keys: [key], label: `index ratio (${mode})` };
}

/** SPEC §5.1: cold and frozen carry no replicas. */
export function replicasFor(p: WorkloadProfile, tier: Tier): number {
  if (tier === 'cold' || tier === 'frozen') return 0;
  return p.replicas[tier] ?? 1;
}

/**
 * Why a workload's downsample factor on `tier` is invalid, or undefined when it is fine.
 * The factor is the share of data kept (1 = no downsampling). Elasticsearch only downsamples
 * time series data streams, so any factor other than 1 requires TSDS index mode. A factor of 0
 * would size the tier at zero (forward drops it, reverse divides by it).
 */
export function downsampleProblem(p: WorkloadProfile, tier: Tier): string | undefined {
  const f = p.downsampleFactor?.[tier];
  if (f === undefined) return undefined;
  if (!(f > 0 && f <= 1)) return `[${p.id}] ${tier}: downsample factor must be greater than 0 and at most 1 (1 = no downsampling); got ${f}.`;
  if (f !== 1 && defaultIndexMode(p) !== 'tsds') {
    return `[${p.id}] ${tier}: downsampling only applies to TSDS (time series) index mode; this workload uses ${defaultIndexMode(p)}. Remove the factor or switch to TSDS.`;
  }
  return undefined;
}

/** Share of data kept on `tier` after downsampling. Throws on invalid input (see downsampleProblem). */
export function downsampleFor(p: WorkloadProfile, tier: Tier): number {
  const problem = downsampleProblem(p, tier);
  if (problem) throw new Error(problem);
  return p.downsampleFactor?.[tier] ?? 1;
}

/** D15: GB/day × (1 + growth)^years. */
export function growthFactor(p: WorkloadProfile, years: number): number {
  const g = p.growthPctPerYear ?? 0;
  return g === 0 || years === 0 ? 1 : (1 + g / 100) ** years;
}

export function retentionTiers(p: WorkloadProfile): Tier[] {
  return (Object.entries(p.retentionDays) as [Tier, number][]).filter(([, d]) => d > 0).map(([t]) => t);
}

/** Tier that holds a fixed corpus or vectors. */
export function placementTier(p: WorkloadProfile): Tier {
  return p.tier ?? 'content';
}

export function memDiskKey(tier: Tier): string {
  return `mem_disk.${tier}`;
}

export type RatioOverrides = Partial<Record<Tier, number>>;

/** D25: the tier's mem:disk ratio, from the scenario override when set, else constants. */
export function tierRatio(c: ConstantSet, tier: Tier, overrides?: RatioOverrides): { value: number; keys: string[]; overridden: boolean } {
  const o = overrides?.[tier];
  if (o === undefined) return { value: num(c, memDiskKey(tier)), keys: [memDiskKey(tier)], overridden: false };
  if (!(o > 0 && Number.isFinite(o))) throw new Error(`${tier} mem:disk ratio must be greater than 0; got ${o}.`);
  return { value: o, keys: [], overridden: true };
}

/** D27: share of frozen data held in local cache, from the scenario when set, else constants. */
export function frozenCacheFraction(c: ConstantSet, override?: number): number {
  if (override === undefined) return num(c, 'frozen_cache_fraction');
  if (!(override > 0 && override <= 1)) throw new Error(`Frozen cache fraction must be above 0 and at most 1; got ${override}.`);
  return override;
}

export function describeOverrides(overrides: RatioOverrides): string | undefined {
  const parts = (Object.entries(overrides) as [Tier, number][]).filter(([, v]) => v !== undefined).map(([t, v]) => `${t} 1:${v}`);
  return parts.length ? `Scenario mem:disk ratio overrides: ${parts.join(', ')}.` : undefined;
}

export function heapGb(c: ConstantSet, ramGb: number, override?: number): number {
  return override ?? Math.min(num(c, 'heap_fraction') * ramGb, num(c, 'heap_cap_gb'));
}

/** SPEC §5.1: RAM − heap − reserve. */
export function offheapBudgetGb(c: ConstantSet, ramGb: number, heapOverride?: number): number {
  return Math.max(0, ramGb - heapGb(c, ramGb, heapOverride) - num(c, 'offheap_reserve_gb'));
}

export interface VectorCost {
  /** Off-heap (filesystem cache) bytes per vector copy, including the HNSW graph. */
  offheapBytes: number;
  /** Disk bytes per vector copy (raw floats kept for rescoring, plus quantized structures). */
  diskBytes: number;
  expr: string;
  keys: string[];
}

/** SPEC §5.4 and D16/D17. */
export function vectorCost(c: ConstantSet, dims: number, quant: Quant, hnswM?: number): VectorCost {
  const m = hnswM ?? num(c, 'knn.hnsw_m');
  const link = num(c, 'knn.hnsw_bytes_per_link');
  const raw = 4 * dims;
  if (quant === 'bbq_disk') {
    const b = val<BbqDiskParams>(c, 'knn.bbq_disk');
    const centroid = (b.centroidBytesPerDim * dims + b.centroidFixed) / b.vectorsPerCluster;
    const quantized = (b.quantPerDim * dims + b.quantFixed) * b.quantCopies;
    return {
      offheapBytes: centroid + quantized,
      diskBytes: raw + centroid + quantized,
      expr: `(${b.centroidBytesPerDim}d + ${b.centroidFixed}) / ${b.vectorsPerCluster} + (d/8 + ${b.quantFixed}) × ${b.quantCopies}`,
      keys: ['knn.bbq_disk'],
    };
  }
  const key = `knn.bytes.${quant}`;
  const bytes = val<VectorBytes>(c, key);
  const quantBytes = bytes.perDim * dims + bytes.fixed;
  const graph = link * m;
  const overheadKey = `knn.raw_disk_overhead.${quant}`;
  const rawOnDisk = quant === 'float32' ? 0 : quant === 'bfloat16' ? 0 : raw * num(c, overheadKey);
  const keys = [key, 'knn.hnsw_bytes_per_link', ...(hnswM === undefined ? ['knn.hnsw_m'] : [])];
  if (rawOnDisk > 0) keys.push(overheadKey);
  return {
    offheapBytes: quantBytes + graph,
    diskBytes: (quant === 'bfloat16' ? quantBytes : Math.max(raw, quantBytes)) + rawOnDisk + graph,
    expr: `${bytes.perDim}·d + ${bytes.fixed} + ${link}·m`,
    keys,
  };
}

/** Settings behind the storage overhead: disk kept free below the watermark, plus a safety margin (SPEC §5.1). */
export const OVERHEAD_KEYS = ['storage.watermark_headroom', 'storage.margin'];

/** Storage overhead = 1 + watermark headroom + margin (1.25 by default), rounded to cancel floating-point noise. */
export function storageOverhead(c: ConstantSet): number {
  return Math.round((1 + num(c, 'storage.watermark_headroom') + num(c, 'storage.margin')) * 1e9) / 1e9;
}
