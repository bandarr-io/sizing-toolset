export function fmtNum(x: number | undefined, digits = 2): string {
  if (x === undefined) return '–';
  if (!Number.isFinite(x)) return x > 0 ? '∞' : String(x);
  return x.toLocaleString('en-US', { maximumFractionDigits: digits });
}

/** Compact form for large counts: 160.19M, 75K. */
export function fmtCompact(x: number): string {
  if (!Number.isFinite(x)) return x > 0 ? 'not limiting' : String(x);
  const abs = Math.abs(x);
  if (abs >= 1e9) return `${(x / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(x / 1e6).toFixed(2)}M`;
  return fmtNum(x);
}
