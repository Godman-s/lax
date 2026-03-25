/**
 * LAX — Latency-Aware Execution
 * Public API surface
 * @version 0.2.0
 */

// Types
export type {
  AgentId,
  Timestamp,
  DurationMs,
  LatencyBudget,
  ExecutionSlot,
  SLAContract,
  RoutingDecision,
  LatencyProbe,
} from './types.js';

// Core implementation
export {
  createBudget,
  createProbe,
  routeTask,
  registerSLA,
  checkSLACompliance,
} from './core.js';

/** Protocol version constant */
export const LAX_VERSION = '0.2' as const;
