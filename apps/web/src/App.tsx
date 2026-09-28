import { EuiBadge, EuiCallOut, EuiFlexGroup, EuiFlexItem, EuiPageTemplate, EuiSpacer, EuiToolTip } from '@elastic/eui';
import type { ConstantSet } from '@sizing/constants';
import { compareModels, forward, reverse, sizeTopology, type ModelRow, ENGINE_VERSION, type SiteRelationship, type SizingResult, type Tier, type TopologyResult, type WorkloadProfile } from '@sizing/engine';
import { useEffect, useMemo, useState } from 'react';
import { CpuThroughputField, DeploymentSettings, deploymentSummary, isDefaultDeployment, requirementsSummary } from './calculator/DeploymentSettings.tsx';
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
import { download, modelsMarkdown, slug, toJson, toMarkdown, topologyMarkdown } from './export.ts';
import { ModelsPanel } from './results/ModelsPanel.tsx';
import { ServerGroups } from './calculator/ServerGroups.tsx';
import { MultiSiteInputs } from './calculator/MultiSiteInputs.tsx';
import { TopologyPanel } from './results/TopologyPanel.tsx';
import { ConfigPage } from './pages/ConfigPage.tsx';
import { TcoPage } from './pages/TcoPage.tsx';
import { ResultsPanel } from './results/ResultsPanel.tsx';
import {
  defaultModels, defaultMultiSite, defaultState, groupsSummary, growthSummary, isDefaultGrowth, MODEL_NAMES, modelOptionsFor, redirectToModels, deploymentOfForward, RELATIONSHIPS, topologyRequest, deploymentOfReverse, normalizeReverse, SOLVE_KINDS, SOLVES, workloadsSummary, tiersInUse, withForwardDeployment,
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
          pageTitle="Elastic Ballpark Editor"
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

  if (state.mode === 'multisite') return <MultiSiteCalculator state={state} setState={setState} constants={constants} />;
  if (state.mode === 'models') return <ModelsCalculator state={state} setState={setState} constants={constants} />;

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
            : <ResultsPanel r={outcome.result} subscription={subscriptionCost(outcome.result, rates, state.cost?.discountPct)}
                subscriptionPrice={<CostRatesForm value={state.cost?.rates ?? {}} onChange={setScenarioRates} fallback={defaults} subscriptionOnly />}
                onOpenTco={onOpenTco} />}
        </EuiFlexItem>
      </EuiFlexGroup>
    </>
  );
}

type Setter = (f: (s: AppState) => AppState) => void;

/** D33: one site's servers, sized under self-managed, ECK and ECE side by side. */
function ModelsCalculator({ state, setState, constants }: { state: AppState; setState: Setter; constants: ConstantSet }) {
  const m = state.models ?? defaultModels();
  useEffect(() => { if (!state.models) setState((s) => ({ ...s, models: s.models ?? defaultModels() })); }, [state.models, setState]);
  const outcome = useMemo((): { rows: ModelRow[] } | { error: string } => {
    try {
      return { rows: compareModels({ workloads: m.workloads, servers: m.servers, options: m.options }, constants) };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }, [m, constants]);
  const setModels = (next: typeof m) => setState((s) => ({ ...s, models: next }));
  const patch = (p: Partial<AppState>) => setState((s) => ({ ...s, ...p }));
  const exportAs = (kind: 'md' | 'json') => {
    if ('error' in outcome) return;
    const at = new Date().toISOString();
    if (kind === 'md') download(`${slug(state.name)}-models.md`, modelsMarkdown(state.name, outcome.rows, at), 'text/markdown');
    else download(`${slug(state.name)}-models.json`, JSON.stringify({ exportedAt: at, engineVersion: ENGINE_VERSION, constantsHash: constants.hash, scenario: state, result: outcome.rows }, null, 2), 'application/json');
  };
  return (
    <>
      <Toolbar
        state={state}
        canExport={!('error' in outcome)}
        onMode={(mode) => patch({ mode })}
        onRename={(name) => patch({ name })}
        onLoad={(s) => setState(() => s)}
        onReset={() => setState((s) => ({ ...s, models: defaultModels() }))}
        onExportMd={() => exportAs('md')}
        onExportJson={() => exportAs('json')}
      />
      <EuiSpacer size="l" />
      <EuiFlexGroup gutterSize="xl" alignItems="flexStart" wrap>
        <EuiFlexItem style={{ minWidth: 480, flexBasis: 0, flexGrow: 7 }}>
          <Section step={1} title="What will the cluster hold?" description="The same workloads are sized under every model." summary={workloadsSummary(m.workloads)}>
            <WorkloadList workloads={m.workloads} onChange={(workloads) => setModels({ ...m, workloads })} />
          </Section>
          <Gap />
          <Section step={2} title="What servers do they have?" description="One row per group of identical servers. Each model carves them up differently; master servers become the ECE control plane." summary={groupsSummary(m.servers)}>
            <ServerGroups servers={m.servers} onChange={(servers) => setModels({ ...m, servers })} />
          </Section>
          <Gap />
          <Section step={3} title="Deployment" description="Requirements shared by every model." summary={requirementsSummary(deploymentOfForward(m.options))}>
            <DeploymentSettings hideSites hideModel value={deploymentOfForward(m.options)}
              onChange={(d) => setModels({ ...m, options: withForwardDeployment(m.options, { ...d, sites: 1, ccrMode: 'none' }) })} />
          </Section>
        </EuiFlexItem>
        <EuiFlexItem style={{ minWidth: 360, flexBasis: 0, flexGrow: 5, alignSelf: 'stretch' }}>
          {'error' in outcome
            ? <EuiCallOut color="danger" iconType="error" title="Cannot calculate yet"><p>{outcome.error}</p></EuiCallOut>
            : <ModelsPanel rows={outcome.rows} />}
        </EuiFlexItem>
      </EuiFlexGroup>
    </>
  );
}

type TopologyOutcome = { result: TopologyResult; compare?: Partial<Record<SiteRelationship, TopologyResult>> } | { error: string };

/** D32: several clusters on physical servers. Shares the toolbar; its own inputs and results. */
function MultiSiteCalculator({ state, setState, constants }: { state: AppState; setState: Setter; constants: ConstantSet }) {
  const ms = state.multisite ?? defaultMultiSite();
  // Persist the defaults the first time the mode is opened.
  useEffect(() => { if (!state.multisite) setState((s) => ({ ...s, multisite: s.multisite ?? defaultMultiSite() })); }, [state.multisite, setState]);
  const outcome = useMemo((): TopologyOutcome => {
    try {
      const result = sizeTopology(topologyRequest(ms), constants);
      if (!ms.compare) return { result };
      const compare = Object.fromEntries(RELATIONSHIPS.map((r) => [r.value, r.value === ms.relationship ? result : sizeTopology(topologyRequest(ms, r.value), constants)]));
      return { result, compare };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }, [ms, constants]);
  const patch = (p: Partial<AppState>) => setState((s) => ({ ...s, ...p }));

  const exportAs = (kind: 'md' | 'json') => {
    if ('error' in outcome) return;
    const at = new Date().toISOString();
    if (kind === 'md') download(`${slug(state.name)}.md`, topologyMarkdown(state.name, outcome.result, at), 'text/markdown');
    else download(`${slug(state.name)}.json`, JSON.stringify({ exportedAt: at, engineVersion: ENGINE_VERSION, constantsHash: constants.hash, scenario: state, result: outcome.result }, null, 2), 'application/json');
  };

  return (
    <>
      <Toolbar
        state={state}
        canExport={!('error' in outcome)}
        onMode={(mode) => patch({ mode })}
        onRename={(name) => patch({ name })}
        onLoad={(s) => setState(() => s)}
        onReset={() => setState((s) => ({ ...s, multisite: defaultMultiSite() }))}
        onExportMd={() => exportAs('md')}
        onExportJson={() => exportAs('json')}
      />
      <EuiSpacer size="l" />
      <EuiFlexGroup gutterSize="xl" alignItems="flexStart" wrap>
        <EuiFlexItem style={{ minWidth: 480, flexBasis: 0, flexGrow: 7 }}>
          <MultiSiteInputs ms={ms} setState={setState} />
        </EuiFlexItem>
        <EuiFlexItem style={{ minWidth: 360, flexBasis: 0, flexGrow: 5, alignSelf: 'stretch' }}>
          {'error' in outcome
            ? <EuiCallOut color="danger" iconType="error" title="Cannot calculate yet"><p>{outcome.error}</p></EuiCallOut>
            : <TopologyPanel result={outcome.result} {...(outcome.compare ? { compare: outcome.compare } : {})}
                modelName={MODEL_NAMES[topologyRequest(ms).hostModel ?? 'self_managed']}
                onPick={(relationship) => setState((s) => ({ ...s, multisite: { ...(s.multisite ?? defaultMultiSite()), relationship } }))} />}
        </EuiFlexItem>
      </EuiFlexGroup>
    </>
  );
}

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
          value={deployment} modelOptions={modelOptionsFor('forward')}
          onChange={(d) => (d.model === 'eck' || d.model === 'ece'
            ? setState((s) => redirectToModels(s, f.workloads, withForwardDeployment(f.options, { ...d, model: 'self_managed' })))
            : setForward({ ...f, options: withForwardDeployment(f.options, d) }))}
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
      <Section step={2} title="What will the cluster hold?" description="Add every workload that will share the cluster. Results update as you type." summary={workloadsSummary(f.workloads)}>
        <WorkloadList workloads={f.workloads} onChange={(workloads) => setForward({ ...f, workloads })} />
      </Section>
      <Gap />
      <Section step={3} title="Node sizes and ratios"
        description="Defaults suit most sizings. Change a tier's node size, mem:disk ratio or frozen cache for this scenario only; Configurations holds the defaults."
        summary={nodeSizesSummary(c, tiers as Tier[], objectStorage)} startCollapsed={isDefaultNodeSizes(f.options)}>
        <NodeSizes tiers={tiers as Tier[]} value={f.options} onChange={(options) => setForward({ ...f, options })} objectStorage={objectStorage} />
      </Section>
      <Gap />
      <Section step={4} title="Plan for growth" description="Size for where each workload will be, not only where it is today."
        summary={growthSummary(c, f)} startCollapsed={isDefaultGrowth(f)}>
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
  const targetTier = r.targetTier ?? (target ? (Object.keys(target.retentionDays).find((t) => (target.retentionDays[t as Tier] ?? 0) > 0) as Tier | undefined) : undefined) ?? 'hot';

  const deployment = deploymentOfReverse(r);
  const extras = [cpuThroughputExtra(r.eventsPerSecondPerVcpu)].filter(Boolean);
  let step = 1;
  return (
    <>
      <Section step={step++} title="Where will it run?" summary={deploymentSummary(deployment, extras)} startCollapsed={isDefaultDeployment(deployment, extras)}>
        <DeploymentSettings value={deployment} reverse modelOptions={modelOptionsFor('reverse')}
          onChange={(d) => (d.model === 'eck' || d.model === 'ece'
            ? setState((s) => redirectToModels(s, r.fixed, withForwardDeployment({ model: 'self_managed' }, { ...d, model: 'self_managed' })))
            : setReverse(withReverseDeployment(r, d)))}
          more={
            <EuiFlexItem>
              <CpuThroughputField value={r.eventsPerSecondPerVcpu} onChange={(eventsPerSecondPerVcpu) => setReverse({ ...r, eventsPerSecondPerVcpu })} />
            </EuiFlexItem>
          } />
      </Section>
      <Gap />
      <Section step={step++} title="What do you want to find out?" summary={SOLVES.find((x) => x.value === r.solve)?.title}>
        <SolvePicker value={r.solve} onChange={(solve) => setState((s) => ({ ...s, reverse: withSolve(s.reverse, solve) }))} />
      </Section>
      <Gap />
      <Section step={step++} title="What hardware do they have?" description="One row per group of identical nodes." summary={groupsSummary(r.hardware.groups, 'nodes')}>
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
          <Section step={step++} title="What will it run?" description={r.solve === 'years_to_capacity' ? "Today's volume and how fast it grows." : 'Fixed parameters for the workload being solved.'} summary={workloadsSummary(r.fixed)}>
            <WorkloadCard
              p={target} kindChoices={kinds} showGrowth={r.solve === 'years_to_capacity'}
              role={{ kind: 'reverse-target', solve: r.solve, targetTier, onTargetTier: (t) => setReverse({ ...r, targetTier: t }) }}
              onChange={(p) => setReverse({ ...r, fixed: [p], targetProfileId: p.id })}
            />
          </Section>
        </>
      )}
    </>
  );
}

