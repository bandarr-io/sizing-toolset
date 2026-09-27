import { num, type ConstantSet } from '@sizing/constants';
import { fmt, step } from './math.ts';
import {
  downsampleFor, growthFactor, indexRatio, placementTier, replicasFor, retentionTiers, vectorCost,
} from './profiles.ts';
import type { MathStep, Tier, WorkloadProfile } from './types.ts';

/** Demand on one tier before storage overhead and node rounding. */
export interface TierDemand {
  tier: Tier;
  /** Non-frozen: indexed × days × (replicas + 1), summed over profiles. Frozen: indexed × days (object store). */
  dataGb: number;
  /** Vector off-heap (filesystem cache) GB including replicas. */
  offheapGb: number;
  math: MathStep[];
}

export interface DemandOptions {
  growthYears: number;
  /** Constant keys behind growthYears; empty when the scenario set its own horizon. */
  growthKeys?: string[];
  /** D2: bidirectional CCR multiplies each site's data by the number of sites. */
  ccrMultiplier: number;
}

export function emptyDemand(tier: Tier): TierDemand {
  return { tier, dataGb: 0, offheapGb: 0, math: [] };
}

/** SPEC §5.1 `indexed_GB_day` and `total_data_GB` per tier, for every profile. */
export function computeDemand(
  c: ConstantSet, profiles: readonly WorkloadProfile[], opts: DemandOptions,
): Map<Tier, TierDemand> {
  const out = new Map<Tier, TierDemand>();
  const get = (t: Tier) => {
    let d = out.get(t);
    if (!d) { d = emptyDemand(t); out.set(t, d); }
    return d;
  };

  for (const p of profiles) {
    const ratio = indexRatio(c, p);
    const growth = growthFactor(p, opts.growthYears);

    if (p.rawGbPerDay !== undefined && p.rawGbPerDay > 0) {
      const gbDay = p.rawGbPerDay * growth;
      for (const tier of retentionTiers(p)) {
        const days = p.retentionDays[tier]!;
        const ds = downsampleFor(p, tier);
        const indexed = gbDay * ratio.value * ds;
        const d = get(tier);
        const tag = `[${p.id}]`;
        if (growth !== 1) {
          d.math.push(step(`${tag} GB/day after growth`, `${fmt(p.rawGbPerDay)} × (1 + ${fmt(p.growthPctPerYear ?? 0)}%)^${fmt(opts.growthYears)}`, gbDay, opts.growthKeys ?? []));
        }
        d.math.push(step(`${tag} indexed GB/day`, `${fmt(gbDay)} × ${fmt(ratio.value)} (${ratio.label})${ds !== 1 ? ` × ${fmt(ds)} downsample` : ''}`, indexed, ratio.keys));
        if (tier === 'frozen') {
          const gb = indexed * days * opts.ccrMultiplier;
          d.dataGb += gb;
          d.math.push(step(`${tag} frozen data GB (object store, no replicas)`, `${fmt(indexed)} × ${fmt(days)} days${opts.ccrMultiplier !== 1 ? ` × ${opts.ccrMultiplier} sites (bidirectional CCR)` : ''}`, gb, []));
        } else {
          const rep = replicasFor(p, tier);
          const gb = indexed * days * (rep + 1) * opts.ccrMultiplier;
          d.dataGb += gb;
          d.math.push(step(`${tag} total data GB`, `${fmt(indexed)} × ${fmt(days)} days × (${rep} replicas + 1)${opts.ccrMultiplier !== 1 ? ` × ${opts.ccrMultiplier} sites (bidirectional CCR)` : ''}`, gb, []));
        }
      }
    }

    if (p.totalGb !== undefined && p.totalGb > 0) {
      const tier = placementTier(p);
      const rep = replicasFor(p, tier);
      const gb = p.totalGb * growth * ratio.value * (rep + 1) * opts.ccrMultiplier;
      const d = get(tier);
      d.dataGb += gb;
      d.math.push(step(`[${p.id}] total data GB (fixed corpus)`, `${fmt(p.totalGb * growth)} × ${fmt(ratio.value)} (${ratio.label}) × (${rep} replicas + 1)`, gb, ratio.keys));
    }

    if (p.vector && p.vector.count > 0) {
      const tier = placementTier(p);
      const rep = replicasFor(p, tier);
      const v = p.vector;
      const cost = vectorCost(c, v.dims, v.quant, v.hnswM);
      const copies = (rep + 1) * opts.ccrMultiplier;
      const offheapGb = (v.count * growth * cost.offheapBytes * copies) / 1e9;
      const diskGb = (v.count * growth * cost.diskBytes * copies) / 1e9;
      const d = get(tier);
      d.offheapGb += offheapGb;
      d.dataGb += diskGb;
      d.math.push(step(`[${p.id}] off-heap bytes per vector (${v.quant})`, `${cost.expr}, d = ${v.dims}`, cost.offheapBytes, cost.keys));
      d.math.push(step(`[${p.id}] vector off-heap GB`, `${fmt(v.count * growth, 0)} × ${fmt(cost.offheapBytes)} B × (${rep} replicas + 1) / 1e9`, offheapGb, []));
      d.math.push(step(`[${p.id}] vector disk GB`, `${fmt(v.count * growth, 0)} × ${fmt(cost.diskBytes)} B × (${rep} replicas + 1) / 1e9`, diskGb, cost.keys));
    }
  }
  return out;
}

/** How often a data stream rolls over, and why (D31). */
export interface RolloverPlan {
  days: number;
  /** fixed = set on the workload; size = primary shard reached the size limit first; age = max age came first. */
  basis: 'fixed' | 'size' | 'age';
  expr: string;
  keys: string[];
}

/**
 * D31: Elasticsearch rolls a data stream over when the largest primary shard reaches the size limit
 * or the write index reaches the max age, whichever comes first. Size is measured on the tier that
 * receives writes, so the rate is that tier's indexed GB/day (after growth) spread over the primaries.
 */
export function rolloverFor(c: ConstantSet, p: WorkloadProfile, growthYears: number): RolloverPlan {
  if (p.rolloverDays !== undefined) {
    if (!(p.rolloverDays > 0 && Number.isFinite(p.rolloverDays))) {
      throw new Error(`[${p.id}] rollover must be greater than 0 days; got ${p.rolloverDays}.`);
    }
    return { days: p.rolloverDays, basis: 'fixed', expr: `${fmt(p.rolloverDays)} days (set on the workload)`, keys: [] };
  }
  const maxAge = num(c, 'datastream.rollover_max_age_days');
  const maxShardGb = num(c, 'datastream.rollover_max_primary_shard_gb');
  if (!p.rawGbPerDay) {
    return { days: maxAge, basis: 'age', expr: `${maxAge} days (max age; no GB/day to size by)`, keys: ['datastream.rollover_max_age_days'] };
  }
  const primaries = p.primaryShards ?? num(c, 'datastream.default_primary_shards');
  const writeTier = retentionTiers(p)[0] ?? 'hot';
  const ratio = indexRatio(c, p);
  const indexedPerDay = p.rawGbPerDay * growthFactor(p, growthYears) * ratio.value * downsampleFor(p, writeTier);
  const bySize = (maxShardGb * primaries) / indexedPerDay;
  const keys = ['datastream.rollover_max_primary_shard_gb', 'datastream.rollover_max_age_days', ...ratio.keys,
    ...(p.primaryShards === undefined ? ['datastream.default_primary_shards'] : [])];
  const basis = bySize < maxAge ? 'size' : 'age';
  return {
    days: Math.min(bySize, maxAge), basis, keys,
    expr: `min(${maxShardGb} GB × ${primaries} primar${primaries === 1 ? 'y' : 'ies'} / ${fmt(indexedPerDay)} GB/day indexed, ${maxAge} days max age)`,
  };
}

/** Index and shard estimates (D18, D31). Frozen shards are tracked apart from the non-frozen limit. */
export interface ShardEstimate {
  indices: number;
  nonFrozenShards: number;
  frozenShards: number;
  /** Primary shard size per profile and tier, for HV8. */
  shardSizes: { profileId: string; tier: Tier; shardGb: number; primaries: number; basis: RolloverPlan['basis'] }[];
  math: MathStep[];
}

export function estimateShards(c: ConstantSet, profiles: readonly WorkloadProfile[], growthYears: number): ShardEstimate {
  const est: ShardEstimate = { indices: 0, nonFrozenShards: 0, frozenShards: 0, shardSizes: [], math: [] };
  const maxShardGb = num(c, 'shard_size_gb_max');

  for (const p of profiles) {
    const ratio = indexRatio(c, p).value;
    const growth = growthFactor(p, growthYears);
    // Index and shard counts depend on retention, rollover and primaries; volume only through rollover.
    if (retentionTiers(p).length > 0 && (p.rawGbPerDay === undefined || p.rawGbPerDay > 0)) {
      const plan = rolloverFor(c, p, growthYears);
      const primaries = p.primaryShards ?? num(c, 'datastream.default_primary_shards');
      const primaryKeys = p.primaryShards === undefined ? ['datastream.default_primary_shards'] : [];
      est.math.push(step(`[${p.id}] rollover every (days)`, plan.expr, plan.days, plan.keys));
      let indicesP = 0;
      let shardsP = 0;
      for (const tier of retentionTiers(p)) {
        const days = p.retentionDays[tier]!;
        const indices = Math.ceil(days / plan.days - 1e-9);
        const shards = indices * primaries * (replicasFor(p, tier) + 1);
        indicesP += indices;
        shardsP += shards;
        est.indices += indices;
        if (tier === 'frozen') est.frozenShards += shards; else est.nonFrozenShards += shards;
        est.math.push(step(`[${p.id}] ${tier} shards`, `ROUNDUP(${fmt(days)} days / ${fmt(plan.days, 3)}) = ${indices} indices × ${primaries} primar${primaries === 1 ? 'y' : 'ies'} × (${replicasFor(p, tier)} replicas + 1)`, shards, primaryKeys));
        if (p.rawGbPerDay) {
          const shardGb = (p.rawGbPerDay * growth * ratio * downsampleFor(p, tier) * plan.days) / primaries;
          est.shardSizes.push({ profileId: p.id, tier, shardGb, primaries, basis: plan.basis });
        }
      }
      est.math.push(step(`[${p.id}] indices / shards`, `${indicesP} indices, ${shardsP} shards`, shardsP, []));
    }
    const corpusGb = (p.totalGb ?? 0) * growth * ratio;
    if (corpusGb > 0 || (p.vector && p.vector.count > 0)) {
      const tier = placementTier(p);
      const primaries = p.primaryShards ?? Math.max(1, Math.ceil(corpusGb / maxShardGb));
      est.indices += 1;
      est.nonFrozenShards += primaries * (replicasFor(p, tier) + 1);
      est.math.push(step(`[${p.id}] ${tier} shards (one index)`, `${primaries} primar${primaries === 1 ? 'y' : 'ies'}${p.primaryShards === undefined ? ` (ROUNDUP(${fmt(corpusGb)} GB / ${maxShardGb} GB))` : ''} × (${replicasFor(p, tier)} replicas + 1)`, primaries * (replicasFor(p, tier) + 1), p.primaryShards === undefined ? ['shard_size_gb_max'] : []));
      if (corpusGb > 0) est.shardSizes.push({ profileId: p.id, tier, shardGb: corpusGb / primaries, primaries, basis: 'fixed' });
    }
  }
  return est;
}
