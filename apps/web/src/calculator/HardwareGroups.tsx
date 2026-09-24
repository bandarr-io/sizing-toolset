import {
  EuiButton, EuiButtonEmpty, EuiButtonIcon, EuiCallOut, EuiContextMenuItem, EuiContextMenuPanel, EuiFieldNumber, EuiPopover, EuiSelect,
  EuiSpacer, EuiText,
} from '@elastic/eui';
import type { DiskType, NodeGroup, Solve } from '@sizing/engine';
import { useState } from 'react';
import { fmtNum } from '../format.ts';
import { newGroup } from '../state.ts';
import { ROLE_LABEL, roleColor } from '../ui/tiers.ts';
import { DISK_TYPES } from './NodeSizes.tsx';

const ROLES: NodeGroup['role'][] = ['hot', 'warm', 'cold', 'frozen', 'content', 'master', 'ml', 'coordinating', 'kibana', 'fleet', 'apm'];
const DATA = new Set(['hot', 'warm', 'cold', 'frozen', 'content']);
const cell = { padding: '6px 6px' } as const;
const head = { ...cell, textAlign: 'left' as const, fontWeight: 600, fontSize: 12, opacity: 0.75, whiteSpace: 'nowrap' as const };

/** Node groups as an editable table, with prompts for the group the chosen question depends on. */
export function HardwareGroups({ groups, onChange, solve }: { groups: NodeGroup[]; onChange: (g: NodeGroup[]) => void; solve: Solve }) {
  const [adding, setAdding] = useState(false);
  const [showHeap, setShowHeap] = useState(() => groups.some((g) => g.heapGbOverride !== undefined));
  const set = (i: number, patch: Partial<NodeGroup>) => onChange(groups.map((g, j) => {
    if (j !== i) return g;
    const next = { ...g, ...patch } as NodeGroup & Record<string, unknown>;
    if (next.heapGbOverride === undefined) delete next.heapGbOverride;
    return next;
  }));
  const add = (role: NodeGroup['role']) => { onChange([...groups, newGroup(role)]); setAdding(false); };
  const n = (s: string) => (s === '' ? 0 : Number(s));

  const dataNodes = groups.filter((g) => DATA.has(g.role)).reduce((s, g) => s + g.count, 0);
  const ram = groups.reduce((s, g) => s + g.count * g.ramGb, 0);
  const has = (r: NodeGroup['role']) => groups.some((g) => g.role === r && g.count > 0);

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
              <th style={head}>Role</th><th style={head}>Nodes</th><th style={head}>RAM</th><th style={head}>Disk</th>
              <th style={head}>Disk type</th><th style={head}>vCPU</th>{showHeap && <th style={head}>Heap</th>}<th />
            </tr>
          </thead>
          <tbody>
            {groups.map((g, i) => (
              <tr key={i}>
                <td style={{ ...cell, minWidth: 130 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 5, background: roleColor(g.role), flex: 'none' }} />
                    <EuiSelect compressed aria-label="Role" value={g.role} options={ROLES.map((r) => ({ value: r, text: ROLE_LABEL[r] }))}
                      onChange={(e) => set(i, { role: e.target.value as NodeGroup['role'] })} />
                  </div>
                </td>
                <td style={{ ...cell, width: 80 }}><EuiFieldNumber compressed aria-label="Nodes" min={0} value={g.count} onChange={(e) => set(i, { count: n(e.target.value) })} /></td>
                <td style={cell}><EuiFieldNumber compressed aria-label="RAM GB" append="GB" value={g.ramGb} onChange={(e) => set(i, { ramGb: n(e.target.value) })} /></td>
                <td style={cell}><EuiFieldNumber compressed aria-label="Disk GB" append="GB" value={g.diskGb} onChange={(e) => set(i, { diskGb: n(e.target.value) })} /></td>
                <td style={{ ...cell, width: 100 }}><EuiSelect compressed aria-label="Disk type" options={DISK_TYPES} value={g.diskType} onChange={(e) => set(i, { diskType: e.target.value as DiskType })} /></td>
                <td style={{ ...cell, width: 80 }}><EuiFieldNumber compressed aria-label="vCPU" value={g.vcpu} onChange={(e) => set(i, { vcpu: n(e.target.value) })} /></td>
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
