import { describe, expect, it } from 'vitest';

import { createRateLimiter } from '../src/middleware/rateLimit.js';

function makeRequest(ip: string) {
  return { ip } as unknown as Parameters<ReturnType<typeof createRateLimiter>>[0];
}

function makeResponse() {
  const state = { statusCode: 200, headers: {} as Record<string, string>, body: undefined as unknown };
  const response = {
    setHeader(name: string, value: string) {
      state.headers[name] = value;
      return response;
    },
    status(code: number) {
      state.statusCode = code;
      return response;
    },
    json(body: unknown) {
      state.body = body;
      return response;
    },
  };
  return { response: response as unknown as Parameters<ReturnType<typeof createRateLimiter>>[1], state };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('rate limiter', () => {
  it('allows requests up to the limit, then returns 429 with Retry-After', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 2, keyPrefix: 'test' });

    const first = makeResponse();
    limiter(makeRequest('10.0.0.1'), first.response, () => undefined);
    expect(first.state.statusCode).toBe(200);

    const second = makeResponse();
    limiter(makeRequest('10.0.0.1'), second.response, () => undefined);
    expect(second.state.statusCode).toBe(200);

    const third = makeResponse();
    let passedThrough = false;
    limiter(makeRequest('10.0.0.1'), third.response, () => {
      passedThrough = true;
    });

    expect(passedThrough).toBe(false);
    expect(third.state.statusCode).toBe(429);
    expect(third.state.headers['Retry-After']).toMatch(/^\d+$/);
    expect(third.state.body).toMatchObject({ message: expect.stringContaining('Too many requests') });
  });

  it('keeps buckets separate per client address', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 1, keyPrefix: 'test' });

    limiter(makeRequest('10.0.0.1'), makeResponse().response, () => undefined);

    let otherClientAllowed = false;
    limiter(makeRequest('10.0.0.2'), makeResponse().response, () => {
      otherClientAllowed = true;
    });

    expect(otherClientAllowed).toBe(true);
  });

  it('resets once the window elapses', async () => {
    const limiter = createRateLimiter({ windowMs: 25, max: 1, keyPrefix: 'test' });

    limiter(makeRequest('10.0.0.1'), makeResponse().response, () => undefined);

    const blocked = makeResponse();
    limiter(makeRequest('10.0.0.1'), blocked.response, () => undefined);
    expect(blocked.state.statusCode).toBe(429);

    await sleep(40);

    const afterWindow = makeResponse();
    let allowed = false;
    limiter(makeRequest('10.0.0.1'), afterWindow.response, () => {
      allowed = true;
    });

    expect(allowed).toBe(true);
    expect(afterWindow.state.statusCode).toBe(200);
  });
});
