import type { Confidence, Constraint, ConstraintName } from './types.ts';

/** SPEC §5.8. */
export const CONFIDENCE: Record<ConstraintName, Confidence> = {
  storage: 'high',
  disk: 'high',
  frozen: 'medium',
  heap_shards: 'medium',
  masters: 'medium',
  vector_offheap: 'medium',
  fleet: 'medium',
  cpu_ingest: 'low',
  query: 'low',
  ml: 'low',
};

export const RALLY_REQUIRED = new Set<ConstraintName>(['cpu_ingest', 'query']);

/** Forward: binding = highest utilization. `query` is never binding (not modeled). */
export function markBindingForward(constraints: Constraint[]): void {
  let best: Constraint | undefined;
  for (const k of constraints) {
    if (k.utilization === undefined || k.name === 'query') continue;
    if (!best || k.utilization > best.utilization!) best = k;
  }
  if (best) best.binding = true;
}
