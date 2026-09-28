import { EuiButtonEmpty, EuiFlexGroup, EuiFlexItem, EuiPanel, EuiSpacer, EuiText, EuiTitle } from '@elastic/eui';
import { useState, type ReactNode } from 'react';

/**
 * A numbered input step. Consistent spacing is the point: every section breathes the same way.
 * Every step can fold; folded, it shows `summary` (or the description when there is none).
 * It starts folded only when `startCollapsed` is set.
 */
export function Section({ step, title, description, actions, summary, startCollapsed = false, children }: {
  step?: number; title: string; description?: ReactNode; actions?: ReactNode;
  summary?: ReactNode; startCollapsed?: boolean; children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(startCollapsed);
  const folded = summary ?? description;
  const toggle = (
    <EuiButtonEmpty size="s" iconType={collapsed ? 'pencil' : 'chevronSingleUp'} onClick={() => setCollapsed(!collapsed)}>
      {collapsed ? 'Edit' : 'Collapse'}
    </EuiButtonEmpty>
  );
  return (
    <EuiPanel hasBorder paddingSize="l">
      <EuiFlexGroup gutterSize="m" alignItems="flexStart" responsive={false}>
        {step !== undefined && (
          <EuiFlexItem grow={false}>
            <div aria-hidden style={{
              width: 28, height: 28, borderRadius: 14, background: '#0B64DD', color: '#fff', fontWeight: 600,
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, marginTop: 2,
            }}>{step}</div>
          </EuiFlexItem>
        )}
        <EuiFlexItem>
          <EuiTitle size="s"><h2>{title}</h2></EuiTitle>
          {collapsed
            ? folded && <EuiText size="s" color="subdued"><p>{folded}</p></EuiText>
            : description && <EuiText size="s" color="subdued"><p>{description}</p></EuiText>}
        </EuiFlexItem>
        <EuiFlexItem grow={false}>
          <EuiFlexGroup gutterSize="s" alignItems="center" responsive={false}>
            {actions && !collapsed && <EuiFlexItem grow={false}>{actions}</EuiFlexItem>}
            <EuiFlexItem grow={false}>{toggle}</EuiFlexItem>
          </EuiFlexGroup>
        </EuiFlexItem>
      </EuiFlexGroup>
      {!collapsed && <><EuiSpacer size="l" />{children}</>}
    </EuiPanel>
  );
}

/** Vertical rhythm between stacked sections. */
export function Gap() {
  return <EuiSpacer size="l" />;
}
