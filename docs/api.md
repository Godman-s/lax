# LAX API Reference

> **v0.2.0** · Full API surface for `@godman-protocols/lax`

---

## Types

### `AgentId`
```typescript
type AgentId = string;
```
A unique agent identifier — DID, x402 wallet address, or scoped handle.

### `Timestamp`
```typescript
type Timestamp = string;
```
ISO 8601 timestamp string.

### `DurationMs`
```typescript
type DurationMs = number;
```
Duration in milliseconds. Must be positive for budget/SLA creation.

### `LatencyBudget`
```typescript
interface LatencyBudget {
  id: string;
  maxLatencyMs: DurationMs;
  targetLatencyMs: DurationMs;
  hardLimit: boolean;
  createdAt: Timestamp;
}
```
A time-bounded execution envelope. `maxLatencyMs` is the hard ceiling; `targetLatencyMs` is the soft target the scheduler optimises toward.

### `ExecutionSlot`
```typescript
interface ExecutionSlot {
  id: string;
  runtimeId: string;
  measuredLatencyMs: DurationMs;
  available: boolean;
  lastProbeAt: Timestamp;
}
```
A runtime with known latency characteristics. `runtimeId` examples: `'mac-mini-m4'`, `'hetzner-vps'`, `'edge-worker'`.

### `SLAContract`
```typescript
interface SLAContract {
  id: string;
  agent: AgentId;
  runtimeId: string;
  maxLatencyMs: DurationMs;
  minThroughputRps: number;
  validFrom: Timestamp;
  validUntil: Timestamp | null;
}
```
Latency and throughput guarantees. `validUntil: null` means indefinite.

### `RoutingDecision`
```typescript
interface RoutingDecision {
  id: string;
  taskId: string;
  agent: AgentId;
  selectedRuntimeId: string;
  estimatedLatencyMs: DurationMs;
  reason: string;
  decidedAt: Timestamp;
}
```
Output of the routing algorithm. `reason` is one of: `'within_target'`, `'within_budget'`, `'best_effort'`.

### `LatencyProbe`
```typescript
interface LatencyProbe {
  runtimeId: string;
  latencyMs: DurationMs;
  reachable: boolean;
  probedAt: Timestamp;
}
```

---

## Budget Creation (`src/core.ts`)

### `createBudget(maxLatencyMs, targetLatencyMs, hardLimit?, options?)`

Create a LatencyBudget for a task.

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `maxLatencyMs` | `DurationMs` | — | Hard ceiling — abort/re-route if exceeded |
| `targetLatencyMs` | `DurationMs` | — | Soft target the scheduler optimises toward |
| `hardLimit` | `boolean` | `false` | If true, abort the task on budget breach |
| `options.id` | `string` | auto UUID | Override auto-generated ID |
| `options.createdAt` | `Timestamp` | now | Override timestamp |

**Returns:** `LatencyBudget`

**Throws:** If `maxLatencyMs <= 0`, `targetLatencyMs <= 0`, or `targetLatencyMs > maxLatencyMs`.

---

## Runtime Probing (`src/core.ts`)

### `createProbe(runtimeId, latencyMs, reachable, probedAt?)`

Create a LatencyProbe result for a runtime.

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `runtimeId` | `string` | — | Runtime being probed |
| `latencyMs` | `DurationMs` | — | Measured round-trip latency |
| `reachable` | `boolean` | — | Whether the runtime responded |
| `probedAt` | `Timestamp` | now | Override timestamp |

**Returns:** `LatencyProbe`

---

## Task Routing (`src/core.ts`)

### `routeTask(taskId, agent, budget, slots)`

Route a task to the best available runtime given a LatencyBudget.

| Param | Type | Description |
|-------|------|-------------|
| `taskId` | `string` | Identifier for the task being routed |
| `agent` | `AgentId` | Agent requesting execution |
| `budget` | `LatencyBudget` | Latency constraints |
| `slots` | `ExecutionSlot[]` | Available runtimes with measured latencies |

**Returns:** `RoutingDecision`

**Throws:** If no available execution slots exist.

**Selection algorithm:**
1. Filter unavailable slots
2. Filter slots exceeding `budget.maxLatencyMs`
3. Sort remaining by proximity to `budget.targetLatencyMs`
4. If no slot within budget: pick lowest-latency available slot (`best_effort`)
5. If nothing available: throw

---

## SLA Management (`src/core.ts`)

### `registerSLA(agent, runtimeId, maxLatencyMs, minThroughputRps, options?)`

Register an SLA contract between an agent and a runtime.

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `agent` | `AgentId` | — | Agent requesting the SLA |
| `runtimeId` | `string` | — | Runtime providing the SLA |
| `maxLatencyMs` | `DurationMs` | — | Maximum latency guarantee |
| `minThroughputRps` | `number` | — | Minimum throughput in requests/second |
| `options.id` | `string` | auto UUID | Override ID |
| `options.validFrom` | `Timestamp` | now | Contract start |
| `options.validUntil` | `Timestamp \| null` | `null` | Contract end (null = indefinite) |

**Returns:** `SLAContract`

**Throws:** If `maxLatencyMs <= 0` or `minThroughputRps <= 0`.

### `checkSLACompliance(sla, probe)`

Check whether a probe result satisfies an SLA contract.

| Param | Type | Description |
|-------|------|-------------|
| `sla` | `SLAContract` | The SLA to check against |
| `probe` | `LatencyProbe` | The probe measurement |

**Returns:** `{ compliant: boolean; reason: string }`

Reasons: `'ok'` | `'runtime_unreachable'` | `'latency_exceeded: Xms > Yms'`

---

## Constants

```typescript
const LAX_VERSION: '0.2';
```
