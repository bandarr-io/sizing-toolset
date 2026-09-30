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
  /** Heading on the ROM's service descriptions page; the name when blank. */
  title?: string;
  /** D49: fill-in fields the description uses as {key}; set per scenario on the Services tab. */
  fields?: ServiceField[];
}

/** many: pick any of the choices (or add your own); one: pick one; text; number. */
export type ServiceFieldKind = 'many' | 'one' | 'text' | 'number';
export const FIELD_KIND_LABEL: Record<ServiceFieldKind, string> = { many: 'Pick several', one: 'Pick one', text: 'Text', number: 'Number' };

export interface ServiceField {
  /** Used in the description as {key}. */
  key: string;
  label: string;
  kind: ServiceFieldKind;
  /** Choices for many and one. */
  choices: string[];
  /** Used until a scenario sets its own value. */
  default: string | string[];
}

export type FieldValue = string | string[];

export interface ServiceLine {
  serviceId: string;
  quantity: number;
  /** Overrides the catalog price for this scenario. */
  unitPrice?: number;
  /** This scenario's values for the service's fields, by key. */
  values?: Record<string, FieldValue>;
}

/** Saved with the scenario. */
export interface ScenarioServices {
  lines: ServiceLine[];
}

// Wording from past ROMs (Dan, 2026-09-29); a starting point to edit in the catalog. {key} marks a fill-in field (D49).
const PSE_DESCRIPTION = 'DESCRIPTION\nProfessional services engagements are available for the defined number of consulting days outlined above. Time within the engagement may be allocated to allow consultative or deployment services within a varied scope according to customer need.\n\nCUSTOMER PROFILE\nOur professional services are engineered to deliver end-to-end success across the entire Elastic ecosystem, including {solutions}. Whether deploying a greenfield environment or optimizing a legacy architecture, our project-based engagements ensure your {deployment} implementation is scalable, secure, and aligned with your business objectives.\n\nCOMMON TASKS WITHIN THE ENGAGEMENT\nOperational, implementation, and deployment services:\n{tasks}\n\nINCLUDED IN SCOPE\nIncludes travel and expenses for 1 onsite visit every {days_per_visit} Consulting Days within the engagement\n\nNOT INCLUDED IN SCOPE\n{not_included}';
const PSE_FIELDS: ServiceField[] = [
  { key: 'solutions', label: 'Solution areas', kind: 'many', choices: ['Enterprise Search', 'Observability', 'Security'], default: ['Enterprise Search', 'Observability', 'Security'] },
  { key: 'tasks', label: 'Common tasks', kind: 'many', choices: ['Installation and configuration', 'Pipeline / ingestion recommendations and patterns', 'Data modeling / mapping', 'Visualizations / dashboards'], default: ['Installation and configuration', 'Pipeline / ingestion recommendations and patterns', 'Data modeling / mapping', 'Visualizations / dashboards'] },
  { key: 'days_per_visit', label: 'Consulting days per onsite visit', kind: 'number', choices: [], default: '4' },
  { key: 'not_included', label: 'Not included in scope', kind: 'text', choices: [], default: 'Recommendations, handling or administration of third-party software, software data, or systems' },
];
const TRAINING_DESCRIPTION = 'TRAINING OBJECTIVES\nIncreased Skills, continual advanced insights for {audience} through training, Improving time to insight.\n\nElastic training subscriptions are an all-access pass to our extensive library of training courses. Get a season ticket to solution-based curriculum, hands-on labs, and much more. We recommend the optional:\nProfessional Training Subscriptions that includes:\n- All on-demand courses\n- Hands-on labs\n- PDF course materials\n- One practice exam attempt per certification path\n- One exam attempt per certification path\n- Ask-the-Instructor sessions\n- All instructor-led, virtual courses\n- Guaranteed slot in all virtual courses\n- First access to new courses\n\nRecommended Courses:\n{courses}';
const TRAINING_FIELDS: ServiceField[] = [
  { key: 'audience', label: 'Who is trained', kind: 'many', choices: ['Operators', 'Analysts'], default: ['Operators', 'Analysts'] },
  { key: 'courses', label: 'Recommended courses', kind: 'many', choices: ['Elasticsearch Engineer', 'Data Analysis with Kibana', 'Elasticsearch Observability Engineer'], default: ['Elasticsearch Engineer', 'Data Analysis with Kibana', 'Elasticsearch Observability Engineer'] },
];

/** Starting catalog: the services named so far. Prices are blank; descriptions only where standard wording exists. */
export const SEED_CATALOG: ServiceItem[] = [
  { id: 'flex-consulting', name: 'Flex Consulting', mpn: '', unit: 'hour', billing: 'one_time', description: '', dated: false },
  { id: 'dedicated-support-engineer', name: 'Dedicated Support Engineer', mpn: '', unit: 'year', billing: 'annual', description: '', dated: true },
  { id: 'on-demand-training', name: 'On-Demand Training Subscription', mpn: '', unit: 'seat', billing: 'annual', description: TRAINING_DESCRIPTION, dated: true, title: 'Training Recommendations', fields: TRAINING_FIELDS },
  { id: 'private-training', name: 'Private Training', mpn: '', unit: 'package', billing: 'one_time', description: '', dated: true },
  { id: 'professional-services-engagement', name: 'Professional Services Engagement', mpn: '', unit: 'day', billing: 'one_time', description: PSE_DESCRIPTION, dated: false, fields: PSE_FIELDS },
];

/** D48 briefly seeded this as its own service; it is the On-Demand Training Subscription (D49). */
export const RETIRED_SERVICE_IDS: Record<string, string> = { 'professional-training-subscription': 'on-demand-training' };

/** Standard services this catalog is missing (removed, or added to the standard list after it was created). */
export function missingStandardServices(catalog: readonly ServiceItem[]): ServiceItem[] {
  const ids = new Set(catalog.map((x) => x.id));
  return SEED_CATALOG.filter((x) => !ids.has(x.id));
}

/** The standard version of a catalog service, when it is one. */
export const standardService = (id: string) => SEED_CATALOG.find((x) => x.id === id);

/**
 * A saved catalog brought up to date: the retired Professional Training Subscription is dropped (scenarios move to
 * On-Demand Training Subscription), and a standard service with no description and no fields yet takes the
 * standard wording, fields and title.
 */
export function upgradeCatalog(catalog: readonly ServiceItem[]): ServiceItem[] {
  return catalog.filter((x) => !(x.id in RETIRED_SERVICE_IDS)).map((x) => {
    const std = standardService(x.id);
    if (!std || x.description.trim() || x.fields?.length || !std.description) return x;
    return { ...x, description: std.description, ...(std.fields ? { fields: std.fields } : {}), ...(std.title && !x.title ? { title: std.title } : {}) };
  });
}

/** Scenario lines pointing at a retired service move to its replacement. */
export function upgradeServices(s: ScenarioServices | undefined): ScenarioServices | undefined {
  if (!s || !s.lines.some((l) => l.serviceId in RETIRED_SERVICE_IDS)) return s;
  return { lines: s.lines.map((l) => (l.serviceId in RETIRED_SERVICE_IDS ? { ...l, serviceId: RETIRED_SERVICE_IDS[l.serviceId]! } : l)) };
}

/** Built-in fields every description can use. */
export interface DescriptionContext { quantity: number; unit: string; customer?: string; deployment?: string }
export const BUILTIN_FIELDS: { key: string; label: string }[] = [
  { key: 'quantity', label: 'the quantity on this scenario' },
  { key: 'unit', label: 'the unit, plural when needed (days, seats)' },
  { key: 'deployment', label: 'Elastic Stack (self-managed) or Elastic Cloud' },
  { key: 'customer', label: 'the customer name on the ROM' },
];

/** The value a scenario line uses for a field: its own, else the field's default. */
export function fieldValue(field: ServiceField, line: ServiceLine): FieldValue {
  const v = line.values?.[field.key];
  return v === undefined ? field.default : v;
}

/** "A", "A and B", "A, B, and C", as the template writes lists in a sentence. */
export function joinWords(items: readonly string[]): string {
  if (items.length <= 2) return items.join(' and ');
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

/**
 * D49: the description with every {key} filled in. A line holding only a pick-several field becomes one bullet
 * per choice (and disappears when none are picked); elsewhere a list reads as words ("A, B, and C").
 * Unknown keys stay as typed, so a typo shows in the preview.
 */
export function fillDescription(item: ServiceItem, line: ServiceLine, ctx: DescriptionContext): string {
  const fields = new Map((item.fields ?? []).map((f) => [f.key, f]));
  const builtin: Record<string, string> = {
    quantity: fmtNum(ctx.quantity, 2), unit: `${item.unit}${ctx.quantity === 1 ? '' : 's'}`,
    ...(ctx.deployment ? { deployment: ctx.deployment } : { deployment: 'Elastic Stack or Elastic Cloud' }),
    ...(ctx.customer ? { customer: ctx.customer } : {}),
  };
  const asText = (key: string, whole: string): string => {
    const f = fields.get(key);
    if (f) { const v = fieldValue(f, line); return Array.isArray(v) ? joinWords(v) : v; }
    return builtin[key] ?? whole;
  };
  return item.description.split(/\r?\n/).flatMap((raw) => {
    const only = /^\s*\{([\w-]+)\}\s*$/.exec(raw);
    const f = only ? fields.get(only[1]!) : undefined;
    if (f && f.kind === 'many') {
      const v = fieldValue(f, line);
      return (Array.isArray(v) ? v : [v]).filter((x) => x.trim()).map((x) => `- ${x}`);
    }
    return [raw.replace(/\{([\w-]+)\}/g, (whole, key: string) => asText(key, whole))];
  }).join('\n');
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
      ...(typeof r.title === 'string' && r.title ? { title: r.title } : {}),
      ...(Array.isArray(r.fields) ? { fields: r.fields.filter(isField) } : {}),
    });
  }
  return out;
}

function isField(f: unknown): f is ServiceField {
  const x = f as Partial<ServiceField> | null;
  return !!x && typeof x.key === 'string' && typeof x.label === 'string' && ['many', 'one', 'text', 'number'].includes(x.kind as string)
    && Array.isArray(x.choices) && (typeof x.default === 'string' || Array.isArray(x.default));
}
