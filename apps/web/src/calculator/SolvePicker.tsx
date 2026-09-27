import { EuiButtonEmpty, EuiFlexGrid, EuiFlexGroup, EuiFlexItem, EuiIcon, EuiPanel, EuiText } from '@elastic/eui';
import type { Solve } from '@sizing/engine';
import { useState } from 'react';
import { SOLVES } from '../state.ts';

/** "What do you want to find out?" as the chosen question on one line, opening to selectable cards to change it. */
export function SolvePicker({ value, onChange }: { value: Solve; onChange: (s: Solve) => void }) {
  const [choosing, setChoosing] = useState(false);
  const current = SOLVES.find((s) => s.value === value) ?? SOLVES[0]!;
  if (!choosing) {
    return (
      <EuiPanel paddingSize="m" hasBorder hasShadow={false} color="primary">
        <EuiFlexGroup gutterSize="m" alignItems="center" responsive={false}>
          <EuiFlexItem grow={false}><EuiIcon type={current.icon} size="l" /></EuiFlexItem>
          <EuiFlexItem>
            <EuiText size="s"><strong>{current.title}</strong></EuiText>
            <EuiText size="xs" color="subdued">{current.blurb}</EuiText>
          </EuiFlexItem>
          <EuiFlexItem grow={false}><EuiButtonEmpty size="s" iconType="pencil" onClick={() => setChoosing(true)}>Change</EuiButtonEmpty></EuiFlexItem>
        </EuiFlexGroup>
      </EuiPanel>
    );
  }
  return (
    <EuiFlexGrid columns={3} gutterSize="m" role="radiogroup" aria-label="Question">
      {SOLVES.map((s) => {
        const selected = s.value === value;
        return (
          <EuiFlexItem key={s.value}>
            <EuiPanel
              element="button" role="radio" aria-checked={selected} onClick={() => { onChange(s.value); setChoosing(false); }}
              paddingSize="m" hasBorder hasShadow={false} color={selected ? 'primary' : 'plain'}
              style={{ textAlign: 'left', outline: selected ? '2px solid #0B64DD' : undefined, height: '100%' }}
            >
              <EuiFlexGroup gutterSize="s" alignItems="center" responsive={false}>
                <EuiFlexItem grow={false}><EuiIcon type={s.icon} size="l" /></EuiFlexItem>
                <EuiFlexItem>
                  <EuiText size="s"><strong>{s.title}</strong></EuiText>
                  <EuiText size="xs" color="subdued">{s.blurb}</EuiText>
                </EuiFlexItem>
              </EuiFlexGroup>
            </EuiPanel>
          </EuiFlexItem>
        );
      })}
    </EuiFlexGrid>
  );
}
