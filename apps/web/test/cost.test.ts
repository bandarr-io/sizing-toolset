import { defaultConstants } from '@sizing/constants';
import { forward, type SizingResult } from '@sizing/engine';
import { describe, expect, it } from 'vitest';
import { annualCosts, costReport, mergeRates, nodeInventory, subscriptionCost, termCosts, validDiscount, type CostRates } from '../src/cost.ts';
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

describe('cost: subscription discount', () => {
  const list = r.allSites.licenseUnits * 1000;

  it('takes the percentage off the list price and shows list, discount and net in the math', () => {
    const s = subscriptionCost(r, { eruPerYear: 1000 }, 25);
    expect(s.annual).toBeCloseTo(list * 0.75, 6);
    expect(s.label).toBe('Elastic subscription (25% discount)');
    expect(s.math.map((m) => m.value)).toEqual([list, list * 0.25, list * 0.75]);
  });

  it('0% or blank leaves the list price; 100% makes it free', () => {
    expect(subscriptionCost(r, { eruPerYear: 1000 }, 0).annual).toBe(list);
    expect(subscriptionCost(r, { eruPerYear: 1000 }).annual).toBe(list);
    expect(subscriptionCost(r, { eruPerYear: 1000 }, 100).annual).toBe(0);
  });

  it('ignores a value outside 0 to 100 instead of producing a negative or inflated price', () => {
    expect(validDiscount(-5)).toBeUndefined();
    expect(validDiscount(120)).toBeUndefined();
    expect(subscriptionCost(r, { eruPerYear: 1000 }, 120).annual).toBe(list);
  });

  it('applies only to the subscription line of the total, and carries into the term and export', () => {
    const rates: CostRates = { eruPerYear: 1000, hostingPerNodeMonth: 100 };
    const discounted: AppState = { ...state, cost: { discountPct: 40 } };
    const plain = annualCosts(state, r, rates);
    const off = annualCosts(discounted, r, rates);
    expect(off.find((l) => l.part === 'subscription')!.annual).toBeCloseTo(list * 0.6, 6);
    expect(off.find((l) => l.part === 'hosting')!.annual).toBe(plain.find((l) => l.part === 'hosting')!.annual);
    const report = costReport(discounted, defaultConstants, rates);
    expect('error' in report).toBe(false);
    const md = toMarkdown(discounted, r, discounted.forward.workloads, 'x', report);
    expect(md).toContain('Elastic subscription (40% discount)');
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
