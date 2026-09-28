import { EuiCallOut, EuiFlexGroup, EuiFlexItem, EuiHorizontalRule, EuiLink, EuiPanel, EuiSpacer, EuiText, EuiTitle } from '@elastic/eui';
import type { ConstantSet } from '@sizing/constants';
import { useMemo } from 'react';
import { CostRatesForm } from '../components/CostRatesForm.tsx';
import { NumField, SwitchField } from '../components/Fields.tsx';
import { MathButton } from '../components/MathFlyout.tsx';
import { costReport, DEFAULT_TERM_YEARS, mergeRates, validDiscount, type CostReport, type CostSettings } from '../cost.ts';
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
            <th style={{ ...head, textAlign: 'left' }}>Item</th>
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
                  {!priced && <EuiText size="xs" color="subdued">Add the {l.missing} to include this</EuiText>}
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
        <p>A rough guide built from the prices below, not a quote. Blank prices use the defaults on <EuiLink href="#/config">Configurations</EuiLink>. Anything without a price is left out of the totals.</p>
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
                <NumField label="Length of the estimate" append="years" value={settings.termYears} optional step={1} min={1} placeholder={String(DEFAULT_TERM_YEARS)}
                  onChange={(termYears) => patch({ termYears })} />
              </EuiFlexItem>
              <EuiFlexItem style={{ maxWidth: 240 }}>
                <NumField label="Discount on Elastic subscription" append="%" value={settings.discountPct} optional step="any" min={0} placeholder="0"
                  helpText="Taken off the list price of the Elastic subscription. Hardware and running costs are not discounted."
                  error={settings.discountPct !== undefined && validDiscount(settings.discountPct) === undefined ? 'Enter a percentage from 0 to 100' : undefined}
                  onChange={(discountPct) => patch({ discountPct })} />
              </EuiFlexItem>
              <EuiFlexItem>
                <SwitchField label="Include cost in the Markdown export" checked={settings.includeInExport ?? false}
                  helpText="Off by default, so an export you send to a customer has no prices unless you choose to add them."
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
                  {report.partial && <EuiText size="xs" color="subdued"><p>Some items have no price yet, so they are left out.</p></EuiText>}
                  <EuiSpacer size="m" />
                  <CostTable report={report} />
                  <EuiSpacer size="m" />
                  <EuiText size="xs" color="subdued">
                    <p>
                      {state.mode === 'forward'
                        ? 'Each year prices the cluster at the size it will need that year, using the rates in Plan for growth. Hardware is the purchase price spread evenly over the years you keep it.'
                        : 'Test hardware limits prices the hardware as entered, the same every year. Hardware is the purchase price spread evenly over the years you keep it.'}
                      {' '}Totals cover every site.
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
