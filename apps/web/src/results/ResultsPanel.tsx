import {
  EuiBadge, EuiButtonEmpty, EuiFlexGroup, EuiFlexItem, EuiHorizontalRule, EuiNotificationBadge, EuiPanel, EuiSpacer, EuiTab, EuiTabs,
  EuiText, EuiTitle, EuiToolTip,
} from '@elastic/eui';
import type { MathStep, SizingResult } from '@sizing/engine';
import { useState, type ReactNode } from 'react';
import { ConstraintPanel, NodeTable, WarningsPanel } from '../components/Results.tsx';
import { MathButton } from '../components/MathFlyout.tsx';
import { constraintLabel, solveLabel } from '../export.ts';
import { SOLVES } from '../state.ts';
import { fmtCompact, fmtNum } from '../format.ts';
import { ClusterMap } from './ClusterMap.tsx';

type Tab = 'constraints' | 'nodes' | 'checks';
const CONF_COLOR = { high: 'success', medium: 'warning', low: 'danger' } as const;

function Stat({ label, value, steps, hint }: { label: string; value: ReactNode; steps?: MathStep[]; hint?: string }) {
  return (
    <EuiFlexItem style={{ minWidth: 110 }}>
      <EuiText size="xs" color="subdued">{label}</EuiText>
      <EuiFlexGroup gutterSize="xs" alignItems="center" responsive={false}>
        <EuiFlexItem grow={false}>
          {hint ? <EuiToolTip content={hint}><EuiTitle size="s"><span>{value}</span></EuiTitle></EuiToolTip> : <EuiTitle size="s"><span>{value}</span></EuiTitle>}
        </EuiFlexItem>
        {steps && steps.length > 0 && <EuiFlexItem grow={false}><MathButton title={label} steps={steps} /></EuiFlexItem>}
      </EuiFlexGroup>
    </EuiFlexItem>
  );
}

function Totals({ r }: { r: SizingResult }) {
  const dataNodes = r.tiers.reduce((s, t) => s + t.nodes, 0);
  const allNodes = dataNodes + r.overhead.reduce((s, o) => s + o.count, 0);
  const floor = r.licenseFloor[0]!.toUpperCase() + r.licenseFloor.slice(1);
  return (
    <EuiFlexGroup gutterSize="l" wrap responsive={false}>
      <Stat label={r.sites > 1 ? 'Nodes per site' : 'Nodes'} value={`${allNodes}`} hint={`${dataNodes} data nodes`}
        steps={r.tiers.flatMap((t) => t.math.filter((s) => s.label === `${t.tier} nodes`))} />
      <Stat label={r.sites > 1 ? 'RAM per site' : 'Total RAM'} value={`${fmtNum(r.totalRamGb)} GB`} steps={r.totalRamMath} />
      <Stat label="License units" value={`${fmtNum(r.licenseUnits.value, 0)} ERU`} steps={[...r.totalRamMath, ...r.licenseUnits.math]} />
      <Stat label="License floor" value={floor} hint={r.licenseFloorReasons.join('; ') || 'No licensed features required'} />
      {r.sites > 1 && <Stat label={`All ${r.sites} sites`} value={`${fmtNum(r.allSites.licenseUnits, 0)} ERU`} hint={`${fmtNum(r.allSites.totalRamGb)} GB RAM`} />}
    </EuiFlexGroup>
  );
}

function Answer({ r }: { r: SizingResult }) {
  const a = r.answer!;
  const binding = r.constraints.find((k) => k.binding);
  return (
    <>
      <EuiText size="s" color="subdued">{SOLVES.find((s) => s.value === a.solve)?.title ?? solveLabel(a.solve)}</EuiText>
      <EuiFlexGroup gutterSize="m" alignItems="baseline" responsive={false} wrap>
        <EuiFlexItem grow={false}>
          <div style={{ whiteSpace: 'nowrap' }}>
            <span style={{ fontSize: 40, fontWeight: 700, lineHeight: 1.1, color: '#0B64DD' }}>{fmtCompact(a.value)}</span>{' '}
            <span style={{ fontSize: 18, fontWeight: 600 }}>{a.unit}</span>
          </div>
        </EuiFlexItem>
        {a.dataStreams !== undefined && (
          <EuiFlexItem grow={false}><EuiText size="s">≈ <strong>{fmtNum(a.dataStreams, 0)}</strong> data streams like this workload</EuiText></EuiFlexItem>
        )}
        {binding && <EuiFlexItem grow={false}><MathButton title={solveLabel(a.solve)} steps={binding.math} /></EuiFlexItem>}
      </EuiFlexGroup>
      <EuiSpacer size="xs" />
      <EuiFlexGroup gutterSize="s" alignItems="center" responsive={false} wrap>
        <EuiFlexItem grow={false}><EuiText size="s">Limited by <strong>{constraintLabel(a.binding)}{a.bindingTier ? ` (${a.bindingTier})` : ''}</strong></EuiText></EuiFlexItem>
        <EuiFlexItem grow={false}><EuiBadge color={CONF_COLOR[a.confidence]}>{a.confidence} confidence</EuiBadge></EuiFlexItem>
        {binding?.rallyRequired && <EuiFlexItem grow={false}><EuiBadge color="accent">Rally required</EuiBadge></EuiFlexItem>}
      </EuiFlexGroup>
    </>
  );
}

/** Everything about the result, in reading order: the answer, the cluster, the detail, the caveats. */
export function ResultsPanel({ r }: { r: SizingResult }) {
  const [tab, setTab] = useState<Tab>('constraints');
  const errors = r.warnings.filter((w) => w.severity === 'error').length;
  const warns = r.warnings.filter((w) => w.severity === 'warn').length;
  const binding = r.constraints.find((k) => k.binding);

  return (
    <>
      <EuiPanel hasBorder paddingSize="l">
        {r.answer ? <Answer r={r} /> : (
          <>
            <EuiText size="s" color="subdued">Recommended cluster{r.sites > 1 ? ` (per site, ${r.sites} sites)` : ''}</EuiText>
            <EuiSpacer size="s" />
          </>
        )}
        {r.answer && <EuiHorizontalRule margin="m" />}
        <Totals r={r} />
        {!r.answer && binding && (
          <>
            <EuiSpacer size="s" />
            <EuiText size="xs" color="subdued">
              Tightest constraint: <strong>{constraintLabel(binding.name)}{binding.tier ? ` (${binding.tier})` : ''}</strong>
              {binding.utilization !== undefined && Number.isFinite(binding.utilization) ? ` at ${fmtNum(binding.utilization * 100, 0)}% of usable capacity` : ''}
            </EuiText>
          </>
        )}
        <EuiHorizontalRule margin="m" />
        <ClusterMap r={r} />
        {(errors > 0 || warns > 0) && (
          <>
            <EuiSpacer size="s" />
            <EuiButtonEmpty size="s" flush="left" iconType={errors ? 'error' : 'warning'} color={errors ? 'danger' : 'warning'} onClick={() => setTab('checks')}>
              {[errors ? `${errors} error${errors > 1 ? 's' : ''}` : '', warns ? `${warns} warning${warns > 1 ? 's' : ''}` : ''].filter(Boolean).join(' and ')} to review
            </EuiButtonEmpty>
          </>
        )}
      </EuiPanel>

      <EuiSpacer size="m" />
      <EuiPanel hasBorder paddingSize="l">
        <EuiTabs size="s" bottomBorder>
          <EuiTab isSelected={tab === 'constraints'} onClick={() => setTab('constraints')}>{r.answer ? 'Constraints and headroom' : 'Utilization'}</EuiTab>
          <EuiTab isSelected={tab === 'nodes'} onClick={() => setTab('nodes')}>Node table</EuiTab>
          <EuiTab isSelected={tab === 'checks'} onClick={() => setTab('checks')}
            append={errors + warns > 0 ? <EuiNotificationBadge color={errors ? 'accent' : 'subdued'}>{errors + warns}</EuiNotificationBadge> : undefined}>
            Hardware checks
          </EuiTab>
        </EuiTabs>
        <EuiSpacer size="m" />
        {tab === 'constraints' && <ConstraintPanel r={r} />}
        {tab === 'nodes' && <NodeTable r={r} />}
        {tab === 'checks' && <WarningsPanel warnings={r.warnings} />}
      </EuiPanel>

      <EuiSpacer size="m" />
      <EuiPanel color="warning" paddingSize="m" hasShadow={false}>
        <EuiText size="s"><strong>Estimate, not benchmark.</strong> Storage math is reliable; CPU, query latency and ML are not. Validate with Rally on the customer's hardware.</EuiText>
        <EuiSpacer size="s" />
        <EuiText size="xs">
          <ul style={{ marginBottom: 0 }}>
            {r.assumptions.filter((a) => !a.startsWith('Estimate, not benchmark')).map((a, i) => <li key={i}>{a}</li>)}
          </ul>
        </EuiText>
      </EuiPanel>
      <EuiSpacer size="s" />
      <EuiText size="xs" color="subdued" textAlign="right">engine {r.engineVersion} · constants {r.constantsHash.slice(0, 12)}</EuiText>
    </>
  );
}
