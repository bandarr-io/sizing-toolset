import type { Formula } from './types.ts';

const R = 'Test hardware limits';
const H = 'Hardware checks';

/** Test hardware limits (reverse.ts, confidence.ts) and the hardware checks HV1 to HV12 (validation.ts). */
export const FORMULAS: Formula[] = [
  // ---- Capacity ----------------------------------------------------------------------------------
  {
    id: 'reverse.spare_node', area: R, group: 'Capacity', title: 'One node per tier held back',
    formula: 'usable capacity = sum over all nodes in the tier − the largest node',
    explanation: 'The biggest node in each tier is left out of every limit, so the answer still holds if that node fails. This is the "N−1" rule.',
    constantKeys: [], source: 'SPEC §5.3', code: 'reverse.ts',
  },
  {
    id: 'reverse.tier_capacity', area: R, group: 'Capacity', title: 'Storage a hot, warm, cold or content node can hold',
    formula: 'storage per node = min(node memory × GB of disk per GB of memory, node disk)\ntier storage = sum over nodes except the largest',
    explanation: 'Each GB of memory can look after only so much disk. A node counts the smaller of that amount and its real disk. When the real disk is smaller, the answer is "disk-bound".',
    constantKeys: ['mem_disk.hot', 'mem_disk.warm', 'mem_disk.cold', 'mem_disk.content'], source: 'SPEC §5.3, D25', code: 'reverse.ts',
  },
  {
    id: 'reverse.frozen_capacity', area: R, group: 'Capacity', title: 'Data the frozen tier can hold',
    formula: 'frozen data = sum over nodes except the largest of (local disk ÷ 1.25 ÷ share of data cached)\nlocal disk = the node disk, or node memory × local disk per GB of memory when blank',
    explanation: 'Frozen data lives in cheap object storage. Nodes keep only a cache of it on local disk, so each GB of local disk covers many GB of frozen data.',
    constantKeys: ['frozen_local_disk_ratio', 'frozen_cache_fraction', 'storage.watermark_headroom', 'storage.margin'], source: 'D27', code: 'reverse.ts',
  },
  {
    id: 'reverse.other_workloads', area: R, group: 'Capacity', title: 'Room left after other workloads',
    formula: 'room for the answer = tier capacity − data the other workloads already keep there',
    explanation: 'Anything else on the cluster uses capacity first. The question is answered with what is left.',
    constantKeys: [], source: 'SPEC §5.3', code: 'reverse.ts',
  },

  // ---- Ceilings (Most data per day) ----------------------------------------------------------------
  {
    id: 'reverse.max_gb_day_storage', area: R, group: 'Ceilings', title: 'Most data per day that storage allows',
    formula: 'max GB/day = (tier capacity ÷ 1.25 − other data) ÷ (days kept × (replicas + 1) × stored size ratio × downsampling)',
    explanation: 'Disk is never planned full: 1.25 leaves room below the point where Elasticsearch stops writing, plus a margin. Each day of data is stored once per copy and shrinks by the stored size ratio (for example 0.5 for LogsDB).',
    constantKeys: ['storage.watermark_headroom', 'storage.margin', 'index_ratio.standard', 'index_ratio.logsdb', 'index_ratio.tsds'], source: 'SPEC §5.3', code: 'reverse.ts',
  },
  {
    id: 'reverse.max_gb_day_frozen', area: R, group: 'Ceilings', title: 'Most data per day that frozen allows',
    formula: 'max GB/day = (frozen data − other frozen data) ÷ (days kept × stored size ratio × downsampling)',
    explanation: 'Frozen keeps one copy only, because its snapshots in object storage already protect the data.',
    constantKeys: ['index_ratio.standard', 'index_ratio.logsdb', 'index_ratio.tsds'], source: 'SPEC §5.3, D27', code: 'reverse.ts',
  },
  {
    id: 'reverse.max_gb_day_cpu', area: R, group: 'Ceilings', title: 'Most data per day that processors allow',
    formula: 'max GB/day = (hot cores except the largest node × events per second per core − other workloads\' events) × event size KB × 86,400 ÷ 1,000,000 ÷ (replicas + 1) × slowdowns',
    explanation: 'Every copy of each event is processed on the hot tier. Ingest pipelines, LogsDB and heavy concurrent search each slow processing down. This estimate is rough: with the default speed, the math also shows the result at both ends of the usual 1,000 to 3,000 events per second per core. Confirm it with Rally.',
    constantKeys: ['ev_per_s_per_vcpu', 'ev_per_s_per_vcpu.band_min', 'ev_per_s_per_vcpu.band_max', 'ingest.default_avg_event_kb', 'ingest.derate.pipelines', 'ingest.derate.logsdb', 'ingest.derate.concurrent_search'], source: 'SPEC §5.3, D28', code: 'reverse.ts',
  },
  {
    id: 'reverse.max_gb_day_disk_write', area: R, group: 'Ceilings', title: 'Most data per day that disk write speed allows',
    formula: 'write capacity GB/day = (hot nodes − 1) × disk write MB/s × 86,400 ÷ 1,000\nmax GB/day = (write capacity − other writes) ÷ (replicas + 1) ÷ stored size ratio',
    explanation: 'Used only when a disk write speed is entered. Every copy of the stored data has to be written.',
    constantKeys: ['index_ratio.standard', 'index_ratio.logsdb', 'index_ratio.tsds'], source: 'D28', code: 'reverse.ts',
  },
  {
    id: 'reverse.max_gb_day_shards', area: R, group: 'Ceilings', title: 'Most data per day that the shard limit allows',
    formula: 'shard capacity = (nodes outside frozen − 1) × shards allowed per node − shards of other workloads\nmax GB/day = the largest GB/day whose shards still fit (found by halving the range)',
    explanation: 'More data per day means fresh indices start more often (rollover), and each index adds shards, which are slices of the data. The limit on shards per node therefore caps the data per day.',
    constantKeys: ['max_shards_per_nonfrozen_node', 'datastream.rollover_max_primary_shard_gb', 'datastream.rollover_max_age_days', 'datastream.default_primary_shards'], source: 'D31', code: 'reverse.ts',
  },
  {
    id: 'reverse.answer', area: R, group: 'Answers', title: 'The answer is the lowest ceiling',
    formula: 'answer = min(every ceiling that applies)\nruns out first = the ceiling that gives the answer',
    explanation: 'Each limit gives its own maximum. The smallest is the answer, and the results name it as "Runs out first".',
    constantKeys: [], source: 'SPEC §5.3', code: 'reverse.ts',
  },

  // ---- Answers (the other questions) ---------------------------------------------------------------
  {
    id: 'reverse.max_retention', area: R, group: 'Answers', title: 'Longest retention',
    formula: 'max days = floor((tier capacity ÷ 1.25 − other data) ÷ (GB/day × (replicas + 1) × stored size ratio × downsampling))\nshard limit: max days = floor(shard capacity ÷ (primary shards × (replicas + 1)) × days between rollovers)',
    explanation: 'The same storage math as data per day, solved for days. More days also means more indices kept, so the shard limit applies too. Frozen uses the frozen capacity and one copy.',
    constantKeys: ['storage.watermark_headroom', 'storage.margin', 'max_shards_per_nonfrozen_node', 'datastream.default_primary_shards', 'datastream.rollover_max_primary_shard_gb', 'datastream.rollover_max_age_days'], source: 'SPEC §5.3, D31', code: 'reverse.ts',
  },
  {
    id: 'reverse.max_vectors', area: R, group: 'Answers', title: 'Most vectors',
    formula: 'vector memory = sum over nodes except the largest of (node memory − heap − reserve)\nmax vectors = vector memory ÷ (bytes per vector × (replicas + 1))\ndisk limit: max vectors = (tier capacity ÷ 1.25 − other data) ÷ (disk bytes per vector × (replicas + 1))',
    explanation: 'Vectors (numeric fingerprints for AI search) must sit in memory outside the heap to be searched fast. The compression type and number of dimensions set the bytes per vector. The lower of the memory and disk limits is the answer.',
    constantKeys: ['heap_fraction', 'heap_cap_gb', 'offheap_reserve_gb', 'storage.watermark_headroom', 'storage.margin', 'knn.bytes.float32', 'knn.bytes.bfloat16', 'knn.bytes.int8', 'knn.bytes.int4', 'knn.bytes.bbq', 'knn.bbq_disk', 'knn.hnsw_m', 'knn.hnsw_bytes_per_link', 'knn.raw_disk_overhead.int8', 'knn.raw_disk_overhead.int4', 'knn.raw_disk_overhead.bbq'], source: 'SPEC §5.3, D19', code: 'reverse.ts',
  },
  {
    id: 'reverse.max_shards', area: R, group: 'Answers', title: 'Most shards and data streams',
    formula: 'max shards = (nodes outside frozen − 1) × shards allowed per node\nmax indices = master heap GB × indices per GB of heap\ndata streams = min(max shards ÷ shards per stream, max indices ÷ indices per stream)',
    explanation: 'Shards are slices of the data spread across nodes. The master nodes keep track of every index in their memory, so their heap caps the index count. Masters on the data nodes use the data nodes\' heap.',
    constantKeys: ['max_shards_per_nonfrozen_node', 'master_indices_per_gb_heap', 'heap_fraction', 'heap_cap_gb'], source: 'SPEC §5.3, D18', code: 'reverse.ts',
  },
  {
    id: 'reverse.max_agents', area: R, group: 'Answers', title: 'Most Elastic Agents',
    formula: 'Fleet limit = agents per Fleet Server for its memory (Fleet table) × (Fleet Servers − spare)\nhot limit = the largest Fleet table row whose hot memory and cores the hot tier covers\nmax agents = min(Fleet limit, hot limit)',
    explanation: 'Fleet Server manages the agents on each monitored machine. Elastic\'s Fleet sizing table gives, for each agent count, the Fleet Server memory and the hot tier it needs. One Fleet Server is held back as a spare.',
    constantKeys: ['fleet.table', 'fleet.redundancy_nodes'], source: 'SPEC §5.3, D7', code: 'reverse.ts',
  },
  {
    id: 'reverse.max_ml_jobs', area: R, group: 'Answers', title: 'Most machine learning jobs',
    formula: 'max jobs = (machine learning nodes − 1) × jobs per node',
    explanation: 'Each machine learning node runs a set number of anomaly detection jobs. One node is held back as a spare.',
    constantKeys: ['ml.jobs_per_node'], source: 'SPEC §5.3, D6', code: 'reverse.ts',
  },
  {
    id: 'reverse.years_to_capacity', area: R, group: 'Answers', title: 'Years until full',
    formula: 'years = the largest t where GB/day today × (1 + growth rate)^t ≤ most data per day, with other workloads grown by t\n0 if already full today; never if nothing grows',
    explanation: 'Data grows by a fixed share each year, compounding. The answer is when that growing volume reaches the most the hardware can take. It is found by halving the range of years.',
    constantKeys: [], source: 'D24', code: 'reverse.ts',
  },
  {
    id: 'reverse.cluster_totals', area: R, group: 'Answers', title: 'Memory and license units of the hardware',
    formula: 'total memory = sum of node memory for the parts that count toward the license\nlicense units (ERU) = ROUNDUP(total memory ÷ GB per ERU)',
    explanation: 'The hardware you enter is licensed the same way as a sized cluster. An ERU (Enterprise Resource Unit) is the block of memory Elastic licenses by.',
    constantKeys: ['eru.counted_components', 'eru_gb'], source: 'D3', code: 'reverse.ts',
  },

  // ---- Confidence ----------------------------------------------------------------------------------
  {
    id: 'reverse.confidence', area: R, group: 'Confidence', title: 'How much to trust each limit',
    formula: 'storage, disk: high\nfrozen, shards, masters, vector memory, Fleet: medium\nprocessor, disk write, search load, machine learning: low\nthe answer takes the confidence of the limit that runs out first',
    explanation: 'Storage math follows directly from sizes and is dependable. Processor and disk speed depend on the real data and hardware, so those limits say "test with Rally", Elastic\'s benchmarking tool.',
    constantKeys: [], source: 'SPEC §5.8', code: 'confidence.ts',
  },

  // ---- Hardware checks -----------------------------------------------------------------------------
  {
    id: 'check.hv1_node_memory', area: H, group: 'Memory', title: 'Node memory above the practical maximum (HV1)',
    formula: 'warn when a data or master node has more memory than the practical maximum per node\nnote only, for machine learning and frozen nodes',
    explanation: 'Very large nodes waste memory and make failures more costly. Splitting them into more, smaller nodes works better.',
    constantKeys: ['node_ram_practical_max_gb'], source: 'SPEC §5.7 HV1', code: 'validation.ts',
  },
  {
    id: 'check.hv2_heap', area: H, group: 'Memory', title: 'Heap too large (HV2)',
    formula: 'heap = min(node memory × heap share, heap cap), unless set by hand\nerror when heap > heap cap, or heap > 50% of node memory',
    explanation: 'The heap is memory Elasticsearch reserves for its own work. Above the cap it becomes less efficient, and the rest of memory is needed for the file cache and vectors.',
    constantKeys: ['heap_fraction', 'heap_cap_gb'], source: 'SPEC §5.7 HV2, D19', code: 'validation.ts',
  },
  {
    id: 'check.hv11_cores', area: H, group: 'Memory', title: 'Too few cores for the hot memory (HV11)',
    formula: 'warn when hot cores ÷ hot memory GB < the minimum cores per GB',
    explanation: 'With too few processor cores for the memory, processing incoming data runs out before disk does.',
    constantKeys: ['hv.hot_min_vcpu_per_ram_gb'], source: 'SPEC §5.7 HV11', code: 'validation.ts',
  },
  {
    id: 'check.hv3_hdd', area: H, group: 'Disk', title: 'Spinning disks on hot or content (HV3)',
    formula: 'error when a hot or content node uses HDD',
    explanation: 'Spinning hard disks are too slow for the newest, most searched data.',
    constantKeys: [], source: 'SPEC §5.7 HV3', code: 'validation.ts',
  },
  {
    id: 'check.hv4_ratio_band', area: H, group: 'Disk', title: 'Disk per GB of memory outside the usual range (HV4)',
    formula: 'ratio = node disk ÷ node memory\nwarn when hot or content ratio is outside hot minimum to hot maximum\nwarn when warm or cold ratio is outside warm minimum to warm maximum',
    explanation: 'Each GB of memory can look after only so much disk. Too little disk wastes memory; too much leaves disk that searches cannot use well.',
    constantKeys: ['mem_disk.hot_min', 'mem_disk.hot_max', 'mem_disk.warm_min', 'mem_disk.warm_max'], source: 'SPEC §5.7 HV4, D38', code: 'validation.ts',
  },
  {
    id: 'check.hv5_disk_bound', area: H, group: 'Disk', title: 'Disk sets the capacity (HV5)',
    formula: 'note when node disk < node memory × GB of disk per GB of memory for the tier',
    explanation: 'The node has less disk than its memory could look after, so disk is what limits how much it holds.',
    constantKeys: ['mem_disk.hot', 'mem_disk.warm', 'mem_disk.cold', 'mem_disk.content'], source: 'SPEC §5.7 HV5, D25', code: 'validation.ts',
  },
  {
    id: 'check.hv7_watermark', area: H, group: 'Disk', title: 'Disk too full if a node fails (HV7)',
    formula: 'fill = tier data ÷ (tier disk − the largest node\'s disk)\nerror when fill > flood-stage watermark; warn when fill > high watermark, or > low watermark, or when 1 − fill < the headroom to keep free\nwarn when a tier has data but no nodes',
    explanation: 'Elasticsearch reacts to full disks in three steps: above the low watermark it stops placing new data on a node, above the high one it moves shards away, and above the flood stage it makes indices read-only. The check assumes one node has failed.',
    constantKeys: ['watermark.low', 'watermark.high', 'watermark.flood_stage', 'storage.watermark_headroom'], source: 'SPEC §5.7 HV7', code: 'validation.ts',
  },
  {
    id: 'check.hv9_replicas', area: H, group: 'Disk', title: 'Spare copies with only one node (HV9)',
    formula: 'error when a tier has one node and asks for 1 or more replicas',
    explanation: 'A spare copy (replica) must live on a different node from the original, so one node cannot hold it.',
    constantKeys: [], source: 'SPEC §5.7 HV9', code: 'validation.ts',
  },
  {
    id: 'check.hv6_masters', area: H, group: 'Masters', title: 'Master nodes (HV6)',
    formula: 'error when dedicated masters < 3; warn when their number is even\nwithout dedicated masters: error when data nodes are 1 or 2; warn when data nodes ≥ 6',
    explanation: 'Master nodes keep the cluster organized and vote on changes. Three avoid ties; an odd number always gives a majority. Large clusters should run them separately.',
    constantKeys: [], source: 'SPEC §5.7 HV6', code: 'validation.ts',
  },
  {
    id: 'check.hv8_shards', area: H, group: 'Shards', title: 'Shard count and shard size (HV8)',
    formula: 'warn when shards per node outside frozen > shards allowed per node\nwarn when a shard > maximum shard size (suggests more primary shards or earlier rollover)\ndocuments per shard = shard GB ÷ index ratio × 1,000,000 ÷ average event KB; warn when > the documents limit\nnote when a shard < minimum shard size',
    explanation: 'Shards are slices of the data. Too many per node costs memory; very large ones, by size or by number of documents, are slow to move and recover; very small ones waste overhead.',
    constantKeys: ['max_shards_per_nonfrozen_node', 'shard_size_gb_max', 'shard_size_gb_min', 'shard_docs_max', 'ingest.default_avg_event_kb', 'index_ratio.standard', 'index_ratio.logsdb', 'index_ratio.tsds'], source: 'SPEC §5.7 HV8, D31', code: 'validation.ts',
  },
  {
    id: 'check.hv10_airgap', area: H, group: 'Security', title: 'AutoOps without internet (HV10)',
    formula: 'error when the site is air-gapped and AutoOps is selected',
    explanation: 'AutoOps is Elastic\'s monitoring service and needs an internet connection.',
    constantKeys: ['autoops.requires_internet'], source: 'SPEC §5.7 HV10', code: 'validation.ts',
  },
  {
    id: 'check.hv12_fleet', area: H, group: 'Fleet', title: 'Fleet Server and hot tier for the agents (HV12)',
    formula: 'warn when agents > what the Fleet Server memory supports (Fleet table)\nwarn when hot memory or cores < the Fleet table floor for the agent count\nwarn when agent policies > the policies one Fleet Server handles\nnote when agents > the Serverless limit per project: projects = ROUNDUP(agents ÷ limit)\nnote when agents ≥ the key cache threshold: set the cache to agents × multiplier',
    explanation: 'Fleet Server manages the agents. Many agents need more Fleet Server memory, a bigger hot tier, and a larger cache for the agents\' sign-in keys. Agent policies are sets of agent settings; one Fleet Server handles a limited number.',
    constantKeys: ['fleet.table', 'fleet.max_policies_per_instance', 'fleet.serverless_max_agents', 'fleet.api_key_cache_threshold_agents', 'fleet.api_key_cache_multiplier'], source: 'SPEC §5.7 HV12', code: 'validation.ts',
  },
  {
    id: 'check.hv13_bbq', area: H, group: 'Memory', title: 'Vector compression other than the default (HV13)',
    formula: 'note when a vector workload has dimensions ≥ the BBQ default threshold and uses int8 or float32',
    explanation: 'Elasticsearch compresses vectors with BBQ by default from this many dimensions up. Other choices keep more of each vector in memory. New vector workloads start with BBQ for the same reason.',
    constantKeys: ['knn.bbq_default_min_dims'], source: 'SPEC §5.5', code: 'validation.ts, web state.ts (newWorkload)',
  },
  {
    id: 'check.hv14_speed_range', area: H, group: 'Processing', title: 'Processing speed outside the usual range (HV14)',
    formula: 'note when a custom events per second per core < the low end or > the high end of the usual range',
    explanation: 'Processing speed varies a lot with the data and the hardware. A value outside the usual range may be right, but it should come from a Rally test on the customer\'s data.',
    constantKeys: ['ev_per_s_per_vcpu.band_min', 'ev_per_s_per_vcpu.band_max'], source: 'SPEC §5.3', code: 'validation.ts',
  },
];
