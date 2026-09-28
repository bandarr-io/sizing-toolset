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

/** Display names for node roles in warning text. */
const ROLE_NAME: Record<string, string> = { ml: 'machine learning' };
const roleName = (r: string) => ROLE_NAME[r] ?? r;
const cap1 = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

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
      if (g.role === 'ml' || g.role === 'frozen') add('HV1', 'info', `${cap1(roleName(g.role))} nodes have ${fmt(g.ramGb)} GB of memory, more than the usual ${maxRam} GB. That is fine for ${roleName(g.role)} nodes.`);
      else if (DATA_TIERS.has(g.role) || g.role === 'master') add('HV1', 'warn', `${cap1(roleName(g.role))} nodes have ${fmt(g.ramGb)} GB of memory, more than the ${maxRam} GB that works well. Run several smaller nodes on each server instead.`);
    }
    // HV2
    if (HEAP_ROLES.has(g.role)) {
      const heap = heapGb(c, g.ramGb, g.heapGbOverride);
      if (heap > cap || heap > frac * g.ramGb + 1e-9) {
        add('HV2', 'error', `${cap1(roleName(g.role))} nodes reserve ${fmt(heap)} GB of memory for Elasticsearch's own work (the heap). Keep it at or below ${cap} GB and at most half of the node's ${fmt(g.ramGb)} GB.`);
      }
    }
    if (!DATA_TIERS.has(g.role)) continue;
    const tier = g.role as Tier;
    // HV3
    if (g.diskType === 'hdd' && (tier === 'hot' || tier === 'content')) add('HV3', 'error', `The ${tier} tier uses spinning hard disks (HDD). They are too slow for this data. Use solid-state disks (SSD).`);
    // HV4 / HV5
    const band = bandFor(c, tier);
    const ratio = g.diskGb / g.ramGb;
    if (band && (ratio < band[0] || ratio > band[1])) {
      add('HV4', 'warn', `On the ${tier} tier, each GB of memory looks after ${fmt(ratio, 1)} GB of disk. The usual range is ${band[0]} to ${band[1]} GB.`);
    }
    if (tier !== 'frozen') {
      const target = tierRatio(c, tier, v.ratioOverrides).value;
      if (g.diskGb < g.ramGb * target) {
        add('HV5', 'info', `The ${tier} nodes have less disk than their memory could look after: ${fmt(g.diskGb)} GB, against ${fmt(g.ramGb)} GB × ${target} = ${fmt(g.ramGb * target)} GB. Disk sets how much they can hold.`);
      }
    }
    // HV9
    if (g.count === 1 && (v.replicasByTier[tier] ?? 0) >= 1) {
      add('HV9', 'error', `The ${tier} tier has one node but asks for ${v.replicasByTier[tier]} spare ${plural(v.replicasByTier[tier]!, 'copy', 'copies')} (replicas). A spare copy must live on a different node. Add a node or remove the replicas.`);
    }
    // HV11
    if (tier === 'hot' && g.vcpu / g.ramGb < num(c, 'hv.hot_min_vcpu_per_ram_gb') - 1e-12) {
      add('HV11', 'warn', `Hot nodes have one processor core (vCPU) for every ${fmt(g.ramGb / g.vcpu, 1)} GB of memory, more than the usual 8 GB. Processing power will likely run out before disk does.`);
    }
  }

  // HV6
  const dataNodes = v.groups.filter((g) => DATA_TIERS.has(g.role)).reduce((s, g) => s + g.count, 0);
  const masters = v.groups.filter((g) => g.role === 'master').reduce((s, g) => s + g.count, 0);
  if (masters > 0) {
    if (masters < 3) add('HV6', 'error', `There ${plural(masters, 'is', 'are')} ${masters} master ${plural(masters, 'node', 'nodes')}. Master nodes keep the cluster organized, and they need at least 3 so they can vote.`);
    else if (masters % 2 === 0) add('HV6', 'warn', `There are ${masters} master nodes. Use an odd number so their votes cannot tie.`);
  } else {
    if (dataNodes > 0 && dataNodes < 3) add('HV6', 'error', `Only ${dataNodes} ${plural(dataNodes, 'node', 'nodes')} can keep the cluster organized, and at least 3 are needed so they can vote. Add a tiny tiebreaker node that only votes.`);
    if (dataNodes >= 6) add('HV6', 'warn', `${dataNodes} data nodes also keep the cluster organized. At this size, add 3 small master nodes to do that job alone.`);
  }

  // HV7: projected disk use after losing one node per tier.
  const low = num(c, 'watermark.low');
  for (const [tier, dataGb] of Object.entries(v.dataGbByTier ?? {}) as [Tier, number][]) {
    if (tier === 'frozen' || dataGb <= 0) continue;
    const gs = v.groups.filter((g) => g.role === tier && g.count > 0);
    if (gs.length === 0) {
      add('HV7', 'warn', `${fmt(dataGb, 0)} GB of data belongs on the ${tier} tier, but there are no ${tier} nodes. Add a ${tier} node group or move the workload.`);
      continue;
    }
    const total = gs.reduce((s, g) => s + g.count * g.diskGb, 0);
    const largest = Math.max(0, ...gs.map((g) => g.diskGb));
    const usable = total - largest;
    const used = usable > 0 ? dataGb / usable : Infinity;
    if (used > low) add('HV7', 'warn', `If one ${tier} node fails, the others would be ${fmt(used * 100, 1)}% full. Above ${low * 100}%, Elasticsearch stops placing new data on a node.`);
    else if (1 - used < num(c, 'storage.watermark_headroom')) add('HV7', 'warn', `If one ${tier} node fails, only ${fmt((1 - used) * 100, 1)}% of the ${tier} disk stays free. Keep at least 15% free.`);
  }

  // HV8
  if (v.shards) {
    const nonFrozenNodes = v.groups.filter((g) => DATA_TIERS.has(g.role) && g.role !== 'frozen').reduce((s, g) => s + g.count, 0);
    const limit = num(c, 'max_shards_per_nonfrozen_node');
    const perNode = nonFrozenNodes > 0 ? v.shards.nonFrozenShards / nonFrozenNodes : 0;
    if (perNode > limit) add('HV8', 'warn', `Each node outside the frozen tier holds about ${fmt(perNode, 0)} shards (slices of the data). The limit is ${limit} per node.`);
    const lo = num(c, 'shard_size_gb_min');
    const hi = num(c, 'shard_size_gb_max');
    for (const s of v.shards.shardSizes) {
      if (s.tier === 'frozen') continue;
      if (s.shardGb > hi) {
        const suggested = Math.ceil((s.shardGb * s.primaries) / hi);
        add('HV8', 'warn', `${s.profileId}: ${s.tier} shards (slices of the data) are ${fmt(s.shardGb, 1) === fmt(hi, 1) ? 'just over' : `about ${fmt(s.shardGb, 1)} GB each, more than`} ${hi} GB. Use at least ${suggested} primary shards, or start a fresh index sooner (roll over).`);
      } else if (s.shardGb < lo && !(s.basis === 'age' && s.primaries === 1)) {
        const fix = s.primaries > 1 ? 'Use fewer primary shards' : s.basis === 'fixed' ? 'Start a fresh index less often' : 'Use fewer primary shards or a longer maximum age';
        add('HV8', 'info', `${s.profileId}: ${s.tier} shards (slices of the data) are ${fmt(s.shardGb, 1) === fmt(lo, 1) ? 'just under' : `about ${fmt(s.shardGb, 1)} GB each, less than`} ${lo} GB. ${fix}.`);
      }
    }
  }

  // HV10
  if (v.airGapped && v.autoOps) add('HV10', 'error', "The site has no internet connection (air-gapped), but AutoOps is selected. AutoOps is Elastic's monitoring service, and it needs internet.");

  // HV12
  if (v.agents > 0) {
    const fleetGroups = v.groups.filter((g) => g.role === 'fleet' && g.count > 0);
    const fleetMem = Math.max(0, ...fleetGroups.map((g) => g.ramGb));
    const supported = fleetRowForMemory(c, fleetMem);
    if (!supported || v.agents > supported.agents) {
      add('HV12', 'warn', `${fmt(v.agents, 0)} agents is more than Fleet Server (the service that manages the agents) can handle with ${fmt(fleetMem)} GB of memory. That size handles ${fmt(supported?.agents ?? 0, 0)} agents.`);
    }
    const need = fleetRowFor(c, v.agents);
    const hot = v.groups.filter((g) => g.role === 'hot');
    const hotRam = hot.reduce((s, g) => s + g.count * g.ramGb, 0);
    const hotVcpu = hot.reduce((s, g) => s + g.count * g.vcpu, 0);
    if (hotRam < need.hotRamGb || hotVcpu < need.hotVcpu) {
      add('HV12', 'warn', `Elastic's Fleet guidance for ${fmt(need.agents, 0)} agents asks for ${need.hotRamGb} GB of memory and ${need.hotVcpu} processor cores on the hot tier. It has ${fmt(hotRam)} GB and ${fmt(hotVcpu)} cores.`);
    }
    if (v.agents >= num(c, 'fleet.api_key_cache_threshold_agents')) {
      add('HV12', 'info', `With ${fmt(num(c, 'fleet.api_key_cache_threshold_agents'), 0)} or more agents, Elasticsearch must remember more agent sign-in keys. Set xpack.security.authc.api_key.cache.max_keys to ${fmt(v.agents * num(c, 'fleet.api_key_cache_multiplier'), 0)}.`);
    }
  }
  return w;
}
