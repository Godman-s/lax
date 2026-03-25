/**
 * LAX — Latency-Aware Execution
 * Core type definitions (skeleton)
 * @version 0.1.0-skeleton
 */

/** A unique agent identifier — DID, x402 wallet address, or scoped handle */
export type AgentId = string;

/** ISO 8601 timestamp */
export type Timestamp = string;

/** Duration in milliseconds */
export type DurationMs = number;

/**
 * A LatencyBudget is a time-bounded execution envelope for agent tasks.
 * If the task exceeds the budget, the scheduler may preempt or re-route.
 */
export interface LatencyBudget {
  /** Unique budget ID */
  id: string;
  /** Maximum allowed latency in ms */
  maxLatencyMs: DurationMs;
  /** Soft target — preferred latency (scheduler optimises toward this) */
  targetLatencyMs: DurationMs;
  /** Whether to abort the task if budget is exceeded */
  hardLimit: boolean;
  /** ISO 8601 — when this budget was created */
  createdAt: Timestamp;
}

/**
 * An ExecutionSlot is a scheduled window on a specific runtime
 * with known latency characteristics.
 */
export interface ExecutionSlot {
  /** Unique slot ID */
  id: string;
  /** Runtime identifier (e.g. 'mac-mini-m4', 'hetzner-vps', 'edge-worker') */
  runtimeId: string;
  /** Measured round-trip latency to this runtime in ms */
  measuredLatencyMs: DurationMs;
  /** Whether the slot is currently available */
  available: boolean;
  /** ISO 8601 — last probe timestamp */
  lastProbeAt: Timestamp;
}

/**
 * SLAContract — latency and throughput guarantees between agent and runtime.
 */
export interface SLAContract {
  /** Unique contract ID */
  id: string;
  /** Agent requesting the SLA */
  agent: AgentId;
  /** Runtime providing the SLA */
  runtimeId: string;
  /** Maximum latency guarantee in ms */
  maxLatencyMs: DurationMs;
  /** Minimum throughput in requests per second */
  minThroughputRps: number;
  /** ISO 8601 — contract validity start */
  validFrom: Timestamp;
  /** ISO 8601 — contract validity end (null = indefinite) */
  validUntil: Timestamp | null;
}

/**
 * RoutingDecision — the outcome of the LAX scheduler selecting a runtime.
 */
export interface RoutingDecision {
  /** Unique decision ID */
  id: string;
  /** The task being routed */
  taskId: string;
  /** The agent requesting execution */
  agent: AgentId;
  /** The selected runtime */
  selectedRuntimeId: string;
  /** Estimated latency for this routing */
  estimatedLatencyMs: DurationMs;
  /** Why this runtime was chosen */
  reason: string;
  /** ISO 8601 */
  decidedAt: Timestamp;
}

/**
 * LatencyProbe — a periodic measurement of round-trip time to a runtime.
 */
export interface LatencyProbe {
  /** Runtime being probed */
  runtimeId: string;
  /** Measured latency in ms */
  latencyMs: DurationMs;
  /** Whether the runtime responded */
  reachable: boolean;
  /** ISO 8601 */
  probedAt: Timestamp;
}
