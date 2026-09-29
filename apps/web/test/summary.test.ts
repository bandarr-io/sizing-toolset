import { forward, reverse } from '@sizing/engine';
import { describe, expect, it } from 'vitest';
import { echSentence, echSeverity, formatDelta, joinAnd, nextDeltas, resultSentence, runsOutFirst, sizingHeadlines } from '../src/results/summary.ts';
import { defaultState } from '../src/state.ts';

describe('plain summary sentence', () => {
  it('Size a workload names the nodes, the data tiers, the supporting roles and what runs out first', () => {
    const r = forward(defaultState().forward);
    const s = resultSentence(r);
    const total = r.tiers.reduce((a, t) => a + t.nodes, 0) + r.overhead.reduce((a, o) => a + o.count, 0);
    expect(s).toMatch(new RegExp(`^You need ${total} nodes: 3 hot and 2 frozen for the data, plus `));
    expect(s).toMatch(/Kibana/);
    expect(s).toMatch(/runs out first\.$/);
    expect(s).not.toContain('—');
  });
  it('Test hardware limits states the answer in words', () => {
    const r = reverse(defaultState().reverse);
    expect(resultSentence(r)).toMatch(/^This hardware can take about 171 GB a day\. Hot (disk|storage) runs out first\.$/);
  });
  it('Elastic Cloud gives the yearly list price and the use case count', () => {
    expect(echSentence(102993, 2)).toBe('About $102,993 a year at list price for 2 use cases.');
    expect(echSentence(5000, 1, 1)).toBe('About $5,000 a year at list price for 1 use case. 1 use case could not be priced yet.');
  });
  it('helpers read naturally', () => {
    expect(joinAnd(['a', 'b', 'c'])).toBe('a, b and c');
    expect(runsOutFirst('disk', 'hot')).toBe('Hot disk runs out first.');
    expect(runsOutFirst('heap_shards', 'hot')).toBe('Hot shard count runs out first.');
    expect(runsOutFirst('frozen', 'frozen')).toBe('The frozen local cache runs out first.');
  });
});

describe('change indicators', () => {
  it('formats the change since the last result', () => {
    expect(formatDelta(9, 11, 'count')).toBe('+2');
    expect(formatDelta(448, 400, 'gb')).toBe('−48 GB');
    expect(formatDelta(84993, 102993, 'money')).toBe('+$18,000');
    expect(formatDelta(5, 5, 'count')).toBeUndefined();
    expect(formatDelta(undefined, 5, 'count')).toBeUndefined();
  });
  it('shows nothing on first render and keeps the last change until the numbers move again', () => {
    const r = forward(defaultState().forward);
    let m = nextDeltas(undefined, sizingHeadlines(r));
    expect(m.deltas).toEqual({});
    m = nextDeltas(m, { ...m.values, nodes: m.values.nodes! + 2 });
    expect(m.deltas).toEqual({ nodes: m.values.nodes! - 2 });
    expect(nextDeltas(m, { ...m.values })).toBe(m); // same numbers: same deltas (no flicker on re-render)
  });
});

describe('Elastic Cloud warning groups', () => {
  it('sorts sentences into problems, worth a look and notes', () => {
    expect(echSeverity('Hot: No price. The spreadsheet shows #NA and leaves this line out of the total.')).toBe('error');
    expect(echSeverity('AWS-us-gov-east-1-frh (FedRAMP High) is a US government region (FedRAMP High, AWS GovCloud).')).toBe('info');
    expect(echSeverity('Cold and frozen tiers need the Enterprise subscription.')).toBe('warn');
  });
});
