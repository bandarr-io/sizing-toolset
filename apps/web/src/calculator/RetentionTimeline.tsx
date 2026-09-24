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
  { label: '7 days hot', value: { hot: 7 } },
  { label: '30 days hot', value: { hot: 30 } },
  { label: '7 d hot, 90 d total (frozen)', value: { hot: 7, frozen: 83 } },
  { label: '30 d hot, 1 year total (frozen)', value: { hot: 30, frozen: 335 } },
  { label: '7 d hot, 30 d warm, 1 year total (frozen)', value: { hot: 7, warm: 30, frozen: 328 } },
  { label: '30 d hot, 90 d warm, 1 year total (frozen)', value: { hot: 30, warm: 90, frozen: 245 } },
];

export function humanDays(days: number): string {
  if (days >= 365 && days % 365 === 0) return `${days / 365} year${days === 365 ? '' : 's'}`;
  if (days >= 60) return `≈ ${Math.round(days / 30.4)} months`;
  if (days >= 14 && days % 7 === 0) return `${days / 7} weeks`;
  return `${days} day${days === 1 ? '' : 's'}`;
}

/**
 * Data lifecycle for one workload: a proportional bar of tiers with day inputs beneath.
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
  const total = Math.max(1, known);

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

      {/* Proportional lifecycle bar */}
      <div style={{ display: 'flex', height: 30, borderRadius: 6, overflow: 'hidden', gap: 2 }} role="img"
        aria-label={enabled.map((t) => `${TIER_LABEL[t]} ${t === solving ? 'solved' : `${value[t] ?? 0} days`}`).join(', ')}>
        {enabled.map((t) => {
          const days = value[t] ?? 0;
          const isSolving = t === solving;
          // A solved tier has no length yet: give it a fixed share, or the whole bar when it is the only tier.
          const grow = isSolving ? (known > 0 ? total * 0.25 : 1) : Math.max(days, total * 0.1);
          return (
            <div key={t} style={{
              flexGrow: grow, flexBasis: 0, minWidth: 56, display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff', fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden',
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

      <EuiFlexGroup gutterSize="m" wrap responsive={false}>
        {enabled.map((t) => (
          <EuiFlexItem key={t} style={{ minWidth: 140, maxWidth: 220 }}>
            <EuiFormRow
              label={<span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: TIER_COLOR[t], marginRight: 6 }} />{TIER_LABEL[t]}</span>}
              labelAppend={t !== 'hot' && t !== solving
                ? <EuiButtonIcon iconType="cross" size="xs" color="text" aria-label={`Remove ${t} tier`} onClick={() => set(t, undefined)} />
                : undefined}
            >
              {t === solving
                ? <EuiFieldNumber disabled value="" placeholder="solved" append="days" aria-label={`${t} days (solved)`} />
                : <EuiFieldNumber value={value[t] ?? ''} min={t === 'hot' ? 1 : 0} append="days" aria-label={`${t} days`}
                    onChange={(e) => set(t, e.target.value === '' ? undefined : Number(e.target.value))} />}
            </EuiFormRow>
          </EuiFlexItem>
        ))}
      </EuiFlexGroup>

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
