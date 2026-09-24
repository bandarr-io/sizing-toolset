export type Confidence = 'high' | 'medium' | 'low';

/** One entry of a data/*.json file. Shape is fixed by constants.schema.json (SPEC §6). */
export interface Constant {
  key: string;
  value: unknown;
  unit: string;
  source_url: string;
  as_of_date: string;
  stack_version: string;
  confidence: Confidence;
  notes?: string;
  carried_forward?: boolean;
}

export interface FleetRow {
  agents: number;
  fleetMemGb: number;
  fleetVcpu: number;
  hotRamGb: number;
  hotVcpu: number;
}

export interface MasterSizingRow {
  minDataNodes: number;
  count: number;
  ramGb: number;
}

export interface VectorBytes {
  perDim: number;
  fixed: number;
}

export interface BbqDiskParams {
  vectorsPerCluster: number;
  centroidBytesPerDim: number;
  centroidFixed: number;
  quantPerDim: number;
  quantFixed: number;
  quantCopies: number;
}
