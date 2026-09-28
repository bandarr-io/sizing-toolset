import { EuiButtonEmpty, EuiFieldNumber, EuiFlexGroup, EuiFlexItem, EuiFormRow, EuiIcon, EuiPanel, EuiSelect, EuiSpacer, EuiText, EuiToolTip } from '@elastic/eui';
import { num, type ConstantSet } from '@sizing/constants';
import type { DiskType, ForwardOptions, NodeTemplate, SizingResult, Tier } from '@sizing/engine';
import { fmtNum, fmtStorage } from '../format.ts';
import { useConstants } from '../constantsStore.tsx';
import { defaultDiskType } from '../state.ts';
import { TIER_COLOR, TIER_LABEL } from '../ui/tiers.ts';

/** Local disk only: cold and frozen data in object storage is its own line item (D26), not a node disk type. */
/** The select shows short names; this line says what they mean. */
export const DISK_TYPES_HELP = 'Disk types: NVMe is the fastest, SSD is fast, HDD is a slow spinning disk.';

export const DISK_TYPES: { value: DiskType; text: string }[] = [
  { value: 'nvme', text: 'NVMe' }, { value: 'ssd', text: 'SSD' }, { value: 'hdd', text: 'HDD' },
];

const cell = { padding: '6px 8px' } as const;
const head = { ...cell, textAlign: 'left' as const, fontWeight: 600, fontSize: 12, opacity: 0.75 };

/** D27: share of frozen data kept in local cache, edited as a percent and stored as a fraction. */
export function CacheFractionField({ value, onChange, prepend }: { value: number | undefined; onChange: (v: number | undefined) => void; prepend?: string }) {
  const { set: c } = useConstants();
  return (
    <EuiFieldNumber compressed fullWidth aria-label="frozen cache share" append="%" min={0} max={100}
      {...(prepend ? { prepend } : {})}
      placeholder={String(num(c, 'frozen_cache_fraction') * 100)}
      value={value === undefined ? '' : +(value * 100).toFixed(4)}
      isInvalid={value !== undefined && !(value > 0 && value <= 1)}
      onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value) / 100)} />
  );
}

/** The tier that takes ingest, as the engine picks it: hot, else content. Only its write speed is used (D28). */
export function ingestTierOf(tiers: readonly string[]): 'hot' | 'content' | undefined {
  return tiers.includes('hot') ? 'hot' : tiers.includes('content') ? 'content' : undefined;
}
export const DISK_WRITE_HELP = 'How fast each node can write to disk, in MB per second. Adds a disk speed check. Rough estimate; test with Rally, Elastic\'s benchmarking tool.';

/** D28: per-node disk write speed on an ingest tier. Blank means no disk write constraint. */
export function DiskWriteField({ tier, value, onChange }: { tier: string; value: number | undefined; onChange: (v: number | undefined) => void }) {
  return (
    <EuiFieldNumber compressed fullWidth aria-label={`${tier} disk write MB/s`} min={1} placeholder="–"
      value={value ?? ''} isInvalid={value !== undefined && !(value >= 1)}
      onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))} />
  );
}

/** True when no tier template (including disk write speed), cache fraction or object storage size is set for this scenario. */
export function isDefaultNodeSizes(o: ForwardOptions): boolean {
  return Object.values(o.nodes ?? {}).every((n) => Object.keys(n ?? {}).length === 0)
    && o.frozenCacheFraction === undefined && o.objectStorageGb === undefined;
}

/** One line for the folded step. */
export function nodeSizesSummary(c: ConstantSet, tiers: Tier[], objectStorage?: SizingResult['objectStorage']): string {
  const ram = num(c, 'node_ram_default_gb');
  const parts = [`${fmtNum(ram)} GB memory, ${fmtNum(ram * num(c, 'vcpu_per_ram_gb'))} processor cores per node on ${tiers.map((t) => TIER_LABEL[t].toLowerCase()).join(', ') || 'no tiers yet'}`];
  if (objectStorage) parts.push(`${fmtStorage(objectStorage.gb)} of object storage`);
  return `Standard sizes: ${parts.join(' · ')}`;
}

/** Node template per tier in use. Empty cells fall back to the constants shown as placeholders. */
export function NodeSizes({ tiers, value, onChange, objectStorage }: {
  tiers: Tier[]; value: ForwardOptions; onChange: (o: ForwardOptions) => void;
  /** From the current result; shown whenever cold or frozen holds data. */
  objectStorage?: SizingResult['objectStorage'];
}) {
  const { set: c } = useConstants();
  const defRam = num(c, 'node_ram_default_gb');
  const customized = tiers.filter((t) => Object.keys(value.nodes?.[t] ?? {}).length > 0);
  const ingestTier = ingestTierOf(tiers);

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
          <tr>
            <th style={head}>Tier</th>
            <th style={{ ...head, width: '12%' }}>Memory (GB)</th>
            <th style={{ ...head, width: '15%' }}>{tiers.includes('frozen') ? 'Memory:disk · cache' : 'Memory:disk'}</th>
            <th style={{ ...head, width: '15%' }}>Disk (GB)</th>
            <th style={{ ...head, width: '9%' }}>Cores</th>
            <th style={{ ...head, width: 150 }}>Disk type</th>
            <th style={{ ...head, width: '14%' }}>
              <EuiToolTip content={DISK_WRITE_HELP}><span>Disk write (MB/s) <EuiIcon type="question" size="s" /></span></EuiToolTip>
            </th>
          </tr>
        </thead>
        <tbody>
          {tiers.map((t) => {
            const n = value.nodes?.[t] ?? {};
            const ram = n.ramGb ?? defRam;
            const isFrozen = t === 'frozen';
            // D27: frozen local disk comes from frozen_local_disk_ratio; the mem:disk ratio does not apply.
            const defaultRatio = num(c, isFrozen ? 'frozen_local_disk_ratio' : `mem_disk.${t}`);
            const ratio = isFrozen ? defaultRatio : n.memDiskRatio ?? defaultRatio;
            const diskDefault = ram * ratio;
            return (
              <tr key={t}>
                <td style={cell}>
                  <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 5, background: TIER_COLOR[t], marginRight: 8 }} />
                  <strong>{TIER_LABEL[t]}</strong>
                  <EuiText size="xs" color="subdued">{isFrozen ? 'Share of data kept on local disk' : 'GB of disk per GB of memory'}</EuiText>
                </td>
                <td style={cell}><EuiFieldNumber compressed aria-label={`${t} memory`} placeholder={String(defRam)} value={n.ramGb ?? ''} onChange={(e) => setNode(t, { ramGb: numOrUndef(e.target.value) })} /></td>
                <td style={cell}>
                  {isFrozen
                    ? <CacheFractionField value={value.frozenCacheFraction} onChange={(v) => {
                        const { frozenCacheFraction: _drop, ...rest } = value;
                        onChange(v === undefined ? rest : { ...rest, frozenCacheFraction: v });
                      }} />
                    : <EuiFieldNumber compressed aria-label={`${t} mem:disk ratio`} prepend="1:" min={0} placeholder={String(defaultRatio)} value={n.memDiskRatio ?? ''}
                        isInvalid={n.memDiskRatio !== undefined && !(n.memDiskRatio > 0)}
                        onChange={(e) => setNode(t, { memDiskRatio: numOrUndef(e.target.value) })} />}
                </td>
                <td style={cell}><EuiFieldNumber compressed aria-label={`${t} disk`} placeholder={String(diskDefault)} value={n.diskGb ?? ''} onChange={(e) => setNode(t, { diskGb: numOrUndef(e.target.value) })} /></td>
                <td style={cell}><EuiFieldNumber compressed aria-label={`${t} processor cores`} placeholder={String(ram * num(c, 'vcpu_per_ram_gb'))} value={n.vcpu ?? ''} onChange={(e) => setNode(t, { vcpu: numOrUndef(e.target.value) })} /></td>
                <td style={cell}>
                  <EuiSelect compressed aria-label={`${t} disk type`} options={DISK_TYPES}
                    value={n.diskType ?? defaultDiskType(t)} onChange={(e) => setNode(t, { diskType: e.target.value as DiskType })} />
                </td>
                <td style={cell}>
                  {t === ingestTier
                    ? <DiskWriteField tier={t} value={n.diskWriteMBps} onChange={(diskWriteMBps) => setNode(t, { diskWriteMBps })} />
                    : <EuiText size="xs" color="subdued" textAlign="center">–</EuiText>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <EuiText size="xs" color="subdued"><p>{DISK_TYPES_HELP}</p></EuiText>
      {(customized.length > 0 || value.frozenCacheFraction !== undefined) && (
        <EuiButtonEmpty size="xs" iconType="refresh" onClick={() => { const { frozenCacheFraction: _drop, ...rest } = value; onChange({ ...rest, nodes: {} }); }}>Reset to defaults</EuiButtonEmpty>
      )}
      {(objectStorage || value.objectStorageGb !== undefined) && (
        <>
          <EuiSpacer size="m" />
          <EuiPanel color="subdued" paddingSize="m" hasShadow={false}>
            <EuiFlexGroup gutterSize="m" alignItems="flexStart" wrap responsive={false}>
              <EuiFlexItem grow={false}><EuiIcon type="storage" size="l" /></EuiFlexItem>
              <EuiFlexItem style={{ minWidth: 220 }}>
                <EuiText size="s"><strong>Object storage</strong> (cheap bulk storage, such as S3)</EuiText>
                <EuiText size="s">
                  The cold and frozen tiers keep one copy of their data here
                  {objectStorage ? <>, calculated at <strong>{fmtStorage(objectStorage.calculatedGb)}</strong>.</> : '.'}
                </EuiText>
              </EuiFlexItem>
              <EuiFlexItem grow={false} style={{ width: 248 }}>
                <EuiFormRow label="Your own size" helpText={<span style={{ whiteSpace: 'nowrap' }}>Leave blank to use the calculated size.</span>} fullWidth style={{ marginBlockEnd: 0 }}>
                  <EuiFieldNumber compressed fullWidth aria-label="Object storage, your own size" append="GB" min={0}
                    placeholder={objectStorage ? String(Math.round(objectStorage.calculatedGb)) : '0'}
                    value={value.objectStorageGb ?? ''} isInvalid={value.objectStorageGb !== undefined && !(value.objectStorageGb >= 0)}
                    onChange={(e) => {
                      const { objectStorageGb: _drop, ...rest } = value;
                      onChange(e.target.value === '' ? rest : { ...rest, objectStorageGb: Number(e.target.value) });
                    }} />
                </EuiFormRow>
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
