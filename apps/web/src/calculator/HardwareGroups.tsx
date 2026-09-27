import {
  EuiButton, EuiButtonEmpty, EuiButtonIcon, EuiCallOut, EuiContextMenuItem, EuiContextMenuPanel, EuiFieldNumber, EuiFlexGroup, EuiFlexItem,
  EuiIcon, EuiPopover, EuiSelect, EuiSpacer, EuiText, EuiToolTip,
} from '@elastic/eui';
import { num } from '@sizing/constants';
import type { DiskType, NodeGroup, Solve, Tier } from '@sizing/engine';
import { useConstants } from '../constantsStore.tsx';
import { useState } from 'react';
import { fmtNum } from '../format.ts';
import { newGroup } from '../state.ts';
import { ROLE_LABEL, TIER_LABEL, roleColor } from '../ui/tiers.ts';
import { CacheFractionField, DISK_TYPES, DISK_WRITE_HELP, DiskWriteField, ingestTierOf } from './NodeSizes.tsx';

const ROLES: NodeGroup['role'][] = ['hot', 'warm', 'cold', 'frozen', 'content', 'master', 'ml', 'coordinating', 'kibana', 'fleet', 'apm'];
const DATA = new Set(['hot', 'warm', 'cold', 'frozen', 'content']);
const cell = { padding: '6px 4px' } as const;
/** Short names so the role select never truncates; the add menu keeps the full names. */
const ROLE_SHORT: Partial<Record<NodeGroup['role'], string>> = { fleet: 'Fleet', coordinating: 'Coordinator' };
const head = { ...cell, textAlign: 'left' as const, fontWeight: 600, fontSize: 12, opacity: 0.75, whiteSpace: 'nowrap' as const };

/** Node groups as an editable table, with prompts for the group the chosen question depends on. */
export function HardwareGroups({ groups, onChange, solve, ratios, onRatios, cacheFraction, onCacheFraction }: {
  groups: NodeGroup[];
  onChange: (g: NodeGroup[]) => void;
  solve: Solve;
  /** D25: per-tier mem:disk ratio for this scenario; blank = constants. Frozen uses the cache fraction instead (D27). */
  ratios: Partial<Record<Tier, number>>;
  onRatios: (r: Partial<Record<Tier, number>>) => void;
  cacheFraction: number | undefined;
  onCacheFraction: (v: number | undefined) => void;
}) {
  const { set: c } = useConstants();
  const [adding, setAdding] = useState(false);
  const [showHeap, setShowHeap] = useState(() => groups.some((g) => g.heapGbOverride !== undefined));
  const set = (i: number, patch: Partial<NodeGroup>) => onChange(groups.map((g, j) => {
    if (j !== i) return g;
    const next = { ...g, ...patch } as NodeGroup & Record<string, unknown>;
    if (next.heapGbOverride === undefined) delete next.heapGbOverride;
    if (next.diskWriteMBps === undefined) delete next.diskWriteMBps;
    return next;
  }));
  const add = (role: NodeGroup['role']) => { onChange([...groups, newGroup(role, c)]); setAdding(false); };
  const n = (s: string) => (s === '' ? 0 : Number(s));

  const dataNodes = groups.filter((g) => DATA.has(g.role)).reduce((s, g) => s + g.count, 0);
  const ram = groups.reduce((s, g) => s + g.count * g.ramGb, 0);
  const has = (r: NodeGroup['role']) => groups.some((g) => g.role === r && g.count > 0);
  const ratioTiers = (['hot', 'warm', 'cold', 'content'] as Tier[]).filter((t) => groups.some((g) => g.role === t));
  const hasFrozen = groups.some((g) => g.role === 'frozen');
  const ingestTier = ingestTierOf(groups.filter((g) => g.count > 0).map((g) => g.role));
  const writeRow = groups.findIndex((g) => g.role === ingestTier && g.count > 0);

  return (
    <>
      {solve === 'max_agents' && !has('fleet') && (
        <><EuiCallOut size="s" iconType="info" title="This question needs Fleet Servers."><EuiButton size="s" onClick={() => add('fleet')}>Add Fleet Servers</EuiButton></EuiCallOut><EuiSpacer size="m" /></>
      )}
      {solve === 'max_ml_jobs' && !has('ml') && (
        <><EuiCallOut size="s" iconType="info" title="This question needs ML nodes."><EuiButton size="s" onClick={() => add('ml')}>Add ML nodes</EuiButton></EuiCallOut><EuiSpacer size="m" /></>
      )}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, minWidth: 560 }}>
          <thead>
            <tr>
              <th style={head}>Role</th><th style={head}>Nodes</th><th style={head}>RAM (GB)</th><th style={head}>Disk (GB)</th>
              {writeRow >= 0 && <th style={head}><EuiToolTip content={DISK_WRITE_HELP}><span>Write (MB/s) <EuiIcon type="question" size="s" /></span></EuiToolTip></th>}
              <th style={head}>Disk type</th><th style={head}>vCPU</th>{showHeap && <th style={head}>Heap</th>}<th />
            </tr>
          </thead>
          <tbody>
            {groups.map((g, i) => (
              <tr key={i}>
                <td style={{ ...cell, width: 140 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 5, background: roleColor(g.role), flex: 'none' }} />
                    <EuiSelect compressed aria-label="Role" value={g.role} options={ROLES.map((r) => ({ value: r, text: ROLE_SHORT[r] ?? ROLE_LABEL[r] }))}
                      onChange={(e) => set(i, { role: e.target.value as NodeGroup['role'] })} />
                  </div>
                </td>
                <td style={{ ...cell, width: 64 }}><EuiFieldNumber compressed aria-label="Nodes" min={0} value={g.count} onChange={(e) => set(i, { count: n(e.target.value) })} /></td>
                <td style={{ ...cell, width: 64 }}><EuiFieldNumber compressed aria-label="RAM GB" value={g.ramGb} onChange={(e) => set(i, { ramGb: n(e.target.value) })} /></td>
                <td style={cell}><EuiFieldNumber compressed aria-label="Disk GB" value={g.diskGb} onChange={(e) => set(i, { diskGb: n(e.target.value) })} /></td>
                {writeRow >= 0 && (
                  <td style={{ ...cell, width: 84 }}>
                    {i === writeRow
                      ? <DiskWriteField tier={g.role} value={g.diskWriteMBps} onChange={(diskWriteMBps) => set(i, { diskWriteMBps })} />
                      : <EuiText size="xs" color="subdued" textAlign="center">–</EuiText>}
                  </td>
                )}
                <td style={{ ...cell, width: 92 }}><EuiSelect compressed aria-label="Disk type" options={DISK_TYPES} value={g.diskType} onChange={(e) => set(i, { diskType: e.target.value as DiskType })} /></td>
                <td style={{ ...cell, width: 64 }}><EuiFieldNumber compressed aria-label="vCPU" value={g.vcpu} onChange={(e) => set(i, { vcpu: n(e.target.value) })} /></td>
                {showHeap && (
                  <td style={{ ...cell, width: 100 }}>
                    <EuiFieldNumber compressed aria-label="Heap GB" placeholder="auto" value={g.heapGbOverride ?? ''}
                      onChange={(e) => set(i, { heapGbOverride: e.target.value === '' ? undefined : Number(e.target.value) })} />
                  </td>
                )}
                <td style={{ ...cell, width: 32 }}>
                  <EuiButtonIcon iconType="trash" color="danger" aria-label={`Remove ${g.role} group`} onClick={() => onChange(groups.filter((_, j) => j !== i))} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(ratioTiers.length > 0 || hasFrozen) && (
        <>
          <EuiSpacer size="m" />
          <EuiFlexGroup gutterSize="m" alignItems="center" wrap responsive={false}>
            <EuiFlexItem grow={false}>
              <EuiText size="xs"><strong>Tier ratios</strong><br /><span style={{ opacity: 0.7 }}>Blank uses the default</span></EuiText>
            </EuiFlexItem>
            {ratioTiers.map((t) => {
              const v = ratios[t];
              return (
                <EuiFlexItem grow={false} key={t} style={{ width: 150 }}>
                  <EuiFieldNumber compressed aria-label={`${t} mem:disk ratio`} min={0}
                    prepend={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '0 8px', fontSize: 12 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 4, background: roleColor(t) }} />{TIER_LABEL[t]} 1:</span>}
                    placeholder={String(num(c, `mem_disk.${t}`))} value={v ?? ''} isInvalid={v !== undefined && !(v > 0)}
                    onChange={(e) => {
                      const next = { ...ratios };
                      if (e.target.value === '') delete next[t]; else next[t] = Number(e.target.value);
                      onRatios(next);
                    }} />
                </EuiFlexItem>
              );
            })}
            {hasFrozen && (
              <EuiFlexItem grow={false} style={{ width: 200 }}>
                <CacheFractionField value={cacheFraction} onChange={onCacheFraction} prepend="Frozen cache" />
              </EuiFlexItem>
            )}
          </EuiFlexGroup>
        </>
      )}
      <EuiSpacer size="s" />
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <EuiPopover isOpen={adding} closePopover={() => setAdding(false)} panelPaddingSize="none" anchorPosition="downLeft"
          button={<EuiButton size="s" color="text" iconType="plusCircle" onClick={() => setAdding(!adding)}>Add node group</EuiButton>}>
          <EuiContextMenuPanel items={ROLES.map((r) => (
            <EuiContextMenuItem key={r} onClick={() => add(r)}
              icon={<span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 5, background: roleColor(r) }} />}>
              {ROLE_LABEL[r]}
            </EuiContextMenuItem>
          ))} />
        </EuiPopover>
        {!showHeap && <EuiButtonEmpty size="xs" onClick={() => setShowHeap(true)}>Heap overrides</EuiButtonEmpty>}
        <EuiText size="xs" color="subdued">{dataNodes} data nodes · {fmtNum(ram)} GB RAM · the largest node per tier is set aside for failover (N−1)</EuiText>
      </div>
    </>
  );
}
