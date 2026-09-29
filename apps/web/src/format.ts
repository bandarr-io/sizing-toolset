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

/** US dollars, whole units: 98000 → "$98,000". */
export function fmtMoney(x: number, decimals = 0): string {
  return x.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** Storage in decimal units, matching the engine: 83,750 GB → "83.8 TB". */
export function fmtStorage(gb: number): string {
  if (gb >= 1_000_000) return `${fmtNum(gb / 1_000_000, 2)} PB`;
  if (gb >= 1_000) return `${fmtNum(gb / 1_000, 1)} TB`;
  return `${fmtNum(gb, 0)} GB`;
}
