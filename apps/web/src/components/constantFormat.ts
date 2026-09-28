/** Shown for constants flagged `carried_forward` in the data files. */
export const UNCONFIRMED = 'unconfirmed';
export const UNCONFIRMED_HELP =
  'Unconfirmed means nobody has checked this value against its source since it was carried over from the spec or an earlier version. '
  + 'Most are rules of thumb or design choices with no published figure to check. It may well be right, but confirm it before relying on an estimate that depends on it.';

export function formatValue(v: unknown): string {
  if (Array.isArray(v)) return `table (${v.length} rows)`;
  if (v !== null && typeof v === 'object') {
    return Object.entries(v).map(([k, x]) => `${k}: ${typeof x === 'object' ? '…' : String(x)}`).join(', ');
  }
  if (typeof v === 'number') return v.toLocaleString('en-US', { maximumFractionDigits: 6 });
  return String(v);
}

/** as_of_date + 12 months: the day CI starts failing on this constant. */
export function expiryDate(asOf: string): string {
  const [y, m, d] = asOf.split('-').map(Number) as [number, number, number];
  const e = new Date(Date.UTC(y + 1, m - 1, d));
  return e.toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}
