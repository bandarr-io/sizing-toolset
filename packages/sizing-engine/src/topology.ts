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

export interface TopologyRequest {
  relationship: SiteRelationship;
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
const SINGLE_NODE_ROLES = new Set<string>(['frozen', 'ml', 'kibana', 'fleet', 'apm']);

/**
 * Nodes on one server. Data and master servers are split into nodes of at most node_ram_practical_max_gb
 * (HV1); frozen and ML may exceed it and supporting services run once per server.
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
    const n = nodesPerServer(c, g);
    const ratio = req.options.nodes?.[tier]?.memDiskRatio;
    nodes[tier] = {
      ...(ratio !== undefined ? { memDiskRatio: ratio } : {}),
      ramGb: g.ramGb / n, diskGb: g.diskGb / n, vcpu: g.vcpu / n, diskType: g.diskType,
      ...(g.diskWriteMBps !== undefined ? { diskWriteMBps: g.diskWriteMBps / n } : {}),
    };
  }
  return {
    ...req.options, nodes, sites: 1,
    // Replication between sites is modelled by what each site holds; the mode here only sets the license floor.
    ccrMode: req.relationship === 'independent' ? 'none' : 'unidirectional',
  };
}

function fitFor(c: ConstantSet, result: SizingResult, site: SiteInput): RoleFit[] {
  const failover = num(c, 'failover_nodes_per_tier');
  const out: RoleFit[] = [];
  const serversFor = (role: string) => site.servers.filter((g) => g.role === role && g.count > 0);
  const layoutKeys = (g: ServerGroup | undefined) =>
    g && g.nodesPerServer === undefined && !SINGLE_NODE_ROLES.has(g.role) ? ['node_ram_practical_max_gb'] : [];

  for (const t of result.tiers) {
    if (t.nodes <= 0) continue;
    const groups = serversFor(t.tier);
    const g = groups[0];
    const nps = g ? nodesPerServer(c, g) : 1;
    const available = groups.reduce((s, x) => s + x.count, 0);
    const base = Math.max(0, t.nodes - failover);
    // Failover is a whole server: losing one takes all of its nodes.
    const needed = ceilEps(base / nps) + failover;
    const status = !g ? 'missing' : needed <= available ? 'ok' : 'short';
    out.push({
      role: t.tier, neededNodes: t.nodes, nodesPerServer: nps, neededServers: needed, availableServers: available, status, fits: status === 'ok',
      math: [
        step(`${t.tier} servers needed`, `ROUNDUP(${base} nodes / ${nps} per server) + ${failover} failover server`, needed, ['failover_nodes_per_tier', ...layoutKeys(g)]),
        step(`${t.tier} servers available`, g ? `${available} × ${fmt(g.ramGb)} GB servers` : 'none listed', available, []),
      ],
    });
  }

  for (const o of result.overhead) {
    if (o.count <= 0) continue;
    const groups = serversFor(o.role);
    const g = groups[0];
    const available = groups.reduce((s, x) => s + x.count, 0);
    if (!g) {
      out.push({ role: o.role, neededNodes: o.count, nodesPerServer: 1, neededServers: o.count, availableServers: 0, status: 'unplaced', fits: true,
        math: [step(`${o.role} servers`, `${o.count} needed; no ${o.role} servers listed (co-located or hosted elsewhere)`, o.count, [])] });
      continue;
    }
    const nps = nodesPerServer(c, g);
    const needed = ceilEps(o.count / nps);
    const status = needed <= available ? 'ok' : 'short';
    out.push({ role: o.role, neededNodes: o.count, nodesPerServer: nps, neededServers: needed, availableServers: available, status, fits: status === 'ok',
      math: [step(`${o.role} servers needed`, `ROUNDUP(${o.count} nodes / ${nps} per server)`, needed, layoutKeys(g))] });
  }

  // Servers listed for a role the sizing does not use.
  for (const g of site.servers) {
    if (g.count <= 0 || out.some((f) => f.role === g.role)) continue;
    out.push({ role: g.role, neededNodes: 0, nodesPerServer: nodesPerServer(c, g), neededServers: 0, availableServers: g.count, status: 'idle', fits: true,
      math: [step(`${g.role} servers`, 'nothing in this sizing uses this role', 0, [])] });
  }
  return out;
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
    const result = forward({ workloads: held, options: siteOptions(c, req, site) }, c);
    const fit = fitFor(c, result, site);
    return { name: site.name, holds: held.map((w) => w.id), result, fit, fits: fit.every((f) => f.fits) };
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
    eru: sites.reduce((s, x) => s + x.result.licenseUnits.value, 0),
    objectStorageGb: sites.reduce((s, x) => s + (x.result.objectStorage?.gb ?? 0), 0),
    neededServers: sites.reduce((s, x) => s + dataFits(x).reduce((a, f) => a + f.neededServers, 0), 0),
    availableServers: req.sites.reduce((s, x) => s + x.servers.reduce((a, g) => a + g.count, 0), 0),
  };

  return {
    relationship: req.relationship, sites, fitsAll, totals, ...(headroom ? { headroom } : {}),
    assumptions: [
      RELATIONSHIP_TEXT[req.relationship],
      `Servers are split into nodes of at most ${num(c, 'node_ram_practical_max_gb')} GB RAM for data and master roles (frozen, ML, Kibana, Fleet and APM run one node per server) unless nodes per server is set.`,
      'Failover reserves one whole server per tier: losing a server loses all of its nodes.',
      'Totals add the sites; each cluster is licensed separately, so ERU is summed per site.',
    ],
  };
}
