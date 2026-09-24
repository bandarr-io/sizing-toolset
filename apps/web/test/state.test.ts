import { forward, reverse } from '@sizing/engine';
import { describe, expect, it } from 'vitest';
import { toJson, toMarkdown } from '../src/export.ts';
import { defaultState, fastToForward, fastToReverse, switchInputMode, type FastForward } from '../src/state.ts';

const ff = (p: Partial<FastForward>): FastForward => ({
  useCase: 'logs', gbPerDay: 100, hotDays: 7, totalRetentionDays: 7, replicas: 1, model: 'self_managed', ...p,
});

describe('fast mode → engine request (D13)', () => {
  it('SIEM 2 TB/day, 30d hot of 365d total reproduces §11.1 F3 (remainder → frozen)', () => {
    const req = fastToForward(ff({ useCase: 'siem', gbPerDay: 2000, hotDays: 30, totalRetentionDays: 365 }));
    expect(req.workloads[0]!.retentionDays).toEqual({ hot: 30, frozen: 335 });
    const r = forward(req);
    expect(r.tiers.map((t) => [t.tier, t.nodes])).toEqual([['hot', 41], ['frozen', 5]]);
    expect(r.totalRamGb).toBe(3056);
  });

  it('metrics remainder goes to warm with the default downsample factor', () => {
    const req = fastToForward(ff({ useCase: 'metrics', hotDays: 7, totalRetentionDays: 37 }));
    expect(req.workloads[0]!.retentionDays).toEqual({ hot: 7, warm: 30 });
    expect(req.workloads[0]!.downsampleFactor).toEqual({ warm: 0.1 });
  });

  it('APM remainder goes to warm without downsampling', () => {
    const req = fastToForward(ff({ useCase: 'apm', hotDays: 7, totalRetentionDays: 15 }));
    expect(req.workloads[0]!.retentionDays).toEqual({ hot: 7, warm: 8 });
    expect(req.workloads[0]!.downsampleFactor).toBeUndefined();
  });

  it('search uses the corpus size on the content tier', () => {
    const req = fastToForward(ff({ useCase: 'search', gbPerDay: 2000, replicas: 2 }));
    expect(req.workloads[0]).toMatchObject({ kind: 'search', totalGb: 2000, replicas: { content: 2 } });
  });

  it('fast reverse reproduces §11.2 R1 shape (3 × 64 GB, 2 TB)', () => {
    const req = fastToReverse({ ...defaultState().fastReverse, diskGb: 2000, useCase: 'logs' });
    req.fixed[0]!.indexMode = 'standard';
    expect(reverse(req).answer!.value.toFixed(2)).toBe('42.67');
  });
});

describe('input mode switching', () => {
  it('seeds expert from fast until expert is edited', () => {
    const s = { ...defaultState(), fastForward: ff({ gbPerDay: 123 }) };
    const e = switchInputMode(s, 'expert');
    expect(e.expertForward.workloads[0]!.rawGbPerDay).toBe(123);
    const edited = { ...switchInputMode(e, 'fast'), expertDirty: true, fastForward: ff({ gbPerDay: 999 }) };
    expect(switchInputMode(edited, 'expert').expertForward.workloads[0]!.rawGbPerDay).toBe(123);
  });
});

describe('export', () => {
  const state = defaultState();
  const req = fastToForward(state.fastForward);
  const result = forward(req);

  it('Markdown has the disclaimer, node table, assumptions and a Rally plan', () => {
    const md = toMarkdown(state, result, req.workloads, '2026-09-23T00:00:00Z');
    expect(md).toContain('Estimate, not benchmark');
    expect(md).toContain('| hot |');
    expect(md).toContain('## Assumptions');
    expect(md).toContain('elastic/logs');
    expect(md).toContain(result.constantsHash.slice(0, 12));
  });

  it('JSON carries engine version and constants hash for reproducibility (FR-E2)', () => {
    const j = JSON.parse(toJson(state, result, '2026-09-23T00:00:00Z'));
    expect(j.engineVersion).toBe(result.engineVersion);
    expect(j.constantsHash).toBe(result.constantsHash);
    expect(forward(fastToForward(j.scenario.fastForward))).toEqual(result);
  });
});
