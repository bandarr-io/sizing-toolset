import type { Formula } from './types.ts';

const A = 'Size a workload' as const;
const INDEX_RATIOS = ['index_ratio.standard', 'index_ratio.logsdb', 'index_ratio.tsds'];
const VECTOR_BYTES = ['knn.bytes.float32', 'knn.bytes.bfloat16', 'knn.bytes.int8', 'knn.bytes.int4', 'knn.bytes.bbq'];

/** Size a workload: workloads in, nodes, memory and license out (forward.ts and the modules it calls). */
export const FORMULAS: Formula[] = [
  // ---- Growth ------------------------------------------------------------------------------------
  {
    id: 'forward.growth', area: A, group: 'Growth', title: 'Data per day after growth',
    formula: 'GB per day after growth = GB per day today × (1 + growth % ÷ 100) ^ years ahead',
    explanation: 'Each workload can grow by a percentage every year. The cluster is sized for the volume at the end of the planning horizon, not for today. When no horizon is set, the default number of years is used.',
    constantKeys: ['growth.default_horizon_years'], source: 'D15, D24', code: 'profiles.ts (growthFactor), demand.ts',
  },

  // ---- Data volume ---------------------------------------------------------------------------------
  {
    id: 'forward.index_ratio', area: A, group: 'Data volume', title: 'Stored size per GB ingested',
    formula: 'stored GB per day = GB per day after growth × index ratio × share kept after downsampling',
    explanation: 'Raw data takes a different amount of disk once Elasticsearch stores it. The index ratio depends on the storage mode: standard, LogsDB (compressed logs) or TSDS (compressed metrics). Logs and SIEM default to LogsDB, metrics to TSDS, everything else to standard; a workload can set its own ratio instead.',
    constantKeys: INDEX_RATIOS, source: 'SPEC §5.1', code: 'profiles.ts (indexRatio), demand.ts',
  },
  {
    id: 'forward.downsample', area: A, group: 'Data volume', title: 'Share kept after downsampling',
    formula: 'share kept on a tier = downsample factor set on the workload (1 = keep everything)',
    explanation: 'Downsampling keeps metrics at a coarser time step on older tiers, for example 0.1 keeps a tenth of the data. It only applies to TSDS (time series) workloads; any other storage mode must keep 1.',
    constantKeys: [], source: 'D22', code: 'profiles.ts (downsampleFor)',
  },
  {
    id: 'forward.tier_data', area: A, group: 'Data volume', title: 'Data held on hot, warm or cold',
    formula: 'tier data GB = stored GB per day × days kept on the tier × (replicas + 1) × sites copying each other',
    explanation: 'A replica is a spare copy of the data on another node, so each replica adds one more copy. Cold carries no replicas because its data is backed by snapshots. With two-way cross-cluster replication every site also holds every other site\'s data, so the sites multiplier is the number of sites; otherwise it is 1.',
    constantKeys: [], source: 'SPEC §5.1, D2', code: 'demand.ts (computeDemand)',
  },
  {
    id: 'forward.frozen_data', area: A, group: 'Data volume', title: 'Data held on frozen',
    formula: 'frozen data GB = stored GB per day × days kept on frozen × sites copying each other',
    explanation: 'Frozen data lives in object storage (cheap bulk storage such as S3), so it has no replicas. The frozen nodes only cache the part that is being searched.',
    constantKeys: [], source: 'SPEC §5.1, D27', code: 'demand.ts (computeDemand)',
  },
  {
    id: 'forward.corpus_data', area: A, group: 'Data volume', title: 'Data held for a fixed set of documents',
    formula: 'content data GB = total GB × growth factor × index ratio × (replicas + 1) × sites copying each other',
    explanation: 'Search workloads hold a fixed collection of documents rather than a daily stream. The collection sits on the content tier unless the workload names another tier.',
    constantKeys: INDEX_RATIOS, source: 'SPEC §5.1', code: 'demand.ts (computeDemand)',
  },

  // ---- Storage ---------------------------------------------------------------------------------------
  {
    id: 'forward.storage_needed', area: A, group: 'Storage', title: 'Disk needed for a tier',
    formula: 'storage needed GB = tier data GB × storage overhead',
    explanation: 'Disks are never planned full. The overhead leaves room below the level where Elasticsearch stops placing data on a node (15%) plus a safety margin (10%), giving 1.25.',
    constantKeys: ['storage_overhead'], source: 'SPEC §5.1', code: 'forward.ts (sizeTier)',
  },
  {
    id: 'forward.node_size', area: A, group: 'Storage', title: 'Size of one data node',
    formula: 'node memory = memory set for the tier, else the default node memory\nnode cores = cores set for the tier, else node memory × cores per GB of memory\nnode disk = disk set for the tier, else node memory × the tier\'s mem:disk ratio',
    explanation: 'A node is one running copy of Elasticsearch. Blank fields in Node sizes and ratios take these defaults.',
    constantKeys: ['node_ram_default_gb', 'vcpu_per_ram_gb', 'mem_disk.hot', 'mem_disk.warm', 'mem_disk.cold', 'mem_disk.content'],
    source: 'D8, D11, D20', code: 'forward.ts (resolveNode)',
  },
  {
    id: 'forward.node_capacity', area: A, group: 'Storage', title: 'Data one hot, warm, cold or content node can hold',
    formula: 'storage per node = the smaller of (node memory × mem:disk ratio) and node disk',
    explanation: 'The mem:disk ratio is how many GB of disk each GB of memory looks after; beyond it, searches slow down. If the disk is smaller than that, the disk is the limit. A scenario can set its own ratio per tier.',
    constantKeys: ['mem_disk.hot', 'mem_disk.warm', 'mem_disk.cold', 'mem_disk.content'], source: 'SPEC §5.1, D25, D38', code: 'forward.ts (resolveNode), profiles.ts (tierRatio)',
  },
  {
    id: 'forward.frozen_capacity', area: A, group: 'Storage', title: 'Data one frozen node can cover',
    formula: 'frozen local disk = node memory × frozen local disk ratio (unless disk is set)\nfrozen data per node = local disk ÷ storage overhead ÷ share of frozen data cached locally',
    explanation: 'Frozen nodes keep only a cache of the data on local disk; the rest stays in object storage. With 10% cached, each GB of usable local disk covers 10 GB of frozen data.',
    constantKeys: ['frozen_local_disk_ratio', 'frozen_cache_fraction', 'storage_overhead'], source: 'D27', code: 'forward.ts (resolveNode, sizeTier)',
  },
  {
    id: 'forward.object_storage', area: A, group: 'Storage', title: 'Object storage for cold and frozen',
    formula: 'object storage GB = cold data GB + frozen data GB (one copy), unless set for the scenario',
    explanation: 'Cold and frozen data sit as snapshots in object storage such as S3. A snapshot moving from cold to frozen is the same object, so the two add up without double counting. It is not part of memory or the license.',
    constantKeys: [], source: 'D26', code: 'result.ts (objectStorageFor)',
  },

  // ---- Nodes ------------------------------------------------------------------------------------------
  {
    id: 'forward.storage_nodes', area: A, group: 'Nodes', title: 'Nodes needed for storage',
    formula: 'nodes for storage = ROUNDUP(storage needed GB ÷ storage per node)\nfrozen nodes = ROUNDUP(frozen data GB ÷ frozen data per node)',
    explanation: 'Nodes come in whole numbers, so the result always rounds up.',
    constantKeys: [], source: 'SPEC §5.1', code: 'forward.ts (sizeTier)',
  },
  {
    id: 'forward.tier_nodes', area: A, group: 'Nodes', title: 'Nodes in a data tier',
    formula: 'tier nodes = the larger of (nodes for storage, nodes for vectors) + spare nodes per tier',
    explanation: 'Each tier gets a spare node so the cluster keeps running, with room for its data, if one node fails. Vector search can need more nodes for memory than for disk.',
    constantKeys: ['failover_nodes_per_tier'], source: 'SPEC §5.1', code: 'forward.ts (sizeTier)',
  },
  {
    id: 'forward.utilization', area: A, group: 'Nodes', title: 'How full each resource is',
    formula: 'usage = demand ÷ capacity of the nodes left after removing the spare',
    explanation: 'The results list how close each limit is to running out, with the spare node set aside. The highest usage is the one that runs out first.',
    constantKeys: ['failover_nodes_per_tier'], source: 'SPEC §5.3', code: 'forward.ts (sizeTier), confidence.ts',
  },

  // ---- Memory -----------------------------------------------------------------------------------------
  {
    id: 'forward.heap', area: A, group: 'Memory', title: 'Heap on a node',
    formula: 'heap = the smaller of (heap share × node memory) and the heap cap',
    explanation: 'Heap is memory Elasticsearch reserves for its own work. It is half the node\'s memory, capped at 30 GB.',
    constantKeys: ['heap_fraction', 'heap_cap_gb'], source: 'SPEC §5.1, D19', code: 'profiles.ts (heapGb)',
  },
  {
    id: 'forward.offheap_budget', area: A, group: 'Memory', title: 'Memory left for vectors on a node',
    formula: 'vector memory per node = node memory − heap − reserve',
    explanation: 'Vector search works best when the vectors fit in the memory outside the heap. A small reserve is kept for the operating system.',
    constantKeys: ['heap_fraction', 'heap_cap_gb', 'offheap_reserve_gb'], source: 'SPEC §5.1, D19', code: 'profiles.ts (offheapBudgetGb)',
  },
  {
    id: 'forward.vector_bytes', area: A, group: 'Memory', title: 'Memory for one vector',
    formula: 'memory bytes per vector = bytes per dimension × dimensions + fixed bytes + bytes per graph link × links (m)',
    explanation: 'A vector is a list of numbers (dimensions) that acts as a fingerprint for AI search. Compression (float32, bfloat16, int8, int4, BBQ) sets the bytes per dimension. The search graph (HNSW) adds a few bytes for each link to a neighbour.',
    constantKeys: [...VECTOR_BYTES, 'knn.hnsw_bytes_per_link', 'knn.hnsw_m'], source: 'SPEC §5.4, D16, D17', code: 'profiles.ts (vectorCost)',
  },
  {
    id: 'forward.vector_disk_bytes', area: A, group: 'Memory', title: 'Disk for one vector',
    formula: 'disk bytes per vector = the larger of (4 × dimensions, compressed bytes) + 4 × dimensions × extra raw copy share + graph bytes\n(bfloat16 keeps only its compressed bytes plus the graph)',
    explanation: 'Compressed vectors keep the full-size numbers on disk too, so results can be re-checked for accuracy. The extra share covers that raw copy for int8, int4 and BBQ.',
    constantKeys: [...VECTOR_BYTES, 'knn.raw_disk_overhead.int8', 'knn.raw_disk_overhead.int4', 'knn.raw_disk_overhead.bbq', 'knn.hnsw_bytes_per_link', 'knn.hnsw_m'],
    source: 'SPEC §5.4, D16, D17', code: 'profiles.ts (vectorCost)',
  },
  {
    id: 'forward.vector_bbq_disk', area: A, group: 'Memory', title: 'Memory and disk for one Disk BBQ vector',
    formula: 'centroid bytes = (centroid bytes per dimension × dimensions + fixed) ÷ vectors per cluster\ncompressed bytes = (bytes per dimension × dimensions + fixed) × copies\nmemory bytes = centroid bytes + compressed bytes\ndisk bytes = 4 × dimensions + centroid bytes + compressed bytes',
    explanation: 'Disk BBQ groups vectors into clusters and keeps most of them on disk. Only the cluster centres and the compressed vectors need memory.',
    constantKeys: ['knn.bbq_disk'], source: 'SPEC §5.4', code: 'profiles.ts (vectorCost)',
  },
  {
    id: 'forward.vector_totals', area: A, group: 'Memory', title: 'Memory and disk for all vectors',
    formula: 'vector memory GB = vectors × growth factor × memory bytes per vector × (replicas + 1) × sites ÷ 1,000,000,000\nvector disk GB = the same with disk bytes per vector',
    explanation: 'Every copy of the data carries its own vectors. The disk figure is added to the tier\'s data.',
    constantKeys: [], source: 'SPEC §5.1, §5.4', code: 'demand.ts (computeDemand)',
  },
  {
    id: 'forward.vector_nodes', area: A, group: 'Memory', title: 'Nodes needed for vectors',
    formula: 'nodes for vectors = ROUNDUP(vector memory GB ÷ vector memory per node)',
    explanation: 'When the vectors need more memory than the storage-based node count gives, the tier grows to fit them.',
    constantKeys: [], source: 'SPEC §5.1, D19', code: 'forward.ts (sizeTier)',
  },

  // ---- Processing -------------------------------------------------------------------------------------
  {
    id: 'forward.ingest_demand', area: A, group: 'Processing', title: 'Events per second to process',
    formula: 'events per second = GB per day after growth × 1,000,000 ÷ (event size KB × 86,400) × (replicas + 1) ÷ slowdown factor × sites copying each other',
    explanation: 'Incoming data is split into events of an average size. Every copy of an event is processed again on another node, so replicas multiply the work. Slowdowns such as ingest pipelines raise the effective demand.',
    constantKeys: ['ingest.default_avg_event_kb'], source: 'SPEC §5.3, §5.9', code: 'cpu.ts (ingestDemandEvents), forward.ts',
  },
  {
    id: 'forward.ingest_slowdown', area: A, group: 'Processing', title: 'Slowdown factor for processing',
    formula: 'slowdown factor = (1 − pipeline slowdown if ingest pipelines are used) × (1 − LogsDB slowdown if LogsDB) × (1 − search slowdown if heavy concurrent search)',
    explanation: 'Ingest pipelines reshape data on the way in, LogsDB compresses it, and heavy searching competes for the same processors. Each one lowers how many events a core can take in.',
    constantKeys: ['ingest.derate.pipelines', 'ingest.derate.logsdb', 'ingest.derate.concurrent_search'], source: 'SPEC §5.9', code: 'cpu.ts (derateFactor)',
  },
  {
    id: 'forward.ingest_capacity', area: A, group: 'Processing', title: 'Events per second the cluster can process',
    formula: 'capacity = (hot nodes − spare) × cores per node × events per second per core',
    explanation: 'Processing is checked on the tier that receives new data: hot, or content when there is no hot tier. This is a rough estimate; test it with Rally, Elastic\'s benchmarking tool.',
    constantKeys: ['failover_nodes_per_tier', 'vcpu_per_ram_gb', 'ev_per_s_per_vcpu'], source: 'SPEC §5.3', code: 'forward.ts',
  },
  {
    id: 'forward.disk_write', area: A, group: 'Processing', title: 'Disk write speed',
    formula: 'write capacity GB per day = (hot nodes − spare) × MB per second per node × 86,400 ÷ 1,000\nwrite demand GB per day = Σ GB per day after growth × index ratio × share kept × (replicas + 1) × sites',
    explanation: 'Only checked when a disk write speed is entered for the node. Every copy of the data is written to disk.',
    constantKeys: ['failover_nodes_per_tier', ...INDEX_RATIOS], source: 'D28', code: 'forward.ts',
  },

  // ---- Shards -----------------------------------------------------------------------------------------
  {
    id: 'forward.rollover', area: A, group: 'Shards', title: 'How often a fresh index starts',
    formula: 'days per index = the days set on the workload, else the smaller of\n  (largest primary shard GB × primary shards ÷ stored GB per day on the first tier) and the maximum age in days',
    explanation: 'Elasticsearch starts a fresh index (rolls over) when a primary shard reaches its size limit or the index reaches its maximum age, whichever comes first. A shard is a slice of an index spread across nodes. Without a daily volume, the maximum age applies.',
    constantKeys: ['datastream.rollover_max_primary_shard_gb', 'datastream.rollover_max_age_days', 'datastream.default_primary_shards', ...INDEX_RATIOS],
    source: 'D31', code: 'demand.ts (rolloverFor)',
  },
  {
    id: 'forward.shards', area: A, group: 'Shards', title: 'Indices and shards for time-based data',
    formula: 'indices on a tier = ROUNDUP(days kept on the tier ÷ days per index)\nshards on a tier = indices × primary shards × (replicas + 1)',
    explanation: 'Every day-range of data kept becomes a set of indices, and each index has its primary shards plus their replica copies.',
    constantKeys: ['datastream.default_primary_shards'], source: 'D18, D31', code: 'demand.ts (estimateShards)',
  },
  {
    id: 'forward.corpus_shards', area: A, group: 'Shards', title: 'Shards for a fixed set of documents',
    formula: 'primary shards = the number set on the workload, else ROUNDUP(stored GB ÷ largest shard size), at least 1\nshards = primary shards × (replicas + 1)',
    explanation: 'A search collection or vector set is one index, split so no shard grows too large.',
    constantKeys: ['shard_size_gb_max'], source: 'D18', code: 'demand.ts (estimateShards)',
  },
  {
    id: 'forward.shard_size', area: A, group: 'Shards', title: 'Size of one primary shard',
    formula: 'shard GB = GB per day after growth × index ratio × share kept × days per index ÷ primary shards',
    explanation: 'Feeds the check that shards are neither too small nor too large.',
    constantKeys: INDEX_RATIOS, source: 'D31', code: 'demand.ts (estimateShards)',
  },
  {
    id: 'forward.shard_limit', area: A, group: 'Shards', title: 'Shards the cluster can hold',
    formula: 'shard capacity = (non-frozen data nodes − spare) × maximum shards per node',
    explanation: 'Each shard costs memory to track, so each node has a limit on how many it holds. Frozen shards are counted separately.',
    constantKeys: ['failover_nodes_per_tier', 'max_shards_per_nonfrozen_node'], source: 'SPEC §5.3', code: 'forward.ts',
  },
  {
    id: 'forward.master_index_limit', area: A, group: 'Shards', title: 'Indices the master nodes can manage',
    formula: 'index capacity = master heap × indices per GB of heap\n(without dedicated masters, the heap of a first-tier data node)',
    explanation: 'Master nodes keep the cluster organized and hold a map of every index in their heap.',
    constantKeys: ['master_indices_per_gb_heap', 'heap_fraction', 'heap_cap_gb'], source: 'SPEC §5.2', code: 'forward.ts',
  },

  // ---- Supporting nodes -------------------------------------------------------------------------------
  {
    id: 'forward.masters', area: A, group: 'Supporting nodes', title: 'Dedicated master nodes',
    formula: 'master row = the last row of the master table whose minimum data nodes ≤ data nodes (all data tiers)\nrequired heap = indices ÷ indices per GB of heap\nwhile row heap < required heap: move to the next row\nmaster cores = master memory × cores per GB of memory',
    explanation: 'Master nodes are small nodes that keep the cluster organized; three are needed so they can vote. Below 6 data nodes the data nodes act as masters. Many indices push the masters up to a larger size.',
    constantKeys: ['masters.sizing', 'master_indices_per_gb_heap', 'heap_fraction', 'heap_cap_gb', 'vcpu_per_ram_gb'], source: 'SPEC §5.2, D4', code: 'overhead.ts (computeOverhead)',
  },
  {
    id: 'forward.kibana', area: A, group: 'Supporting nodes', title: 'Kibana instances',
    formula: 'Kibana instances = the high-availability count if data nodes ≥ the high-availability threshold, else 1\nKibana memory = memory per instance',
    explanation: 'Kibana is the user interface. Larger clusters get a second instance so it stays up if one fails.',
    constantKeys: ['kibana.ha_min_data_nodes', 'kibana.ha_count', 'kibana.node_ram_gb', 'vcpu_per_ram_gb'], source: 'SPEC §5.2', code: 'overhead.ts (computeOverhead)',
  },
  {
    id: 'forward.coordinating', area: A, group: 'Supporting nodes', title: 'Coordinating nodes',
    formula: 'coordinating memory = coordinating nodes requested × memory per coordinating node',
    explanation: 'Coordinating nodes only route searches and combine results. They are added only when asked for.',
    constantKeys: ['coordinating.node_ram_gb', 'vcpu_per_ram_gb'], source: 'SPEC §5.2, D5', code: 'overhead.ts (computeOverhead)',
  },
  {
    id: 'forward.apm_server', area: A, group: 'Supporting nodes', title: 'APM Servers',
    formula: 'APM Servers = the standard count, each with the standard memory, when any APM workload is present',
    explanation: 'APM Server receives application performance traces and passes them to Elasticsearch.',
    constantKeys: ['apm.count', 'apm.node_ram_gb', 'vcpu_per_ram_gb'], source: 'SPEC §5.2', code: 'overhead.ts (computeOverhead)',
  },
  {
    id: 'forward.ml', area: A, group: 'Supporting nodes', title: 'Machine learning nodes',
    formula: 'nodes for jobs = ROUNDUP(anomaly jobs ÷ jobs per node)\nnodes for models = ROUNDUP(trained model GB ÷ (ML node memory − heap))\nML nodes = the larger of the two + spare',
    explanation: 'Machine learning jobs and trained models run on their own nodes, with a spare so they keep running if one fails.',
    constantKeys: ['ml.jobs_per_node', 'ml.node_ram_gb', 'heap_fraction', 'heap_cap_gb', 'failover_nodes_per_tier', 'vcpu_per_ram_gb'], source: 'SPEC §5.2, D6', code: 'overhead.ts (computeOverhead)',
  },
  {
    id: 'forward.ml_capacity', area: A, group: 'Supporting nodes', title: 'Machine learning jobs the nodes can run',
    formula: 'job capacity = (ML nodes − spare) × jobs per node',
    explanation: 'Shown as one of the limits in the results.',
    constantKeys: ['failover_nodes_per_tier', 'ml.jobs_per_node'], source: 'SPEC §5.3', code: 'forward.ts',
  },
  {
    id: 'forward.fleet', area: A, group: 'Supporting nodes', title: 'Fleet Servers',
    formula: 'table row = the first row of the Fleet table with agents ≥ agents (else the last row)\nFleet Servers = (ROUNDUP(agents ÷ row agents) if agents exceed the row, else 1) + redundancy\nmemory and cores per server = the row\'s values',
    explanation: 'Fleet Server manages the Elastic Agents installed on each monitored machine. Elastic\'s sizing table gives the server size for an agent count, and one extra server is kept for redundancy.',
    constantKeys: ['fleet.table', 'fleet.redundancy_nodes'], source: 'SPEC §5.2, D7', code: 'overhead.ts (computeOverhead, fleetRowFor)',
  },
  {
    id: 'forward.fleet_capacity', area: A, group: 'Supporting nodes', title: 'Agents the Fleet Servers can serve',
    formula: 'agent capacity = row agents × (Fleet Servers − redundancy)',
    explanation: 'Shown as one of the limits in the results.',
    constantKeys: ['fleet.table', 'fleet.redundancy_nodes'], source: 'SPEC §5.3', code: 'forward.ts',
  },

  // ---- License ----------------------------------------------------------------------------------------
  {
    id: 'forward.total_ram', area: A, group: 'License', title: 'Total memory',
    formula: 'total memory GB = Σ nodes × memory per node, for the parts that count (Elasticsearch, Kibana, APM; not Fleet Server)',
    explanation: 'Elastic licenses self-managed deployments by memory. Which parts count is a setting.',
    constantKeys: ['eru.counted_components'], source: 'D3', code: 'result.ts (totalsFor)',
  },
  {
    id: 'forward.eru', area: A, group: 'License', title: 'License units (ERU)',
    formula: 'ERU = ROUNDUP(total memory GB ÷ GB per ERU)\nall sites: ERU = ROUNDUP(total memory GB × sites ÷ GB per ERU)',
    explanation: 'An ERU (Enterprise Resource Unit) is the unit Elastic licenses by, a block of memory.',
    constantKeys: ['eru_gb', 'eru.counted_components'], source: 'SPEC §5.5, D3', code: 'license.ts (selfManagedEru), forward.ts',
  },
  {
    id: 'forward.license_floor', area: A, group: 'License', title: 'Lowest subscription needed',
    formula: 'subscription = the highest level any feature in use requires: frozen tier, machine learning, cross-cluster replication, FIPS 140-3, full LogsDB; otherwise Basic',
    explanation: 'Some features need a paid subscription. Self-managed offers Basic and Enterprise.',
    constantKeys: ['license.floor.frozen', 'license.floor.ml', 'license.floor.ccr', 'license.floor.fips_140_3', 'license.floor.logsdb_full'], source: 'SPEC §5.6, D12, D29', code: 'license.ts (licenseFloor)',
  },
];
