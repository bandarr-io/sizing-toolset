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
          d.math.push(step(`${tag} GB/day after growth`, `${fmt(p.rawGbPerDay)} × (1 + ${fmt(p.growthPctPerYear ?? 0)}%)^${fmt(opts.growthYears)}`, gbDay, ['growth.default_horizon_years']));
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

/** Index and shard estimates (D18). Frozen shards are tracked apart from the non-frozen limit. */
export interface ShardEstimate {
  indices: number;
  nonFrozenShards: number;
  frozenShards: number;
  /** Largest primary shard per profile and tier, for HV8. */
  shardSizes: { profileId: string; tier: Tier; shardGb: number; primaries: number }[];
}

export function estimateShards(c: ConstantSet, profiles: readonly WorkloadProfile[], growthYears: number): ShardEstimate {
  const est: ShardEstimate = { indices: 0, nonFrozenShards: 0, frozenShards: 0, shardSizes: [] };
  const rolloverDefault = num(c, 'datastream.default_rollover_days');
  const primariesDefault = num(c, 'datastream.default_primary_shards');
  const maxShardGb = num(c, 'shard_size_gb_max');

  for (const p of profiles) {
    const ratio = indexRatio(c, p).value;
    const growth = growthFactor(p, growthYears);
    if (p.rawGbPerDay !== undefined && p.rawGbPerDay > 0) {
      const rollover = p.rolloverDays ?? rolloverDefault;
      const primaries = p.primaryShards ?? primariesDefault;
      for (const tier of retentionTiers(p)) {
        const days = p.retentionDays[tier]!;
        const indices = Math.ceil(days / rollover);
        const shards = indices * primaries * (replicasFor(p, tier) + 1);
        est.indices += indices;
        if (tier === 'frozen') est.frozenShards += shards; else est.nonFrozenShards += shards;
        const shardGb = (p.rawGbPerDay * growth * ratio * downsampleFor(p, tier) * rollover) / primaries;
        est.shardSizes.push({ profileId: p.id, tier, shardGb, primaries });
      }
    }
    const corpusGb = (p.totalGb ?? 0) * growth * ratio;
    if (corpusGb > 0 || (p.vector && p.vector.count > 0)) {
      const tier = placementTier(p);
      const primaries = p.primaryShards ?? Math.max(1, Math.ceil(corpusGb / maxShardGb));
      est.indices += 1;
      est.nonFrozenShards += primaries * (replicasFor(p, tier) + 1);
      if (corpusGb > 0) est.shardSizes.push({ profileId: p.id, tier, shardGb: corpusGb / primaries, primaries });
    }
  }
  return est;
}
