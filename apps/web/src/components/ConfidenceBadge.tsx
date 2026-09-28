import { EuiBadge } from '@elastic/eui';
import type { Confidence } from '@sizing/engine';

const FILLED: Record<Confidence, number> = { high: 3, medium: 2, low: 1 };

/** Confidence is certainty, not severity: a neutral badge with filled dots, so it never reads as a warning. */
export function ConfidenceBadge({ c, short = false }: { c: Confidence; short?: boolean }) {
  const filled = FILLED[c];
  return (
    <EuiBadge color="hollow" aria-label={`${c} confidence`} title="How much to trust this figure">
      <span aria-hidden style={{ letterSpacing: 1, marginRight: 4 }}>
        {'●'.repeat(filled)}<span style={{ opacity: 0.3 }}>{'●'.repeat(3 - filled)}</span>
      </span>
      {short ? c : `${c} confidence`}
    </EuiBadge>
  );
}
