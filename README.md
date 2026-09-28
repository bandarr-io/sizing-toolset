# Elastic Ballpark Editor

A sizing calculator for Elasticsearch clusters. Describe the workloads and get a node count per tier, or describe the hardware and find out how much it can hold. Every number comes with the formula that produced it and the sourced constants it used.

> **Estimate, not benchmark.** Results are a starting point for a conversation. Validate anything that matters with Rally against real data.

## What it does

The calculator has four modes, picked from the toolbar:

| Mode | Question it answers |
| --- | --- |
| **Size a workload** | What cluster do these workloads need? Nodes, RAM, disk and vCPU per tier, with growth planned over a horizon. |
| **Test hardware limits** | What can this hardware hold? Maximum GB/day, retention, vectors, ML jobs or agents, or how many years until it is full. |
| **Multiple sites** | How do the same servers work across sites? Independent clusters, disaster recovery or active-active, identical or per-site. |
| **Compare models** | Which deployment model fits these servers best? Self-managed, ECK and ECE side by side in a trade-off table. |

Alongside the modes:

- **Show the math:** every result expands into its steps, each citing the constants it read.
- **Confidence and bottleneck:** each result says what limits it (disk, RAM, CPU, shards) and how confident the estimate is.
- **Cluster map:** a flyout drawing of the nodes per tier and server.
- **Total cost:** annual and term costs for hardware and the Elastic subscription, with an optional subscription discount.
- **Configurations:** view and edit the underlying constants. In `pnpm dev`, edits are written back to `packages/constants/data`.
- **Scenarios:** named scenarios saved in the browser, exported as Markdown or JSON. JSON exports reproduce the result when loaded again.

Every input card folds to a one-line summary, so a finished scenario reads as a short list.

## Getting started

Requires Node 22 or newer and pnpm 10.

```bash
pnpm install
pnpm dev          # web app at http://localhost:5173
```

Other commands, run from the repo root:

```bash
pnpm test             # all tests: constants, engine and web
pnpm typecheck        # TypeScript across every package
pnpm build            # production build of the web app
pnpm constants:check  # validate constants against the schema, sources and dates
```

CI (`.github/workflows/ci.yml`) runs the constants check, typecheck, tests and build.

## Repository layout

```
packages/constants      Sourced constants (data/*.json), schema, check script and a content hash
packages/sizing-engine  Pure TypeScript sizing engine: forward, reverse, topology and model comparison
apps/web                React + EUI web app (Vite)
docs/SPEC.md            The specification, including the §11 test cases
docs/DECISIONS.md       Decisions D1 onward: every departure from or refinement of the spec
docs/SIZING_REFERENCE.md  Background on the sizing method
```

The engine has no I/O and no clock, so the same request and constants always give the same result. Results carry the constants hash they were computed with.

## Working on it

- **Constants** carry a source and an as-of date. Change them through the Configurations page or the JSON files, then run `pnpm constants:check`.
- **Citations are enforced.** `packages/sizing-engine/test/citations.test.ts` fails if a math step cites a constant it did not read, or if a constant changes the result without being cited.
- **Spec tests** in `packages/sizing-engine/test` mirror §11 of the spec. When an expectation changes, the reason is recorded in `docs/DECISIONS.md`, not only in the test.
- **Conventions** for the web app (no EuiAccordion, tier colors from `ui/tiers.ts` and so on) are in `CLAUDE.md`.

## Status

This is the MVP: self-managed, ECK and ECE. Elastic Cloud Hosted and Serverless estimators are planned. There is no PDF export and no BigQuery integration.
