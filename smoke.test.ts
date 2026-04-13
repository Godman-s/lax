/**
 * LAX — Linked Agent eXchange
 * Smoke test — offer creation, validation, registry, A2A export
 * Run: npx tsx smoke.test.ts
 */

import { strict as assert } from 'node:assert';
import {
  createOffer,
  createCapability,
  validateOffer,
  RegistryClient,
  A2AExporter,
  LAX_VERSION,
  LAX_WELL_KNOWN_PATH,
  A2A_WELL_KNOWN_PATH,
} from './src/index.js';
import type {
  LaxOffer,
  LaxCapability,
  LaxPricing,
  OfferValidationResult,
  A2AAgentCard,
} from './src/types.js';

let passed = 0;

// --- Version ---
assert.equal(LAX_VERSION, '1.0');
passed++;
console.log('OK  LAX_VERSION is 1.0');

// --- Well-known paths ---
assert.equal(LAX_WELL_KNOWN_PATH, '/.well-known/lax-offer.json');
assert.equal(A2A_WELL_KNOWN_PATH, '/.well-known/agent.json');
passed++;
console.log('OK  Well-known paths are correct');

// --- createCapability ---
const cap = createCapability({
  skill_id: 'create_invoice',
  description: 'Create a new invoice',
  pricing: { model: 'per_call', amount: '0.01', currency: 'USDC', rail: 'x402' },
});
assert.equal(cap.skill_id, 'create_invoice');
assert.equal(cap.description, 'Create a new invoice');
assert.deepEqual(cap.input_schema, {});
assert.deepEqual(cap.output_schema, {});
assert.equal(cap.pricing.model, 'per_call');
assert.equal(cap.pricing.amount, '0.01');
assert.equal(cap.pricing.currency, 'USDC');
assert.equal(cap.pricing.rail, 'x402');
passed++;
console.log('OK  createCapability: basic creation with defaults');

const capWithSchemas = createCapability({
  skill_id: 'send_reminder',
  description: 'Send a payment reminder',
  input_schema: { type: 'object', properties: { invoice_id: { type: 'string' } } },
  output_schema: { type: 'object', properties: { sent: { type: 'boolean' } } },
  pricing: { model: 'per_call', amount: '0.005', currency: 'USDC', rail: 'x402' },
});
assert.deepEqual(capWithSchemas.input_schema, {
  type: 'object',
  properties: { invoice_id: { type: 'string' } },
});
passed++;
console.log('OK  createCapability: with explicit schemas');

// --- createOffer ---
const offer = createOffer({
  agent_did: 'did:kognai:invoica-ceo',
  erc8004_identity: '0x2458cBd0FEdC4fAcf6C1313938a19b35fB41bC0b',
  soul_uri: 'https://invoica.kognai.ai/.well-known/soul.md',
  capabilities: [cap, capWithSchemas],
  constitutional_constraints: ['khaldunian-commitment', 'five-immutable-laws'],
  acp_score: 92,
  acp_attestation_uid: '0xabc123def456',
  pact_endpoint: 'https://invoica.kognai.ai/pact',
  payment_rails: ['x402', 'usdc-base'],
});
assert.equal(offer.lax_version, '1.0');
assert.equal(offer.agent_did, 'did:kognai:invoica-ceo');
assert.equal(offer.capabilities.length, 2);
assert.equal(offer.acp_score, 92);
assert.ok(offer.updated_at);
passed++;
console.log('OK  createOffer: full offer creation');

// --- validateOffer: valid ---
const validResult = validateOffer(offer);
assert.equal(validResult.valid, true);
assert.equal(validResult.errors.length, 0);
passed++;
console.log('OK  validateOffer: valid offer passes');

// --- validateOffer: warnings for empty constraints ---
const noConstraintsOffer = createOffer({
  agent_did: 'did:kognai:test',
  erc8004_identity: '0x1234',
  soul_uri: 'https://test.com/soul.md',
  capabilities: [cap],
  constitutional_constraints: [],
  acp_score: 50,
  acp_attestation_uid: '0xdef789',
  pact_endpoint: 'https://test.com/pact',
  payment_rails: ['x402'],
});
const warnResult = validateOffer(noConstraintsOffer);
assert.equal(warnResult.valid, true);
assert.ok(warnResult.warnings.length > 0);
passed++;
console.log('OK  validateOffer: warns on empty constitutional_constraints');

// --- validateOffer: invalid offer ---
const badOffer: LaxOffer = {
  lax_version: '1.0',
  agent_did: '',
  erc8004_identity: '',
  soul_uri: '',
  capabilities: [],
  constitutional_constraints: [],
  acp_score: -5,
  acp_attestation_uid: '',
  pact_endpoint: '',
  payment_rails: [],
  updated_at: '',
};
const badResult = validateOffer(badOffer);
assert.equal(badResult.valid, false);
assert.ok(badResult.errors.length > 0);
passed++;
console.log('OK  validateOffer: rejects invalid offer with multiple errors');

// --- validateOffer: wrong version ---
const wrongVersionOffer = { ...offer, lax_version: '2.0' as any };
const versionResult = validateOffer(wrongVersionOffer);
assert.equal(versionResult.valid, false);
assert.ok(versionResult.errors.some((e: string) => e.includes('lax_version')));
passed++;
console.log('OK  validateOffer: rejects wrong lax_version');

// --- validateOffer: ACP score out of range ---
const highAcpOffer = { ...offer, acp_score: 150 };
const acpResult = validateOffer(highAcpOffer);
assert.equal(acpResult.valid, false);
assert.ok(acpResult.errors.some((e: string) => e.includes('acp_score')));
passed++;
console.log('OK  validateOffer: rejects acp_score > 100');

// --- RegistryClient: instantiation ---
const registry = new RegistryClient();
assert.equal(registry.config.registry_url, 'https://lax.kognai.ai/registry');
assert.equal(registry.config.timeout_ms, 10_000);
passed++;
console.log('OK  RegistryClient: default config');

const customRegistry = new RegistryClient({
  registry_url: 'https://custom.registry.io',
  x402_token: 'tok_test',
  timeout_ms: 5000,
});
assert.equal(customRegistry.config.registry_url, 'https://custom.registry.io');
assert.equal(customRegistry.config.x402_token, 'tok_test');
assert.equal(customRegistry.config.timeout_ms, 5000);
passed++;
console.log('OK  RegistryClient: custom config');

// --- RegistryClient: register (stub returns offer) ---
const registered = await registry.register(offer);
assert.equal(registered.agent_did, offer.agent_did);
passed++;
console.log('OK  RegistryClient.register: returns offer (stub)');

// --- RegistryClient: register rejects invalid ---
try {
  await registry.register(badOffer);
  assert.fail('should throw');
} catch (e: any) {
  assert.ok(e.message.includes('validation failed'));
}
passed++;
console.log('OK  RegistryClient.register: rejects invalid offer');

// --- RegistryClient: search (stub returns empty) ---
const searchResults = await registry.search({ query: 'invoice', min_acp_score: 80 });
assert.ok(Array.isArray(searchResults));
assert.equal(searchResults.length, 0);
passed++;
console.log('OK  RegistryClient.search: returns empty array (stub)');

// --- RegistryClient: validate (structural) ---
const validateResult = await registry.validate(offer);
assert.equal(validateResult.valid, true);
passed++;
console.log('OK  RegistryClient.validate: valid offer passes');

// --- A2AExporter: export ---
const a2aCard = A2AExporter.export(
  offer,
  'Invoica CEO',
  'https://invoica.kognai.ai',
  { organization: 'Kognai' }
);
assert.equal(a2aCard.name, 'Invoica CEO');
assert.equal(a2aCard.url, 'https://invoica.kognai.ai');
assert.equal(a2aCard.skills.length, 2);
assert.equal(a2aCard.skills[0]!.id, 'create_invoice');
assert.equal(a2aCard.skills[1]!.id, 'send_reminder');
assert.equal(a2aCard.provider?.organization, 'Kognai');
assert.equal(a2aCard.version, '1.0');
passed++;
console.log('OK  A2AExporter.export: converts offer to A2A card');

// --- A2AExporter: serialize ---
const json = A2AExporter.serialize(a2aCard);
assert.ok(json.startsWith('{'));
const parsed = JSON.parse(json) as A2AAgentCard;
assert.equal(parsed.name, 'Invoica CEO');
assert.equal(parsed.skills.length, 2);
passed++;
console.log('OK  A2AExporter.serialize: produces valid JSON');

// --- A2AExporter: without provider ---
const noProviderCard = A2AExporter.export(offer, 'Test Agent', 'https://test.com');
assert.equal(noProviderCard.provider, undefined);
passed++;
console.log('OK  A2AExporter.export: works without provider');

console.log(`\nAll ${passed} LAX smoke tests passed`);
