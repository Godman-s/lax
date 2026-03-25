# LAX — Latency-Aware Execution


[![npm version](https://img.shields.io/npm/v/@godman-protocols/lax.svg)](https://www.npmjs.com/package/@godman-protocols/lax)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Node: >=20](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)

> **v0.2.0** · Apache 2.0 · `@godman-protocols/lax` · Node 20+ / Deno 1.40+

LAX is an open protocol for routing AI agent tasks to the fastest available runtime — using latency budgets, real-time probes, and SLA contracts to guarantee execution stays within acceptable bounds.

```bash
npx skills add https://github.com/godman-protocols/lax
# or
npm install @godman-protocols/lax
```

---

## The Problem

Multi-agent systems run across heterogeneous infrastructure: local GPUs, cloud VMs, edge workers, third-party APIs. Each has different latency characteristics that change throughout the day. Without a scheduling layer, agents either:

- **Over-provision** — always route to the fastest (most expensive) runtime, wasting budget
- **Under-deliver** — pick a cheap runtime that misses latency targets, degrading user experience

LAX is the missing scheduling layer between agent intent and runtime selection.

---

## Core Concepts

| Concept | What it is |
|---------|-----------|
| **LatencyBudget** | A time envelope for a task: hard ceiling (max) + soft target (optimise toward) |
| **ExecutionSlot** | A runtime with known latency characteristics and availability status |
| **LatencyProbe** | A measurement of round-trip time to a runtime endpoint |
| **SLAContract** | Latency and throughput guarantees between an agent and a runtime |
| **RoutingDecision** | The scheduler's output: which runtime, why, estimated latency |

---

## Quickstart

```typescript
import {
  createBudget, createProbe, routeTask,
  registerSLA, checkSLACompliance,
} from '@godman-protocols/lax';
import type { ExecutionSlot } from '@godman-protocols/lax';

// 1. Create a latency budget for a task
const budget = createBudget(
  500,   // maxLatencyMs — hard ceiling
  200,   // targetLatencyMs — soft target
  false  // hardLimit — don't abort on breach, just warn
);

// 2. Define available execution slots (from probe data)
const slots: ExecutionSlot[] = [
  { id: 'slot-1', runtimeId: 'mac-mini-m4',  measuredLatencyMs: 45,   available: true,  lastProbeAt: new Date().toISOString() },
  { id: 'slot-2', runtimeId: 'hetzner-vps',  measuredLatencyMs: 180,  available: true,  lastProbeAt: new Date().toISOString() },
  { id: 'slot-3', runtimeId: 'edge-worker',  measuredLatencyMs: 320,  available: true,  lastProbeAt: new Date().toISOString() },
];

// 3. Route the task — LAX picks the best runtime
const decision = routeTask('task-123', 'did:kognai:messi', budget, slots);
// → { selectedRuntimeId: 'hetzner-vps', reason: 'within_target', estimatedLatencyMs: 180 }

// 4. Register an SLA and verify compliance
const sla = registerSLA('did:kognai:messi', 'hetzner-vps', 300, 10);
const probe = createProbe('hetzner-vps', 180, true);
const compliance = checkSLACompliance(sla, probe);
// → { compliant: true, reason: 'ok' }
```

---

## API Summary

### Budget & Probing (`src/core.ts`)

| Function | Description |
|----------|-------------|
| `createBudget(maxMs, targetMs, hardLimit?, options?)` | Create a latency budget envelope |
| `createProbe(runtimeId, latencyMs, reachable, probedAt?)` | Record a probe measurement |

### Task Routing (`src/core.ts`)

| Function | Description |
|----------|-------------|
| `routeTask(taskId, agent, budget, slots)` | Route task to best runtime given budget + slots |

### SLA Management (`src/core.ts`)

| Function | Description |
|----------|-------------|
| `registerSLA(agent, runtimeId, maxMs, minRps, options?)` | Register an SLA contract |
| `checkSLACompliance(sla, probe)` | Check if a probe result meets SLA guarantees |

---

## Routing Strategy

LAX uses a deterministic selection algorithm:

1. Filter out unavailable slots
2. Filter slots within `budget.maxLatencyMs`
3. Sort by proximity to `budget.targetLatencyMs` (closest match wins)
4. If no slot fits the budget, select the lowest-latency available slot (`best_effort`)
5. If no slots are available at all, throw

Routing reasons: `within_target` | `within_budget` | `best_effort`

---

## Compatibility

| System | How it connects |
|--------|----------------|
| **Kognai** (5-tier router) | LAX budgets map to router tiers: Nano (10ms) → Local (100ms) → Power (500ms) → Cloud (2s) → Apex (10s) |
| **DRS** (Dynamic Resource Scheduling) | DRS allocates resources; LAX routes tasks to allocated slots |
| **PACT** (mandates) | Mandate scope can include latency requirements that LAX enforces |
| **AMF** (message format) | Routing decisions are AMF envelope metadata |

---

## Related Protocols

| Protocol | Purpose |
|----------|---------|
| **PACT** | Agent coordination and trust |
| **LAX** (this repo) | Latency-aware execution scheduling |
| **SCORE** | Scoring and reputation for agent outputs |
| **AMF** | Agent Message Format |
| **DRS** | Dynamic Resource Scheduling |
| **SOUL** | Constitutional constraints and safety |
| **SIGNAL** | Event bus and pub/sub for agent swarms |

---

## Roadmap

- [x] LatencyBudget creation + validation (v0.2)
- [x] LatencyProbe data structure (v0.2)
- [x] Deterministic task routing with budget awareness (v0.2)
- [x] SLA registration + compliance check (v0.2)
- [ ] Adaptive probe scheduling (exponential backoff) (v0.3)
- [ ] Historical latency percentile tracking (v0.3)
- [ ] Multi-region routing with geo-awareness (v0.4)
- [ ] Python SDK (v0.5)
- [ ] x402 payment-gated SLA upgrades (v0.5)

---

## License

Apache License 2.0 — see [LICENSE](./LICENSE)

Part of the [Godman Protocols](https://github.com/godman-protocols) portfolio.
