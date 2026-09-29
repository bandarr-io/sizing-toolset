import type { ConstantSet } from '@sizing/constants';
import { forward, reverse, type MathStep, type SizingResult, type Tier } from '@sizing/engine';
import { fmtMoney, fmtNum } from './format.ts';
import { servicesForYear, type ServiceItem } from './services.ts';

const DISK_NAME: Record<string, string> = { nvme: 'NVMe', ssd: 'SSD', hdd: 'HDD' };
import { defaultDiskType, type AppState } from './state.ts';

/** Local disk kinds that carry a price. Legacy 'object' node disks count as SSD (D26). */
export type DiskKind = 'nvme' | 'ssd' | 'hdd';

/** Prices in US dollars. Every field is optional: a component without its prices is left out of the total. */
export interface CostRates {
  /** Elastic subscription, per ERU per year. */
  eruPerYear?: number;
  /** Server purchase price per GB of RAM (chassis, CPU and memory together). */
  serverPerGbRam?: number;
  /** Local disk purchase price per TB, by type. */
  diskPerTb?: Partial<Record<DiskKind, number>>;
  /** Years over which server and disk purchases are spread. */
  amortYears?: number;
  objectPerTbMonth?: number;
  /** Rack, power, cooling and network per node per month. */
  hostingPerNodeMonth?: number;
  opsFte?: number;
  /** Fully loaded annual cost of one operations FTE. */
  opsCostPerFte?: number;
}

/** Per-scenario cost inputs, saved with the scenario. */
export interface CostSettings {
  rates?: CostRates;
  termYears?: number;
  includeInExport?: boolean;
  /** Discount off the Elastic subscription list price, in percent (0 to 100). Hardware and running costs are not discounted. */
  discountPct?: number;
}

/** A usable discount, or undefined when blank or outside 0 to 100 (the field shows the error; nothing is applied). */
export function validDiscount(pct: number | undefined): number | undefined {
  return pct !== undefined && Number.isFinite(pct) && pct >= 0 && pct <= 100 ? pct : undefined;
}

export const DEFAULT_TERM_YEARS = 3;

export type CostPart = 'subscription' | 'hardware' | 'object' | 'hosting' | 'ops' | 'services';

export interface CostLine {
  part: CostPart;
  label: string;
  /** Undefined when a price the component needs is not set. */
  annual?: number;
  math: MathStep[];
  /** What to set to include this component. */
  missing?: string;
}

export interface NodeLine { role: string; count: number; ramGb: number; diskGb: number; diskType: DiskKind }

const step = (label: string, expr: string, value: number): MathStep => ({ label, expr, value, constantKeys: [] });
const local = (t: string | undefined): DiskKind => (t === 'nvme' || t === 'hdd' ? t : 'ssd');

/** Scenario prices win field by field; disk prices merge per type. */
export function mergeRates(defaults: CostRates, scenario: CostRates = {}): CostRates {
  const out: CostRates = { ...defaults };
  for (const [k, v] of Object.entries(scenario) as [keyof CostRates, CostRates[keyof CostRates]][]) {
    if (v === undefined || k === 'diskPerTb') continue;
    (out as Record<string, unknown>)[k] = v;
  }
  if (defaults.diskPerTb || scenario.diskPerTb) out.diskPerTb = { ...defaults.diskPerTb, ...scenario.diskPerTb };
  return out;
}

/** Every node in the result (per site), with the local disk type the scenario gives it. */
export function nodeInventory(state: AppState, r: SizingResult): NodeLine[] {
  const tierDisk = (tier: Tier): DiskKind => {
    if (state.mode === 'reverse') return local(state.reverse.hardware.groups.find((g) => g.role === tier)?.diskType);
    return local(state.forward.options.nodes?.[tier]?.diskType ?? defaultDiskType(tier));
  };
  return [
    ...r.tiers.map((t) => ({ role: t.tier, count: t.nodes, ramGb: t.ramGb, diskGb: t.diskGb, diskType: tierDisk(t.tier) })),
    ...r.overhead.map((o) => ({ role: o.role, count: o.count, ramGb: o.ramGb, diskGb: o.diskGb, diskType: local(o.diskType) })),
  ].filter((n) => n.count > 0);
}

/** Elastic subscription per year: ERU × list price, less the scenario's discount. */
export function subscriptionCost(r: SizingResult, rates: CostRates, discountPct?: number): CostLine {
  const pct = validDiscount(discountPct);
  const label = pct ? `Elastic subscription (${fmtNum(pct, 2)}% discount)` : 'Elastic subscription';
  if (r.licenseFloor === 'basic') return { part: 'subscription', label, annual: 0, math: [step('subscription (Basic)', 'no licensed features, no ERUs to buy', 0)] };
  if (rates.eruPerYear === undefined) return { part: 'subscription', label, math: [], missing: 'subscription price per ERU' };
  const eru = r.allSites.licenseUnits;
  const list = eru * rates.eruPerYear;
  const math = [step('subscription per year at list (Enterprise)', `${fmtNum(eru, 0)} ERU × ${fmtMoney(rates.eruPerYear)}`, list)];
  if (!pct) return { part: 'subscription', label, annual: list, math };
  const discount = (list * pct) / 100;
  const annual = list - discount;
  math.push(
    step('discount', `${fmtMoney(list)} × ${fmtNum(pct, 2)}%`, discount),
    step('subscription per year after discount', `${fmtMoney(list)} − ${fmtMoney(discount)}`, annual),
  );
  return { part: 'subscription', label, annual, math };
}

function hardwareCost(nodes: NodeLine[], sites: number, rates: CostRates): CostLine {
  const label = 'Hardware (spread over its life)';
  const types = [...new Set(nodes.filter((n) => n.diskGb > 0).map((n) => n.diskType))];
  const unpricedDisk = types.filter((t) => rates.diskPerTb?.[t] === undefined);
  if (rates.serverPerGbRam === undefined || !rates.amortYears || unpricedDisk.length) {
    const need = [rates.serverPerGbRam === undefined && 'server price per GB of memory', !rates.amortYears && 'hardware life in years',
      ...unpricedDisk.map((t) => `${DISK_NAME[t]} disk price per TB`)].filter(Boolean);
    return { part: 'hardware', label, math: [], missing: need.join(', ') };
  }
  const ramGb = nodes.reduce((s, n) => s + n.count * n.ramGb, 0) * sites;
  const servers = ramGb * rates.serverPerGbRam;
  const math = [step('servers', `${fmtNum(ramGb)} GB RAM × ${fmtMoney(rates.serverPerGbRam)}`, servers)];
  let disks = 0;
  for (const t of types) {
    const tb = nodes.filter((n) => n.diskType === t).reduce((s, n) => s + n.count * n.diskGb, 0) * sites / 1000;
    const cost = tb * rates.diskPerTb![t]!;
    disks += cost;
    math.push(step(`${DISK_NAME[t]} disks`, `${fmtNum(tb, 1)} TB × ${fmtMoney(rates.diskPerTb![t]!)}`, cost));
  }
  const annual = (servers + disks) / rates.amortYears;
  math.push(step('hardware per year', `(${fmtMoney(servers)} + ${fmtMoney(disks)}) / ${rates.amortYears} years`, annual));
  return { part: 'hardware', label, annual, math };
}

function objectCost(r: SizingResult, rates: CostRates): CostLine {
  const label = 'Object storage';
  const gb = (r.objectStorage?.gb ?? 0) * r.sites;
  if (gb === 0) return { part: 'object', label, annual: 0, math: [step('object storage', 'no cold or frozen data', 0)] };
  if (rates.objectPerTbMonth === undefined) return { part: 'object', label, math: [], missing: 'object storage price per TB per month' };
  const annual = (gb / 1000) * rates.objectPerTbMonth * 12;
  return { part: 'object', label, annual, math: [step('object storage per year', `${fmtNum(gb / 1000, 1)} TB × ${fmtMoney(rates.objectPerTbMonth)} × 12 months`, annual)] };
}

function hostingCost(nodes: NodeLine[], sites: number, rates: CostRates): CostLine {
  const label = 'Hosting, power and rack';
  if (rates.hostingPerNodeMonth === undefined) return { part: 'hosting', label, math: [], missing: 'hosting price per node per month' };
  const count = nodes.reduce((s, n) => s + n.count, 0) * sites;
  const annual = count * rates.hostingPerNodeMonth * 12;
  return { part: 'hosting', label, annual, math: [step('hosting per year', `${count} nodes × ${fmtMoney(rates.hostingPerNodeMonth)} × 12 months`, annual)] };
}

function opsCost(rates: CostRates): CostLine {
  const label = 'Operations staff';
  if (rates.opsFte === undefined || rates.opsCostPerFte === undefined) {
    return { part: 'ops', label, math: [], missing: [rates.opsFte === undefined && 'number of operations staff', rates.opsCostPerFte === undefined && 'cost per person'].filter(Boolean).join(', ') };
  }
  const annual = rates.opsFte * rates.opsCostPerFte;
  return { part: 'ops', label, annual, math: [step('operations per year', `${fmtNum(rates.opsFte)} people × ${fmtMoney(rates.opsCostPerFte)}`, annual)] };
}

/** One year of platform cost for a sized cluster. */
export function annualCosts(state: AppState, r: SizingResult, rates: CostRates): CostLine[] {
  const nodes = nodeInventory(state, r);
  return [subscriptionCost(r, rates, state.cost?.discountPct), hardwareCost(nodes, r.sites, rates), objectCost(r, rates), hostingCost(nodes, r.sites, rates), opsCost(rates)];
}

export const sumLines = (lines: readonly CostLine[]) => lines.reduce((s, l) => s + (l.annual ?? 0), 0);

/** Cost over a term: one sized result per year, in order. */
export function termCosts(state: AppState, rates: CostRates, perYear: readonly SizingResult[]) {
  const years = perYear.map((r, i) => {
    const lines = annualCosts(state, r, rates);
    return { year: i + 1, lines, total: sumLines(lines) };
  });
  return { years, total: years.reduce((s, y) => s + y.total, 0) };
}

/**
 * The cluster for each year of the term. Forward: year k is sized for k years of growth (the Plan for growth rates),
 * so the hardware grows with the data. Reverse: the hardware is given, so every year is the same cluster.
 */
export function resultsByYear(state: AppState, c: ConstantSet, years: number): SizingResult[] {
  if (state.mode === 'reverse') {
    const r = reverse(state.reverse, c);
    return Array.from({ length: years }, () => r);
  }
  return Array.from({ length: years }, (_, i) => forward({ ...state.forward, options: { ...state.forward.options, growthHorizonYears: i + 1 } }, c));
}

/** D46: services the scenario picked: one-time ones in year 1, annual ones every year. */
function withServices(t: ReturnType<typeof termCosts>, catalog: readonly ServiceItem[], state: AppState): ReturnType<typeof termCosts> {
  // Every year gets the line once any service is picked, so the years' lines stay aligned (0 after year 1 for one-time only).
  if (!servicesForYear(catalog, state.services, 1)) return t;
  const years = t.years.map((y) => {
    const s = servicesForYear(catalog, state.services, y.year) ?? { annual: 0, math: [] };
    const line: CostLine = { part: 'services', label: 'Services', math: s.math, ...(s.annual !== undefined ? { annual: s.annual } : {}), ...(s.missing ? { missing: s.missing } : {}) };
    const lines = [...y.lines, line];
    return { ...y, lines, total: sumLines(lines) };
  });
  return { years, total: years.reduce((sum, y) => sum + y.total, 0) };
}

export interface CostReport { termYears: number; years: ReturnType<typeof termCosts>['years']; total: number; partial: boolean }

/** Everything the TCO page and the export show, or an error message when the scenario cannot be sized. */
export function costReport(state: AppState, c: ConstantSet, rates: CostRates, catalog: readonly ServiceItem[] = []): CostReport | { error: string } {
  const termYears = Math.max(1, Math.round(state.cost?.termYears ?? DEFAULT_TERM_YEARS));
  try {
    const t = withServices(termCosts(state, rates, resultsByYear(state, c, termYears)), catalog, state);
    return { termYears, ...t, partial: t.years[0]!.lines.some((l) => l.annual === undefined) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
