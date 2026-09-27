import { defaultConstants, num, type ConstantSet } from '@sizing/constants';
import { forward } from './forward.ts';
import { ceilEps, fmt, step } from './math.ts';
import type {
  DiskType, ForwardOptions, MathStep, NodeGroup, NodeTemplate, SizingResult, Tier, WorkloadProfile,
} from './types.ts';

// D32: several self-managed clusters (sites) on physical servers.

/** How the sites relate. Decides which workloads' data each site must hold. */
export type SiteRelationship = 'independent' | 'dr' | 'active_active';

/** Identical physical servers at one site, all doing one role. */
export interface ServerGroup {
  role: NodeGroup['role'];
  count: number;
  ramGb: number;
  diskGb: number;
  diskType: DiskType;
  vcpu: number;
  /** Elasticsearch nodes per server. Blank = RAM ÷ node_ram_practical_max_gb for data and master roles, else 1. */
  nodesPerServer?: number;
  /** Sustained write throughput per server in MB/s (split evenly across its nodes). */
  diskWriteMBps?: number;
}

export interface SiteInput {
  name: string;
  /** Workloads this site ingests itself. */
  workloads: WorkloadProfile[];
  servers: ServerGroup[];
}

/** D33: how Elasticsearch runs on the servers. Decides node layout, overhead and licensing. */
export type HostModel = 'self_managed' | 'eck' | 'ece';

export interface TopologyRequest {
  relationship: SiteRelationship;
  /** D33: default self_managed. */
  hostModel?: HostModel;
  sites: SiteInput[];
  /** Scenario options shared by every site (model, air-gapped, FIPS, ratios...). Node sizes come from the servers. */
  options: ForwardOptions;
  /** DR only: the site that ingests; the others hold its data as standbys. Default 0. */
  leader?: number;
}

export interface RoleFit {
  role: NodeGroup['role'];
  /** Nodes the sizing needs, failover included (data tiers) or the role's count (other roles). */
  neededNodes: number;
  nodesPerServer: number;
  neededServers: number;
  availableServers: number;
  /** ok = fits; short = not enough servers; missing = data needs this tier but no servers are listed;
   *  unplaced = a supporting role with no servers listed (not a shortfall); idle = servers with nothing to do. */
  status: 'ok' | 'short' | 'missing' | 'unplaced' | 'idle';
  fits: boolean;
  math: MathStep[];
}

export interface SiteResult {
  name: string;
  /** License units under the request's host model (self-managed ERU, ECK pod GiB, ECE allocator capacity). */
  license: { eru: number; math: MathStep[] };
  /** Workload IDs this site holds; followed data is prefixed with the source site. */
  holds: string[];
  result: SizingResult;
  fit: RoleFit[];
  fits: boolean;
}

export interface TopologyResult {
  relationship: SiteRelationship;
  sites: SiteResult[];
  fitsAll: boolean;
  totals: { ramGb: number; eru: number; objectStorageGb: number; neededServers: number; availableServers: number };
  /** Largest multiple of today's data volume that still fits every site, and where it runs out. */
  headroom?: { scale: number; binding?: { site: string; role: string }; math: MathStep[] };
  assumptions: string[];
}

const DATA_TIERS = new Set<string>(['hot', 'warm', 'cold', 'frozen', 'content']);
const SINGLE_NODE_ROLES = new Set<string>(['frozen', 'ml', 'master', 'kibana', 'fleet', 'apm']);
/** Roles whose instances must sit on different servers: masters for quorum, the rest as HA pairs. */
const SPREAD_ROLES = new Set<string>(['master', 'kibana', 'fleet', 'apm']);

/**
 * Nodes on one server. Data servers are split into nodes of at most node_ram_practical_max_gb (HV1);
 * frozen and ML may exceed it; masters and supporting services run once per server so losing a server
 * costs one master vote or one member of an HA pair.
 */
export function nodesPerServer(c: ConstantSet, g: ServerGroup): number {
  if (g.nodesPerServer !== undefined) {
    if (!(Number.isInteger(g.nodesPerServer) && g.nodesPerServer >= 1)) {
      throw new Error(`${g.role} nodes per server must be a whole number of at least 1; got ${g.nodesPerServer}.`);
    }
    return g.nodesPerServer;
  }
  if (SINGLE_NODE_ROLES.has(g.role)) return 1;
  return Math.max(1, Math.floor(g.ramGb / num(c, 'node_ram_practical_max_gb') + 1e-9));
}

export interface ServerLayout {
  /** Elasticsearch nodes (processes, pods or instances) per server. */
  nodes: number;
  nodeRamGb: number;
  nodeDiskGb: number;
  nodeVcpu: number;
  /** RAM available to Elasticsearch on the server after the model's own overhead. */
  usableRamGb: number;
  expr: string;
  keys: string[];
}

/** 1 GiB = 2^30 bytes; the engine's GB are 10^9 bytes. */
export const gbToGib = (gb: number) => (gb * 1e9) / 2 ** 30;
export const gibToGb = (gib: number) => (gib * 2 ** 30) / 1e9;

/**
 * D33: how one server is carved up under each host model.
 * - self_managed: RAM ÷ node_ram_practical_max_gb nodes (data and master roles), else 1.
 * - eck: RAM minus the Kubernetes reserve, split into pods of at most node_ram_practical_max_gb.
 * - ece: allocator planned to ece.allocator_planning_fraction of RAM; instances of at most node_ram_practical_max_gb.
 * A nodes-per-server value on the row always wins.
 */
export function serverLayout(c: ConstantSet, g: ServerGroup, model: HostModel = 'self_managed'): ServerLayout {
  const max = num(c, 'node_ram_practical_max_gb');
  const explicit = g.nodesPerServer !== undefined ? nodesPerServer(c, g) : undefined;
  const single = SINGLE_NODE_ROLES.has(g.role);
  if (model === 'eck') {
    const reserve = num(c, 'eck.k8s_reserve_ram_gb');
    const vReserve = num(c, 'eck.k8s_reserve_vcpu');
    const usable = Math.max(0, g.ramGb - reserve);
    const n = explicit ?? (single ? 1 : Math.max(1, ceilEps(usable / max)));
    return {
      nodes: n, nodeRamGb: usable / n, nodeDiskGb: g.diskGb / n, nodeVcpu: Math.max(0, g.vcpu - vReserve) / n, usableRamGb: usable,
      expr: `(${fmt(g.ramGb)} − ${reserve} GB Kubernetes reserve) / ${n} pod${n === 1 ? '' : 's'}`,
      keys: ['eck.k8s_reserve_ram_gb', 'eck.k8s_reserve_vcpu', ...(explicit === undefined && !single ? ['node_ram_practical_max_gb'] : [])],
    };
  }
  if (model === 'ece') {
    const plan = num(c, 'ece.allocator_planning_fraction');
    const usable = g.ramGb * plan;
    const n = explicit ?? (single ? 1 : Math.max(1, Math.floor(usable / max + 1e-9)));
    const nodeRam = explicit !== undefined || single ? usable / n : Math.min(max, usable / n);
    return {
      nodes: n, nodeRamGb: nodeRam, nodeDiskGb: g.diskGb / n, nodeVcpu: g.vcpu / n, usableRamGb: usable,
      expr: `${fmt(g.ramGb)} GB × ${plan} planned = ${fmt(usable)} GB → ${n} × ${fmt(nodeRam)} GB instance${n === 1 ? '' : 's'}`,
      keys: ['ece.allocator_planning_fraction', ...(explicit === undefined && !single ? ['node_ram_practical_max_gb'] : [])],
    };
  }
  const n = nodesPerServer(c, g);
  return {
    nodes: n, nodeRamGb: g.ramGb / n, nodeDiskGb: g.diskGb / n, nodeVcpu: g.vcpu / n, usableRamGb: g.ramGb,
    expr: `${fmt(g.ramGb)} GB / ${n} node${n === 1 ? '' : 's'}`,
    keys: explicit === undefined && !single ? ['node_ram_practical_max_gb'] : [],
  };
}

const MODEL_TEXT: Record<HostModel, (c: ConstantSet) => string> = {
  self_managed: (c) => `Self-managed: data servers split into nodes of at most ${num(c, 'node_ram_practical_max_gb')} GB; frozen, ML, masters, Kibana, Fleet and APM run one node per server unless nodes per server is set.`,
  eck: (c) => `ECK: each server keeps ${num(c, 'eck.k8s_reserve_ram_gb')} GB RAM and ${num(c, 'eck.k8s_reserve_vcpu')} vCPU for Kubernetes; the rest is split into pods of at most ${num(c, 'node_ram_practical_max_gb')} GB. The Kubernetes control plane is not counted.`,
  ece: (c) => `ECE: master-role servers are the ${num(c, 'ece.control_plane_hosts')} control-plane hosts (${num(c, 'ece.control_plane_ram_gb')} GB each for coordinator, director and proxy); allocators are planned to ${num(c, 'ece.allocator_planning_fraction') * 100}% of RAM with instances of at most ${num(c, 'node_ram_practical_max_gb')} GB.`,
};

const RELATIONSHIP_TEXT: Record<SiteRelationship, string> = {
  independent: 'Independent clusters: each site holds only the data it ingests.',
  dr: 'Disaster recovery: the primary site ingests; each standby follows it with cross-cluster replication and holds the same data.',
  active_active: 'Active-active: each site ingests its own data and follows the others, so every site holds all sites\' data.',
};

/** The workloads whose data a site must hold, with followed data labelled by its source site. */
function holdings(req: TopologyRequest, i: number): WorkloadProfile[] {
  const own = req.sites[i]!.workloads;
  const followed = (j: number) => req.sites[j]!.workloads.map((w) => ({ ...w, id: `${req.sites[j]!.name}: ${w.id}` }));
  if (req.relationship === 'independent') return own;
  if (req.relationship === 'dr') {
    const leader = req.leader ?? 0;
    return i === leader ? own : [...own, ...followed(leader)];
  }
  return [...own, ...req.sites.flatMap((_, j) => (j === i ? [] : followed(j)))];
}

/** Forward options for one site: node templates come from that site's servers. */
function siteOptions(c: ConstantSet, req: TopologyRequest, site: SiteInput): ForwardOptions {
  const nodes: Partial<Record<Tier, NodeTemplate>> = { ...(req.options.nodes ?? {}) };
  for (const tier of DATA_TIERS as Set<Tier>) {
    // One server spec per tier: the first group listed for it.
    const g = site.servers.find((x) => x.role === tier && x.count > 0);
    if (!g) continue;
    const l = serverLayout(c, g, req.hostModel);
    const ratio = req.options.nodes?.[tier]?.memDiskRatio;
    nodes[tier] = {
      ...(ratio !== undefined ? { memDiskRatio: ratio } : {}),
      ramGb: l.nodeRamGb, diskGb: l.nodeDiskGb, vcpu: l.nodeVcpu, diskType: g.diskType,
      ...(g.diskWriteMBps !== undefined ? { diskWriteMBps: g.diskWriteMBps / l.nodes } : {}),
    };
  }
  return {
    ...req.options, nodes, sites: 1,
    // Replication between sites is modelled by what each site holds; the mode here only sets the license floor.
    ccrMode: req.relationship === 'independent' ? 'none' : 'unidirectional',
  };
}

function fitFor(c: ConstantSet, result: SizingResult, site: SiteInput, model: HostModel = 'self_managed'): RoleFit[] {
  const failover = num(c, 'failover_nodes_per_tier');
  const out: RoleFit[] = [];
  const serversFor = (role: string) => site.servers.filter((g) => g.role === role && g.count > 0);

  for (const t of result.tiers) {
    if (t.nodes <= 0) continue;
    const groups = serversFor(t.tier);
    const g = groups[0];
    const l = g ? serverLayout(c, g, model) : undefined;
    const nps = l?.nodes ?? 1;
    const available = groups.reduce((s, x) => s + x.count, 0);
    const base = Math.max(0, t.nodes - failover);
    // Failover is a whole server: losing one takes all of its nodes.
    const needed = ceilEps(base / nps) + failover;
    const status = !g ? 'missing' : needed <= available ? 'ok' : 'short';
    out.push({
      role: t.tier, neededNodes: t.nodes, nodesPerServer: nps, neededServers: needed, availableServers: available, status, fits: status === 'ok',
      math: [
        ...(l ? [step(`${t.tier} nodes per server`, l.expr, nps, l.keys)] : []),
        step(`${t.tier} servers needed`, `ROUNDUP(${base} nodes / ${nps} per server) + ${failover} failover server`, needed, ['failover_nodes_per_tier']),
        step(`${t.tier} servers available`, g ? `${available} × ${fmt(g.ramGb)} GB servers` : 'none listed', available, []),
      ],
    });
  }

  // ECE: the master-role servers are the control-plane hosts; ES master instances use what they have left.
  const masterOverhead = result.overhead.find((o) => o.role === 'master' && o.count > 0);
  if (model === 'ece') {
    const groups = serversFor('master');
    const g = groups[0];
    const hosts = num(c, 'ece.control_plane_hosts');
    const cpRam = num(c, 'ece.control_plane_ram_gb');
    const plan = num(c, 'ece.allocator_planning_fraction');
    const available = groups.reduce((s, x) => s + x.count, 0);
    const bigEnough = !!g && g.ramGb >= cpRam;
    const spare = g ? Math.max(0, (g.ramGb - cpRam) * plan) : 0;
    // One master per host: two on one host would lose two votes with it.
    const perHost = masterOverhead ? Math.min(1, Math.floor(spare / masterOverhead.ramGb + 1e-9)) : 0;
    const forMasters = masterOverhead ? (perHost > 0 ? ceilEps(masterOverhead.count / perHost) : Infinity) : 0;
    const needed = Math.max(hosts, forMasters);
    const status = !g ? 'missing' : bigEnough && Number.isFinite(needed) && needed <= available ? 'ok' : 'short';
    out.push({
      role: 'master', neededNodes: masterOverhead?.count ?? 0, nodesPerServer: Math.max(1, perHost), neededServers: Number.isFinite(needed) ? needed : hosts,
      availableServers: available, status, fits: status === 'ok',
      math: [
        step('ECE control plane hosts', `${hosts} hosts, each ≥ ${cpRam} GB (coordinator + director + proxy)${g ? `; listed: ${available} × ${fmt(g.ramGb)} GB` : '; none listed'}`, hosts, ['ece.control_plane_hosts', 'ece.control_plane_ram_gb']),
        ...(masterOverhead ? [step('ES master instances on control-plane hosts', `(${fmt(g?.ramGb ?? 0)} − ${cpRam}) × ${plan} = ${fmt(spare)} GB spare / ${fmt(masterOverhead.ramGb)} GB = ${perHost} per host`, perHost, ['ece.allocator_planning_fraction'])] : []),
      ],
    });
  }

  for (const o of result.overhead) {
    if (o.count <= 0 || (model === 'ece' && o.role === 'master')) continue;
    const groups = serversFor(o.role);
    const g = groups[0];
    const available = groups.reduce((s, x) => s + x.count, 0);
    if (!g) {
      out.push({ role: o.role, neededNodes: o.count, nodesPerServer: 1, neededServers: o.count, availableServers: 0, status: 'unplaced', fits: true,
        math: [step(`${o.role} servers`, `${o.count} needed; no ${o.role} servers listed (co-located or hosted elsewhere)`, o.count, [])] });
      continue;
    }
    // Self-managed runs supporting services per server; ECK and ECE pack pods or instances of the role's size.
    const l = serverLayout(c, g, model);
    const packed = Math.floor(l.usableRamGb / o.ramGb + 1e-9);
    const nps = model === 'self_managed' || g.nodesPerServer !== undefined ? l.nodes
      : SPREAD_ROLES.has(o.role) ? Math.min(1, packed) : packed;
    const needed = nps > 0 ? ceilEps(o.count / nps) : Infinity;
    const status = Number.isFinite(needed) && needed <= available ? 'ok' : 'short';
    out.push({ role: o.role, neededNodes: o.count, nodesPerServer: Math.max(nps, 0), neededServers: Number.isFinite(needed) ? needed : o.count, availableServers: available, status, fits: status === 'ok',
      math: [step(`${o.role} servers needed`, nps > 0 ? `ROUNDUP(${o.count} × ${fmt(o.ramGb)} GB / ${nps} per server)` : `${fmt(o.ramGb)} GB does not fit in ${fmt(l.usableRamGb)} GB usable`, Number.isFinite(needed) ? needed : 0, l.keys)] });
  }

  // Servers listed for a role the sizing does not use.
  for (const g of site.servers) {
    if (g.count <= 0 || out.some((f) => f.role === g.role)) continue;
    out.push({ role: g.role, neededNodes: 0, nodesPerServer: serverLayout(c, g, model).nodes, neededServers: 0, availableServers: g.count, status: 'idle', fits: true,
      math: [step(`${g.role} servers`, 'nothing in this sizing uses this role', 0, [])] });
  }
  return out;
}

/** D33: license units under each host model. */
function licenseFor(c: ConstantSet, model: HostModel, result: SizingResult, fit: RoleFit[], site: SiteInput): SiteResult['license'] {
  const per = num(c, 'eru_gb');
  if (model === 'eck') {
    const counted = c.byKey.get('eru.counted_components')?.value as Record<string, boolean> | undefined;
    const podGb = result.tiers.reduce((s, t) => s + t.nodes * t.ramGb, 0)
      + result.overhead.filter((o) => o.countsTowardLicense).reduce((s, o) => s + o.count * o.ramGb, 0);
    const gib = gbToGib(podGb);
    const eru = ceilEps(gib / per);
    return { eru, math: [
      step('ECK pod memory limits', `${fmt(podGb)} GB = ${fmt(gib)} GiB (Elasticsearch, Kibana, APM; Elastic Agent not counted)`, gib, counted ? ['eru.counted_components'] : []),
      step('ERU (ECK)', `ROUNDUP(${fmt(gib)} GiB / ${per})`, eru, ['eru_gb']),
    ] };
  }
  if (model === 'ece') {
    const ramOf = (role: string) => site.servers.find((g) => g.role === role && g.count > 0)?.ramGb ?? 0;
    const used = fit.filter((f) => f.status !== 'idle' && f.status !== 'unplaced');
    const hostGb = used.reduce((s, f) => s + f.neededServers * ramOf(f.role), 0);
    const eru = ceilEps(hostGb / per);
    return { eru, math: [
      step('ECE allocator capacity', used.map((f) => `${f.neededServers} × ${fmt(ramOf(f.role))} GB ${f.role}`).join(' + ') || '0', hostGb, []),
      step('ERU (ECE)', `ROUNDUP(${fmt(hostGb)} GB / ${per})`, eru, ['eru_gb']),
    ] };
  }
  return { eru: result.licenseUnits.value, math: result.licenseUnits.math };
}

function scaleWorkloads(ws: readonly WorkloadProfile[], s: number): WorkloadProfile[] {
  return ws.map((w) => ({
    ...w,
    ...(w.rawGbPerDay !== undefined ? { rawGbPerDay: w.rawGbPerDay * s } : {}),
    ...(w.totalGb !== undefined ? { totalGb: w.totalGb * s } : {}),
    ...(w.vector ? { vector: { ...w.vector, count: w.vector.count * s } } : {}),
  }));
}

function evaluate(c: ConstantSet, req: TopologyRequest): SiteResult[] {
  return req.sites.map((site, i) => {
    const held = holdings(req, i);
    const model = req.hostModel ?? 'self_managed';
    const result = forward({ workloads: held, options: siteOptions(c, req, site) }, c);
    const fit = fitFor(c, result, site, model);
    return { name: site.name, license: licenseFor(c, model, result, fit, site), holds: held.map((w) => w.id), result, fit, fits: fit.every((f) => f.fits) };
  });
}

/** D32: size every site for what it holds, check it against that site's servers, and find the headroom. */
export function sizeTopology(req: TopologyRequest, c: ConstantSet = defaultConstants): TopologyResult {
  if (req.sites.length === 0) throw new Error('Add at least one site.');
  const sites = evaluate(c, req);
  const fitsAll = sites.every((s) => s.fits);

  const hasVolume = req.sites.some((s) => s.workloads.some((w) => (w.rawGbPerDay ?? 0) > 0 || (w.totalGb ?? 0) > 0 || (w.vector?.count ?? 0) > 0));
  let headroom: TopologyResult['headroom'];
  if (hasVolume) {
    const scaled = (s: number): TopologyRequest => ({ ...req, sites: req.sites.map((site) => ({ ...site, workloads: scaleWorkloads(site.workloads, s) })) });
    const fitsAt = (s: number) => evaluate(c, scaled(s)).every((x) => x.fits);
    const firstShortfall = (s: number) => {
      for (const site of evaluate(c, scaled(s))) {
        const f = site.fit.find((x) => !x.fits);
        if (f) return { site: site.name, role: f.role };
      }
      return undefined;
    };
    let lo = 0;
    let hi = 1;
    let scale: number;
    if (!fitsAt(1e-9)) {
      scale = 0;
      hi = 1e-9;
    } else {
      if (fitsAt(1)) {
        lo = 1;
        hi = 2;
        while (fitsAt(hi) && hi < 1e6) { lo = hi; hi *= 2; }
      }
      if (fitsAt(hi)) {
        scale = Infinity;
      } else {
        for (let i = 0; i < 50; i++) {
          const mid = (lo + hi) / 2;
          if (fitsAt(mid)) lo = mid; else hi = mid;
        }
        scale = lo;
      }
    }
    const binding = Number.isFinite(scale) ? firstShortfall(hi) : undefined;
    headroom = {
      scale,
      ...(binding ? { binding } : {}),
      math: [step('headroom', Number.isFinite(scale)
        ? `largest multiple of today's data volume that fits every site${binding ? `; ${binding.site} ${binding.role} runs out first` : ''}`
        : 'not limited by these servers', scale, [])],
    };
  }

  const dataFits = (s: SiteResult) => s.fit.filter((f) => f.status !== 'unplaced' && f.status !== 'idle');
  const totals = {
    ramGb: sites.reduce((s, x) => s + x.result.totalRamGb, 0),
    eru: sites.reduce((s, x) => s + x.license.eru, 0),
    objectStorageGb: sites.reduce((s, x) => s + (x.result.objectStorage?.gb ?? 0), 0),
    neededServers: sites.reduce((s, x) => s + dataFits(x).reduce((a, f) => a + f.neededServers, 0), 0),
    availableServers: req.sites.reduce((s, x) => s + x.servers.reduce((a, g) => a + g.count, 0), 0),
  };

  return {
    relationship: req.relationship, sites, fitsAll, totals, ...(headroom ? { headroom } : {}),
    assumptions: [
      RELATIONSHIP_TEXT[req.relationship],
      MODEL_TEXT[req.hostModel ?? 'self_managed'](c),
      'Failover reserves one whole server per tier: losing a server loses all of its nodes.',
      'Totals add the sites; each cluster is licensed separately, so ERU is summed per site.',
    ],
  };
}

// ---- D33: compare deployment models on the same servers ----------------------------------------

export interface ModelComparisonRequest {
  workloads: WorkloadProfile[];
  servers: ServerGroup[];
  options: ForwardOptions;
}

export type BestOn = 'eru' | 'headroom' | 'servers';

export interface ModelRow {
  model: HostModel;
  topology: TopologyResult;
  eru: number;
  eruMath: MathStep[];
  /** What running this model asks of the customer. */
  requirements: string[];
  /** Measures on which this model is best (among models that fit, or all when none fit). */
  best: BestOn[];
}

export const HOST_MODELS: HostModel[] = ['self_managed', 'eck', 'ece'];

function requirementsFor(c: ConstantSet, model: HostModel): string[] {
  if (model === 'eck') {
    return [
      'Needs a Kubernetes platform and the skills to run it; the Kubernetes control plane is not counted here.',
      `Keeps ${num(c, 'eck.k8s_reserve_ram_gb')} GB RAM and ${num(c, 'eck.k8s_reserve_vcpu')} vCPU per server for Kubernetes, plus ${num(c, 'eck.operator_ram_gb')} GB for the operator.`,
      'Licenses pod memory limits (GiB); Elastic Agent and Beats pods are free.',
      'Works air-gapped with a private image registry.',
    ];
  }
  if (model === 'ece') {
    return [
      `Needs ${num(c, 'ece.control_plane_hosts')} control-plane hosts with at least ${num(c, 'ece.control_plane_ram_gb')} GB RAM each.`,
      'Licenses the full RAM of every allocator host used, busy or not.',
      `Plans allocators to ${num(c, 'ece.allocator_planning_fraction') * 100}% of RAM; gives a UI and API for many clusters, upgrades and snapshots.`,
      'Works air-gapped with an offline install.',
    ];
  }
  return [
    'You install, upgrade, secure and scale Elasticsearch yourself.',
    'Least overhead per server; licenses node RAM of Elasticsearch, Kibana and APM.',
    'Works air-gapped.',
  ];
}

/** D33: size the same workloads on the same servers under each host model, for a trade-off table. */
export function compareModels(req: ModelComparisonRequest, c: ConstantSet = defaultConstants): ModelRow[] {
  const rows: ModelRow[] = HOST_MODELS.map((model) => {
    const topology = sizeTopology({
      relationship: 'independent', hostModel: model, options: req.options,
      sites: [{ name: 'Servers', workloads: req.workloads, servers: req.servers }],
    }, c);
    const site = topology.sites[0]!;
    return { model, topology, eru: topology.totals.eru, eruMath: site.license.math, requirements: requirementsFor(c, model), best: [] };
  });
  const pool = rows.some((r) => r.topology.fitsAll) ? rows.filter((r) => r.topology.fitsAll) : rows;
  const mark = (key: BestOn, score: (r: ModelRow) => number, better: 'low' | 'high') => {
    const vals = pool.map(score).filter((v) => !Number.isNaN(v));
    if (!vals.length) return;
    const target = better === 'low' ? Math.min(...vals) : Math.max(...vals);
    for (const r of pool) if (score(r) === target) r.best.push(key);
  };
  mark('eru', (r) => r.eru, 'low');
  mark('headroom', (r) => r.topology.headroom?.scale ?? NaN, 'high');
  mark('servers', (r) => r.topology.totals.neededServers, 'low');
  return rows;
}
