import { EuiButton, EuiKeyPadMenu, EuiKeyPadMenuItem, EuiIcon, EuiPopover, EuiSpacer } from '@elastic/eui';
import type { WorkloadKind, WorkloadProfile } from '@sizing/engine';
import { useState } from 'react';
import { KIND_ORDER, KINDS, newWorkload } from '../state.ts';
import { WorkloadCard, type CardRole } from './WorkloadCard.tsx';

function KindPad({ onPick }: { onPick: (k: WorkloadKind) => void }) {
  return (
    <EuiKeyPadMenu style={{ width: 'auto', maxWidth: 440 }}>
      {KIND_ORDER.map((k) => (
        <EuiKeyPadMenuItem key={k} label={KINDS[k].label} onClick={() => onPick(k)}>
          <EuiIcon type={KINDS[k].icon} size="l" />
        </EuiKeyPadMenuItem>
      ))}
    </EuiKeyPadMenu>
  );
}

/** Workload cards plus an "add" picker. With no workloads the picker is shown inline as the call to action. */
export function WorkloadList({ workloads, onChange, role = { kind: 'forward' }, addLabel = 'Add workload', showGrowth = false }: {
  workloads: WorkloadProfile[];
  onChange: (w: WorkloadProfile[]) => void;
  role?: CardRole;
  addLabel?: string;
  showGrowth?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const add = (k: WorkloadKind) => { onChange([...workloads, newWorkload(k, workloads.map((w) => w.id))]); setOpen(false); };

  if (workloads.length === 0) return <KindPad onPick={add} />;

  return (
    <>
      {workloads.map((p, i) => (
        <div key={`${i}-${p.kind}`}>
          <WorkloadCard p={p} role={role} showGrowth={showGrowth}
            onChange={(np) => onChange(workloads.map((w, j) => (j === i ? np : w)))}
            onRemove={() => onChange(workloads.filter((_, j) => j !== i))} />
          <EuiSpacer size="m" />
        </div>
      ))}
      <EuiPopover isOpen={open} closePopover={() => setOpen(false)} anchorPosition="downLeft"
        button={<EuiButton iconType="plusCircle" size="s" color="text" onClick={() => setOpen(!open)}>{addLabel}</EuiButton>}>
        <KindPad onPick={add} />
      </EuiPopover>
    </>
  );
}
