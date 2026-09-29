import {
  EuiBadge, EuiButtonGroup, EuiCallOut, EuiFieldSearch, EuiFlexGroup, EuiFlexItem, EuiPanel, EuiSpacer, EuiText, EuiTitle, EuiToolTip,
} from '@elastic/eui';
import { ENGINE_FORMULAS, type Formula, type FormulaArea } from '@sizing/engine';
import { useMemo, useState } from 'react';
import { formatValue, UNCONFIRMED, UNCONFIRMED_HELP } from '../components/constantFormat.ts';
import { useConstants } from '../constantsStore.tsx';
import { WEB_FORMULAS } from '../formulas/cost.ts';
import { VALIDATION_FORMULAS } from '../formulas/validation.ts';

const AREAS: FormulaArea[] = ['Size a workload', 'Test hardware limits', 'Hardware checks', 'Multiple sites', 'Compare models', 'Elastic Cloud', 'Total cost', 'Validation'];
const ALL: readonly Formula[] = [...ENGINE_FORMULAS, ...WEB_FORMULAS, ...VALIDATION_FORMULAS];

function matches(f: Formula, q: string): boolean {
  if (!q) return true;
  const hay = `${f.title} ${f.formula} ${f.explanation} ${f.group} ${f.constantKeys.join(' ')} ${f.source}`.toLowerCase();
  return q.toLowerCase().split(/\s+/).every((w) => hay.includes(w));
}

/** Every formula the app uses, with the settings each one reads and their current values. */
export function FormulasPage() {
  const { set, isOverridden } = useConstants();
  const [area, setArea] = useState<FormulaArea | 'all'>('all');
  const [q, setQ] = useState('');
  const shown = useMemo(() => ALL.filter((f) => (area === 'all' || f.area === area) && matches(f, q)), [area, q]);
  const counts = useMemo(() => Object.fromEntries(AREAS.map((a) => [a, ALL.filter((f) => f.area === a).length])), []);

  return (
    <>
      <EuiCallOut size="s" iconType="documentation" title="Every formula the calculator uses">
        <p>
          Each entry shows the formula, what it means in plain words, and the settings it reads with their current values.
          Change a setting on the Configurations page and every formula that uses it follows. Every result also has a
          "How this was worked out" view with the actual numbers.
        </p>
      </EuiCallOut>
      <EuiSpacer size="m" />
      <EuiFlexGroup gutterSize="m" alignItems="center" wrap>
        <EuiFlexItem style={{ minWidth: 260 }}>
          <EuiFieldSearch fullWidth placeholder="Search formulas, settings or sources" value={q} onChange={(e) => setQ(e.target.value)} isClearable />
        </EuiFlexItem>
        <EuiFlexItem grow={false}>
          <EuiButtonGroup legend="Area" buttonSize="compressed" idSelected={area} onChange={(id) => setArea(id as FormulaArea | 'all')}
            options={[{ id: 'all', label: `All (${ALL.length})` }, ...AREAS.filter((a) => counts[a]).map((a) => ({ id: a, label: `${a} (${counts[a]})` }))]} />
        </EuiFlexItem>
      </EuiFlexGroup>
      <EuiSpacer size="l" />
      {shown.length === 0 && <EuiText size="s" color="subdued"><p>No formulas match.</p></EuiText>}
      {AREAS.map((a) => {
        const inArea = shown.filter((f) => f.area === a);
        if (!inArea.length) return null;
        const groups = [...new Set(inArea.map((f) => f.group))];
        return (
          <div key={a}>
            <EuiTitle size="s"><h2>{a}</h2></EuiTitle>
            <EuiSpacer size="s" />
            {groups.map((g) => (
              <div key={g}>
                <EuiTitle size="xxs"><h3 style={{ opacity: 0.75 }}>{g}</h3></EuiTitle>
                <EuiSpacer size="xs" />
                {inArea.filter((f) => f.group === g).map((f) => (
                  <div key={f.id}>
                    <EuiPanel hasBorder paddingSize="m" id={f.id}>
                      <EuiFlexGroup gutterSize="s" alignItems="baseline" responsive={false} wrap>
                        <EuiFlexItem><EuiText size="s"><strong>{f.title}</strong></EuiText></EuiFlexItem>
                        <EuiFlexItem grow={false}><EuiToolTip content={`Code: ${f.code}`}><EuiBadge color="hollow">{f.source}</EuiBadge></EuiToolTip></EuiFlexItem>
                      </EuiFlexGroup>
                      <EuiSpacer size="xs" />
                      <pre style={{ margin: 0, padding: '8px 10px', borderRadius: 6, background: 'rgba(11,100,221,0.06)', fontSize: 13, whiteSpace: 'pre-wrap', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{f.formula}</pre>
                      <EuiSpacer size="xs" />
                      <EuiText size="s" color="subdued"><p>{f.explanation}</p></EuiText>
                      {f.constantKeys.length > 0 && (
                        <>
                          <EuiSpacer size="xs" />
                          <EuiFlexGroup gutterSize="xs" wrap responsive={false}>
                            {f.constantKeys.map((k) => {
                              const c = set.byKey.get(k);
                              return (
                                <EuiFlexItem grow={false} key={k}>
                                  <EuiToolTip content={<>{c?.notes ?? k}{c?.carried_forward ? <><br />{UNCONFIRMED}: {UNCONFIRMED_HELP}</> : null}</>}>
                                    <EuiBadge color={isOverridden(k) ? 'primary' : 'default'}>
                                      {k} = {c ? formatValue(c.value) : '?'}{c?.unit && typeof c.value !== 'object' ? ` ${c.value === 1 ? c.unit.replace(/s$/, '') : c.unit}` : ''}{isOverridden(k) ? ' (changed)' : c?.carried_forward ? ` (${UNCONFIRMED})` : ''}
                                    </EuiBadge>
                                  </EuiToolTip>
                                </EuiFlexItem>
                              );
                            })}
                          </EuiFlexGroup>
                        </>
                      )}
                    </EuiPanel>
                    <EuiSpacer size="s" />
                  </div>
                ))}
                <EuiSpacer size="s" />
              </div>
            ))}
            <EuiSpacer size="l" />
          </div>
        );
      })}
    </>
  );
}
