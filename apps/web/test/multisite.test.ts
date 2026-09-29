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

  it('D35: a saved full-LogsDB flag is dropped on load, everywhere it could live', () => {
    const s = { ...defaultState(), multisite: { ...defaultMultiSite(), options: { model: 'self_managed' as const, fullLogsdb: true } } };
    s.forward = { ...s.forward, options: { ...s.forward.options, fullLogsdb: true } };
    s.reverse = { ...s.reverse, fullLogsdb: true };
    const m = migrate(s)!;
    expect(m.forward.options.fullLogsdb).toBeUndefined();
    expect(m.reverse.fullLogsdb).toBeUndefined();
    expect(m.multisite!.options.fullLogsdb).toBeUndefined();
  });

  it('scenarios saved before multi-site still load', () => {
    const s = migrate(defaultState())!;
    expect(s.multisite).toBeUndefined();
  });
});

describe('compare deployment models (D33)', () => {
  it('on the default 35 servers only self-managed fits: 32 GB master servers are too small for ECK master pods and the ECE control plane', async () => {
    const { compareModels } = await import('@sizing/engine');
    const { defaultModels } = await import('../src/state.ts');
    const m = defaultModels();
    const rows = compareModels({ workloads: m.workloads, servers: m.servers, options: m.options });
    expect(rows.map((r) => [r.model, r.topology.fitsAll])).toEqual([['self_managed', true], ['eck', false], ['ece', false]]);
    expect(rows[0]!.best).toEqual(expect.arrayContaining(['eru', 'headroom', 'servers']));
  });

  it('with 128 GB master servers, ECK and ECE fit too, and the table picks winners among them', async () => {
    const { compareModels } = await import('@sizing/engine');
    const { defaultModels } = await import('../src/state.ts');
    const m = defaultModels();
    const servers = m.servers.map((g) => (g.role === 'master' ? { ...g, ramGb: 128 } : g));
    const rows = compareModels({ workloads: m.workloads, servers, options: m.options });
    expect(rows.every((r) => r.topology.fitsAll)).toBe(true);
    expect(rows.find((r) => r.model === 'ece')!.eru).toBeGreaterThan(rows.find((r) => r.model === 'eck')!.eru);
  });

  it('exports a Markdown comparison', async () => {
    const { compareModels } = await import('@sizing/engine');
    const { defaultModels } = await import('../src/state.ts');
    const { modelsMarkdown } = await import('../src/export.ts');
    const m = defaultModels();
    const md = modelsMarkdown('Deal', compareModels({ workloads: m.workloads, servers: m.servers, options: m.options }), '2026-09-27T00:00:00Z');
    expect(md).toContain('| ECE |');
    expect(md).toContain('control-plane hosts');
  });
});

describe('deployment model selector per mode (D34)', () => {
  it('node-based modes offer ECK and ECE as links to Compare models, and ECH as a link to Elastic Cloud (D40)', async () => {
    const { modelOptionsFor } = await import('../src/state.ts');
    const fwd = modelOptionsFor('forward');
    expect(fwd.find((o) => o.value === 'eck')).toMatchObject({ text: expect.stringMatching(/compare on your servers/) });
    expect(fwd.find((o) => o.value === 'eck')!.disabled).toBeFalsy();
    expect(fwd.find((o) => o.value === 'ech')).toMatchObject({ text: expect.stringMatching(/price it/) });
    expect(fwd.find((o) => o.value === 'ech')!.disabled).toBeFalsy();
    expect(fwd.find((o) => o.value === 'serverless')!.disabled).toBe(true);
  });

  it('server-based modes size ECK and ECE directly', async () => {
    const { modelOptionsFor } = await import('../src/state.ts');
    const ms = modelOptionsFor('multisite');
    expect(ms.filter((o) => !o.disabled).map((o) => o.value)).toEqual(['self_managed', 'eck', 'ece']);
  });

  it('the multi-site selector drives the engine: ECE layout and licensing across both sites', () => {
    const ms = { ...defaultMultiSite(), options: { model: 'ece' as const } };
    const req = topologyRequest(ms);
    expect(req.hostModel).toBe('ece');
    const t = sizeTopology(req);
    expect(t.sites[0]!.fit.find((f) => f.role === 'hot')!.nodesPerServer).toBe(3);
    expect(t.totals.eru).toBe(t.sites.reduce((s, x) => s + x.license.eru, 0));
    expect(t.sites[0]!.license.math.map((m) => m.label).join(' ')).toMatch(/ECE/);
  });

  it('picking ECK in Size a workload opens Compare models with the same workloads', async () => {
    const { redirectToModels } = await import('../src/state.ts');
    const s = defaultState();
    const next = redirectToModels(s, s.forward.workloads, { model: 'self_managed', fips: true });
    expect(next.mode).toBe('models');
    expect(next.models!.workloads).toEqual(s.forward.workloads);
    expect(next.models!.options).toMatchObject({ model: 'self_managed', fips: true });
    expect(next.forward).toBe(s.forward);
  });
});
