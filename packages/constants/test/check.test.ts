import { describe, expect, it } from 'vitest';
import { allConstants } from '../src/index.ts';
import { checkConstants, cutoffDate } from '../scripts/check.ts';

const valid = {
  key: 'x', value: 1, unit: 'u', source_url: 'https://www.elastic.co/x',
  as_of_date: '2026-09-01', stack_version: '9.4', confidence: 'high',
};
const TODAY = '2026-09-23';

describe('SPEC §6 CI rule', () => {
  it('passes the shipped constants', () => {
    // As of the newest shipped constant, so adding a constant dated today never breaks this test.
    const newest = allConstants.map((c) => c.as_of_date).sort().at(-1)!;
    expect(checkConstants(allConstants, newest)).toEqual([]);
  });

  it('accepts a valid constant', () => {
    expect(checkConstants([valid], TODAY)).toEqual([]);
  });

  it('fails when source_url is missing', () => {
    const { source_url: _omit, ...noUrl } = valid;
    expect(checkConstants([noUrl], TODAY).join()).toMatch(/source_url/);
  });

  it('fails when source_url is not a URI or not https', () => {
    expect(checkConstants([{ ...valid, source_url: 'carried forward' }], TODAY).join()).toMatch(/format "uri"/);
    expect(checkConstants([{ ...valid, source_url: 'http://example.com' }], TODAY).join()).toMatch(/https/);
  });

  it('fails when as_of_date is missing or not a date', () => {
    const { as_of_date: _omit, ...noDate } = valid;
    expect(checkConstants([noDate], TODAY).join()).toMatch(/as_of_date/);
    expect(checkConstants([{ ...valid, as_of_date: '2026-09' }], TODAY).join()).toMatch(/format "date"/);
  });

  it('allows exactly 12 months, fails one day older', () => {
    expect(cutoffDate(TODAY)).toBe('2025-09-23');
    expect(checkConstants([{ ...valid, as_of_date: '2025-09-23' }], TODAY)).toEqual([]);
    expect(checkConstants([{ ...valid, as_of_date: '2025-09-22' }], TODAY).join()).toMatch(/older than 12 months/);
  });

  it('fails the shipped constants once they age out', () => {
    expect(checkConstants(allConstants, '2027-09-02').length).toBeGreaterThan(0);
  });

  it('fails future dates and duplicate keys', () => {
    expect(checkConstants([{ ...valid, as_of_date: '2026-10-01' }], TODAY).join()).toMatch(/future/);
    expect(checkConstants([valid, valid], TODAY).join()).toMatch(/duplicate/);
  });

  it('fails a bad confidence value', () => {
    expect(checkConstants([{ ...valid, confidence: 'certain' }], TODAY).join()).toMatch(/allowed values/);
  });
});
