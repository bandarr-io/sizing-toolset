import { useRef } from 'react';
import { formatDelta, nextDeltas, type DeltaKind, type DeltaMemo } from './summary.ts';

/**
 * Change indicators for headline numbers: the change made by the last edit that moved them, kept until the
 * numbers move again. The previous values live in a ref, so the first render shows nothing.
 */
export function useDeltas(values: Record<string, number>): (key: string, kind: DeltaKind) => string | undefined {
  const memo = useRef<DeltaMemo | undefined>(undefined);
  memo.current = nextDeltas(memo.current, values);
  const m = memo.current;
  return (key, kind) => formatDelta(m.deltas[key], m.values[key], kind);
}
