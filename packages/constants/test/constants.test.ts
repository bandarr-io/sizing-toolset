import { describe, expect, it } from 'vitest';
import {
  allConstants, buildConstantSet, canonicalJson, constantsHash, defaultConstants, num, sha256Hex, val,
  type BbqDiskParams, type FleetRow, type MasterSizingRow, type VectorBytes,
} from '../src/index.ts';

describe('sha256Hex', () => {
  it('matches FIPS 180-4 test vectors', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))
      .toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  });
});

describe('constantsHash', () => {
  it('ignores key order and file order', () => {
    const reordered = [...allConstants].reverse().map((c) => JSON.parse(canonicalJson(c)));
    expect(buildConstantSet(reordered).hash).toBe(constantsHash);
  });
  it('changes when a value changes', () => {
    const changed = allConstants.map((c) => (c.key === 'mem_disk.hot' ? { ...c, value: 31 } : c));
    expect(buildConstantSet(changed).hash).not.toBe(constantsHash);
  });
  it('rejects duplicate keys', () => {
    expect(() => buildConstantSet([...allConstants, allConstants[0]!])).toThrow(/Duplicate/);
  });
});

describe('constant values used by §11', () => {
  const c = defaultConstants;
  it('storage overhead parts: 15% headroom + 10% margin (the engine adds them, D41)', () => {
    expect(1 + num(c, 'storage.watermark_headroom') + num(c, 'storage.margin')).toBeCloseTo(1.25, 12);
  });
  it('per-node capacities for 64 GB nodes match §11.1 common assumptions', () => {
    expect(64 * num(c, 'mem_disk.hot')).toBe(3200); // D38: hot 1:50 (§11.1 said 1:30, 1,920 GB)
    expect(64 * num(c, 'mem_disk.warm')).toBe(10240);
    expect(64 * num(c, 'frozen_local_disk_ratio')).toBe(48000); // D27 replaced frozen 1:1500 (96,000 GB) with a local disk cache
  });
  it('D19: 64 GB node leaves 33 GB vector off-heap (heap cap 30)', () => {
    const heap = Math.min(num(c, 'heap_fraction') * 64, num(c, 'heap_cap_gb'));
    expect(64 - heap - num(c, 'offheap_reserve_gb')).toBe(33);
  });
  it('1024-d vector byte counts match §11.1 case 7', () => {
    const graph = num(c, 'knn.hnsw_m') * num(c, 'knn.hnsw_bytes_per_link');
    const bytes = (k: string) => { const b = val<VectorBytes>(c, k); return b.perDim * 1024 + b.fixed + graph; };
    expect(bytes('knn.bytes.bbq')).toBe(206);
    expect(bytes('knn.bytes.float32')).toBe(4160);
  });
});

describe('structured constant shapes', () => {
  const c = defaultConstants;
  it('fleet.table is sorted by agents with numeric fields', () => {
    const rows = val<FleetRow[]>(c, 'fleet.table');
    expect(rows).toHaveLength(8);
    for (const r of rows) for (const v of Object.values(r)) expect(typeof v).toBe('number');
    expect(rows.map((r) => r.agents)).toEqual([...rows.map((r) => r.agents)].sort((a, b) => a - b));
  });
  it('masters.sizing starts at 0 and is sorted', () => {
    const rows = val<MasterSizingRow[]>(c, 'masters.sizing');
    expect(rows[0]).toEqual({ minDataNodes: 0, count: 0, ramGb: 0 });
    expect(rows.map((r) => r.minDataNodes)).toEqual([0, 6, 21, 51]);
  });
  it('knn.bytes.* and knn.bbq_disk have numeric parameters', () => {
    for (const q of ['float32', 'bfloat16', 'int8', 'int4', 'bbq']) {
      const b = val<VectorBytes>(c, `knn.bytes.${q}`);
      expect(typeof b.perDim).toBe('number');
      expect(typeof b.fixed).toBe('number');
    }
    const d = val<BbqDiskParams>(c, 'knn.bbq_disk');
    for (const v of Object.values(d)) expect(typeof v).toBe('number');
  });
});
