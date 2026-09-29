// Shared ECH pricing and packaging rules, as the ECH Ballpark Estimator v4.6 applies them in every use-case sheet.
import { num, val, type ConstantSet } from '@sizing/constants';
import { ceilEps, fmt, step } from '../math.ts';
import type { MathStep } from '../types.ts';
import { priceKey, type EchChannel, type EchLine, type EchRole, type EchData, type EchDtsItem, type EchPrice, type EchProvider, type EchSku, type EchTier } from './types.ts';

export interface EchPlacement {
  provider: EchProvider;
  /** Region display name, e.g. "AWS-us-east-1 (N. Virginia)". */
  region: string;
  channel: EchChannel;
  tier: EchTier;
}

/** Thrown for a configuration the spreadsheet shows as "#NA": unknown instance, not sold, not offered here. */
export class EchUnavailable extends Error {}

const PRICE_COLUMN: Record<EchChannel, keyof EchPrice> = { 'Elastic Direct': 'direct', 'AWS MP': 'awsMp', 'GCP MP': 'gcpMp', 'AZURE MP': 'azureMp' };

export function skuOf(data: EchData, id: string): EchSku {
  const s = data.skus.find((x) => x.id === id);
  if (!s) throw new EchUnavailable(`Unknown ECH instance type ${id}.`);
  return s;
}

/** Specs col I: offered unless the region's name appears in the excluded list (`ISERR(FIND(region, col9))`). */
export function availableIn(sku: EchSku, region: string): boolean {
  return !sku.excludedRegions.includes(region);
}

/** Ref!B18:D38 (C231): the channel sells this tier on this provider. */
export function channelSells(data: EchData, p: EchPlacement): boolean {
  return data.channelTiers.some((x) => x.channel.toUpperCase() === p.channel.toUpperCase() && x.tier === p.tier && x.provider === p.provider);
}

/**
 * $/GB of RAM per month (Logs!I56): ROUND(hourly × 730, 2), after the price adjustment (D40).
 * Throws EchUnavailable when the table has no price for this instance, region, tier and channel.
 */
export function monthlyPerGb(c: ConstantSet, data: EchData, sku: EchSku, p: EchPlacement): { value: number; math: MathStep } {
  if (!availableIn(sku, p.region)) throw new EchUnavailable(`${sku.id} is not offered in ${p.region}.`);
  const hourly = data.prices[priceKey(sku.id, p.region, p.tier)]?.[PRICE_COLUMN[p.channel]];
  if (hourly === undefined) throw new EchUnavailable(`No ${p.tier} price for ${sku.id} in ${p.region} (${p.channel}).`);
  const hours = num(c, 'ech.hours_per_month');
  const adj = num(c, 'ech.price_adjustment');
  const value = Math.round(hourly * adj * hours * 100 + 1e-9) / 100;
  const expr = `ROUND($${fmt(hourly, 4)}/GB-hour${adj !== 1 ? ` × ${fmt(adj, 4)} adjustment` : ''} × ${hours}, 2)`;
  return { value, math: step(`${sku.id} price per GB of RAM per month`, expr, value, ['ech.hours_per_month', 'ech.price_adjustment']) };
}

/** Round an annual line up to the next $1,000 (`roundup(x, -3)`). */
export function roundLine(c: ConstantSet, x: number): number {
  const to = num(c, 'ech.line_rounding_usd');
  return ceilEps(x / to) * to;
}

export interface Fit {
  /** Node size per zone, GB. */
  nodeSizeGb: number;
  nodesPerZone: number;
  zones: number;
  /** nodesPerZone × zones × nodeSizeGb. */
  roundedGb: number;
}

/**
 * Logs!H185:K193: the smallest allowed size that holds the per-zone need, else the largest size;
 * then whole nodes of that size per zone: nodes/zone = ROUNDUP(need / (size × zones)).
 */
export function fitToIncrements(needGb: number, zones: number, increments: readonly number[]): Fit {
  if (!increments.length) throw new EchUnavailable('The instance type has no node sizes.');
  const perZone = needGb / zones;
  const nodeSizeGb = increments.find((h) => perZone <= h + 1e-9) ?? increments[increments.length - 1]!;
  const nodesPerZone = ceilEps(needGb / (nodeSizeGb * zones));
  return { nodeSizeGb, nodesPerZone, zones, roundedGb: nodesPerZone * zones * nodeSizeGb };
}

export function fitStep(label: string, needGb: number, f: Fit): MathStep {
  return step(label, `${fmt(needGb)} GB needed / ${f.zones} zone${f.zones === 1 ? '' : 's'} → ${f.nodesPerZone} × ${fmt(f.nodeSizeGb)} GB per zone × ${f.zones}`, f.roundedGb, []);
}

/** Ref!B157:E180, with the region overrides hardcoded in Logs!I73:I74 when `withOverrides`. */
export function dtsPrice(data: EchData, p: EchPlacement, item: EchDtsItem, withOverrides: boolean): number {
  if (withOverrides) {
    const o = data.dtsOverrides.find((x) => x.provider === p.provider && x.region === p.region && x.item === item);
    if (o) return o.price;
  }
  const row = data.dts.find((x) => x.provider === p.provider && x.item === item && x.channel.toUpperCase() === p.channel.toUpperCase());
  if (!row) throw new EchUnavailable(`No ${item} price for ${p.provider} (${p.channel}).`);
  return row.price;
}

/** The region belongs to the provider and the channel sells this tier there (C229:C232). */
export function checkPlacement(data: EchData, p: EchPlacement): void {
  if (!p.region.toUpperCase().startsWith(p.provider.toUpperCase())) throw new EchUnavailable(`${p.region} is not a ${p.provider.toUpperCase()} region.`);
  if (!channelSells(data, p)) throw new EchUnavailable(`${p.channel} does not sell ${p.tier} on ${p.provider.toUpperCase()}.`);
}

/** The spreadsheet's default instance for a role: its own selection, else the first offered for the role (Specs col Q). */
export function defaultSku(data: EchData, p: EchPlacement, role: EchRole): string {
  const d = data.defaults[p.provider]?.[role];
  if (d) return d;
  const sel = `${role === 'ml' ? 'ML' : role[0]!.toUpperCase() + role.slice(1)}_in_Production`;
  const s = data.skus.find((x) => x.provider === p.provider && x.selection === sel);
  if (!s) throw new EchUnavailable(`No ${role} instance type for ${p.provider}.`);
  return s.id;
}

/** An annual line priced at $/GB-month × RAM × 12, or an error line with a warning where the sheet shows #NA. */
export function pricedLine(
  c: ConstantSet, data: EchData, p: EchPlacement, warnings: string[],
  key: string, label: string, skuId: string, ramGb: number, extra: Partial<EchLine>, math: MathStep[],
): EchLine {
  try {
    const sku = skuOf(data, skuId);
    const price = monthlyPerGb(c, data, sku, p);
    const annual = price.value * ramGb * 12;
    return {
      key, label, sku: sku.id, ramGb, monthlyPerGb: price.value, annual, annualRounded: roundLine(c, annual), ...extra,
      math: [...math, price.math, step(`${label} per year`, `$${fmt(price.value)} × ${fmt(ramGb)} GB × 12`, annual, [])],
    };
  } catch (e) {
    if (!(e instanceof EchUnavailable)) throw e;
    warnings.push(`${label}: ${e.message} The spreadsheet shows #NA and leaves this line out of the total.`);
    return { key, label, sku: skuId, ramGb, annual: 0, annualRounded: 0, math, error: e.message, ...extra };
  }
}

/** Notes about the region itself: US government (FedRAMP) regions, from the `fedramp.ech` facts. */
export function placementNotes(c: ConstantSet, p: EchPlacement): string[] {
  const m = p.region.match(/FedRAMP (High|Moderate)/);
  if (!m) return [];
  const f = val<{ moderate: boolean; high: boolean; region: string; highAuthorizedOn: string }>(c, 'fedramp.ech');
  const level = m[1] as 'High' | 'Moderate';
  if (level === 'High' ? !f.high : !f.moderate) return [`${p.region}: FedRAMP ${level} is not listed as authorized for Elastic Cloud.`];
  return [`${p.region} is a US government region (FedRAMP ${level}, ${f.region}${level === 'High' ? `, authorized ${f.highAuthorizedOn}` : ''}).${level === 'High' && p.tier !== 'Enterprise' ? ' The ballpark spreadsheet offers it with Enterprise only.' : ''}`];
}
