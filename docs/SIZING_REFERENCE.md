# Elastic Sizing Calculator — Reference

This document covers what the calculator does, how the formulas work, and the decisions behind them. Intended as a reference for colleagues and as a companion to `SPEC.md` and `DECISIONS.md`.

---

## What it does

The calculator answers two questions:

- **Forward mode:** "My customer ingests X GB/day and wants Y days of retention — what hardware do they need?"
- **Reverse mode:** "My customer has this hardware — what's the maximum workload it can support?"

It sizes Elasticsearch clusters across tiers (hot, warm, cold, frozen, content/search), computes overhead nodes (masters, Kibana, APM, Fleet, ML), calculates license units (ERU), and identifies the binding constraint.

---

## Tiers

| Tier | Data type | Disk type | Replicas | Overhead multiplier |
|---|---|---|---|---|
| Hot | Recent, actively queried | NVMe | Yes | ×1.25 |
| Warm | Less recent, occasionally queried | SSD/HDD | Yes | ×1.25 |
| Cold | Rarely queried, fully mounted snapshots | SSD/HDD | No | ×1.25 |
| Frozen | Archive, partially mounted snapshots in object store | SSD (cache) | No | None (D27) |
| Content | Fixed search corpus (search use case) | NVMe | Yes | ×1.25 |

---

## Forward formulas

### 1. Index compression

Raw data is transformed on ingest. The ratio varies by index mode:

```
indexed_GB_day = raw_GB_day × index_ratio × downsample_factor
```

| Index mode | Ratio | Use case |
|---|---|---|
| standard | 1.2 | APM, generic |
| logsdb | 0.5 | Logs, SIEM (recommended) |
| tsds | 0.3 | Metrics time series |

`downsample_factor` is 1 (no downsampling) unless the workload is TSDS and the user enables downsampling (e.g., 0.1 = keep 10% of data after rollup).

### 2. Data volume per tier

```
data_GB = indexed_GB_day × retention_days × (replicas + 1)   # hot, warm, content
data_GB = indexed_GB_day × retention_days                     # cold, frozen (no replicas)
```

### 3. Storage with overhead (non-frozen)

```
storage_GB = data_GB × 1.25
```

The 1.25 multiplier covers:
- 15% Elasticsearch low-watermark headroom
- 10% operational margin

### 4. Node count (non-frozen)

```
capacity_per_node = min(RAM_GB × ratio, disk_GB)
nodes = ROUNDUP(storage_GB / capacity_per_node) + 1 failover
```

Default mem:disk ratios (GB disk per GB RAM):

| Tier | Ratio |
|---|---|
| Hot / Content | 1:30 |
| Warm | 1:160 |
| Cold | 1:160 |

If disk is smaller than `RAM × ratio`, the node is disk-bound and disk governs capacity.

### 5. Node count (frozen) — D27

Frozen data lives in object storage (S3/GCS/Azure). Nodes hold a local disk cache of the actively queried slice. Only a fraction of the total dataset needs to be cached at any time.

```
disk_per_node = RAM_GB × 750
usable_disk   = disk_per_node / 1.25
capacity      = usable_disk / cache_fraction
nodes         = ROUNDUP(data_GB / capacity) + 1 failover
```

Default `cache_fraction = 0.10` (10%). Raise toward 0.50 if the customer queries frozen data frequently. User-configurable per scenario.

**Example:** 64 GB RAM node → 48 TB local disk → 38.4 TB usable → 384 TB effective data capacity at 10% cache.

### 6. Vector sizing

Off-heap memory (filesystem page cache) is the binding resource for dense vectors.

```
off_heap_bytes_per_vector = quant_bytes_per_dim × dims + fixed_bytes + (4 × HNSW_m)
off_heap_budget_per_node  = RAM - min(0.5 × RAM, 30 GB) - 1 GB
nodes = ROUNDUP(vector_count × copies × off_heap_bytes / off_heap_budget)
```

Bytes per dimension by quantization:

| Quantization | Bytes/dim | Fixed bytes |
|---|---|---|
| float32 | 4 | 0 |
| int8 | 1 | 4 |
| int4 | 0.5 | 4 |
| bbq | 0.125 | 14 |

`copies = replicas + 1`. `HNSW_m` default = 16.

### 7. Heap and off-heap

```
heap_GB     = min(0.5 × RAM_GB, 30 GB)
off_heap_GB = RAM_GB - heap_GB - 1 GB
```

The 30 GB cap is the JVM compressed-oops safe threshold. Off-heap is used for the filesystem cache (Lucene segment files, vector indices). The 1 GB reserve is for OS overhead.

---

## Overhead nodes

### Masters

| Data nodes | Masters | RAM each |
|---|---|---|
| < 6 | 0 (co-located) | — |
| 6–20 | 3 | 16 GB |
| 21–50 | 3 | 32 GB |
| 51+ | 3 | 64 GB |

Master RAM bumps to the next row if index count would exceed heap capacity (3,000 indices per GB of heap).

### Kibana

- 1 node if fewer than 6 data nodes
- 2 nodes (HA) at 6 or more data nodes

### ML nodes

```
ml_nodes = ROUNDUP(anomaly_jobs / 30) + 1 failover
```

### Fleet Servers

Sized from Elastic's official Fleet scalability table by agent count, plus 1 redundancy node.

### APM Server

2 nodes, sized per the APM workload.

---

## ERU (license units)

```
ERU = ROUNDUP(total_counted_RAM_GB / 64)
```

Counted components: Elasticsearch (all data tiers, masters, coordinating, ML), Kibana, APM.
Not counted: Fleet Server.

### License floors

| Feature | Minimum license |
|---|---|
| Frozen tier | Enterprise |
| ML anomaly detection | Platinum |
| CCR (cross-cluster replication) | Platinum |
| FIPS mode | Platinum |
| Full LogsDB (cluster-wide) | Enterprise |

---

## Reverse formulas

### N-1 rule

Before computing capacity, remove the largest node from each tier. This sizes for surviving a single-node failure.

```
usable_GB = sum over (N-1) nodes of min(RAM × ratio, disk)
```

### Max GB/day (storage-bound)

```
max_raw_GB_day = (usable_GB / 1.25 - other_workloads_GB) / (days × (replicas+1) × index_ratio)
```

### Max GB/day (frozen-bound)

```
usable_GB      = sum over (N-1) nodes of (disk / 1.25 / cache_fraction)
max_raw_GB_day = (usable_GB - other_workloads_GB) / (days × index_ratio)
```

### Binding constraint

Every constraint (storage, disk, frozen, CPU, Fleet, shards) produces a maximum value in the same unit (GB/day, vectors, agents, etc.). The binding constraint is the lowest ceiling. All others report headroom.

### CPU ceiling (low confidence)

```
capacity_events_s = usable_vCPU × ev_per_s_per_vcpu
max_GB_day        = capacity_events_s × avg_event_KB × 86,400 / 1e6 / (replicas+1)
```

Default `ev_per_s_per_vcpu = 1,500`. Source: [Elastic benchmarking and sizing blog post](https://www.elastic.co/blog/benchmarking-and-sizing-your-elasticsearch-cluster-for-logs-and-metrics). The published range from Rally benchmarks is 1,000–3,000 events/s per vCPU depending on event size, pipeline complexity, and hardware. The 1,500 default is the conservative end of that range.

Override via `ForwardOptions.eventsPerSecondPerVcpu` (forward) or `ReverseRequest.eventsPerSecondPerVcpu` (reverse) when the customer has Rally benchmark data for their specific hardware and event schema. Always flagged as Low confidence and Rally-required.

### Disk write throughput (low confidence) — D28

An optional constraint that caps ingest based on sustained sequential write speed rather than storage volume.

```
# forward
capacity_GB_day  = usable_nodes × disk_write_MBps × 86,400 / 1,000
demand_GB_day    = Σ (raw_GB_day × index_ratio × (replicas+1))

# reverse ceiling
max_raw_GB_day   = (capacity_GB_day - other_workloads_GB_day) / (replicas+1) / index_ratio
```

Set `diskWriteMBps` on a `NodeTemplate` (forward) or `NodeGroup` (reverse) to enable this constraint. When absent, the constraint is omitted entirely. Always Low confidence and Rally-required — disk write speed is highly sensitive to write pattern, RAID layout, and competing I/O.

---

## Growth

```
effective_GB_day = raw_GB_day × (1 + growth_pct/100)^years
```

Default horizon: 1 year. Reverse mode can solve "years until full" by bisecting on the max_GB_day solver with compound growth applied to all fixed workloads.

---

## Key decisions

| ID | Topic | Decision |
|---|---|---|
| D2 | CCR | Unidirectional: data multiplier = 1 (one active site). Bidirectional: multiply ingest by site count (each site holds a follower copy). |
| D6 | ML nodes | `ROUNDUP(jobs / 30) + 1`. Platinum license floor. |
| D7 | Fleet Servers | Sized by official Fleet table + 1 redundancy node. Not counted in ERU. |
| D9 | Search / content | Fixed corpus (`totalGb`) has no retention multiplier and sits on the content tier. |
| D13 | Default tier routing | Logs / SIEM: hot then frozen. Metrics / APM: hot then warm. |
| D19 | Heap cap | 30 GB (not 31 as originally specced). JVM compressed-oops safe limit. Off-heap = 33 GB for a 64 GB node. |
| D20 | Frozen local disk | Frozen node disk defaults to RAM × 30 (same as hot) as local cache size. HV4 band check skipped for frozen (the ratio governs object-store data, not local disk). |
| D22 | Downsampling | Factor is share of data kept, in (0, 1]. Only valid on TSDS index mode. A factor other than 1 on logsdb or standard is rejected. |
| D24 | Years to capacity | Bisection on max_GB_day with compound growth. Returns the largest number of years the hardware still fits the workload. Returns infinity if no growth rate is set. |
| D25 | Tier ratio overrides | Each scenario can override the mem:disk ratio per tier. Flows through node sizing, reverse capacity, and HV5 warnings. HV4 bands stay fixed on constants. |
| D26 | Object storage | Cold and frozen data is automatically sized as one copy in a snapshot repository. No replicas, no headroom multiplier. Not counted in RAM or ERU. |
| D27 | Frozen tier model | Replaced RAM×1500 object-store ratio with disk-cache model. Capacity = disk / 1.25 / cache_fraction. Default cache fraction = 10%, user-configurable. Reflects how searchable snapshots actually work: only the actively queried slice needs to be in local cache. |
| D28 | Hardware throughput overrides | Two optional Low-confidence, Rally-required overrides. `eventsPerSecondPerVcpu` replaces the CPU constant (default 1,500). `diskWriteMBps` on a node template adds a disk write constraint (capacity = usable_nodes × MB/s × 86,400 / 1,000). Both are per-scenario and absent by default; when absent the constraint is skipped. Network bandwidth was dropped as too topology-dependent to model. |

---

## Confidence levels

| Constraint | Confidence | Notes |
|---|---|---|
| Storage (hot/warm/cold) | High | Formula is reliable; index ratio has ±30% uncertainty |
| Frozen cache | Medium | Cache fraction is workload-dependent |
| Vectors | Medium | Off-heap formula is precise; BBQ may understate by 20-25% |
| Shards / masters | Medium | Depends on rollover cadence and index count |
| CPU / ingest | Low | Requires Rally benchmark to validate. Override via `eventsPerSecondPerVcpu`. |
| Disk write | Low | Optional constraint. Requires Rally or vendor spec. Set `diskWriteMBps` on the node template to enable. |
| Query latency | Low | Not modeled; requires Rally |

---

## What the spreadsheet did differently

The v1.3.2 spreadsheet precursor used different assumptions in several areas. Major deltas:

| Parameter | Spreadsheet | App |
|---|---|---|
| Hot mem:disk | 1:50 | 1:30 |
| Warm mem:disk | 1:120 | 1:160 |
| Cold mem:disk | 1:200 | 1:160 |
| Frozen model | 5% disk cache fraction | 10% disk cache fraction (D27) |
| SIEM index ratio (no LogsDB) | 0.9 | 1.2 |
| SIEM index ratio (LogsDB) | 0.4 | 0.5 |
| Failover | MAX(calc, 3) for hot, MAX(calc, 2) for warm/cold | Always +1 per tier |
| ML sizing | 1 node per 15 data nodes | 1 node per 30 jobs |
| Fleet sizing | Ratio to data nodes | Official Fleet scalability table |
| ERU rounding | ROUND per tier, ROUNDUP at site | ROUNDUP on total |
