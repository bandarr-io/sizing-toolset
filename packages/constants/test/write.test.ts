import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { allConstants } from '../src/index.ts';
import { writeOverrides } from '../scripts/write.ts';

const DATA = join(import.meta.dirname, '..', 'data');
// The newest shipped date, so the merged set never looks like it has future-dated constants.
const TODAY = allConstants.map((c) => c.as_of_date).sort().at(-1)!;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'constants-'));
  cpSync(DATA, dir, { recursive: true });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const base = (key: string) => allConstants.find((c) => c.key === key)!;
const read = (file: string) => JSON.parse(readFileSync(join(dir, file), 'utf8')) as { key: string; value: unknown }[];

describe('writeOverrides', () => {
  it('replaces a constant in place and touches only its file', () => {
    const edit = { ...base('mem_disk.hot'), value: 32, as_of_date: TODAY, source_url: 'https://www.elastic.co/x' };
    const r = writeOverrides(dir, [edit], TODAY);
    expect(r).toEqual({ ok: true, errors: [], written: ['storage.json'] });
    const items = read('storage.json');
    expect(items.find((c) => c.key === 'mem_disk.hot')!.value).toBe(32);
    expect(items.map((c) => c.key)).toEqual((JSON.parse(readFileSync(join(DATA, 'storage.json'), 'utf8')) as { key: string }[]).map((c) => c.key));
  });

  it('writes nothing when the merged set fails the CI rules', () => {
    const bad = { ...base('mem_disk.hot'), value: 32, as_of_date: '2024-01-01' };
    const r = writeOverrides(dir, [bad], TODAY);
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toMatch(/older than 12 months/);
    expect(read('storage.json').find((c) => c.key === 'mem_disk.hot')!.value).toBe(50); // unchanged shipped value (D38)
  });

  it('rejects unknown keys', () => {
    const r = writeOverrides(dir, [{ ...base('mem_disk.hot'), key: 'made.up' }], TODAY);
    expect(r).toMatchObject({ ok: false, written: [] });
    expect(r.errors[0]).toMatch(/made\.up/);
  });

  it('reports no files written when nothing changed', () => {
    expect(writeOverrides(dir, [base('mem_disk.hot')], TODAY)).toEqual({ ok: true, errors: [], written: [] });
  });
});
