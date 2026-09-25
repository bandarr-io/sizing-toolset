import {
  EuiBadge, EuiButtonEmpty, EuiFlexGroup, EuiFlexItem, EuiFlyout, EuiFlyoutBody, EuiFlyoutHeader, EuiHorizontalRule, EuiPanel, EuiSpacer,
  EuiText, EuiTitle, EuiToolTip,
} from '@elastic/eui';
import type { MathStep, SizingResult } from '@sizing/engine';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ConstraintPanel, NodeTable, WarningsPanel } from '../components/Results.tsx';
import { MathButton } from '../components/MathFlyout.tsx';
import { constraintWithTier, solveLabel } from '../export.ts';
import { SOLVES } from '../state.ts';
import { fmtCompact, fmtNum, fmtStorage } from '../format.ts';
import { ClusterMap } from './ClusterMap.tsx';

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
      {r.objectStorage && (
        <Stat label="Object storage" value={fmtStorage(r.objectStorage.gb)} steps={r.objectStorage.math}
          hint={`Snapshot repository for cold and frozen${r.objectStorage.overridden ? ' (size set for this scenario)' : ''}. Not counted in RAM or ERU.`} />
      )}
      {r.sites > 1 && <Stat label={`All ${r.sites} sites`} value={`${fmtNum(r.allSites.licenseUnits, 0)} ERU`} hint={`${fmtNum(r.allSites.totalRamGb)} GB RAM`} />}
    </EuiFlexGroup>
  );
}

/** Short horizons read better in months: 0.13 years → "1.6 months". */
function yearsText(years: number): { n: string; unit: string } {
  if (years === 0) return { n: '0', unit: 'years (full today)' };
  if (years < 1) return { n: fmtNum(years * 12, 1), unit: years * 12 === 1 ? 'month' : 'months' };
  return { n: fmtNum(years, 1), unit: years === 1 ? 'year' : 'years' };
}

/** Calendar month the cluster fills, for a years answer. UI-only: the engine never reads the clock. */
function fillDate(years: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + Math.round(years * 12));
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
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
            {a.unit === 'years' && !Number.isFinite(a.value)
              ? <span style={{ fontSize: 32, fontWeight: 700, lineHeight: 1.1, color: '#0B64DD' }}>Not reached</span>
              : <>
                  <span style={{ fontSize: 40, fontWeight: 700, lineHeight: 1.1, color: '#0B64DD' }}>{a.unit === 'years' ? yearsText(a.value).n : fmtCompact(a.value)}</span>{' '}
                  <span style={{ fontSize: 18, fontWeight: 600 }}>{a.unit === 'years' ? yearsText(a.value).unit : a.unit}</span>
                </>}
          </div>
          {a.unit === 'years' && Number.isFinite(a.value) && a.value > 0 && (
            <EuiText size="s" color="subdued">around {fillDate(a.value)}</EuiText>
          )}
        </EuiFlexItem>
        {a.dataStreams !== undefined && (
          <EuiFlexItem grow={false}><EuiText size="s">≈ <strong>{fmtNum(a.dataStreams, 0)}</strong> data streams like this workload</EuiText></EuiFlexItem>
        )}
        {binding && <EuiFlexItem grow={false}><MathButton title={solveLabel(a.solve)} steps={binding.math} /></EuiFlexItem>}
      </EuiFlexGroup>
      <EuiSpacer size="xs" />
      <EuiFlexGroup gutterSize="s" alignItems="center" responsive={false} wrap>
        <EuiFlexItem grow={false}><EuiText size="s">Limited by <strong>{constraintWithTier(a.binding, a.bindingTier)}</strong></EuiText></EuiFlexItem>
        <EuiFlexItem grow={false}><EuiBadge color={CONF_COLOR[a.confidence]}>{a.confidence} confidence</EuiBadge></EuiFlexItem>
        {binding?.rallyRequired && <EuiFlexItem grow={false}><EuiBadge color="accent">Rally required</EuiBadge></EuiFlexItem>}
      </EuiFlexGroup>
    </>
  );
}

const PIN_TOP = 16;

/**
 * True while the element fits in the window below the pin offset. A pinned element taller than the
 * window would hide its own bottom forever (the page seems to stop scrolling), so it is only pinned when it fits.
 */
function useFitsViewport<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [fits, setFits] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setFits(el.offsetHeight + PIN_TOP * 2 <= window.innerHeight);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    window.addEventListener('resize', check);
    return () => { ro.disconnect(); window.removeEventListener('resize', check); };
  }, []);
  return { ref, fits };
}

type Detail = 'map' | 'constraints' | 'nodes' | 'checks' | 'assumptions';

/**
 * The whole column is pinned when it fits in the window (otherwise it scrolls with the page), with no scrollbar of its own: the summary plus buttons that open each
 * detail view (cluster map included) in a flyout, so the column's height stays fixed and small.
 */
export function ResultsPanel({ r }: { r: SizingResult }) {
  const [open, setOpen] = useState<Detail | undefined>();
  const { ref, fits } = useFitsViewport<HTMLDivElement>();
  const errors = r.warnings.filter((w) => w.severity === 'error').length;
  const warns = r.warnings.filter((w) => w.severity === 'warn').length;
  const binding = r.constraints.find((k) => k.binding);
  const assumptions = r.assumptions.filter((a) => !a.startsWith('Estimate, not benchmark'));

  const titles: Record<Detail, string> = {
    map: r.sites > 1 ? 'Cluster map (per site)' : 'Cluster map',
    constraints: r.answer ? 'Constraints and headroom' : 'Utilization by constraint',
    nodes: r.sites > 1 ? 'Nodes per site' : 'Node table',
    checks: 'Hardware checks (HV1 to HV12)',
    assumptions: 'Assumptions',
  };

  return (
    <div ref={ref} style={fits ? { position: 'sticky', top: PIN_TOP } : undefined}>
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
              Tightest constraint: <strong>{constraintWithTier(binding.name, binding.tier)}</strong>
              {binding.utilization !== undefined && Number.isFinite(binding.utilization) ? ` at ${fmtNum(binding.utilization * 100, 0)}% of usable capacity` : ''}
            </EuiText>
          </>
        )}
        <EuiHorizontalRule margin="m" />
        <EuiFlexGroup gutterSize="s" wrap responsive={false}>
          <EuiFlexItem grow={false}>
            <EuiButtonEmpty size="s" iconType="grid" onClick={() => setOpen('map')}>Cluster map</EuiButtonEmpty>
          </EuiFlexItem>
          <EuiFlexItem grow={false}>
            <EuiButtonEmpty size="s" iconType="chartBarHorizontal" onClick={() => setOpen('constraints')}>{r.answer ? 'Headroom' : 'Utilization'}</EuiButtonEmpty>
          </EuiFlexItem>
          <EuiFlexItem grow={false}>
            <EuiButtonEmpty size="s" iconType="table" onClick={() => setOpen('nodes')}>Node table</EuiButtonEmpty>
          </EuiFlexItem>
          <EuiFlexItem grow={false}>
            <EuiButtonEmpty size="s" iconType={errors ? 'error' : warns ? 'warning' : 'check'} color={errors ? 'danger' : warns ? 'warning' : 'primary'} onClick={() => setOpen('checks')}>
              Hardware checks{errors + warns > 0 ? ` (${errors + warns})` : ''}
            </EuiButtonEmpty>
          </EuiFlexItem>
        </EuiFlexGroup>
      </EuiPanel>

      <EuiSpacer size="s" />
      <EuiPanel color="warning" paddingSize="s" hasShadow={false}>
        <EuiFlexGroup gutterSize="s" alignItems="center" responsive={false}>
          <EuiFlexItem>
            <EuiText size="xs"><strong>Estimate, not benchmark.</strong> Storage math is reliable; CPU, query latency and ML are not. Validate with Rally.</EuiText>
          </EuiFlexItem>
          <EuiFlexItem grow={false}>
            <EuiButtonEmpty size="xs" onClick={() => setOpen('assumptions')}>{assumptions.length} assumptions</EuiButtonEmpty>
          </EuiFlexItem>
        </EuiFlexGroup>
      </EuiPanel>
      <EuiSpacer size="xs" />
      <EuiText size="xs" color="subdued" textAlign="right">engine {r.engineVersion} · constants {r.constantsHash.slice(0, 12)}</EuiText>

      {open && (
        <EuiFlyout onClose={() => setOpen(undefined)} size="m" ownFocus aria-labelledby="detail-title">
          <EuiFlyoutHeader hasBorder>
            <EuiTitle size="s"><h2 id="detail-title">{titles[open]}</h2></EuiTitle>
          </EuiFlyoutHeader>
          <EuiFlyoutBody>
            {open === 'map' && (
              <>
                <ClusterMap r={r} />
                {r.objectStorage && (
                  <><EuiHorizontalRule margin="m" /><EuiText size="s">Plus <strong>{fmtStorage(r.objectStorage.gb)}</strong> of object storage for cold and frozen searchable snapshots.</EuiText></>
                )}
              </>
            )}
            {open === 'constraints' && <ConstraintPanel r={r} />}
            {open === 'nodes' && <NodeTable r={r} />}
            {open === 'checks' && <WarningsPanel warnings={r.warnings} />}
            {open === 'assumptions' && (
              <EuiText size="s">
                <p><strong>Estimate, not benchmark.</strong> Storage math is reliable; CPU, query latency and ML are not. Validate with Rally on the customer's hardware. These assumptions are exported verbatim.</p>
                <ul>{assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul>
              </EuiText>
            )}
          </EuiFlyoutBody>
        </EuiFlyout>
      )}
    </div>
  );
}
