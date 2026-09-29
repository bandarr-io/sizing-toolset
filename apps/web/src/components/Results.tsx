import {
  EuiBadge, EuiBasicTable, EuiButtonEmpty, EuiCallOut, EuiFlexGroup, EuiFlexItem, EuiIcon, EuiPanel, EuiProgress, EuiSpacer, EuiText,
  type EuiBasicTableColumn,
} from '@elastic/eui';
import type { Constraint, MathStep, SizingResult, Warning } from '@sizing/engine';
import { useState } from 'react';
import { constraintLabel } from '../export.ts';
import { fmtCompact, fmtNum, fmtStorage } from '../format.ts';
import { byRoleOrder } from '../ui/tiers.ts';
import { ConfidenceBadge } from './ConfidenceBadge.tsx';
import { MathButton } from './MathFlyout.tsx';

interface Row { role: string; nodes: number; ramGb: number; diskGb: number; vcpu: number; counted: boolean; math: MathStep[]; data: boolean }

export function NodeTable({ r }: { r: SizingResult }) {
  const rows: Row[] = byRoleOrder([
    ...r.tiers.map((t) => ({ role: t.tier, nodes: t.nodes, ramGb: t.ramGb, diskGb: t.diskGb, vcpu: t.vcpu, counted: true, math: t.math, data: true })),
    ...r.overhead.map((o) => ({ role: o.role, nodes: o.count, ramGb: o.ramGb, diskGb: o.diskGb, vcpu: o.vcpu, counted: o.countsTowardLicense, math: o.math, data: false })),
  ]);
  const objectRow = r.objectStorage
    ? <EuiText size="s" style={{ marginTop: 12 }}>Object storage (cheap bulk storage such as S3, holding the cold and frozen data): <strong>{fmtStorage(r.objectStorage.gb)}</strong>{r.objectStorage.overridden ? ' (set by hand for this scenario)' : ''}. Not counted in memory or license units.</EuiText>
    : null;
  const columns: EuiBasicTableColumn<Row>[] = [
    { field: 'role', name: 'Role', render: (role: string, row: Row) => <EuiText size="s">{row.data ? <strong>{role}</strong> : role}{!row.counted && <> <EuiBadge color="hollow">no license needed</EuiBadge></>}</EuiText> },
    { field: 'nodes', name: 'Nodes', align: 'right', render: (n: number) => <strong>{n}</strong> },
    { field: 'ramGb', name: 'Memory each', align: 'right', render: (n: number) => `${fmtNum(n)} GB` },
    { field: 'diskGb', name: 'Disk each', align: 'right', render: (n: number) => (n ? `${fmtNum(n, 0)} GB` : '–') },
    { field: 'vcpu', name: 'Cores each', align: 'right', render: (n: number) => fmtNum(n, 1) },
    { name: 'Memory total', align: 'right', render: (row: Row) => `${fmtNum(row.nodes * row.ramGb)} GB` },
    { name: '', width: '40px', render: (row: Row) => <MathButton title={`${row.role} nodes`} steps={row.math} /> },
  ];
  return <><EuiBasicTable<Row> tableCaption="Nodes: each is one running copy of Elasticsearch" items={rows} columns={columns} compressed />{objectRow}</>;
}

/** Whole numbers once a quantity is large enough that decimals are noise. */
function fmtQty(x: number | undefined): string {
  return fmtNum(x, x !== undefined && Math.abs(x) >= 100 ? 0 : 1);
}

const measurable = (k: Constraint) => k.name !== 'query' && k.utilization !== undefined && Number.isFinite(k.utilization);

/** Most utilized first; the unmodeled query constraint goes last. */
export function sortedConstraints(constraints: readonly Constraint[]): Constraint[] {
  return [...constraints].sort((a, b) => (measurable(b) ? b.utilization! : -1) - (measurable(a) ? a.utilization! : -1));
}

/** High utilization is the goal of a sizing, so bars stay neutral; only the binding constraint and overflow stand out. */
function barColor(k: Constraint): 'primary' | 'subdued' | 'danger' {
  if (k.utilization !== undefined && k.utilization > 1) return 'danger';
  return k.binding ? 'primary' : 'subdued';
}

function detailText(k: Constraint, reverse: boolean): string {
  const u = k.utilization;
  if (k.name === 'query') return 'Not estimated here. Test with Rally using real customer searches.';
  if (!reverse) return `${fmtQty(k.demand)} / ${fmtQty(k.capacity)} ${k.unit}`;
  if (k.maxValue !== undefined && !Number.isFinite(k.maxValue)) return 'Never runs out';
  const headroom = !k.binding && u !== undefined && u > 0 && Number.isFinite(u) ? ` · ${fmtNum(1 / u, 1)}× spare room` : '';
  return `up to ${fmtCompact(k.maxValue!)} ${k.unit}${headroom}`;
}

function ConstraintRow({ k, reverse }: { k: Constraint; reverse: boolean }) {
  const u = k.utilization;
  return (
    <EuiPanel paddingSize="s" hasBorder={k.binding} color={k.binding ? 'primary' : 'transparent'}>
      <EuiFlexGroup gutterSize="s" alignItems="center" responsive={false} wrap>
        <EuiFlexItem grow={false} style={{ minWidth: 150 }}>
          <EuiText size="s"><strong>{constraintLabel(k.name)}</strong>{k.tier && k.name !== 'frozen' ? ` · ${k.tier}` : ''}</EuiText>
        </EuiFlexItem>
        <EuiFlexItem style={{ minWidth: 120 }}>
          {measurable(k)
            ? <EuiProgress value={Math.min(u!, 1) * 100} max={100} size="m" color={barColor(k)} label={`${fmtNum(u! * 100, 1)}%`} valueText={false} />
            : <EuiText size="xs" color="subdued">–</EuiText>}
        </EuiFlexItem>
        <EuiFlexItem grow={false}><MathButton title={constraintLabel(k.name)} steps={k.math} /></EuiFlexItem>
      </EuiFlexGroup>
      <EuiFlexGroup gutterSize="xs" alignItems="center" responsive={false} wrap>
        <EuiFlexItem grow={false}><EuiText size="xs" color="subdued">{detailText(k, reverse)}</EuiText></EuiFlexItem>
        {k.binding && <EuiFlexItem grow={false}><EuiBadge color="primary">runs out first</EuiBadge></EuiFlexItem>}
        <EuiFlexItem grow={false}><ConfidenceBadge c={k.confidence} /></EuiFlexItem>
        {k.rallyRequired && <EuiFlexItem grow={false}><EuiBadge color="accent">Rally required</EuiBadge></EuiFlexItem>}
      </EuiFlexGroup>
    </EuiPanel>
  );
}

export function ConstraintPanel({ r }: { r: SizingResult }) {
  const reverse = r.mode === 'reverse';
  return (
    <>
      <EuiText size="xs" color="subdued">
        <p>{reverse
          ? "Each bar shows the answer as a share of that resource's limit. The resource that runs out first sets the answer."
          : 'Each bar shows how full a resource is. One spare node per tier is held back in case a node fails. The fullest resource sets the cluster size.'}</p>
      </EuiText>
      <EuiSpacer size="s" />
      {sortedConstraints(r.constraints).map((k, i) => (
        <div key={i}><ConstraintRow k={k} reverse={reverse} /><EuiSpacer size="xs" /></div>
      ))}
    </>
  );
}

/** Compact bars for the few constraints closest to their limit, for the results column. */
export function TopConstraints({ r, count = 3 }: { r: SizingResult; count?: number }) {
  const top = sortedConstraints(r.constraints).filter(measurable).slice(0, count);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 11rem) 1fr 3rem', columnGap: 12, rowGap: 6, alignItems: 'center' }}>
      {top.map((k, i) => (
        <div key={i} style={{ display: 'contents' }}>
          <EuiText size="xs" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {k.binding ? <strong>{constraintLabel(k.name)}</strong> : constraintLabel(k.name)}{k.tier && k.name !== 'frozen' ? ` · ${k.tier}` : ''}
          </EuiText>
          <EuiProgress value={Math.min(k.utilization!, 1) * 100} max={100} size="s" color={barColor(k)} />
          <EuiText size="xs" textAlign="right">{fmtNum(k.utilization! * 100, 0)}%</EuiText>
        </div>
      ))}
    </div>
  );
}

const TIER_WORD = /\b(hot|warm|cold|frozen|content)\b/;
const TIER_ORDER = ['hot', 'warm', 'cold', 'frozen', 'content'];

export interface Finding { id: string; severity: Warning['severity']; message: string; count: number }

/** One entry per check, merging findings that differ only by tier ("hot, warm, cold shards ≈ 250 GB"). */
export function groupFindings(warnings: readonly Warning[]): Finding[] {
  const groups = new Map<string, { w: Warning; tiers: string[]; count: number }>();
  for (const w of warnings) {
    const tier = w.message.match(TIER_WORD)?.[1];
    const key = `${w.severity}|${w.id}|${tier ? w.message.replace(TIER_WORD, '{tier}') : w.message}`;
    const g = groups.get(key);
    if (g) { g.count++; if (tier && !g.tiers.includes(tier)) g.tiers.push(tier); } else groups.set(key, { w, tiers: tier ? [tier] : [], count: 1 });
  }
  return [...groups.values()].map(({ w, tiers, count }) => {
    const ordered = [...tiers].sort((a, b) => TIER_ORDER.indexOf(a) - TIER_ORDER.indexOf(b));
    return { id: w.id, severity: w.severity, count, message: ordered.length > 1 ? w.message.replace(TIER_WORD, ordered.join(', ')) : w.message };
  });
}

const SEVERITY: Record<Warning['severity'], { color: 'danger' | 'warning' | 'primary'; icon: string; title: string; rank: number }> = {
  error: { color: 'danger', icon: 'error', title: 'Problems to fix', rank: 0 },
  warn: { color: 'warning', icon: 'warning', title: 'Worth a look', rank: 1 },
  info: { color: 'primary', icon: 'info', title: 'Notes', rank: 2 },
};

export function WarningsPanel({ warnings }: { warnings: Warning[] }) {
  if (warnings.length === 0) {
    return <EuiCallOut size="s" color="success" iconType="check" title="No hardware problems found." />;
  }
  return (
    <>
      {(['error', 'warn', 'info'] as const).map((sev) => {
        const list = groupFindings(warnings.filter((w) => w.severity === sev));
        if (!list.length) return null;
        const s = SEVERITY[sev];
        return (
          <div key={sev}>
            <EuiCallOut size="s" color={s.color} iconType={s.icon} title={`${s.title} (${list.length})`}>
              <ul>{list.map((f, i) => <li key={i}>{f.message} <span style={{ opacity: 0.6 }}>(check {f.id})</span></li>)}</ul>
            </EuiCallOut>
            <EuiSpacer size="s" />
          </div>
        );
      })}
    </>
  );
}

/**
 * Findings grouped by severity, each with a count: problems and "worth a look" shown (up to `max` each),
 * notes folded behind a toggle. Takes engine warnings (grouped first) or plain sentences.
 */
export function SeverityGroups({ items, max = 3, onMore, emptyText = 'No hardware problems found' }: {
  items: readonly { severity: Warning['severity']; message: string }[]; max?: number; onMore?: () => void; emptyText?: string;
}) {
  const [notesOpen, setNotesOpen] = useState(false);
  const by = (sev: Warning['severity']) => items.filter((x) => x.severity === sev);
  const notes = by('info');
  const serious = by('error').length + by('warn').length;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {serious === 0 && <EuiText size="xs" color="subdued"><EuiIcon type="check" color="success" size="s" /> {emptyText}</EuiText>}
      {(['error', 'warn'] as const).map((sev) => {
        const list = by(sev);
        if (!list.length) return null;
        const s = SEVERITY[sev];
        return (
          <div key={sev}>
            <EuiText size="xs"><EuiIcon type={s.icon} color={s.color} size="s" /> <strong>{s.title} ({list.length})</strong></EuiText>
            <ul style={{ margin: '4px 0 0 0', paddingLeft: 20 }}>
              {list.slice(0, max).map((f, i) => <li key={i}><EuiText size="xs">{f.message}</EuiText></li>)}
            </ul>
            {list.length > max && (onMore
              ? <EuiButtonEmpty size="xs" flush="left" onClick={onMore}>and {list.length - max} more</EuiButtonEmpty>
              : <EuiText size="xs" color="subdued">and {list.length - max} more</EuiText>)}
          </div>
        );
      })}
      {notes.length > 0 && (
        <div>
          <EuiButtonEmpty size="xs" flush="left" iconType={notesOpen ? 'chevronSingleDown' : 'chevronSingleRight'} onClick={() => setNotesOpen(!notesOpen)}>
            {notes.length} {notes.length === 1 ? 'note' : 'notes'}
          </EuiButtonEmpty>
          {notesOpen && (
            <ul style={{ margin: '2px 0 0 0', paddingLeft: 20 }}>
              {notes.map((f, i) => <li key={i}><EuiText size="xs" color="subdued">{f.message}</EuiText></li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
