import {
  EuiBadge, EuiButtonEmpty, EuiButtonIcon, EuiFlexGroup, EuiFlexItem, EuiFlyout, EuiFlyoutBody, EuiFlyoutHeader, EuiHorizontalRule, EuiIcon, EuiLink,
  EuiPanel, EuiPopover, EuiSpacer, EuiText, EuiTitle, EuiToolTip,
} from '@elastic/eui';
import type { CostLine } from '../cost.ts';
import type { MathStep, SizingResult } from '@sizing/engine';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ConfidenceBadge } from '../components/ConfidenceBadge.tsx';
import { ConstraintPanel, FindingsSummary, groupFindings, NodeTable, TopConstraints, WarningsPanel } from '../components/Results.tsx';
import { MathButton } from '../components/MathFlyout.tsx';
import { constraintWithTier, solveLabel } from '../export.ts';
import { SOLVES } from '../state.ts';
import { fmtCompact, fmtMoney, fmtNum, fmtStorage } from '../format.ts';
import { byRoleOrder, ROLE_LABEL } from '../ui/tiers.ts';
import { ClusterMap } from './ClusterMap.tsx';

const ANSWER_COLOR = '#0B64DD';

function Stat({ label, value, steps, hint, sub, action }: { label: string; value: ReactNode; steps?: MathStep[]; hint?: string; sub?: ReactNode; action?: ReactNode }) {
  return (
    <EuiFlexItem style={{ minWidth: 110 }}>
      <EuiText size="xs" color="subdued">{label}</EuiText>
      <EuiFlexGroup gutterSize="xs" alignItems="center" responsive={false}>
        <EuiFlexItem grow={false}>
          {hint
            ? <EuiToolTip content={hint}><EuiTitle size="xs"><span style={{ whiteSpace: 'nowrap' }}>{value}</span></EuiTitle></EuiToolTip>
            : <EuiTitle size="xs"><span style={{ whiteSpace: 'nowrap' }}>{value}</span></EuiTitle>}
        </EuiFlexItem>
        {steps && steps.length > 0 && <EuiFlexItem grow={false}><MathButton title={label} steps={steps} /></EuiFlexItem>}
        {action && <EuiFlexItem grow={false}>{action}</EuiFlexItem>}
      </EuiFlexGroup>
      {sub && <EuiText size="xs" color="subdued">{sub}</EuiText>}
    </EuiFlexItem>
  );
}

/** D29 plus cost: the license in one stat, and what it costs per year with the price editable in place. */
function SubscriptionStats({ r, cost }: { r: SizingResult; cost?: CostProps }) {
  const [editing, setEditing] = useState(false);
  const basic = r.licenseFloor === 'basic';
  const line = cost?.subscription;
  const priceEditor = cost && (
    <EuiPopover isOpen={editing} closePopover={() => setEditing(false)} anchorPosition="downCenter" panelStyle={{ width: 320 }}
      button={line?.annual === undefined
        ? <EuiButtonEmpty size="xs" flush="left" iconType="pencil" onClick={() => setEditing(!editing)}>Set license price</EuiButtonEmpty>
        : <EuiButtonIcon size="xs" iconType="pencil" aria-label="Edit license price" onClick={() => setEditing(!editing)} />}>
      {cost.priceEditor}
    </EuiPopover>
  );
  return (
    <>
      <Stat label="License" value={basic ? 'Basic' : `${fmtNum(r.licenseUnits.value, 0)} ERU`} steps={basic ? undefined : [...r.totalRamMath, ...r.licenseUnits.math]}
        hint={basic
          ? 'No paid features are used, so no subscription is needed.'
          : `An ERU (Enterprise Resource Unit) is the unit Elastic licenses by, a block of memory. Enterprise is needed for: ${r.licenseFloorReasons.join('; ')}.`}
        sub={basic ? 'no subscription' : 'Enterprise license'} />
      {cost && !basic && (
        <Stat label="Subscription" value={line?.annual === undefined ? priceEditor : `${fmtMoney(line.annual)} / yr`}
          steps={line?.math} action={line?.annual !== undefined ? priceEditor : undefined}
          sub={<EuiLink onClick={cost.onOpenTco}>See total cost</EuiLink>} />
      )}
    </>
  );
}

function nodeCounts(r: SizingResult) {
  const dataNodes = r.tiers.reduce((s, t) => s + t.nodes, 0);
  return { dataNodes, allNodes: dataNodes + r.overhead.reduce((s, o) => s + o.count, 0) };
}

/** Why each tier has its node count, then the sum that gives the headline number. */
function nodeMath(r: SizingResult): MathStep[] {
  const { allNodes } = nodeCounts(r);
  const parts = byRoleOrder([
    ...r.tiers.map((t) => ({ role: t.tier as string, text: `${t.nodes} ${t.tier}` })),
    ...r.overhead.filter((o) => o.count > 0).map((o) => ({ role: o.role as string, text: `${o.count} ${(ROLE_LABEL[o.role] ?? o.role).toLowerCase()}` })),
  ]).map((x) => x.text);
  return [
    ...r.tiers.flatMap((t) => t.math),
    ...r.overhead.filter((o) => o.count > 0).flatMap((o) => o.math),
    { label: r.sites > 1 ? 'nodes per site' : 'total nodes', expr: parts.join(' + '), value: allNodes, constantKeys: [] },
  ];
}

function Totals({ r, withNodes, cost }: { r: SizingResult; withNodes: boolean; cost?: CostProps }) {
  const { dataNodes, allNodes } = nodeCounts(r);
  return (
    <EuiFlexGroup gutterSize="l" wrap responsive={false}>
      {withNodes && <Stat label={r.sites > 1 ? 'Nodes per site' : 'Nodes'} value={`${allNodes}`} hint={`${dataNodes} hold data; the rest keep the cluster running. A node is one running copy of Elasticsearch.`} steps={nodeMath(r)} />}
      <Stat label={r.sites > 1 ? 'Memory per site' : 'Total memory'} value={`${fmtNum(r.totalRamGb)} GB`} steps={r.totalRamMath} />
      <SubscriptionStats r={r} {...(cost ? { cost } : {})} />
      {r.objectStorage && (
        <Stat label="Object storage" value={fmtStorage(r.objectStorage.gb)} steps={r.objectStorage.math}
          hint={`Cheap bulk storage (such as S3) that holds the cold and frozen data${r.objectStorage.overridden ? '. Size set by hand for this scenario' : ''}. Not counted in memory or license units.`} />
      )}
      {r.sites > 1 && <Stat label={`All ${r.sites} sites`} value={`${fmtNum(r.allSites.licenseUnits, 0)} ERU`} hint={`${fmtNum(r.allSites.totalRamGb)} GB memory across all sites`} />}
    </EuiFlexGroup>
  );
}

function Headline({ label, value, unit, math, mathTitle }: { label: string; value: ReactNode; unit: string; math?: MathStep[]; mathTitle: string }) {
  return (
    <>
      <EuiText size="s" color="subdued">{label}</EuiText>
      <EuiFlexGroup gutterSize="s" alignItems="baseline" responsive={false} wrap>
        <EuiFlexItem grow={false}>
          <div style={{ whiteSpace: 'nowrap' }}>
            <span style={{ fontSize: 40, fontWeight: 700, lineHeight: 1.1, color: ANSWER_COLOR }}>{value}</span>{' '}
            <span style={{ fontSize: 18, fontWeight: 600 }}>{unit}</span>
          </div>
        </EuiFlexItem>
        {math && <EuiFlexItem grow={false}><MathButton title={mathTitle} steps={math} /></EuiFlexItem>}
      </EuiFlexGroup>
    </>
  );
}

/** Short horizons read better in months: 0.13 years → "1.6 months". */
function yearsText(years: number): { n: string; unit: string } {
  if (years === 0) return { n: '0', unit: 'years (already full)' };
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
  const title = SOLVES.find((s) => s.value === a.solve)?.title ?? solveLabel(a.solve);
  const neverFull = a.unit === 'years' && !Number.isFinite(a.value);
  const shown = a.unit === 'years' ? yearsText(a.value) : { n: fmtCompact(a.value), unit: a.unit };
  return (
    <>
      <Headline label={title} value={neverFull ? 'Not reached' : shown.n} unit={neverFull ? '' : shown.unit}
        {...(binding ? { math: binding.math } : {})} mathTitle={solveLabel(a.solve)} />
      {a.unit === 'years' && Number.isFinite(a.value) && a.value > 0 && <EuiText size="s" color="subdued">around {fillDate(a.value)}</EuiText>}
      {a.dataStreams !== undefined && <EuiText size="s">About <strong>{fmtNum(a.dataStreams, 0)}</strong> data streams (separate data feeds) like this one</EuiText>}
      <EuiSpacer size="xs" />
      <EuiFlexGroup gutterSize="s" alignItems="center" responsive={false} wrap>
        <EuiFlexItem grow={false}><EuiText size="s">Runs out first: <strong>{constraintWithTier(a.binding, a.bindingTier)}</strong></EuiText></EuiFlexItem>
        <EuiFlexItem grow={false}><ConfidenceBadge c={a.confidence} /></EuiFlexItem>
        {binding?.rallyRequired && <EuiFlexItem grow={false}><EuiBadge color="accent">Needs a Rally test</EuiBadge></EuiFlexItem>}
      </EuiFlexGroup>
    </>
  );
}

function Recommended({ r }: { r: SizingResult }) {
  const { allNodes } = nodeCounts(r);
  return <Headline label={`Recommended cluster${r.sites > 1 ? ` (per site, ${r.sites} sites)` : ''}`} value={allNodes} unit={allNodes === 1 ? 'node' : 'nodes'} math={nodeMath(r)} mathTitle="Nodes" />;
}

function Block({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <>
      <EuiHorizontalRule margin="m" />
      <EuiFlexGroup gutterSize="s" alignItems="center" justifyContent="spaceBetween" responsive={false}>
        <EuiFlexItem grow={false}><EuiTitle size="xxxs"><h3>{title}</h3></EuiTitle></EuiFlexItem>
        {action && <EuiFlexItem grow={false}>{action}</EuiFlexItem>}
      </EuiFlexGroup>
      <EuiSpacer size="s" />
      {children}
    </>
  );
}

export const PIN_TOP = 16;

/**
 * True while the element fits in the window below the pin offset. A pinned element taller than the
 * window would hide its own bottom forever (the page seems to stop scrolling), so it is only pinned when it fits.
 */
export function useFitsViewport<T extends HTMLElement>() {
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

type Detail = 'constraints' | 'nodes' | 'checks' | 'assumptions';

/**
 * Results column, pinned when it fits the window (D23, amended): headline, totals, cluster map, the closest
 * constraints and hardware findings inline; the full constraint list, node table, checks and assumptions open in flyouts.
 */
interface CostProps {
  subscription: CostLine;
  /** Form that edits this scenario's ERU price; shown in a popover. */
  priceEditor: ReactNode;
  onOpenTco: () => void;
}

export function ResultsPanel({ r, subscription, subscriptionPrice, onOpenTco }: {
  r: SizingResult; subscription?: CostLine; subscriptionPrice?: ReactNode; onOpenTco?: () => void;
}) {
  const cost: CostProps | undefined = subscription && onOpenTco ? { subscription, priceEditor: subscriptionPrice, onOpenTco } : undefined;
  const [open, setOpen] = useState<Detail | undefined>();
  const { ref, fits } = useFitsViewport<HTMLDivElement>();
  const findings = groupFindings(r.warnings.filter((w) => w.severity !== 'info')).length;
  const assumptions = r.assumptions.filter((a) => !a.startsWith('Estimate, not benchmark'));
  const link = (label: string, d: Detail) => <EuiButtonEmpty size="xs" flush="right" onClick={() => setOpen(d)}>{label}</EuiButtonEmpty>;

  const titles: Record<Detail, string> = {
    constraints: r.answer ? 'Limits and spare room' : 'How full each resource is',
    nodes: r.sites > 1 ? 'Nodes per site' : 'Node details',
    checks: 'Hardware checks',
    assumptions: 'Assumptions',
  };

  return (
    <div ref={ref} style={fits ? { position: 'sticky', top: PIN_TOP } : undefined}>
      <EuiPanel hasBorder paddingSize="l">
        {r.answer ? <Answer r={r} /> : <Recommended r={r} />}
        <EuiSpacer size="m" />
        <Totals r={r} withNodes={!!r.answer} {...(cost ? { cost } : {})} />

        <Block title={r.sites > 1 ? 'Cluster map (per site)' : 'Cluster map'} action={link('Node details', 'nodes')}>
          <ClusterMap r={r} />
        </Block>

        <Block title="What runs out first" action={link('All limits', 'constraints')}>
          <TopConstraints r={r} />
        </Block>

        <Block title="Hardware checks" action={findings > 2 || r.warnings.some((w) => w.severity === 'info') ? link(`All checks${findings ? ` (${findings})` : ''}`, 'checks') : undefined}>
          <FindingsSummary warnings={r.warnings} />
        </Block>
      </EuiPanel>

      <EuiSpacer size="s" />
      <EuiFlexGroup gutterSize="s" alignItems="center" responsive={false}>
        <EuiFlexItem grow={false}><EuiIcon type="info" color="subdued" size="s" /></EuiFlexItem>
        <EuiFlexItem>
          <EuiText size="xs" color="subdued"><strong>Estimate, not benchmark.</strong> Disk space figures are dependable. Processor, search speed and machine learning figures are rough, so test them with Rally, Elastic's benchmarking tool.</EuiText>
        </EuiFlexItem>
        <EuiFlexItem grow={false}>{link(`${assumptions.length} assumptions`, 'assumptions')}</EuiFlexItem>
      </EuiFlexGroup>

      {open && (
        <EuiFlyout onClose={() => setOpen(undefined)} size="m" ownFocus aria-labelledby="detail-title">
          <EuiFlyoutHeader hasBorder>
            <EuiTitle size="s"><h2 id="detail-title">{titles[open]}</h2></EuiTitle>
          </EuiFlyoutHeader>
          <EuiFlyoutBody>
            {open === 'constraints' && <ConstraintPanel r={r} />}
            {open === 'nodes' && <NodeTable r={r} />}
            {open === 'checks' && <WarningsPanel warnings={r.warnings} />}
            {open === 'assumptions' && (
              <EuiText size="s">
                <p><strong>Estimate, not benchmark.</strong> Disk space figures are dependable. Processor, search speed and machine learning figures are rough. Test them with Rally, Elastic's benchmarking tool, on the customer's hardware. Exports include these assumptions word for word.</p>
                <ul>{assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul>
              </EuiText>
            )}
          </EuiFlyoutBody>
        </EuiFlyout>
      )}
    </div>
  );
}
