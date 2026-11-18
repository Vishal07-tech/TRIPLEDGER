import { afterEach, describe, expect, it, vi } from 'vitest';

import { apiRequest } from './apiClient';
import { SESSION_EXPIRED_EVENT } from './session';

function jsonResponse(status: number, payload: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  } as Response;
}

describe('shared API client', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('uses the supplied session and returns parsed API data', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse(200, { value: 'ok' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiRequest('/api/test', { method: 'GET' }, 'session-token'))
      .resolves.toEqual({ value: 'ok' });

    const [, init] = fetchMock.mock.calls[0];
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer session-token');
  });

  it('clears and announces an expired authenticated session', async () => {
    localStorage.setItem('tripledger_token', 'expired-token');
    const expired = vi.fn();
    window.addEventListener(SESSION_EXPIRED_EVENT, expired);
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(401, { message: 'Session expired.' })));

    await expect(apiRequest('/api/trips')).rejects.toMatchObject({
      status: 401,
      message: 'Session expired.',
    });

    expect(localStorage.getItem('tripledger_token')).toBeNull();
    expect(expired).toHaveBeenCalledOnce();
    window.removeEventListener(SESSION_EXPIRED_EVENT, expired);
  });

  it('does not attach a session to explicitly anonymous requests', async () => {
    localStorage.setItem('tripledger_token', 'existing-token');
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse(200, { token: 'new-token' }));
    vi.stubGlobal('fetch', fetchMock);

    await apiRequest('/api/auth/login', { method: 'POST', body: '{}' }, null);

    const [, init] = fetchMock.mock.calls[0];
    expect(new Headers(init?.headers).has('Authorization')).toBe(false);
  });
});
