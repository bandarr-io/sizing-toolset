import {
  EuiBadge, EuiButtonEmpty, EuiFlexGroup, EuiFlexItem, EuiFlyout, EuiFlyoutBody, EuiFlyoutHeader, EuiHorizontalRule, EuiIcon, EuiPanel,
  EuiProgress, EuiSpacer, EuiText, EuiTitle, EuiToolTip,
} from '@elastic/eui';
import type { RoleFit, SiteRelationship, SiteResult, TopologyResult } from '@sizing/engine';
import { useState } from 'react';
import { MathButton } from '../components/MathFlyout.tsx';
import { ConstraintPanel, NodeTable, WarningsPanel } from '../components/Results.tsx';
import { fmtNum, fmtStorage } from '../format.ts';
import { RELATIONSHIPS } from '../state.ts';
import { ROLE_LABEL, roleColor } from '../ui/tiers.ts';
import { PIN_TOP, useFitsViewport } from './ResultsPanel.tsx';

const STATUS: Record<RoleFit['status'], { color: string; text: string }> = {
  ok: { color: 'success', text: 'fits' },
  short: { color: 'danger', text: 'not enough' },
  missing: { color: 'danger', text: 'no servers' },
  unplaced: { color: 'hollow', text: 'not placed' },
  idle: { color: 'hollow', text: 'unused' },
};

function scaleText(scale: number): string {
  if (!Number.isFinite(scale)) return 'Not limited by these servers';
  if (scale === 0) return 'Does not fit, whatever the data volume';
  if (scale >= 1) return `Room for ${fmtNum(scale, 2)}× today's data volume`;
  return `Holds ${fmtNum(scale * 100, 0)}% of today's data volume`;
}

export function FitRow({ f }: { f: RoleFit }) {
  const label = ROLE_LABEL[f.role as keyof typeof ROLE_LABEL] ?? f.role;
  const measurable = f.status === 'ok' || f.status === 'short';
  const u = f.availableServers > 0 ? f.neededServers / f.availableServers : 1;
  return (
    <EuiFlexGroup gutterSize="s" alignItems="center" responsive={false} style={{ padding: '4px 0' }}>
      <EuiFlexItem grow={false} style={{ width: 120 }}>
        <EuiText size="s"><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 5, background: roleColor(f.role), marginRight: 8 }} />{label}</EuiText>
      </EuiFlexItem>
      <EuiFlexItem style={{ minWidth: 80 }}>
        {measurable ? <EuiProgress value={Math.min(u, 1) * 100} max={100} size="s" color={f.fits ? 'primary' : 'danger'} /> : <span />}
      </EuiFlexItem>
      <EuiFlexItem grow={false} style={{ width: 150, textAlign: 'right' }}>
        <EuiText size="xs">
          {f.status === 'idle' ? `${f.availableServers} servers`
            : f.nodesPerServer === 0 ? 'node larger than these servers'
            : f.status === 'short' && f.neededServers <= f.availableServers ? `${f.availableServers} servers, too small`
            : `${f.neededServers} of ${f.availableServers} servers`}
          {f.nodesPerServer > 1 && <span style={{ opacity: 0.7 }}> ({f.nodesPerServer} nodes each)</span>}
        </EuiText>
      </EuiFlexItem>
      <EuiFlexItem grow={false} style={{ width: 80 }}><EuiBadge color={STATUS[f.status].color}>{STATUS[f.status].text}</EuiBadge></EuiFlexItem>
      <EuiFlexItem grow={false}><MathButton title={`${label} servers`} steps={f.math} /></EuiFlexItem>
    </EuiFlexGroup>
  );
}

function SiteCard({ s, onDetails }: { s: SiteResult; onDetails: () => void }) {
  const followed = s.holds.filter((h) => h.includes(': '));
  return (
    <EuiPanel hasBorder paddingSize="m">
      <EuiFlexGroup alignItems="center" gutterSize="s" responsive={false}>
        <EuiFlexItem><EuiTitle size="xs"><h3>{s.name}</h3></EuiTitle></EuiFlexItem>
        <EuiFlexItem grow={false}><EuiBadge color={s.fits ? 'success' : 'danger'}>{s.fits ? 'fits' : 'needs more servers'}</EuiBadge></EuiFlexItem>
        <EuiFlexItem grow={false}><EuiButtonEmpty size="xs" onClick={onDetails}>Details</EuiButtonEmpty></EuiFlexItem>
      </EuiFlexGroup>
      <EuiText size="xs" color="subdued">
        Holds {s.holds.length ? s.holds.join(', ') : 'no data'}{followed.length ? ` (${followed.length} copied from another site)` : ''} · {fmtNum(s.result.totalRamGb)} GB memory needed · {s.license.eru} license units
      </EuiText>
      <EuiSpacer size="s" />
      {s.fit.map((f) => <FitRow key={f.role} f={f} />)}
    </EuiPanel>
  );
}

export function TopologyPanel({ result, compare, onPick, modelName }: {
  result: TopologyResult;
  /** All three relationships, when comparing. */
  compare?: Partial<Record<SiteRelationship, TopologyResult>>;
  onPick: (r: SiteRelationship) => void;
  /** D34: the host model the sites are sized under. */
  modelName?: string;
}) {
  const { ref, fits } = useFitsViewport<HTMLDivElement>();
  const [details, setDetails] = useState<number | undefined>();
  const [assumptionsOpen, setAssumptionsOpen] = useState(false);
  const h = result.headroom;
  const site = details !== undefined ? result.sites[details] : undefined;

  return (
    <div ref={ref} style={fits ? { position: 'sticky', top: PIN_TOP } : undefined}>
      <EuiPanel hasBorder paddingSize="l">
        <EuiText size="s" color="subdued">{RELATIONSHIPS.find((r) => r.value === result.relationship)?.title} · {result.sites.length} sites{modelName ? ` · ${modelName}` : ''}</EuiText>
        <EuiFlexGroup gutterSize="s" alignItems="center" responsive={false}>
          <EuiFlexItem grow={false}><EuiIcon type={result.fitsAll ? 'checkCircleFill' : 'error'} color={result.fitsAll ? 'success' : 'danger'} size="l" /></EuiFlexItem>
          <EuiFlexItem><EuiTitle size="m"><h2>{result.fitsAll ? 'Fits on these servers' : 'Needs more servers'}</h2></EuiTitle></EuiFlexItem>
        </EuiFlexGroup>
        {h && (
          <EuiFlexGroup gutterSize="xs" alignItems="center" responsive={false}>
            <EuiFlexItem grow={false}>
              <EuiText size="s">{scaleText(h.scale)}{h.binding ? ` · ${h.binding.site} ${ROLE_LABEL[h.binding.role as keyof typeof ROLE_LABEL] ?? h.binding.role} runs out first` : ''}</EuiText>
            </EuiFlexItem>
            <EuiFlexItem grow={false}><MathButton title="Headroom" steps={h.math} /></EuiFlexItem>
          </EuiFlexGroup>
        )}
        <EuiHorizontalRule margin="m" />
        <EuiFlexGroup gutterSize="l" wrap responsive={false}>
          {[
            ['Servers needed', `${result.totals.neededServers} of ${result.totals.availableServers}`, 'Servers used across all sites. This includes one spare per role, in case a server fails.'],
            ['Memory needed', `${fmtNum(result.totals.ramGb)} GB`, 'Total across every site'],
            ['License units', `${result.totals.eru} ERU`, 'An ERU (Enterprise Resource Unit) is the unit Elastic licenses by, a block of memory. Each site is a separate cluster with its own license; this is the total.'],
            ...(result.totals.objectStorageGb > 0 ? [['Object storage', fmtStorage(result.totals.objectStorageGb), 'Cheap bulk storage (such as S3) holding the cold and frozen data, all sites']] : []),
          ].map(([label, value, hint]) => (
            <EuiFlexItem key={label} style={{ minWidth: 110 }}>
              <EuiText size="xs" color="subdued">{label}</EuiText>
              <EuiToolTip content={hint}><EuiTitle size="s"><span>{value}</span></EuiTitle></EuiToolTip>
            </EuiFlexItem>
          ))}
        </EuiFlexGroup>
      </EuiPanel>

      {compare && (
        <>
          <EuiSpacer size="s" />
          <EuiPanel hasBorder paddingSize="m">
            <EuiTitle size="xxs"><h3>Compare site setups</h3></EuiTitle>
            <EuiSpacer size="s" />
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ fontSize: 12, opacity: 0.75, textAlign: 'left' }}>
                  <th style={{ padding: 4 }}>Setup</th><th style={{ padding: 4 }}>Fits</th><th style={{ padding: 4 }}>Spare room</th><th style={{ padding: 4, textAlign: 'right' }}>Servers</th><th style={{ padding: 4, textAlign: 'right' }}>License units</th>
                </tr>
              </thead>
              <tbody>
                {RELATIONSHIPS.map((rel) => {
                  const t = compare[rel.value];
                  const selected = rel.value === result.relationship;
                  return (
                    <tr key={rel.value} onClick={() => onPick(rel.value)} style={{ cursor: 'pointer', background: selected ? 'rgba(11,100,221,0.08)' : undefined }}>
                      <td style={{ padding: 4 }}><EuiText size="s">{selected ? <strong>{rel.title}</strong> : rel.title}</EuiText></td>
                      <td style={{ padding: 4 }}>{t ? <EuiBadge color={t.fitsAll ? 'success' : 'danger'}>{t.fitsAll ? 'yes' : 'no'}</EuiBadge> : '–'}</td>
                      <td style={{ padding: 4 }}><EuiText size="s">{t?.headroom ? (Number.isFinite(t.headroom.scale) ? `${fmtNum(t.headroom.scale, 2)}×` : 'unlimited') : '–'}</EuiText></td>
                      <td style={{ padding: 4, textAlign: 'right' }}><EuiText size="s">{t ? `${t.totals.neededServers} / ${t.totals.availableServers}` : '–'}</EuiText></td>
                      <td style={{ padding: 4, textAlign: 'right' }}><EuiText size="s">{t ? t.totals.eru : '–'}</EuiText></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </EuiPanel>
        </>
      )}

      {result.sites.map((s, i) => (
        <div key={i}><EuiSpacer size="s" /><SiteCard s={s} onDetails={() => setDetails(i)} /></div>
      ))}

      <EuiSpacer size="s" />
      <EuiPanel color="warning" paddingSize="s" hasShadow={false}>
        <EuiFlexGroup gutterSize="s" alignItems="center" responsive={false}>
          <EuiFlexItem><EuiText size="xs"><strong>Estimate, not benchmark.</strong> Disk space figures are dependable. Processor, search speed and machine learning figures are rough, so test them with Rally, Elastic's benchmarking tool.</EuiText></EuiFlexItem>
          <EuiFlexItem grow={false}><EuiButtonEmpty size="xs" onClick={() => setAssumptionsOpen(true)}>{result.assumptions.length} assumptions</EuiButtonEmpty></EuiFlexItem>
        </EuiFlexGroup>
      </EuiPanel>

      {site && (
        <EuiFlyout onClose={() => setDetails(undefined)} size="m" ownFocus aria-labelledby="site-title">
          <EuiFlyoutHeader hasBorder><EuiTitle size="s"><h2 id="site-title">{site.name}</h2></EuiTitle></EuiFlyoutHeader>
          <EuiFlyoutBody>
            <EuiTitle size="xxs"><h3>Nodes this site needs</h3></EuiTitle>
            <EuiSpacer size="s" />
            <NodeTable r={site.result} />
            <EuiSpacer size="l" />
            <EuiTitle size="xxs"><h3>How full each resource is</h3></EuiTitle>
            <EuiSpacer size="s" />
            <ConstraintPanel r={site.result} />
            <EuiSpacer size="l" />
            <EuiTitle size="xxs"><h3>Hardware checks</h3></EuiTitle>
            <EuiSpacer size="s" />
            <WarningsPanel warnings={site.result.warnings} />
          </EuiFlyoutBody>
        </EuiFlyout>
      )}
      {assumptionsOpen && (
        <EuiFlyout onClose={() => setAssumptionsOpen(false)} size="s" ownFocus aria-labelledby="ms-assumptions">
          <EuiFlyoutHeader hasBorder><EuiTitle size="s"><h2 id="ms-assumptions">Assumptions</h2></EuiTitle></EuiFlyoutHeader>
          <EuiFlyoutBody>
            <EuiText size="s">
              <ul>{[...result.assumptions, ...(result.sites[0]?.result.assumptions ?? [])].map((a, i) => <li key={i}>{a}</li>)}</ul>
            </EuiText>
          </EuiFlyoutBody>
        </EuiFlyout>
      )}
    </div>
  );
}
