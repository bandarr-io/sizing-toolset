// Parity with the ECH Ballpark Estimator v4.6 worked examples (D40). Needs the local, git-ignored ECH data:
//   node scripts/ech-import.mjs "<spreadsheet.xlsx>"
// Skipped when the file is absent (CI never has it).
import { buildConstantSet, defaultConstants, type Constant } from '@sizing/constants';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { echObservability, type EchData } from '../../src/index.ts';

const file = fileURLToPath(new URL('../../../../apps/web/public/ech-data.local.json', import.meta.url));
const data: EchData | undefined = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : undefined;
// The spreadsheet's cached totals use the table as-is: no price adjustment.
const c = buildConstantSet([...defaultConstants.byKey.values()].map((x): Constant => (x.key === 'ech.price_adjustment' ? { ...x, value: 1 } : x)));
const base = { provider: 'aws', region: 'AWS-us-east-1 (N. Virginia)', channel: 'Elastic Direct', tier: 'Enterprise' } as const;

describe.skipIf(!data)('ECH v4.6 parity (local data)', () => {
  it('Logs example: 1,000 GB/day, 1 d hot + 29 d frozen → $106,000, Y1 $105,712.33', () => {
    const r = echObservability(c, data!, { ...base, kind: 'logs', gbPerDay: 1000, retentionDays: { hot: 1, frozen: 29 } });
    const by = Object.fromEntries(r.lines.map((l) => [l.key, l]));
    expect(by.hot).toMatchObject({ ramGb: 60, nodesPerZone: 1, nodeSizeGb: 30, zones: 2, monthlyPerGb: 77.09, annualRounded: 56000, constraint: 'disk' });
    expect(by.frozen).toMatchObject({ ramGb: 15, annualRounded: 8000 });
    expect(by.transfer!.annualRounded).toBe(19000);
    expect(by.storage!.annualRounded).toBe(7000);
    expect([by.master, by.coordinating, by.ml, by.kibana].map((l) => l!.annualRounded)).toEqual([3000, 2000, 3000, 8000]);
    expect(r.totalRounded).toBe(106000);
    expect(r.y1SpendRounded).toBeCloseTo(105712.33, 2);
  });

  it('Metrics example: 100,000 datapoints/s, 1 d hot + 23 d frozen → $49,000, Y1 $48,967.12', () => {
    const r = echObservability(c, data!, { ...base, kind: 'metrics', datapointsPerSecond: 100_000, retentionDays: { hot: 1, frozen: 23 } });
    const by = Object.fromEntries(r.lines.map((l) => [l.key, l]));
    expect(r.dailyGb).toBeCloseTo(43.2, 9);
    expect(by.hot).toMatchObject({ ramGb: 30, nodeSizeGb: 15, constraint: 'cpu', annualRounded: 28000 });
    expect(by.frozen).toMatchObject({ ramGb: 4, annualRounded: 3000 });
    expect([by.transfer!.annualRounded, by.storage!.annualRounded]).toEqual([1000, 1000]);
    expect(r.totalRounded).toBe(49000);
    expect(r.y1SpendRounded).toBeCloseTo(48967.12, 2);
  });
});
