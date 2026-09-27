import { defaultConstants } from '@sizing/constants';
import { forward, type SizingResult } from '@sizing/engine';
import { describe, expect, it } from 'vitest';
import { annualCosts, costReport, mergeRates, nodeInventory, subscriptionCost, termCosts, type CostRates } from '../src/cost.ts';
import { toMarkdown } from '../src/export.ts';
import { defaultState, type AppState } from '../src/state.ts';

const state: AppState = defaultState();
const r: SizingResult = forward(state.forward);
const nodes = nodeInventory(state, r);
const allNodes = nodes.reduce((s, n) => s + n.count, 0);
const line = (rates: CostRates, part: string) => annualCosts(state, r, rates).find((l) => l.part === part)!;

describe('cost: subscription', () => {
  it('is ERU × price per ERU per year on Enterprise', () => {
    expect(r.licenseFloor).toBe('enterprise');
    expect(subscriptionCost(r, { eruPerYear: 1000 }).annual).toBe(r.allSites.licenseUnits * 1000);
  });

  it('is zero on Basic, even with a price set', () => {
    const basic = forward({ ...state.forward, workloads: [{ ...state.forward.workloads[0]!, retentionDays: { hot: 7 } }] });
    expect(basic.licenseFloor).toBe('basic');
    expect(subscriptionCost(basic, { eruPerYear: 1000 }).annual).toBe(0);
  });

  it('is left out, not zero, when no price is set', () => {
    expect(subscriptionCost(r, {}).annual).toBeUndefined();
  });
});

describe('cost: platform components', () => {
  it('inventory lists every node the result sizes, with a local disk type', () => {
    expect(allNodes).toBe(r.tiers.reduce((s, t) => s + t.nodes, 0) + r.overhead.reduce((s, o) => s + o.count, 0));
    expect(nodes.find((n) => n.role === 'hot')!.diskType).toBe('nvme');
    expect(nodes.find((n) => n.role === 'frozen')!.diskType).toBe('ssd');
  });

  it('hardware = (servers by GB RAM + disks by TB and type) / amortization years', () => {
    const rates: CostRates = { serverPerGbRam: 10, diskPerTb: { nvme: 100, ssd: 50, hdd: 20 }, amortYears: 4 };
    const capex = nodes.reduce((s, n) => s + n.count * (n.ramGb * 10 + (n.diskGb / 1000) * rates.diskPerTb![n.diskType]!), 0);
    expect(line(rates, 'hardware').annual).toBeCloseTo(capex / 4, 6);
  });

  it('object storage = TB × price per TB-month × 12', () => {
    expect(line({ objectPerTbMonth: 20 }, 'object').annual).toBeCloseTo((r.objectStorage!.gb / 1000) * 20 * 12, 6);
  });

  it('hosting = nodes × price per node-month × 12, and ops = FTEs × cost per FTE', () => {
    expect(line({ hostingPerNodeMonth: 100 }, 'hosting').annual).toBe(allNodes * 100 * 12);
    expect(line({ opsFte: 1.5, opsCostPerFte: 200_000 }, 'ops').annual).toBe(300_000);
  });

  it('a component with a missing price has no annual figure', () => {
    expect(line({ serverPerGbRam: 10 }, 'hardware').annual).toBeUndefined();
  });
});

describe('cost: export', () => {
  it('the Markdown export has a cost section only when a cost report is passed in', () => {
    const at = '2026-09-26T00:00:00Z';
    expect(toMarkdown(state, r, state.forward.workloads, at)).not.toMatch(/Estimated cost/);
    const withCost = toMarkdown(state, r, state.forward.workloads, at, costReport(state, defaultConstants, { eruPerYear: 1000 }));
    expect(withCost).toMatch(/## Estimated cost/);
    expect(withCost).toMatch(/Elastic subscription/);
  });

  it('the subscription line replaces the license floor line (D29)', () => {
    expect(toMarkdown(state, r, state.forward.workloads, 'x')).toMatch(/Subscription: \*\*Enterprise, \d+ ERU\*\*/);
  });
});

describe('cost: rates and term', () => {
  it('scenario prices override defaults field by field', () => {
    expect(mergeRates({ eruPerYear: 1000, opsFte: 1 }, { eruPerYear: 1200 })).toEqual({ eruPerYear: 1200, opsFte: 1 });
    expect(mergeRates({ diskPerTb: { nvme: 100, ssd: 50 } }, { diskPerTb: { ssd: 40 } }).diskPerTb).toEqual({ nvme: 100, ssd: 40 });
  });

  it('term total adds each year, sized for that year', () => {
    const rates: CostRates = { eruPerYear: 1000, hostingPerNodeMonth: 100 };
    const t = termCosts(state, rates, [r, r, r]);
    expect(t.years).toHaveLength(3);
    expect(t.total).toBeCloseTo(3 * t.years[0]!.total, 6);
  });
});
