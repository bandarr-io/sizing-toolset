import { EuiBadge, EuiFlexGrid, EuiFlexItem, EuiSpacer } from '@elastic/eui';
import { num } from '@sizing/constants';
import type { CcrMode } from '@sizing/engine';
import type { ReactNode } from 'react';
import { NumField, SelectField, SwitchField } from '../components/Fields.tsx';
import { useConstants } from '../constantsStore.tsx';
import { fmtNum } from '../format.ts';
import { MODELS, type Deployment } from '../state.ts';

const CCR: { value: CcrMode; text: string }[] = [
  { value: 'none', text: 'No cross-cluster replication' },
  { value: 'unidirectional', text: 'Unidirectional (each site holds its own data)' },
  { value: 'bidirectional', text: 'Bidirectional (each site also follows the others)' },
];

/** True when nothing differs from a new scenario, so the step can start folded. `extras` names mode-specific inputs that are set. */
export function isDefaultDeployment(d: Deployment, extras: readonly string[] = []): boolean {
  return d.model === 'self_managed' && d.sites === 1 && d.ccrMode === 'none' && !d.airGapped && !d.autoOps && !d.fips
    && !d.fullLogsdb && !d.concurrentSearch && extras.length === 0;
}

/** One line for the folded step: "Self-managed · 1 site · FIPS 140-3". */
export function deploymentSummary(d: Deployment, extras: readonly string[] = []): string {
  const model = MODELS.find((m) => m.value === d.model)?.text ?? d.model;
  const flags = [
    d.airGapped && 'air-gapped', d.autoOps && 'AutoOps', d.fips && 'FIPS 140-3', d.fullLogsdb && 'full LogsDB',
    d.concurrentSearch && 'heavy concurrent search', d.ccrMode !== 'none' && 'cross-cluster replication', ...extras,
  ].filter(Boolean);
  return [model, `${d.sites} site${d.sites === 1 ? '' : 's'}`, ...(flags.length ? flags : ['no special requirements'])].join(' · ');
}

/** D28: events/s per vCPU for the CPU ingest constraint. Blank uses `ev_per_s_per_vcpu`. */
export function CpuThroughputField({ value, onChange }: { value: number | undefined; onChange: (v: number | undefined) => void }) {
  const { set: c } = useConstants();
  const fallback = num(c, 'ev_per_s_per_vcpu');
  return (
    <NumField label="CPU ingest throughput" append="ev/s/vCPU" value={value} optional min={1} placeholder={String(fallback)}
      error={value !== undefined && !(value >= 1) ? 'Must be at least 1 event/s per vCPU.' : undefined}
      helpText={<>Events/s per vCPU. Default is {fmtNum(fallback, 0)} (conservative). Use Rally benchmark results to override. Low confidence; always validate. <EuiBadge color="accent">Rally required</EuiBadge></>}
      onChange={onChange} />
  );
}

/** Deployment facts shared by forward and reverse. Shown once, in one place; the step itself folds, so nothing hides behind a toggle. */
export function DeploymentSettings({ value, onChange, hasLogsdb, reverse, more, hideSites = false }: {
  value: Deployment;
  onChange: (d: Deployment) => void;
  /** Only offer the full-LogsDB licensing switch when a LogsDB workload exists. */
  hasLogsdb: boolean;
  reverse?: boolean;
  /** Mode-specific inputs, shown after the shared switches. */
  more?: ReactNode;
  /** Multi-site mode defines the sites and their relationship itself. */
  hideSites?: boolean;
}) {
  const set = (patch: Partial<Deployment>) => onChange({ ...value, ...patch });
  const ccrOptions = reverse ? CCR.slice(0, 2).map((o) => (o.value === 'unidirectional' ? { ...o, text: 'Cross-cluster replication in use' } : o)) : CCR;
  return (
    <>
      <EuiFlexGrid columns={2} gutterSize="l">
        <EuiFlexItem><SelectField label="Deployment model" value={value.model} options={MODELS} onChange={(model) => set({ model })} /></EuiFlexItem>
        {!hideSites && <EuiFlexItem>
          <NumField label="Sites" value={value.sites} step={1} min={1} onChange={(sites) => set({ sites: Math.max(1, sites ?? 1) })}
            helpText={value.sites > 1 ? 'Node counts are per site; totals cover all sites.' : undefined} />
        </EuiFlexItem>}
        {!hideSites && (value.sites > 1 || value.ccrMode !== 'none') && (
          <EuiFlexItem><SelectField label="Replication between sites" value={value.ccrMode} options={ccrOptions} onChange={(ccrMode) => set({ ccrMode })} /></EuiFlexItem>
        )}
      </EuiFlexGrid>
      <EuiSpacer size="m" />
      <EuiFlexGrid columns={2} gutterSize="l">
        <EuiFlexItem>
          <SwitchField label="Air-gapped" checked={value.airGapped} helpText="No internet access. AutoOps and Cloud Connect are unavailable."
            onChange={(airGapped) => set({ airGapped, ...(airGapped ? { autoOps: false } : {}) })} />
        </EuiFlexItem>
        <EuiFlexItem>
          <SwitchField label="AutoOps / Cloud Connect" checked={value.autoOps} disabled={value.airGapped}
            helpText={value.airGapped ? 'Unavailable when air-gapped.' : 'Free on all tiers; needs internet.'} onChange={(autoOps) => set({ autoOps })} />
        </EuiFlexItem>
        <EuiFlexItem>
          <SwitchField label="FIPS 140-3" checked={value.fips} helpText="Requires Enterprise (9.4+ or 8.19.15+)." onChange={(fips) => set({ fips })} />
        </EuiFlexItem>
        {hasLogsdb && (
          <EuiFlexItem>
            <SwitchField label="Full LogsDB capabilities" checked={value.fullLogsdb} helpText="Raises the license floor to Enterprise." onChange={(fullLogsdb) => set({ fullLogsdb })} />
          </EuiFlexItem>
        )}
        <EuiFlexItem>
          <SwitchField label="Heavy concurrent search" checked={value.concurrentSearch} helpText="Derates indexing throughput by 20% (CPU estimate only)." onChange={(concurrentSearch) => set({ concurrentSearch })} />
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
