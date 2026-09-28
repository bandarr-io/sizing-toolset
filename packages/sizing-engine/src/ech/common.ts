// Shared ECH pricing and packaging rules, as the ECH Ballpark Estimator v4.6 applies them in every use-case sheet.
import { num, type ConstantSet } from '@sizing/constants';
import { ceilEps, fmt, step } from '../math.ts';
import type { MathStep } from '../types.ts';
import { priceKey, type EchChannel, type EchData, type EchDtsItem, type EchPrice, type EchProvider, type EchSku, type EchTier } from './types.ts';

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
