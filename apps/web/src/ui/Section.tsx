import { EuiButtonEmpty, EuiFlexGroup, EuiFlexItem, EuiPanel, EuiSpacer, EuiText, EuiTitle } from '@elastic/eui';
import { useState, type ReactNode } from 'react';

/**
 * A numbered input step. Consistent spacing is the point: every section breathes the same way.
 * With a `summary`, the step can fold to that one line; it starts folded only when `startCollapsed` is set.
 */
export function Section({ step, title, description, actions, summary, startCollapsed = false, children }: {
  step?: number; title: string; description?: ReactNode; actions?: ReactNode;
  summary?: ReactNode; startCollapsed?: boolean; children: ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(summary !== undefined && startCollapsed);
  const toggle = summary !== undefined && (
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
            ? <EuiText size="s" color="subdued"><p>{summary}</p></EuiText>
            : description && <EuiText size="s" color="subdued"><p>{description}</p></EuiText>}
        </EuiFlexItem>
        {(actions || toggle) && (
          <EuiFlexItem grow={false}>
            <EuiFlexGroup gutterSize="s" alignItems="center" responsive={false}>
              {actions && !collapsed && <EuiFlexItem grow={false}>{actions}</EuiFlexItem>}
              {toggle && <EuiFlexItem grow={false}>{toggle}</EuiFlexItem>}
            </EuiFlexGroup>
          </EuiFlexItem>
        )}
      </EuiFlexGroup>
      {!collapsed && <><EuiSpacer size="l" />{children}</>}
    </EuiPanel>
  );
}

/** Vertical rhythm between stacked sections. */
export function Gap() {
  return <EuiSpacer size="l" />;
}
