import type { MathStep } from '@sizing/engine';
import { fmtMoney, fmtNum } from './format.ts';

/**
 * D46: services sold with a deal (consulting, dedicated support, training). A catalog of services with default
 * prices lives in this browser (prices are internal, like the cost defaults); each scenario picks services and
 * quantities, and may override a price. Services feed Total cost, the exports and the Budgetary ROM.
 */

export type ServiceBilling = 'one_time' | 'annual';

export interface ServiceItem {
  id: string;
  name: string;
  /** Part number on the quote, e.g. SV-1D. */
  mpn: string;
  /** What one unit is: hour, day, package, seat, year. */
  unit: string;
  /** Default price per unit, US dollars. Blank until set. */
  unitPrice?: number;
  billing: ServiceBilling;
  /** Description printed in the ROM. Blank until written. */
  description: string;
  /** Show start and end dates on the ROM line (subscriptions and packages). */
  dated: boolean;
}

export interface ServiceLine {
  serviceId: string;
  quantity: number;
  /** Overrides the catalog price for this scenario. */
  unitPrice?: number;
}

/** Saved with the scenario. */
export interface ScenarioServices {
  lines: ServiceLine[];
}

/** Starting catalog: the services named so far, with no prices or descriptions yet. */
export const SEED_CATALOG: ServiceItem[] = [
  { id: 'flex-consulting', name: 'Flex Consulting', mpn: '', unit: 'hour', billing: 'one_time', description: '', dated: false },
  { id: 'dedicated-support-engineer', name: 'Dedicated Support Engineer', mpn: '', unit: 'year', billing: 'annual', description: '', dated: true },
  { id: 'on-demand-training', name: 'On-Demand Training Subscription', mpn: '', unit: 'seat', billing: 'annual', description: '', dated: true },
  { id: 'private-training', name: 'Private Training', mpn: '', unit: 'package', billing: 'one_time', description: '', dated: true },
];

export const BILLING_LABEL: Record<ServiceBilling, string> = { one_time: 'Once', annual: 'Every year' };

export function newServiceId(name: string, taken: readonly string[]): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'service';
  let id = base;
  for (let i = 2; taken.includes(id); i++) id = `${base}-${i}`;
  return id;
}

export interface PricedServiceLine {
  line: ServiceLine;
  item: ServiceItem | undefined;
  unitPrice: number | undefined;
  /** quantity × unit price, per billing period; undefined without a price or when the service is gone. */
  total: number | undefined;
}

export function priceLines(catalog: readonly ServiceItem[], s: ScenarioServices | undefined): PricedServiceLine[] {
  return (s?.lines ?? []).map((line) => {
    const item = catalog.find((x) => x.id === line.serviceId);
    const unitPrice = line.unitPrice ?? item?.unitPrice;
    return { line, item, unitPrice, total: item && unitPrice !== undefined ? line.quantity * unitPrice : undefined };
  });
}

/** The services line for one year of the term: one-time services in year 1, annual ones every year. */
export function servicesForYear(catalog: readonly ServiceItem[], s: ScenarioServices | undefined, year: number): { annual?: number; math: MathStep[]; missing?: string } | undefined {
  const lines = priceLines(catalog, s).filter((p) => p.item && (p.item.billing === 'annual' || year === 1));
  if (lines.length === 0) return undefined;
  const unpriced = lines.filter((p) => p.total === undefined).map((p) => p.item!.name);
  const math: MathStep[] = lines.filter((p) => p.total !== undefined).map((p) => ({
    label: `${p.item!.name}${p.item!.billing === 'annual' ? ' (every year)' : ''}`,
    expr: `${fmtNum(p.line.quantity, 2)} ${p.item!.unit}${p.line.quantity === 1 ? '' : 's'} × ${fmtMoney(p.unitPrice!, 2)}`,
    value: p.total!, constantKeys: [],
  }));
  if (unpriced.length === lines.length) return { math, missing: `a price for ${unpriced.join(', ')}` };
  return { annual: math.reduce((sum, m) => sum + m.value, 0), math, ...(unpriced.length ? { missing: `a price for ${unpriced.join(', ')}` } : {}) };
}

/** Catalog from an exported file, or undefined if it is not one. */
export function parseCatalog(x: unknown): ServiceItem[] | undefined {
  const list = (x && typeof x === 'object' && 'services' in x ? (x as { services: unknown }).services : x) as unknown;
  if (!Array.isArray(list)) return undefined;
  const out: ServiceItem[] = [];
  for (const r of list as Partial<ServiceItem>[]) {
    if (!r || typeof r.id !== 'string' || typeof r.name !== 'string') return undefined;
    out.push({
      id: r.id, name: r.name, mpn: typeof r.mpn === 'string' ? r.mpn : '', unit: typeof r.unit === 'string' && r.unit ? r.unit : 'unit',
      ...(typeof r.unitPrice === 'number' && Number.isFinite(r.unitPrice) ? { unitPrice: r.unitPrice } : {}),
      billing: r.billing === 'annual' ? 'annual' : 'one_time', description: typeof r.description === 'string' ? r.description : '', dated: !!r.dated,
    });
  }
  return out;
}
