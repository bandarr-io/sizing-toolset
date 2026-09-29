import {
  EuiButton, EuiButtonEmpty, EuiButtonIcon, EuiContextMenuItem, EuiContextMenuPanel, EuiFlexGroup, EuiFlexItem, EuiIcon, EuiKeyPadMenu, EuiKeyPadMenuItem, EuiPanel, EuiPopover, EuiSpacer, EuiText, EuiToolTip,
} from '@elastic/eui';
import type { WorkloadKind, WorkloadProfile } from '@sizing/engine';
import { useState } from 'react';
import { useConstants } from '../constantsStore.tsx';
import { applyTemplate, KIND_ORDER, KINDS, newWorkload, TEMPLATES } from '../state.ts';
import { RetentionStrip } from './RetentionTimeline.tsx';
import { summarize, WorkloadCard, type CardRole } from './WorkloadCard.tsx';

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

/** Replace the workloads with a realistic starting point. */
function TemplatePicker({ onPick }: { onPick: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <EuiPopover isOpen={open} closePopover={() => setOpen(false)} anchorPosition="downLeft" panelPaddingSize="none"
      button={<EuiButtonEmpty size="s" iconType="documents" onClick={() => setOpen(!open)}>Start from a template</EuiButtonEmpty>}>
      <EuiContextMenuPanel title="Replaces the workloads above" items={TEMPLATES.map((t) => (
        <EuiContextMenuItem key={t.id} icon={t.icon} onClick={() => { onPick(t.id); setOpen(false); }}>
          <strong>{t.label}</strong>
          <EuiText size="xs" color="subdued"><p>{t.blurb}</p></EuiText>
        </EuiContextMenuItem>
      ))} />
    </EuiPopover>
  );
}

/** One line per workload that is not being edited: icon, name, summary, retention, edit and remove. */
function WorkloadRow({ p, onEdit, onRemove }: { p: WorkloadProfile; onEdit: () => void; onRemove: () => void }) {
  return (
    <EuiPanel hasBorder paddingSize="m">
      <EuiFlexGroup gutterSize="m" alignItems="center" responsive={false}>
        <EuiFlexItem grow={false}><EuiIcon type={KINDS[p.kind].icon} size="l" /></EuiFlexItem>
        <EuiFlexItem style={{ minWidth: 0 }}>
          <EuiText size="s"><strong>{p.id}</strong></EuiText>
          <EuiText size="xs" color="subdued">{summarize(p)}</EuiText>
        </EuiFlexItem>
        <EuiFlexItem grow={false}><RetentionStrip value={p.retentionDays} /></EuiFlexItem>
        <EuiFlexItem grow={false}><EuiButtonEmpty size="s" iconType="pencil" onClick={onEdit}>Edit</EuiButtonEmpty></EuiFlexItem>
        <EuiFlexItem grow={false}>
          <EuiToolTip content="Remove workload"><EuiButtonIcon iconType="trash" color="danger" aria-label={`Remove ${p.id}`} onClick={onRemove} /></EuiToolTip>
        </EuiFlexItem>
      </EuiFlexGroup>
    </EuiPanel>
  );
}

/**
 * Workload cards plus an "add" picker. With several workloads only one card is open at a time; the rest fold to a line.
 * With no workloads the picker is shown inline as the call to action.
 */
export function WorkloadList({ workloads, onChange, role = { kind: 'forward' }, addLabel = 'Add workload', showGrowth = false, templates = false }: {
  workloads: WorkloadProfile[];
  /** Offer "Start from a template" (Size a workload). */
  templates?: boolean;
  onChange: (w: WorkloadProfile[]) => void;
  role?: CardRole;
  addLabel?: string;
  showGrowth?: boolean;
}) {
  const { set: c } = useConstants();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(workloads.length - 1);
  const add = (k: WorkloadKind) => {
    onChange([...workloads, newWorkload(k, workloads.map((w) => w.id), c)]);
    setEditing(workloads.length);
    setOpen(false);
  };
  const remove = (i: number) => {
    onChange(workloads.filter((_, j) => j !== i));
    if (i <= editing) setEditing(Math.max(0, editing - 1));
  };

  const useTemplate = (id: string) => { onChange(applyTemplate(id, c)); setEditing(0); };
  const picker = templates ? <TemplatePicker onPick={useTemplate} /> : null;

  if (workloads.length === 0) return <><KindPad onPick={add} />{picker && <><EuiSpacer size="s" />{picker}</>}</>;
  const current = Math.min(editing, workloads.length - 1);

  return (
    <>
      {workloads.map((p, i) => (
        <div key={`${i}-${p.kind}`}>
          {i === current || workloads.length === 1
            ? <WorkloadCard p={p} role={role} showGrowth={showGrowth}
                onChange={(np) => onChange(workloads.map((w, j) => (j === i ? np : w)))}
                onRemove={() => remove(i)} />
            : <WorkloadRow p={p} onEdit={() => setEditing(i)} onRemove={() => remove(i)} />}
          <EuiSpacer size="m" />
        </div>
      ))}
      <EuiFlexGroup gutterSize="s" alignItems="center" responsive={false} wrap>
        <EuiFlexItem grow={false}>
          <EuiPopover isOpen={open} closePopover={() => setOpen(false)} anchorPosition="downLeft"
            button={<EuiButton iconType="plusCircle" size="s" color="text" onClick={() => setOpen(!open)}>{addLabel}</EuiButton>}>
            <KindPad onPick={add} />
          </EuiPopover>
        </EuiFlexItem>
        {picker && <EuiFlexItem grow={false}>{picker}</EuiFlexItem>}
      </EuiFlexGroup>
    </>
  );
}
