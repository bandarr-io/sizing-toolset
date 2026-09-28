import {
  EuiBadge, EuiButtonEmpty, EuiFlexGroup, EuiFlexItem, EuiFlyout, EuiFlyoutBody, EuiFlyoutHeader, EuiHorizontalRule, EuiIcon, EuiPanel,
  EuiSpacer, EuiText, EuiTitle,
} from '@elastic/eui';
import type { BestOn, HostModel, ModelRow } from '@sizing/engine';
import { useState } from 'react';
import { MathButton } from '../components/MathFlyout.tsx';
import { fmtNum } from '../format.ts';
import { MODEL_NAMES } from '../state.ts';
import { PIN_TOP, useFitsViewport } from './ResultsPanel.tsx';
import { FitRow } from './TopologyPanel.tsx';

const BEST_TEXT: Record<BestOn, string> = { eru: 'fewest license units', headroom: 'most spare room', servers: 'fewest servers' };

/** Under ECE the master-role servers are the control-plane hosts. */
const roleText = (r: ModelRow) => {
  const role = r.topology.headroom?.binding?.role ?? '';
  return r.model === 'ece' && role === 'master' ? 'the ECE management servers' : role;
};

const headroomText = (r: ModelRow) => {
  const s = r.topology.headroom?.scale;
  if (s === undefined) return '–';
  if (s === 0) return 'does not fit';
  return Number.isFinite(s) ? `${fmtNum(s, 2)}×` : 'unlimited';
};

/** D33: the same servers and workloads under each deployment model, as a trade-off table. */
export function ModelsPanel({ rows }: { rows: ModelRow[] }) {
  const { ref, fits } = useFitsViewport<HTMLDivElement>();
  const [selected, setSelected] = useState<HostModel>(() => rows.find((r) => r.best.length)?.model ?? 'self_managed');
  const [assumptionsOpen, setAssumptionsOpen] = useState(false);
  const row = rows.find((r) => r.model === selected) ?? rows[0]!;
  const site = row.topology.sites[0]!;
  const hot = site.fit.find((f) => f.role === 'hot');
  const cell = { padding: '6px 4px' } as const;

  return (
    <div ref={ref} style={fits ? { position: 'sticky', top: PIN_TOP } : undefined}>
      <EuiPanel hasBorder paddingSize="l">
        <EuiText size="s" color="subdued">Same servers, same workloads</EuiText>
        <EuiTitle size="m"><h2>Deployment models compared</h2></EuiTitle>
        <EuiSpacer size="m" />
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ fontSize: 12, opacity: 0.75, textAlign: 'left' }}>
              <th style={cell}>Model</th><th style={cell}>Fits</th><th style={{ ...cell, textAlign: 'right' }}>Spare room</th>
              <th style={{ ...cell, textAlign: 'right' }}>Servers</th><th style={{ ...cell, textAlign: 'right' }}>License units</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isSel = r.model === selected;
              const star = (k: BestOn) => (r.best.includes(k) ? <EuiIcon type="starFilled" color="success" size="s" aria-label={BEST_TEXT[k]} style={{ marginLeft: 4 }} /> : null);
              return (
                <tr key={r.model} onClick={() => setSelected(r.model)} style={{ cursor: 'pointer', background: isSel ? 'rgba(11,100,221,0.08)' : undefined }}>
                  <td style={cell}><EuiText size="s">{isSel ? <strong>{MODEL_NAMES[r.model]}</strong> : MODEL_NAMES[r.model]}</EuiText></td>
                  <td style={cell}><EuiBadge color={r.topology.fitsAll ? 'success' : 'danger'}>{r.topology.fitsAll ? 'yes' : 'no'}</EuiBadge></td>
                  <td style={{ ...cell, textAlign: 'right' }}><EuiText size="s">{headroomText(r)}{star('headroom')}</EuiText></td>
                  <td style={{ ...cell, textAlign: 'right' }}><EuiText size="s">{r.topology.totals.neededServers} / {r.topology.totals.availableServers}{star('servers')}</EuiText></td>
                  <td style={{ ...cell, textAlign: 'right' }}><EuiText size="s">{r.eru}{star('eru')}</EuiText></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <EuiSpacer size="s" />
        <EuiText size="xs" color="subdued">
          <EuiIcon type="starFilled" color="success" size="s" /> marks the best on that measure among the models that fit. There is no single winner: weigh license cost, spare room and what each model asks of your team.
          <br />Self-managed installs Elasticsearch directly on the servers. ECK runs it in containers managed by Kubernetes. ECE is Elastic's private-cloud platform, installed on your servers.
        </EuiText>
      </EuiPanel>

      <EuiSpacer size="s" />
      <EuiPanel hasBorder paddingSize="m">
        <EuiFlexGroup alignItems="center" gutterSize="s" responsive={false}>
          <EuiFlexItem><EuiTitle size="xs"><h3>{MODEL_NAMES[row.model]}</h3></EuiTitle></EuiFlexItem>
          {row.best.map((b) => <EuiFlexItem key={b} grow={false}><EuiBadge color="success">{BEST_TEXT[b]}</EuiBadge></EuiFlexItem>)}
        </EuiFlexGroup>
        <EuiText size="xs" color="subdued">
          {hot ? `${hot.nodesPerServer} Elasticsearch node${hot.nodesPerServer === 1 ? '' : 's'} per server for the newest (hot) data · ` : ''}
          {row.topology.headroom?.binding
            ? row.topology.headroom.scale === 0
              ? `${roleText(row)} cannot fit at any data volume · `
              : `${roleText(row)} runs out first · `
            : ''}
          {fmtNum(site.result.totalRamGb)} GB memory needed
        </EuiText>
        <EuiSpacer size="s" />
        {site.fit.map((f) => <FitRow key={f.role} f={f} />)}
        <EuiHorizontalRule margin="s" />
        <EuiFlexGroup gutterSize="xs" alignItems="center" responsive={false}>
          <EuiFlexItem grow={false}><EuiText size="s">License units: <strong>{row.eru} ERU</strong></EuiText></EuiFlexItem>
          <EuiFlexItem grow={false}><MathButton title={`${MODEL_NAMES[row.model]} license units`} steps={row.eruMath} /></EuiFlexItem>
        </EuiFlexGroup>
        <EuiSpacer size="s" />
        <EuiText size="xs"><ul style={{ marginBottom: 0 }}>{row.requirements.map((q, i) => <li key={i}>{q}</li>)}</ul></EuiText>
      </EuiPanel>

      <EuiSpacer size="s" />
      <EuiPanel color="warning" paddingSize="s" hasShadow={false}>
        <EuiFlexGroup gutterSize="s" alignItems="center" responsive={false}>
          <EuiFlexItem><EuiText size="xs"><strong>Estimate, not benchmark.</strong> ECK and ECE need some servers and memory for themselves. Those amounts are cautious defaults; change them in Configurations.</EuiText></EuiFlexItem>
          <EuiFlexItem grow={false}><EuiButtonEmpty size="xs" onClick={() => setAssumptionsOpen(true)}>Assumptions</EuiButtonEmpty></EuiFlexItem>
        </EuiFlexGroup>
      </EuiPanel>

      {assumptionsOpen && (
        <EuiFlyout onClose={() => setAssumptionsOpen(false)} size="s" ownFocus aria-labelledby="models-assumptions">
          <EuiFlyoutHeader hasBorder><EuiTitle size="s"><h2 id="models-assumptions">Assumptions</h2></EuiTitle></EuiFlyoutHeader>
          <EuiFlyoutBody>
            {rows.map((r) => (
              <EuiText size="s" key={r.model}><h4>{MODEL_NAMES[r.model]}</h4><ul>{r.topology.assumptions.slice(0, 3).map((a, i) => <li key={i}>{a}</li>)}</ul></EuiText>
            ))}
          </EuiFlyoutBody>
        </EuiFlyout>
      )}
    </div>
  );
}
