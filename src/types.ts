/**
 * LAX — Linked Agent eXchange
 * "Discoverable by design. An agent that cannot be found cannot transact."
 *
 * Core type definitions for the agent capability discovery protocol.
 * @version 0.3.0
 */

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

/**
 * Pricing model for a single capability.
 */
export interface LaxPricing {
  /** Pricing model: "per_call", "per_minute", "flat", "free" */
  model: string;
  /** Amount as string to avoid floating-point issues (e.g. "0.01") */
  amount: string;
  /** Currency identifier (e.g. "USDC", "USD", "ETH") */
  currency: string;
  /** Payment rail (e.g. "x402", "usdc-base", "stripe", "lightning") */
  rail: string;
}

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

/**
 * A single capability that an agent offers.
 * Maps to an OpenClaw skill or A2A action.
 */
export interface LaxCapability {
  /** Unique skill identifier (e.g. "create_invoice", "send_payment_reminder") */
  skill_id: string;
  /** Human-readable description of what this capability does */
  description: string;
  /** JSON Schema describing the expected input */
  input_schema: Record<string, unknown>;
  /** JSON Schema describing the output */
  output_schema: Record<string, unknown>;
  /** Pricing for invoking this capability */
  pricing: LaxPricing;
}

// ---------------------------------------------------------------------------
// LAX Offer
// ---------------------------------------------------------------------------

/**
 * The LAX Offer — the core discoverable document an agent publishes.
 * Served at `/.well-known/lax-offer.json` or registered in a LAX Registry.
 */
export interface LaxOffer {
  /** Protocol version — always "1.0" for this release */
  lax_version: "1.0";
  /** Agent DID (Decentralized Identifier) */
  agent_did: string;
  /** ERC-8004 on-chain identity token address */
  erc8004_identity: string;
  /** URI pointing to the agent's SOUL.md for constitutional verification */
  soul_uri: string;
  /** List of capabilities this agent offers */
  capabilities: LaxCapability[];
  /** Constitutional constraints this agent operates under */
  constitutional_constraints: string[];
  /** Agent Constitutional Performance score (0-100) */
  acp_score: number;
  /** EAS attestation UID for the ACP score */
  acp_attestation_uid: string;
  /** PACT endpoint URL for initiating negotiation */
  pact_endpoint: string;
  /** Accepted payment rails (e.g. ["x402", "usdc-base"]) */
  payment_rails: string[];
  /** ISO 8601 timestamp — when this offer was last updated */
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Registry types
// ---------------------------------------------------------------------------

/** Search parameters for querying the LAX Registry. */
export interface RegistrySearchParams {
  /** Free-text query against capability descriptions */
  query?: string;
  /** Filter by specific skill IDs */
  skill_ids?: string[];
  /** Filter by payment rail */
  payment_rail?: string;
  /** Minimum ACP score threshold */
  min_acp_score?: number;
  /** Maximum number of results (default: 20, max: 100) */
  limit?: number;
  /** Pagination offset */
  offset?: number;
}

/** A search result returned from the registry. */
export interface RegistrySearchResult {
  /** The matching offer */
  offer: LaxOffer;
  /** Relevance score (0.0-1.0) */
  relevance: number;
}

/** Validation result for an offer submitted to the registry. */
export interface OfferValidationResult {
  /** Whether the offer passed validation */
  valid: boolean;
  /** List of validation errors, if any */
  errors: string[];
  /** List of warnings (non-blocking) */
  warnings: string[];
}

/** Configuration for the RegistryClient. */
export interface RegistryClientConfig {
  /** Registry base URL (default: "https://lax.kognai.ai/registry") */
  registry_url: string;
  /** x402 payment token for write operations */
  x402_token?: string;
  /** Request timeout in milliseconds (default: 10000) */
  timeout_ms?: number;
}

// ---------------------------------------------------------------------------
// A2A export types
// ---------------------------------------------------------------------------

/** Google A2A agent.json format (subset relevant to LAX export). */
export interface A2AAgentCard {
  /** Agent name */
  name: string;
  /** Agent description */
  description: string;
  /** Agent URL */
  url: string;
  /** Agent capabilities / skills in A2A format */
  skills: A2ASkill[];
  /** Agent authentication info */
  authentication?: Record<string, unknown>;
  /** Agent provider info */
  provider?: {
    organization: string;
    url?: string;
  };
  /** Protocol version */
  version: string;
}

/** A2A skill representation. */
export interface A2ASkill {
  /** Skill identifier */
  id: string;
  /** Skill name */
  name: string;
  /** Skill description */
  description: string;
  /** Input JSON Schema */
  inputSchema?: Record<string, unknown>;
  /** Output JSON Schema */
  outputSchema?: Record<string, unknown>;
}
