# Elastic Sizing Calculator

Spec: `docs/SPEC.md` (source of truth). Decisions that fill spec gaps: `docs/DECISIONS.md`.
Current phase: MVP (§12). Build order a → e; stop for review after each step.

## Commands
- `pnpm install`
- `pnpm dev`: web app at http://localhost:5173 (engine runs in the browser; no backend yet)
- `pnpm build`: production build of the web app
- `pnpm test`: all workspaces (Vitest)
- `pnpm typecheck`
- `pnpm constants:check`: schema, https `source_url`, `as_of_date` ≤ 12 months old. Override the date with `CONSTANTS_CHECK_DATE=YYYY-MM-DD`.
- `pnpm -F @sizing/<pkg> test`: one package

## Engine rules (`packages/sizing-engine`)
- Pure functions only. No I/O, no `Date`, no `Math.random()`, no env reads, no module state.
- Constants come in as a `ConstantSet` argument (default: `defaultConstants` from `@sizing/constants`). Never hardcode a number that exists in constants; add a constant instead.
- No runtime dependencies other than `@sizing/constants`.
- Every output number carries `MathStep[]` naming the constant keys it used.
- Units: GB are decimal (1e9 bytes). Put units in names (`ramGb`, `diskGb`, `bytesPerVector`).

## Test rules
- §11 cases are the contract. Write the test before the code. Test names start with the case ID (`F3`, `R6`, `P2`).
- Never change a §11 expectation to make a test pass. If one looks wrong, stop and show Dan the math.
- Recorded deviations from §11 live in `docs/DECISIONS.md`; tests cite the decision ID.
- fast-check runs use a fixed seed.

## Constants rules (`packages/constants/data/*.json`)
- Every entry: key, value, unit, source_url (https), as_of_date (YYYY-MM-DD), stack_version, confidence.
- Re-verified against the source: `as_of_date` = verification date, `carried_forward: false`.
- Not re-verified, or a decision with no source value: `carried_forward: true` and a `notes` line saying why.
- Changing a value changes `constantsHash`. That is expected; results must record it.

## Web app (`apps/web`)
- React 18 + Vite + EUI. Calls the engine directly. Scenarios persist in browser localStorage until apps/api exists.
- Use `Collapsible`, not `EuiAccordion` (EUI 122 renders accordion content at 0px height here).
- Only use EUI icon names that exist in `icon_map.js` (e.g. `plusCircle`, `upload`, `export`, `inspect`).

## Out of scope until told otherwise
BigQuery (§8), PDF export, ECK/ECE/ECH/Serverless adapters, comparison view, sensitivity panel.

## Writing for Dan
No em dashes. No narrating that you are about to check something. No "real find" style framing.
