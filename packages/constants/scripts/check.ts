import { Ajv } from 'ajv';
import addFormatsModule from 'ajv-formats';
import schema from '../constants.schema.json' with { type: 'json' };
import type { Constant } from '../src/types.ts';

const addFormats = addFormatsModule as unknown as (ajv: Ajv) => Ajv;

export const MAX_AGE_MONTHS = 12;

/** The oldest as_of_date still allowed on `today` (YYYY-MM-DD). */
export function cutoffDate(today: string): string {
  const [y, m, d] = today.split('-').map(Number) as [number, number, number];
  const shifted = new Date(Date.UTC(y, m - 1 - MAX_AGE_MONTHS, d));
  return shifted.toISOString().slice(0, 10);
}

/** SPEC §6 CI rule. `today` is passed in so the check is testable. Returns one message per problem. */
export function checkConstants(items: readonly unknown[], today: string): string[] {
  const ajv = addFormats(new Ajv({ allErrors: true, strict: false }));
  const validate = ajv.compile(schema);
  const cutoff = cutoffDate(today);
  const errors: string[] = [];
  const seen = new Set<string>();

  items.forEach((item, i) => {
    const key = (item as { key?: unknown }).key;
    const label = typeof key === 'string' ? key : `#${i}`;
    if (!validate(item)) {
      for (const e of validate.errors ?? []) errors.push(`${label}: ${e.instancePath || '/'} ${e.message}`);
      return;
    }
    const c = item as unknown as Constant;
    if (seen.has(c.key)) errors.push(`${label}: duplicate key`);
    seen.add(c.key);
    if (!c.source_url.startsWith('https://')) errors.push(`${label}: source_url must be https`);
    if (c.as_of_date < cutoff) errors.push(`${label}: as_of_date ${c.as_of_date} is older than ${MAX_AGE_MONTHS} months (cutoff ${cutoff})`);
    if (c.as_of_date > today) errors.push(`${label}: as_of_date ${c.as_of_date} is in the future`);
  });
  return errors;
}
