import { sizeTopology } from '@sizing/engine';
import { describe, expect, it } from 'vitest';
import { migrate } from '../src/migrate.ts';
import { topologyMarkdown } from '../src/export.ts';
import { defaultMultiSite, defaultState, topologyRequest, withSiteCount } from '../src/state.ts';

describe('multi-site state (D32)', () => {
  it('identical sites copy site A\'s servers and workloads to every site', () => {
    const req = topologyRequest(defaultMultiSite(), 'independent');
    expect(req.sites.map((s) => s.name)).toEqual(['Site A', 'Site B']);
    expect(req.sites[1]!.servers).toEqual(req.sites[0]!.servers);
    expect(req.sites[1]!.workloads).toEqual(req.sites[0]!.workloads);
  });

  it('in DR only the primary ingests', () => {
    const req = topologyRequest({ ...defaultMultiSite(), leader: 1 }, 'dr');
    expect(req.sites[0]!.workloads).toEqual([]);
    expect(req.sites[1]!.workloads.length).toBe(1);
    expect(req.leader).toBe(1);
  });

  it('different sites are passed through as entered', () => {
    const ms = { ...defaultMultiSite(), identical: false };
    expect(topologyRequest(ms).sites[1]!.servers).toEqual([]);
  });

  it('site count keeps existing sites and clamps the DR primary', () => {
    const ms = withSiteCount({ ...defaultMultiSite(), leader: 1 }, 3);
    expect(ms.sites.map((s) => s.name)).toEqual(['Site A', 'Site B', 'Site C']);
    expect(withSiteCount({ ...ms, leader: 2 }, 1)).toMatchObject({ leader: 0 });
  });

  it('the default 35-server sites fit the default 2 TB/day, with headroom', () => {
    const t = sizeTopology(topologyRequest(defaultMultiSite(), 'independent'));
    expect(t.totals.availableServers).toBe(70);
    expect(t.fitsAll).toBe(true);
    expect(t.headroom!.scale).toBeGreaterThan(1);
  });

  it('exports a Markdown summary with a table per site', () => {
    const md = topologyMarkdown('Two sites', sizeTopology(topologyRequest(defaultMultiSite())), '2026-09-27T00:00:00Z');
    expect(md).toContain('## Site A');
    expect(md).toContain('| hot |');
    expect(md).toContain('Headroom');
  });

  it('scenarios saved before multi-site still load', () => {
    const s = migrate(defaultState())!;
    expect(s.multisite).toBeUndefined();
  });
});
