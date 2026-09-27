import {
  EuiButton, EuiButtonIcon, EuiContextMenuItem, EuiContextMenuPanel, EuiFieldNumber, EuiPopover, EuiSelect, EuiSpacer, EuiText,
} from '@elastic/eui';
import { nodesPerServer, type DiskType, type NodeGroup, type ServerGroup } from '@sizing/engine';
import { useState } from 'react';
import { useConstants } from '../constantsStore.tsx';
import { fmtNum } from '../format.ts';
import { GROUP_DEFAULTS } from '../state.ts';
import { ROLE_LABEL, roleColor } from '../ui/tiers.ts';
import { DISK_TYPES } from './NodeSizes.tsx';

const ROLES: NodeGroup['role'][] = ['hot', 'warm', 'cold', 'frozen', 'content', 'master', 'ml', 'coordinating', 'kibana', 'fleet', 'apm'];
const cell = { padding: '6px 4px', verticalAlign: 'middle' as const };
const head = { ...cell, textAlign: 'left' as const, fontWeight: 600, fontSize: 12, opacity: 0.75, whiteSpace: 'nowrap' as const };

/** Starting spec for a new row: the node defaults scaled up to a typical 4-node data server. */
function newServer(role: NodeGroup['role']): ServerGroup {
  const d = GROUP_DEFAULTS[role];
  const data = ['hot', 'warm', 'cold', 'content'].includes(role);
  return data
    ? { role, count: d.count, ramGb: d.ramGb * 4, diskGb: d.diskGb * 4, diskType: d.diskType, vcpu: d.vcpu * 4 }
    : { role, count: d.count, ramGb: d.ramGb, diskGb: d.diskGb, diskType: d.diskType, vcpu: d.vcpu };
}

/** Physical servers at one site, one row per group of identical servers doing one role. */
export function ServerGroups({ servers, onChange }: { servers: ServerGroup[]; onChange: (s: ServerGroup[]) => void }) {
  const { set: c } = useConstants();
  const [adding, setAdding] = useState(false);
  const set = (i: number, patch: Partial<ServerGroup>) => onChange(servers.map((g, j) => {
    if (j !== i) return g;
    const next = { ...g, ...patch } as ServerGroup & Record<string, unknown>;
    if (next.nodesPerServer === undefined) delete next.nodesPerServer;
    return next;
  }));
  const n = (s: string) => (s === '' ? 0 : Number(s));
  // The automatic layout, ignoring any value typed in, so the placeholder always shows what blank means.
  const layout = (g: ServerGroup) => { const { nodesPerServer: _typed, ...auto } = g; return nodesPerServer(c, auto); };
  const total = servers.reduce((s, g) => s + g.count, 0);

  return (
    <>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, minWidth: 590, tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: '21%' }} /><col style={{ width: '10%' }} /><col style={{ width: '12%' }} /><col style={{ width: '14%' }} />
            <col style={{ width: '14%' }} /><col style={{ width: '10%' }} /><col style={{ width: '14%' }} /><col style={{ width: 32 }} />
          </colgroup>
          <thead>
            <tr>
              <th style={head}>Role</th><th style={head}>Servers</th><th style={head}>RAM (GB)</th><th style={head}>Disk (GB)</th>
              <th style={head}>Disk type</th><th style={head}>vCPU</th><th style={head}>Nodes / server</th><th />
            </tr>
          </thead>
          <tbody>
            {servers.map((g, i) => {
              const auto = layout(g);
              const nps = g.nodesPerServer ?? auto;
              const valid = Number.isInteger(nps) && nps >= 1;
              return (
                <tr key={i}>
                  <td style={cell}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ width: 10, height: 10, borderRadius: 5, background: roleColor(g.role), flex: 'none' }} />
                      <EuiSelect compressed aria-label="Role" value={g.role} options={ROLES.map((r) => ({ value: r, text: ROLE_LABEL[r] }))}
                        onChange={(e) => set(i, { role: e.target.value as NodeGroup['role'] })} />
                    </div>
                  </td>
                  <td style={cell}><EuiFieldNumber compressed aria-label="Servers" min={0} value={g.count} onChange={(e) => set(i, { count: n(e.target.value) })} /></td>
                  <td style={cell}><EuiFieldNumber compressed aria-label="Server RAM GB" value={g.ramGb} onChange={(e) => set(i, { ramGb: n(e.target.value) })} /></td>
                  <td style={cell}><EuiFieldNumber compressed aria-label="Server disk GB" value={g.diskGb} onChange={(e) => set(i, { diskGb: n(e.target.value) })} /></td>
                  <td style={cell}><EuiSelect compressed aria-label="Disk type" options={DISK_TYPES} value={g.diskType} onChange={(e) => set(i, { diskType: e.target.value as DiskType })} /></td>
                  <td style={cell}><EuiFieldNumber compressed aria-label="Server vCPU" value={g.vcpu} onChange={(e) => set(i, { vcpu: n(e.target.value) })} /></td>
                  <td style={cell}>
                    <EuiFieldNumber compressed aria-label="Nodes per server" min={1} step={1} placeholder={`auto ${auto}`}
                      value={g.nodesPerServer ?? ''} isInvalid={!valid}
                      onChange={(e) => set(i, { nodesPerServer: e.target.value === '' ? undefined : Number(e.target.value) })} />
                  </td>
                  <td style={cell}>
                    <EuiButtonIcon iconType="trash" color="danger" aria-label={`Remove ${g.role} servers`} onClick={() => onChange(servers.filter((_, j) => j !== i))} />
                  </td>
                </tr>
              );
            }).flatMap((row, i) => {
              const g = servers[i]!;
              const nps = g.nodesPerServer ?? layout(g);
              const ok = Number.isInteger(nps) && nps >= 1;
              return [row, (
                <tr key={`n${i}`}>
                  <td />
                  <td colSpan={7} style={{ padding: '0 6px 8px' }}>
                    <EuiText size="xs" color="subdued">
                      {ok ? `${g.count * nps} nodes: ${nps} per server of ${fmtNum(g.ramGb / nps)} GB RAM, ${fmtNum(g.diskGb / nps, 0)} GB disk, ${fmtNum(g.vcpu / nps, 1)} vCPU` : 'Nodes per server must be a whole number of at least 1'}
                    </EuiText>
                  </td>
                </tr>
              )];
            })}
          </tbody>
        </table>
      </div>
      <EuiSpacer size="s" />
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <EuiPopover isOpen={adding} closePopover={() => setAdding(false)} panelPaddingSize="none" anchorPosition="downLeft"
          button={<EuiButton size="s" color="text" iconType="plusCircle" onClick={() => setAdding(!adding)}>Add servers</EuiButton>}>
          <EuiContextMenuPanel items={ROLES.map((r) => (
            <EuiContextMenuItem key={r} onClick={() => { onChange([...servers, newServer(r)]); setAdding(false); }}
              icon={<span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 5, background: roleColor(r) }} />}>
              {ROLE_LABEL[r]}
            </EuiContextMenuItem>
          ))} />
        </EuiPopover>
        <EuiText size="xs" color="subdued">
          {total} servers. Nodes per server defaults to RAM ÷ 64 GB for data servers; masters, frozen, ML, Kibana, Fleet and APM run one per server. Failover reserves a whole server per tier.
        </EuiText>
      </div>
    </>
  );
}
