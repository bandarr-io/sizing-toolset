// SPEC §11.2 reverse-mode suite. R5 re-baselined by D19 (heap cap 30 → 33 GB off-heap per 64 GB node).
// D38 (hot 1:50): a 64 GB hot node may use up to 3,200 GB, so hardware with less disk than that is disk-bound.
// The hardware in these cases keeps the disk the spec gives it (2 TB for R1, 1,920 GB otherwise).
import { describe, expect, it } from 'vitest';
import { reverse, type NodeGroup, type ReverseRequest, type WorkloadProfile } from '../src/index.ts';

const hot = (count: number, extra: Partial<NodeGroup> = {}): NodeGroup => ({
  role: 'hot', count, ramGb: 64, diskGb: 1920, diskType: 'nvme', vcpu: 8, ...extra,
});
const logs = (p: Partial<WorkloadProfile> = {}): WorkloadProfile => ({
  id: 'w', kind: 'logs', retentionDays: { hot: 30 }, replicas: { hot: 1 }, ...p,
});
const req = (groups: NodeGroup[], fixed: WorkloadProfile[], solve: ReverseRequest['solve'], extra: Partial<ReverseRequest> = {}): ReverseRequest => ({
  hardware: { model: 'self_managed', groups }, fixed, solve, ...extra,
});

describe('§11.2 reverse regression', () => {
  const r1Hot = hot(3, { diskGb: 2000 });
  const r1Profile = logs({ indexMode: 'standard', avgEventKb: 1 });

  // D38: 2 × min(3,200, 2,000) = 4,000; / 1.25 = 3,200; / 72 = 44.44. Was 2 × 1,920 / 1.25 / 72 = 42.67, storage-bound.
  it('R1: 3×64 GB hot, 2 TB disk, 1 replica, 30d, ratio 1.2 → 44.44 GB/day, disk-bound (High)', () => {
    const r = reverse(req([r1Hot], [r1Profile], 'max_gb_day'));
    expect(r.answer!.value).toBeCloseTo(3200 / 72, 6);
    expect(r.answer!.value.toFixed(2)).toBe('44.44');
    expect(r.answer!.binding).toBe('disk');
    expect(r.answer!.bindingTier).toBe('hot');
    expect(r.answer!.confidence).toBe('high');
  });

  // D38: same 2,048 GB/day, but the 1,920 GB disk now binds before the 3,200 GB ratio cap.
  it('R2: 41×64 GB hot, 1,920 GB disk, LogsDB, 30d, 1 replica → 2,048 GB/day, disk-bound', () => {
    const r = reverse(req([hot(41, { vcpu: 64 })], [logs({ indexMode: 'logsdb' })], 'max_gb_day'));
    expect(r.answer!.value).toBeCloseTo(2048, 9);
    expect(r.answer!.binding).toBe('disk');
  });

  it('R3: 11 hot, 500 GB/day LogsDB, solve retention → 30 days', () => {
    const r = reverse(req([hot(11)], [logs({ indexMode: 'logsdb', rawGbPerDay: 500 })], 'max_retention'));
    expect(r.answer!.value).toBe(30);
    expect(r.answer!.unit).toBe('days');
  });

  it('R4: 2 Fleet Servers @ 8 GB, hot 13×64 GB → 75,000 agents (Medium)', () => {
    const fleet: NodeGroup = { role: 'fleet', count: 2, ramGb: 8, diskGb: 0, diskType: 'ssd', vcpu: 8 };
    const r = reverse(req([hot(13), fleet], [], 'max_agents'));
    expect(r.answer!.value).toBe(75_000);
    expect(r.answer!.confidence).toBe('medium');
  });

  describe('R5: 3×64 GB, 1 replica, 1024-d, m=16 (D19: 2 × 33 = 66 GB off-heap)', () => {
    const vec = (quant: 'bbq' | 'float32'): WorkloadProfile => ({
      id: 'v', kind: 'vector', tier: 'hot', vector: { count: 0, dims: 1024, quant, hnswM: 16 }, retentionDays: {}, replicas: { hot: 1 },
    });
    it('BBQ → 160.19M vectors', () => {
      const r = reverse(req([hot(3)], [vec('bbq')], 'max_vectors'));
      expect(r.answer!.value).toBe(Math.floor(66e9 / (206 * 2)));
      expect((r.answer!.value / 1e6).toFixed(2)).toBe('160.19');
      expect(r.answer!.binding).toBe('vector_offheap');
      expect(r.answer!.confidence).toBe('medium');
    });
    it('float32 → 7.93M vectors', () => {
      const r = reverse(req([hot(3)], [vec('float32')], 'max_vectors'));
      expect(r.answer!.value).toBe(Math.floor(66e9 / (4160 * 2)));
      expect((r.answer!.value / 1e6).toFixed(2)).toBe('7.93');
    });
  });

  it('R6: 3 hot, 30d, daily rollover, 1p+1r → 2,000 shards, 33 data streams (Medium)', () => {
    const r = reverse(req([hot(3)], [logs({ rolloverDays: 1, primaryShards: 1 })], 'max_shards'));
    expect(r.answer!.value).toBe(2000);
    expect(r.answer!.dataStreams).toBe(33);
    expect(r.answer!.confidence).toBe('medium');
  });

  it('R7: 3 ML @ 64 GB → 60 jobs (Low)', () => {
    const ml: NodeGroup = { role: 'ml', count: 3, ramGb: 64, diskGb: 0, diskType: 'ssd', vcpu: 8 };
    const r = reverse(req([hot(3), ml], [], 'max_ml_jobs'));
    expect(r.answer!.value).toBe(60);
    expect(r.answer!.confidence).toBe('low');
  });

  // D38: R1 now binds on disk at 44.44 GB/day, so CPU headroom is 1,036.8 / 44.44 = 23.3×.
  it('R8: R1 + 8 vCPU/node, 1 KB events → CPU max 1,037 GB/day; binding disk; CPU headroom ~23× (Low)', () => {
    const r = reverse(req([r1Hot], [r1Profile], 'max_gb_day'));
    const cpu = r.constraints.find((k) => k.name === 'cpu_ingest')!;
    expect(cpu.maxValue).toBeCloseTo(1036.8, 9);
    expect(Math.round(cpu.maxValue!)).toBe(1037);
    expect(cpu.confidence).toBe('low');
    expect(cpu.rallyRequired).toBe(true);
    expect(cpu.binding).toBe(false);
    expect(r.answer!.binding).toBe('disk');
    expect(Math.round(cpu.maxValue! / r.answer!.value)).toBe(23);
  });

  it('R9: R1 with 1,000 GB disk/node → 22.2 GB/day, disk-bound; HV5 fires, HV4 does not (D1)', () => {
    const r = reverse(req([hot(3, { diskGb: 1000 })], [r1Profile], 'max_gb_day'));
    expect(r.answer!.value).toBeCloseTo(1600 / 72, 9);
    expect(r.answer!.value.toFixed(1)).toBe('22.2');
    expect(r.answer!.binding).toBe('disk');
    const ids = r.warnings.map((w) => w.id);
    expect(ids).toContain('HV5');
    expect(ids).not.toContain('HV4');
  });
});

describe('§5.3 reverse details', () => {
  it('reports headroom on every other constraint', () => {
    const r = reverse(req([hot(3, { diskGb: 2000 })], [logs({ indexMode: 'standard' })], 'max_gb_day'));
    const nonBinding = r.constraints.filter((k) => !k.binding && k.maxValue !== undefined && Number.isFinite(k.maxValue));
    expect(nonBinding.length).toBeGreaterThan(0);
    for (const k of nonBinding) expect(k.maxValue!).toBeGreaterThanOrEqual(r.answer!.value);
  });

  it('other fixed workloads consume capacity before the target', () => {
    const other = logs({ id: 'other', indexMode: 'standard', rawGbPerDay: 10 });
    const target = logs({ id: 'target', indexMode: 'standard' });
    const r = reverse(req([hot(3, { diskGb: 2000 })], [other, target], 'max_gb_day', { targetProfileId: 'target' }));
    expect(r.answer!.value).toBeCloseTo(3200 / 72 - 10, 9); // D38: R1 capacity is 3,200 / 72
  });

  it('solves frozen jointly with hot', () => {
    const frozen: NodeGroup = { role: 'frozen', count: 2, ramGb: 64, diskGb: 1920, diskType: 'ssd', vcpu: 8 };
    const r = reverse(req([hot(41, { vcpu: 64 }), frozen], [logs({ indexMode: 'logsdb', retentionDays: { hot: 30, frozen: 335 } })], 'max_gb_day'));
    // D27: frozen capacity (N−1) = 1 × 1,920 GB disk / 1.25 overhead / 0.10 cache fraction = 15,360 GB → 15,360 / (335 × 0.5) = 91.64 GB/day, below hot's 2,048.
    expect(r.answer!.value).toBeCloseTo(15360 / (335 * 0.5), 9);
    expect(r.answer!.binding).toBe('frozen');
  });
});
