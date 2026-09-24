import {
  EuiBadge, EuiBasicTable, EuiCallOut, EuiFlexGroup, EuiFlexItem, EuiPanel, EuiProgress, EuiSpacer, EuiStat, EuiText,
  EuiTitle, EuiToolTip, type EuiBasicTableColumn,
} from '@elastic/eui';
import type { Constraint, MathStep, SizingResult, Warning } from '@sizing/engine';
import { constraintLabel, solveLabel } from '../export.ts';
import { fmtCompact, fmtNum } from '../format.ts';
import { MathButton } from './MathFlyout.tsx';

const CONF_COLOR = { high: 'success', medium: 'warning', low: 'danger' } as const;

function ConfidenceBadge({ c }: { c: 'high' | 'medium' | 'low' }) {
  return <EuiBadge color={CONF_COLOR[c]}>{c} confidence</EuiBadge>;
}


interface Row { role: string; nodes: number; ramGb: number; diskGb: number; vcpu: number; counted: boolean; math: MathStep[]; data: boolean }

export function NodeTable({ r }: { r: SizingResult }) {
  const rows: Row[] = [
    ...r.tiers.map((t) => ({ role: t.tier, nodes: t.nodes, ramGb: t.ramGb, diskGb: t.diskGb, vcpu: t.vcpu, counted: true, math: t.math, data: true })),
    ...r.overhead.map((o) => ({ role: o.role, nodes: o.count, ramGb: o.ramGb, diskGb: o.diskGb, vcpu: o.vcpu, counted: o.countsTowardLicense, math: o.math, data: false })),
  ];
  const columns: EuiBasicTableColumn<Row>[] = [
    { field: 'role', name: 'Role', render: (role: string, row: Row) => <EuiText size="s">{row.data ? <strong>{role}</strong> : role}{!row.counted && <> <EuiBadge color="hollow">not licensed</EuiBadge></>}</EuiText> },
    { field: 'nodes', name: 'Nodes', align: 'right', render: (n: number) => <strong>{n}</strong> },
    { field: 'ramGb', name: 'RAM/node', align: 'right', render: (n: number) => `${fmtNum(n)} GB` },
    { field: 'diskGb', name: 'Disk/node', align: 'right', render: (n: number) => (n ? `${fmtNum(n, 0)} GB` : '–') },
    { field: 'vcpu', name: 'vCPU/node', align: 'right', render: (n: number) => fmtNum(n, 1) },
    { name: 'RAM total', align: 'right', render: (row: Row) => `${fmtNum(row.nodes * row.ramGb)} GB` },
    { name: '', width: '40px', render: (row: Row) => <MathButton title={`${row.role} nodes`} steps={row.math} /> },
  ];
  return <EuiBasicTable<Row> tableCaption="Node table" items={rows} columns={columns} compressed />;
}

function utilColor(u: number): 'success' | 'warning' | 'danger' {
  if (u < 0.7) return 'success';
  if (u < 0.9) return 'warning';
  return 'danger';
}

function ConstraintRow({ k, reverse, answer }: { k: Constraint; reverse: boolean; answer?: number }) {
  const u = k.utilization;
  const notModeled = k.name === 'query';
  const unlimited = k.maxValue !== undefined && !Number.isFinite(k.maxValue);
  let detail: string;
  if (notModeled) detail = 'Not modeled. Requires Rally with customer queries.';
  else if (reverse) {
    detail = unlimited
      ? 'Not limiting'
      : `max ${fmtCompact(k.maxValue!)} ${k.unit}${answer !== undefined && k.maxValue! > 0 && !k.binding ? ` · headroom ${fmtNum(k.maxValue! / answer, 1)}×` : ''}`;
  } else detail = `${fmtNum(k.demand)} / ${fmtNum(k.capacity)} ${k.unit}`;

  return (
    <EuiPanel paddingSize="s" hasBorder={k.binding} color={k.binding ? 'primary' : 'transparent'}>
      <EuiFlexGroup gutterSize="s" alignItems="center" responsive={false} wrap>
        <EuiFlexItem grow={false} style={{ minWidth: 150 }}>
          <EuiText size="s"><strong>{constraintLabel(k.name)}</strong>{k.tier ? ` · ${k.tier}` : ''}</EuiText>
        </EuiFlexItem>
        <EuiFlexItem style={{ minWidth: 120 }}>
          {!notModeled && u !== undefined && Number.isFinite(u)
            ? <EuiProgress value={Math.min(u, 1) * 100} max={100} size="m" color={reverse && k.binding ? 'primary' : utilColor(u)} label={`${fmtNum(u * 100, 1)}%`} valueText={false} />
            : <EuiText size="xs" color="subdued">–</EuiText>}
        </EuiFlexItem>
        <EuiFlexItem grow={false}><MathButton title={constraintLabel(k.name)} steps={k.math} /></EuiFlexItem>
      </EuiFlexGroup>
      <EuiFlexGroup gutterSize="xs" alignItems="center" responsive={false} wrap>
        <EuiFlexItem grow={false}><EuiText size="xs" color="subdued">{detail}</EuiText></EuiFlexItem>
        {k.binding && <EuiFlexItem grow={false}><EuiBadge color="primary">binding</EuiBadge></EuiFlexItem>}
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
        <p>{reverse ? 'Bar = answer as a share of each constraint\'s maximum. The binding constraint sets the answer.' : 'Demand as a share of usable capacity (after the failover node). Highest = binding.'}</p>
      </EuiText>
      <EuiSpacer size="s" />
      {r.constraints.map((k, i) => (
        <div key={i}><ConstraintRow k={k} reverse={reverse} {...(r.answer ? { answer: r.answer.value } : {})} /><EuiSpacer size="xs" /></div>
      ))}
    </>
  );
}

const SEVERITY: Record<Warning['severity'], { color: 'danger' | 'warning' | 'primary'; icon: string; title: string }> = {
  error: { color: 'danger', icon: 'error', title: 'Errors' },
  warn: { color: 'warning', icon: 'warning', title: 'Warnings' },
  info: { color: 'primary', icon: 'info', title: 'Notes' },
};

export function WarningsPanel({ warnings }: { warnings: Warning[] }) {
  if (warnings.length === 0) {
    return <EuiCallOut size="s" color="success" iconType="check" title="No hardware validation findings (HV1–HV12)." />;
  }
  return (
    <>
      {(['error', 'warn', 'info'] as const).map((sev) => {
        const list = warnings.filter((w) => w.severity === sev);
        if (!list.length) return null;
        const s = SEVERITY[sev];
        return (
          <div key={sev}>
            <EuiCallOut size="s" color={s.color} iconType={s.icon} title={`${s.title} (${list.length})`}>
              <ul>{list.map((w, i) => <li key={i}><strong>{w.id}</strong>: {w.message}</li>)}</ul>
            </EuiCallOut>
            <EuiSpacer size="s" />
          </div>
        );
      })}
    </>
  );
}

