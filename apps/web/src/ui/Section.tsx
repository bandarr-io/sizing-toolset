import { EuiFlexGroup, EuiFlexItem, EuiPanel, EuiSpacer, EuiText, EuiTitle } from '@elastic/eui';
import type { ReactNode } from 'react';

/** A numbered input step. Consistent spacing is the point: every section breathes the same way. */
export function Section({ step, title, description, actions, children }: {
  step?: number; title: string; description?: ReactNode; actions?: ReactNode; children: ReactNode;
}) {
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
          {description && <EuiText size="s" color="subdued"><p>{description}</p></EuiText>}
        </EuiFlexItem>
        {actions && <EuiFlexItem grow={false}>{actions}</EuiFlexItem>}
      </EuiFlexGroup>
      <EuiSpacer size="l" />
      {children}
    </EuiPanel>
  );
}

/** Vertical rhythm between stacked sections. */
export function Gap() {
  return <EuiSpacer size="l" />;
}
