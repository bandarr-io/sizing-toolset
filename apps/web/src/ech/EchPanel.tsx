import { EuiBadge, EuiCallOut, EuiFlexGroup, EuiFlexItem, EuiHorizontalRule, EuiPanel, EuiSpacer, EuiText, EuiTitle } from '@elastic/eui';
import type { EchData, EchLine } from '@sizing/engine';
import { SwitchField } from '../components/Fields.tsx';
import { MathButton } from '../components/MathFlyout.tsx';
import { fmtMoney, fmtNum } from '../format.ts';
import { SeverityGroups } from '../components/Results.tsx';
import { Delta } from '../results/ResultsPanel.tsx';
import { echSentence, echSeverity } from '../results/summary.ts';
import { useDeltas } from '../results/useDeltas.ts';
import { echTotals, type EchOutcome } from './state.ts';

const cell = { padding: '6px 6px', verticalAlign: 'top' as const };
const head = { ...cell, textAlign: 'left' as const, fontWeight: 600, fontSize: 12, opacity: 0.75 };
const right = { ...cell, textAlign: 'right' as const };

function size(l: EchLine): string {
  if (l.nodesPerZone !== undefined && l.nodeSizeGb !== undefined && l.zones !== undefined) {
    return `${l.nodesPerZone} × ${fmtNum(l.nodeSizeGb)} GB × ${l.zones} zone${l.zones === 1 ? '' : 's'}`;
  }
  return l.ramGb !== undefined ? `${fmtNum(l.ramGb)} GB` : '';
}

/** Cost per year for each use case and in total, line by line, with the math behind every line. */
export function EchPanel({ data, outcomes, rounded, onRounded, from }: {
  data: EchData; outcomes: EchOutcome[]; rounded: boolean; onRounded: (v: boolean) => void; from: 'file' | 'upload' | undefined;
}) {
  const totals = echTotals(outcomes, rounded);
  const warnings = outcomes.flatMap((o) => ('result' in o ? o.result.warnings.map((w) => ({ severity: echSeverity(w), message: `${o.item.name}: ${w}` })) : []));
  const failed = outcomes.filter((o) => 'error' in o).length;
  const delta = useDeltas({ cost: totals.annual });
  return (
    <EuiPanel hasBorder paddingSize="l">
      <EuiText size="s" color="subdued"><p>Elastic Cloud Hosted, list price</p></EuiText>
      <EuiFlexGroup gutterSize="l" alignItems="baseline" responsive={false} wrap>
        <EuiFlexItem grow={false}>
          <EuiTitle size="l"><h2 style={{ color: '#0B64DD' }}>{fmtMoney(totals.annual)}<span style={{ fontSize: 16, fontWeight: 400 }}> a year</span></h2></EuiTitle>
        </EuiFlexItem>
        {delta('cost', 'money') && <EuiFlexItem grow={false}><div><Delta text={delta('cost', 'money')} /></div></EuiFlexItem>}
        <EuiFlexItem grow={false}><EuiText size="s"><p>{fmtMoney(totals.annual / 12)} a month · {fmtMoney(totals.y1)} in year one</p></EuiText></EuiFlexItem>
      </EuiFlexGroup>
      <EuiText size="s"><p style={{ margin: 0 }}>{echSentence(totals.annual, outcomes.length - failed, failed)}</p></EuiText>
      <EuiSpacer size="s" />
      <SwitchField label="Round each line up to $1,000, like the spreadsheet" checked={rounded} onChange={onRounded}
        helpText="Year one is lower because snapshot storage fills up over the retention period." />
      <EuiHorizontalRule margin="m" />

      {outcomes.map((o) => (
        <div key={o.item.id}>
          <EuiFlexGroup gutterSize="s" alignItems="baseline" responsive={false}>
            <EuiFlexItem><EuiTitle size="xs"><h3>{o.item.name}</h3></EuiTitle></EuiFlexItem>
            {'result' in o && <EuiFlexItem grow={false}><EuiText size="s"><strong>{fmtMoney(rounded ? o.result.totalRounded : o.result.total)}</strong></EuiText></EuiFlexItem>}
          </EuiFlexGroup>
          {'error' in o ? (
            <><EuiSpacer size="s" /><EuiCallOut size="s" color="danger" iconType="error" title={`Cannot price this yet: ${o.error}`} /></>
          ) : (
            <>
              {o.result.facts?.length ? (
                <EuiText size="xs" color="subdued"><p>{o.result.facts.map((f) => `${f.label} ${fmtNum(f.value, f.value < 100 ? 2 : 0)} ${f.unit}`).join(' · ')}</p></EuiText>
              ) : o.result.dailyGb > 0 ? (
                <EuiText size="xs" color="subdued"><p>{fmtNum(o.result.dailyGb, 1)} GB a day</p></EuiText>
              ) : null}
              <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
                <thead><tr>
                  <th style={head}>Part</th><th style={head}>Size</th><th style={{ ...head, textAlign: 'right' }}>$/GB-month</th><th style={{ ...head, textAlign: 'right' }}>Per year</th><th style={head} />
                </tr></thead>
                <tbody>
                  {o.result.lines.map((l) => (
                    <tr key={l.key}>
                      <td style={cell}>
                        <EuiText size="s">{l.label}{l.constraint === 'cpu' && <> <EuiBadge color="hollow">sized for ingest</EuiBadge></>}</EuiText>
                        {l.sku && <EuiText size="xs" color="subdued">{l.sku}</EuiText>}
                        {l.error && <EuiText size="xs" color="danger">{l.error}</EuiText>}
                      </td>
                      <td style={cell}><EuiText size="s">{size(l)}</EuiText></td>
                      <td style={right}><EuiText size="s">{l.monthlyPerGb === undefined ? '' : fmtMoney(l.monthlyPerGb, 2)}</EuiText></td>
                      <td style={right}><EuiText size="s">{l.error ? '–' : fmtMoney(rounded ? l.annualRounded : l.annual)}</EuiText></td>
                      <td style={{ ...cell, width: 28 }}><MathButton title={`${o.item.name}: ${l.label}`} steps={l.math} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          <EuiSpacer size="m" />
        </div>
      ))}

      {warnings.length > 0 && <SeverityGroups items={warnings} max={4} emptyText="Nothing to fix" />}
      <EuiSpacer size="s" />
      <EuiText size="xs" color="subdued">
        <p>
          <strong>A ballpark, not a quote.</strong> List prices before discounts, from the ECH Ballpark Estimator v{data.source.version} price
          table ({from === 'upload' ? 'uploaded to this browser' : 'the local data file'}). Each use case is priced as its own deployment.
          Use the official quoting tool for customer prices.
        </p>
      </EuiText>
    </EuiPanel>
  );
}
