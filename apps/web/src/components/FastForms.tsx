import { EuiFlexGrid, EuiFlexItem, EuiText } from '@elastic/eui';
import { MODELS, USE_CASES, remainderTier, type FastForward, type FastReverse } from '../state.ts';
import { NumField, SelectField } from './Fields.tsx';

export function FastForwardForm({ value, onChange }: { value: FastForward; onChange: (v: FastForward) => void }) {
  const set = <K extends keyof FastForward>(k: K, v: FastForward[K]) => onChange({ ...value, [k]: v });
  const isSearch = value.useCase === 'search';
  const tier = remainderTier(value.useCase);
  const rest = Math.max(0, value.totalRetentionDays - value.hotDays);
  return (
    <>
      <EuiFlexGrid columns={2} gutterSize="m">
        <EuiFlexItem><SelectField label="Use case" value={value.useCase} options={USE_CASES} onChange={(v) => set('useCase', v)} /></EuiFlexItem>
        <EuiFlexItem>
          <NumField label={isSearch ? 'Corpus size (indexed)' : 'Raw ingest'} append={isSearch ? 'GB' : 'GB/day'} value={value.gbPerDay} onChange={(v) => set('gbPerDay', v ?? 0)} />
        </EuiFlexItem>
        {!isSearch && (
          <>
            <EuiFlexItem><NumField label="Hot retention" append="days" value={value.hotDays} min={1} onChange={(v) => set('hotDays', v ?? 0)} /></EuiFlexItem>
            <EuiFlexItem>
              <NumField
                label="Total retention" append="days" value={value.totalRetentionDays} min={0} onChange={(v) => set('totalRetentionDays', v ?? 0)}
                helpText={rest > 0 ? `${rest} days on ${tier}${value.useCase === 'metrics' ? ' (downsampled 0.1)' : ''}` : 'Hot only'}
              />
            </EuiFlexItem>
          </>
        )}
        <EuiFlexItem><NumField label="Replicas" value={value.replicas} min={0} step={1} onChange={(v) => set('replicas', v ?? 0)} /></EuiFlexItem>
        <EuiFlexItem><SelectField label="Deployment model" value={value.model} options={MODELS} onChange={(v) => set('model', v)} /></EuiFlexItem>
      </EuiFlexGrid>
      <EuiText size="xs" color="subdued">
        <p>Defaults: 64 GB nodes, LogsDB for logs/SIEM, TSDS for metrics, standard for APM/search. Switch to Expert for every profile, tier and override.</p>
      </EuiText>
    </>
  );
}

export function FastReverseForm({ value, onChange }: { value: FastReverse; onChange: (v: FastReverse) => void }) {
  const set = <K extends keyof FastReverse>(k: K, v: FastReverse[K]) => onChange({ ...value, [k]: v });
  return (
    <>
      <EuiFlexGrid columns={2} gutterSize="m">
        <EuiFlexItem>
          <SelectField label="Use case" value={value.useCase} options={USE_CASES.filter((u) => u.value !== 'search') as { value: FastReverse['useCase']; text: string }[]} onChange={(v) => set('useCase', v)} />
        </EuiFlexItem>
        <EuiFlexItem>
          <SelectField label="Solve for" value={value.solve} onChange={(v) => set('solve', v)} options={[
            { value: 'max_gb_day', text: 'Max GB/day' }, { value: 'max_retention', text: 'Max hot retention' },
          ]} />
        </EuiFlexItem>
        <EuiFlexItem><NumField label="Hot nodes" value={value.nodes} min={1} step={1} onChange={(v) => set('nodes', v ?? 0)} /></EuiFlexItem>
        <EuiFlexItem><NumField label="RAM per node" append="GB" value={value.ramGb} onChange={(v) => set('ramGb', v ?? 0)} /></EuiFlexItem>
        <EuiFlexItem><NumField label="Disk per node" append="GB" value={value.diskGb} onChange={(v) => set('diskGb', v ?? 0)} /></EuiFlexItem>
        <EuiFlexItem><NumField label="vCPU per node" value={value.vcpu} onChange={(v) => set('vcpu', v ?? 0)} /></EuiFlexItem>
        {value.solve === 'max_gb_day'
          ? <EuiFlexItem><NumField label="Hot retention" append="days" value={value.hotDays} min={1} onChange={(v) => set('hotDays', v ?? 0)} /></EuiFlexItem>
          : <EuiFlexItem><NumField label="Raw ingest" append="GB/day" value={value.gbPerDay} onChange={(v) => set('gbPerDay', v ?? 0)} /></EuiFlexItem>}
        <EuiFlexItem><NumField label="Replicas" value={value.replicas} min={0} step={1} onChange={(v) => set('replicas', v ?? 0)} /></EuiFlexItem>
      </EuiFlexGrid>
      <EuiText size="xs" color="subdued">
        <p>Fast reverse covers one hot tier. Use Expert for warm/frozen, Fleet, vectors, shards, ML and mixed node groups.</p>
      </EuiText>
    </>
  );
}
