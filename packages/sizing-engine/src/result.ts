import { num, val, type ConstantSet } from '@sizing/constants';
import { fmt, step } from './math.ts';
import type { CcrMode, DeploymentModel, MathStep, OverheadResult, TierResult, Warning } from './types.ts';

export const ENGINE_VERSION = '0.1.0';

/** D3: total RAM counts Elasticsearch (data tiers included), Kibana and APM; Fleet per `eru.counted_components`. */
export function totalsFor(c: ConstantSet, tiers: readonly TierResult[], overhead: readonly OverheadResult[]): { totalRamGb: number; totalRamMath: MathStep[] } {
  const counted = val<Record<string, boolean>>(c, 'eru.counted_components');
  const parts: string[] = [];
  let total = 0;
  if (counted.elasticsearch ?? true) {
    for (const t of tiers) { total += t.nodes * t.ramGb; parts.push(`${t.nodes}×${fmt(t.ramGb)} ${t.tier}`); }
  }
  for (const o of overhead) {
    if (!o.countsTowardLicense) continue;
    total += o.count * o.ramGb;
    parts.push(`${o.count}×${fmt(o.ramGb)} ${o.role}`);
  }
  const excluded = overhead.filter((o) => !o.countsTowardLicense).map((o) => `${o.role} (${o.count}×${fmt(o.ramGb)} GB)`);
  return {
    totalRamGb: total,
    totalRamMath: [
      step('total RAM GB (counted components, D3)', parts.join(' + ') || '0', total, ['eru.counted_components']),
      ...(excluded.length ? [step('not counted', excluded.join(', '), 0, ['eru.counted_components'])] : []),
    ],
  };
}

export function commonWarnings(model: DeploymentModel): Warning[] {
  if (model === 'self_managed') return [];
  return [{
    id: 'ADAPTER', severity: 'info',
    message: `The ${model} adapter is not in the MVP. License units are shown as self-managed ERU.`,
  }];
}

export function buildAssumptions(c: ConstantSet, s: { sites: number; ccrMode: CcrMode; growthYears: number; airGapped: boolean }): string[] {
  const a = [
    'Estimate, not benchmark. Storage math is reliable; CPU, query latency and ML are not. Validate with Rally on the customer\'s hardware.',
    `Storage = data × ${num(c, 'storage_overhead')} (15% watermark headroom + 10% margin), plus 1 failover node per tier.`,
    `Default data node: ${num(c, 'node_ram_default_gb')} GB RAM; mem:disk hot 1:${num(c, 'mem_disk.hot')}, warm 1:${num(c, 'mem_disk.warm')}, cold 1:${num(c, 'mem_disk.cold')}, frozen 1:${num(c, 'mem_disk.frozen')} (object store).`,
    `Heap = min(50% RAM, ${num(c, 'heap_cap_gb')} GB); vector off-heap = RAM − heap − ${num(c, 'offheap_reserve_gb')} GB.`,
    `Index ratios: standard ${num(c, 'index_ratio.standard')}, LogsDB ${num(c, 'index_ratio.logsdb')}, TSDS ${num(c, 'index_ratio.tsds')} (±30%).`,
    'Cold and frozen tiers carry no replicas.',
    'Total RAM and ERU count Elasticsearch, Kibana and APM; Fleet Server is excluded (confirm per contract).',
    `CPU ceiling uses ${num(c, 'ev_per_s_per_vcpu')} events/s per vCPU (Low confidence; Rally required).`,
    'Vector formulas can understate BBQ memory (GitHub #117877); keep a 20–25% buffer.',
  ];
  if (s.sites > 1) a.push(`${s.sites} sites; figures are per site unless labeled "all sites". CCR mode: ${s.ccrMode}.`);
  if (s.growthYears > 0) a.push(`Growth applied over ${fmt(s.growthYears)} year(s) where a growth % is set.`);
  if (s.airGapped) a.push('Air-gapped: AutoOps and Cloud Connect are unavailable; use Stack Monitoring.');
  return a;
}
