import { EuiButtonEmpty, EuiFlexGrid, EuiFlexItem, EuiSpacer } from '@elastic/eui';
import type { CcrMode } from '@sizing/engine';
import { useState, type ReactNode } from 'react';
import { NumField, SelectField, SwitchField } from '../components/Fields.tsx';
import { MODELS, type Deployment } from '../state.ts';

const CCR: { value: CcrMode; text: string }[] = [
  { value: 'none', text: 'No cross-cluster replication' },
  { value: 'unidirectional', text: 'Unidirectional (each site holds its own data)' },
  { value: 'bidirectional', text: 'Bidirectional (each site also follows the others)' },
];

/** Deployment facts shared by forward and reverse. Shown once, in one place. */
export function DeploymentSettings({ value, onChange, hasLogsdb, reverse, more, moreCount = 0 }: {
  value: Deployment;
  onChange: (d: Deployment) => void;
  /** Only offer the full-LogsDB licensing switch when a LogsDB workload exists. */
  hasLogsdb: boolean;
  reverse?: boolean;
  /** Mode-specific advanced inputs. */
  more?: ReactNode;
  moreCount?: number;
}) {
  const [open, setOpen] = useState(false);
  const set = (patch: Partial<Deployment>) => onChange({ ...value, ...patch });
  const ccrOptions = reverse ? CCR.slice(0, 2).map((o) => (o.value === 'unidirectional' ? { ...o, text: 'Cross-cluster replication in use' } : o)) : CCR;
  return (
    <>
      <EuiFlexGrid columns={2} gutterSize="l">
        <EuiFlexItem><SelectField label="Deployment model" value={value.model} options={MODELS} onChange={(model) => set({ model })} /></EuiFlexItem>
        <EuiFlexItem>
          <NumField label="Sites" value={value.sites} step={1} min={1} onChange={(sites) => set({ sites: Math.max(1, sites ?? 1) })}
            helpText={value.sites > 1 ? 'Node counts are per site; totals cover all sites.' : undefined} />
        </EuiFlexItem>
        {(value.sites > 1 || value.ccrMode !== 'none') && (
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
          <SwitchField label="FIPS 140-3" checked={value.fips} helpText="Requires Platinum or Enterprise (9.4+ or 8.19.15+)." onChange={(fips) => set({ fips })} />
        </EuiFlexItem>
        {hasLogsdb && (
          <EuiFlexItem>
            <SwitchField label="Full LogsDB capabilities" checked={value.fullLogsdb} helpText="Raises the license floor to Enterprise." onChange={(fullLogsdb) => set({ fullLogsdb })} />
          </EuiFlexItem>
        )}
      </EuiFlexGrid>
      <EuiSpacer size="s" />
      <EuiButtonEmpty size="xs" flush="left" iconType={open ? 'chevronSingleDown' : 'chevronSingleRight'} onClick={() => setOpen(!open)}>
        {open ? 'Fewer options' : 'More options'}{!open && (moreCount + (value.concurrentSearch ? 1 : 0)) > 0 ? ` (${moreCount + (value.concurrentSearch ? 1 : 0)} set)` : ''}
      </EuiButtonEmpty>
      {open && (
        <>
          <EuiSpacer size="m" />
          <EuiFlexGrid columns={2} gutterSize="l">
            <EuiFlexItem>
              <SwitchField label="Heavy concurrent search" checked={value.concurrentSearch} helpText="Derates indexing throughput by 20% (CPU estimate only)." onChange={(concurrentSearch) => set({ concurrentSearch })} />
            </EuiFlexItem>
            {more}
          </EuiFlexGrid>
        </>
      )}
    </>
  );
}
