import { EuiCallOut, EuiSpacer } from '@elastic/eui';
import type { MasterSizingRow } from '@sizing/constants';

/** Says why master nodes just appeared, so an automatic change is never a surprise. */
export function AutoMastersNote({ row, threshold, onDismiss }: { row: MasterSizingRow | undefined; threshold: number; onDismiss: () => void }) {
  if (!row) return null;
  return (
    <>
      <EuiCallOut size="s" iconType="info" onDismiss={onDismiss}
        title={`Added ${row.count} master nodes of ${row.ramGb} GB each`}>
        <p>
          With {threshold} or more data nodes, the cluster needs its own master nodes: small nodes that keep it organized.
          Three can always outvote a tie. Remove the row if you plan to run them another way.
        </p>
      </EuiCallOut>
      <EuiSpacer size="m" />
    </>
  );
}

/** Data nodes at which dedicated masters start, from `masters.sizing`. */
export function masterThreshold(rows: readonly MasterSizingRow[]): number {
  return rows.find((r) => r.count > 0)?.minDataNodes ?? Infinity;
}
