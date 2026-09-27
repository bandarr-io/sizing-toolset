import { defaultConstants, num, type ConstantSet } from '@sizing/constants';
import { CONFIDENCE, RALLY_REQUIRED } from './confidence.ts';
import { avgEventKb, derateFactor, ingestDemandEvents } from './cpu.ts';
import { computeDemand, estimateShards } from './demand.ts';
import { licenseFloor, selfManagedEru } from './license.ts';
import { fmt, floorEps, step } from './math.ts';
import { fleetTable } from './overhead.ts';
import {
  describeOverrides, downsampleFor, frozenCacheFraction, growthFactor, heapGb, indexRatio, offheapBudgetGb, tierRatio, placementTier, replicasFor, retentionTiers, vectorCost,
} from './profiles.ts';
import { buildAssumptions, commonWarnings, ENGINE_VERSION, objectStorageAssumption, objectStorageFor, totalsFor } from './result.ts';
import type {
  Constraint, ConstraintName, MathStep, NodeGroup, OverheadResult, ReverseRequest, SizingResult, Tier, TierResult,
  WorkloadProfile,
} from './types.ts';
import { TIERS } from './types.ts';
import { validateHardware } from './validation.ts';

const DATA_TIERS = new Set<string>(TIERS);

/** One physical node expanded from a NodeGroup. */
interface Node { ramGb: number; diskGb: number; vcpu: number; heapOverride: number | undefined; diskWriteMBps: number | undefined }

function expand(groups: readonly NodeGroup[], role: string): Node[] {
  const out: Node[] = [];
  for (const g of groups) {
    if (g.role !== role) continue;
    for (let i = 0; i < g.count; i++) out.push({ ramGb: g.ramGb, diskGb: g.diskGb, vcpu: g.vcpu, heapOverride: g.heapGbOverride, diskWriteMBps: g.diskWriteMBps });
  }
  return out;
}

/** SPEC §5.3 N−1: sum `f` over every node except the one with the largest `f`. */
function sumExceptLargest(nodes: readonly Node[], f: (n: Node) => number): number {
  if (nodes.length === 0) return 0;
  const values = nodes.map(f);
  return values.reduce((s, v) => s + v, 0) - Math.max(...values);
}

interface TierCapacity {
  tier: Tier;
  count: number;
  /** Non-frozen: Σ_{N−1} min(RAM × ratio, disk). Frozen (D27): Σ_{N−1} disk / storage_overhead / cache_fraction. */
  usableGb: number;
  diskBound: boolean;
  math: MathStep[];
}

function tierCapacity(c: ConstantSet, groups: readonly NodeGroup[], tier: Tier, overrides?: Partial<Record<Tier, number>>, cacheFraction?: number): TierCapacity {
  const nodes = expand(groups, tier);
  if (tier === 'frozen') {
    // D27: disk-cache model. Use the node's explicit diskGb if set; otherwise derive from RAM × local disk ratio.
    const localDiskRatio = num(c, 'frozen_local_disk_ratio');
    const overhead = num(c, 'storage_overhead');
    const cf = frozenCacheFraction(c, cacheFraction);
    const usableGb = sumExceptLargest(nodes, (n) => {
      const disk = n.diskGb > 0 ? n.diskGb : n.ramGb * localDiskRatio;
      return disk / overhead / cf;
    });
    return {
      tier, count: nodes.length, usableGb, diskBound: false,
      math: [step('frozen usable capacity (N−1)', `Σ_{${Math.max(0, nodes.length - 1)} nodes} disk / ${overhead} overhead / ${fmt(cf)} cache fraction`, usableGb, ['frozen_local_disk_ratio', 'frozen_cache_fraction', 'storage_overhead'])],
    };
  }
  const r = tierRatio(c, tier, overrides);
  const ratio = r.value;
  const keys = r.keys;
  const note = r.overridden ? ' (scenario override)' : '';
  const per = (n: Node) => Math.min(n.ramGb * ratio, n.diskGb);
  const usableGb = sumExceptLargest(nodes, per);
  const diskBound = nodes.some((n) => n.diskGb < n.ramGb * ratio);
  const sample = nodes[0];
  const expr = sample
    ? `${Math.max(0, nodes.length - 1)} × min(${fmt(sample.ramGb)} × ${ratio}${note}, ${fmt(sample.diskGb)})${new Set(nodes.map(per)).size > 1 ? ' (mixed nodes; largest removed)' : ''}`
    : 'no nodes';
  return { tier, count: nodes.length, usableGb, diskBound, math: [step(`${tier} usable capacity (N−1)`, expr, usableGb, keys)] };
}

function constraint(
  name: ConstraintName, maxValue: number, unit: string, math: MathStep[], extra: Partial<Constraint> = {},
): Constraint {
  return {
    name, capacity: maxValue, maxValue, unit, confidence: CONFIDENCE[name], binding: false, math,
    ...(RALLY_REQUIRED.has(name) ? { rallyRequired: true } : {}), ...extra,
  };
}

function pickTarget(req: ReverseRequest, want: (p: WorkloadProfile) => boolean): WorkloadProfile | undefined {
  if (req.targetProfileId) return req.fixed.find((p) => p.id === req.targetProfileId);
  return req.fixed.find(want);
}

interface Solved {
  value: number;
  unit: string;
  constraints: Constraint[];
  dataStreams?: number;
  target?: WorkloadProfile;
  /** Set when constraints are in different units and "lowest max" does not apply. */
  bindingIndex?: number;
  /** Utilization numerator when it is not `value` (years_to_capacity: GB/day at the answer). */
  utilizationDemand?: number;
  /** Extra assumptions this question adds. */
  notes?: string[];
  /** Grow every fixed workload by this many years for validation at the answer. */
  atYears?: number;
}

// ---- max_gb_day ---------------------------------------------------------------------------------

/** `growthYears` grows the other fixed workloads, so they use more capacity (years_to_capacity). */
function solveMaxGbDay(c: ConstantSet, req: ReverseRequest, growthYears = 0): Solved {
  const groups = req.hardware.groups;
  const target = pickTarget(req, (p) => retentionTiers(p).length > 0);
  if (!target) throw new Error('max_gb_day needs a fixed workload with retention days');
  const others = req.fixed.filter((p) => p !== target);
  const otherDemand = computeDemand(c, others, { growthYears, ccrMultiplier: 1 });
  const ratio = indexRatio(c, target);
  const overhead = num(c, 'storage_overhead');
  const constraints: Constraint[] = [];

  for (const tier of retentionTiers(target)) {
    const cap = tierCapacity(c, groups, tier, req.hardware.memDiskRatio, req.frozenCacheFraction);
    const days = target.retentionDays[tier]!;
    const ds = downsampleFor(target, tier);
    const used = otherDemand.get(tier)?.dataGb ?? 0;
    const math = [...cap.math];
    let max: number;
    if (tier === 'frozen') {
      const free = cap.usableGb - used;
      const per = days * ratio.value * ds;
      max = Math.max(0, free / per);
      if (used > 0) math.push(step('minus other workloads', `${fmt(cap.usableGb)} − ${fmt(used)}`, free, []));
      math.push(step('max GB/day (frozen)', `${fmt(free)} / (${fmt(days)} days × ${fmt(ratio.value)}${ds !== 1 ? ` × ${fmt(ds)}` : ''})`, max, ratio.keys));
      constraints.push(constraint('frozen', max, 'GB/day', math, { tier }));
    } else {
      const rep = replicasFor(target, tier);
      const maxData = cap.usableGb / overhead;
      const free = maxData - used;
      const per = days * (rep + 1) * ratio.value * ds;
      max = Math.max(0, free / per);
      math.push(step('max total data GB', `${fmt(cap.usableGb)} / ${overhead}`, maxData, ['storage_overhead']));
      if (used > 0) math.push(step('minus other workloads', `${fmt(maxData)} − ${fmt(used)}`, free, []));
      math.push(step(`max GB/day (${tier})`, `${fmt(free)} / (${fmt(days)} days × (${rep} + 1) × ${fmt(ratio.value)}${ds !== 1 ? ` × ${fmt(ds)}` : ''})`, max, ratio.keys));
      constraints.push(constraint(cap.diskBound ? 'disk' : 'storage', max, 'GB/day', math, { tier }));
    }
  }

  // CPU ceiling on the ingest tier (hot, else content, else the target's first tier).
  const ingestTier = (['hot', 'content'] as Tier[]).find((t) => expand(groups, t).length > 0) ?? retentionTiers(target)[0]!;
  const ingestNodes = expand(groups, ingestTier);
  if (ingestNodes.length > 0) {
    const usableVcpu = sumExceptLargest(ingestNodes, (n) => n.vcpu);
    const ev = req.eventsPerSecondPerVcpu ?? num(c, 'ev_per_s_per_vcpu');
    const capacityEv = usableVcpu * ev;
    const othersEv = others.reduce((s, p) => s + ingestDemandEvents(c, p, ingestTier, growthYears, req.concurrentSearch ?? false), 0);
    const rep = replicasFor(target, ingestTier);
    const kb = avgEventKb(c, target);
    const derate = derateFactor(c, target, req.concurrentSearch ?? false);
    const max = Math.max(0, ((capacityEv - othersEv) * kb * 86_400 * derate.factor) / 1e6 / (rep + 1));
    constraints.push(constraint('cpu_ingest', max, 'GB/day', [
      step('usable vCPU (N−1)', `Σ_{${ingestNodes.length - 1} nodes} vCPU`, usableVcpu, []),
      step('max GB/day (CPU)', `${fmt(usableVcpu)} × ${ev} × ${fmt(kb)} KB × 86,400 / 1e6 / (${rep} + 1)${derate.factor !== 1 ? ` × ${fmt(derate.factor)} (${derate.notes.join(', ')})` : ''}${othersEv > 0 ? ' after other workloads' : ''}`, max, ['ev_per_s_per_vcpu', 'ingest.default_avg_event_kb', ...derate.keys]),
    ], { tier: ingestTier }));
  }

  // Disk write throughput (D28): only when diskWriteMBps is set on the ingest-tier nodes.
  const mbps = ingestNodes[0]?.diskWriteMBps;
  if (mbps !== undefined) {
    const usableWrite = ingestNodes.length - 1;
    const writeCapacity = usableWrite * mbps * 86_400 / 1_000;
    const othersWrite = others.reduce((s, p) => {
      if (!retentionTiers(p).includes(ingestTier)) return s;
      const ir = indexRatio(c, p).value;
      const ds = p.downsampleFactor?.[ingestTier] ?? 1;
      const rep = replicasFor(p, ingestTier);
      return s + (p.rawGbPerDay ?? 0) * ir * ds * (rep + 1);
    }, 0);
    const rep = replicasFor(target, ingestTier);
    const maxWrite = Math.max(0, (writeCapacity - othersWrite) / (rep + 1) / ratio.value);
    constraints.push(constraint('disk_write', maxWrite, 'GB/day', [
      step('usable nodes (N−1)', `${ingestNodes.length} − 1`, usableWrite, []),
      step('disk write capacity', `${usableWrite} × ${fmt(mbps)} MB/s × 86,400 / 1,000`, writeCapacity, []),
      step('max GB/day (disk write)', `${fmt(writeCapacity)} / (${rep + 1} copies × ${fmt(ratio.value)} ratio)${othersWrite > 0 ? ' after other workloads' : ''}`, maxWrite, ratio.keys),
    ], { tier: ingestTier }));
  }

  constraints.push(shardCeiling(c, req));
  return { value: Math.min(...constraints.map((k) => k.maxValue!)), unit: 'GB/day', constraints, target };
}

/** Shard count does not scale with GB/day (fixed rollover); it either fits (∞) or blocks (0). */
function shardCeiling(c: ConstantSet, req: ReverseRequest): Constraint {
  const nonFrozen = req.hardware.groups.filter((g) => DATA_TIERS.has(g.role) && g.role !== 'frozen').reduce((s, g) => s + g.count, 0);
  const cap = Math.max(0, nonFrozen - 1) * num(c, 'max_shards_per_nonfrozen_node');
  const shards = estimateShards(c, req.fixed, 0).nonFrozenShards;
  const fits = shards <= cap;
  return constraint('heap_shards', fits ? Infinity : 0, 'GB/day', [
    step('shard capacity (N−1)', `(${nonFrozen} − 1) × ${num(c, 'max_shards_per_nonfrozen_node')}`, cap, ['max_shards_per_nonfrozen_node']),
    step('shards needed (independent of GB/day)', fits ? `${fmt(shards, 0)} ≤ ${fmt(cap, 0)}: not limiting` : `${fmt(shards, 0)} > ${fmt(cap, 0)}: blocks all ingest`, shards, ['datastream.default_rollover_days', 'datastream.default_primary_shards']),
  ], { capacity: cap, demand: shards });
}

// ---- max_retention ------------------------------------------------------------------------------

function solveMaxRetention(c: ConstantSet, req: ReverseRequest): Solved {
  const target = pickTarget(req, (p) => (p.rawGbPerDay ?? 0) > 0);
  if (!target || !target.rawGbPerDay) throw new Error('max_retention needs a fixed workload with GB/day');
  const tier = req.targetTier ?? retentionTiers(target)[0] ?? 'hot';
  const others = req.fixed.filter((p) => p !== target);
  const withoutTier: WorkloadProfile = { ...target, retentionDays: { ...target.retentionDays, [tier]: 0 } };
  const used = computeDemand(c, [...others, withoutTier], { growthYears: 0, ccrMultiplier: 1 }).get(tier)?.dataGb ?? 0;
  const cap = tierCapacity(c, req.hardware.groups, tier, req.hardware.memDiskRatio, req.frozenCacheFraction);
  const ratio = indexRatio(c, target);
  const ds = downsampleFor(target, tier);
  const gbDay = target.rawGbPerDay;
  const math = [...cap.math];
  const constraints: Constraint[] = [];

  if (tier === 'frozen') {
    const free = cap.usableGb - used;
    const max = Math.max(0, floorEps(free / (gbDay * ratio.value * ds)));
    math.push(step('max retention (frozen)', `floor(${fmt(free)} / (${fmt(gbDay)} × ${fmt(ratio.value)}${ds !== 1 ? ` × ${fmt(ds)}` : ''}))`, max, ratio.keys));
    constraints.push(constraint('frozen', max, 'days', math, { tier }));
  } else {
    const overhead = num(c, 'storage_overhead');
    const rep = replicasFor(target, tier);
    const free = cap.usableGb / overhead - used;
    const max = Math.max(0, floorEps(free / (gbDay * (rep + 1) * ratio.value * ds)));
    math.push(step('max total data GB', `${fmt(cap.usableGb)} / ${overhead}${used > 0 ? ` − ${fmt(used)} other` : ''}`, free, ['storage_overhead']));
    math.push(step(`max retention (${tier})`, `floor(${fmt(free)} / (${fmt(gbDay)} × (${rep} + 1) × ${fmt(ratio.value)}${ds !== 1 ? ` × ${fmt(ds)}` : ''}))`, max, ratio.keys));
    constraints.push(constraint(cap.diskBound ? 'disk' : 'storage', max, 'days', math, { tier }));

    // More retention means more backing indices and shards.
    const rollover = target.rolloverDays ?? num(c, 'datastream.default_rollover_days');
    const primaries = target.primaryShards ?? num(c, 'datastream.default_primary_shards');
    const nonFrozen = req.hardware.groups.filter((g) => DATA_TIERS.has(g.role) && g.role !== 'frozen').reduce((s, g) => s + g.count, 0);
    const shardCap = Math.max(0, nonFrozen - 1) * num(c, 'max_shards_per_nonfrozen_node');
    const otherShards = estimateShards(c, [...others, withoutTier], 0).nonFrozenShards;
    const byShards = Math.max(0, floorEps(((shardCap - otherShards) / (primaries * (rep + 1))) * rollover));
    constraints.push(constraint('heap_shards', byShards, 'days', [
      step('shard capacity (N−1)', `(${nonFrozen} − 1) × ${num(c, 'max_shards_per_nonfrozen_node')} − ${fmt(otherShards, 0)} other`, shardCap - otherShards, ['max_shards_per_nonfrozen_node']),
      step('max retention (shards)', `floor(${fmt(shardCap - otherShards, 0)} / (${primaries} × (${rep} + 1)) × ${rollover} days rollover)`, byShards, ['datastream.default_rollover_days', 'datastream.default_primary_shards']),
    ]));
  }
  return { value: Math.min(...constraints.map((k) => k.maxValue!)), unit: 'days', constraints, target };
}

// ---- max_agents ---------------------------------------------------------------------------------

function solveMaxAgents(c: ConstantSet, req: ReverseRequest): Solved {
  const groups = req.hardware.groups;
  const fleet = expand(groups, 'fleet');
  const redundancy = num(c, 'fleet.redundancy_nodes');
  const active = Math.max(0, fleet.length - redundancy);
  const fleetMem = Math.min(...fleet.map((n) => n.ramGb), Infinity);
  const rows = fleetTable(c);
  const byMem = [...rows].reverse().find((r) => r.fleetMemGb <= fleetMem);
  const memMax = byMem ? byMem.agents * active : 0;

  const hot = expand(groups, 'hot');
  const hotRam = hot.reduce((s, n) => s + n.ramGb, 0);
  const hotVcpu = hot.reduce((s, n) => s + n.vcpu, 0);
  const byHot = [...rows].reverse().find((r) => r.hotRamGb <= hotRam && r.hotVcpu <= hotVcpu);
  const hotMax = byHot?.agents ?? 0;

  const constraints = [
    constraint('fleet', memMax, 'agents', [
      step('Fleet Servers serving agents', `${fleet.length} − ${redundancy} redundancy (D7)`, active, ['fleet.redundancy_nodes']),
      step('Fleet table row for memory', fleet.length ? `largest row with Fleet memory ≤ ${fmt(fleetMem)} GB → ${fmt(byMem?.agents ?? 0, 0)}` : 'no Fleet Servers', byMem?.agents ?? 0, ['fleet.table']),
      step('max agents (Fleet Server)', `${fmt(byMem?.agents ?? 0, 0)} × ${active}`, memMax, []),
    ]),
    constraint('fleet', hotMax, 'agents', [
      step('hot tier total', `${fmt(hotRam)} GB / ${fmt(hotVcpu)} vCPU`, hotRam, []),
      step('max agents (hot-tier floor)', `largest row with hot floor ≤ ${fmt(hotRam)} GB / ${fmt(hotVcpu)} vCPU`, hotMax, ['fleet.table']),
    ], { tier: 'hot' }),
  ];
  return { value: Math.min(memMax, hotMax), unit: 'agents', constraints };
}

// ---- max_vectors --------------------------------------------------------------------------------

function solveMaxVectors(c: ConstantSet, req: ReverseRequest): Solved {
  const target = pickTarget(req, (p) => p.vector !== undefined);
  if (!target?.vector) throw new Error('max_vectors needs a fixed workload with vector dims and quantization');
  const groups = req.hardware.groups;
  let tier = placementTier(target);
  if (expand(groups, tier).length === 0) tier = expand(groups, 'hot').length > 0 ? 'hot' : tier;
  const nodes = expand(groups, tier);
  const v = target.vector;
  const cost = vectorCost(c, v.dims, v.quant, v.hnswM);
  const rep = replicasFor(target, tier);
  const others = req.fixed.filter((p) => p !== target);
  const otherDemand = computeDemand(c, others, { growthYears: 0, ccrMultiplier: 1 }).get(tier);

  const budget = sumExceptLargest(nodes, (n) => offheapBudgetGb(c, n.ramGb, n.heapOverride));
  const freeOff = budget - (otherDemand?.offheapGb ?? 0);
  const byOffheap = Math.max(0, floorEps((freeOff * 1e9) / (cost.offheapBytes * (rep + 1))));
  const sample = nodes[0];

  const cap = tierCapacity(c, groups, tier, req.hardware.memDiskRatio, req.frozenCacheFraction);
  const overhead = num(c, 'storage_overhead');
  const freeDisk = cap.usableGb / overhead - (otherDemand?.dataGb ?? 0);
  const byDisk = Math.max(0, floorEps((freeDisk * 1e9) / (cost.diskBytes * (rep + 1))));

  const constraints = [
    constraint('vector_offheap', byOffheap, 'vectors', [
      step('off-heap budget (N−1)', sample ? `${nodes.length - 1} × (${fmt(sample.ramGb)} − ${fmt(heapGb(c, sample.ramGb, sample.heapOverride))} heap − ${num(c, 'offheap_reserve_gb')})` : 'no nodes', budget, ['heap_fraction', 'heap_cap_gb', 'offheap_reserve_gb']),
      step(`bytes per vector (${v.quant})`, `${cost.expr}, d = ${v.dims}`, cost.offheapBytes, cost.keys),
      step('max vectors (off-heap)', `${fmt(freeOff)}e9 / (${fmt(cost.offheapBytes)} × (${rep} + 1))`, byOffheap, []),
    ], { tier, ...(v.quant === 'bbq_disk' ? { confidence: 'low' as const } : {}) }),
    constraint(cap.diskBound ? 'disk' : 'storage', byDisk, 'vectors', [
      ...cap.math,
      step('max vectors (disk)', `${fmt(freeDisk)}e9 / (${fmt(cost.diskBytes)} × (${rep} + 1))`, byDisk, ['storage_overhead', ...cost.keys]),
    ], { tier }),
  ];
  return { value: Math.min(byOffheap, byDisk), unit: 'vectors', constraints, target };
}

// ---- max_shards ---------------------------------------------------------------------------------

function solveMaxShards(c: ConstantSet, req: ReverseRequest): Solved {
  const groups = req.hardware.groups;
  const nonFrozen = groups.filter((g) => DATA_TIERS.has(g.role) && g.role !== 'frozen').reduce((s, g) => s + g.count, 0);
  const limit = num(c, 'max_shards_per_nonfrozen_node');
  const maxShards = Math.max(0, nonFrozen - 1) * limit;

  const masters = expand(groups, 'master');
  const heapSource = masters.length ? masters : expand(groups, 'hot').concat(expand(groups, 'content'));
  const masterHeap = heapSource.length ? Math.min(...heapSource.map((n) => heapGb(c, n.ramGb, n.heapOverride))) : 0;
  const perGb = num(c, 'master_indices_per_gb_heap');
  const maxIndices = masterHeap * perGb;

  const constraints = [
    constraint('heap_shards', maxShards, 'shards', [step('max shards (N−1)', `(${nonFrozen} − 1) × ${limit}`, maxShards, ['max_shards_per_nonfrozen_node'])]),
    constraint('masters', maxIndices, 'indices', [step('max indices (master heap)', `${fmt(masterHeap)} GB heap × ${perGb}${masters.length ? '' : ' (co-located masters)'}`, maxIndices, ['master_indices_per_gb_heap', 'heap_fraction', 'heap_cap_gb'])]),
  ];

  // D18: translate into data streams shaped like the target workload.
  const target = pickTarget(req, (p) => retentionTiers(p).length > 0);
  let dataStreams: number | undefined;
  if (target) {
    const one = estimateShards(c, [target], 0);
    const byShards = one.nonFrozenShards > 0 ? floorEps(maxShards / one.nonFrozenShards) : Infinity;
    const byIndices = one.indices > 0 ? floorEps(maxIndices / one.indices) : Infinity;
    dataStreams = Math.min(byShards, byIndices);
    constraints[0]!.math.push(step('data streams (shards)', `floor(${fmt(maxShards, 0)} / ${fmt(one.nonFrozenShards, 0)} shards per stream)`, byShards, ['datastream.default_rollover_days', 'datastream.default_primary_shards']));
    constraints[1]!.math.push(step('data streams (indices)', `floor(${fmt(maxIndices, 0)} / ${fmt(one.indices, 0)} indices per stream)`, byIndices, []));
    // capacity carries the data-stream limit of each constraint; maxValue keeps shards / indices.
    constraints[0]!.capacity = byShards;
    constraints[1]!.capacity = byIndices;
  }
  // Shards and indices are different units; the binding one is whichever limits data streams.
  const bindingIndex = dataStreams !== undefined && constraints[1]!.capacity < constraints[0]!.capacity ? 1 : 0;
  return {
    value: maxShards, unit: 'shards', constraints, bindingIndex,
    ...(dataStreams !== undefined ? { dataStreams } : {}), ...(target ? { target } : {}),
  };
}

// ---- years_to_capacity (D24) --------------------------------------------------------------------

/**
 * Years until compound growth outgrows the hardware: the largest t where the target at
 * GB/day × (1 + g)^t still fits beside the other workloads grown by t. Found by bisection on
 * the max-GB/day solver, which is monotone in t because growth rates are non-negative.
 */
function solveYearsToCapacity(c: ConstantSet, req: ReverseRequest): Solved {
  const target = pickTarget(req, (p) => (p.rawGbPerDay ?? 0) > 0 && retentionTiers(p).length > 0);
  if (!target?.rawGbPerDay) throw new Error("years_to_capacity needs a fixed workload with today's GB/day and retention");
  const gbToday = target.rawGbPerDay;
  const scoped: ReverseRequest = { ...req, targetProfileId: target.id };
  const at = (t: number) => solveMaxGbDay(c, scoped, t);
  const demandAt = (t: number) => gbToday * growthFactor(target, t);
  const fits = (t: number) => at(t).value >= demandAt(t);
  const CAP_YEARS = 100;
  const anyGrowth = req.fixed.some((p) => (p.growthPctPerYear ?? 0) > 0);

  const done = (t: number, notes: string[] = []): Solved => {
    const s = at(Number.isFinite(t) ? t : 0);
    return {
      value: t, unit: 'years', constraints: s.constraints, target,
      utilizationDemand: demandAt(Number.isFinite(t) ? t : 0), atYears: Number.isFinite(t) ? t : 0,
      notes: [`Growth compounds yearly from today's ${fmt(gbToday)} GB/day; other workloads grow at their own rates.`, ...notes],
    };
  };

  if (!fits(0)) return done(0, ['Already over capacity today: the answer is 0 years.']);
  if (!anyGrowth) return done(Infinity, ['No growth rate set on any workload, so this hardware never fills.']);
  if (fits(CAP_YEARS)) return done(Infinity, [`Still fits after ${CAP_YEARS} years at these growth rates.`]);
  let lo = 0;
  let hi = 1;
  while (fits(hi)) { lo = hi; hi *= 2; }
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (fits(mid)) lo = mid; else hi = mid;
  }
  return done(lo);
}

// ---- max_ml_jobs --------------------------------------------------------------------------------

function solveMaxMlJobs(c: ConstantSet, req: ReverseRequest): Solved {
  const ml = expand(req.hardware.groups, 'ml');
  const per = num(c, 'ml.jobs_per_node');
  const max = Math.max(0, ml.length - 1) * per;
  return {
    value: max, unit: 'jobs',
    constraints: [constraint('ml', max, 'jobs', [step('max ML jobs (N−1)', `(${ml.length} − 1) × ${per}`, max, ['ml.jobs_per_node'])])],
  };
}

// ---- entry point --------------------------------------------------------------------------------

const SOLVERS = {
  max_gb_day: solveMaxGbDay,
  max_retention: solveMaxRetention,
  max_agents: solveMaxAgents,
  max_vectors: solveMaxVectors,
  max_shards: solveMaxShards,
  max_ml_jobs: solveMaxMlJobs,
  years_to_capacity: solveYearsToCapacity,
} as const;

/** SPEC §5.3 reverse (capacity) mode: hardware → maximum supportable workload, with the binding constraint. */
export function reverse(req: ReverseRequest, c: ConstantSet = defaultConstants): SizingResult {
  frozenCacheFraction(c, req.frozenCacheFraction);
  const solved = SOLVERS[req.solve](c, req);
  const constraints = solved.constraints;

  // Binding = lowest max (SPEC §5.8), unless the solver ranked constraints itself.
  const binding = solved.bindingIndex !== undefined
    ? constraints[solved.bindingIndex]!
    : constraints.reduce((best, k) => (k.maxValue! < best.maxValue! ? k : best), constraints[0]!);
  binding.binding = true;
  for (const k of constraints) {
    const demand = solved.utilizationDemand ?? solved.value;
    if (k.maxValue !== undefined && req.solve !== 'max_shards') k.utilization = k.maxValue > 0 ? demand / k.maxValue : Infinity;
  }

  const groups = req.hardware.groups;
  const tiers: TierResult[] = groups.filter((g) => DATA_TIERS.has(g.role)).map((g) => ({
    tier: g.role as Tier, nodes: g.count, ramGb: g.ramGb, diskGb: g.diskGb, vcpu: g.vcpu, math: [],
  }));
  const counted = c.byKey.get('eru.counted_components')!.value as Record<string, boolean>;
  const overhead: OverheadResult[] = groups.filter((g) => !DATA_TIERS.has(g.role)).map((g) => ({
    ...g,
    countsTowardLicense: g.role === 'kibana' ? counted.kibana ?? true : g.role === 'apm' ? counted.apm ?? true : g.role === 'fleet' ? counted.fleet ?? false : counted.elasticsearch ?? true,
    math: [],
  }));
  const { totalRamGb, totalRamMath } = totalsFor(c, tiers, overhead);
  const eru = selfManagedEru(c, totalRamGb);
  const sites = Math.max(1, req.hardware.sites ?? 1);
  const allRam = totalRamGb * sites;
  const floor = licenseFloor(c, {
    hasFrozen: groups.some((g) => g.role === 'frozen' && g.count > 0),
    hasMl: groups.some((g) => g.role === 'ml' && g.count > 0),
    ccr: req.hardware.ccr ?? false,
    fips: req.fips ?? false,
    fullLogsdb: req.fullLogsdb ?? false,
    profiles: req.fixed,
  });

  // Validate the hardware at the solved maximum (HV7 uses projected data).
  const atMax = workloadsAtMax(req, solved);
  const demand = computeDemand(c, atMax, { growthYears: 0, ccrMultiplier: 1 });
  const dataGbByTier: Partial<Record<Tier, number>> = {};
  for (const [t, d] of demand) dataGbByTier[t] = d.dataGb;
  const objectStorage = objectStorageFor(demand);
  const replicasByTier: Partial<Record<Tier, number>> = {};
  for (const p of atMax) {
    for (const t of new Set<Tier>([...retentionTiers(p), ...(p.totalGb || p.vector ? [placementTier(p)] : [])])) {
      replicasByTier[t] = Math.max(replicasByTier[t] ?? 0, replicasFor(p, t));
    }
  }
  const agents = req.solve === 'max_agents' ? solved.value : atMax.reduce((s, p) => s + (p.fleet?.agents ?? 0), 0);
  const airGapped = req.hardware.airGapped ?? req.fixed.some((p) => p.airGapped);
  const warnings = [
    ...validateHardware(c, {
      groups, airGapped, autoOps: req.hardware.autoOps ?? false, replicasByTier, agents,
      shards: estimateShards(c, atMax, 0), dataGbByTier, ratioOverrides: req.hardware.memDiskRatio ?? {},
    }),
    ...commonWarnings(req.hardware.model),
  ];

  const assumptions = [
    'N−1: the largest node in each tier is removed before inverting (SPEC §5.3).',
    ...(solved.notes ?? []),
    ...[describeOverrides(req.hardware.memDiskRatio ?? {})].filter((x): x is string => !!x),
    ...buildAssumptions(c, { sites, ccrMode: req.hardware.ccr ? 'unidirectional' : 'none', growthYears: 0, airGapped }),
    ...objectStorageAssumption(objectStorage),
  ];

  return {
    engineVersion: ENGINE_VERSION,
    constantsHash: c.hash,
    mode: 'reverse',
    tiers,
    overhead,
    totalRamGb,
    totalRamMath,
    licenseUnits: { unit: 'ERU', value: eru.value, math: eru.math },
    licenseFloor: floor.floor,
    licenseFloorReasons: floor.reasons,
    sites,
    allSites: { totalRamGb: allRam, licenseUnits: selfManagedEru(c, allRam).value },
    constraints,
    warnings,
    assumptions,
    ...(objectStorage ? { objectStorage } : {}),
    answer: {
      solve: req.solve,
      value: solved.value,
      unit: solved.unit,
      binding: binding.name,
      ...(binding.tier ? { bindingTier: binding.tier } : {}),
      confidence: binding.confidence,
      ...(solved.dataStreams !== undefined ? { dataStreams: solved.dataStreams } : {}),
    },
  };
}

/** The fixed workloads with the solved variable substituted, for validation at max workload. */
function workloadsAtMax(req: ReverseRequest, solved: Solved): WorkloadProfile[] {
  // years_to_capacity: validate every workload as it will be at the answer.
  if (solved.atYears !== undefined) {
    return req.fixed.map((p) => (p.rawGbPerDay ? { ...p, rawGbPerDay: p.rawGbPerDay * growthFactor(p, solved.atYears!) } : p));
  }
  const t = solved.target;
  if (!t || !Number.isFinite(solved.value)) return req.fixed;
  const swap = (p: WorkloadProfile): WorkloadProfile => {
    if (p !== t) return p;
    if (req.solve === 'max_gb_day') return { ...p, rawGbPerDay: solved.value };
    if (req.solve === 'max_retention') {
      const tier = req.targetTier ?? retentionTiers(p)[0] ?? 'hot';
      return { ...p, retentionDays: { ...p.retentionDays, [tier]: solved.value } };
    }
    if (req.solve === 'max_vectors' && p.vector) return { ...p, vector: { ...p.vector, count: solved.value } };
    return p;
  };
  return req.fixed.map(swap);
}
