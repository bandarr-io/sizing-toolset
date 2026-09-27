# UI Review: Cluster Sizing Calculator (inputs, flow, results)

Reviewed 2026-09-26 against the running dev build (1287 px and 1024 px widths), `docs/SPEC.md` §2, §3, §10 and `docs/DECISIONS.md` D21 to D27. No source files were changed for this review.

## Who it is for, and what that asks of the UI

- **Builders:** Elastic SAs in presales, often on a call or preparing for one. They need speed on the common case (one logs or SIEM workload), and the ability to go deep without leaving the page.
- **Audience:** technical customer engineers. The answer has to be defensible: every number traceable, assumptions visible, and confidence stated honestly.
- **Two questions:** "What cluster do I need?" (forward) and "What can this hardware do?" (reverse).

So the page has three jobs: make the answer obvious, make the answer explainable, and make changing an input feel cheap. The findings below are ranked against those three.

ASSUMPTION: The SA often shares their screen with the customer, so the results column is effectively a customer-facing surface, not only an internal tool.

## Files reviewed

- **File:** @apps/web/src/App.tsx - page shell, two-column layout, forward and reverse step order
- **File:** @apps/web/src/results/ResultsPanel.tsx - pinned results column, totals, flyout launcher
- **File:** @apps/web/src/components/Results.tsx - node table, constraint bars, hardware check list
- **File:** @apps/web/src/results/ClusterMap.tsx - one tile per node, by role
- **File:** @apps/web/src/components/MathFlyout.tsx - show-the-math drawer
- **File:** @apps/web/src/calculator/WorkloadCard.tsx - per-workload inputs
- **File:** @apps/web/src/calculator/RetentionTimeline.tsx - tier bar and day inputs
- **File:** @apps/web/src/calculator/NodeSizes.tsx - per-tier node template and object storage
- **File:** @apps/web/src/calculator/HardwareGroups.tsx - reverse-mode hardware rows
- **File:** @apps/web/src/calculator/Toolbar.tsx - mode switch, scenario name, save, export
- **File:** @apps/web/src/ui/Section.tsx - numbered step chrome
- **File:** @apps/web/src/ui/tiers.ts - tier and role colors

---

## 1. Fix first: things that are wrong or mislead

### 1.1 Frozen tier inputs no longer match the model (D27)
The Node sizes table shows frozen with a `1:1500` mem:disk ratio, the label "GB searchable per GB RAM", and a disk placeholder of `1,920 GB`. The engine (D27) now sizes frozen from `frozen_local_disk_ratio = 750`, and the cluster map shows frozen nodes at **48,000 GB**. D27 also says ratio overrides do not apply to frozen, but the input is still editable.

- A user who types a frozen ratio sees nothing change.
- The disk placeholder disagrees with the result by 25x.
- The utilization flyout still labels the row "Frozen (object store) · frozen".

**Recommend:** for frozen, replace the mem:disk cell with "Cache fraction" (`frozenCacheFraction`, default 10%), show the disk placeholder from `frozen_local_disk_ratio`, and relabel the utilization row "Frozen cache".
Where: @apps/web/src/calculator/NodeSizes.tsx lines 44 to 60, `constraintLabel` in @apps/web/src/export.ts.

### 1.2 Utilization colors say "danger" for a well-sized cluster
In forward mode the engine sizes each tier to fill most of its usable capacity. Warm and cold land at 91.6%, which is the intended result, but the bars turn red (thresholds are 70% and 90% in `utilColor`). The customer reads red as "problem".

**Recommend:** in forward mode use one neutral color for every bar and mark only the binding one (bold label or accent). Keep red for over 100% in reverse or growth cases.
Where: @apps/web/src/components/Results.tsx `utilColor`, lines 39 to 43.

### 1.3 Confidence and severity share one color scale
"Low confidence" uses the same red as errors, and "medium confidence" the same yellow as warnings. CPU and query rows look broken when they are just less certain. Next to 1.2, the flyout reads as a wall of alarms.

**Recommend:** give confidence its own neutral scale: a hollow badge with 1 to 3 filled dots, or text weight only. Keep red, yellow and green for hardware checks.
Where: `CONF_COLOR` in @apps/web/src/components/Results.tsx and @apps/web/src/results/ResultsPanel.tsx.

### 1.4 "Show the math: Nodes" does not explain the node count
The Nodes drawer shows only `3 + 1 failover = 4` for each tier. It never shows why hot needs 3 (demand divided by usable capacity per node), and nothing adds up to the **17** on the card (12 data + 3 master + 2 Kibana). FR-F3 is the product's credibility, and this is the first number a customer asks about.

**Recommend:** the Nodes chain should read: storage demand, capacity per node, ceiling, plus failover, per tier, then a final sum line that includes the overhead roles.
Where: `Totals` in @apps/web/src/results/ResultsPanel.tsx line 37 filters to the `"<tier> nodes"` step only. Pass the tier's full `math` plus a synthesized total step.

---

## 2. Results column: make the answer carry itself

The column today is a summary card, a "Tightest constraint" line, four buttons that open flyouts, and a banner. At 1287 px it ends about halfway down the screen, leaving the rest of the column empty while the details sit one click away.

### 2.1 Put the cluster map inline
The cluster map is the most persuasive thing in the app: six short rows of colored tiles, with failover outlined. It fits in about 220 px, but it is hidden behind a button.

**Recommend:** render `ClusterMap` directly under the totals, and keep the flyout for the full node table. The pinned column still fits: `useFitsViewport` already unpins when the column is too tall.
❓ D23 records "cluster map ... open in flyouts". This recommendation reverses that part of D23, so it needs your call and a DECISIONS.md update.

### 2.2 Show the constraint mix, not only the tightest one
"Tightest constraint: Storage (warm) at 92%" is good. The next question is always "and how close is everything else?"

**Recommend:** add a compact strip of the top 3 constraints (thin bars, sorted by utilization), with "All constraints" opening the flyout. Sort the flyout by utilization too; today it follows engine order.

### 2.3 Surface hardware checks as sentences, grouped
"Hardware checks (3)" hides three copies of one finding (HV8 on hot, warm and cold). The fix, primary shards, lives under a collapsed "More options" in the workload card.

**Recommend:**
- Group repeated IDs: "HV8 · Shards about 250 GB on hot, warm, cold (target 50 GB)."
- Show the first finding inline in the column, in the check's own color.
- Add a "Fix" link that scrolls to the workload and opens its More options with the field focused.

Where: `WarningsPanel` in @apps/web/src/components/Results.tsx.

### 2.4 Give the headline number more weight in forward mode
Reverse mode leads with a 40 px blue answer, and it reads instantly. Forward mode leads with five equal-weight stats, and "Nodes: 17" carries the same weight as "Object storage".

**Recommend:** put one headline line in the same style as reverse, for example "**17 nodes** · 832 GB RAM · 13 ERU · Enterprise", with the secondary stats below it in smaller type. This also gives the forward and reverse cards the same shape.

### 2.5 Remove duplicate chrome
The engine version and constants hash appear twice: in the header badge and under the results. The yellow "Estimate, not benchmark" panel is always there, and it competes with the real warning color.

**Recommend:** keep the hash in the header only; it is already in exports. Restyle the disclaimer as subdued text with an info icon. It stays visible, as §10 requires, without borrowing warning yellow.

### 2.6 Number formatting in details
The CPU row shows "13,616.56 / 36,000 events/s", and the node table shows vCPU with a decimal. Use whole numbers for events/s and vCPU, and keep one decimal for percentages.
Where: `ConstraintRow` detail string in @apps/web/src/components/Results.tsx.

---

## 3. Input flow

### 3.1 Same step order in both modes
Forward is now Deployment, Workloads, Node sizes, Growth. Reverse is Question, Hardware, Workload, Deployment. Switching modes moves the deployment block from the top to the bottom.

**Recommend:** in reverse, move Deployment to step 1 to match: Deployment, Question, Hardware, Workload. At minimum, give the step the same title in both modes ("Where will it run?" versus "Deployment").
Where: `ReverseInputs` in @apps/web/src/App.tsx.

### 3.2 Collapse steps the user is done with
All four steps are always fully expanded, so the page is about 1,400 px tall for one workload. Deployment and Node sizes are "set once, rarely touched".

**Recommend:** when a step has only default values, show a one-line summary ("Self-managed · 1 site · no FIPS") with an Edit button. Expand automatically when a value differs from default. This matches the progressive disclosure D21 already uses inside workload cards.

### 3.3 Workload card: tighten the first row
Replicas sits alone on its own row under Daily ingest and Index mode, which wastes a full row. The card also repeats the kind: the title "Logs" is followed by the subtitle "Logs · Application and infrastructure logs".

**Recommend:**
- Put Daily ingest, Index mode and Replicas on one row (widths 200, 280, 100 fit in the 603 px card).
- Drop the repeated kind label from the subtitle, keeping only the description.

Where: @apps/web/src/calculator/WorkloadCard.tsx lines 80 to 147.

### 3.4 Multiple workloads need a summary
With 3 or more workloads, each full card is about 500 px, and the Node sizes step scrolls far down the page.

**Recommend:** once there are 2 or more workloads, collapse every card except the one being edited to a single line: icon, name, `summarize(p)` (already written), and a mini retention bar. Click to expand.

### 3.5 Reverse hardware table truncates values
At 1287 px the Role select shows "Fleet Serv", and the Disk field shows "1920" without room for larger values such as 10240.

**Recommend:** widen Role, or use short labels in the select ("Fleet") with the full name in the option list. Give Disk the width the Node sizes table uses (21%).
Where: @apps/web/src/calculator/HardwareGroups.tsx.

### 3.6 Solve picker takes a whole screen in reverse
Seven large cards push the hardware table below the fold, and once chosen the picker is rarely changed again.

**Recommend:** after the first choice, collapse to "Solving for: **Max Elastic Agents** · Change".

---

## 4. Visual polish

- **Color roles.** Master, Kibana, Fleet and coordinating all use the same gray (`NEUTRAL_ROLE`), so the cluster map cannot tell them apart. Give overhead roles distinct gray tones or small icons. Where: @apps/web/src/ui/tiers.ts.
- **Tier palette vs brand.** The tier colors are EUI vis colors, which is fine for data. Brand blue `#0B64DD` is used for step badges and the reverse answer. Keep brand blue for "the answer" and interactive state only, so the eye goes to the result first.
- **Section rhythm.** Every section is a bordered panel inside a bordered page. Nested workload cards add a third border. Consider borderless step panels with a divider, and keep the border for workload cards only.
- **Empty column at wide screens.** At 1600 px max width the results column is mostly empty below the card. Items 2.1 and 2.2 fill it with useful content rather than whitespace.
- **Header.** "Size Elasticsearch clusters from workloads, or find the limits of existing hardware." repeats the mode switch directly below it. Drop the description, or replace it with the scenario name so a screen-shared session shows what is being sized.

---

## 5. Suggested order of work

1. Fix the frozen inputs (1.1), bar colors (1.2), confidence colors (1.3) and the Nodes math (1.4). These affect correctness and credibility.
2. Put the cluster map and top constraints inline, and make hardware checks actionable (2.1 to 2.3). ❓ Needs a D23 decision.
3. Align the step order across modes and collapse steps left at defaults (3.1, 3.2).
4. Tighten the workload card and add multi-workload summaries (3.3, 3.4).
5. Visual polish (section 4).

❓ Opportunity header (§10, v2) will add a row above the toolbar. If 3.2 and 2.4 land first, there will be room for it without pushing the first input below the fold.
