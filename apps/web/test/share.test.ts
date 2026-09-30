import { describe, expect, it } from 'vitest';
import { decodeScenario, encodeScenario, sharedParam, shareUrl, withoutSharedParam } from '../src/share.ts';
import { defaultState } from '../src/state.ts';

describe('share a scenario with a link', () => {
  it('round-trips a scenario through the link text', async () => {
    const s = { ...defaultState(), name: 'Acme SIEM', mode: 'reverse' as const };
    const data = await encodeScenario(s);
    expect(data).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(await decodeScenario(data)).toEqual(s);
  });

  it('keeps links short enough to paste: compression shrinks the default scenario', async () => {
    const s = defaultState();
    expect((await encodeScenario(s)).length).toBeLessThan(JSON.stringify(s).length);
  });

  it('rejects junk instead of loading it', async () => {
    expect(await decodeScenario('not a scenario!')).toBeUndefined();
    expect(await decodeScenario('AAAA')).toBeUndefined();
    const notScenario = await encodeScenario({ hello: 'world' } as never);
    expect(await decodeScenario(notScenario)).toBeUndefined();
  });

  it('reads and removes the s parameter while keeping the page in the hash', () => {
    const url = shareUrl('abc_-1', { origin: 'http://h', pathname: '/app/' });
    expect(url).toBe('http://h/app/#/?s=abc_-1');
    expect(sharedParam('#/?s=abc_-1')).toBe('abc_-1');
    expect(sharedParam('#/tco')).toBeUndefined();
    expect(withoutSharedParam('#/?s=abc_-1')).toBe('#/');
    expect(withoutSharedParam('#/?s=x&y=1')).toBe('#/?y=1');
  });
});
