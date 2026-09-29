import { EuiButton, EuiCallOut, EuiCode, EuiFlexGroup, EuiFlexItem, EuiLoadingSpinner, EuiSpacer, EuiText } from '@elastic/eui';
import { ENGINE_VERSION } from '@sizing/engine';
import type { ConstantSet } from '@sizing/constants';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Toolbar } from '../calculator/Toolbar.tsx';
import { download, slug } from '../export.ts';
import type { AppState } from '../state.ts';
import { Gap, Section } from '../ui/Section.tsx';
import { useEchData } from './EchData.tsx';
import { EchItemList, PlacementForm } from './EchInputs.tsx';
import { EchPanel } from './EchPanel.tsx';
import { echMarkdown } from './export.ts';
import { defaultEch, placementSummary, runEch, useCaseLabel, type EchState } from './state.ts';

type Setter = (f: (s: AppState) => AppState) => void;

/** D40: Elastic Cloud Hosted estimate, priced like the ECH Ballpark Estimator. */
export function EchCalculator({ state, setState, constants }: { state: AppState; setState: Setter; constants: ConstantSet }) {
  const { data, status, from, upload } = useEchData();
  const e = state.ech ?? defaultEch();
  useEffect(() => { if (!state.ech) setState((s) => ({ ...s, ech: s.ech ?? defaultEch() })); }, [state.ech, setState]);
  const setEch = (next: EchState) => setState((s) => ({ ...s, ech: next }));
  const patch = (p: Partial<AppState>) => setState((s) => ({ ...s, ...p }));
  const outcomes = useMemo(() => (data ? runEch(constants, data, e) : []), [constants, data, e]);

  const exportAs = (kind: 'md' | 'json') => {
    if (!data) return;
    const at = new Date().toISOString();
    if (kind === 'md') download(`${slug(state.name)}-ech.md`, echMarkdown(state.name, e, data, outcomes, at), 'text/markdown');
    else download(`${slug(state.name)}-ech.json`, JSON.stringify({ exportedAt: at, engineVersion: ENGINE_VERSION, constantsHash: constants.hash, echData: data.source, scenario: state, result: outcomes }, null, 2), 'application/json');
  };

  return (
    <>
      <Toolbar
        state={state}
        canExport={!!data}
        onMode={(mode) => patch({ mode })}
        onRename={(name) => patch({ name })}
        onLoad={(s) => setState(() => s)}
        onReset={() => setState((s) => ({ ...s, ech: defaultEch() }))}
        onExportMd={() => exportAs('md')}
        onExportJson={() => exportAs('json')}
      />
      <EuiSpacer size="l" />
      {!data ? (
        status === 'loading' ? <EuiLoadingSpinner size="l" /> : <MissingData onUpload={upload} />
      ) : (
        <EuiFlexGroup gutterSize="xl" alignItems="flexStart" wrap>
          <EuiFlexItem style={{ minWidth: 480, flexBasis: 0, flexGrow: 7 }}>
            <Section step={1} title="Where will it run?" description="Elastic Cloud prices depend on the cloud, the region, how it is bought and the subscription level."
              summary={placementSummary(e.placement)}>
              <PlacementForm data={data} value={e.placement} onChange={(placement) => setEch({ ...e, placement })} />
            </Section>
            <Gap />
            <Section step={2} title="What will it hold?" description="Each use case is priced as its own deployment, and the costs add up, as in the ballpark spreadsheet."
              summary={e.items.map((i) => `${i.name} (${useCaseLabel(i.useCase)})`).join(', ')}>
              <EchItemList data={data} state={e} onChange={(items) => setEch({ ...e, items })} />
            </Section>
          </EuiFlexItem>
          <EuiFlexItem style={{ minWidth: 380, flexBasis: 0, flexGrow: 5, alignSelf: 'stretch' }}>
            <EchPanel data={data} outcomes={outcomes} rounded={e.roundLines} onRounded={(roundLines) => setEch({ ...e, roundLines })} from={from} />
          </EuiFlexItem>
        </EuiFlexGroup>
      )}
    </>
  );
}

/** Prices are internal and never bundled: explain how to get them into this browser. */
function MissingData({ onUpload }: { onUpload: (f: File) => Promise<void> }) {
  const file = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | undefined>();
  return (
    <EuiCallOut iconType="cloud" title="Elastic Cloud prices are not loaded">
      <EuiText size="s">
        <p>Elastic Cloud estimates use the internal ECH Ballpark Estimator price list, which is not shipped with this app. To load it:</p>
        <ol>
          <li>Download the ECH Ballpark Estimator spreadsheet (.xlsx).</li>
          <li>Convert it (<EuiCode>{'node scripts/ech-import.mjs "<spreadsheet.xlsx>"'}</EuiCode>). In development the app then finds it by itself.</li>
          <li>Or upload a converted data file here. It stays in this browser.</li>
        </ol>
      </EuiText>
      <EuiSpacer size="s" />
      <EuiButton size="s" iconType="upload" onClick={() => file.current?.click()}>Upload a data file</EuiButton>
      <input ref={file} type="file" accept="application/json,.json" hidden
        onChange={(ev) => { const f = ev.target.files?.[0]; if (f) onUpload(f).then(() => setError(undefined), (x: unknown) => setError(x instanceof Error ? x.message : String(x))); }} />
      {error && <EuiText size="s" color="danger"><p>Upload failed: {error}</p></EuiText>}
    </EuiCallOut>
  );
}
