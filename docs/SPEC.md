# SPEC.md — Elastic Cluster Sizing Calculator v2.1 (Internal Web App)

## 1. BLUF and Changelog

Build an internal, SSO-protected TypeScript web app around a pure, deterministic sizing-engine package that runs in two directions: **forward** (workload → hardware) and **reverse** (hardware → maximum supportable workload, with a named bottleneck and a confidence level). Opportunity and Account context comes **read-only from Salesforce data replicated into BigQuery**. The app never calls Salesforce directly.

**Changelog vs. v2**

| # | Change |
|---|---|
| C7 | CHANGED: Salesforce read path is now **BigQuery only**. The server queries replicated Salesforce tables (Opportunity, Account, OpportunityLineItem, Product2, User) through a GCP service identity. |
| C8 | REMOVED: All direct Salesforce connectivity. The app holds no Salesforce credentials and makes no Salesforce calls. |
| C9 | CHANGED: Salesforce write-back (v3) is deferred and unscoped. BigQuery is read-only, so v3 ships a manual path (PDF export the SA attaches in Salesforce). Any automated write path is an open question (§13). |

**Carried forward from v2**

| # | Change |
|---|---|
| C1 | REMOVED: "Data sensitivity: take only aggregate sizing numbers, never customer data." The tool is internal and stores Opportunity/Account context. |
| C3 | Hosted internal web app (SPA + BFF + Postgres, containerized, SSO). Air-gapped *customer* deployments remain a first-class sizing scenario. |
| C4 | Reverse/capacity mode: max GB/day, max retention, max agents, max vectors, max shards/indices, max ML jobs, bottleneck detection, confidence levels, hardware validation warnings. |
| C5 | Explicit overhead constants (masters, Kibana, coordinating, APM, Fleet). Regression expectations re-baselined (§11). |
| C6 | Federal constants: ECH FedRAMP High on AWS GovCloud (March 31, 2026) alongside Moderate; OMB M-26-14 retention nuance; FIPS 140-3 in 9.4 requires Platinum or Enterprise; AutoOps free for self-managed but not air-gapped. |

## 2. Product Overview and Users

- **Primary users:** Elastic SAs (presales) covering federal SIs and OEM partners. **Secondary:** SA managers and specialists reviewing scenarios.
- **Audience for outputs:** Technical customer engineers. Exports must be customer-ready and show assumptions openly.
- **Core jobs:**
  1. "Size this workload."
  2. "What can this customer's hardware do?"
  3. "Compare options (LogsDB vs. standard, BBQ vs. float32, ECH vs. self-managed)."
  4. "Tie the sizing to the Opportunity."
- **Non-goals:** Pricing quotes (ECU/VCU figures are indicative only), replacing Rally benchmarks, automated cluster deployment, and writing to Salesforce in MVP/v2.

## 3. Functional Requirements

### 3.1 Forward mode
- **FR-F1:** Inputs are workload profiles: logs, metrics, security/SIEM, APM, search/content, vector, ML, Fleet/agents. Each has GB/day or document counts, retention per tier (hot/warm/cold/frozen), replicas, index mode (standard/LogsDB/TSDS), downsampling, and growth %.
- **FR-F2:** Outputs per tier: node count, RAM, disk, and vCPU per node. Also masters, coordinating, ML, Kibana, Fleet/APM, total RAM, license units for the deployment model, license floor, shard estimates, and warnings.
- **FR-F3:** Every output number links to its formula, inputs, and constants, including each constant's `source_url` and `as_of_date` ("show the math").

### 3.2 Reverse / capacity mode
- **FR-R1:** Input is a hardware config: node groups (count, RAM, disk GB, disk type NVMe/SSD/HDD/object, vCPU, role/tier), deployment model, plus fixed workload parameters (replicas, retention, index mode, vector dims/quantization).
- **FR-R2:** Solve for one variable at a time: max GB/day for a retention; max retention for a GB/day; max Elastic Agents; max vectors; max shards/indices; max concurrent ML jobs.
- **FR-R3:** Report the binding constraint (storage, disk, heap/shard, CPU/ingest, off-heap/vector, query, Fleet), headroom on every other constraint, and a confidence level per constraint.
- **FR-R4:** Hardware validation warnings (§5.7) are always evaluated.

### 3.3 Scenario comparison
- **FR-C1:** 2–4 scenarios side by side with a delta table: nodes, RAM, license units, license floor, warnings.
- **FR-C2:** One-click variants: LogsDB on/off, BBQ vs. float32, +1 replica, switch deployment model.

### 3.4 Opportunity context via BigQuery (v2, read-only)
- **FR-S1:** Search Opportunities by name or ID. Load Opportunity, Account, and line items from BigQuery. Pre-fill the scenario header and any mapped sizing fields.
- **FR-S2:** Deep link `/?opp=006XXXXXXXXXXXXXXX` opens or creates the scenario set for that Opportunity.
- **FR-S3:** Scenarios are stored keyed by `sf_opportunity_id` (18-character ID, normalized from 15 if needed).
- **FR-S4:** Every Opportunity view shows a **"Data as of"** timestamp from the replication pipeline so SAs know how stale the CRM data is.

### 3.5 Export
- **FR-E1:** Customer-ready PDF and Markdown: architecture summary, node table, assumptions, warnings, "estimate, not benchmark" disclaimer, recommended Rally plan.
- **FR-E2:** Internal JSON export with engine version and constants hash, so results are reproducible.
- **FR-E3:** The PDF filename and header include the Opportunity name and ID so the SA can attach it to the Opportunity in Salesforce manually.

### 3.6 Salesforce write-back (v3, deferred)
- **FR-W1:** Not in scope for MVP or v2. v3 delivers the manual path (FR-E3). An automated write path requires a design decision with the Salesforce admin team (§13).

## 4. Architecture and Tech Stack

```mermaid
flowchart LR
  U[SA browser] -->|OIDC SSO| W[React SPA (Vite)]
  W -->|same-origin /api, httpOnly session cookie| B[BFF: Node 22 + Fastify (TS)]
  W -. imports .-> E[(packages/sizing-engine\npure TS, zero deps)]
  B -. imports .-> E
  B --> P[(Postgres: scenarios, opp cache, audit)]
  B -->|service identity, parameterized SQL, read-only| Q[(BigQuery: replicated Salesforce tables)]
  B --> R[PDF renderer (headless Chromium)]
  C[(constants/*.json\nversioned)] --> E
```

**Stack decisions and rationale**

| Layer | Choice | Why |
|---|---|---|
| Monorepo | pnpm workspaces: `packages/sizing-engine`, `packages/constants`, `apps/web`, `apps/api` | Engine is testable in isolation. One language across the stack. |
| Engine | TypeScript, pure functions, no I/O, no `Date.now()`, no randomness | Deterministic. Runs in the browser for instant recalculation and on the server for export and audit. |
| Front end | React 18 + Vite + TanStack Query + a component library | Fast SPA; SSR not needed for an internal tool. |
| BFF | Node 22 + Fastify + zod validation + `@google-cloud/bigquery` | Shares engine types. Owns all BigQuery access. |
| DB | Postgres 16 (prod), SQLite (local dev) via Drizzle ORM | Scenarios as JSONB plus indexed columns (opp ID, owner). Also caches Opportunity snapshots. |
| Auth | OIDC Authorization Code + PKCE against the corporate IdP; server-side sessions | Confirm IdP and group claims with IT (§13). |
| Tests | Vitest (unit), fast-check (property-based), Playwright (e2e) | Covers §11 suites. |
| Deploy | Docker image on the approved internal platform; secrets via the approved secret manager | Prefer running on GCP so the BFF can use an attached service identity with no key files. |

**Security baseline**
- BigQuery access uses a dedicated service identity with **read-only** IAM on the Salesforce dataset. No downloadable service account keys; use an attached identity or Workload Identity Federation.
- All BigQuery queries run server-side and are parameterized. The browser never receives GCP credentials or raw query access.
- The CSP disallows third-party origins.
- An audit log records who viewed which Opportunity and who saved which scenario.

## 5. Sizing Engine Spec

### 5.1 Forward formulas (per tier)

```
indexed_GB_day   = Σ_profiles raw_GB_day × index_ratio(mode) × downsample_factor(tier)
total_data_GB    = indexed_GB_day × retention_days(tier) × (replicas(tier) + 1)
total_storage_GB = total_data_GB × (1 + watermark_headroom 0.15 + margin 0.10)   // = ×1.25
node_capacity_GB = min(RAM_node × mem_disk_ratio(tier), disk_node_GB)
data_nodes(tier) = ROUNDUP(total_storage_GB / node_capacity_GB) + 1              // +1 failover
```

- Index ratios: standard 1.2, LogsDB 0.5, TSDS 0.3.
- **Frozen:** replicas = 0, no ×1.25 (data sits in the object store). `frozen_nodes = ROUNDUP(indexed_GB_day × days / (RAM × 1500)) + 1`.
- **Cold:** fully mounted searchable snapshots, replicas = 0, ×1.25 applies to local disk.
- **Heap:** `min(0.5 × RAM, 31 GB)`.
- **Vector off-heap budget per node:** `RAM − heap − 1 GB` (32 GB on a 64 GB node).

Source: Elastic, "Benchmarking and sizing your Elasticsearch cluster for logs and metrics" (https://www.elastic.co/blog/benchmarking-and-sizing-your-elasticsearch-cluster-for-logs-and-metrics).

### 5.2 Overhead constants

- **Dedicated masters:** <6 data nodes: none (co-located). 6–20: 3 × 16 GB. 21–50: 3 × 32 GB. >50: 3 × 64 GB. Also enforce master heap ≥ 1 GB per 3,000 indices.
- **Kibana:** 1 × 8 GB if <6 data nodes, else 2 × 8 GB (HA).
- **Coordinating nodes:** 32 GB each.
- **APM Server:** 2 × 8 GB.
- **Fleet Server:** per §5.4 table. ECK does not count Elastic Agent toward license usage.
- **ML nodes:** 64 GB; `ml_jobs_per_node = 30` (heuristic, Low confidence).

### 5.3 Reverse (capacity) formulas

Invert each constraint separately; the cluster maximum is the minimum across constraints. Apply N−1 (remove the largest node per tier) before inverting.

```
usable_capacity(tier) = Σ_{nodes except largest} min(RAM_i × ratio(tier), disk_i)
max_total_data        = usable_capacity / 1.25
max_GB_day(storage)   = max_total_data / (retention × (replicas+1) × index_ratio)
max_retention         = floor(max_total_data / (GB_day × (replicas+1) × index_ratio))
max_GB_day(frozen)    = (N_frozen−1) × RAM × 1500 / (frozen_days × index_ratio)
max_vectors           = Σ_{N−1} offheap_budget / ((bytes_per_vector + 4×m) × (replicas+1))
   bytes_per_vector: float32 = 4d; int8 = d+4; int4 = d/2+4; bbq = d/8+14
max_shards            = (N_nonfrozen − 1) × 1000
max_indices(masters)  = master_heap_GB × 3000
max_ML_jobs           = (N_ml − 1) × ml_jobs_per_node
max_agents            = Fleet table lookup (largest row whose Fleet memory ≤ config)
                        AND hot-tier floor from the same table
max_GB_day(cpu)       = usable_vCPU × ev_per_s_per_vCPU × avg_event_KB × 86,400 / 1e6 / (replicas+1)
```

**Discrete-inversion rule.** Forward uses ROUNDUP, so reverse returns the supremum of inputs that still map to the given node count: `forward(reverse(hw)).nodes ≤ hw.nodes`, and `forward(reverse(hw) + ε).nodes > hw.nodes` for the binding tier.

**Solve tiers jointly for max GB/day:** min over hot, warm, cold, frozen, CPU, and shard ceiling. Report the binding tier.

### 5.4 Workload profiles and reference data

- **Logs / SIEM:** LogsDB is the default for `logs-*-*` data streams in 9.0+ ("up to 65%" storage reduction; 10–20% indexing cost). Index ratio default 0.5, editable.
- **Metrics:** TSDS ratio 0.3. Downsampling factor is user input; default 0.1 after 1-hour downsampling (Low confidence).
- **Vectors** (Elastic "Tune approximate kNN search"): float = `n×d×4`; int8 = `n×(d+4)`; int4 = `n×(d/2+4)`; bbq = `n×(d/8+14)`; HNSW graph = `n×4×m`, default m = 16. RAM is filesystem cache, separate from heap. Quantized indexes keep raw floats on disk (+25% int8, +12.5% int4, +3.125% bbq disk). DiskBBQ (`bbq_disk`) modeled separately, Low confidence.
- **Fleet** (Elastic "Fleet Server scalability"):

| Agents | Fleet Server memory | Fleet Server vCPU | ES hot tier (min) |
|---|---|---|---|
| 2,000 | 2 GB | up to 8 | 32 GB / 8 vCPU |
| 5,000 | 4 GB | up to 8 | 32 GB / 8 vCPU |
| 10,000 | 8 GB | up to 8 | 128 GB / 32 vCPU |
| 15,000 | 8 GB | up to 8 | 256 GB / 64 vCPU |
| 25,000 | 8 GB | up to 8 | 256 GB / 64 vCPU |
| 50,000 | 8 GB | up to 8 | 384 GB / 96 vCPU |
| 75,000 | 8 GB | up to 8 | 384 GB / 96 vCPU |
| 100,000 | 16 GB | 16 | 512 GB / 128 vCPU |

  Enforce ≤1,000 agent policies per Fleet instance. At ≥10k agents, set `xpack.security.authc.api_key.cache.max_keys` to 2× agents. Serverless caps at 10k agents per project.
- **ML:** Runs outside the JVM heap.

### 5.5 Deployment adapters

| Adapter | License / consumption unit | Rules |
|---|---|---|
| Self-managed | ERU = ROUNDUP(total RAM GB / 64) | Elasticsearch plus Kibana RAM. Confirm per contract whether Kibana/APM count. |
| ECK | ERU from container `resources.limits.memory` × replicas; if unset, `-Xmx` × 2. Summed in GiB. | Elastic Agent, Beats, Maps not counted. Refreshes every 2 minutes. |
| ECE | ERU on allocator capacity | Allocators 128–256 GB; 28 GB reserved on multi-role hosts; plan to 85% capacity. Control plane: 3 directors, 2 each of other roles. |
| ECH | GB RAM-hours (ECU = $1 list) | Indicative only. FedRAMP Moderate and High on AWS GovCloud. |
| Serverless | VCUs (1 GB RAM) | No node counts; indicative VCUs. 10k agents per project. |

### 5.6 License-floor logic
`floor = max(required(features))`:
- Frozen/searchable snapshots → Enterprise
- ML or CCR → Platinum
- FIPS 140-3 (9.4+ or 8.19.15+ self-managed) → Platinum
- Full LogsDB capabilities → Enterprise (basic LogsDB on Standard/Gold/Platinum)
- AutoOps → free on all tiers; `requires_internet = true`; suppressed for air-gapped scenarios

### 5.7 Hardware validation rules

| ID | Condition | Severity |
|---|---|---|
| HV1 | Node RAM > 64 GB (data/master) | Warn: split nodes. Allowed for ML/frozen with a note. |
| HV2 | Heap > 31 GB or > 50% of RAM | Error |
| HV3 | HDD on hot or content tier | Error |
| HV4 | Mem:disk outside tier band: hot 1:15–1:45 (target 1:30); warm 1:100–1:160; frozen ~1:1500 | Warn, show effective ratio |
| HV5 | Disk < RAM × ratio | Info: disk-bound; reverse mode uses disk |
| HV6 | <3 master-eligible nodes, even number of dedicated masters, or ≥6 data nodes without dedicated masters | Error/Warn |
| HV7 | Projected disk > 85% low watermark, or headroom < 15% at max workload | Warn (watermarks 85/90/95) |
| HV8 | Shards per non-frozen node > 1,000, or avg shard size outside 10–50 GB / > 200M docs | Warn |
| HV9 | Single node per tier with replicas ≥ 1 | Error |
| HV10 | Air-gapped scenario with AutoOps / Cloud Connect selected | Error |
| HV11 | vCPU:RAM < 1:8 on hot | Warn: likely CPU-bound |
| HV12 | Agents exceed table row for configured Fleet memory, or hot tier below table floor | Warn |

### 5.8 Bottleneck detection and confidence
`utilization = demand / capacity` per constraint. Binding = highest utilization (forward) or lowest max (reverse).

| Constraint | Confidence | Basis |
|---|---|---|
| Storage / disk | High | Deterministic; only index ratio uncertain (±30%) |
| Frozen | Medium | 1:1500 is query-pattern dependent |
| Heap / shards / masters | Medium | Documented limits |
| Vector off-heap | Medium (HNSW), Low (DiskBBQ) | Documented formulas; GitHub issue #117877 reports BBQ overhead above formula |
| Fleet | Medium | Official test table |
| CPU / ingest | **Low** | Heuristic (§5.9) |
| Query | **Low / not modeled** | Requires Rally with customer queries |
| ML | Low | Depends on job type and model memory |

### 5.9 Ingest-per-vCPU heuristic
Published Elastic numbers range from ~2.7K docs/s per vCPU (Metricbeat, 2020 sizing blog) to ~9.2K (http_logs, same blog) and ~3.5K (2024 Rally ingest-only blog, which warns its numbers are not a reference point).

Engine default: `ev_per_s_per_vCPU = 1,500` (conservative), sensitivity band 1,000–3,000, derated for ingest pipelines (up to ~50% slower), LogsDB (−10 to −20%), and concurrent search (−20%). Confidence is always Low; UI shows "Rally required."

## 6. Constants File

**Schema (`packages/constants/constants.schema.json`):**
```json
{ "$id": "constant", "type": "object",
  "required": ["key","value","unit","source_url","as_of_date","stack_version","confidence"],
  "properties": {
    "key": {"type":"string"}, "value": {}, "unit": {"type":"string"},
    "source_url": {"type":"string","format":"uri"}, "as_of_date": {"type":"string","format":"date"},
    "stack_version": {"type":"string"}, "confidence": {"enum":["high","medium","low"]},
    "notes": {"type":"string"}, "carried_forward": {"type":"boolean"} } }
```

**Initial constants (excerpt).** Mark any constant not re-verified as `carried_forward: true`.

| key | value | source | as_of |
|---|---|---|---|
| index_ratio.standard / logsdb / tsds | 1.2 / 0.5 / 0.3 | Elastic sizing blog; LogsDB docs | 2026-09 |
| storage_overhead | 1.25 | Elastic sizing blog | 2026-09 |
| mem_disk.hot / warm_min / warm_max / frozen | 30 / 100 / 160 / 1500 | Elastic sizing blog; frozen carried forward | 2026-09 |
| heap_fraction / heap_cap_gb | 0.5 / 31 | Elastic heap guidance | 2026-09 |
| node_ram_practical_max_gb | 64 | Elastic guidance | 2026-09 |
| shard_size_gb_min / max / docs_max | 10 / 50 / 200,000,000 | "Size your shards" docs | 2026-09 |
| max_shards_per_nonfrozen_node | 1000 | Search Labs shard blog | 2026-09 |
| master_indices_per_gb_heap | 3000 | carried forward | 2026-09 |
| watermarks | 0.85 / 0.90 / 0.95 | ES disk allocation docs | 2026-09 |
| knn.* | per §5.4; hnsw_m = 16 | "Tune approximate kNN search" docs | 2026-09 |
| bbq_default_min_dims | 384 (default since 9.1) | carried forward | 2026-09 |
| fleet.table | §5.4 | "Fleet Server scalability" docs | 2026-09 |
| eru_gb | 64 | ECK licensing docs | 2026-09 |
| ev_per_s_per_vCPU | 1500 (low) | derived from Elastic blogs (§5.9) | 2026-09 |
| fedramp.ech | Moderate + High (AWS GovCloud, 2026-03-31) | Elastic press release | 2026-09 |
| omb_m2614 | searchable 6 mo / retrievable 12 mo; L3 = 3 mo searchable | M-26-14 Appendix B/C | 2026-09 |

CI rule: fail if any constant lacks `source_url` or has `as_of_date` older than 12 months.

## 7. Data Model (TypeScript)

```ts
type Tier = 'hot'|'warm'|'cold'|'frozen'|'content';
type DeploymentModel = 'self_managed'|'eck'|'ece'|'ech'|'serverless';
type IndexMode = 'standard'|'logsdb'|'tsds';
type Quant = 'float32'|'int8'|'int4'|'bbq'|'bbq_disk'|'bfloat16';

interface WorkloadProfile {
  id: string; kind: 'logs'|'metrics'|'siem'|'apm'|'search'|'vector'|'ml'|'fleet';
  rawGbPerDay?: number; indexMode?: IndexMode; indexRatioOverride?: number;
  retentionDays: Partial<Record<Tier, number>>; replicas: Partial<Record<Tier, number>>;
  downsampleFactor?: Partial<Record<Tier, number>>; growthPctPerYear?: number;
  vector?: { count: number; dims: number; quant: Quant; hnswM?: number };
  ml?: { anomalyJobs: number; trainedModelsGb?: number };
  fleet?: { agents: number; defend: boolean };
  avgEventKb?: number; ingestPipelines?: boolean; airGapped?: boolean;
}
interface NodeGroup { role: Tier|'master'|'ml'|'coordinating'|'kibana'|'fleet'|'apm';
  count: number; ramGb: number; diskGb: number; diskType: 'nvme'|'ssd'|'hdd'|'object';
  vcpu: number; heapGbOverride?: number; }
interface HardwareConfig { model: DeploymentModel; groups: NodeGroup[]; sites?: number; ccr?: boolean; }
type Solve = 'max_gb_day'|'max_retention'|'max_agents'|'max_vectors'|'max_shards'|'max_ml_jobs';
interface ReverseRequest { hardware: HardwareConfig; fixed: WorkloadProfile[]; solve: Solve; targetProfileId?: string; }
interface Constraint { name: 'storage'|'disk'|'frozen'|'heap_shards'|'masters'|'vector_offheap'|
  'cpu_ingest'|'query'|'fleet'|'ml'; capacity: number; demand?: number; maxValue?: number;
  unit: string; confidence: 'high'|'medium'|'low'; binding: boolean; math: MathStep[]; }
interface MathStep { label: string; expr: string; value: number; constantKeys: string[]; }
interface Warning { id: string; severity: 'info'|'warn'|'error'; message: string; }
interface SizingResult { engineVersion: string; constantsHash: string;
  tiers: { tier: Tier; nodes: number; ramGb: number; diskGb: number; vcpu: number }[];
  overhead: NodeGroup[]; totalRamGb: number; licenseUnits: { unit: 'ERU'|'ECU_hr'|'VCU'; value: number };
  licenseFloor: 'basic'|'platinum'|'enterprise'; constraints: Constraint[]; warnings: Warning[]; }
interface OpportunityContext {           // read-only, sourced from BigQuery
  opportunityId: string /*18-char*/; accountId: string; oppName: string; accountName: string;
  stage: string; closeDate: string; amount?: number; ownerName?: string;
  lineItems: { productName: string; productCode?: string; quantity: number }[];
  mappedFields: Record<string, string | number | boolean | null>;   // per bq-mapping.json
  dataAsOf: string;                       // replication timestamp from BigQuery
  fetchedAt: string; }
interface Scenario { id: string; ownerEmail: string; name: string; mode: 'forward'|'reverse';
  workloads: WorkloadProfile[]; hardware?: HardwareConfig; reverse?: ReverseRequest;
  result: SizingResult; opp?: OpportunityContext; createdAt: string; updatedAt: string; version: number; }
```

Postgres tables:
- `scenarios`: `id`, `owner_email`, `sf_opportunity_id` (indexed, nullable), `payload` (JSONB), `engine_version`, `constants_hash`, timestamps.
- `opp_cache`: `sf_opportunity_id` (PK), `payload` (JSONB), `data_as_of`, `fetched_at`.
- `audit_log`: `user_email`, `action`, `sf_opportunity_id`, `scenario_id`, `at`.

## 8. Opportunity Data via BigQuery (Read-Only)

### 8.1 Source
Salesforce objects are already replicated into BigQuery by an existing internal pipeline. The app reads from that dataset only. It has no Salesforce credentials and makes no Salesforce API calls.

Required tables (names are placeholders; confirm in §13):

| Salesforce object | BigQuery table (placeholder) | Fields used |
|---|---|---|
| Opportunity | `${BQ_PROJECT}.${BQ_DATASET}.opportunity` | Id, Name, StageName, CloseDate, Amount, Type, IsClosed, IsDeleted, AccountId, OwnerId, LastModifiedDate, sizing custom fields |
| Account | `…account` | Id, Name, Industry, Type, IsDeleted |
| OpportunityLineItem | `…opportunity_line_item` | Id, OpportunityId, Product2Id, Quantity, IsDeleted |
| Product2 | `…product_2` | Id, Name, ProductCode |
| User | `…user` | Id, Name |

### 8.2 Access and IAM
- Dedicated service identity for the BFF, e.g., `sizing-calc-bq-reader@<project>.iam.gserviceaccount.com`.
- Grant `roles/bigquery.dataViewer` on the Salesforce dataset (or on authorized views only, preferred) and `roles/bigquery.jobUser` on the project that runs query jobs.
- No key files. Use the runtime's attached identity or Workload Identity Federation.
- **Preferred pattern:** the data team publishes **authorized views** that expose only the columns above. The app queries the views, never the raw tables. This keeps least privilege and insulates the app from replication schema changes.

### 8.3 Queries (parameterized; never string-concatenate user input)

The replication may be snapshot-style (one row per record) or append-style (one row per change). If append-style, dedupe to the latest version with `QUALIFY`.

```sql
-- Load by ID
WITH opp AS (
  SELECT * FROM `${BQ_PROJECT}.${BQ_DATASET}.opportunity`
  WHERE Id = @oppId AND NOT IsDeleted
  QUALIFY ROW_NUMBER() OVER (PARTITION BY Id ORDER BY LastModifiedDate DESC) = 1
)
SELECT o.Id, o.Name, o.StageName, o.CloseDate, o.Amount, o.Type,
       a.Id AS AccountId, a.Name AS AccountName, a.Industry,
       u.Name AS OwnerName,
       ARRAY(
         SELECT AS STRUCT p.Name AS productName, p.ProductCode AS productCode, li.Quantity AS quantity
         FROM `${BQ_PROJECT}.${BQ_DATASET}.opportunity_line_item` li
         JOIN `${BQ_PROJECT}.${BQ_DATASET}.product_2` p ON p.Id = li.Product2Id
         WHERE li.OpportunityId = o.Id AND NOT li.IsDeleted
       ) AS lineItems
FROM opp o
LEFT JOIN `${BQ_PROJECT}.${BQ_DATASET}.account` a ON a.Id = o.AccountId
LEFT JOIN `${BQ_PROJECT}.${BQ_DATASET}.user` u ON u.Id = o.OwnerId;

-- Typeahead (limit 20)
SELECT o.Id, o.Name, a.Name AS AccountName, o.StageName, o.CloseDate
FROM `${BQ_PROJECT}.${BQ_DATASET}.opportunity` o
LEFT JOIN `${BQ_PROJECT}.${BQ_DATASET}.account` a ON a.Id = o.AccountId
WHERE NOT o.IsDeleted AND NOT o.IsClosed
  AND (LOWER(o.Name) LIKE CONCAT('%', LOWER(@term), '%') OR o.Id = @term)
ORDER BY o.LastModifiedDate DESC
LIMIT 20;

-- Freshness
SELECT MAX(<replication_timestamp_column>) AS dataAsOf
FROM `${BQ_PROJECT}.${BQ_DATASET}.opportunity`;
```

The dedupe `QUALIFY` and the replication timestamp column name depend on the pipeline; make both configurable.

### 8.4 Field mapping (`bq-mapping.json`; custom column names are placeholders)

| Calculator field | BigQuery column | Notes |
|---|---|---|
| opp.oppName | opportunity.Name | |
| opp.accountName | account.Name | |
| stage / closeDate / amount | StageName / CloseDate / Amount | Amount shown only to authorized roles |
| lineItems | line items + product_2.Name / Quantity | Hints at deployment model (Cloud vs. self-managed SKUs) |
| workload.rawGbPerDay | `Data_Volume_GB_Day__c` (assumed) | Pre-fill only; SA confirms |
| hardware.model | `Deployment_Type__c` (assumed picklist) | Map picklist values to DeploymentModel |
| retention | `Retention_Days__c` (assumed) | |
| airGapped / federal | `Air_Gapped__c`, account.Industry (assumed) | Drives HV10 and FedRAMP notes |

At startup, the BFF reads `INFORMATION_SCHEMA.COLUMNS` for the Opportunity table and queries only mapped columns that exist, so missing custom fields degrade gracefully.

### 8.5 Access control
The service identity can read every Opportunity in the dataset, so Salesforce record sharing does **not** apply automatically. Pick one (confirm in §13):
1. **All SAs see all Opportunities** (simplest; matches many internal-tool policies).
2. **Row-level security in BigQuery** (row access policies or authorized views filtered by the caller's email, passed as a query parameter from the verified SSO session).
3. **App-level filtering** by owner/team using the User and Opportunity team data.

Amount visibility is controlled by an SSO group claim regardless of option.

### 8.6 Cost, caching, errors
- **Cost:** Set `maximumBytesBilled` on every query job (e.g., 1 GB). Prefer clustered/partitioned views on `Id`. Typeahead should hit a small view, not the full history table.
- **Caching:** Opportunity snapshot in `opp_cache` with a 15-minute TTL and a "Refresh" button. Since replication already lags, a shorter TTL adds cost without adding freshness.
- **Freshness banner:** If `dataAsOf` is older than 24 hours (configurable), show "CRM data may be stale."
- **Errors:**

| Error | Action |
|---|---|
| Permission denied (403) | Show "Opportunity data unavailable" and log; sizing still works without it |
| Not found | "Opportunity not found in replicated data (new records may take time to appear)" |
| Bytes-billed limit exceeded | Log as a query regression; show cached data if present |
| Timeout / transient | 10 s timeout, 2 retries with jitter |
| Malformed ID | Validate 15/18-char ID and checksum client-side |

### 8.7 Write-back (v3, deferred)
BigQuery is read-only for this app. v3 ships the manual path: export a PDF named with the Opportunity name and ID for the SA to attach in Salesforce. Any automated write-back needs a separate design with the Salesforce admin team and is out of scope for this spec.

## 9. API Endpoints (BFF, JSON, zod-validated)

| Method | Path | Purpose |
|---|---|---|
| GET | /api/me | Session user and group claims |
| POST | /api/size/forward | `{workloads, model}` → SizingResult |
| POST | /api/size/reverse | ReverseRequest → SizingResult (with constraints[]) |
| POST | /api/size/compare | `{scenarios[]}` → delta table |
| GET | /api/constants | Active constants plus hash |
| GET/POST/PUT/DELETE | /api/scenarios[/:id] | CRUD; `?opp=006…` filter |
| GET | /api/opportunities?q= | Typeahead from BigQuery |
| GET | /api/opportunities/:id | Opportunity, Account, line items, dataAsOf (cached) |
| POST | /api/opportunities/:id/refresh | Bypass cache |
| POST | /api/scenarios/:id/export?format=pdf\|md\|json | Export |

Every request requires a session. State-changing routes require a CSRF token. No endpoint accepts raw SQL.

## 10. UX

- **Mode toggle:** Forward ("I have a workload") vs. Reverse ("I have hardware").
- **Fast mode:** 6 inputs (use case, GB/day, hot days, total retention, replicas, deployment model) with smart defaults. **Expert mode:** every profile, tier, ratio, and override.
- **Show-the-math drawer:** Every number expands into its MathStep chain with constant links.
- **Sensitivity panel:** Tornado chart of node count vs. ±30% index ratio, ±20% GB/day, warm 1:100–1:160, and 1,000–3,000 ev/s/vCPU.
- **Assumptions panel:** Always visible and exported verbatim, with the "Estimate, not benchmark" banner.
- **Reverse output:** Headroom bars per constraint, binding constraint highlighted, confidence badges, "Rally required" on CPU/query.
- **Opportunity header:** Name, Account, stage, close date, "Data as of" timestamp, and "Refresh."

## 11. Test Plan

### 11.1 Forward regression suite (re-baselined)
Common assumptions: 64 GB data nodes, hot 1:30 (1,920 GB/node), warm 1:160 (10,240 GB/node), frozen 1:1500 (96,000 GB/node), 1 replica, overhead per §5.2.

| # | Case | Hot math | Other tiers | Expected | Prior | Correction |
|---|---|---|---|---|---|---|
| 1 | 30 GB/day, 30d, ratio 1.2 | 30×30×2×1.2=2,160 → 2,700/1,920=1.41 → 2+1=**3** | — | 3 hot; 192+8=**200 GB; 4 ERU** | 3/200/4 | none |
| 2 | 150 LogsDB + 50 TSDS; 30d hot, 90d warm | (75+15)×30×2=5,400 → 6,750/1,920=3.52 → **5** | 90×90×2=16,200 → 20,250/10,240=1.98 → **3** | 5 hot, 3 warm; 512+48+16=**576 GB; 9 ERU** | 5/4/704/11 | 4 warm not reproducible at 1:160 |
| 3 | 2 TB/day SIEM, LogsDB, 30d hot + 335d frozen | 1,000×30×2=60,000 → 75,000/1,920=39.06 → **41** | 335,000/96,000=3.49 → **5** | 41 hot, 5 frozen; 2,944+96+16=**3,056 GB; 48 ERU** | 3,256/51 | RAM/ERU re-baselined |
| 4 | 500 GB/day TSDS; 7d hot, 30d warm, 365d frozen; downsample 0.1 | 150×7×2=2,100 → 2,625/1,920 → **3** | warm 15×30×2=900 → 1,125 → **2**; frozen 5,475 → **2** | 3/2/2; 448+48+16=**512 GB; 8 ERU** | 512/8 | none |
| 5 | APM 200 GB/day, ratio 1.2, 7d hot / 8d warm | 240×7×2=3,360 → 4,200/1,920=2.19 → **4** | 240×8×2=3,840 → 4,800 → **2** | 4 hot, 2 warm; 384+48+16+16=**464 GB; 8 ERU** | 528/9 | RAM/ERU re-baselined |
| 6 | 2 TB indexed search, ratio 1.0, 2 replicas | 6,000 → 7,500/1,920=3.9 → **5** | 2 coord × 32 GB | 5 content + 2 coord; 320+64+8=**392 GB; 7 ERU** | 448/7 | RAM only |
| 7 | 100M × 1024-d vectors, m=16, 32 GB off-heap/node | BBQ: 206 B × 100M × 2 = 41.2 GB/32 → **3 nodes** (200 GB, 4 ERU) | float32: 4,160 B × 100M × 2 = 832 GB/32=26 → **27**; 1,840 GB, **29 ERU** | BBQ 3/4 vs. float32 27/29 | float32 14/15 | Prior omitted replica |
| 8 | 60 anomaly jobs, 30 jobs/node | 60/30=2 → **3 ML** | — | +192 GB, **+3 ERU** | same | none |
| 9 | Air-gapped 2 sites, CCR, 500 GB/day/site LogsDB, 30d hot + 335d frozen | 250×30×2=15,000 → 18,750/1,920=9.77 → **11** | 83,750/96,000 → **2** | Per site: 11 hot + 2 frozen; **896 GB; 14 ERU** | ~944/~15 | Bidirectional CCR → 21 hot/site |
| 10 | 40k agents + Defend, 600 GB/day LogsDB, 30d hot + 335d frozen | 300×30×2=18,000 → 22,500/1,920=11.7 → **13** | 100,500/96,000=1.05 → **3** | 2 Fleet (8 GB, N+1), 13 hot, 3 frozen; **1,088 GB; 17 ERU** | 4 Fleet/2 frozen/1,240/20 | Fleet table: 8 GB up to 75k agents |

### 11.2 Reverse-mode suite

| # | Given | Inversion math | Expected |
|---|---|---|---|
| R1 | 3×64 GB hot, 2 TB disk, 1 replica, 30d, ratio 1.2 | 2×min(1,920, 2,000)=3,840; /1.25=3,072; /72 | **42.67 GB/day**, storage-bound (High) |
| R2 | 41×64 GB hot, LogsDB, 30d, 1 replica | 40×1,920=76,800; /1.25=61,440; /30 | **2,048 GB/day** |
| R3 | 11 hot, 500 GB/day LogsDB, solve retention | 10×1,920/1.25=15,360; /500 | **30 days** |
| R4 | 2 Fleet Servers @ 8 GB, hot 13×64 GB | Table row at 8 GB = 75,000; hot floor 384 ≤ 832 | **75,000 agents** (Medium) |
| R5 | 3×64 GB, 1 replica, 1024-d, m=16 | 64 GB off-heap; BBQ 64e9/(206×2) | **155.3M** BBQ; float32 **7.69M** |
| R6 | 3 hot, 30d, daily rollover, 1p+1r | 2,000 shards /(2×30) | **33 data streams** (Medium) |
| R7 | 3 ML @ 64 GB | 2×30 | **60 jobs** (Low) |
| R8 | R1 + 8 vCPU/node, 1 KB events | 16×1,500×1×86,400/1e6/2=**1,037 GB/day** | Binding = storage; CPU headroom ~24× (Low) |
| R9 | R1 with 1,000 GB disk/node | 2×1,000/1.25=1,600; /72 | **22.2 GB/day**, disk-bound; HV4/HV5 fire |

### 11.3 Property-based tests (fast-check)
- **P1 round-trip:** `forward(reverse(hw).max).nodes(tier) ≤ hw.nodes(tier)`; +ε pushes the binding tier over.
- **P2 monotonicity:** Node counts never decrease as GB/day, retention, replicas, or index ratio increase.
- **P3 scaling:** Doubling GB/day at fixed retention doubles storage exactly.
- **P4 determinism:** Same inputs + constants hash → same outputs (snapshot).
- **P5 license floor:** Adding frozen always yields Enterprise; removing licensed features never raises the floor.
- **P6 units:** GiB/GB conversions in the ECK adapter round-trip within 0.1%.

### 11.4 BigQuery integration tests
- Run query builders against a local fixture dataset (or the BigQuery emulator) with snapshot-style and append-style rows; assert dedupe returns the latest version and excludes `IsDeleted`.
- Assert every query sets `maximumBytesBilled` and uses named parameters.
- Assert missing custom columns are skipped, not errors.

## 12. Phased Roadmap

| Phase | Scope | Exit criteria |
|---|---|---|
| **MVP** | Engine (forward + reverse + bottleneck + confidence + HV rules), constants package with CI source checks, fast/expert UI, show-the-math, SSO, Postgres scenarios, Markdown/JSON export | §11.1–11.3 green; 2 SAs validate against 5 real deals |
| **v2** | Opportunity context via BigQuery (typeahead, load, deep links, freshness banner, cache), all five deployment adapters, comparison view, PDF export, sensitivity panel | Data team signs off on views/IAM; §11.4 green |
| **v3** | Manual write-back path (Opportunity-named PDF); calibration import from Rally race JSON and AutoOps/Stack Monitoring exports (confidence upgraded to Medium/High); ILM/index-template generator | Calibrated results within ±15% of Rally |

## 13. Open Questions to Confirm

1. **IT/Security:** IdP and group claims; approved hosting platform (GCP preferred for attached identity); secret manager; data classification for Opportunity data; audit log retention.
2. **Data team (BigQuery):**
   - Project and dataset names for replicated Salesforce data.
   - Replication style (snapshot vs. append), dedupe key, and the replication timestamp column.
   - Replication frequency / expected lag.
   - Will they publish authorized views for this app, and who owns them?
   - Actual column names for sizing custom fields (data volume, deployment type, air-gapped, retention), if any exist.
   - Billing project for query jobs and any per-project quota.
3. **Access policy:** Can all SAs see all Opportunities, or is row-level filtering required (§8.5)? Which groups may see Amount?
4. **Licensing/deal desk:** Which components count toward ERUs for self-managed and ECE (Kibana, APM, Fleet)? Current ECH/Serverless list rates for indicative pricing.
5. **Field SAs:** Default ev/s/vCPU and ML jobs-per-node values; replace with internal benchmark data if it exists.
6. **Constants carried forward without re-verification:** ECE allocator/reserve values, master heap per 3,000 indices, BBQ default at ≥384 dims since 9.1, Serverless 10k-agent cap, ECH ECU = $1.
7. **Future write-back:** Whether automated write-back to Salesforce is wanted, and through what approved path.

## 14. Caveats

- **Estimates, not benchmarks.** Storage math is reliable; CPU, query latency, and ML are not. Follow sizing with Rally: `elastic/logs` (`logging-indexing`, `logging-indexing-querying`), `elastic/security`, `http_logs` (supports `enable_logsdb`), `metricbeat`/TSDB, and `dense_vector`/`so_vector`. Run against the customer's hardware with `--pipeline=benchmark-only`, ideally with a custom track on their data.
- **Answering "what can this hardware do?":** (1) Reverse mode for storage/shard/Fleet ceilings (High/Medium). (2) CPU ceiling as a Low-confidence range. (3) Propose a scoped Rally test. (4) After deployment, calibrate with AutoOps where internet-connected; air-gapped customers use Stack Monitoring.
- **Vector formulas** understate observed BBQ memory in some reports (GitHub issue #117877). Keep a 20–25% buffer.
- **CRM data freshness.** Opportunity context is only as current as the BigQuery replication. Pre-filled fields are hints; the SA confirms every input.
- **Federal:**
  - M-26-14 Appendix B: logs "actively searchable for a minimum of 6 months" and "retrievable for a year"; retrievable allows thawing from cold storage, so frozen/searchable snapshots satisfy the 12-month leg. Maturity Level 3 requires 3 months searchable.
  - M-26-14 does not apply to national security systems or DoD/IC systems; those deals need their own retention inputs.
  - FIPS 140-2 validations moved to the historical list on September 21, 2026. New federal self-managed scenarios should default to FIPS 140-3 (9.4+ or 8.19.15+, Platinum).
