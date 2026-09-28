import { EuiBadge, EuiFlexGrid, EuiFlexItem, EuiSpacer } from '@elastic/eui';
import { num } from '@sizing/constants';
import type { CcrMode } from '@sizing/engine';
import type { ReactNode } from 'react';
import { NumField, SelectField, SwitchField } from '../components/Fields.tsx';
import { useConstants } from '../constantsStore.tsx';
import { fmtNum } from '../format.ts';
import { MODELS, type Deployment } from '../state.ts';

const CCR: { value: CcrMode; text: string }[] = [
  { value: 'none', text: 'No copying between sites' },
  { value: 'unidirectional', text: 'One way (each site keeps its own data)' },
  { value: 'bidirectional', text: 'Both ways (each site also keeps a copy of the others)' },
];

/** One line under the model picker, so each option is explained where it is chosen. */
const MODEL_HELP: Partial<Record<Deployment['model'], string>> = {
  self_managed: 'Elasticsearch installed directly on your servers.',
  eck: 'Elastic Cloud on Kubernetes: Elasticsearch runs in containers that Kubernetes manages.',
  ece: "Elastic Cloud Enterprise: Elastic's private-cloud platform, installed on your servers.",
};

/** True when nothing differs from a new scenario, so the step can start folded. `extras` names mode-specific inputs that are set. */
export function isDefaultDeployment(d: Deployment, extras: readonly string[] = []): boolean {
  return d.model === 'self_managed' && d.sites === 1 && d.ccrMode === 'none' && !d.airGapped && !d.autoOps && !d.fips
    && !d.concurrentSearch && extras.length === 0;
}

/** One line for the folded step: "Self-managed · 1 site · FIPS 140-3". */
export function deploymentSummary(d: Deployment, extras: readonly string[] = []): string {
  return [modelName(d), `${d.sites} site${d.sites === 1 ? '' : 's'}`, requirementsSummary(d, extras)].join(' · ');
}

const modelName = (d: Deployment) => MODELS.find((m) => m.value === d.model)?.text ?? d.model;

/** Just the requirement flags, for steps where the model or site count is set elsewhere. */
export function requirementsSummary(d: Deployment, extras: readonly string[] = [], withModel = false): string {
  const flags = [
    d.airGapped && 'no internet', d.autoOps && 'AutoOps', d.fips && 'FIPS 140-3',
    d.concurrentSearch && 'heavy search load', d.ccrMode !== 'none' && 'copying between sites', ...extras,
  ].filter(Boolean);
  return [...(withModel ? [modelName(d)] : []), ...(flags.length ? flags : ['no special requirements'])].join(' · ');
}

/** D28: events/s per vCPU for the CPU ingest constraint. Blank uses `ev_per_s_per_vcpu`. */
export function CpuThroughputField({ value, onChange }: { value: number | undefined; onChange: (v: number | undefined) => void }) {
  const { set: c } = useConstants();
  const fallback = num(c, 'ev_per_s_per_vcpu');
  return (
    <NumField label="Processing speed" append="events/s per core" value={value} optional min={1} placeholder={String(fallback)}
      error={value !== undefined && !(value >= 1) ? 'Must be at least 1 event per second per core.' : undefined}
      helpText={<>How many events each processor core can take in per second. The default, {fmtNum(fallback, 0)}, is cautious. Replace it with results from Rally, Elastic's benchmarking tool. Treat it as a rough guess until tested. <EuiBadge color="accent">Rally required</EuiBadge></>}
      onChange={onChange} />
  );
}

/** Deployment facts shared by forward and reverse. Shown once, in one place; the step itself folds, so nothing hides behind a toggle. */
export function DeploymentSettings({ value, onChange, reverse, more, hideSites = false, hideModel = false, modelOptions = MODELS }: {
  value: Deployment;
  onChange: (d: Deployment) => void;
  reverse?: boolean;
  /** Mode-specific inputs, shown after the shared switches. */
  more?: ReactNode;
  /** Multi-site mode defines the sites and their relationship itself. */
  hideSites?: boolean;
  /** Compare-models mode evaluates every model, so there is nothing to pick. */
  hideModel?: boolean;
  /** D34: what this mode can size (see modelOptionsFor). */
  modelOptions?: typeof MODELS;
}) {
  // D35: the full-LogsDB switch is gone; any change also clears a flag left by an older scenario.
  const set = (patch: Partial<Deployment>) => onChange({ ...value, ...patch, fullLogsdb: false });
  const ccrOptions = reverse ? CCR.slice(0, 2).map((o) => (o.value === 'unidirectional' ? { ...o, text: 'Copying data between sites' } : o)) : CCR;
  return (
    <>
      <EuiFlexGrid columns={2} gutterSize="l">
        {!hideModel && <EuiFlexItem><SelectField label="Deployment model" value={value.model} options={modelOptions} onChange={(model) => set({ model })}
          helpText={MODEL_HELP[value.model]} /></EuiFlexItem>}
        {!hideSites && <EuiFlexItem>
          <NumField label="Sites" value={value.sites} step={1} min={1} onChange={(sites) => set({ sites: Math.max(1, sites ?? 1) })}
            helpText={value.sites > 1 ? 'Node counts are for one site. Totals cover every site.' : undefined} />
        </EuiFlexItem>}
        {!hideSites && (value.sites > 1 || value.ccrMode !== 'none') && (
          <EuiFlexItem><SelectField label="Copying data between sites" value={value.ccrMode} options={ccrOptions} onChange={(ccrMode) => set({ ccrMode })} /></EuiFlexItem>
        )}
      </EuiFlexGrid>
      <EuiSpacer size="m" />
      <EuiFlexGrid columns={2} gutterSize="l">
        <EuiFlexItem>
          <SwitchField label="Air-gapped" checked={value.airGapped} helpText="No internet connection. AutoOps, Elastic's monitoring service, is not available."
            onChange={(airGapped) => set({ airGapped, ...(airGapped ? { autoOps: false } : {}) })} />
        </EuiFlexItem>
        <EuiFlexItem>
          <SwitchField label="AutoOps / Cloud Connect" checked={value.autoOps} disabled={value.airGapped}
            helpText={value.airGapped ? 'Not available without internet.' : "Elastic's monitoring service. Free with every subscription; needs internet."} onChange={(autoOps) => set({ autoOps })} />
        </EuiFlexItem>
        <EuiFlexItem>
          <SwitchField label="FIPS 140-3" checked={value.fips} helpText="A US government encryption standard. Needs an Enterprise subscription and version 9.4, or 8.19.15 and later." onChange={(fips) => set({ fips })} />
        </EuiFlexItem>
        <EuiFlexItem>
          <SwitchField label="Heavy concurrent search" checked={value.concurrentSearch} helpText="Many people searching at once. Lowers how fast data can be taken in by 20% (processor estimate only)." onChange={(concurrentSearch) => set({ concurrentSearch })} />
        </EuiFlexItem>
      </EuiFlexGrid>
      {more && (
        <>
          <EuiSpacer size="l" />
          <EuiFlexGrid columns={2} gutterSize="l">{more}</EuiFlexGrid>
        </>
      )}
    </>
  );
}
