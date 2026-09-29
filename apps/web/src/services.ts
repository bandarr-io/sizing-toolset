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

// Wording from past ROMs (Dan, 2026-09-29); a starting point to edit in the catalog.
const PSE_DESCRIPTION = 'DESCRIPTION\nProfessional services engagements are available for the defined number of consulting days outlined above. Time within the engagement may be allocated to allow consultative or deployment services within a varied scope according to customer need.\n\nCUSTOMER PROFILE\nOur professional services are engineered to deliver end-to-end success across the entire Elastic ecosystem, including Enterprise Search, Observability, and Security. Whether deploying a greenfield environment or optimizing a legacy architecture, our project-based engagements ensure your Elastic Stack or Elastic Cloud implementation is scalable, secure, and aligned with your business objectives.\n\nCOMMON TASKS WITHIN THE ENGAGEMENT\nOperational, implementation, and deployment services:\n- Installation and configuration\n- Pipeline / ingestion recommendations and patterns\n- Data modeling / mapping\n- Visualizations / dashboards\n\nINCLUDED IN SCOPE\nIncludes travel and expenses for 1 onsite visit every 4 Consulting Days within the engagement\n\nNOT INCLUDED IN SCOPE\nRecommendations, handling or administration of third-party software, software data, or systems';
const TRAINING_DESCRIPTION = 'TRAINING OBJECTIVES\nIncreased Skills, continual advanced insights for Operators and Analysts through training, Improving time to insight.\n\nElastic training subscriptions are an all-access pass to our extensive library of training courses. Get a season ticket to solution-based curriculum, hands-on labs, and much more. We recommend the optional:\nProfessional Training Subscriptions that includes:\n- All on-demand courses\n- Hands-on labs\n- PDF course materials\n- One practice exam attempt per certification path\n- One exam attempt per certification path\n- Ask-the-Instructor sessions\n- All instructor-led, virtual courses\n- Guaranteed slot in all virtual courses\n- First access to new courses\n\nRecommended Courses:\n- Elasticsearch Engineer\n- Data Analysis with Kibana\n- Elasticsearch Observability Engineer';

/** Starting catalog: the services named so far. Prices are blank; descriptions only where standard wording exists. */
export const SEED_CATALOG: ServiceItem[] = [
  { id: 'flex-consulting', name: 'Flex Consulting', mpn: '', unit: 'hour', billing: 'one_time', description: '', dated: false },
  { id: 'dedicated-support-engineer', name: 'Dedicated Support Engineer', mpn: '', unit: 'year', billing: 'annual', description: '', dated: true },
  { id: 'on-demand-training', name: 'On-Demand Training Subscription', mpn: '', unit: 'seat', billing: 'annual', description: '', dated: true },
  { id: 'private-training', name: 'Private Training', mpn: '', unit: 'package', billing: 'one_time', description: '', dated: true },
  { id: 'professional-services-engagement', name: 'Professional Services Engagement', mpn: '', unit: 'day', billing: 'one_time', description: PSE_DESCRIPTION, dated: false },
  { id: 'professional-training-subscription', name: 'Professional Training Subscription', mpn: '', unit: 'seat', billing: 'annual', description: TRAINING_DESCRIPTION, dated: true },
];

/** Standard services this catalog is missing (removed, or added to the standard list after it was created). */
export function missingStandardServices(catalog: readonly ServiceItem[]): ServiceItem[] {
  const ids = new Set(catalog.map((x) => x.id));
  return SEED_CATALOG.filter((x) => !ids.has(x.id));
}

export type DescriptionBlock = { kind: 'heading'; text: string } | { kind: 'paragraph'; text: string } | { kind: 'list'; items: string[] };

/**
 * How a service description prints in the ROM. Every line is its own paragraph, so text pasted from a document
 * keeps its breaks; a line in capitals is a heading (DESCRIPTION, INCLUDED IN SCOPE); a line starting with -, * or •
 * is a bullet, and bullets in a row form one list.
 */
export function parseDescription(text: string): DescriptionBlock[] {
  const out: DescriptionBlock[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const bullet = /^[-*•]\s+(.*)$/.exec(line);
    const last = out[out.length - 1];
    if (bullet) {
      if (last?.kind === 'list') last.items.push(bullet[1]!);
      else out.push({ kind: 'list', items: [bullet[1]!] });
    } else if (/[A-Z]/.test(line) && line === line.toUpperCase() && line.length <= 80) {
      out.push({ kind: 'heading', text: line });
    } else {
      out.push({ kind: 'paragraph', text: line });
    }
  }
  return out;
}

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
