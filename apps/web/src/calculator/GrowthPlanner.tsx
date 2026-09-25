import {
  EuiButton, EuiButtonGroup, EuiFieldNumber, EuiFlexGroup, EuiFlexItem, EuiFormRow, EuiIcon, EuiSpacer, EuiText,
} from '@elastic/eui';
import { num } from '@sizing/constants';
import type { ForwardRequest, WorkloadProfile } from '@sizing/engine';
import { useState } from 'react';
import { useConstants } from '../constantsStore.tsx';
import { fmtCompact, fmtNum } from '../format.ts';
import { KINDS } from '../state.ts';

const HORIZONS = [0, 1, 2, 3, 5];

/** What growth scales for each kind: the same quantity the engine multiplies. */
function volume(p: WorkloadProfile): { today: number; unit: string } | undefined {
  if (p.rawGbPerDay !== undefined && p.rawGbPerDay > 0) return { today: p.rawGbPerDay, unit: 'GB/day' };
  if (p.totalGb) return { today: p.totalGb, unit: 'GB' };
  if (p.vector?.count) return { today: p.vector.count, unit: 'vectors' };
  return undefined;
}

const cell = { padding: '8px 8px', verticalAlign: 'middle' as const };
const head = { ...cell, textAlign: 'left' as const, fontWeight: 600, fontSize: 12, opacity: 0.75 };

/**
 * Forward-mode growth in one place: how far ahead to size, and how fast each workload grows,
 * with the resulting size shown next to today's so the effect is visible before reading results.
 */
export function GrowthPlanner({ value, onChange }: { value: ForwardRequest; onChange: (f: ForwardRequest) => void }) {
  const { set: c } = useConstants();
  const [allRate, setAllRate] = useState<number | undefined>();
  const years = value.options.growthHorizonYears ?? num(c, 'growth.default_horizon_years');
  const rows = value.workloads.map((p, i) => ({ p, i, v: volume(p) })).filter((r) => r.v);
  const horizons = HORIZONS.includes(years) ? HORIZONS : [...HORIZONS, years].sort((a, b) => a - b);

  const setYears = (y: number) => onChange({ ...value, options: { ...value.options, growthHorizonYears: y } });
  const setRate = (i: number, g: number | undefined) =>
    onChange({ ...value, workloads: value.workloads.map((w, j) => (j === i ? withRate(w, g) : w)) });
  const applyAll = () =>
    onChange({ ...value, workloads: value.workloads.map((w) => (volume(w) ? withRate(w, allRate) : w)) });

  if (rows.length === 0) return <EuiText size="s" color="subdued"><p>Add a workload with a volume to plan for growth.</p></EuiText>;

  return (
    <>
      <EuiFlexGroup gutterSize="l" alignItems="flexEnd" wrap>
        <EuiFlexItem grow={false}>
          <EuiFormRow label="Size the cluster for">
            <EuiButtonGroup legend="Growth horizon" idSelected={String(years)} onChange={(id) => setYears(Number(id))}
              options={horizons.map((y) => ({ id: String(y), label: y === 0 ? 'Today' : `${y} year${y === 1 ? '' : 's'}` }))} />
          </EuiFormRow>
        </EuiFlexItem>
        {rows.length > 1 && (
          <EuiFlexItem grow={false}>
            <EuiFormRow label="Same rate for every workload">
              <EuiFlexGroup gutterSize="s" responsive={false}>
                <EuiFlexItem style={{ width: 130 }}>
                  <EuiFieldNumber aria-label="Growth rate for every workload" append="% / yr" min={0} placeholder="20" value={allRate ?? ''}
                    onChange={(e) => setAllRate(e.target.value === '' ? undefined : Number(e.target.value))} />
                </EuiFlexItem>
                <EuiFlexItem grow={false}><EuiButton onClick={applyAll}>Apply</EuiButton></EuiFlexItem>
              </EuiFlexGroup>
            </EuiFormRow>
          </EuiFlexItem>
        )}
      </EuiFlexGroup>
      <EuiSpacer size="m" />
      <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
        <thead>
          <tr>
            <th style={head}>Workload</th>
            <th style={{ ...head, textAlign: 'right' }}>Today</th>
            <th style={{ ...head, width: 150 }}>Growth</th>
            <th style={{ ...head, textAlign: 'right' }}>{years === 0 ? 'Sized for' : `In ${years} year${years === 1 ? '' : 's'}`}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ p, i, v }) => {
            const g = p.growthPctPerYear ?? 0;
            const grown = v!.today * (1 + g / 100) ** years;
            const show = (x: number) => (v!.unit === 'vectors' ? fmtCompact(x) : fmtNum(x, x < 100 ? 1 : 0));
            return (
              <tr key={i}>
                <td style={cell}>
                  <EuiFlexGroup gutterSize="s" alignItems="center" responsive={false}>
                    <EuiFlexItem grow={false}><EuiIcon type={KINDS[p.kind].icon} /></EuiFlexItem>
                    <EuiFlexItem><EuiText size="s">{p.id}</EuiText></EuiFlexItem>
                  </EuiFlexGroup>
                </td>
                <td style={{ ...cell, textAlign: 'right' }}><EuiText size="s">{show(v!.today)} <span style={{ opacity: 0.7 }}>{v!.unit}</span></EuiText></td>
                <td style={cell}>
                  <EuiFieldNumber compressed aria-label={`${p.id} growth per year`} append="% / yr" min={0} placeholder="0" value={p.growthPctPerYear ?? ''}
                    onChange={(e) => setRate(i, e.target.value === '' ? undefined : Number(e.target.value))} />
                </td>
                <td style={{ ...cell, textAlign: 'right' }}>
                  <EuiText size="s"><strong>{show(grown)}</strong> <span style={{ opacity: 0.7 }}>{v!.unit}</span>
                    {g > 0 && years > 0 && <span style={{ opacity: 0.7 }}> (×{fmtNum(grown / v!.today, 2)})</span>}
                  </EuiText>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <EuiSpacer size="s" />
      <EuiText size="xs" color="subdued">
        <p>Growth compounds yearly and scales daily ingest, corpus size or vector count. Retention and replicas stay as set.</p>
      </EuiText>
    </>
  );
}

function withRate(p: WorkloadProfile, g: number | undefined): WorkloadProfile {
  if (g === undefined || g === 0) {
    const { growthPctPerYear: _drop, ...rest } = p;
    return rest;
  }
  return { ...p, growthPctPerYear: g };
}
