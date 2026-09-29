/**
 * The formula catalog: every calculation the app performs, written for people. The Formulas page lists it,
 * and test/formulas.test.ts checks that every setting that feeds a calculation is covered by some entry.
 */
export type FormulaArea =
  | 'Size a workload' | 'Test hardware limits' | 'Hardware checks' | 'Multiple sites' | 'Compare models'
  | 'Elastic Cloud' | 'Total cost' | 'Validation';

export interface Formula {
  /** Stable id, e.g. 'forward.hot_nodes'. */
  id: string;
  area: FormulaArea;
  /** A heading within the area, e.g. 'Storage', 'Nodes', 'Memory', 'License'. */
  group: string;
  /** A plain name, e.g. 'Nodes for a data tier'. */
  title: string;
  /** The formula as math, one or more lines, e.g. 'nodes = ROUNDUP(storage needed / storage per node) + 1 spare'. */
  formula: string;
  /** One to three plain sentences: what it means and why. */
  explanation: string;
  /** Settings (constant keys) the formula reads. The page shows their current values. */
  constantKeys: string[];
  /** Where the rule comes from: 'SPEC §5.1', 'D27', 'ECH Logs!K163', and so on. */
  source: string;
  /** Where the code lives, for maintainers: 'forward.ts', 'ech/observability.ts'. */
  code: string;
}
