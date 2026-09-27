import { EuiBadge, EuiCallOut, EuiFlexGroup, EuiFlexItem, EuiLink, EuiPageTemplate, EuiSpacer, EuiText, EuiTitle, EuiToolTip } from '@elastic/eui';
import type { ConstantSet } from '@sizing/constants';
import { defaultIndexMode, forward, reverse, ENGINE_VERSION, type SizingResult, type Tier, type WorkloadProfile } from '@sizing/engine';
import { useEffect, useMemo, useState } from 'react';
import { CpuThroughputField, DeploymentSettings, deploymentSummary, isDefaultDeployment } from './calculator/DeploymentSettings.tsx';
import { GrowthPlanner } from './calculator/GrowthPlanner.tsx';
import { HardwareGroups } from './calculator/HardwareGroups.tsx';
import { isDefaultNodeSizes, NodeSizes, nodeSizesSummary } from './calculator/NodeSizes.tsx';
import { SolvePicker } from './calculator/SolvePicker.tsx';
import { Toolbar } from './calculator/Toolbar.tsx';
import { WorkloadCard } from './calculator/WorkloadCard.tsx';
import { WorkloadList } from './calculator/WorkloadList.tsx';
import { NumField } from './components/Fields.tsx';
import { MathProvider } from './components/MathFlyout.tsx';
import { CostRatesForm } from './components/CostRatesForm.tsx';
import { useConstants } from './constantsStore.tsx';
import { costReport, mergeRates, subscriptionCost, type CostRates } from './cost.ts';
import { useCostDefaults } from './costStore.tsx';
import { download, slug, toJson, toMarkdown } from './export.ts';
import { ConfigPage } from './pages/ConfigPage.tsx';
import { TcoPage } from './pages/TcoPage.tsx';
import { ResultsPanel } from './results/ResultsPanel.tsx';
import {
  defaultState, deploymentOfForward, deploymentOfReverse, normalizeReverse, SOLVE_KINDS, tiersInUse, withForwardDeployment,
  withReverseDeployment, withSolve, type AppState,
} from './state.ts';
import { loadCurrent, saveCurrent } from './storage.ts';
import { Gap, Section } from './ui/Section.tsx';

type Outcome = { result: SizingResult; workloads: WorkloadProfile[] } | { error: string };

function compute(s: AppState, c: ConstantSet, overriddenKeys: string[]): Outcome {
  try {
    const out = s.mode === 'forward'
      ? { result: forward(s.forward, c), workloads: s.forward.workloads }
      : { result: reverse(s.reverse, c), workloads: s.reverse.fixed };
    if (overriddenKeys.length) {
      out.result = {
        ...out.result,
        assumptions: [`Custom constants in use (${overriddenKeys.length}, changed in this browser): ${overriddenKeys.join(', ')}.`, ...out.result.assumptions],
      };
    }
    return out;
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

const hasLogsdb = (w: readonly WorkloadProfile[]) => w.some((p) => (p.rawGbPerDay !== undefined || p.retentionDays.hot) && defaultIndexMode(p) === 'logsdb');

type Page = 'calculator' | 'tco' | 'config';
const HASH: Record<Page, string> = { calculator: '#/', tco: '#/tco', config: '#/config' };
const pageFromHash = (): Page => (window.location.hash.startsWith('#/config') ? 'config' : window.location.hash.startsWith('#/tco') ? 'tco' : 'calculator');

export function App() {
  const [page, setPage] = useState<Page>(pageFromHash);
  useEffect(() => {
    const on = () => setPage(pageFromHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const go = (p: Page) => { window.location.hash = HASH[p]; };

  const { set: constants, overrides } = useConstants();
  const overriddenKeys = useMemo(() => Object.keys(overrides).sort(), [overrides]);
  // One scenario shared by the calculator and the TCO page.
  const [state, setState] = useState<AppState>(() => loadCurrent() ?? defaultState());
  useEffect(() => saveCurrent(state), [state]);

  return (
    <MathProvider>
      <EuiPageTemplate panelled={false} restrictWidth={1600} grow>
        <EuiPageTemplate.Header
          pageTitle="Cluster Sizing Calculator"
          tabs={[
            { label: 'Calculator', isSelected: page === 'calculator', onClick: () => go('calculator') },
            { label: 'Total cost', isSelected: page === 'tco', onClick: () => go('tco') },
            { label: `Configurations${overriddenKeys.length ? ` (${overriddenKeys.length} changed)` : ''}`, isSelected: page === 'config', onClick: () => go('config') },
          ]}
          rightSideItems={[
            <EuiToolTip key="v" content={`Constants hash ${constants.hash}`}>
              <EuiBadge color="hollow">engine {ENGINE_VERSION} · constants {constants.hash.slice(0, 8)}</EuiBadge>
            </EuiToolTip>,
            ...(overriddenKeys.length
              ? [<EuiToolTip key="c" content={overriddenKeys.join(', ')}>
                  <EuiBadge color="warning" onClick={() => go('config')} onClickAriaLabel="Open configurations">custom constants ({overriddenKeys.length})</EuiBadge>
                </EuiToolTip>]
              : []),
          ]}
        />
        <EuiPageTemplate.Section>
          {page === 'config' && <ConfigPage />}
          {page === 'tco' && <TcoPage state={state} setState={setState} constants={constants} />}
          {page === 'calculator' && (
            <Calculator state={state} setState={setState} constants={constants} overriddenKeys={overriddenKeys} overrides={Object.values(overrides)} onOpenTco={() => go('tco')} />
          )}
        </EuiPageTemplate.Section>
      </EuiPageTemplate>
    </MathProvider>
  );
}

function Calculator({ state, setState, constants, overriddenKeys, overrides, onOpenTco }: {
  state: AppState; setState: Setter; constants: ConstantSet; overriddenKeys: string[]; overrides: Parameters<typeof toJson>[3]; onOpenTco: () => void;
}) {
  const { defaults } = useCostDefaults();
  const outcome = useMemo(() => compute(state, constants, overriddenKeys), [state, constants, overriddenKeys]);
  const patch = (p: Partial<AppState>) => setState((s) => ({ ...s, ...p }));
  const rates = mergeRates(defaults, state.cost?.rates);
  const setScenarioRates = (r: CostRates) => setState((s) => ({ ...s, cost: { ...s.cost, rates: r } }));

  const exportAs = (kind: 'md' | 'json') => {
    if ('error' in outcome) return;
    const at = new Date().toISOString();
    const cost = state.cost?.includeInExport ? costReport(state, constants, rates) : undefined;
    if (kind === 'md') download(`${slug(state.name)}.md`, toMarkdown(state, outcome.result, outcome.workloads, at, cost), 'text/markdown');
    else download(`${slug(state.name)}.json`, toJson(state, outcome.result, at, overrides), 'application/json');
  };

  return (
    <>
      <Toolbar
        state={state}
        canExport={!('error' in outcome)}
        onMode={(mode) => patch({ mode })}
        onRename={(name) => patch({ name })}
        onLoad={(s) => setState(() => s)}
        onReset={() => setState((s) => ({ ...defaultState(), name: s.name, mode: s.mode }))}
        onExportMd={() => exportAs('md')}
        onExportJson={() => exportAs('json')}
      />
      <EuiSpacer size="l" />
      <EuiFlexGroup gutterSize="xl" alignItems="flexStart" wrap>
        <EuiFlexItem style={{ minWidth: 480, flexBasis: 0, flexGrow: 7 }}>
          {state.mode === 'forward'
            ? <ForwardInputs state={state} setState={setState} {...('result' in outcome && outcome.result.objectStorage ? { objectStorage: outcome.result.objectStorage } : {})} />
            : <ReverseInputs state={state} setState={setState} />}
        </EuiFlexItem>
        {/* Stretch to the inputs' height so the pinned results column stays in view for the whole scroll. */}
        <EuiFlexItem style={{ minWidth: 360, flexBasis: 0, flexGrow: 5, alignSelf: 'stretch' }}>
          {'error' in outcome
            ? <EuiCallOut color="danger" iconType="error" title="Cannot calculate yet"><p>{outcome.error}</p></EuiCallOut>
            : <ResultsPanel r={outcome.result} subscription={subscriptionCost(outcome.result, rates)}
                subscriptionPrice={<CostRatesForm value={state.cost?.rates ?? {}} onChange={setScenarioRates} fallback={defaults} subscriptionOnly />}
                onOpenTco={onOpenTco} />}
        </EuiFlexItem>
      </EuiFlexGroup>
    </>
  );
}

type Setter = (f: (s: AppState) => AppState) => void;

/** Folded-step summary text for a CPU throughput override. */
const cpuThroughputExtra = (ev: number | undefined) => (ev !== undefined ? `CPU ${ev.toLocaleString('en-US')} ev/s/vCPU` : '');

function ForwardInputs({ state, setState, objectStorage }: { state: AppState; setState: Setter; objectStorage?: SizingResult['objectStorage'] }) {
  const f = state.forward;
  const setForward = (next: AppState['forward']) => setState((s) => ({ ...s, forward: next }));
  const tiers = tiersInUse(f);
  const { set: c } = useConstants();
  const deployment = deploymentOfForward(f.options);
  const extras = [
    f.options.coordinatingNodes ? `${f.options.coordinatingNodes} coordinating nodes` : '',
    cpuThroughputExtra(f.options.eventsPerSecondPerVcpu),
  ].filter(Boolean);

  return (
    <>
      <Section step={1} title="Where will it run?" summary={deploymentSummary(deployment, extras)} startCollapsed={isDefaultDeployment(deployment, extras)}>
        <DeploymentSettings
          value={deployment} hasLogsdb={hasLogsdb(f.workloads)}
          onChange={(d) => setForward({ ...f, options: withForwardDeployment(f.options, d) })}
          more={
            <>
              <EuiFlexItem>
                <NumField label="Coordinating nodes" value={f.options.coordinatingNodes} optional step={1} placeholder="0"
                  helpText="Dedicated query routers; add for heavy search or aggregation load." onChange={(coordinatingNodes) => setForward({ ...f, options: { ...f.options, coordinatingNodes } })} />
              </EuiFlexItem>
              <EuiFlexItem>
                <CpuThroughputField value={f.options.eventsPerSecondPerVcpu}
                  onChange={(eventsPerSecondPerVcpu) => setForward({ ...f, options: { ...f.options, eventsPerSecondPerVcpu } })} />
              </EuiFlexItem>
            </>
          }
        />
      </Section>
      <Gap />
      <Section step={2} title="What will the cluster hold?" description="Add every workload that will share the cluster. Results update as you type.">
        <WorkloadList workloads={f.workloads} onChange={(workloads) => setForward({ ...f, workloads })} />
      </Section>
      <Gap />
      <Section step={3} title="Node sizes and ratios"
        description="Defaults suit most sizings. Change a tier's node size, mem:disk ratio or frozen cache for this scenario only; Configurations holds the defaults."
        summary={nodeSizesSummary(c, tiers as Tier[], objectStorage)} startCollapsed={isDefaultNodeSizes(f.options)}>
        <NodeSizes tiers={tiers as Tier[]} value={f.options} onChange={(options) => setForward({ ...f, options })} objectStorage={objectStorage} />
      </Section>
      <Gap />
      <Section step={4} title="Plan for growth" description="Size for where each workload will be, not only where it is today.">
        <GrowthPlanner value={f} onChange={setForward} />
      </Section>
    </>
  );
}

function ReverseInputs({ state, setState }: { state: AppState; setState: Setter }) {
  const r = state.reverse;
  const setReverse = (next: AppState['reverse']) => setState((s) => ({ ...s, reverse: normalizeReverse(next) }));
  const kinds = SOLVE_KINDS[r.solve];
  const target = kinds.length ? r.fixed[0] : undefined;
  const others = kinds.length ? r.fixed.slice(1) : r.fixed;
  const withOthers = (o: WorkloadProfile[]) => setReverse({ ...r, fixed: target ? [target, ...o] : o });
  const targetTier = r.targetTier ?? (target ? (Object.keys(target.retentionDays).find((t) => (target.retentionDays[t as Tier] ?? 0) > 0) as Tier | undefined) : undefined) ?? 'hot';

  const deployment = deploymentOfReverse(r);
  const extras = [cpuThroughputExtra(r.eventsPerSecondPerVcpu)].filter(Boolean);
  let step = 1;
  return (
    <>
      <Section step={step++} title="Where will it run?" summary={deploymentSummary(deployment, extras)} startCollapsed={isDefaultDeployment(deployment, extras)}>
        <DeploymentSettings value={deployment} hasLogsdb={hasLogsdb(r.fixed)} reverse
          onChange={(d) => setReverse(withReverseDeployment(r, d))}
          more={
            <EuiFlexItem>
              <CpuThroughputField value={r.eventsPerSecondPerVcpu} onChange={(eventsPerSecondPerVcpu) => setReverse({ ...r, eventsPerSecondPerVcpu })} />
            </EuiFlexItem>
          } />
      </Section>
      <Gap />
      <Section step={step++} title="What do you want to find out?">
        <SolvePicker value={r.solve} onChange={(solve) => setState((s) => ({ ...s, reverse: withSolve(s.reverse, solve) }))} />
      </Section>
      <Gap />
      <Section step={step++} title="What hardware do they have?" description="One row per group of identical nodes.">
        <HardwareGroups groups={r.hardware.groups} solve={r.solve} onChange={(groups) => setReverse({ ...r, hardware: { ...r.hardware, groups } })}
          ratios={r.hardware.memDiskRatio ?? {}}
          onRatios={(memDiskRatio) => {
            const { memDiskRatio: _drop, ...hw } = r.hardware;
            setReverse({ ...r, hardware: Object.keys(memDiskRatio).length ? { ...hw, memDiskRatio } : hw });
          }}
          cacheFraction={r.frozenCacheFraction}
          onCacheFraction={(v) => {
            const { frozenCacheFraction: _drop, ...rest } = r;
            setReverse(v === undefined ? rest : { ...rest, frozenCacheFraction: v });
          }} />
      </Section>
      <Gap />
      {target && (
        <>
          <Section step={step++} title="What will it run?" description={r.solve === 'years_to_capacity' ? "Today's volume and how fast it grows." : 'Fixed parameters for the workload being solved.'}>
            <WorkloadCard
              p={target} kindChoices={kinds} showGrowth={r.solve === 'years_to_capacity'}
              role={{ kind: 'reverse-target', solve: r.solve, targetTier, onTargetTier: (t) => setReverse({ ...r, targetTier: t }) }}
              onChange={(p) => setReverse({ ...r, fixed: [p, ...others], targetProfileId: p.id })}
            />
            <EuiSpacer size="l" />
            <EuiTitle size="xxs"><h3>Already running on this cluster</h3></EuiTitle>
            <EuiText size="xs" color="subdued"><p>Other workloads use capacity before the answer is calculated.</p></EuiText>
            <EuiSpacer size="s" />
            {others.length === 0
              ? <OthersEmpty add={(w) => withOthers([w])} taken={r.fixed.map((p) => p.id)} />
              : <WorkloadList workloads={others} onChange={withOthers} role={{ kind: 'reverse-other' }} addLabel="Add another workload" showGrowth={r.solve === 'years_to_capacity'} />}
          </Section>
        </>
      )}
    </>
  );
}

/** Collapsed entry point for "other workloads" so the common case (nothing else on the cluster) stays quiet. */
function OthersEmpty({ add, taken }: { add: (w: WorkloadProfile) => void; taken: string[] }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return <EuiText size="s"><EuiLink onClick={() => setOpen(true)}>Add a workload that already runs here</EuiLink></EuiText>;
  }
  return <WorkloadList workloads={[]} onChange={(w) => { if (w[0]) add({ ...w[0], id: taken.includes(w[0].id) ? `${w[0].id} (existing)` : w[0].id }); }} role={{ kind: 'reverse-other' }} />;
}
