import { EuiFlexGrid, EuiFlexItem, EuiPanel, EuiSpacer, EuiText, EuiTitle } from '@elastic/eui';
import { num } from '@sizing/constants';
import type { CcrMode, DiskType, ForwardOptions, NodeTemplate, Tier } from '@sizing/engine';
import { useConstants } from '../constantsStore.tsx';
import { MODELS } from '../state.ts';
import { Collapsible } from './Collapsible.tsx';
import { NumField, SelectField, SwitchField } from './Fields.tsx';

const CCR: { value: CcrMode; text: string }[] = [
  { value: 'none', text: 'None' }, { value: 'unidirectional', text: 'Unidirectional' }, { value: 'bidirectional', text: 'Bidirectional' },
];
export const DISK_TYPES: { value: DiskType; text: string }[] = [
  { value: 'nvme', text: 'NVMe' }, { value: 'ssd', text: 'SSD' }, { value: 'hdd', text: 'HDD' }, { value: 'object', text: 'Object' },
];
const TEMPLATE_TIERS: Tier[] = ['hot', 'warm', 'cold', 'frozen', 'content'];

export function ForwardOptionsEditor({ value, onChange }: { value: ForwardOptions; onChange: (v: ForwardOptions) => void }) {
  const set = (patch: Partial<ForwardOptions>) => onChange({ ...value, ...patch });
  const setNode = (t: Tier, patch: Partial<NodeTemplate>) => {
    const cur = { ...(value.nodes?.[t] ?? {}), ...patch } as Record<string, unknown>;
    for (const k of Object.keys(cur)) if (cur[k] === undefined) delete cur[k];
    set({ nodes: { ...(value.nodes ?? {}), [t]: cur as NodeTemplate } });
  };
  const { set: constants } = useConstants();
  const defRam = num(constants, 'node_ram_default_gb');
  return (
    <>
      <EuiTitle size="xs"><h3>Scenario options</h3></EuiTitle>
      <EuiSpacer size="s" />
      <EuiFlexGrid columns={3} gutterSize="s">
        <EuiFlexItem><SelectField label="Deployment model" value={value.model} options={MODELS} onChange={(model) => set({ model })} /></EuiFlexItem>
        <EuiFlexItem><NumField label="Sites" value={value.sites} optional step={1} placeholder="1" onChange={(sites) => set({ sites })} /></EuiFlexItem>
        <EuiFlexItem><SelectField label="CCR" value={value.ccrMode ?? 'none'} options={CCR} onChange={(ccrMode) => set({ ccrMode })} /></EuiFlexItem>
        <EuiFlexItem><NumField label="Coordinating nodes" value={value.coordinatingNodes} optional step={1} placeholder="0" onChange={(coordinatingNodes) => set({ coordinatingNodes })} /></EuiFlexItem>
        <EuiFlexItem><NumField label="Growth horizon" append="years" value={value.growthHorizonYears} optional placeholder="1" onChange={(growthHorizonYears) => set({ growthHorizonYears })} /></EuiFlexItem>
      </EuiFlexGrid>
      <EuiFlexGrid columns={3} gutterSize="none">
        <EuiFlexItem><SwitchField label="Air-gapped" checked={value.airGapped ?? false} onChange={(airGapped) => set({ airGapped })} /></EuiFlexItem>
        <EuiFlexItem><SwitchField label="AutoOps / Cloud Connect" checked={value.autoOps ?? false} onChange={(autoOps) => set({ autoOps })} /></EuiFlexItem>
        <EuiFlexItem><SwitchField label="FIPS 140-3" checked={value.fips ?? false} onChange={(fips) => set({ fips })} /></EuiFlexItem>
        <EuiFlexItem><SwitchField label="Full LogsDB (Enterprise)" checked={value.fullLogsdb ?? false} onChange={(fullLogsdb) => set({ fullLogsdb })} /></EuiFlexItem>
        <EuiFlexItem><SwitchField label="Concurrent search load" checked={value.concurrentSearch ?? false} onChange={(concurrentSearch) => set({ concurrentSearch })} /></EuiFlexItem>
      </EuiFlexGrid>
      <EuiSpacer size="s" />
      <Collapsible header={<EuiText size="s"><strong>Node sizes per tier</strong> (default {defRam} GB RAM, disk = RAM × tier ratio, vCPU = RAM / 8)</EuiText>}>
        <EuiFlexGrid columns={3} gutterSize="s">
          {TEMPLATE_TIERS.map((t) => {
            const n = value.nodes?.[t] ?? {};
            const ratio = num(constants, `mem_disk.${t}`);
            const ram = n.ramGb ?? defRam;
            return (
              <EuiFlexItem key={t}>
                <EuiPanel paddingSize="s" color="subdued">
                  <EuiText size="xs"><strong>{t}</strong> · 1:{ratio}</EuiText>
                  <NumField label="RAM" append="GB" value={n.ramGb} optional placeholder={`${defRam}`} onChange={(ramGb) => setNode(t, { ramGb })} />
                  <NumField label="Disk" append="GB" value={n.diskGb} optional placeholder={`${ram * (t === 'frozen' ? num(constants, 'mem_disk.hot') : ratio)}`} onChange={(diskGb) => setNode(t, { diskGb })} />
                  <NumField label="vCPU" value={n.vcpu} optional placeholder={`${ram * num(constants, 'vcpu_per_ram_gb')}`} onChange={(vcpu) => setNode(t, { vcpu })} />
                  <SelectField label="Disk type" value={n.diskType ?? (t === 'hot' || t === 'content' ? 'nvme' : 'ssd')} options={DISK_TYPES} onChange={(diskType) => setNode(t, { diskType })} />
                </EuiPanel>
              </EuiFlexItem>
            );
          })}
        </EuiFlexGrid>
      </Collapsible>
    </>
  );
}
