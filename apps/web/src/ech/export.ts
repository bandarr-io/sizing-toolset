import type { EchData } from '@sizing/engine';
import { servicesMarkdown } from '../export.ts';
import { fmtMoney, fmtNum } from '../format.ts';
import type { PricedServiceLine } from '../services.ts';
import { echTotals, placementSummary, useCaseLabel, type EchOutcome, type EchState } from './state.ts';

/** A Markdown summary of an ECH estimate for sharing. */
export function echMarkdown(name: string, s: EchState, data: EchData, outcomes: EchOutcome[], at: string, services: readonly PricedServiceLine[] = []): string {
  const t = echTotals(outcomes, s.roundLines);
  const money = (exact: number, rounded: number) => fmtMoney(s.roundLines ? rounded : exact);
  const L: string[] = [
    `# ${name}: Elastic Cloud Hosted estimate`, '',
    `> **A ballpark, not a quote.** List prices before discounts, from the ECH Ballpark Estimator v${data.source.version} price table. Use the official quoting tool for customer prices.`, '',
    `- Where: ${placementSummary(s.placement)}`,
    `- Per year: **${fmtMoney(t.annual)}** (${fmtMoney(t.annual / 12)} a month; ${fmtMoney(t.y1)} in year one)${s.roundLines ? ', each line rounded up to $1,000' : ''}`,
    `- Generated ${at.slice(0, 10)}`, '',
  ];
  for (const o of outcomes) {
    L.push(`## ${o.item.name} (${useCaseLabel(o.item.useCase)})`, '');
    if ('error' in o) { L.push(`Cannot price this yet: ${o.error}`, ''); continue; }
    L.push('| Part | Instance | Size | $/GB-month | Per year |', '|---|---|---|---:|---:|');
    for (const l of o.result.lines) {
      const size = l.nodesPerZone !== undefined ? `${l.nodesPerZone} × ${fmtNum(l.nodeSizeGb ?? 0)} GB × ${l.zones} zones` : l.ramGb !== undefined ? `${fmtNum(l.ramGb)} GB` : '';
      L.push(`| ${l.label} | ${l.sku ?? ''} | ${size} | ${l.monthlyPerGb === undefined ? '' : fmtMoney(l.monthlyPerGb, 2)} | ${l.error ? `– (${l.error})` : money(l.annual, l.annualRounded)} |`);
    }
    L.push(`| **Total** | | | | **${money(o.result.total, o.result.totalRounded)}** |`, '');
    if (o.result.warnings.length) L.push(...o.result.warnings.map((w) => `- ${w}`), '');
  }
  if (services.some((p) => p.item)) L.push(...servicesMarkdown(services), 'Services are not included in the Elastic Cloud total above.', '');
  return L.join('\n');
}
