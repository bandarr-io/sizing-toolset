// The formula catalog stays complete and honest: every setting that feeds a calculation is explained by
// some formula, every setting a formula names exists, and the text follows the writing rules.
import { defaultConstants } from '@sizing/constants';
import { describe, expect, it } from 'vitest';
import { ENGINE_FORMULAS } from '../src/index.ts';

/** Settings that feed no calculation (only warnings, labels or reference values), so no formula lists them. */
const NOT_IN_A_FORMULA = new Set<string>([
  'eck.operator_ram_gb', // named in the ECK requirements text only
  'watermark.high', 'watermark.flood_stage', // reference; HV7 uses the low watermark
  'ev_per_s_per_vcpu.band_min', 'ev_per_s_per_vcpu.band_max', // the documented range around the default
  'downsample.default_factor', // reference; workloads carry their own downsample factors
  'shard_docs_max', 'knn.bbq_default_min_dims', 'fleet.max_policies_per_instance', 'fleet.serverless_max_agents', // reference limits
  'autoops.requires_internet', 'fedramp.ech', 'omb_m2614', // facts behind warnings and notes, not numbers in a formula
]);

describe('formula catalog', () => {
  it('ids are unique and every entry is filled in', () => {
    const ids = ENGINE_FORMULAS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const f of ENGINE_FORMULAS) {
      for (const k of ['id', 'area', 'group', 'title', 'formula', 'explanation', 'source', 'code'] as const) expect(f[k], `${f.id}.${k}`).toBeTruthy();
    }
  });

  it('every setting a formula names exists', () => {
    for (const f of ENGINE_FORMULAS) for (const k of f.constantKeys) expect(defaultConstants.byKey.has(k), `${f.id} names ${k}`).toBe(true);
  });

  it('every setting is explained by some formula, or listed as feeding none', () => {
    const named = new Set(ENGINE_FORMULAS.flatMap((f) => f.constantKeys));
    const missing = [...defaultConstants.byKey.keys()].filter((k) => !named.has(k) && !NOT_IN_A_FORMULA.has(k)).sort();
    expect(missing).toEqual([]);
  });

  it('text uses no em dashes', () => {
    for (const f of ENGINE_FORMULAS) expect(`${f.title} ${f.formula} ${f.explanation}`, f.id).not.toContain('—');
  });
});
