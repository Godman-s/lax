/**
 * LAX smoke test — budget, probe, routing, SLA
 * Run: npx tsx smoke.test.ts
 */

import { strict as assert } from 'node:assert';
import {
  createBudget,
  createProbe,
  routeTask,
  registerSLA,
  checkSLACompliance,
  LAX_VERSION,
} from './src/index.js';
import type { ExecutionSlot } from './src/types.js';

let passed = 0;

// --- Version ---
assert.equal(LAX_VERSION, '0.2');
passed++;
console.log('✓ LAX_VERSION is 0.2');

// --- createBudget ---
const budget = createBudget(500, 200);
assert.equal(budget.maxLatencyMs, 500);
assert.equal(budget.targetLatencyMs, 200);
assert.equal(budget.hardLimit, false);
assert.ok(budget.id);
assert.ok(budget.createdAt);
passed++;
console.log('✓ createBudget: basic creation');

const hardBudget = createBudget(100, 50, true);
assert.equal(hardBudget.hardLimit, true);
passed++;
console.log('✓ createBudget: hard limit');

try {
  createBudget(100, 200); // target > max
  assert.fail('should throw');
} catch (e: any) {
  assert.ok(e.message.includes('targetLatencyMs'));
}
passed++;
console.log('✓ createBudget: rejects target > max');

// --- createProbe ---
const probe = createProbe('mac-mini-m4', 45, true);
assert.equal(probe.runtimeId, 'mac-mini-m4');
assert.equal(probe.latencyMs, 45);
assert.equal(probe.reachable, true);
passed++;
console.log('✓ createProbe: basic');

const downProbe = createProbe('edge-worker', 0, false);
assert.equal(downProbe.reachable, false);
passed++;
console.log('✓ createProbe: unreachable');

// --- routeTask ---
const slots: ExecutionSlot[] = [
  { id: 's1', runtimeId: 'mac-mini', measuredLatencyMs: 40, available: true, lastProbeAt: new Date().toISOString() },
  { id: 's2', runtimeId: 'hetzner', measuredLatencyMs: 150, available: true, lastProbeAt: new Date().toISOString() },
  { id: 's3', runtimeId: 'edge', measuredLatencyMs: 300, available: false, lastProbeAt: new Date().toISOString() },
];

const decision = routeTask('task-1', 'did:kognai:messi', budget, slots);
assert.equal(decision.selectedRuntimeId, 'hetzner'); // closest to target 200
assert.equal(decision.reason, 'within_target'); // 150ms <= 200ms target
passed++;
console.log('✓ routeTask: selects closest to target');

const tightBudget = createBudget(100, 30);
const tightDecision = routeTask('task-2', 'did:kognai:messi', tightBudget, slots);
assert.equal(tightDecision.selectedRuntimeId, 'mac-mini'); // only one within budget
assert.equal(tightDecision.reason, 'within_budget'); // 40ms > 30ms target, but <= 100ms max
passed++;
console.log('✓ routeTask: tight budget filters correctly');

const impossibleBudget = createBudget(10, 5);
const bestEffort = routeTask('task-3', 'did:kognai:messi', impossibleBudget, slots);
assert.equal(bestEffort.reason, 'best_effort');
assert.equal(bestEffort.selectedRuntimeId, 'mac-mini'); // lowest latency
passed++;
console.log('✓ routeTask: best_effort when no slot fits');

try {
  const noSlots: ExecutionSlot[] = [
    { id: 's3', runtimeId: 'edge', measuredLatencyMs: 300, available: false, lastProbeAt: new Date().toISOString() },
  ];
  routeTask('task-4', 'did:kognai:messi', budget, noSlots);
  assert.fail('should throw');
} catch (e: any) {
  assert.ok(e.message.includes('No available'));
}
passed++;
console.log('✓ routeTask: throws when no available slots');

// --- registerSLA ---
const sla = registerSLA('did:kognai:harvey', 'mac-mini', 100, 10);
assert.equal(sla.agent, 'did:kognai:harvey');
assert.equal(sla.runtimeId, 'mac-mini');
assert.equal(sla.maxLatencyMs, 100);
assert.equal(sla.minThroughputRps, 10);
assert.equal(sla.validUntil, null);
passed++;
console.log('✓ registerSLA: basic creation');

// --- checkSLACompliance ---
const goodProbe = createProbe('mac-mini', 45, true);
const goodResult = checkSLACompliance(sla, goodProbe);
assert.equal(goodResult.compliant, true);
passed++;
console.log('✓ checkSLACompliance: compliant');

const slowProbe = createProbe('mac-mini', 150, true);
const slowResult = checkSLACompliance(sla, slowProbe);
assert.equal(slowResult.compliant, false);
assert.ok(slowResult.reason.includes('latency_exceeded'));
passed++;
console.log('✓ checkSLACompliance: latency exceeded');

const deadProbe = createProbe('mac-mini', 0, false);
const deadResult = checkSLACompliance(sla, deadProbe);
assert.equal(deadResult.compliant, false);
assert.equal(deadResult.reason, 'runtime_unreachable');
passed++;
console.log('✓ checkSLACompliance: unreachable');

console.log(`\n✅ All ${passed} LAX smoke tests passed`);
