/**
 * LAX — Linked Agent eXchange
 * "Discoverable by design. An agent that cannot be found cannot transact."
 *
 * Core implementation: RegistryClient, A2AExporter, discovery helpers.
 * @version 0.3.0
 */

import type {
  LaxOffer,
  LaxCapability,
  LaxPricing,
  RegistryClientConfig,
  RegistrySearchParams,
  RegistrySearchResult,
  OfferValidationResult,
  A2AAgentCard,
  A2ASkill,
} from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default registry URL */
const DEFAULT_REGISTRY_URL = 'https://lax.kognai.ai/registry';

/** Default request timeout in ms */
const DEFAULT_TIMEOUT_MS = 10_000;

/** Well-known path for self-hosted LAX offers */
export const LAX_WELL_KNOWN_PATH = '/.well-known/lax-offer.json';

/** Well-known path for A2A agent cards */
export const A2A_WELL_KNOWN_PATH = '/.well-known/agent.json';

// ---------------------------------------------------------------------------
// Offer validation
// ---------------------------------------------------------------------------

/**
 * Validate a LaxOffer for structural correctness.
 * Does NOT verify on-chain data — use RegistryClient.validate() for full validation.
 */
export function validateOffer(offer: LaxOffer): OfferValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Required fields
  if (offer.lax_version !== '1.0') {
    errors.push(`lax_version must be "1.0", got "${offer.lax_version}"`);
  }
  if (!offer.agent_did || typeof offer.agent_did !== 'string') {
    errors.push('agent_did is required and must be a non-empty string');
  }
  if (!offer.erc8004_identity || typeof offer.erc8004_identity !== 'string') {
    errors.push('erc8004_identity is required and must be a non-empty string');
  }
  if (!offer.soul_uri || typeof offer.soul_uri !== 'string') {
    errors.push('soul_uri is required and must be a non-empty string');
  }
  if (!offer.pact_endpoint || typeof offer.pact_endpoint !== 'string') {
    errors.push('pact_endpoint is required and must be a non-empty string');
  }
  if (!offer.acp_attestation_uid || typeof offer.acp_attestation_uid !== 'string') {
    errors.push('acp_attestation_uid is required and must be a non-empty string');
  }

  // ACP score range
  if (typeof offer.acp_score !== 'number' || offer.acp_score < 0 || offer.acp_score > 100) {
    errors.push('acp_score must be a number between 0 and 100');
  }

  // Capabilities
  if (!Array.isArray(offer.capabilities) || offer.capabilities.length === 0) {
    errors.push('capabilities must be a non-empty array');
  } else {
    for (let i = 0; i < offer.capabilities.length; i++) {
      const cap = offer.capabilities[i]!;
      if (!cap.skill_id) errors.push(`capabilities[${i}].skill_id is required`);
      if (!cap.description) errors.push(`capabilities[${i}].description is required`);
      if (!cap.pricing) {
        errors.push(`capabilities[${i}].pricing is required`);
      } else {
        if (!cap.pricing.model) errors.push(`capabilities[${i}].pricing.model is required`);
        if (!cap.pricing.currency) errors.push(`capabilities[${i}].pricing.currency is required`);
        if (!cap.pricing.rail) errors.push(`capabilities[${i}].pricing.rail is required`);
      }
    }
  }

  // Payment rails
  if (!Array.isArray(offer.payment_rails) || offer.payment_rails.length === 0) {
    errors.push('payment_rails must be a non-empty array');
  }

  // Constitutional constraints
  if (!Array.isArray(offer.constitutional_constraints)) {
    errors.push('constitutional_constraints must be an array');
  } else if (offer.constitutional_constraints.length === 0) {
    warnings.push('No constitutional_constraints declared — agents with constraints may refuse to transact');
  }

  // Timestamp
  if (!offer.updated_at) {
    errors.push('updated_at is required');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Offer builder helper
// ---------------------------------------------------------------------------

/**
 * Create a new LaxOffer with defaults applied.
 * Caller must supply all required identity fields.
 */
export function createOffer(params: {
  agent_did: string;
  erc8004_identity: string;
  soul_uri: string;
  capabilities: LaxCapability[];
  constitutional_constraints: string[];
  acp_score: number;
  acp_attestation_uid: string;
  pact_endpoint: string;
  payment_rails: string[];
}): LaxOffer {
  return {
    lax_version: '1.0',
    agent_did: params.agent_did,
    erc8004_identity: params.erc8004_identity,
    soul_uri: params.soul_uri,
    capabilities: params.capabilities,
    constitutional_constraints: params.constitutional_constraints,
    acp_score: params.acp_score,
    acp_attestation_uid: params.acp_attestation_uid,
    pact_endpoint: params.pact_endpoint,
    payment_rails: params.payment_rails,
    updated_at: new Date().toISOString(),
  };
}

/**
 * Create a LaxCapability entry.
 */
export function createCapability(params: {
  skill_id: string;
  description: string;
  input_schema?: Record<string, unknown>;
  output_schema?: Record<string, unknown>;
  pricing: LaxPricing;
}): LaxCapability {
  return {
    skill_id: params.skill_id,
    description: params.description,
    input_schema: params.input_schema ?? {},
    output_schema: params.output_schema ?? {},
    pricing: params.pricing,
  };
}

// ---------------------------------------------------------------------------
// RegistryClient
// ---------------------------------------------------------------------------

/**
 * Client for interacting with a LAX Registry.
 *
 * Three operations:
 * - register: Publish an offer to the registry (x402-gated, $0.01 USDC)
 * - search: Find agents by capability, skill, payment rail, ACP score
 * - validate: Submit an offer for full validation (DID resolution, ERC-8004 check)
 *
 * In v0.3.0 this is a typed interface with method stubs — actual HTTP
 * transport is deferred to v0.4.0 (server/client packages).
 */
export class RegistryClient {
  readonly config: RegistryClientConfig;

  constructor(config?: Partial<RegistryClientConfig>) {
    this.config = {
      registry_url: config?.registry_url ?? DEFAULT_REGISTRY_URL,
      x402_token: config?.x402_token,
      timeout_ms: config?.timeout_ms ?? DEFAULT_TIMEOUT_MS,
    };
  }

  /**
   * Register (publish) a LAX offer to the registry.
   * Write access is x402-gated ($0.01 USDC per registration).
   *
   * @param offer - The offer to register
   * @returns The registered offer (with server-side fields populated)
   * @throws If validation fails or payment is rejected
   */
  async register(offer: LaxOffer): Promise<LaxOffer> {
    // Local validation first
    const validation = validateOffer(offer);
    if (!validation.valid) {
      throw new Error(
        `Offer validation failed: ${validation.errors.join('; ')}`
      );
    }

    // In v0.3.0, registry HTTP calls are stubbed.
    // Production implementation will POST to {registry_url}/offers
    // with x402 payment header.
    return offer;
  }

  /**
   * Search the registry for agents matching the given parameters.
   *
   * @param params - Search filters (query, skill_ids, payment_rail, min_acp_score)
   * @returns Array of matching offers with relevance scores
   */
  async search(params: RegistrySearchParams): Promise<RegistrySearchResult[]> {
    // In v0.3.0, search is stubbed.
    // Production implementation will GET {registry_url}/search with query params.
    void params;
    return [];
  }

  /**
   * Submit an offer for full server-side validation.
   * Checks DID resolution, ERC-8004 on-chain identity, SOUL.md availability,
   * and ACP attestation verification.
   *
   * @param offer - The offer to validate
   * @returns Validation result with errors and warnings
   */
  async validate(offer: LaxOffer): Promise<OfferValidationResult> {
    // Local structural validation (server-side adds on-chain checks)
    return validateOffer(offer);
  }
}

// ---------------------------------------------------------------------------
// A2AExporter
// ---------------------------------------------------------------------------

/**
 * Export a LAX Offer to Google A2A agent.json format.
 *
 * Usage:
 *   lax export --format a2a
 *   Generates /.well-known/agent.json from /.well-known/lax-offer.json
 */
export class A2AExporter {
  /**
   * Convert a LAX Offer to A2A Agent Card format.
   *
   * @param offer - The LAX offer to convert
   * @param agentName - Human-readable agent name
   * @param agentUrl - Agent's base URL
   * @param provider - Optional provider information
   * @returns A2A Agent Card
   */
  static export(
    offer: LaxOffer,
    agentName: string,
    agentUrl: string,
    provider?: { organization: string; url?: string }
  ): A2AAgentCard {
    const skills: A2ASkill[] = offer.capabilities.map((cap) => ({
      id: cap.skill_id,
      name: cap.skill_id,
      description: cap.description,
      inputSchema: cap.input_schema,
      outputSchema: cap.output_schema,
    }));

    return {
      name: agentName,
      description: `Agent ${offer.agent_did} — ${offer.capabilities.length} capabilities, ACP score ${offer.acp_score}`,
      url: agentUrl,
      skills,
      provider,
      version: '1.0',
    };
  }

  /**
   * Serialize an A2A Agent Card to JSON string for writing to
   * /.well-known/agent.json.
   */
  static serialize(card: A2AAgentCard): string {
    return JSON.stringify(card, null, 2);
  }
}

// ---------------------------------------------------------------------------
// Discovery helpers
// ---------------------------------------------------------------------------

/**
 * Fetch a LAX Offer from a remote agent's well-known endpoint.
 *
 * @param baseUrl - The agent's base URL (e.g. "https://invoica.kognai.ai")
 * @returns The parsed LaxOffer
 * @throws If the fetch fails or the response is not valid JSON
 */
export async function fetchOffer(baseUrl: string): Promise<LaxOffer> {
  const url = `${baseUrl.replace(/\/$/, '')}${LAX_WELL_KNOWN_PATH}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch LAX offer from ${url}: ${response.status} ${response.statusText}`
    );
  }

  const offer = (await response.json()) as LaxOffer;

  // Validate the fetched offer
  const validation = validateOffer(offer);
  if (!validation.valid) {
    throw new Error(
      `Fetched offer from ${url} is invalid: ${validation.errors.join('; ')}`
    );
  }

  return offer;
}

/**
 * Fetch an A2A Agent Card from a remote agent's well-known endpoint.
 *
 * @param baseUrl - The agent's base URL
 * @returns The parsed A2A Agent Card
 */
export async function fetchA2ACard(baseUrl: string): Promise<A2AAgentCard> {
  const url = `${baseUrl.replace(/\/$/, '')}${A2A_WELL_KNOWN_PATH}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch A2A card from ${url}: ${response.status} ${response.statusText}`
    );
  }

  return (await response.json()) as A2AAgentCard;
}
