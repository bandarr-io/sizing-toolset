import {
  EuiButton, EuiButtonIcon, EuiContextMenuItem, EuiContextMenuPanel, EuiFieldNumber, EuiPopover, EuiSelect, EuiSpacer, EuiText,
} from '@elastic/eui';
import { nodesPerServer, type DiskType, type NodeGroup, type ServerGroup } from '@sizing/engine';
import { useState } from 'react';
import { num, val, type MasterSizingRow } from '@sizing/constants';
import { useConstants } from '../constantsStore.tsx';
import { fmtNum } from '../format.ts';
import { dataNodesOfServers, GROUP_DEFAULTS, masterServers, withAutoMasters } from '../state.ts';
import { inRoleOrder, ROLE_LABEL, ROLE_ORDER, roleColor } from '../ui/tiers.ts';
import { DISK_TYPES, DISK_TYPES_HELP } from './NodeSizes.tsx';
import { AutoMastersNote, masterThreshold } from './AutoMastersNote.tsx';

const ROLES = ROLE_ORDER;
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
  const [autoMasters, setAutoMasters] = useState<MasterSizingRow | undefined>();
  const change = (next: typeof servers) => {
    const r = withAutoMasters(c, servers, next, (gs) => dataNodesOfServers(c, gs), (row) => masterServers(c, row));
    if (r.added) setAutoMasters(r.added);
    onChange(r.groups);
  };
  const [adding, setAdding] = useState(false);
  const set = (i: number, patch: Partial<ServerGroup>) => change(servers.map((g, j) => {
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
      <AutoMastersNote row={autoMasters} threshold={masterThreshold(val<MasterSizingRow[]>(c, 'masters.sizing'))} onDismiss={() => setAutoMasters(undefined)} />
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, minWidth: 590, tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: '21%' }} /><col style={{ width: '10%' }} /><col style={{ width: '12%' }} /><col style={{ width: '14%' }} />
            <col style={{ width: '14%' }} /><col style={{ width: '10%' }} /><col style={{ width: '14%' }} /><col style={{ width: 32 }} />
          </colgroup>
          <thead>
            <tr>
              <th style={head}>Role</th><th style={head}>Servers</th><th style={head}>Memory (GB)</th><th style={head}>Disk (GB)</th>
              <th style={head}>Disk type</th><th style={head}>Cores</th><th style={head}>Nodes / server</th><th />
            </tr>
          </thead>
          <tbody>
            {inRoleOrder(servers).map(({ g, i }) => {
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
                  <td style={cell}><EuiFieldNumber compressed aria-label="Server memory GB" value={g.ramGb} onChange={(e) => set(i, { ramGb: n(e.target.value) })} /></td>
                  <td style={cell}><EuiFieldNumber compressed aria-label="Server disk GB" value={g.diskGb} onChange={(e) => set(i, { diskGb: n(e.target.value) })} /></td>
                  <td style={cell}><EuiSelect compressed aria-label="Disk type" options={DISK_TYPES} value={g.diskType} onChange={(e) => set(i, { diskType: e.target.value as DiskType })} /></td>
                  <td style={cell}><EuiFieldNumber compressed aria-label="Server CPU cores" value={g.vcpu} onChange={(e) => set(i, { vcpu: n(e.target.value) })} /></td>
                  <td style={cell}>
                    <EuiFieldNumber compressed aria-label="Nodes per server" min={1} step={1} placeholder={`auto ${auto}`}
                      value={g.nodesPerServer ?? ''} isInvalid={!valid}
                      onChange={(e) => set(i, { nodesPerServer: e.target.value === '' ? undefined : Number(e.target.value) })} />
                  </td>
                  <td style={cell}>
                    <EuiButtonIcon iconType="trash" color="danger" aria-label={`Remove ${g.role} servers`} onClick={() => change(servers.filter((_, j) => j !== i))} />
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
                      {ok ? `${g.count * nps} nodes: ${nps} per server of ${fmtNum(g.ramGb / nps)} GB memory, ${fmtNum(g.diskGb / nps, 0)} GB disk, ${fmtNum(g.vcpu / nps, 1)} cores` : 'Nodes per server must be a whole number of at least 1'}
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
            <EuiContextMenuItem key={r} onClick={() => { change([...servers, newServer(r)]); setAdding(false); }}
              icon={<span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 5, background: roleColor(r) }} />}>
              {ROLE_LABEL[r]}
            </EuiContextMenuItem>
          ))} />
        </EuiPopover>
        <EuiText size="xs" color="subdued">
          {total} servers. A node is one running copy of Elasticsearch. Data servers get one node per {num(c, 'node_ram_practical_max_gb')} GB of memory. Master, frozen, machine learning, Kibana, Fleet and APM servers run one node each. One whole server per tier is kept spare in case another fails. {DISK_TYPES_HELP}
        </EuiText>
      </div>
    </>
  );
}
