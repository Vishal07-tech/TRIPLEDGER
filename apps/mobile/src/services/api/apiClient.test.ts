import { ApiClient, ApiError } from './apiClient';
import type { SecureTokenStorage } from '../storage/secureStorage';

function mockResponse(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => JSON.stringify(body),
  } as Response;
}

function createStorage(): SecureTokenStorage {
  return {
    getToken: jest.fn().mockResolvedValue(null),
    setToken: jest.fn().mockResolvedValue(undefined),
    deleteToken: jest.fn().mockResolvedValue(undefined),
  };
}

describe('mobile API client', () => {
  it('uses the configured base URL and parses successful JSON', async () => {
    const storage = createStorage();
    const fetcher = jest.fn().mockResolvedValue(mockResponse(200, { ok: true }));
    const client = new ApiClient({ baseUrl: () => 'https://api.tripledger.test/', storage, fetcher });

    await expect(client.request('/api/auth/me', { auth: 'none' })).resolves.toEqual({ ok: true });
    expect(fetcher).toHaveBeenCalledWith('https://api.tripledger.test/api/auth/me', expect.objectContaining({ headers: expect.any(Headers) }));
  });

  it('injects the bearer token and clears it on unauthorized response', async () => {
    const storage = createStorage();
    jest.mocked(storage.getToken).mockResolvedValue('private-token');
    const fetcher = jest.fn().mockResolvedValue(mockResponse(401, { message: 'Your session is invalid or expired.' }));
    const onUnauthorized = jest.fn();
    const client = new ApiClient({ baseUrl: () => 'http://10.0.2.2:4000', storage, fetcher });
    client.setUnauthorizedHandler(onUnauthorized);

    await expect(client.request('/api/auth/me', { auth: 'required' })).rejects.toMatchObject({ status: 401 });
    const requestHeaders = fetcher.mock.calls[0]?.[1]?.headers as Headers;
    expect(requestHeaders.get('Authorization')).toBe('Bearer private-token');
    expect(storage.deleteToken).toHaveBeenCalledTimes(1);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('returns a safe server message without exposing the response body', async () => {
    const client = new ApiClient({
      baseUrl: () => 'https://api.tripledger.test',
      storage: createStorage(),
      fetcher: jest.fn().mockResolvedValue(mockResponse(500, { message: 'The server could not complete the request. Try again shortly.', stack: 'secret stack' })),
    });
    await expect(client.request('/api/auth/login', { method: 'POST', auth: 'none' })).rejects.toMatchObject({
      message: 'The server could not complete the request. Try again shortly.',
      status: 500,
      kind: 'http',
    });
  });

  it('normalizes network errors and timeouts', async () => {
    const networkClient = new ApiClient({ baseUrl: () => 'https://api.tripledger.test', storage: createStorage(), fetcher: jest.fn().mockRejectedValue(new Error('socket detail')) });
    await expect(networkClient.request('/api/auth/login', { auth: 'none' })).rejects.toMatchObject({ kind: 'network', message: 'Could not reach Sutrula Payanam. Check your connection and try again.' });

    const hangingFetcher: typeof fetch = (_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    });
    const timeoutClient = new ApiClient({ baseUrl: () => 'https://api.tripledger.test', storage: createStorage(), fetcher: hangingFetcher, timeoutMs: 5 });
    await expect(timeoutClient.request('/api/auth/login', { auth: 'none' })).rejects.toMatchObject({ kind: 'timeout' });
  });

  it('rejects a missing API base URL without making a request', async () => {
    const fetcher = jest.fn();
    const client = new ApiClient({ baseUrl: () => '', storage: createStorage(), fetcher });
    await expect(client.request('/api/auth/me')).rejects.toBeInstanceOf(ApiError);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
