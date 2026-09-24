import { EuiButtonEmpty, EuiFieldNumber, EuiSelect, EuiText } from '@elastic/eui';
import { num } from '@sizing/constants';
import type { DiskType, ForwardOptions, NodeTemplate, Tier } from '@sizing/engine';
import { useConstants } from '../constantsStore.tsx';
import { TIER_COLOR, TIER_LABEL } from '../ui/tiers.ts';

export const DISK_TYPES: { value: DiskType; text: string }[] = [
  { value: 'nvme', text: 'NVMe' }, { value: 'ssd', text: 'SSD' }, { value: 'hdd', text: 'HDD' }, { value: 'object', text: 'Object' },
];

const cell = { padding: '6px 8px' } as const;
const head = { ...cell, textAlign: 'left' as const, fontWeight: 600, fontSize: 12, opacity: 0.75 };

/** Node template per tier in use. Empty cells fall back to the constants shown as placeholders. */
export function NodeSizes({ tiers, value, onChange }: { tiers: Tier[]; value: ForwardOptions; onChange: (o: ForwardOptions) => void }) {
  const { set: c } = useConstants();
  const defRam = num(c, 'node_ram_default_gb');
  const customized = tiers.filter((t) => Object.keys(value.nodes?.[t] ?? {}).length > 0);

  const setNode = (t: Tier, patch: Partial<NodeTemplate>) => {
    const cur = { ...(value.nodes?.[t] ?? {}), ...patch } as Record<string, unknown>;
    for (const k of Object.keys(cur)) if (cur[k] === undefined || cur[k] === '') delete cur[k];
    onChange({ ...value, nodes: { ...(value.nodes ?? {}), [t]: cur as NodeTemplate } });
  };
  const numOrUndef = (s: string) => (s === '' ? undefined : Number(s));

  if (tiers.length === 0) return <EuiText size="s" color="subdued"><p>Add a workload to size its tiers.</p></EuiText>;

  return (
    <>
      <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, tableLayout: 'fixed' }}>
        <thead>
          <tr><th style={head}>Tier</th><th style={{ ...head, width: '22%' }}>RAM per node</th><th style={{ ...head, width: '26%' }}>Disk per node</th><th style={{ ...head, width: '14%' }}>vCPU</th><th style={{ ...head, width: 120 }}>Disk type</th></tr>
        </thead>
        <tbody>
          {tiers.map((t) => {
            const n = value.nodes?.[t] ?? {};
            const ram = n.ramGb ?? defRam;
            const ratio = num(c, `mem_disk.${t}`);
            const diskDefault = ram * (t === 'frozen' ? num(c, 'mem_disk.hot') : ratio);
            return (
              <tr key={t}>
                <td style={cell}>
                  <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 5, background: TIER_COLOR[t], marginRight: 8 }} />
                  <strong>{TIER_LABEL[t]}</strong>
                  <EuiText size="xs" color="subdued">{t === 'frozen' ? `1:${ratio} object store` : `1:${ratio} mem:disk`}</EuiText>
                </td>
                <td style={cell}><EuiFieldNumber compressed aria-label={`${t} RAM`} append="GB" placeholder={String(defRam)} value={n.ramGb ?? ''} onChange={(e) => setNode(t, { ramGb: numOrUndef(e.target.value) })} /></td>
                <td style={cell}><EuiFieldNumber compressed aria-label={`${t} disk`} append="GB" placeholder={String(diskDefault)} value={n.diskGb ?? ''} onChange={(e) => setNode(t, { diskGb: numOrUndef(e.target.value) })} /></td>
                <td style={cell}><EuiFieldNumber compressed aria-label={`${t} vCPU`} placeholder={String(ram * num(c, 'vcpu_per_ram_gb'))} value={n.vcpu ?? ''} onChange={(e) => setNode(t, { vcpu: numOrUndef(e.target.value) })} /></td>
                <td style={cell}>
                  <EuiSelect compressed aria-label={`${t} disk type`} options={DISK_TYPES}
                    value={n.diskType ?? (t === 'hot' || t === 'content' ? 'nvme' : 'ssd')} onChange={(e) => setNode(t, { diskType: e.target.value as DiskType })} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {customized.length > 0 && (
        <EuiButtonEmpty size="xs" iconType="refresh" onClick={() => onChange({ ...value, nodes: {} })}>Reset to defaults</EuiButtonEmpty>
      )}
    </>
  );
}
