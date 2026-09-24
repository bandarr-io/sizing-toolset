import {
  EuiBadge, EuiButtonGroup, EuiCallOut, EuiFlexGroup, EuiFlexItem, EuiPageTemplate, EuiPanel, EuiSpacer, EuiTitle, EuiToolTip,
} from '@elastic/eui';
import { constantsHash } from '@sizing/constants';
import { ENGINE_VERSION, forward, reverse, type SizingResult, type WorkloadProfile } from '@sizing/engine';
import { useEffect, useMemo, useState } from 'react';
import { FastForwardForm, FastReverseForm } from './components/FastForms.tsx';
import { ForwardOptionsEditor } from './components/ForwardOptionsEditor.tsx';
import { HardwareEditor, SolveSettings } from './components/HardwareEditor.tsx';
import { MathProvider } from './components/MathFlyout.tsx';
import {
  AssumptionsPanel, ConstraintPanel, NodeTable, ResultSummary, ReverseAnswer, WarningsPanel,
} from './components/Results.tsx';
import { ScenarioBar } from './components/ScenarioBar.tsx';
import { WorkloadEditor } from './components/WorkloadEditor.tsx';
import { download, slug, toJson, toMarkdown } from './export.ts';
import {
  defaultState, forwardRequest, reverseRequest, switchInputMode, type AppState, type InputMode, type Mode,
} from './state.ts';
import { loadCurrent, saveCurrent } from './storage.ts';

type Outcome = { result: SizingResult; workloads: WorkloadProfile[] } | { error: string };

function compute(s: AppState): Outcome {
  try {
    if (s.mode === 'forward') {
      const req = forwardRequest(s);
      return { result: forward(req), workloads: req.workloads };
    }
    const req = reverseRequest(s);
    return { result: reverse(req), workloads: req.fixed };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export function App() {
  const [state, setState] = useState<AppState>(() => loadCurrent() ?? defaultState());
  useEffect(() => saveCurrent(state), [state]);
  const outcome = useMemo(() => compute(state), [state]);
  const patch = (p: Partial<AppState>) => setState((s) => ({ ...s, ...p }));

  const exportAs = (kind: 'md' | 'json') => {
    if ('error' in outcome) return;
    const at = new Date().toISOString();
    if (kind === 'md') download(`${slug(state.name)}.md`, toMarkdown(state, outcome.result, outcome.workloads, at), 'text/markdown');
    else download(`${slug(state.name)}.json`, toJson(state, outcome.result, at), 'application/json');
  };

  const inputs = (() => {
    if (state.inputMode === 'fast') {
      return state.mode === 'forward'
        ? <FastForwardForm value={state.fastForward} onChange={(fastForward) => patch({ fastForward })} />
        : <FastReverseForm value={state.fastReverse} onChange={(fastReverse) => patch({ fastReverse })} />;
    }
    if (state.mode === 'forward') {
      const f = state.expertForward;
      return (
        <>
          <WorkloadEditor workloads={f.workloads} onChange={(workloads) => patch({ expertForward: { ...f, workloads }, expertDirty: true })} />
          <EuiSpacer size="m" />
          <ForwardOptionsEditor value={f.options} onChange={(options) => patch({ expertForward: { ...f, options }, expertDirty: true })} />
        </>
      );
    }
    const r = state.expertReverse;
    return (
      <>
        <SolveSettings value={r} onChange={(expertReverse) => patch({ expertReverse, expertDirty: true })} />
        <EuiSpacer size="m" />
        <HardwareEditor value={r.hardware} onChange={(hardware) => patch({ expertReverse: { ...r, hardware }, expertDirty: true })} />
        <EuiSpacer size="m" />
        <WorkloadEditor title="Fixed workload parameters" workloads={r.fixed} onChange={(fixed) => patch({ expertReverse: { ...r, fixed }, expertDirty: true })} />
      </>
    );
  })();

  return (
    <MathProvider>
      <EuiPageTemplate panelled={false} restrictWidth={1680} grow>
        <EuiPageTemplate.Header
          pageTitle="Cluster Sizing Calculator"
          description="Forward: workload → hardware. Reverse: hardware → maximum workload, with the binding constraint and a confidence level."
          rightSideItems={[
            <EuiToolTip key="v" content={`Constants hash ${constantsHash}`}>
              <EuiBadge color="hollow">engine {ENGINE_VERSION} · constants {constantsHash.slice(0, 8)}</EuiBadge>
            </EuiToolTip>,
          ]}
        />
        <EuiPageTemplate.Section>
          <EuiFlexGroup gutterSize="m" alignItems="center" wrap>
            <EuiFlexItem grow={false}>
              <EuiButtonGroup
                legend="Mode" buttonSize="compressed" color="primary" idSelected={state.mode}
                options={[{ id: 'forward', label: 'Forward: I have a workload' }, { id: 'reverse', label: 'Reverse: I have hardware' }]}
                onChange={(id) => patch({ mode: id as Mode })}
              />
            </EuiFlexItem>
            <EuiFlexItem grow={false}>
              <EuiButtonGroup
                legend="Input detail" buttonSize="compressed" idSelected={state.inputMode}
                options={[{ id: 'fast', label: 'Fast' }, { id: 'expert', label: 'Expert' }]}
                onChange={(id) => setState((s) => switchInputMode(s, id as InputMode))}
              />
            </EuiFlexItem>
            <EuiFlexItem>
              <ScenarioBar
                state={state}
                canExport={!('error' in outcome)}
                onLoad={(s) => setState(s)}
                onRename={(name) => patch({ name })}
                onExportMd={() => exportAs('md')}
                onExportJson={() => exportAs('json')}
                onReset={() => setState({ ...defaultState(), name: state.name })}
              />
            </EuiFlexItem>
          </EuiFlexGroup>
          <EuiSpacer size="m" />
          <EuiFlexGroup gutterSize="l" alignItems="flexStart" wrap>
            <EuiFlexItem style={{ minWidth: 340, flexBasis: 480 }}>
              <EuiPanel hasBorder paddingSize="m">
                <EuiTitle size="s"><h2>{state.mode === 'forward' ? 'Workload' : 'Hardware and fixed workload'}</h2></EuiTitle>
                <EuiSpacer size="m" />
                {inputs}
              </EuiPanel>
            </EuiFlexItem>
            <EuiFlexItem style={{ minWidth: 340, flexBasis: 640 }}>
              {'error' in outcome ? (
                <EuiCallOut color="danger" iconType="error" title="Cannot calculate">
                  <p>{outcome.error}</p>
                </EuiCallOut>
              ) : (
                <Results r={outcome.result} />
              )}
            </EuiFlexItem>
          </EuiFlexGroup>
        </EuiPageTemplate.Section>
      </EuiPageTemplate>
    </MathProvider>
  );
}

function Results({ r }: { r: SizingResult }) {
  return (
    <>
      {r.answer && <><ReverseAnswer r={r} /><EuiSpacer size="m" /></>}
      <ResultSummary r={r} />
      <EuiSpacer size="m" />
      <AssumptionsPanel assumptions={r.assumptions} />
      <EuiSpacer size="m" />
      <EuiPanel hasBorder paddingSize="m">
        <EuiTitle size="xs"><h3>{r.sites > 1 ? 'Nodes per site' : 'Nodes'}</h3></EuiTitle>
        <EuiSpacer size="s" />
        <NodeTable r={r} />
      </EuiPanel>
      <EuiSpacer size="m" />
      <EuiPanel hasBorder paddingSize="m"><ConstraintPanel r={r} /></EuiPanel>
      <EuiSpacer size="m" />
      <EuiTitle size="xs"><h3>Hardware validation</h3></EuiTitle>
      <EuiSpacer size="s" />
      <WarningsPanel warnings={r.warnings} />
    </>
  );
}
