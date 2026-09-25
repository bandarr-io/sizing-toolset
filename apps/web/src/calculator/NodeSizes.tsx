import { EuiButtonEmpty, EuiFieldNumber, EuiFlexGroup, EuiFlexItem, EuiIcon, EuiPanel, EuiSelect, EuiSpacer, EuiText } from '@elastic/eui';
import { num } from '@sizing/constants';
import type { DiskType, ForwardOptions, NodeTemplate, SizingResult, Tier } from '@sizing/engine';
import { fmtStorage } from '../format.ts';
import { useConstants } from '../constantsStore.tsx';
import { TIER_COLOR, TIER_LABEL } from '../ui/tiers.ts';

/** Local disk only: cold and frozen data in object storage is its own line item (D26), not a node disk type. */
export const DISK_TYPES: { value: DiskType; text: string }[] = [
  { value: 'nvme', text: 'NVMe' }, { value: 'ssd', text: 'SSD' }, { value: 'hdd', text: 'HDD' },
];

const cell = { padding: '6px 8px' } as const;
const head = { ...cell, textAlign: 'left' as const, fontWeight: 600, fontSize: 12, opacity: 0.75 };

/** Node template per tier in use. Empty cells fall back to the constants shown as placeholders. */
export function NodeSizes({ tiers, value, onChange, objectStorage }: {
  tiers: Tier[]; value: ForwardOptions; onChange: (o: ForwardOptions) => void;
  /** From the current result; shown whenever cold or frozen holds data. */
  objectStorage?: SizingResult['objectStorage'];
}) {
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
          <tr><th style={head}>Tier</th><th style={{ ...head, width: '17%' }}>RAM per node</th><th style={{ ...head, width: '16%' }}>Mem:disk</th><th style={{ ...head, width: '21%' }}>Disk per node</th><th style={{ ...head, width: '11%' }}>vCPU</th><th style={{ ...head, width: 110 }}>Disk type</th></tr>
        </thead>
        <tbody>
          {tiers.map((t) => {
            const n = value.nodes?.[t] ?? {};
            const ram = n.ramGb ?? defRam;
            const defaultRatio = num(c, `mem_disk.${t}`);
            const ratio = n.memDiskRatio ?? defaultRatio;
            const diskDefault = ram * (t === 'frozen' ? num(c, 'mem_disk.hot') : ratio);
            return (
              <tr key={t}>
                <td style={cell}>
                  <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 5, background: TIER_COLOR[t], marginRight: 8 }} />
                  <strong>{TIER_LABEL[t]}</strong>
                  <EuiText size="xs" color="subdued">{t === 'frozen' ? 'GB searchable per GB RAM' : 'GB disk per GB RAM'}</EuiText>
                </td>
                <td style={cell}><EuiFieldNumber compressed aria-label={`${t} RAM`} append="GB" placeholder={String(defRam)} value={n.ramGb ?? ''} onChange={(e) => setNode(t, { ramGb: numOrUndef(e.target.value) })} /></td>
                <td style={cell}>
                  <EuiFieldNumber compressed aria-label={`${t} mem:disk ratio`} prepend="1:" min={0} placeholder={String(defaultRatio)} value={n.memDiskRatio ?? ''}
                    isInvalid={n.memDiskRatio !== undefined && !(n.memDiskRatio > 0)}
                    onChange={(e) => setNode(t, { memDiskRatio: numOrUndef(e.target.value) })} />
                </td>
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
      {(objectStorage || value.objectStorageGb !== undefined) && (
        <>
          <EuiSpacer size="m" />
          <EuiPanel color="subdued" paddingSize="m" hasShadow={false}>
            <EuiFlexGroup gutterSize="m" alignItems="center" wrap responsive={false}>
              <EuiFlexItem grow={false}><EuiIcon type="storage" size="l" /></EuiFlexItem>
              <EuiFlexItem style={{ minWidth: 220 }}>
                <EuiText size="s"><strong>Object storage</strong> (snapshot repository)</EuiText>
                <EuiText size="xs" color="subdued">
                  Added automatically for cold and frozen searchable snapshots: one copy of their data.
                  {objectStorage && <> Calculated: <strong>{fmtStorage(objectStorage.calculatedGb)}</strong>.</>}
                </EuiText>
              </EuiFlexItem>
              <EuiFlexItem grow={false} style={{ width: 200 }}>
                <EuiFieldNumber compressed aria-label="Object storage size" append="GB" min={0}
                  placeholder={objectStorage ? String(Math.round(objectStorage.calculatedGb)) : '0'}
                  value={value.objectStorageGb ?? ''} isInvalid={value.objectStorageGb !== undefined && !(value.objectStorageGb >= 0)}
                  onChange={(e) => {
                    const { objectStorageGb: _drop, ...rest } = value;
                    onChange(e.target.value === '' ? rest : { ...rest, objectStorageGb: Number(e.target.value) });
                  }} />
              </EuiFlexItem>
              {value.objectStorageGb !== undefined && (
                <EuiFlexItem grow={false}>
                  <EuiButtonEmpty size="xs" iconType="refresh" onClick={() => { const { objectStorageGb: _drop, ...rest } = value; onChange(rest); }}>Use calculated</EuiButtonEmpty>
                </EuiFlexItem>
              )}
            </EuiFlexGroup>
          </EuiPanel>
        </>
      )}
    </>
  );
}
