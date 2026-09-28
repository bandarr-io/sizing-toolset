// D41: the settings that used to feed no formula now drive a rule. One test per setting.
import { buildConstantSet, defaultConstants as c, type Constant } from '@sizing/constants';
import { describe, expect, it } from 'vitest';
import { placementNotes } from '../src/ech/common.ts';
import { storageOverhead } from '../src/profiles.ts';
import { compareModels, forward, reverse, type NodeGroup, type ServerGroup, type Warning, type WorkloadProfile } from '../src/index.ts';
import { validateHardware, type ValidationInput } from '../src/validation.ts';

const hot = (count: number, extra: Partial<NodeGroup> = {}): NodeGroup => ({ role: 'hot', count, ramGb: 64, diskGb: 3200, diskType: 'nvme', vcpu: 8, ...extra });
const base: ValidationInput = { groups: [hot(3)], airGapped: false, autoOps: false, replicasByTier: { hot: 1 }, agents: 0 };
const run = (v: Partial<ValidationInput>, set = c) => validateHardware(set, { ...base, ...v });
const ids = (w: Warning[]) => w.map((x) => `${x.id}/${x.severity}`);
const withValue = (key: string, value: unknown) => buildConstantSet([...c.byKey.values()].map((x): Constant => (x.key === key ? { ...x, value } : x)));
const logs = (p: Partial<WorkloadProfile> = {}): WorkloadProfile => ({ id: 'l', kind: 'logs', rawGbPerDay: 100, indexMode: 'logsdb', retentionDays: { hot: 30 }, replicas: {}, ...p });

describe('settings that now drive a rule (D41)', () => {
  it('storage.margin: the overhead is 1 + headroom + margin, so changing the margin changes sizing', () => {
    expect(storageOverhead(c)).toBe(1.25);
    expect(storageOverhead(withValue('storage.margin', 0.2))).toBe(1.35);
  });

  it('watermark.high and watermark.flood_stage: HV7 escalates past the low watermark', () => {
    // 3 × 3,200 GB; after losing one node 6,400 GB usable.
    expect(run({ dataGbByTier: { hot: 5600 } }).find((w) => w.id === 'HV7')!.message).toMatch(/stops placing new data/); // 87.5%
    expect(run({ dataGbByTier: { hot: 5900 } }).find((w) => w.id === 'HV7')!.message).toMatch(/moving shards/); // 92%
    expect(ids(run({ dataGbByTier: { hot: 6200 } }))).toContain('HV7/error'); // 97%: read-only
  });

  it('shard_docs_max: HV8 warns when small events make a full shard hold too many documents', () => {
    const r = forward({ workloads: [logs({ rawGbPerDay: 2000, avgEventKb: 0.05 })], options: { model: 'self_managed' } });
    expect(r.warnings.find((w) => w.id === 'HV8' && /million documents/.test(w.message))).toBeDefined();
    const normal = forward({ workloads: [logs({ rawGbPerDay: 2000 })], options: { model: 'self_managed' } });
    expect(normal.warnings.some((w) => /million documents/.test(w.message))).toBe(false);
  });

  it('autoops.requires_internet: HV10 follows the setting', () => {
    expect(ids(run({ airGapped: true, autoOps: true }))).toContain('HV10/error');
    expect(ids(run({ airGapped: true, autoOps: true }, withValue('autoops.requires_internet', false)))).not.toContain('HV10/error');
  });

  it('fleet.max_policies_per_instance and fleet.serverless_max_agents: HV12 notes', () => {
    const fleet: NodeGroup = { role: 'fleet', count: 2, ramGb: 8, diskGb: 0, diskType: 'ssd', vcpu: 8 };
    const profiles: WorkloadProfile[] = [{ id: 'f', kind: 'fleet', fleet: { agents: 12_000, defend: false, policies: 1500 }, retentionDays: {}, replicas: {} }];
    const w = run({ groups: [hot(3), fleet], agents: 12_000, profiles });
    expect(w.some((x) => x.id === 'HV12' && /1,500 agent policies/.test(x.message))).toBe(true);
    expect(w.some((x) => x.id === 'HV12' && /would need 2 projects/.test(x.message))).toBe(true);
  });

  it('knn.bbq_default_min_dims: HV13 notes a non-BBQ vector workload at 384+ dimensions', () => {
    const v = (dims: number, quant: 'int8' | 'bbq'): WorkloadProfile => ({ id: 'v', kind: 'vector', vector: { count: 1e6, dims, quant }, retentionDays: {}, replicas: {} });
    expect(ids(run({ profiles: [v(1024, 'int8')] }))).toContain('HV13/info');
    expect(ids(run({ profiles: [v(1024, 'bbq')] }))).not.toContain('HV13/info');
    expect(ids(run({ profiles: [v(256, 'int8')] }))).not.toContain('HV13/info');
  });

  it('ev_per_s_per_vcpu.band_min and band_max: HV14 and the processor range in the reverse math', () => {
    expect(ids(run({ eventsPerSecondPerVcpu: 5000 }))).toContain('HV14/info');
    expect(ids(run({ eventsPerSecondPerVcpu: 2000 }))).not.toContain('HV14/info');
    const req = { hardware: { model: 'self_managed' as const, groups: [hot(3)] }, fixed: [logs()], solve: 'max_gb_day' as const };
    const cpu = (r: ReturnType<typeof reverse>) => r.constraints.find((k) => k.name === 'cpu_ingest')!;
    const labels = cpu(reverse(req)).math.map((s) => s.label);
    expect(labels).toEqual(expect.arrayContaining(['max GB/day (CPU) at the low end of the usual range', 'max GB/day (CPU) at the high end of the usual range']));
    expect(cpu(reverse({ ...req, eventsPerSecondPerVcpu: 2000 })).math.some((s) => /usual range/.test(s.label))).toBe(false);
  });

  it('omb_m2614: HV15 notes short retention when FIPS is selected', () => {
    expect(ids(run({ fips: true, profiles: [logs()] }))).toContain('HV15/info');
    expect(ids(run({ fips: false, profiles: [logs()] }))).not.toContain('HV15/info');
    expect(ids(run({ fips: true, profiles: [logs({ retentionDays: { hot: 30, frozen: 335 } })] }))).not.toContain('HV15/info');
  });

  it('eck.operator_ram_gb: ECK adds the manager to memory needed, not to the license', () => {
    const servers: ServerGroup[] = [{ role: 'master', count: 3, ramGb: 128, diskGb: 500, diskType: 'ssd', vcpu: 16 }, { role: 'hot', count: 4, ramGb: 256, diskGb: 12800, diskType: 'nvme', vcpu: 64 }];
    const rows = compareModels({ workloads: [logs()], servers, options: { model: 'self_managed' } });
    const by = Object.fromEntries(rows.map((r) => [r.model, r.topology.totals]));
    expect(by.eck!.platformRamGb).toBe(1);
    expect(by.self_managed!.platformRamGb).toBe(0);
    expect(by.eck!.ramGb).toBe(rows.find((r) => r.model === 'eck')!.topology.sites[0]!.result.totalRamGb + 1);
  });

  it('fedramp.ech: Elastic Cloud notes a FedRAMP region', () => {
    const p = { provider: 'aws', region: 'AWS-us-gov-east-1-frh (FedRAMP High)', channel: 'Elastic Direct', tier: 'Gold' } as const;
    expect(placementNotes(c, p)[0]).toMatch(/FedRAMP High.*authorized 2026-03-31.*Enterprise only/);
    expect(placementNotes(c, { ...p, region: 'AWS-us-east-1 (N. Virginia)' })).toEqual([]);
  });
});
