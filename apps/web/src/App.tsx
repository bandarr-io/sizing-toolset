import { EuiBadge, EuiCallOut, EuiFlexGroup, EuiFlexItem, EuiLink, EuiPageTemplate, EuiSpacer, EuiText, EuiTitle, EuiToolTip } from '@elastic/eui';
import type { ConstantSet } from '@sizing/constants';
import { defaultIndexMode, forward, reverse, ENGINE_VERSION, type SizingResult, type Tier, type WorkloadProfile } from '@sizing/engine';
import { useEffect, useMemo, useState } from 'react';
import { DeploymentSettings } from './calculator/DeploymentSettings.tsx';
import { HardwareGroups } from './calculator/HardwareGroups.tsx';
import { NodeSizes } from './calculator/NodeSizes.tsx';
import { SolvePicker } from './calculator/SolvePicker.tsx';
import { Toolbar } from './calculator/Toolbar.tsx';
import { WorkloadCard } from './calculator/WorkloadCard.tsx';
import { WorkloadList } from './calculator/WorkloadList.tsx';
import { NumField } from './components/Fields.tsx';
import { MathProvider } from './components/MathFlyout.tsx';
import { useConstants } from './constantsStore.tsx';
import { download, slug, toJson, toMarkdown } from './export.ts';
import { ConfigPage } from './pages/ConfigPage.tsx';
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

type Page = 'calculator' | 'config';
const pageFromHash = (): Page => (window.location.hash.startsWith('#/config') ? 'config' : 'calculator');

export function App() {
  const [page, setPage] = useState<Page>(pageFromHash);
  useEffect(() => {
    const on = () => setPage(pageFromHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const go = (p: Page) => { window.location.hash = p === 'config' ? '#/config' : '#/'; };

  const { set: constants, overrides } = useConstants();
  const overriddenKeys = useMemo(() => Object.keys(overrides).sort(), [overrides]);

  return (
    <MathProvider>
      <EuiPageTemplate panelled={false} restrictWidth={1600} grow>
        <EuiPageTemplate.Header
          pageTitle="Cluster Sizing Calculator"
          description="Size Elasticsearch clusters from workloads, or find the limits of existing hardware."
          tabs={[
            { label: 'Calculator', isSelected: page === 'calculator', onClick: () => go('calculator') },
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
          {page === 'config' ? <ConfigPage /> : <Calculator constants={constants} overriddenKeys={overriddenKeys} overrides={Object.values(overrides)} />}
        </EuiPageTemplate.Section>
      </EuiPageTemplate>
    </MathProvider>
  );
}

function Calculator({ constants, overriddenKeys, overrides }: { constants: ConstantSet; overriddenKeys: string[]; overrides: Parameters<typeof toJson>[3] }) {
  const [state, setState] = useState<AppState>(() => loadCurrent() ?? defaultState());
  useEffect(() => saveCurrent(state), [state]);
  const outcome = useMemo(() => compute(state, constants, overriddenKeys), [state, constants, overriddenKeys]);
  const patch = (p: Partial<AppState>) => setState((s) => ({ ...s, ...p }));

  const exportAs = (kind: 'md' | 'json') => {
    if ('error' in outcome) return;
    const at = new Date().toISOString();
    if (kind === 'md') download(`${slug(state.name)}.md`, toMarkdown(state, outcome.result, outcome.workloads, at), 'text/markdown');
    else download(`${slug(state.name)}.json`, toJson(state, outcome.result, at, overrides), 'application/json');
  };

  return (
    <>
      <Toolbar
        state={state}
        canExport={!('error' in outcome)}
        onMode={(mode) => patch({ mode })}
        onRename={(name) => patch({ name })}
        onLoad={(s) => setState(s)}
        onReset={() => setState({ ...defaultState(), name: state.name, mode: state.mode })}
        onExportMd={() => exportAs('md')}
        onExportJson={() => exportAs('json')}
      />
      <EuiSpacer size="l" />
      <EuiFlexGroup gutterSize="xl" alignItems="flexStart" wrap>
        <EuiFlexItem style={{ minWidth: 480, flexBasis: 0, flexGrow: 7 }}>
          {state.mode === 'forward' ? <ForwardInputs state={state} setState={setState} /> : <ReverseInputs state={state} setState={setState} />}
        </EuiFlexItem>
        {/* Stretch to the inputs' height so the pinned results column stays in view for the whole scroll. */}
        <EuiFlexItem style={{ minWidth: 360, flexBasis: 0, flexGrow: 5, alignSelf: 'stretch' }}>
          {'error' in outcome
            ? <EuiCallOut color="danger" iconType="error" title="Cannot calculate yet"><p>{outcome.error}</p></EuiCallOut>
            : <ResultsPanel r={outcome.result} />}
        </EuiFlexItem>
      </EuiFlexGroup>
    </>
  );
}

type Setter = (f: (s: AppState) => AppState) => void;

function ForwardInputs({ state, setState }: { state: AppState; setState: Setter }) {
  const f = state.forward;
  const setForward = (next: AppState['forward']) => setState((s) => ({ ...s, forward: next }));
  const growthUsed = f.workloads.some((p) => (p.growthPctPerYear ?? 0) !== 0);
  const moreCount = (f.options.coordinatingNodes ? 1 : 0) + (f.options.growthHorizonYears !== undefined ? 1 : 0);
  const tiers = tiersInUse(f);

  return (
    <>
      <Section step={1} title="What will the cluster hold?" description="Add every workload that will share the cluster. Results update as you type.">
        <WorkloadList workloads={f.workloads} onChange={(workloads) => setForward({ ...f, workloads })} />
      </Section>
      <Gap />
      <Section step={2} title="Where will it run?">
        <DeploymentSettings
          value={deploymentOfForward(f.options)} hasLogsdb={hasLogsdb(f.workloads)} moreCount={moreCount}
          onChange={(d) => setForward({ ...f, options: withForwardDeployment(f.options, d) })}
          more={
            <>
              <EuiFlexItem>
                <NumField label="Coordinating nodes" value={f.options.coordinatingNodes} optional step={1} placeholder="0"
                  helpText="Dedicated query routers; add for heavy search or aggregation load." onChange={(coordinatingNodes) => setForward({ ...f, options: { ...f.options, coordinatingNodes } })} />
              </EuiFlexItem>
              {growthUsed && (
                <EuiFlexItem>
                  <NumField label="Size for growth over" append="years" value={f.options.growthHorizonYears} optional placeholder="1"
                    onChange={(growthHorizonYears) => setForward({ ...f, options: { ...f.options, growthHorizonYears } })} />
                </EuiFlexItem>
              )}
            </>
          }
        />
      </Section>
      <Gap />
      <Section step={3} title="Node sizes" description="Defaults suit most sizings. Match them to the customer's standard hardware if they have one.">
        <NodeSizes tiers={tiers as Tier[]} value={f.options} onChange={(options) => setForward({ ...f, options })} />
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

  let step = 1;
  return (
    <>
      <Section step={step++} title="What do you want to find out?">
        <SolvePicker value={r.solve} onChange={(solve) => setState((s) => ({ ...s, reverse: withSolve(s.reverse, solve) }))} />
      </Section>
      <Gap />
      <Section step={step++} title="What hardware do they have?" description="One row per group of identical nodes.">
        <HardwareGroups groups={r.hardware.groups} solve={r.solve} onChange={(groups) => setReverse({ ...r, hardware: { ...r.hardware, groups } })} />
      </Section>
      <Gap />
      {target && (
        <>
          <Section step={step++} title="What will it run?" description="Fixed parameters for the workload being solved.">
            <WorkloadCard
              p={target} kindChoices={kinds}
              role={{ kind: 'reverse-target', solve: r.solve, targetTier, onTargetTier: (t) => setReverse({ ...r, targetTier: t }) }}
              onChange={(p) => setReverse({ ...r, fixed: [p, ...others], targetProfileId: p.id })}
            />
            <EuiSpacer size="l" />
            <EuiTitle size="xxs"><h3>Already running on this cluster</h3></EuiTitle>
            <EuiText size="xs" color="subdued"><p>Other workloads use capacity before the answer is calculated.</p></EuiText>
            <EuiSpacer size="s" />
            {others.length === 0
              ? <OthersEmpty add={(w) => withOthers([w])} taken={r.fixed.map((p) => p.id)} />
              : <WorkloadList workloads={others} onChange={withOthers} role={{ kind: 'reverse-other' }} addLabel="Add another workload" />}
          </Section>
          <Gap />
        </>
      )}
      <Section step={step++} title="Deployment">
        <DeploymentSettings value={deploymentOfReverse(r)} hasLogsdb={hasLogsdb(r.fixed)} reverse
          onChange={(d) => setReverse(withReverseDeployment(r, d))} />
      </Section>
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
