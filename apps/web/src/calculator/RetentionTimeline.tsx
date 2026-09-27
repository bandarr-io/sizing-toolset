import {
  EuiButtonEmpty, EuiButtonIcon, EuiContextMenuItem, EuiContextMenuPanel, EuiFieldNumber, EuiFlexGroup, EuiFlexItem, EuiFormRow,
  EuiPopover, EuiSpacer, EuiText,
} from '@elastic/eui';
import type { Tier } from '@sizing/engine';
import { useState } from 'react';
import { TIER_COLOR, TIER_LABEL } from '../ui/tiers.ts';

type Retention = Partial<Record<Tier, number>>;
const ORDER: Tier[] = ['hot', 'warm', 'cold', 'frozen'];
const ADD_DAYS: Record<Tier, number> = { hot: 7, warm: 30, cold: 60, frozen: 335, content: 0 };

const PRESETS: { label: string; value: Retention }[] = [
  { label: '7 d hot', value: { hot: 7 } },
  { label: '30 d hot', value: { hot: 30 } },
  { label: '7 d hot, 83 d frozen (90 d)', value: { hot: 7, frozen: 83 } },
  { label: '3 d hot, 27 d cold, 335 d frozen (1 year)', value: { hot: 3, cold: 27, frozen: 335 } },
  { label: '7 d hot, 23 d cold, 335 d frozen (1 year)', value: { hot: 7, cold: 23, frozen: 335 } },
  { label: '30 d hot, 335 d frozen (1 year)', value: { hot: 30, frozen: 335 } },
];

export function humanDays(days: number): string {
  if (days >= 365 && days % 365 === 0) return `${days / 365} year${days === 365 ? '' : 's'}`;
  if (days >= 60) return `≈ ${Math.round(days / 30.4)} months`;
  if (days >= 14 && days % 7 === 0) return `${days / 7} weeks`;
  return `${days} day${days === 1 ? '' : 's'}`;
}

/** Bar width follows the square root of days, so a short tier stays readable beside a much longer one. */
function visualWeight(days: number): number {
  return Math.sqrt(Math.max(days, 1));
}

/** A thin, label-free version of the lifecycle bar for collapsed workload rows. */
export function RetentionStrip({ value }: { value: Retention }) {
  const tiers = ORDER.filter((t) => (value[t] ?? 0) > 0);
  if (tiers.length === 0) return null;
  return (
    <div style={{ display: 'flex', height: 8, width: 120, borderRadius: 4, overflow: 'hidden', gap: 1 }}
      title={tiers.map((t) => `${TIER_LABEL[t]} ${value[t]} d`).join(', ')}>
      {tiers.map((t) => <div key={t} style={{ flexGrow: visualWeight(value[t]!), flexBasis: 0, background: TIER_COLOR[t] }} />)}
    </div>
  );
}

/**
 * Data lifecycle for one workload: a bar of tiers with day inputs beneath.
 * `solving` marks the tier whose retention is the reverse-mode answer.
 */
export function RetentionTimeline({ value, onChange, solving, onSolvingChange }: {
  value: Retention;
  onChange: (v: Retention) => void;
  solving?: Tier;
  onSolvingChange?: (t: Tier) => void;
}) {
  const [presetsOpen, setPresetsOpen] = useState(false);
  const enabled = ORDER.filter((t) => t === 'hot' || (value[t] ?? 0) > 0 || t === solving);
  const missing = ORDER.filter((t) => !enabled.includes(t));
  const known = enabled.filter((t) => t !== solving).reduce((s, t) => s + (value[t] ?? 0), 0);
  const knownWeight = enabled.filter((t) => t !== solving).reduce((s, t) => s + visualWeight(value[t] ?? 0), 0);

  const set = (t: Tier, days: number | undefined) => {
    const next = { ...value };
    if (days === undefined || days <= 0) delete next[t]; else next[t] = days;
    onChange(next);
  };

  return (
    <div>
      <EuiFlexGroup alignItems="center" justifyContent="spaceBetween" responsive={false} gutterSize="s">
        <EuiFlexItem grow={false}>
          <EuiText size="xs"><strong>Retention</strong>{known > 0 && <span style={{ opacity: 0.75 }}> · {known} days{humanDays(known) !== `${known} days` ? ` (${humanDays(known)})` : ''}{solving ? ' + solved tier' : ''}</span>}</EuiText>
        </EuiFlexItem>
        <EuiFlexItem grow={false}>
          <EuiPopover
            isOpen={presetsOpen} closePopover={() => setPresetsOpen(false)} panelPaddingSize="none" anchorPosition="downRight"
            button={<EuiButtonEmpty size="xs" iconType="clock" iconSide="left" onClick={() => setPresetsOpen(!presetsOpen)}>Presets</EuiButtonEmpty>}
          >
            <EuiContextMenuPanel items={PRESETS.map((p) => (
              <EuiContextMenuItem key={p.label} onClick={() => { onChange(p.value); setPresetsOpen(false); }}>{p.label}</EuiContextMenuItem>
            ))} />
          </EuiPopover>
        </EuiFlexItem>
      </EuiFlexGroup>
      <EuiSpacer size="xs" />

      <div style={{ display: 'flex', height: 30, borderRadius: 6, overflow: 'hidden', gap: 2 }} role="img"
        aria-label={enabled.map((t) => `${TIER_LABEL[t]} ${t === solving ? 'solved' : `${value[t] ?? 0} days`}`).join(', ')}>
        {enabled.map((t) => {
          const days = value[t] ?? 0;
          const isSolving = t === solving;
          const weight = isSolving ? (knownWeight > 0 ? knownWeight * 0.5 : 1) : visualWeight(days);
          return (
            <div key={t} title={`${TIER_LABEL[t]} · ${isSolving ? 'solved' : `${days} days`}`} style={{
              flexGrow: weight, flexShrink: 1, flexBasis: 'auto', minWidth: 0, boxSizing: 'border-box',
              padding: '0 12px', display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              background: isSolving
                ? `repeating-linear-gradient(45deg, ${TIER_COLOR[t]}, ${TIER_COLOR[t]} 6px, ${TIER_COLOR[t]}bb 6px, ${TIER_COLOR[t]}bb 12px)`
                : TIER_COLOR[t],
            }}>
              {TIER_LABEL[t]} · {isSolving ? '?' : `${days} d`}
            </div>
          );
        })}
      </div>
      <EuiSpacer size="m" />

      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${enabled.length}, minmax(0, 1fr))`, columnGap: 16, alignItems: 'start' }}>
        {enabled.map((t) => (
          <EuiFormRow
            key={t}
            fullWidth
            style={{ marginBlock: 0 }}
            label={<span style={{ display: 'inline-flex', alignItems: 'center', minHeight: 24 }}><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: TIER_COLOR[t], marginRight: 6 }} />{TIER_LABEL[t]}</span>}
            labelAppend={t !== 'hot' && t !== solving
              ? <EuiButtonIcon iconType="cross" size="xs" color="text" aria-label={`Remove ${t} tier`} onClick={() => set(t, undefined)} />
              : undefined}
          >
            {t === solving
              ? <EuiFieldNumber fullWidth disabled value="" placeholder="solved" append="days" aria-label={`${t} days (solved)`} />
              : <EuiFieldNumber fullWidth value={value[t] ?? ''} min={t === 'hot' ? 1 : 0} append="days" aria-label={`${t} days`}
                  onChange={(e) => set(t, e.target.value === '' ? undefined : Number(e.target.value))} />}
          </EuiFormRow>
        ))}
      </div>

      {(missing.length > 0 || onSolvingChange) && <EuiSpacer size="s" />}
      <EuiFlexGroup gutterSize="s" alignItems="center" wrap responsive={false}>
        {missing.map((t) => (
          <EuiFlexItem grow={false} key={t}>
            <EuiButtonEmpty size="xs" iconType="plusCircle" onClick={() => set(t, ADD_DAYS[t])}>{TIER_LABEL[t]} tier</EuiButtonEmpty>
          </EuiFlexItem>
        ))}
        {onSolvingChange && enabled.length > 1 && (
          <EuiFlexItem grow={false}>
            <EuiText size="xs" color="subdued">
              Solving for:{' '}
              {ORDER.filter((t) => t === solving || enabled.includes(t)).map((t) => (
                <EuiButtonEmpty key={t} size="xs" color={t === solving ? 'primary' : 'text'} isSelected={t === solving}
                  onClick={() => onSolvingChange(t)} style={{ fontWeight: t === solving ? 700 : 400 }}>
                  {TIER_LABEL[t]}
                </EuiButtonEmpty>
              ))}
            </EuiText>
          </EuiFlexItem>
        )}
      </EuiFlexGroup>
    </div>
  );
}
