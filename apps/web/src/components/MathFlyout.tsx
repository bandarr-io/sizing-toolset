import {
  EuiBadge, EuiButtonIcon, EuiCode, EuiFlexGroup, EuiFlexItem, EuiFlyout, EuiFlyoutBody, EuiFlyoutHeader, EuiHorizontalRule,
  EuiLink, EuiPanel, EuiSpacer, EuiText, EuiTitle, EuiToolTip,
} from '@elastic/eui';
import type { MathStep } from '@sizing/engine';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useConstants } from '../constantsStore.tsx';
import { fmtNum } from '../format.ts';
import { ConfidenceBadge } from './ConfidenceBadge.tsx';

interface MathView { title: string; steps: MathStep[]; note?: string }
const MathContext = createContext<(v: MathView) => void>(() => {});

export function MathProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<MathView | undefined>();
  const open = useCallback((v: MathView) => setView(v), []);
  return (
    <MathContext.Provider value={open}>
      {children}
      {view && <MathFlyout view={view} onClose={() => setView(undefined)} />}
    </MathContext.Provider>
  );
}

export function useShowMath() {
  return useContext(MathContext);
}

/** Small "show the math" button placed next to any number. */
export function MathButton({ title, steps, note }: MathView) {
  const open = useShowMath();
  if (steps.length === 0) return null;
  return (
    <EuiToolTip content="Show how this was worked out">
      <EuiButtonIcon iconType="inspect" aria-label={`Show how this was worked out: ${title}`} size="xs" onClick={() => open({ title, steps, ...(note ? { note } : {}) })} />
    </EuiToolTip>
  );
}

function ConstantChip({ k }: { k: string }) {
  const { set, isOverridden } = useConstants();
  const c = set.byKey.get(k);
  if (!c) return <EuiBadge color="danger">{k}</EuiBadge>;
  const value = typeof c.value === 'object' ? 'table' : String(c.value);
  return (
    <EuiPanel paddingSize="s" hasBorder>
      <EuiFlexGroup gutterSize="s" alignItems="center" wrap responsive={false}>
        <EuiFlexItem grow={false}><EuiCode>{c.key}</EuiCode></EuiFlexItem>
        <EuiFlexItem grow={false}><EuiText size="xs"><strong>{value}</strong> {c.unit}</EuiText></EuiFlexItem>
        <EuiFlexItem grow={false}>
          <ConfidenceBadge c={c.confidence} short />
        </EuiFlexItem>
        {c.carried_forward && <EuiFlexItem grow={false}><EuiBadge color="hollow">not re-checked against source</EuiBadge></EuiFlexItem>}
        {isOverridden(k) && <EuiFlexItem grow={false}><EuiBadge color="primary">changed in this browser</EuiBadge></EuiFlexItem>}
      </EuiFlexGroup>
      <EuiText size="xs" color="subdued">
        <EuiLink href={c.source_url} target="_blank" external>source</EuiLink> · checked {c.as_of_date} · Elastic version {c.stack_version}
        {c.notes ? <> · {c.notes}</> : null}
      </EuiText>
    </EuiPanel>
  );
}

function MathFlyout({ view, onClose }: { view: MathView; onClose: () => void }) {
  const keys = useMemo(() => [...new Set(view.steps.flatMap((s) => s.constantKeys))], [view]);
  return (
    <EuiFlyout onClose={onClose} size="m" ownFocus aria-labelledby="math-title">
      <EuiFlyoutHeader hasBorder>
        <EuiTitle size="s"><h2 id="math-title">How this was worked out: {view.title}</h2></EuiTitle>
        <EuiText size="s" color="subdued"><p>Each step shows a formula and its result. The fixed figures it uses are listed at the bottom, each with its source.</p></EuiText>
        {view.note && <EuiText size="s" color="subdued"><p>{view.note}</p></EuiText>}
      </EuiFlyoutHeader>
      <EuiFlyoutBody>
        {view.steps.map((s, i) => (
          <div key={i}>
            <EuiText size="s"><strong>{s.label}</strong></EuiText>
            <EuiFlexGroup gutterSize="s" alignItems="baseline" responsive={false} wrap>
              <EuiFlexItem grow={false}><EuiCode>{s.expr}</EuiCode></EuiFlexItem>
              <EuiFlexItem grow={false}><EuiText size="s">= <strong>{fmtNum(s.value)}</strong></EuiText></EuiFlexItem>
            </EuiFlexGroup>
            {s.constantKeys.length > 0 && (
              <EuiText size="xs" color="subdued">uses {s.constantKeys.join(', ')}</EuiText>
            )}
            <EuiSpacer size="s" />
          </div>
        ))}
        {keys.length > 0 && (
          <>
            <EuiHorizontalRule margin="m" />
            <EuiTitle size="xxs"><h3>Fixed figures used</h3></EuiTitle>
            <EuiSpacer size="s" />
            {keys.map((k) => (<div key={k}><ConstantChip k={k} /><EuiSpacer size="xs" /></div>))}
          </>
        )}
      </EuiFlyoutBody>
    </EuiFlyout>
  );
}
