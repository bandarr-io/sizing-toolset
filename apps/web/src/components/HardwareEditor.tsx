import {
  EuiButtonEmpty, EuiButtonIcon, EuiFlexGrid, EuiFlexGroup, EuiFlexItem, EuiPanel, EuiSpacer, EuiText, EuiTitle,
} from '@elastic/eui';
import type { HardwareConfig, NodeGroup, ReverseRequest, Solve, Tier } from '@sizing/engine';
import { MODELS } from '../state.ts';
import { DISK_TYPES } from './ForwardOptionsEditor.tsx';
import { NumField, SelectField, SwitchField } from './Fields.tsx';

const ROLES: { value: NodeGroup['role']; text: string }[] = [
  { value: 'hot', text: 'hot' }, { value: 'warm', text: 'warm' }, { value: 'cold', text: 'cold' }, { value: 'frozen', text: 'frozen' },
  { value: 'content', text: 'content' }, { value: 'master', text: 'master' }, { value: 'ml', text: 'ML' },
  { value: 'coordinating', text: 'coordinating' }, { value: 'kibana', text: 'Kibana' }, { value: 'fleet', text: 'Fleet Server' }, { value: 'apm', text: 'APM Server' },
];
export const SOLVES: { value: Solve; text: string }[] = [
  { value: 'max_gb_day', text: 'Max GB/day' }, { value: 'max_retention', text: 'Max retention' }, { value: 'max_agents', text: 'Max Elastic Agents' },
  { value: 'max_vectors', text: 'Max vectors' }, { value: 'max_shards', text: 'Max shards / data streams' }, { value: 'max_ml_jobs', text: 'Max ML jobs' },
];
const TIERS: { value: Tier; text: string }[] = ['hot', 'warm', 'cold', 'frozen', 'content'].map((t) => ({ value: t as Tier, text: t }));

export function HardwareEditor({ value, onChange }: { value: HardwareConfig; onChange: (v: HardwareConfig) => void }) {
  const setGroup = (i: number, patch: Partial<NodeGroup>) => {
    const groups = value.groups.map((g, j) => {
      if (j !== i) return g;
      const next = { ...g, ...patch } as NodeGroup & Record<string, unknown>;
      if (next.heapGbOverride === undefined) delete next.heapGbOverride;
      return next;
    });
    onChange({ ...value, groups });
  };
  const add = () => onChange({ ...value, groups: [...value.groups, { role: 'warm', count: 2, ramGb: 64, diskGb: 10240, diskType: 'ssd', vcpu: 8 }] });
  return (
    <>
      <EuiFlexGroup alignItems="center" justifyContent="spaceBetween" responsive={false}>
        <EuiFlexItem grow={false}><EuiTitle size="xs"><h3>Hardware</h3></EuiTitle></EuiFlexItem>
        <EuiFlexItem grow={false}><EuiButtonEmpty size="s" iconType="plusCircle" onClick={add}>Add node group</EuiButtonEmpty></EuiFlexItem>
      </EuiFlexGroup>
      <EuiSpacer size="s" />
      {value.groups.map((g, i) => (
        <div key={i}>
          <EuiPanel paddingSize="s" hasBorder>
            <EuiFlexGroup gutterSize="s" alignItems="flexEnd" wrap>
              <EuiFlexItem style={{ minWidth: 120 }}><SelectField label="Role" value={g.role} options={ROLES} onChange={(role) => setGroup(i, { role })} /></EuiFlexItem>
              <EuiFlexItem style={{ minWidth: 70 }}><NumField label="Count" value={g.count} step={1} onChange={(v) => setGroup(i, { count: v ?? 0 })} /></EuiFlexItem>
              <EuiFlexItem style={{ minWidth: 90 }}><NumField label="RAM GB" value={g.ramGb} onChange={(v) => setGroup(i, { ramGb: v ?? 0 })} /></EuiFlexItem>
              <EuiFlexItem style={{ minWidth: 100 }}><NumField label="Disk GB" value={g.diskGb} onChange={(v) => setGroup(i, { diskGb: v ?? 0 })} /></EuiFlexItem>
              <EuiFlexItem style={{ minWidth: 90 }}><SelectField label="Disk" value={g.diskType} options={DISK_TYPES} onChange={(diskType) => setGroup(i, { diskType })} /></EuiFlexItem>
              <EuiFlexItem style={{ minWidth: 70 }}><NumField label="vCPU" value={g.vcpu} onChange={(v) => setGroup(i, { vcpu: v ?? 0 })} /></EuiFlexItem>
              <EuiFlexItem style={{ minWidth: 90 }}><NumField label="Heap GB" value={g.heapGbOverride} optional placeholder="auto" onChange={(v) => setGroup(i, { heapGbOverride: v })} /></EuiFlexItem>
              <EuiFlexItem grow={false}>
                <EuiButtonIcon iconType="trash" color="danger" aria-label="Remove node group" onClick={() => onChange({ ...value, groups: value.groups.filter((_, j) => j !== i) })} />
              </EuiFlexItem>
            </EuiFlexGroup>
          </EuiPanel>
          <EuiSpacer size="xs" />
        </div>
      ))}
      <EuiSpacer size="s" />
      <EuiFlexGrid columns={3} gutterSize="none">
        <EuiFlexItem><SelectField label="Deployment model" value={value.model} options={MODELS} onChange={(model) => onChange({ ...value, model })} /></EuiFlexItem>
        <EuiFlexItem><NumField label="Sites" value={value.sites} optional step={1} placeholder="1" onChange={(sites) => onChange({ ...value, sites })} /></EuiFlexItem>
      </EuiFlexGrid>
      <EuiFlexGrid columns={3} gutterSize="none">
        <EuiFlexItem><SwitchField label="CCR" checked={value.ccr ?? false} onChange={(ccr) => onChange({ ...value, ccr })} /></EuiFlexItem>
        <EuiFlexItem><SwitchField label="Air-gapped" checked={value.airGapped ?? false} onChange={(airGapped) => onChange({ ...value, airGapped })} /></EuiFlexItem>
        <EuiFlexItem><SwitchField label="AutoOps / Cloud Connect" checked={value.autoOps ?? false} onChange={(autoOps) => onChange({ ...value, autoOps })} /></EuiFlexItem>
      </EuiFlexGrid>
      <EuiText size="xs" color="subdued"><p>N−1 applies: the largest node in each tier is removed before solving.</p></EuiText>
    </>
  );
}

export function SolveSettings({ value, onChange }: { value: ReverseRequest; onChange: (v: ReverseRequest) => void }) {
  const profiles = value.fixed.map((p) => ({ value: p.id, text: p.id }));
  return (
    <EuiFlexGrid columns={3} gutterSize="s">
      <EuiFlexItem><SelectField label="Solve for" value={value.solve} options={SOLVES} onChange={(solve) => onChange({ ...value, solve })} /></EuiFlexItem>
      <EuiFlexItem>
        <SelectField
          label="Target workload" value={value.targetProfileId ?? ''}
          options={[{ value: '', text: 'Auto (first matching)' }, ...profiles]}
          onChange={(id) => {
            const { targetProfileId: _drop, ...rest } = value;
            onChange(id ? { ...rest, targetProfileId: id } : rest);
          }}
        />
      </EuiFlexItem>
      {value.solve === 'max_retention' && (
        <EuiFlexItem>
          <SelectField label="Tier to extend" value={value.targetTier ?? 'hot'} options={TIERS} onChange={(targetTier) => onChange({ ...value, targetTier })} />
        </EuiFlexItem>
      )}
      <EuiFlexItem><SwitchField label="FIPS 140-3" checked={value.fips ?? false} onChange={(fips) => onChange({ ...value, fips })} /></EuiFlexItem>
      <EuiFlexItem><SwitchField label="Full LogsDB (Enterprise)" checked={value.fullLogsdb ?? false} onChange={(fullLogsdb) => onChange({ ...value, fullLogsdb })} /></EuiFlexItem>
      <EuiFlexItem><SwitchField label="Concurrent search load" checked={value.concurrentSearch ?? false} onChange={(concurrentSearch) => onChange({ ...value, concurrentSearch })} /></EuiFlexItem>
    </EuiFlexGrid>
  );
}
