import { ENGINE_FORMULAS } from '@sizing/engine';
import { describe, expect, it } from 'vitest';
import { WEB_FORMULAS } from '../src/formulas/cost.ts';

describe('Total cost formulas', () => {
  it('are filled in, use ids no engine formula uses, and contain no em dashes', () => {
    const engineIds = new Set(ENGINE_FORMULAS.map((f) => f.id));
    expect(WEB_FORMULAS.length).toBeGreaterThan(0);
    for (const f of WEB_FORMULAS) {
      expect(f.area).toBe('Total cost');
      expect(engineIds.has(f.id)).toBe(false);
      for (const k of ['title', 'formula', 'explanation', 'source', 'code'] as const) expect(f[k], `${f.id}.${k}`).toBeTruthy();
      expect(`${f.title} ${f.formula} ${f.explanation}`).not.toContain('—');
    }
  });
});
