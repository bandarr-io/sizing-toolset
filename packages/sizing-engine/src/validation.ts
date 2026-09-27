import { num, type ConstantSet } from '@sizing/constants';
import { fmt } from './math.ts';
import { fleetRowFor, fleetRowForMemory } from './overhead.ts';
import { heapGb, tierRatio, type RatioOverrides } from './profiles.ts';
import type { NodeGroup, Tier, Warning } from './types.ts';
import type { ShardEstimate } from './demand.ts';

const DATA_TIERS = new Set<string>(['hot', 'warm', 'cold', 'frozen', 'content']);
const HEAP_ROLES = new Set<string>([...DATA_TIERS, 'master', 'ml', 'coordinating']);

export interface ValidationInput {
  groups: readonly NodeGroup[];
  airGapped: boolean;
  autoOps: boolean;
  /** Highest replica count used on each tier. */
  replicasByTier: Partial<Record<Tier, number>>;
  agents: number;
  shards?: ShardEstimate;
  /** D25: scenario mem:disk ratios; HV5 compares disk against these. */
  ratioOverrides?: RatioOverrides;
  /** Data GB (before overhead) per tier, for HV7. */
  dataGbByTier?: Partial<Record<Tier, number>>;
}

function bandFor(c: ConstantSet, tier: Tier): [number, number] | undefined {
  if (tier === 'hot' || tier === 'content') return [num(c, 'mem_disk.hot_min'), num(c, 'mem_disk.hot_max')];
  if (tier === 'warm' || tier === 'cold') return [num(c, 'mem_disk.warm_min'), num(c, 'mem_disk.warm_max')];
  return undefined; // D20: frozen disk is a local cache; 1:1500 governs object-store data, not local disk.
}

/** SPEC §5.7 hardware validation rules HV1–HV12. Always evaluated. */
export function validateHardware(c: ConstantSet, v: ValidationInput): Warning[] {
  const w: Warning[] = [];
  const add = (id: string, severity: Warning['severity'], message: string) => w.push({ id, severity, message });
  const maxRam = num(c, 'node_ram_practical_max_gb');
  const cap = num(c, 'heap_cap_gb');
  const frac = num(c, 'heap_fraction');

  for (const g of v.groups) {
    if (g.count <= 0) continue;
    // HV1
    if (g.ramGb > maxRam) {
      if (g.role === 'ml' || g.role === 'frozen') add('HV1', 'info', `${g.role} nodes have ${fmt(g.ramGb)} GB RAM (> ${maxRam} GB). Allowed for ${g.role}.`);
      else if (DATA_TIERS.has(g.role) || g.role === 'master') add('HV1', 'warn', `${g.role} nodes have ${fmt(g.ramGb)} GB RAM (> ${maxRam} GB). Split into smaller nodes.`);
    }
    // HV2
    if (HEAP_ROLES.has(g.role)) {
      const heap = heapGb(c, g.ramGb, g.heapGbOverride);
      if (heap > cap || heap > frac * g.ramGb + 1e-9) {
        add('HV2', 'error', `${g.role} heap ${fmt(heap)} GB exceeds ${cap} GB or 50% of ${fmt(g.ramGb)} GB RAM.`);
      }
    }
    if (!DATA_TIERS.has(g.role)) continue;
    const tier = g.role as Tier;
    // HV3
    if (g.diskType === 'hdd' && (tier === 'hot' || tier === 'content')) add('HV3', 'error', `HDD on the ${tier} tier.`);
    // HV4 / HV5
    const band = bandFor(c, tier);
    const ratio = g.diskGb / g.ramGb;
    if (band && (ratio < band[0] || ratio > band[1])) {
      add('HV4', 'warn', `${tier} mem:disk is 1:${fmt(ratio, 1)}, outside the 1:${band[0]}–1:${band[1]} band.`);
    }
    if (tier !== 'frozen') {
      const target = tierRatio(c, tier, v.ratioOverrides).value;
      if (g.diskGb < g.ramGb * target) {
        add('HV5', 'info', `${tier} is disk-bound: ${fmt(g.diskGb)} GB disk < ${fmt(g.ramGb)} GB × ${target} = ${fmt(g.ramGb * target)} GB. Capacity uses disk.`);
      }
    }
    // HV9
    if (g.count === 1 && (v.replicasByTier[tier] ?? 0) >= 1) {
      add('HV9', 'error', `Single ${tier} node with ${v.replicasByTier[tier]} replica(s): replicas cannot be allocated.`);
    }
    // HV11
    if (tier === 'hot' && g.vcpu / g.ramGb < num(c, 'hv.hot_min_vcpu_per_ram_gb') - 1e-12) {
      add('HV11', 'warn', `hot vCPU:RAM is 1:${fmt(g.ramGb / g.vcpu, 1)} (below 1:8). Likely CPU-bound.`);
    }
  }

  // HV6
  const dataNodes = v.groups.filter((g) => DATA_TIERS.has(g.role)).reduce((s, g) => s + g.count, 0);
  const masters = v.groups.filter((g) => g.role === 'master').reduce((s, g) => s + g.count, 0);
  if (masters > 0) {
    if (masters < 3) add('HV6', 'error', `${masters} dedicated master node(s); need at least 3.`);
    else if (masters % 2 === 0) add('HV6', 'warn', `Even number (${masters}) of dedicated masters. Use an odd number.`);
  } else {
    if (dataNodes > 0 && dataNodes < 3) add('HV6', 'error', `Only ${dataNodes} master-eligible node(s); need at least 3 (add a voting-only tiebreaker).`);
    if (dataNodes >= 6) add('HV6', 'warn', `${dataNodes} data nodes without dedicated masters.`);
  }

  // HV7: projected disk use after losing one node per tier.
  const low = num(c, 'watermark.low');
  for (const [tier, dataGb] of Object.entries(v.dataGbByTier ?? {}) as [Tier, number][]) {
    if (tier === 'frozen' || dataGb <= 0) continue;
    const gs = v.groups.filter((g) => g.role === tier && g.count > 0);
    if (gs.length === 0) {
      add('HV7', 'warn', `${fmt(dataGb, 0)} GB of data is placed on ${tier}, but there are no ${tier} nodes. Add a ${tier} node group or move the workload.`);
      continue;
    }
    const total = gs.reduce((s, g) => s + g.count * g.diskGb, 0);
    const largest = Math.max(0, ...gs.map((g) => g.diskGb));
    const usable = total - largest;
    const used = usable > 0 ? dataGb / usable : Infinity;
    if (used > low) add('HV7', 'warn', `${tier} projected disk use ${fmt(used * 100, 1)}% (after losing one node) exceeds the ${low * 100}% low watermark.`);
    else if (1 - used < num(c, 'storage.watermark_headroom')) add('HV7', 'warn', `${tier} headroom ${fmt((1 - used) * 100, 1)}% is below 15%.`);
  }

  // HV8
  if (v.shards) {
    const nonFrozenNodes = v.groups.filter((g) => DATA_TIERS.has(g.role) && g.role !== 'frozen').reduce((s, g) => s + g.count, 0);
    const limit = num(c, 'max_shards_per_nonfrozen_node');
    const perNode = nonFrozenNodes > 0 ? v.shards.nonFrozenShards / nonFrozenNodes : 0;
    if (perNode > limit) add('HV8', 'warn', `${fmt(perNode, 0)} shards per non-frozen node (limit ${limit}).`);
    const lo = num(c, 'shard_size_gb_min');
    const hi = num(c, 'shard_size_gb_max');
    for (const s of v.shards.shardSizes) {
      if (s.tier === 'frozen') continue;
      if (s.shardGb > hi) {
        const suggested = Math.ceil((s.shardGb * s.primaries) / hi);
        add('HV8', 'warn', `[${s.profileId}] ${s.tier} shards ≈ ${fmt(s.shardGb, 1)} GB (> ${hi} GB). Use ≥ ${suggested} primaries or roll over sooner.`);
      } else if (s.shardGb < lo) {
        add('HV8', 'info', `[${s.profileId}] ${s.tier} shards ≈ ${fmt(s.shardGb, 1)} GB (< ${lo} GB). Consider longer rollover.`);
      }
    }
  }

  // HV10
  if (v.airGapped && v.autoOps) add('HV10', 'error', 'Air-gapped scenario with AutoOps / Cloud Connect selected. AutoOps requires internet.');

  // HV12
  if (v.agents > 0) {
    const fleetGroups = v.groups.filter((g) => g.role === 'fleet' && g.count > 0);
    const fleetMem = Math.max(0, ...fleetGroups.map((g) => g.ramGb));
    const supported = fleetRowForMemory(c, fleetMem);
    if (!supported || v.agents > supported.agents) {
      add('HV12', 'warn', `${fmt(v.agents, 0)} agents exceed the Fleet table row for ${fmt(fleetMem)} GB Fleet Server memory (${fmt(supported?.agents ?? 0, 0)} agents).`);
    }
    const need = fleetRowFor(c, v.agents);
    const hot = v.groups.filter((g) => g.role === 'hot');
    const hotRam = hot.reduce((s, g) => s + g.count * g.ramGb, 0);
    const hotVcpu = hot.reduce((s, g) => s + g.count * g.vcpu, 0);
    if (hotRam < need.hotRamGb || hotVcpu < need.hotVcpu) {
      add('HV12', 'warn', `Hot tier ${fmt(hotRam)} GB / ${fmt(hotVcpu)} vCPU is below the Fleet table floor for ${fmt(need.agents, 0)} agents (${need.hotRamGb} GB / ${need.hotVcpu} vCPU).`);
    }
    if (v.agents >= num(c, 'fleet.api_key_cache_threshold_agents')) {
      add('HV12', 'info', `≥ ${fmt(num(c, 'fleet.api_key_cache_threshold_agents'), 0)} agents: set xpack.security.authc.api_key.cache.max_keys to ${fmt(v.agents * num(c, 'fleet.api_key_cache_multiplier'), 0)}.`);
    }
  }
  return w;
}
