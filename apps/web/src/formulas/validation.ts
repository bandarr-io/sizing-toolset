import type { Formula } from '@sizing/engine';

const area = 'Validation' as const;

/** Validation sheet (D39): how estimates are compared with the clusters customers actually run. */
export const VALIDATION_FORMULAS: Formula[] = [
  {
    id: 'validation.estimate', area, group: 'Comparing a deal', title: 'The estimate for a deal',
    formula: 'estimate = Size a workload with the deal\'s saved inputs and today\'s settings',
    explanation: 'Each deal keeps its workload inputs, not its old results. The estimate is worked out again every time, so changing a setting on the Configurations page shows at once whether the calculator got closer to reality.',
    constantKeys: [], source: 'D39', code: 'web validation.ts (compareRecord)',
  },
  {
    id: 'validation.gap', area, group: 'Comparing a deal', title: 'Gap between estimate and actual',
    formula: 'gap % = (estimate − actual) ÷ actual × 100\nclose when −15% ≤ gap ≤ +15%',
    explanation: 'A positive gap means the calculator asks for more than the customer runs; a negative gap means less. Nodes per tier, total memory and license units are each compared. The 15% line is the calibration target in the spec.',
    constantKeys: [], source: 'D39, SPEC §12', code: 'web validation.ts (diffPct, TOLERANCE_PCT)',
  },
  {
    id: 'validation.summary', area, group: 'Across deals', title: 'How close the calculator is overall',
    formula: 'typical gap = middle value of |gap %| across deals\ntends to = middle value of gap % (ask for more when positive, less when negative)\nwithin 15% = deals within ±15% ÷ deals with an actual value',
    explanation: 'The middle value (median) keeps one unusual deal from skewing the picture. Each measure is summarized on its own, using only the deals where the actual value is known.',
    constantKeys: [], source: 'D39', code: 'web validation.ts (summarize)',
  },
];
