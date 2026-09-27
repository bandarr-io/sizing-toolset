// SPEC §11.3 property-based tests (fast-check, fixed seed).
import fc from 'fast-check';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  forward, reverse, type ForwardRequest, type IndexMode, type NodeGroup, type SizingResult, type Tier, type WorkloadProfile,
} from '../src/index.ts';

beforeAll(() => fc.configureGlobal({ seed: 20260923, numRuns: 300 }));

const nodes = (r: SizingResult, tier: Tier) => r.tiers.find((t) => t.tier === tier)?.nodes ?? 0;
const storageStep = (r: SizingResult, tier: Tier) =>
  r.tiers.find((t) => t.tier === tier)!.math.find((s) => s.label === 'total storage GB')!.value;

const modeArb = fc.constantFrom<IndexMode>('standard', 'logsdb', 'tsds');
const hwArb = fc.record({
  count: fc.integer({ min: 2, max: 60 }),
  ramGb: fc.constantFrom(16, 32, 64),
  ratio: fc.integer({ min: 15, max: 45 }),
  replicas: fc.integer({ min: 0, max: 2 }),
  days: fc.integer({ min: 1, max: 120 }),
  mode: modeArb,
});

function hotRequest(h: { count: number; ramGb: number; ratio: number; replicas: number; days: number; mode: IndexMode }, gbDay?: number) {
  const group: NodeGroup = { role: 'hot', count: h.count, ramGb: h.ramGb, diskGb: h.ramGb * h.ratio, diskType: 'nvme', vcpu: 1024 };
  const profile: WorkloadProfile = {
    id: 'w', kind: 'logs', indexMode: h.mode, retentionDays: { hot: h.days }, replicas: { hot: h.replicas },
    ...(gbDay !== undefined ? { rawGbPerDay: gbDay } : {}),
  };
  return { group, profile };
}
function forwardFor(h: Parameters<typeof hotRequest>[0], profile: WorkloadProfile): SizingResult {
  return forward({
    workloads: [profile],
    options: { model: 'self_managed', nodes: { hot: { ramGb: h.ramGb, diskGb: h.ramGb * h.ratio, vcpu: 1024 } } },
  });
}

describe('§11.3 properties', () => {
  it('P1 round-trip (max_gb_day): forward(reverse(hw)) ≤ hw nodes; +ε exceeds', () => {
    fc.assert(fc.property(hwArb, (h) => {
      const { group, profile } = hotRequest(h);
      const max = reverse({ hardware: { model: 'self_managed', groups: [group] }, fixed: [profile], solve: 'max_gb_day' }).answer!.value;
      expect(nodes(forwardFor(h, { ...profile, rawGbPerDay: max }), 'hot')).toBeLessThanOrEqual(h.count);
      expect(nodes(forwardFor(h, { ...profile, rawGbPerDay: max * (1 + 1e-6) }), 'hot')).toBeGreaterThan(h.count);
    }));
  });

  it('P1 round-trip (max_retention): max fits, max + 1 day does not', () => {
    fc.assert(fc.property(hwArb, fc.integer({ min: 1, max: 500 }), (h, gbDay) => {
      const { group, profile } = hotRequest(h, gbDay);
      const r = reverse({ hardware: { model: 'self_managed', groups: [group] }, fixed: [profile], solve: 'max_retention' });
      const max = r.answer!.value;
      fc.pre(max >= 1);
      expect(nodes(forwardFor(h, { ...profile, retentionDays: { hot: max } }), 'hot')).toBeLessThanOrEqual(h.count);
      // "+1 pushes over" holds for the storage tier only; a shard-bound answer stops before storage fills.
      if (r.answer!.binding !== 'storage' && r.answer!.binding !== 'disk') return;
      expect(nodes(forwardFor(h, { ...profile, retentionDays: { hot: max + 1 } }), 'hot')).toBeGreaterThan(h.count);
    }));
  });

  const profileArb = fc.record({
    gbDay: fc.double({ min: 1, max: 5000, noNaN: true }),
    hot: fc.integer({ min: 1, max: 90 }),
    warm: fc.integer({ min: 0, max: 180 }),
    frozen: fc.integer({ min: 0, max: 365 }),
    replicas: fc.integer({ min: 0, max: 2 }),
    ratio: fc.double({ min: 0.1, max: 2, noNaN: true }),
  });
  const req = (p: { gbDay: number; hot: number; warm: number; frozen: number; replicas: number; ratio: number }): ForwardRequest => ({
    workloads: [{
      id: 'w', kind: 'logs', rawGbPerDay: p.gbDay, indexRatioOverride: p.ratio,
      retentionDays: { hot: p.hot, warm: p.warm, frozen: p.frozen }, replicas: { hot: p.replicas, warm: p.replicas },
    }],
    options: { model: 'self_managed' },
  });
  const allTierNodes = (r: SizingResult) => (['hot', 'warm', 'frozen'] as Tier[]).map((t) => nodes(r, t));

  it('P2 monotonicity: node counts never decrease as GB/day, retention, replicas or index ratio increase', () => {
    fc.assert(fc.property(profileArb, fc.double({ min: 1, max: 3, noNaN: true }), fc.integer({ min: 1, max: 60 }), (p, k, dd) => {
      const base = allTierNodes(forward(req(p)));
      const bumps = [
        { ...p, gbDay: p.gbDay * k },
        { ...p, hot: p.hot + dd, warm: p.warm + dd, frozen: p.frozen + dd },
        { ...p, replicas: p.replicas + 1 },
        { ...p, ratio: p.ratio * k },
      ];
      for (const b of bumps) {
        const after = allTierNodes(forward(req(b)));
        after.forEach((n, i) => expect(n).toBeGreaterThanOrEqual(base[i]!));
        expect(forward(req(b)).totalRamGb).toBeGreaterThanOrEqual(forward(req(p)).totalRamGb);
      }
    }));
  });

  it('P3 scaling: doubling GB/day at fixed retention doubles storage exactly', () => {
    fc.assert(fc.property(profileArb, (p) => {
      const a = forward(req(p));
      const b = forward(req({ ...p, gbDay: p.gbDay * 2 }));
      expect(storageStep(b, 'hot')).toBe(storageStep(a, 'hot') * 2);
      if (p.warm > 0) expect(storageStep(b, 'warm')).toBe(storageStep(a, 'warm') * 2);
    }));
  });

  it('P4 determinism: same inputs + constants hash → same outputs', () => {
    fc.assert(fc.property(profileArb, (p) => {
      expect(forward(req(p))).toEqual(forward(req(p)));
    }), { numRuns: 50 });
    const fixed = forward(req({ gbDay: 600, hot: 30, warm: 0, frozen: 335, replicas: 1, ratio: 0.5 }));
    expect(fixed).toMatchSnapshot();
  });

  it('P5 license floor: adding frozen → Enterprise; removing licensed features never raises the floor', () => {
    const rank = { basic: 0, enterprise: 1 } as const;
    fc.assert(fc.property(profileArb, fc.boolean(), fc.boolean(), fc.boolean(), (p, ml, fips, ccr) => {
      const withFrozen = forward(req({ ...p, frozen: Math.max(1, p.frozen) }));
      expect(withFrozen.licenseFloor).toBe('enterprise');

      const build = (useMl: boolean, useFips: boolean, useCcr: boolean, frozen: number) => {
        const r = req({ ...p, frozen });
        if (useMl) r.workloads.push({ id: 'ml', kind: 'ml', ml: { anomalyJobs: 10 }, retentionDays: {}, replicas: {} });
        r.options = { ...r.options, fips: useFips, ...(useCcr ? { ccrMode: 'unidirectional', sites: 2 } : {}) };
        return forward(r).licenseFloor;
      };
      const full = build(ml, fips, ccr, p.frozen);
      for (const stripped of [build(false, fips, ccr, p.frozen), build(ml, false, ccr, p.frozen), build(ml, fips, false, p.frozen), build(ml, fips, ccr, 0)]) {
        expect(rank[stripped]).toBeLessThanOrEqual(rank[full]);
      }
    }));
  });

  it.todo('P6 units: ECK GiB/GB round-trip (ECK adapter is out of MVP scope)');
});
