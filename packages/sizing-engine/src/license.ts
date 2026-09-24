import { getConstant, num, type ConstantSet } from '@sizing/constants';
import { ceilEps, fmt, step } from './math.ts';
import { defaultIndexMode } from './profiles.ts';
import type { LicenseTier, MathStep, WorkloadProfile } from './types.ts';

const RANK: Record<LicenseTier, number> = { basic: 0, platinum: 1, enterprise: 2 };

export interface FloorInput {
  hasFrozen: boolean;
  hasMl: boolean;
  ccr: boolean;
  fips: boolean;
  fullLogsdb: boolean;
  profiles: readonly WorkloadProfile[];
}

/** SPEC §5.6: floor = max(required(features)). */
export function licenseFloor(c: ConstantSet, f: FloorInput): { floor: LicenseTier; reasons: string[] } {
  const reasons: string[] = [];
  let floor: LicenseTier = 'basic';
  const need = (key: string, why: string) => {
    const tier = getConstant(c, key).value as LicenseTier;
    reasons.push(`${why} → ${tier}`);
    if (RANK[tier] > RANK[floor]) floor = tier;
  };
  if (f.hasFrozen) need('license.floor.frozen', 'Frozen tier / searchable snapshots');
  if (f.hasMl) need('license.floor.ml', 'Machine learning');
  if (f.ccr) need('license.floor.ccr', 'Cross-cluster replication');
  if (f.fips) need('license.floor.fips_140_3', 'FIPS 140-3');
  if (f.fullLogsdb && f.profiles.some((p) => defaultIndexMode(p) === 'logsdb')) need('license.floor.logsdb_full', 'Full LogsDB capabilities (D12)');
  return { floor, reasons };
}

/** SPEC §5.5 self-managed adapter: ERU = ROUNDUP(total RAM GB / 64). */
export function selfManagedEru(c: ConstantSet, totalRamGb: number): { value: number; math: MathStep[] } {
  const per = num(c, 'eru_gb');
  const value = ceilEps(totalRamGb / per);
  return { value, math: [step('ERU (self-managed)', `ROUNDUP(${fmt(totalRamGb)} GB / ${per})`, value, ['eru_gb', 'eru.counted_components'])] };
}
