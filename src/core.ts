/**
 * LAX — Latency-Aware Execution
 * Core implementation: budget, probe, routing, SLA
 * @version 0.2.0
 */

import { randomUUID } from 'node:crypto';
import type {
  AgentId,
  DurationMs,
  ExecutionSlot,
  LatencyBudget,
  LatencyProbe,
  RoutingDecision,
  SLAContract,
  Timestamp,
} from './types.js';

// ---------------------------------------------------------------------------
// Budget creation
// ---------------------------------------------------------------------------

/**
 * Create a LatencyBudget for a task.
 * @param maxLatencyMs  Hard ceiling — abort/re-route if exceeded
 * @param targetLatencyMs  Soft target the scheduler optimises toward
 * @param hardLimit  If true, abort the task on budget breach (default: false)
 */
export function createBudget(
  maxLatencyMs: DurationMs,
  targetLatencyMs: DurationMs,
  hardLimit = false,
  options: { id?: string; createdAt?: Timestamp } = {}
): LatencyBudget {
  if (maxLatencyMs <= 0) throw new Error('maxLatencyMs must be positive');
  if (targetLatencyMs <= 0) throw new Error('targetLatencyMs must be positive');
  if (targetLatencyMs > maxLatencyMs) throw new Error('targetLatencyMs must be <= maxLatencyMs');
  return {
    id: options.id ?? randomUUID(),
    maxLatencyMs,
    targetLatencyMs,
    hardLimit,
    createdAt: options.createdAt ?? new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Runtime probing
// ---------------------------------------------------------------------------

/**
 * Create a LatencyProbe result for a runtime.
 * In production, replace with actual HTTP HEAD timing.
 * This function creates the probe data structure — actual network
 * measurement is the caller's responsibility.
 */
export function createProbe(
  runtimeId: string,
  latencyMs: DurationMs,
  reachable: boolean,
  probedAt?: Timestamp
): LatencyProbe {
  return {
    runtimeId,
    latencyMs,
    reachable,
    probedAt: probedAt ?? new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Task routing
// ---------------------------------------------------------------------------

/**
 * Route a task to the best available runtime given a LatencyBudget.
 *
 * Selection strategy:
 *  1. Filter out unavailable slots
 *  2. Filter out slots exceeding budget.maxLatencyMs
 *  3. Sort by proximity to budget.targetLatencyMs (prefer closest match)
 *  4. If no slot fits, return the lowest-latency available slot with reason 'best_effort'
 *  5. If no available slots at all, throw
 */
export function routeTask(
  taskId: string,
  agent: AgentId,
  budget: LatencyBudget,
  slots: ExecutionSlot[]
): RoutingDecision {
  const available = slots.filter((s) => s.available);
  if (available.length === 0) {
    throw new Error(`No available execution slots for task ${taskId}`);
  }

  // Slots within budget
  const withinBudget = available.filter(
    (s) => s.measuredLatencyMs <= budget.maxLatencyMs
  );

  let selected: ExecutionSlot;
  let reason: string;

  if (withinBudget.length > 0) {
    // Sort by proximity to target
    withinBudget.sort(
      (a, b) =>
        Math.abs(a.measuredLatencyMs - budget.targetLatencyMs) -
        Math.abs(b.measuredLatencyMs - budget.targetLatencyMs)
    );
    selected = withinBudget[0]!;
    reason =
      selected.measuredLatencyMs <= budget.targetLatencyMs
        ? 'within_target'
        : 'within_budget';
  } else {
    // Best effort — pick lowest latency even though it exceeds budget
    available.sort((a, b) => a.measuredLatencyMs - b.measuredLatencyMs);
    selected = available[0]!;
    reason = 'best_effort';
  }

  return {
    id: randomUUID(),
    taskId,
    agent,
    selectedRuntimeId: selected.runtimeId,
    estimatedLatencyMs: selected.measuredLatencyMs,
    reason,
    decidedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// SLA registration
// ---------------------------------------------------------------------------

/**
 * Register an SLA contract between an agent and a runtime.
 */
export function registerSLA(
  agent: AgentId,
  runtimeId: string,
  maxLatencyMs: DurationMs,
  minThroughputRps: number,
  options: {
    id?: string;
    validFrom?: Timestamp;
    validUntil?: Timestamp | null;
  } = {}
): SLAContract {
  if (maxLatencyMs <= 0) throw new Error('maxLatencyMs must be positive');
  if (minThroughputRps <= 0) throw new Error('minThroughputRps must be positive');
  return {
    id: options.id ?? randomUUID(),
    agent,
    runtimeId,
    maxLatencyMs,
    minThroughputRps,
    validFrom: options.validFrom ?? new Date().toISOString(),
    validUntil: options.validUntil ?? null,
  };
}

// ---------------------------------------------------------------------------
// SLA compliance check
// ---------------------------------------------------------------------------

/**
 * Check whether a probe result satisfies an SLA contract.
 */
export function checkSLACompliance(
  sla: SLAContract,
  probe: LatencyProbe
): { compliant: boolean; reason: string } {
  if (!probe.reachable) {
    return { compliant: false, reason: 'runtime_unreachable' };
  }
  if (probe.latencyMs > sla.maxLatencyMs) {
    return {
      compliant: false,
      reason: `latency_exceeded: ${probe.latencyMs}ms > ${sla.maxLatencyMs}ms`,
    };
  }
  return { compliant: true, reason: 'ok' };
}
