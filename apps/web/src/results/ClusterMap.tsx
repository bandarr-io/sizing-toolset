import { EuiFlexGroup, EuiFlexItem, EuiText, EuiToolTip } from '@elastic/eui';
import type { SizingResult } from '@sizing/engine';
import { fmtNum } from '../format.ts';
import { ROLE_LABEL, roleColor } from '../ui/tiers.ts';

const MAX_TILES = 72;

interface Row { key: string; role: string; count: number; ramGb: number; diskGb: number; vcpu: number; data: boolean; counted: boolean }

function Tiles({ count, color, failover }: { count: number; color: string; failover: boolean }) {
  const shown = Math.min(count, MAX_TILES);
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, alignItems: 'center' }}>
      {Array.from({ length: shown }, (_, i) => {
        const isFailover = failover && i === shown - 1 && count > 1;
        const tile = (
          <span key={i} style={{
            width: 14, height: 14, borderRadius: 3, display: 'inline-block',
            background: isFailover ? 'transparent' : color,
            border: isFailover ? `2px dashed ${color}` : `1px solid ${color}`,
            boxSizing: 'border-box',
          }} />
        );
        return isFailover ? <EuiToolTip key={i} content="Failover node (N+1): capacity is sized without it">{tile}</EuiToolTip> : tile;
      })}
      {count > MAX_TILES && <EuiText size="xs" color="subdued">+{count - MAX_TILES}</EuiText>}
    </div>
  );
}

/** The cluster at a glance: one tile per node, colored by tier; the failover node in each data tier is outlined. */
export function ClusterMap({ r }: { r: SizingResult }) {
  const rows: Row[] = [
    ...r.tiers.map((t, i) => ({ key: `t${i}`, role: t.tier, count: t.nodes, ramGb: t.ramGb, diskGb: t.diskGb, vcpu: t.vcpu, data: true, counted: true })),
    ...r.overhead.map((o, i) => ({ key: `o${i}`, role: o.role, count: o.count, ramGb: o.ramGb, diskGb: o.diskGb, vcpu: o.vcpu, data: false, counted: o.countsTowardLicense })),
  ].filter((x) => x.count > 0);

  return (
    <div>
      {rows.map((row) => (
        <EuiFlexGroup key={row.key} gutterSize="m" alignItems="center" responsive={false} style={{ padding: '3px 0' }}>
          <EuiFlexItem grow={false} style={{ width: 200, whiteSpace: 'nowrap' }}>
            <EuiText size="s">
              <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 5, background: roleColor(row.role), marginRight: 8 }} />
              <strong>{row.count}</strong> {ROLE_LABEL[row.role as keyof typeof ROLE_LABEL] ?? row.role}
            </EuiText>
            <EuiText size="xs" color="subdued" style={{ paddingLeft: 18 }}>
              {fmtNum(row.ramGb)} GB{row.diskGb ? ` · ${fmtNum(row.diskGb, 0)} GB` : ''} · {fmtNum(row.vcpu, 0)} vCPU{!row.counted && ' · unlicensed'}
            </EuiText>
          </EuiFlexItem>
          <EuiFlexItem><Tiles count={row.count} color={roleColor(row.role)} failover={row.data} /></EuiFlexItem>
        </EuiFlexGroup>
      ))}
    </div>
  );
}
