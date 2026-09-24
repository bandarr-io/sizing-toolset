import type { MathStep } from './types.ts';

/**
 * Relative tolerance for ROUNDUP/floor. Forward and reverse must agree exactly at node-count boundaries
 * (SPEC §5.3 discrete-inversion rule), and 42.666… × 72 × 1.25 / 1,920 lands on 2.0000000000000004.
 */
const REL_EPS = 1e-9;

export function ceilEps(x: number): number {
  return Math.ceil(x - REL_EPS * Math.max(1, Math.abs(x)));
}

export function floorEps(x: number): number {
  return Math.floor(x + REL_EPS * Math.max(1, Math.abs(x)));
}

/** Locale-independent number formatting for MathStep expressions (engine output must be deterministic). */
export function fmt(n: number, maxDecimals = 2): string {
  if (!Number.isFinite(n)) return n > 0 ? '∞' : String(n);
  const factor = 10 ** maxDecimals;
  const rounded = Math.round(n * factor) / factor;
  const [int, frac] = Math.abs(rounded).toString().split('.') as [string, string | undefined];
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${rounded < 0 ? '-' : ''}${grouped}${frac ? `.${frac}` : ''}`;
}

export function step(label: string, expr: string, value: number, constantKeys: string[] = []): MathStep {
  return { label, expr, value, constantKeys };
}
