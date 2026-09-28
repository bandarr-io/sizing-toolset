import type { Formula } from './types.ts';

const area = 'Elastic Cloud' as const;

/**
 * Elastic Cloud Hosted (D40): the ECH Ballpark Estimator v4.6, formula for formula. Prices come from the internal
 * price table in the local data file, so no price appears here, only where it is read.
 */
export const FORMULAS: Formula[] = [
  // ---- Pricing ------------------------------------------------------------------------------------------
  {
    id: 'ech.price_per_gb_month', area, group: 'Pricing', title: 'Price per GB of memory per month',
    formula: 'price per GB-month = ROUND(price per GB of memory per hour from the price table × price adjustment × hours per month, to the cent)',
    explanation: 'Elastic Cloud charges by memory. Disk comes bundled with it, at a fixed ratio for each kind of hardware. The table price depends on the cloud, region, subscription and sales channel.',
    constantKeys: ['ech.hours_per_month', 'ech.price_adjustment'], source: 'ECH Logs!I56', code: 'ech/common.ts',
  },
  {
    id: 'ech.line_per_year', area, group: 'Pricing', title: 'Cost of one line per year',
    formula: 'per year = price per GB-month × memory in GB (all zones) × 12\nrounded (optional) = ROUNDUP(per year, to the next $1,000)',
    explanation: 'Every part of a deployment (hot data, Kibana and so on) is one line. The spreadsheet rounds each line up to the next $1,000; here that is a switch, and exact figures are the default.',
    constantKeys: ['ech.line_rounding_usd'], source: 'ECH Logs!J6:J38', code: 'ech/common.ts',
  },
  {
    id: 'ech.total_and_year_one', area, group: 'Pricing', title: 'Total and year-one spend',
    formula: 'total = sum of the lines\nif total days kept > 365: year one = total − snapshot storage ÷ 2\nelse: year one = total − storage + storage ÷ 2 × f + storage × (1 − f), where f = total days ÷ 365',
    explanation: 'Snapshot storage fills up over the retention period, so the first year pays less of it. Each use case is its own deployment and totals simply add up.',
    constantKeys: [], source: 'ECH Logs!J42, J44; Summary!E228', code: 'ech/observability.ts',
  },

  // ---- Node sizes -------------------------------------------------------------------------------------
  {
    id: 'ech.node_fit', area, group: 'Node sizes', title: 'Round memory to real node sizes',
    formula: 'per zone = memory needed ÷ zones\nnode size = the smallest allowed size ≥ per zone, else the largest size\nnodes per zone = ROUNDUP(memory needed ÷ (node size × zones))\npriced memory = nodes per zone × zones × node size',
    explanation: 'Each kind of hardware comes in fixed sizes (for example 1, 2, 4, 8, 15, 30 and 60 GB). Memory is spread over the availability zones (separate data centres), and past the largest size the tier grows in whole nodes.',
    constantKeys: [], source: 'ECH Logs!H185:K193', code: 'ech/common.ts',
  },
  {
    id: 'ech.zones_and_copies', area, group: 'Node sizes', title: 'Zones and spare copies per tier',
    formula: 'zones = hot 2, warm 2, cold 1, frozen 1 (defaults)\nspare copies (replicas) = hot 1, warm 1, cold 0; frozen has none',
    explanation: 'Zones spread nodes across data centres so one outage does not stop the cluster. Replicas are spare copies of the data on other nodes. Both multiply the memory priced.',
    constantKeys: ['ech.zones', 'ech.replicas'], source: 'ECH Logs!E86:E97', code: 'ech/observability.ts',
  },
  {
    id: 'ech.fixed_nodes', area, group: 'Node sizes', title: 'Master, coordinating, machine learning and Kibana',
    formula: 'memory = a fixed size per role (master 3 GB, coordinating 4 GB, machine learning 4 GB, Kibana 8 GB by default), priced like any line',
    explanation: 'These nodes are not sized from the data. The spreadsheet bills them at fixed sizes whether or not the workload uses them.',
    constantKeys: ['ech.fixed_ram_gb'], source: 'ECH Logs!E35:E38, J35:J38', code: 'ech/observability.ts',
  },

  // ---- Logs and metrics ---------------------------------------------------------------------------------
  {
    id: 'ech.metrics_daily_volume', area, group: 'Logs and metrics', title: 'Metrics volume per day',
    formula: 'GB per day = datapoints per second × bytes per datapoint × 86,400 ÷ 1,000,000,000',
    explanation: 'Metrics are counted in datapoints (one measurement at one time). Each takes a few bytes once stored.',
    constantKeys: ['ech.metrics_bytes_per_sample'], source: 'ECH Metrics!K135:K137', code: 'ech/observability.ts',
  },
  {
    id: 'ech.one_copy', area, group: 'Logs and metrics', title: 'One copy of a tier’s data',
    formula: 'one copy = GB per day × days on the tier × (LogsDB share × (1 − LogsDB reduction) + (1 − LogsDB share))',
    explanation: 'LogsDB is a storage mode that compresses logs. The share of data in LogsDB shrinks by the reduction; metrics skip this step.',
    constantKeys: ['ech.logsdb_reduction', 'ech.logsdb_share'], source: 'ECH Logs!K163, K154, E113', code: 'ech/observability.ts',
  },
  {
    id: 'ech.disk_needed', area, group: 'Logs and metrics', title: 'Disk needed for hot, warm or cold',
    formula: 'disk = one copy × (1 + spare copies) × index factor ÷ (1 − disk kept free)',
    explanation: 'The index factor turns raw data into its stored size (1.2 for logs, 1.0 for metrics). A share of disk is kept free so the cluster can move data around.',
    constantKeys: ['ech.index_factor', 'ech.reserved_storage', 'ech.replicas'], source: 'ECH Logs!K164:K166', code: 'ech/observability.ts',
  },
  {
    id: 'ech.memory_for_disk', area, group: 'Logs and metrics', title: 'Memory needed to hold that disk',
    formula: 'memory for disk = disk ÷ the hardware’s GB of disk per GB of memory',
    explanation: 'Each kind of hardware pairs a fixed amount of disk with each GB of memory. Warm and cold are sized this way alone.',
    constantKeys: [], source: 'ECH Logs!K169, K209, K246', code: 'ech/observability.ts',
  },
  {
    id: 'ech.memory_for_ingest', area, group: 'Logs and metrics', title: 'Memory needed to take data in (logs)',
    formula: 'memory for ingest = GB per day ÷ (hardware’s GB per day per GB of memory × (1 − processor kept for search))',
    explanation: 'Hot nodes also have to keep up with incoming data. Hot memory is the larger of this and the memory for disk.',
    constantKeys: ['ech.reserved_cpu_search'], source: 'ECH Logs!K161, K170:K171', code: 'ech/observability.ts',
  },
  {
    id: 'ech.metrics_ingest', area, group: 'Logs and metrics', title: 'Memory needed to take data in (metrics)',
    formula: 'nodes = (datapoints per second × (1 + spare copies) ÷ benchmark datapoints per node)^(1 ÷ 0.85)\nmemory for ingest = nodes × memory per benchmark node',
    explanation: 'Metrics use a measured benchmark per kind of hardware. The power of 1 ÷ 0.85 adds a penalty as the cluster grows; the spreadsheet gives no source for it.',
    constantKeys: ['ech.metrics_scaling_exponent'], source: 'ECH Metrics!K138:K142, H321:K350', code: 'ech/observability.ts',
  },
  {
    id: 'ech.frozen_memory', area, group: 'Logs and metrics', title: 'Frozen memory',
    formula: 'snapshot data = one copy × index factor\nfrozen memory = snapshot data ÷ 1,600',
    explanation: 'Frozen data lives in cheap object storage; frozen nodes keep a small local cache. One GB of memory covers 1,600 GB of snapshot data, with no spare copies and no free-disk reserve.',
    constantKeys: ['ech.frozen_ram_to_blob', 'ech.index_factor'], source: 'ECH Logs!K279:K280, E102', code: 'ech/observability.ts',
  },

  // ---- Security ---------------------------------------------------------------------------------------
  {
    id: 'ech.siem_volume', area, group: 'Security', title: 'SIEM volume per day',
    formula: 'GB per day = MAX(GB per day entered, events per second × 500 bytes × 86,400 ÷ 1,000,000,000)',
    explanation: 'SIEM volume can be given as data per day or events per second. The larger of the two is used.',
    constantKeys: ['ech.security.bytes_per_event'], source: 'ECH SIEM Security!I29; Security - Data Validation!G30', code: 'ech/security.ts',
  },
  {
    id: 'ech.endpoint_volume', area, group: 'Security', title: 'Endpoint volume per day',
    formula: 'Linux or macOS MB per day = (Linux MB × 20 + macOS MB × 5) ÷ 25\nMB per endpoint = (Windows % × Windows MB + Linux or macOS % × Linux or macOS MB) ÷ 100\nGB per day = endpoints × MB per endpoint ÷ 1,000',
    explanation: 'Each protection level sends a typical amount of data per machine per day, which differs by operating system. The mix of Windows and other machines sets the average. The spreadsheet applies the mix to cloud workloads too.',
    constantKeys: ['ech.security.endpoint_ingest', 'ech.security.endpoint_default_mix'], source: 'ECH Security - Data Validation!C4:D9; Endpoint Security - Front End!D5:D8', code: 'ech/security.ts',
  },
  {
    id: 'ech.security_retention', area, group: 'Security', title: 'Days on each tier (security)',
    formula: 'hot = 1 day, cold = 6 days, frozen = total days − 7\n(totals under 7 days are sized as 7)',
    explanation: 'Security data always keeps a day on fast storage and six on cheaper storage, with the rest in frozen object storage.',
    constantKeys: ['ech.security.retention_days'], source: 'ECH Security - Data Validation!M:T', code: 'ech/security.ts',
  },
  {
    id: 'ech.security_availability', area, group: 'Security', title: 'Availability sets zones and spare copies',
    formula: 'Standard: 1 zone per tier, no spare copies\nHigh: hot and warm 2 zones and 1 spare copy; cold and frozen 1 zone\nMaximum: hot and warm 3 zones; hot 2 spare copies, warm and cold 1',
    explanation: 'One choice sets how many data centres and spare copies each tier uses. More means safer and dearer.',
    constantKeys: ['ech.security.availability'], source: 'ECH Security - Data Validation!B24:L26', code: 'ech/security.ts',
  },
  {
    id: 'ech.security_storage', area, group: 'Security', title: 'Security storage and memory',
    formula: 'one copy = GB per day × days × (1 − LogsDB reduction) when LogsDB is on\ndisk = one copy × (1 + spare copies) × 0.9 ÷ (1 − disk kept free)\nmemory for ingest = GB per day ÷ (hardware rate × (1 − ingest slowdown) × (1 − processor kept for search))',
    explanation: 'Like logs, with security settings: LogsDB saves 60% for SIEM and 22% for endpoint on Enterprise, 19% otherwise. Off Enterprise, LogsDB also slows ingest by 15%. Frozen memory uses the same 1 GB per 1,600 GB rule, and the ingest sizing ignores spare copies, as in the spreadsheet.',
    constantKeys: ['ech.security.logsdb_reduction', 'ech.security.logsdb_ingest_impact_non_enterprise', 'ech.security.index_factor', 'ech.reserved_storage', 'ech.reserved_cpu_search', 'ech.frozen_ram_to_blob'],
    source: 'ECH SIEM Security!K151, K155, K160:K170, E99', code: 'ech/security.ts',
  },
  {
    id: 'ech.siem_fixed_nodes', area, group: 'Security', title: 'SIEM master, machine learning and Kibana',
    formula: 'master = 3 GB, coordinating = none\nsmaller use cases: machine learning and Kibana from a table\nEnterprise: machine learning = MAX(16, detection rule sets × 8) GB; Kibana = machine learning + ROUNDUP(analysts ÷ 10) × 8 GB',
    explanation: 'Bigger security teams run more detection rules and have more people in Kibana, so those nodes grow with them. Blank inputs use 2 rule sets and 10 analysts.',
    constantKeys: ['ech.security.fixed_ram_gb', 'ech.security.siem_ram', 'ech.security.siem_enterprise_ram', 'ech.security.siem_default_rule_instances', 'ech.security.siem_default_analysts'],
    source: 'ECH Security - Data Validation!AD:AG rows 10:13; SIEM Security - Front End!D14:D15', code: 'ech/security.ts',
  },
  {
    id: 'ech.endpoint_fixed_nodes', area, group: 'Security', title: 'Endpoint machine learning and Kibana',
    formula: 'machine learning = (base steps + ROUNDUP(endpoints ÷ 10,000)) × 8 GB (none for next-gen antivirus)\nKibana = a fixed size per protection level',
    explanation: 'Machine learning grows in 8 GB steps as more machines report in.',
    constantKeys: ['ech.security.endpoint_ram', 'ech.security.fixed_ram_gb'], source: 'ECH Security - Data Validation!AF4:AG9', code: 'ech/security.ts',
  },
  {
    id: 'ech.security_transfer', area, group: 'Security', title: 'Security transfer and storage',
    formula: 'data in per month = GB per day × 3.21 × 365 ÷ 12\ndata out = snapshot storage × 25%\nthe rest as in "Data moved between nodes" and "Snapshot storage"',
    explanation: 'Security uses its own raw-to-JSON factor and a larger data-out share than logs.',
    constantKeys: ['ech.security.raw_to_json', 'ech.security.data_out_share'], source: 'ECH SIEM Security!E103, M91, rows 84:97', code: 'ech/security.ts',
  },

  // ---- APM ------------------------------------------------------------------------------------------
  {
    id: 'ech.apm_trace_size', area, group: 'APM', title: 'Trace size',
    formula: 'average trace = (4 transactions × transaction bytes + 4 × 5 spans × span bytes) × sampling rate + 300 bytes\nchatty trace = the same with 500 spans per transaction',
    explanation: 'A trace follows one request through an application: transactions are the main steps and spans the smaller ones inside them. Sampling keeps only a share of traces; "chatty" apps record far more spans.',
    constantKeys: ['ech.apm.transactions_per_trace', 'ech.apm.spans_per_transaction', 'ech.apm.chatty_spans_per_transaction', 'ech.apm.metrics_errors_bytes_per_trace', 'ech.apm.transaction_doc_bytes', 'ech.apm.span_doc_bytes', 'ech.apm.sampling_rate'],
    source: 'ECH APM!K132:K141, E106:E107, E15', code: 'ech/apm.ts',
  },
  {
    id: 'ech.apm_volume', area, group: 'APM', title: 'APM volume per day',
    formula: 'GB per day = (average trace × (1 − chatty share) + chatty trace × chatty share) × traces per minute × 1,440 ÷ 1,000,000,000',
    explanation: '1,440 is the minutes in a day. The data tiers are then sized like logs, with a 15% LogsDB saving on Enterprise and an index factor of 1.2.',
    constantKeys: ['ech.apm.chatty_share', 'ech.apm.logsdb_reduction', 'ech.apm.index_factor', 'ech.logsdb_share'], source: 'ECH APM!K142:K146, K152, E100, E108', code: 'ech/apm.ts',
  },
  {
    id: 'ech.apm_server', area, group: 'APM', title: 'APM Server size',
    formula: 'events per second = ((4 + 4 × 5 × sampling) × (1 − chatty share) + (4 + 4 × 500 × sampling) × chatty share) × traces per minute ÷ 60\nAPM Server memory = the smallest size on the ladder that serves those events at 300 events per second per GB',
    explanation: 'The APM Server receives the traces. Sampling applies only to spans in this count, as in the spreadsheet. A value exactly on a step takes that step, where the spreadsheet shows an error.',
    constantKeys: ['ech.apm.transactions_per_trace', 'ech.apm.spans_per_transaction', 'ech.apm.chatty_spans_per_transaction', 'ech.apm.sampling_rate', 'ech.apm.chatty_share'],
    source: 'ECH APM!K147:K148; Specs APM sizing', code: 'ech/apm.ts',
  },
  {
    id: 'ech.apm_transfer', area, group: 'APM', title: 'APM transfer and storage',
    formula: 'transfer and storage = 10% × (data tier lines + APM Server line)',
    explanation: 'APM uses a flat share instead of the detailed transfer model. The rounded total applies it to the rounded lines, as the spreadsheet does.',
    constantKeys: ['ech.apm.dts_share'], source: 'ECH APM!J18, E110', code: 'ech/apm.ts',
  },

  // ---- Search -----------------------------------------------------------------------------------------
  {
    id: 'ech.search_cpu', area, group: 'Search', title: 'Memory needed for searching',
    formula: 'busy threads = query time in ms × operations per second ÷ 1,000\nthreads per processor core = (ROUNDDOWN(cores × 1.5) + 1) ÷ cores\ncores needed = busy threads ÷ threads per core\nmemory for search = cores needed ÷ cores per GB of the hardware',
    explanation: 'Each search keeps a thread busy for its query time. Elasticsearch runs about one and a half search threads per core, so busier searching needs more cores, which come with more memory.',
    constantKeys: ['ech.search.query_ms', 'ech.search.threadpool', 'ech.search.use_cases'], source: 'ECH Search!K101:K103, K114; Specs col K:L', code: 'ech/search.ts',
  },
  {
    id: 'ech.search_storage', area, group: 'Search', title: 'Memory needed for search storage',
    formula: 'catalog = documents × KB per document ÷ 1,000,000\nstorage = catalog × storage modifier ÷ (1 − disk kept free) × (1 + spare copies)\nmemory for storage = storage ÷ GB of disk per GB of memory\ndata memory = MAX(memory for search, memory for storage), rounded to node sizes over the zones',
    explanation: 'The catalog is the searchable data. Whichever of searching or storage needs more memory sets the data nodes. The spreadsheet’s displayed disk multiplies by 1.2 instead of dividing by 0.8; sizing uses the division.',
    constantKeys: ['ech.search.reserved_storage', 'ech.search.replicas', 'ech.search.zones', 'ech.search.use_cases'], source: 'ECH Search!K106:K125, E71', code: 'ech/search.ts',
  },
  {
    id: 'ech.search_enterprise', area, group: 'Search', title: 'Crawler and connector nodes',
    formula: 'memory = rounded data memory × 0.25, on the crawler hardware’s sizes, kept between 2 and 8 GB (crawlers and connectors only)',
    explanation: 'Crawlers and connectors fetch content from websites and other systems. Custom search has none.',
    constantKeys: ['ech.search.use_cases', 'ech.search.enterprise_search_ram_gb'], source: 'ECH Search!K140:K153, H168:K169', code: 'ech/search.ts',
  },
  {
    id: 'ech.search_transfer', area, group: 'Search', title: 'Search transfer and storage',
    formula: 'transfer and storage = 15% × (data line + crawler line)',
    explanation: 'Search uses a flat share. Master, coordinating, machine learning and Kibana are the fixed sizes shown under Node sizes.',
    constantKeys: ['ech.search.dts_share', 'ech.fixed_ram_gb'], source: 'ECH Search!J8, E84, E20:E23', code: 'ech/search.ts',
  },

  // ---- Vector search ----------------------------------------------------------------------------------
  {
    id: 'ech.vector_hnsw', area, group: 'Vector search', title: 'Plain and int8 vectors',
    formula: 'bytes per vector = float32: 4 × (dimensions + 12); int8: 1 × (dimensions + 48)\nGB = ROUNDUP(vectors × bytes per vector ÷ 1,000,000,000)\nnode size = the first size whose memory outside the heap holds the GB per zone',
    explanation: 'A vector is a list of numbers (its dimensions) used for AI search. These kinds keep every vector in memory outside the heap (the part Elasticsearch reserves for itself), including the search graph. The spreadsheet counts zones twice here; it only shows with more than one zone.',
    constantKeys: ['ech.vector.hnsw_bytes', 'ech.vector.small_node_heap_gb', 'ech.vector.zones', 'ech.vector.replicas'], source: 'ECH Vector Search & BBQ!D31:D78, D104:E111', code: 'ech/search.ts',
  },
  {
    id: 'ech.vector_bbq', area, group: 'Vector search', title: 'BBQ vectors',
    formula: 'BBQ GB = vectors × (dimensions ÷ 8 + 14) ÷ 1,000,000,000\ngraph GB = 4 × 16 × vectors ÷ 1,000,000,000\nmemory outside the heap needed = ROUNDUP(BBQ + graph)\ndisk needed = ROUNDUP(full-size vectors + BBQ + graph)\nmemory = the smallest table size covering both, × (1 + spare copies), per zone',
    explanation: 'BBQ compresses each number to one bit, so vectors take about a thirty-second of their full size in memory. The full-size copy stays on disk.',
    constantKeys: ['ech.vector.bbq_bytes', 'ech.vector.ram_table', 'ech.vector.offheap_per_60gb', 'ech.vector.small_node_offheap_gb'], source: 'ECH Vector Search & BBQ!K31:K57', code: 'ech/search.ts',
  },
  {
    id: 'ech.vector_ram_table', area, group: 'Vector search', title: 'Memory outside the heap per node size',
    formula: 'vector-optimised hardware: 45 of every 60 GB (smaller sizes from a table)\nother hardware: 30 of every 60 GB\nsizes: 1, 2, 4, 8, 15, 30, 60 GB (Google Cloud 1, 2, 4, 8, 16, 32, 64), then multiples of the largest',
    explanation: 'How much of each node’s memory can hold vectors, depending on the hardware.',
    constantKeys: ['ech.vector.ram_table', 'ech.vector.offheap_per_60gb', 'ech.vector.small_node_offheap_gb'], source: 'ECH Vector Search & BBQ!J131:P705, S151:Y725, K127:L128', code: 'ech/search.ts',
  },
  {
    id: 'ech.vector_disk_bbq', area, group: 'Vector search', title: 'Disk BBQ vectors',
    formula: 'centroids = vectors ÷ 384 × (dimensions + 16) bytes\nquantized = vectors × 2 × (dimensions ÷ 8 + 16) bytes\ndisk = centroids + quantized + full-size vectors\nmemory outside the heap: low = centroids + 5% of quantized; high = 50% of (centroids + quantized)',
    explanation: 'Disk BBQ keeps most vectors on disk and only a working set in memory, so memory is given as a range. The spreadsheet always reads the general memory tables here, and its second to fourth hardware options always use the AWS and Azure table; both are kept to match.',
    constantKeys: ['ech.vector.disk_bbq', 'ech.vector.ram_table', 'ech.vector.offheap_per_60gb'], source: 'ECH Vector Search & BBQ!R31:R88', code: 'ech/search.ts',
  },

  // ---- Transfer and storage -----------------------------------------------------------------------------
  {
    id: 'ech.data_in', area, group: 'Transfer and storage', title: 'Data coming in per month',
    formula: 'data in = GB per day × raw-to-JSON factor × 365 ÷ 12',
    explanation: 'Raw logs grow when turned into JSON documents (3.66 times). Data coming in is free, but it drives the transfer between nodes.',
    constantKeys: ['ech.raw_to_json'], source: 'ECH Logs!J87, E104', code: 'ech/observability.ts',
  },
  {
    id: 'ech.inter_node', area, group: 'Transfer and storage', title: 'Data moved between nodes',
    formula: 'coordinating to hot = data in × (1 − compression)\nhot to hot = data in × spare copies × (1 − compression)\nhot to snapshot = data in ÷ raw-to-JSON × index factor × (LogsDB reduction × LogsDB share + (1 − LogsDB share))\ncost = GB moved × transfer price per GB from the price table',
    explanation: 'Clouds charge for data moving between zones. The hot-to-snapshot line multiplies by the LogsDB reduction (0.54) where the share kept (0.46) belongs; that spreadsheet quirk is kept so totals match.',
    constantKeys: ['ech.node_to_node_compression', 'ech.raw_to_json', 'ech.logsdb_reduction', 'ech.logsdb_share', 'ech.index_factor', 'ech.replicas'], source: 'ECH Logs!J88:J91, E105, I72', code: 'ech/observability.ts',
  },
  {
    id: 'ech.snapshot_storage', area, group: 'Transfer and storage', title: 'Snapshot storage and data out',
    formula: 'snapshot GB = sum over tiers of one copy × index factor\ndata out = snapshot GB × 15%\nAPI calls = 20 thousand per hour × hours per month\nstorage per year = (snapshot GB × snapshot price + API calls × API price) × 12',
    explanation: 'Snapshots are backups in object storage. Prices come from the price table; FedRAMP High regions use their own data-out and storage prices.',
    constantKeys: ['ech.data_out_share', 'ech.storage_api_calls_per_hour', 'ech.hours_per_month', 'ech.index_factor'], source: 'ECH Logs!I95:L96, M92, I73:I74', code: 'ech/observability.ts',
  },
];
