/**
 * Jobs client for the LAX registry.
 *
 * Fetch only, no runtime dependency. Reads retry on 429, 5xx and network errors; submit
 * retries on 429 only, because a submission is not idempotent and a 5xx does not prove it
 * was not stored.
 *
 * Every failure is a LaxJobsError carrying the HTTP status (0 when there was no answer),
 * a stable machine code, and the registry's own error text as the message.
 */

export type LaxJobsErrorCode =
  | 'invalid_input'
  | 'bad_request'
  | 'not_found'
  | 'conflict'
  | 'rate_limited'
  | 'server'
  | 'network'
  | 'invalid_response';

export class LaxJobsError extends Error {
  readonly status: number;
  readonly code: LaxJobsErrorCode;

  constructor(message: string, status: number, code: LaxJobsErrorCode) {
    super(message);
    this.name = 'LaxJobsError';
    this.status = status;
    this.code = code;
  }
}

export interface Job {
  id: string;
  title?: string;
  track?: string;
  summary?: string;
  spec_md?: string;
  bounty_usdc?: number;
  currency?: string;
  chain?: string;
  deadline?: string;
  bid_closes?: string;
  status?: string;
  skills?: string[];
  [key: string]: unknown;
}

export interface ListJobsParams {
  track?: string;
  limit?: number;
  offset?: number;
}

export interface ListJobsResult {
  jobs: Job[];
  count: number;
}

export interface SubmitInput {
  builder: string;
  contact: string;
  repo_or_patch_url: string;
  payout_address: string;
  agent_did: string;
  notes?: string;
}

export interface SubmissionResult {
  id: string;
  job_id: string;
  status: string;
  created_at: string;
}

export interface JobsClientOptions {
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
  retries?: number;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
}

export interface JobsClient {
  listJobs(params?: ListJobsParams): Promise<ListJobsResult>;
  getJob(id: string): Promise<Job>;
  submit(jobId: string, input: SubmitInput): Promise<SubmissionResult>;
}

const DEFAULT_BASE_URL = 'https://lax.kognai.ai/registry';
const DEFAULT_RETRIES = 2;
const DEFAULT_TIMEOUT_MS = 15000;
const MAX_RETRY_AFTER_SECONDS = 30;
const BASE_BACKOFF_MS = 500;

const sleepTimer = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const retryableCodes: ReadonlySet<LaxJobsErrorCode> = new Set<LaxJobsErrorCode>(['rate_limited', 'server', 'network']);
const neverRetryStatuses: ReadonlySet<number> = new Set<number>([400, 404, 409]);

function statusToCode(status: number): LaxJobsErrorCode {
  if (status === 400) return 'bad_request';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'server';
  return 'bad_request';
}

function registryMessage(body: unknown, fallback: string): string {
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    for (const key of ['error', 'message', 'detail']) {
      const value = record[key];
      if (typeof value === 'string' && value.trim()) return value;
    }
  }
  return fallback;
}

function retryAfterMs(headers: unknown): number | null {
  if (!headers || typeof headers !== 'object') return null;
  const get = (headers as { get?: (name: string) => string | null }).get;
  let raw: string | null | undefined;
  if (typeof get === 'function') {
    raw = get.call(headers, 'retry-after');
  } else {
    const record = headers as Record<string, string | undefined>;
    raw = record['retry-after'] ?? record['Retry-After'];
  }
  if (!raw) return null;
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  return Math.min(seconds, MAX_RETRY_AFTER_SECONDS) * 1000;
}

const DID_PATTERN = /^did:[a-z0-9]+:[A-Za-z0-9._:%-]+$/;
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;
const HTTPS_PATTERN = /^https:\/\/\S+$/;

function assertSubmitInput(input: SubmitInput): void {
  const fail = (message: string): never => {
    throw new LaxJobsError(message, 0, 'invalid_input');
  };
  if (!input || typeof input !== 'object') fail('input is required');
  const { agent_did, payout_address, repo_or_patch_url, builder, contact } = input ?? ({} as SubmitInput);
  if (typeof agent_did !== 'string' || !DID_PATTERN.test(agent_did)) fail('agent_did must be a DID such as did:pkh:eip155:8453:0x...');
  if (typeof payout_address !== 'string' || !ADDRESS_PATTERN.test(payout_address)) fail('payout_address must be 0x followed by 40 hex characters');
  if (typeof repo_or_patch_url !== 'string' || !HTTPS_PATTERN.test(repo_or_patch_url)) fail('repo_or_patch_url must be an https link');
  if (typeof builder !== 'string' || !builder.trim()) fail('builder is required');
  if (typeof contact !== 'string' || !contact.trim()) fail('contact is required');
}

export function createJobsClient(options: JobsClientOptions = {}): JobsClient {
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
  const doFetch = options.fetch ?? globalThis.fetch;
  const retries = Math.max(0, options.retries ?? DEFAULT_RETRIES);
  const sleep = options.sleep ?? sleepTimer;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function once(path: string, init: RequestInit): Promise<unknown> {
    let response: Response;
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      response = await doFetch(`${baseUrl}${path}`, controller ? { ...init, signal: controller.signal } : init);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new LaxJobsError(message || 'network request failed', 0, 'network');
    } finally {
      if (timer) clearTimeout(timer);
    }

    const text = typeof response.text === 'function' ? await response.text() : '';
    let body: unknown = null;
    let parsed = false;
    if (text) {
      try {
        body = JSON.parse(text);
        parsed = true;
      } catch {
        parsed = false;
      }
    } else {
      parsed = true;
      body = null;
    }

    if (!response.ok) {
      const carrier = { body, response };
      const error = new LaxJobsError(
        registryMessage(body, `registry answered ${response.status}`),
        response.status,
        statusToCode(response.status),
      );
      (error as LaxJobsError & { retryAfterMs?: number | null }).retryAfterMs = retryAfterMs((carrier.response as Response).headers);
      throw error;
    }

    if (!parsed) throw new LaxJobsError('registry answered with a body that is not JSON', response.status, 'invalid_response');
    return body;
  }

  async function call(path: string, init: RequestInit, retryMode: 'read' | 'submit'): Promise<unknown> {
    let attempt = 0;
    let backoff = BASE_BACKOFF_MS;
    for (;;) {
      try {
        return await once(path, init);
      } catch (error) {
        const err = error as LaxJobsError & { retryAfterMs?: number | null };
        if (!(err instanceof LaxJobsError)) throw error;
        const retryable =
          retryMode === 'read'
            ? retryableCodes.has(err.code)
            : err.code === 'rate_limited';
        if (!retryable || neverRetryStatuses.has(err.status) || attempt >= retries) throw err;
        const wait = err.retryAfterMs ?? backoff;
        attempt += 1;
        backoff *= 2;
        await sleep(wait);
      }
    }
  }

  async function listJobs(params: ListJobsParams = {}): Promise<ListJobsResult> {
    const query = new URLSearchParams();
    if (params.track !== undefined) query.set('track', String(params.track));
    if (params.limit !== undefined) {
      const limit = Number(params.limit);
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        throw new LaxJobsError('limit must be an integer between 1 and 100', 0, 'invalid_input');
      }
      query.set('limit', String(limit));
    }
    if (params.offset !== undefined) {
      const offset = Number(params.offset);
      if (!Number.isInteger(offset) || offset < 0) {
        throw new LaxJobsError('offset must be a non negative integer', 0, 'invalid_input');
      }
      query.set('offset', String(offset));
    }
    const suffix = query.toString();
    const body = (await call(`/jobs${suffix ? `?${suffix}` : ''}`, { method: 'GET', headers: { accept: 'application/json' } }, 'read')) as Record<string, unknown> | null;
    if (!body || !Array.isArray((body as Record<string, unknown>).jobs)) {
      throw new LaxJobsError('registry answer has no jobs array', 200, 'invalid_response');
    }
    const jobs = (body as Record<string, unknown>).jobs as Job[];
    const count = typeof (body as Record<string, unknown>).count === 'number' ? ((body as Record<string, unknown>).count as number) : jobs.length;
    return { jobs, count };
  }

  async function getJob(id: string): Promise<Job> {
    if (typeof id !== 'string' || !id.trim()) throw new LaxJobsError('id is required', 0, 'invalid_input');
    const body = (await call(`/jobs/${encodeURIComponent(id)}`, { method: 'GET', headers: { accept: 'application/json' } }, 'read')) as Record<string, unknown> | null;
    const job = body && (body.job as Job | undefined);
    if (!job) throw new LaxJobsError('registry answer has no job', 200, 'invalid_response');
    return job;
  }

  async function submit(jobId: string, input: SubmitInput): Promise<SubmissionResult> {
    if (typeof jobId !== 'string' || !jobId.trim()) throw new LaxJobsError('jobId is required', 0, 'invalid_input');
    assertSubmitInput(input);
    const body = (await call(
      `/jobs/${encodeURIComponent(jobId)}/submissions`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(input),
      },
      'submit',
    )) as Record<string, unknown> | null;
    const submission = body && (body.submission as SubmissionResult | undefined);
    if (!submission) throw new LaxJobsError('registry answer has no submission', 200, 'invalid_response');
    return submission;
  }

  return { listJobs, getJob, submit };
}
