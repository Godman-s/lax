/**
 * Acceptance tests for the jobs client. Each test is named after the acceptance item it
 * proves. Nothing here touches the network: every test passes its own fetch and sleep.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createJobsClient, LaxJobsError } from './src/jobs.ts';
import type { Job, SubmissionResult } from './src/jobs.ts';

const BASE = 'https://registry.test/registry';

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function recorder(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : String(input);
    const requestInit = init ?? {};
    calls.push({ url, init: requestInit });
    return handler(url, requestInit);
  }) as unknown as typeof globalThis.fetch;
  return { calls, fetchImpl };
}

const noSleep = async () => {};

const sampleJob: Job = { id: 'job-1', title: 'Charter verifier', bounty_usdc: 100 };

test('A1 sends the documented requests and returns the parsed answers', async () => {
  const { calls, fetchImpl } = recorder((url) => {
    if (url.includes('/jobs?')) return jsonResponse(200, { jobs: [sampleJob], count: 1 });
    if (url.endsWith('/jobs/job-1')) return jsonResponse(200, { job: sampleJob });
    if (url.includes('/jobs/job%2F2/submissions') || url.includes('/jobs/job%2F2/submissions')) {
      const submission: SubmissionResult = { id: 'sub-1', job_id: 'job/2', status: 'submitted', created_at: '2026-10-26T00:00:00Z' };
      return jsonResponse(201, { submission });
    }
    if (url.includes('/submissions')) {
      const submission: SubmissionResult = { id: 'sub-1', job_id: 'job-1', status: 'submitted', created_at: '2026-10-26T00:00:00Z' };
      return jsonResponse(201, { submission });
    }
    return jsonResponse(404, { error: 'unexpected' });
  });
  const client = createJobsClient({ baseUrl: BASE, fetch: fetchImpl, sleep: noSleep });

  const listed = await client.listJobs({ track: 'seat', limit: 5, offset: 10 });
  assert.deepEqual(listed, { jobs: [sampleJob], count: 1 });
  assert.equal(calls[0].url, `${BASE}/jobs?track=seat&limit=5&offset=10`);

  const job = await client.getJob('job-1');
  assert.deepEqual(job, sampleJob);
  assert.equal(calls[1].url, `${BASE}/jobs/job-1`);

  const submitted = await client.submit('job-1', {
    builder: 'agent',
    contact: 'agent@example.com',
    repo_or_patch_url: 'https://github.com/example/repo',
    payout_address: '0x' + '11'.repeat(20),
    agent_did: 'did:pkh:eip155:8453:0x' + '11'.repeat(20),
    notes: 'done',
  });
  assert.equal(submitted.id, 'sub-1');
  assert.equal(calls[2].url, `${BASE}/jobs/job-1/submissions`);
  assert.equal(calls[2].init.method, 'POST');
  assert.match(String((calls[2].init.headers as Record<string, string>)['content-type']), /application\/json/);
  assert.deepEqual(JSON.parse(String(calls[2].init.body)).notes, 'done');
});

test('A2 a 400, 404 or 409 throws after exactly one request', async () => {
  for (const [status, code] of [[400, 'bad_request'], [404, 'not_found'], [409, 'conflict']] as const) {
    const { calls, fetchImpl } = recorder(() => jsonResponse(status, { error: `registry said ${status}` }));
    const client = createJobsClient({ baseUrl: BASE, fetch: fetchImpl, sleep: noSleep });
    await assert.rejects(
      () => client.getJob('missing'),
      (error: unknown) => {
        assert.ok(error instanceof LaxJobsError);
        assert.equal(error.status, status);
        assert.equal(error.code, code);
        assert.equal(error.message, `registry said ${status}`);
        return true;
      },
    );
    assert.equal(calls.length, 1);
  }
});

test('A3 a 429 waits for Retry-After then succeeds, and a permanent 429 throws rate_limited', async () => {
  const sleeps: number[] = [];
  let attempt = 0;
  const { fetchImpl } = recorder(() => {
    attempt += 1;
    if (attempt === 1) return jsonResponse(429, { error: 'slow down' }, { 'retry-after': '2' });
    return jsonResponse(200, { job: sampleJob });
  });
  const client = createJobsClient({ baseUrl: BASE, fetch: fetchImpl, sleep: async (ms) => { sleeps.push(ms); } });
  assert.deepEqual(await client.getJob('job-1'), sampleJob);
  assert.deepEqual(sleeps, [2000]);

  const always = recorder(() => jsonResponse(429, { error: 'still' }));
  const never = createJobsClient({ baseUrl: BASE, fetch: always.fetchImpl, sleep: noSleep, retries: 2 });
  await assert.rejects(() => never.getJob('job-1'), (error: unknown) => {
    assert.ok(error instanceof LaxJobsError);
    assert.equal(error.code, 'rate_limited');
    return true;
  });
  assert.equal(always.calls.length, 3);
});

test('A4 reads retry 5xx and network, submit retries neither', async () => {
  const server = recorder(() => jsonResponse(503, { error: 'unavailable' }));
  const readClient = createJobsClient({ baseUrl: BASE, fetch: server.fetchImpl, sleep: noSleep, retries: 1 });
  await assert.rejects(() => readClient.listJobs(), (error: unknown) => {
    assert.ok(error instanceof LaxJobsError);
    assert.equal(error.code, 'server');
    return true;
  });
  assert.equal(server.calls.length, 2);

  const broken = recorder(() => { throw new Error('socket hang up'); });
  const networkClient = createJobsClient({ baseUrl: BASE, fetch: broken.fetchImpl, sleep: noSleep, retries: 1 });
  await assert.rejects(() => networkClient.getJob('job-1'), (error: unknown) => {
    assert.ok(error instanceof LaxJobsError);
    assert.equal(error.code, 'network');
    assert.equal(error.status, 0);
    return true;
  });
  assert.equal(broken.calls.length, 2);

  const submitServer = recorder(() => jsonResponse(500, { error: 'boom' }));
  const submitClient = createJobsClient({ baseUrl: BASE, fetch: submitServer.fetchImpl, sleep: noSleep, retries: 5 });
  await assert.rejects(() => submitClient.submit('job-1', {
    builder: 'agent', contact: 'a@b.c', repo_or_patch_url: 'https://example.com/r',
    payout_address: '0x' + '22'.repeat(20), agent_did: 'did:pkh:eip155:8453:0x' + '22'.repeat(20),
  }), (error: unknown) => {
    assert.ok(error instanceof LaxJobsError);
    assert.equal(error.code, 'server');
    return true;
  });
  assert.equal(submitServer.calls.length, 1);
});

test('A5 submit refuses bad input before any request', async () => {
  const { calls, fetchImpl } = recorder(() => jsonResponse(201, { submission: {} }));
  const client = createJobsClient({ baseUrl: BASE, fetch: fetchImpl, sleep: noSleep });
  const good = {
    builder: 'agent', contact: 'a@b.c', repo_or_patch_url: 'https://example.com/r',
    payout_address: '0x' + '33'.repeat(20), agent_did: 'did:pkh:eip155:8453:0x' + '33'.repeat(20),
  };
  const cases = [
    { ...good, agent_did: '' },
    { ...good, payout_address: '0x123' },
    { ...good, repo_or_patch_url: 'http://example.com/r' },
  ];
  for (const bad of cases) {
    await assert.rejects(() => client.submit('job-1', bad as never), (error: unknown) => {
      assert.ok(error instanceof LaxJobsError);
      assert.equal(error.code, 'invalid_input');
      assert.equal(error.status, 0);
      return true;
    });
  }
  assert.equal(calls.length, 0);
});

test('A6 no console output and no runtime dependency', async () => {
  const { fetchImpl } = recorder(() => jsonResponse(200, { jobs: [], count: 0 }));
  const client = createJobsClient({ baseUrl: BASE, fetch: fetchImpl, sleep: noSleep });
  const spy = { log: console.log, warn: console.warn, error: console.error };
  const seen: unknown[] = [];
  console.log = (...args: unknown[]) => { seen.push(args); };
  console.warn = (...args: unknown[]) => { seen.push(args); };
  console.error = (...args: unknown[]) => { seen.push(args); };
  try {
    await client.listJobs();
  } finally {
    console.log = spy.log;
    console.warn = spy.warn;
    console.error = spy.error;
  }
  assert.deepEqual(seen, []);

  const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { dependencies?: Record<string, string> };
  assert.deepEqual(Object.keys(pkg.dependencies ?? {}), []);
});

test('A7 live integration runs only with LAX_LIVE=1', { skip: process.env.LAX_LIVE !== '1' }, async () => {
  const client = createJobsClient();
  const { jobs, count } = await client.listJobs({ limit: 3 });
  assert.ok(Array.isArray(jobs));
  assert.equal(typeof count, 'number');
});
