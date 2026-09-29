import { defaultConstants as c } from '@sizing/constants';
import { describe, expect, it } from 'vitest';
import { compareRecord, diffPct, mergeRecords, parseRecords, summarize, toCsv, type ValidationRecord } from '../src/validation.ts';

// §11.1 F3 at hot 1:50 (D38): 25 hot, 2 frozen, 1,840 GB, 29 ERU.
const f3: ValidationRecord = {
  id: 'a', deal: 'Acme SIEM', checkedBy: 'SA', addedAt: '2026-09-28T00:00:00Z',
  request: { workloads: [{ id: 's', kind: 'siem', rawGbPerDay: 2000, indexMode: 'logsdb', retentionDays: { hot: 30, frozen: 335 }, replicas: {} }], options: { model: 'self_managed' } },
  actual: { nodes: { hot: 30, frozen: 2 }, totalRamGb: 2000, eru: 32 },
};

describe('validation sheet', () => {
  it('difference is (estimated − actual) / actual, blank when there is no actual', () => {
    expect(diffPct(25, 30)).toBeCloseTo(-16.67, 2);
    expect(diffPct(25, undefined)).toBeUndefined();
    expect(diffPct(25, 0)).toBeUndefined();
  });

  it('compares nodes per tier, memory and ERU, flagging gaps over 15%', () => {
    const cmp = compareRecord(c, f3);
    if ('error' in cmp) throw new Error(cmp.error);
    const by = Object.fromEntries(cmp.rows.map((r) => [r.key, r]));
    expect(by['nodes.hot']).toMatchObject({ estimated: 25, actual: 30, within: false });
    expect(by['nodes.frozen']).toMatchObject({ estimated: 2, actual: 2, diffPct: 0, within: true });
    expect(by['totalRamGb']).toMatchObject({ estimated: 1840, actual: 2000, within: true }); // −8%
    expect(by['eru']!.diffPct).toBeCloseTo((29 - 32) / 32 * 100, 9);
  });

  it('shows a tier the customer runs even when the estimate has none', () => {
    const cmp = compareRecord(c, { ...f3, actual: { nodes: { warm: 4 } } });
    if ('error' in cmp) throw new Error(cmp.error);
    expect(cmp.rows.find((r) => r.key === 'nodes.warm')).toMatchObject({ estimated: 0, actual: 4, diffPct: -100 });
  });

  it('summarizes the median gap and the share within 15% per metric', () => {
    const b = { ...f3, id: 'b', actual: { nodes: { hot: 25 } } };
    const s = summarize(c, [f3, b]).find((m) => m.key === 'nodes.hot')!;
    expect(s.deals).toBe(2);
    expect(s.withinShare).toBe(0.5);
    expect(s.medianAbsDiffPct).toBeCloseTo(100 / 12, 6); // median of 16.67 and 0
  });

  it('exports one CSV line per deal and metric, quoting commas', () => {
    const csv = toCsv(c, [{ ...f3, notes: 'hot, then frozen' }]);
    const lines = csv.trim().split('\n');
    expect(lines[0]).toMatch(/^Deal,Checked by,Added,Metric,Estimated,Actual/);
    expect(lines).toHaveLength(1 + 4);
    expect(lines[1]).toContain('"hot, then frozen"');
  });

  it('round-trips through export and import, and import replaces by id', () => {
    const parsed = parseRecords(JSON.parse(JSON.stringify({ records: [f3] })))!;
    expect(parsed[0]).toEqual(f3);
    expect(parseRecords({ nope: 1 })).toBeUndefined();
    const merged = mergeRecords([f3, { ...f3, id: 'b' }], [{ ...f3, deal: 'Renamed' }]);
    expect(merged.map((r) => [r.id, r.deal])).toEqual([['b', 'Acme SIEM'], ['a', 'Renamed']]);
  });
});
