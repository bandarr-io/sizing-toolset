# Decisions

Gaps and contradictions in `docs/SPEC.md`, resolved with Dan on 2026-09-23. Tests cite these IDs.

| ID | Topic | Decision |
|---|---|---|
| D1 | R9 / HV4 | 1,000 GB disk on 64 GB RAM is 1:15.6, inside the hot band 1:15–1:45. R9 asserts HV5 fires and HV4 does **not**. HV4 band unchanged. |
| D2 | Case 9 CCR | Add `ccrMode: 'unidirectional' \| 'bidirectional'`. Unidirectional: 11 hot + 2 frozen per site, 896 GB, 14 ERU. Bidirectional: each site also holds the follower copy (21 hot per site). Results report per site plus a total across sites. |
| D3 | ERU / total RAM | Counts Elasticsearch (data, masters, coordinating, ML), Kibana, and APM. Fleet Server is not counted. From §11.1 cases 5 and 10. Constant `eru.counted_components`. |
| D4 | "Data nodes" | Master and Kibana thresholds count all data-tier nodes, including frozen and vector nodes. From §11.1 cases 4 and 7. |
| D5 | Coordinating nodes | Added only when the user requests them (explicit count). |
| D6 | ML nodes | ROUNDUP(jobs / ml.jobs_per_node) + 1. §11.1 case 8 is tested as an add-on to case 1. |
| D7 | Fleet Servers | Needed + 1 (`fleet.redundancy_nodes`). |
| D8 | Forward options | New `ForwardOptions`: node template per tier (RAM, disk ratio, vCPU), sites, ccrMode, airGapped, fullLogsdb, fips, coordinatingNodes, growthHorizonYears. |
| D9 | Search/content | `WorkloadProfile.totalGb` for fixed corpora (case 6). No retention multiplier. |
| D10 | Warm ratio | Forward default 1:160 (`mem_disk.warm`). |
| D11 | vCPU | Forward default vCPU = RAM / 8 (`vcpu_per_ram_gb`). |
| D12 | LogsDB license | LogsDB needs no floor unless `fullLogsdb` is set (then Enterprise). |
| D13 | Fast mode | Retention past hot goes to frozen for logs and SIEM, to warm for metrics and APM. |
| D14 | Cold ratio | 1:160, same as warm (`mem_disk.cold`), Low confidence. |
| D15 | Growth | GB/day × (1 + growthPctPerYear/100)^years, horizon default 1 year. Shown as a MathStep. |
| D16 | bfloat16 | Element type, 2 bytes per dim + HNSW graph (kNN docs). |
| D17 | bbq_disk | kNN docs formula: clusters = n/384; centroid bytes = clusters × (5d + 14); quantized bytes = n × (d/8 + 16) × 2. No HNSW graph. Low confidence, conservative (docs say only a fraction must be in memory). |
| D18 | R6 fields | `WorkloadProfile.rolloverDays` (default 1) and `primaryShards` (default 1). `max_shards` also reports max data streams. |
| D19 | Heap cap | `heap_cap_gb` = 30 (spec said 31), per JVM docs: compressed-oops threshold '26GB safe ... as large as 30GB'. Off-heap per 64 GB node = 64 − 30 − 1 = 33 GB. HV2 errors above 30 GB. §11 impact: case 7 unchanged (BBQ 41.2/33 → 2+1 = 3 nodes; float32 832/33 = 25.2 → 26+1 = 27 nodes). R5 re-baselined: 2 × 33 = 66 GB; BBQ 66e9/412 = **160.19M** (was 155.3M); float32 66e9/8,320 = **7.93M** (was 7.69M). |
| D20 | Frozen local disk | Frozen node disk defaults to RAM × 30 (shared cache). HV4 does not check frozen, because 1:1500 describes object-store data, not local disk. |
| D21 | Fast / expert (§10) | Replaced by one input model with progressive disclosure: each workload shows the §10 essentials (ingest, retention, replicas, index mode) and hides the rest under "More options". Deployment settings live in one shared section. v1 saved scenarios migrate automatically (fast inputs convert per D13). |
| D22 | Downsampling | The downsample factor is the share of data kept, in (0, 1]; 1 = none. Elasticsearch only downsamples TSDS, so a factor other than 1 on a LogsDB or standard workload is rejected (`downsampleProblem`). The UI shows the field only in TSDS mode and clears factors when leaving TSDS. |
| D23 | Results column (§10) | The whole results column is pinned with no scrollbar of its own. Utilization, node table, hardware checks and the full assumptions list open in flyouts. The "Estimate, not benchmark" banner stays visible in the column; the assumptions are still exported verbatim. |

## Open items found while building

| ID | Item |
|---|---|
| O2 | LogsDB docs now say "up to 60%" storage reduction; spec §5.4 says 65%. Index ratio 0.5 unchanged. |
| O3 | Docs now say `bbq_disk` is the default index type for float/bfloat16 vectors when the license allows; spec assumes `bbq_hnsw` at ≥384 dims. |
| O4 | 47 of 79 constants are `carried_forward` (not re-verified against a source page). Most are spec heuristics or decisions with no published figure. |
