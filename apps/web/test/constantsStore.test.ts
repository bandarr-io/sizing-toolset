import { allConstants, buildConstantSet, constantsHash, type Constant } from '@sizing/constants';
import { forward } from '@sizing/engine';
import { describe, expect, it } from 'vitest';
import { applyOverrides, pruneOverrides, sameShape, validateDraft } from '../src/constantsStore.tsx';

const TODAY = '2026-09-24';
const base = (key: string) => allConstants.find((c) => c.key === key)!;
const edited = (key: string, patch: Partial<Constant>): Constant => ({ ...base(key), as_of_date: TODAY, ...patch });

describe('validateDraft', () => {
  it('accepts a sourced, dated number change', () => {
    expect(validateDraft(base('mem_disk.hot'), edited('mem_disk.hot', { value: 32 }), TODAY)).toEqual([]);
  });
  it('requires a new date or source when the value changes', () => {
    const d = { ...base('mem_disk.hot'), value: 32 };
    expect(validateDraft(base('mem_disk.hot'), d, TODAY).join()).toMatch(/new checked date or a new source link/);
  });
  it('applies the CI rules: https source, date within 12 months, not in the future', () => {
    const b = base('mem_disk.hot');
    expect(validateDraft(b, edited('mem_disk.hot', { value: 32, source_url: 'http://x.example' }), TODAY).join()).toMatch(/https/);
    expect(validateDraft(b, edited('mem_disk.hot', { value: 32, as_of_date: '2025-01-01' }), TODAY).join()).toMatch(/older than 12 months/);
    expect(validateDraft(b, edited('mem_disk.hot', { value: 32, as_of_date: '2026-12-01' }), TODAY).join()).toMatch(/future/);
  });
  it('rejects divisors of zero, negatives, NaN and derates of 1', () => {
    expect(validateDraft(base('mem_disk.hot'), edited('mem_disk.hot', { value: 0 }), TODAY).join()).toMatch(/greater than 0/);
    expect(validateDraft(base('storage.margin'), edited('storage.margin', { value: -0.1 }), TODAY).join()).toMatch(/negative/);
    expect(validateDraft(base('mem_disk.hot'), edited('mem_disk.hot', { value: Number.NaN }), TODAY).join()).toMatch(/finite/);
    expect(validateDraft(base('ingest.derate.logsdb'), edited('ingest.derate.logsdb', { value: 1 }), TODAY).join()).toMatch(/less than 1/);
  });
  it('keeps the shape of structured values', () => {
    const table = base('fleet.table').value as Record<string, number>[];
    const ok = edited('fleet.table', { value: [...table, { ...table[table.length - 1]!, agents: 200000 }] });
    expect(validateDraft(base('fleet.table'), ok, TODAY)).toEqual([]);
    const missingCol = edited('fleet.table', { value: table.map(({ hotVcpu: _x, ...r }) => r) });
    expect(validateDraft(base('fleet.table'), missingCol, TODAY).join()).toMatch(/original shape/);
    expect(validateDraft(base('mem_disk.hot'), edited('mem_disk.hot', { value: '30' }), TODAY).join()).toMatch(/original shape/);
  });
  it('keeps ordered tables sorted', () => {
    const table = base('fleet.table').value as Record<string, number>[];
    const swapped = edited('fleet.table', { value: [table[1]!, table[0]!, ...table.slice(2)] });
    expect(validateDraft(base('fleet.table'), swapped, TODAY).join()).toMatch(/sorted by agents/);
    const masters = base('masters.sizing').value as Record<string, number>[];
    const noZero = edited('masters.sizing', { value: masters.slice(1) });
    expect(validateDraft(base('masters.sizing'), noZero, TODAY).join()).toMatch(/minDataNodes = 0/);
  });
  it('limits license floors to known tiers', () => {
    expect(validateDraft(base('license.floor.ml'), edited('license.floor.ml', { value: 'gold' }), TODAY).join()).toMatch(/one of basic/);
  });
});

describe('overrides', () => {
  it('sameShape compares types, keys and rows', () => {
    expect(sameShape({ a: 1 }, { a: 2 })).toBe(true);
    expect(sameShape({ a: 1 }, { b: 1 })).toBe(false);
    expect(sameShape([{ a: 1 }], [])).toBe(false);
  });
  it('pruneOverrides drops entries equal to shipped values and unknown keys', () => {
    const same = base('mem_disk.hot');
    const changed = edited('mem_disk.warm', { value: 150 });
    const unknown = { ...same, key: 'nope' };
    expect(Object.keys(pruneOverrides(allConstants, { [same.key]: same, [changed.key]: changed, nope: unknown }))).toEqual(['mem_disk.warm']);
  });
  it('an override changes the engine result and the constants hash', () => {
    const req = { workloads: [{ id: 'a', kind: 'logs' as const, rawGbPerDay: 30, indexMode: 'standard' as const, retentionDays: { hot: 30 }, replicas: {} }], options: { model: 'self_managed' as const } };
    const set = buildConstantSet(applyOverrides(allConstants, { 'mem_disk.hot': edited('mem_disk.hot', { value: 10 }) }));
    expect(set.hash).not.toBe(constantsHash);
    // 2,700 GB / (64 × 10) = 4.2 → 5 + 1 = 6 hot nodes, versus 2 with the 1:50 default (D38).
    expect(forward(req, set).tiers[0]!.nodes).toBe(6);
    expect(forward(req).tiers[0]!.nodes).toBe(2);
  });
});
