import { defaultConstants, num, type ConstantSet } from '@sizing/constants';
import { CONFIDENCE, markBindingForward, RALLY_REQUIRED } from './confidence.ts';
import { ingestDemandEvents } from './cpu.ts';
import { computeDemand, estimateShards, type TierDemand } from './demand.ts';
import { selfManagedEru, licenseFloor } from './license.ts';
import { ceilEps, fmt, step } from './math.ts';
import { computeOverhead, fleetRowFor } from './overhead.ts';
import { heapGb, memDiskKey, offheapBudgetGb, replicasFor, retentionTiers, placementTier } from './profiles.ts';
import { buildAssumptions, commonWarnings, ENGINE_VERSION, totalsFor } from './result.ts';
import {
  TIERS, type Constraint, type ForwardOptions, type ForwardRequest, type NodeGroup, type SizingResult, type Tier,
  type TierResult, type WorkloadProfile,
} from './types.ts';
import { validateHardware } from './validation.ts';

export interface ResolvedNode {
  ramGb: number;
  diskGb: number;
  vcpu: number;
  diskType: NodeGroup['diskType'];
  ratio: number;
  /** Per-node storage capacity: min(RAM × ratio, disk). Frozen: RAM × 1500 of object-store data. */
  capacityGb: number;
  diskBound: boolean;
}

/** D8/D11/D20: fill a tier's node template from constants. */
export function resolveNode(c: ConstantSet, tier: Tier, opts: ForwardOptions): ResolvedNode {
  const t = opts.nodes?.[tier] ?? {};
  const ramGb = t.ramGb ?? num(c, 'node_ram_default_gb');
  const ratio = num(c, memDiskKey(tier));
  // D20: frozen local disk is a shared cache; default it at the hot ratio.
  const diskGb = t.diskGb ?? ramGb * (tier === 'frozen' ? num(c, 'mem_disk.hot') : ratio);
  const vcpu = t.vcpu ?? ramGb * num(c, 'vcpu_per_ram_gb');
  if (tier === 'frozen') {
    return { ramGb, diskGb, vcpu, diskType: t.diskType ?? 'ssd', ratio, capacityGb: ramGb * ratio, diskBound: false };
  }
  const byRam = ramGb * ratio;
  return {
    ramGb, diskGb, vcpu, diskType: t.diskType ?? (tier === 'hot' || tier === 'content' ? 'nvme' : 'ssd'),
    ratio, capacityGb: Math.min(byRam, diskGb), diskBound: diskGb < byRam,
  };
}

function sizeTier(c: ConstantSet, d: TierDemand, node: ResolvedNode, constraints: Constraint[]): TierResult {
  const failover = num(c, 'failover_nodes_per_tier');
  const math = [...d.math];
  const ratioKey = memDiskKey(d.tier);
  let storageNodes = 0;

  if (d.tier === 'frozen') {
    const perNode = node.ramGb * node.ratio;
    storageNodes = ceilEps(d.dataGb / perNode);
    math.push(step('frozen data per node', `${fmt(node.ramGb)} GB RAM × ${node.ratio}`, perNode, [ratioKey]));
    math.push(step('frozen nodes before failover', `ROUNDUP(${fmt(d.dataGb)} / ${fmt(perNode)})`, storageNodes, []));
    constraints.push({
      name: 'frozen', tier: 'frozen', capacity: 0, demand: d.dataGb, unit: 'GB', confidence: CONFIDENCE.frozen, binding: false, math: [],
    });
  } else if (d.dataGb > 0) {
    const overhead = num(c, 'storage_overhead');
    const storage = d.dataGb * overhead;
    storageNodes = ceilEps(storage / node.capacityGb);
    math.push(step('total storage GB', `${fmt(d.dataGb)} × ${overhead} (15% watermark + 10% margin)`, storage, ['storage_overhead']));
    math.push(step('node capacity GB', node.diskBound
      ? `min(${fmt(node.ramGb)} × ${node.ratio}, ${fmt(node.diskGb)} disk) = disk`
      : `min(${fmt(node.ramGb)} GB × ${node.ratio}, ${fmt(node.diskGb)} GB disk)`, node.capacityGb, [ratioKey]));
    math.push(step('nodes for storage', `ROUNDUP(${fmt(storage)} / ${fmt(node.capacityGb)})`, storageNodes, []));
    constraints.push({
      name: node.diskBound ? 'disk' : 'storage', tier: d.tier, capacity: 0, demand: storage, unit: 'GB',
      confidence: CONFIDENCE.storage, binding: false, math: [],
    });
  }

  let vectorNodes = 0;
  if (d.offheapGb > 0) {
    const budget = offheapBudgetGb(c, node.ramGb);
    vectorNodes = ceilEps(d.offheapGb / budget);
    math.push(step('off-heap budget per node', `${fmt(node.ramGb)} − ${fmt(heapGb(c, node.ramGb))} heap − ${num(c, 'offheap_reserve_gb')}`, budget, ['heap_fraction', 'heap_cap_gb', 'offheap_reserve_gb']));
    math.push(step('nodes for vectors', `ROUNDUP(${fmt(d.offheapGb)} / ${fmt(budget)})`, vectorNodes, []));
    constraints.push({
      name: 'vector_offheap', tier: d.tier, capacity: 0, demand: d.offheapGb, unit: 'GB',
      confidence: CONFIDENCE.vector_offheap, binding: false, math: [],
    });
  }

  const base = Math.max(storageNodes, vectorNodes);
  const nodes = base + failover;
  math.push(step(`${d.tier} nodes`, `${vectorNodes > 0 && storageNodes > 0 ? `max(${storageNodes}, ${vectorNodes})` : base} + ${failover} failover`, nodes, ['failover_nodes_per_tier']));

  // Fill capacities now that the node count is known: usable = nodes − failover.
  for (const k of constraints) {
    if (k.tier !== d.tier || k.capacity !== 0) continue;
    if (k.name === 'vector_offheap') k.capacity = base * offheapBudgetGb(c, node.ramGb);
    else if (k.name === 'frozen') k.capacity = base * node.ramGb * node.ratio;
    else k.capacity = base * node.capacityGb;
    k.utilization = k.capacity > 0 ? k.demand! / k.capacity : 0;
    k.math = [step(`${k.name} utilization (${d.tier})`, `${fmt(k.demand!)} / ${fmt(k.capacity)} (${base} usable nodes)`, k.utilization, [])];
  }

  return { tier: d.tier, nodes, ramGb: node.ramGb, diskGb: node.diskGb, vcpu: node.vcpu, math };
}

/** SPEC §5.1–5.2 forward sizing: workload → hardware. Pure; constants default to the shipped set. */
export function forward(req: ForwardRequest, c: ConstantSet = defaultConstants): SizingResult {
  const opts = req.options;
  const profiles = req.workloads;
  const sites = Math.max(1, opts.sites ?? 1);
  const ccrMode = opts.ccrMode ?? 'none';
  const growthYears = opts.growthHorizonYears ?? num(c, 'growth.default_horizon_years');
  const ccrMultiplier = ccrMode === 'bidirectional' ? sites : 1;
  const demand = computeDemand(c, profiles, { growthYears, ccrMultiplier });

  const constraints: Constraint[] = [];
  const tiers: TierResult[] = [];
  const nodesByTier = new Map<Tier, ResolvedNode>();
  for (const tier of TIERS) {
    const d = demand.get(tier);
    if (!d || (d.dataGb <= 0 && d.offheapGb <= 0)) continue;
    const node = resolveNode(c, tier, opts);
    nodesByTier.set(tier, node);
    tiers.push(sizeTier(c, d, node, constraints));
  }

  const dataNodes = tiers.reduce((s, t) => s + t.nodes, 0);
  const shards = estimateShards(c, profiles, growthYears);
  const overhead = computeOverhead(c, {
    dataNodes, indices: shards.indices, profiles, coordinatingNodes: opts.coordinatingNodes ?? 0,
  });

  const failover = num(c, 'failover_nodes_per_tier');
  const nonFrozen = tiers.filter((t) => t.tier !== 'frozen').reduce((s, t) => s + t.nodes, 0);
  const shardCap = Math.max(0, nonFrozen - failover) * num(c, 'max_shards_per_nonfrozen_node');
  if (shards.nonFrozenShards > 0) {
    constraints.push({
      name: 'heap_shards', capacity: shardCap, demand: shards.nonFrozenShards, utilization: shardCap > 0 ? shards.nonFrozenShards / shardCap : Infinity,
      unit: 'shards', confidence: CONFIDENCE.heap_shards, binding: false,
      math: [step('non-frozen shard capacity', `(${nonFrozen} − ${failover}) × ${num(c, 'max_shards_per_nonfrozen_node')}`, shardCap, ['max_shards_per_nonfrozen_node'])],
    });
  }

  const master = overhead.find((o) => o.role === 'master');
  const firstTier = tiers[0];
  const masterHeap = master ? heapGb(c, master.ramGb) : firstTier ? heapGb(c, firstTier.ramGb) : 0;
  if (shards.indices > 0 && masterHeap > 0) {
    const cap = masterHeap * num(c, 'master_indices_per_gb_heap');
    constraints.push({
      name: 'masters', capacity: cap, demand: shards.indices, utilization: shards.indices / cap, unit: 'indices',
      confidence: CONFIDENCE.masters, binding: false,
      math: [step('indices masters can manage', `${fmt(masterHeap)} GB heap × ${num(c, 'master_indices_per_gb_heap')}${master ? '' : ' (co-located)'}`, cap, ['master_indices_per_gb_heap', 'heap_fraction', 'heap_cap_gb'])],
    });
  }

  // CPU / ingest (Low confidence, Rally required).
  const ingestTier: Tier | undefined = tiers.find((t) => t.tier === 'hot')?.tier ?? tiers.find((t) => t.tier === 'content')?.tier;
  if (ingestTier) {
    const t = tiers.find((x) => x.tier === ingestTier)!;
    const usableVcpu = Math.max(0, t.nodes - failover) * t.vcpu;
    const ev = num(c, 'ev_per_s_per_vcpu');
    const capacity = usableVcpu * ev;
    const demandEv = profiles
      .filter((p) => retentionTiers(p).includes(ingestTier) || (p.rawGbPerDay && placementTier(p) === ingestTier))
      .reduce((s, p) => s + ingestDemandEvents(c, p, ingestTier, growthYears, opts.concurrentSearch ?? false), 0) * ccrMultiplier;
    if (demandEv > 0) {
      constraints.push({
        name: 'cpu_ingest', tier: ingestTier, capacity, demand: demandEv, utilization: capacity > 0 ? demandEv / capacity : Infinity,
        unit: 'events/s', confidence: CONFIDENCE.cpu_ingest, binding: false, rallyRequired: true,
        math: [
          step('usable vCPU', `(${t.nodes} − ${failover}) × ${fmt(t.vcpu)}`, usableVcpu, ['vcpu_per_ram_gb']),
          step('indexing capacity (events/s)', `${fmt(usableVcpu)} × ${ev}`, capacity, ['ev_per_s_per_vcpu']),
          step('indexing demand (events/s, incl. replicas and derates)', 'Σ GB/day × 1e6 / (KB × 86,400) × (replicas + 1) / derate', demandEv, ['ingest.default_avg_event_kb', 'ingest.derate.pipelines', 'ingest.derate.logsdb', 'ingest.derate.concurrent_search']),
        ],
      });
    }
  }

  const agents = profiles.reduce((s, p) => s + (p.fleet?.agents ?? 0), 0);
  const fleet = overhead.find((o) => o.role === 'fleet');
  if (agents > 0 && fleet) {
    const cap = fleetRowFor(c, agents).agents * (fleet.count - num(c, 'fleet.redundancy_nodes'));
    constraints.push({
      name: 'fleet', capacity: cap, demand: agents, utilization: agents / cap, unit: 'agents', confidence: CONFIDENCE.fleet,
      binding: false, math: fleet.math,
    });
  }

  const ml = overhead.find((o) => o.role === 'ml');
  const jobs = profiles.reduce((s, p) => s + (p.ml?.anomalyJobs ?? 0), 0);
  if (ml && jobs > 0) {
    const cap = (ml.count - failover) * num(c, 'ml.jobs_per_node');
    constraints.push({
      name: 'ml', capacity: cap, demand: jobs, utilization: jobs / cap, unit: 'jobs', confidence: CONFIDENCE.ml, binding: false,
      math: [step('ML job capacity', `(${ml.count} − ${failover}) × ${num(c, 'ml.jobs_per_node')}`, cap, ['ml.jobs_per_node'])],
    });
  }

  constraints.push({
    name: 'query', capacity: 0, unit: 'queries/s', confidence: CONFIDENCE.query, binding: false, rallyRequired: true,
    math: [step('query capacity', 'not modeled: requires Rally with customer queries', 0, [])],
  });
  for (const k of constraints) if (RALLY_REQUIRED.has(k.name)) k.rallyRequired = true;
  markBindingForward(constraints);

  const { totalRamGb, totalRamMath } = totalsFor(c, tiers, overhead);
  const eru = selfManagedEru(c, totalRamGb);
  const allRam = totalRamGb * sites;
  const floor = licenseFloor(c, {
    hasFrozen: tiers.some((t) => t.tier === 'frozen' && t.nodes > 0),
    hasMl: overhead.some((o) => o.role === 'ml'),
    ccr: ccrMode !== 'none',
    fips: opts.fips ?? false,
    fullLogsdb: opts.fullLogsdb ?? false,
    profiles,
  });

  const groups: NodeGroup[] = [
    ...tiers.map((t) => ({ role: t.tier, count: t.nodes, ramGb: t.ramGb, diskGb: t.diskGb, diskType: nodesByTier.get(t.tier)!.diskType, vcpu: t.vcpu })),
    ...overhead,
  ];
  const replicasByTier: Partial<Record<Tier, number>> = {};
  for (const p of profiles) {
    const used = new Set<Tier>([...retentionTiers(p), ...(p.totalGb || p.vector ? [placementTier(p)] : [])]);
    for (const t of used) replicasByTier[t] = Math.max(replicasByTier[t] ?? 0, replicasFor(p, t));
  }
  const dataGbByTier: Partial<Record<Tier, number>> = {};
  for (const [t, d] of demand) dataGbByTier[t] = d.dataGb;
  const airGapped = opts.airGapped ?? profiles.some((p) => p.airGapped);

  const warnings = [
    ...validateHardware(c, {
      groups, airGapped, autoOps: opts.autoOps ?? false, replicasByTier, agents, shards, dataGbByTier,
    }),
    ...commonWarnings(opts.model),
  ];

  return {
    engineVersion: ENGINE_VERSION,
    constantsHash: c.hash,
    mode: 'forward',
    tiers,
    overhead,
    totalRamGb,
    totalRamMath,
    licenseUnits: { unit: 'ERU', value: eru.value, math: eru.math },
    licenseFloor: floor.floor,
    licenseFloorReasons: floor.reasons,
    sites,
    allSites: { totalRamGb: allRam, licenseUnits: selfManagedEru(c, allRam).value },
    shards: {
      total: shards.nonFrozenShards + shards.frozenShards,
      perNonFrozenNode: nonFrozen > 0 ? shards.nonFrozenShards / nonFrozen : 0,
      indices: shards.indices,
      math: [step('non-frozen shards', 'Σ ROUNDUP(days / rollover) × primaries × (replicas + 1)', shards.nonFrozenShards, ['datastream.default_rollover_days', 'datastream.default_primary_shards'])],
    },
    constraints,
    warnings,
    assumptions: buildAssumptions(c, { sites, ccrMode, growthYears, airGapped, growthUsed: profiles.some((p) => (p.growthPctPerYear ?? 0) !== 0) }),
  };
}

export type { WorkloadProfile };
