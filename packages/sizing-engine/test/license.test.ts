// SPEC §5.6 license floor, amended by D29: self-managed offers only Basic and Enterprise.
import { describe, expect, it } from 'vitest';
import { forward, type ForwardOptions, type WorkloadProfile } from '../src/index.ts';

const SM: ForwardOptions = { model: 'self_managed' };
const hotLogs: WorkloadProfile = { id: 'l', kind: 'logs', rawGbPerDay: 100, indexMode: 'standard', retentionDays: { hot: 30 }, replicas: {} };
const ml: WorkloadProfile = { id: 'ml', kind: 'ml', ml: { anomalyJobs: 10 }, retentionDays: {}, replicas: {} };

describe('D29 license floor', () => {
  it('hot-only logs with no licensed features stay on Basic', () => {
    expect(forward({ workloads: [hotLogs], options: SM }).licenseFloor).toBe('basic');
  });

  it('ML, cross-cluster replication and FIPS 140-3 each require Enterprise', () => {
    expect(forward({ workloads: [hotLogs, ml], options: SM }).licenseFloor).toBe('enterprise');
    expect(forward({ workloads: [hotLogs], options: { ...SM, sites: 2, ccrMode: 'unidirectional' } }).licenseFloor).toBe('enterprise');
    expect(forward({ workloads: [hotLogs], options: { ...SM, fips: true } }).licenseFloor).toBe('enterprise');
  });
});
