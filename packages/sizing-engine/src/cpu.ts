import { num, type ConstantSet } from '@sizing/constants';
import { defaultIndexMode, growthFactor, replicasFor } from './profiles.ts';
import type { Tier, WorkloadProfile } from './types.ts';

/** SPEC §5.9 derates, as a multiplier on events/s per vCPU for this profile. */
export function derateFactor(c: ConstantSet, p: WorkloadProfile, concurrentSearch: boolean): { factor: number; keys: string[]; notes: string[] } {
  let factor = 1;
  const keys: string[] = [];
  const notes: string[] = [];
  if (p.ingestPipelines) { factor *= 1 - num(c, 'ingest.derate.pipelines'); keys.push('ingest.derate.pipelines'); notes.push('pipelines'); }
  if (defaultIndexMode(p) === 'logsdb') { factor *= 1 - num(c, 'ingest.derate.logsdb'); keys.push('ingest.derate.logsdb'); notes.push('LogsDB'); }
  if (concurrentSearch) { factor *= 1 - num(c, 'ingest.derate.concurrent_search'); keys.push('ingest.derate.concurrent_search'); notes.push('concurrent search'); }
  return { factor, keys, notes };
}

export function avgEventKb(c: ConstantSet, p: WorkloadProfile): number {
  return p.avgEventKb ?? num(c, 'ingest.default_avg_event_kb');
}

/**
 * Ingest demand of one profile in base events/s (derates folded into demand) (SPEC §5.3 max_GB_day(cpu), solved for demand):
 * GB/day × 1e6 / (KB × 86,400) × (replicas + 1) / derate.
 */
export function ingestDemandEvents(c: ConstantSet, p: WorkloadProfile, tier: Tier, growthYears: number, concurrentSearch: boolean): number {
  if (!p.rawGbPerDay) return 0;
  const gbDay = p.rawGbPerDay * growthFactor(p, growthYears);
  const events = (gbDay * 1e6) / (avgEventKb(c, p) * 86_400);
  return (events * (replicasFor(p, tier) + 1)) / derateFactor(c, p, concurrentSearch).factor;
}
