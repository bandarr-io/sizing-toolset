import { EuiCallOut, EuiSpacer } from '@elastic/eui';
import type { MasterSizingRow } from '@sizing/constants';

/** What the last automatic master change was, so it is never a surprise. */
export type AutoMastersChange = { added: MasterSizingRow } | { removed: number };

export function AutoMastersNote({ change, threshold, onDismiss }: { change: AutoMastersChange | undefined; threshold: number; onDismiss: () => void }) {
  if (!change) return null;
  const added = 'added' in change;
  return (
    <>
      <EuiCallOut size="s" iconType="info" onDismiss={onDismiss}
        title={added ? `Added ${change.added.count} master nodes of ${change.added.ramGb} GB each` : `Removed ${change.removed} master node${change.removed === 1 ? '' : 's'}`}>
        <p>
          {added
            ? <>With {threshold} or more data nodes, the cluster needs its own master nodes: small nodes that keep it organized. Three can always outvote a tie. Remove the row if you plan to run them another way.</>
            : <>Below {threshold} data nodes, the data nodes can keep the cluster organized themselves, so separate master nodes are not needed. Add them back if you want them anyway.</>}
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
