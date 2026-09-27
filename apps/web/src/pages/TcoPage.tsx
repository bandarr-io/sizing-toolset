import { EuiCallOut, EuiFlexGroup, EuiFlexItem, EuiHorizontalRule, EuiLink, EuiPanel, EuiSpacer, EuiText, EuiTitle } from '@elastic/eui';
import type { ConstantSet } from '@sizing/constants';
import { useMemo } from 'react';
import { CostRatesForm } from '../components/CostRatesForm.tsx';
import { NumField, SwitchField } from '../components/Fields.tsx';
import { MathButton } from '../components/MathFlyout.tsx';
import { costReport, DEFAULT_TERM_YEARS, mergeRates, type CostReport, type CostSettings } from '../cost.ts';
import { useCostDefaults } from '../costStore.tsx';
import { fmtMoney } from '../format.ts';
import type { AppState } from '../state.ts';

const cell = { padding: '8px 10px', textAlign: 'right' as const, whiteSpace: 'nowrap' as const };
const head = { ...cell, fontWeight: 600, fontSize: 12, opacity: 0.75 };

function CostTable({ report }: { report: CostReport }) {
  const first = report.years[0]!;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #D3DAE6' }}>
            <th style={{ ...head, textAlign: 'left' }}>Component</th>
            {report.years.map((y) => <th key={y.year} style={head}>Year {y.year}</th>)}
            <th style={head}>{report.termYears}-year total</th>
          </tr>
        </thead>
        <tbody>
          {first.lines.map((l, i) => {
            const perYear = report.years.map((y) => y.lines[i]!);
            const priced = perYear.every((x) => x.annual !== undefined);
            return (
              <tr key={l.part} style={{ borderBottom: '1px solid #EEF1F7' }}>
                <td style={{ ...cell, textAlign: 'left' }}>
                  <EuiFlexGroup gutterSize="xs" alignItems="center" responsive={false}>
                    <EuiFlexItem grow={false}><EuiText size="s">{l.label}</EuiText></EuiFlexItem>
                    {l.math.length > 0 && <EuiFlexItem grow={false}><MathButton title={`${l.label}, year 1`} steps={l.math} /></EuiFlexItem>}
                  </EuiFlexGroup>
                  {!priced && <EuiText size="xs" color="subdued">Set {l.missing} to include</EuiText>}
                </td>
                {perYear.map((x, j) => <td key={j} style={cell}><EuiText size="s" color={x.annual === undefined ? 'subdued' : 'default'}>{x.annual === undefined ? '–' : fmtMoney(x.annual)}</EuiText></td>)}
                <td style={cell}><EuiText size="s"><strong>{priced ? fmtMoney(perYear.reduce((s, x) => s + x.annual!, 0)) : '–'}</strong></EuiText></td>
              </tr>
            );
          })}
          <tr>
            <td style={{ ...cell, textAlign: 'left' }}><EuiText size="s"><strong>Total</strong></EuiText></td>
            {report.years.map((y) => <td key={y.year} style={cell}><EuiText size="s"><strong>{fmtMoney(y.total)}</strong></EuiText></td>)}
            <td style={cell}><EuiText size="s"><strong>{fmtMoney(report.total)}</strong></EuiText></td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/** Total cost of the platform for the current scenario: subscription plus hardware and running costs, per year and over a term. */
export function TcoPage({ state, setState, constants }: { state: AppState; setState: (f: (s: AppState) => AppState) => void; constants: ConstantSet }) {
  const { defaults } = useCostDefaults();
  const settings = state.cost ?? {};
  const rates = useMemo(() => mergeRates(defaults, settings.rates), [defaults, settings.rates]);
  const report = useMemo(() => costReport(state, constants, rates), [state, constants, rates]);
  const patch = (p: Partial<CostSettings>) => setState((s) => ({ ...s, cost: { ...s.cost, ...p } }));

  return (
    <>
      <EuiCallOut size="s" iconType="info" title={`Total cost for "${state.name}" (${state.mode === 'forward' ? 'sizing' : 'hardware limits'})`}>
        <p>Indicative only, from the prices below. Not a quote. Blank prices use the defaults on <EuiLink href="#/config">Configurations</EuiLink>; a component with no price is left out of the totals.</p>
      </EuiCallOut>
      <EuiSpacer size="l" />
      <EuiFlexGroup gutterSize="xl" alignItems="flexStart" wrap>
        <EuiFlexItem style={{ minWidth: 480, flexBasis: 0, flexGrow: 6 }}>
          <EuiPanel hasBorder paddingSize="l">
            <EuiTitle size="s"><h2>Prices for this scenario</h2></EuiTitle>
            <EuiSpacer size="m" />
            <CostRatesForm value={settings.rates ?? {}} fallback={defaults} onChange={(r) => patch({ rates: r })} />
            <EuiHorizontalRule margin="l" />
            <EuiFlexGroup gutterSize="l" wrap alignItems="flexStart">
              <EuiFlexItem style={{ maxWidth: 200 }}>
                <NumField label="Term" append="years" value={settings.termYears} optional step={1} min={1} placeholder={String(DEFAULT_TERM_YEARS)}
                  onChange={(termYears) => patch({ termYears })} />
              </EuiFlexItem>
              <EuiFlexItem>
                <SwitchField label="Include cost in the Markdown export" checked={settings.includeInExport ?? false}
                  helpText="Off by default, so a customer-ready export has no prices unless you choose it."
                  onChange={(includeInExport) => patch({ includeInExport })} />
              </EuiFlexItem>
            </EuiFlexGroup>
          </EuiPanel>
        </EuiFlexItem>

        <EuiFlexItem style={{ minWidth: 420, flexBasis: 0, flexGrow: 6 }}>
          <EuiPanel hasBorder paddingSize="l">
            {'error' in report
              ? <EuiCallOut color="danger" iconType="error" title="Cannot calculate yet"><p>{report.error}</p></EuiCallOut>
              : (
                <>
                  <EuiFlexGroup gutterSize="xl" wrap responsive={false}>
                    <EuiFlexItem grow={false}>
                      <EuiText size="s" color="subdued">Year 1</EuiText>
                      <span style={{ fontSize: 32, fontWeight: 700, color: '#0B64DD' }}>{fmtMoney(report.years[0]!.total)}</span>
                    </EuiFlexItem>
                    <EuiFlexItem grow={false}>
                      <EuiText size="s" color="subdued">{report.termYears}-year total</EuiText>
                      <span style={{ fontSize: 32, fontWeight: 700 }}>{fmtMoney(report.total)}</span>
                    </EuiFlexItem>
                  </EuiFlexGroup>
                  {report.partial && <EuiText size="xs" color="subdued"><p>Some components have no price yet and are left out.</p></EuiText>}
                  <EuiSpacer size="m" />
                  <CostTable report={report} />
                  <EuiSpacer size="m" />
                  <EuiText size="xs" color="subdued">
                    <p>
                      {state.mode === 'forward'
                        ? 'Year N uses the cluster sized for N years of growth, from the rates in Plan for growth. Hardware is the purchase price spread over the amortization years.'
                        : 'Hardware limits mode prices the hardware as entered, the same every year. Hardware is the purchase price spread over the amortization years.'}
                      {' '}Counts cover all sites.
                    </p>
                  </EuiText>
                </>
              )}
          </EuiPanel>
        </EuiFlexItem>
      </EuiFlexGroup>
    </>
  );
}
