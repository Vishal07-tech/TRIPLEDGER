import { secureStorage, type SecureTokenStorage } from '../storage/secureStorage';

export type AuthMode = 'none' | 'optional' | 'required';

export type ApiRequestOptions = Omit<RequestInit, 'headers'> & {
  headers?: HeadersInit;
  auth?: AuthMode;
};

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly kind: 'http' | 'network' | 'timeout' | 'config') {
    super(message);
    this.name = 'ApiError';
  }
}

type ApiClientOptions = {
  baseUrl: () => string;
  storage: SecureTokenStorage;
  fetcher?: typeof fetch;
  timeoutMs?: number;
};

function safeMessage(value: unknown, fallback: string) {
  if (typeof value !== 'object' || value === null || !('message' in value)) return fallback;
  const message = (value as { message?: unknown }).message;
  return typeof message === 'string' && message.trim() ? message : fallback;
}

export class ApiClient {
  private unauthorizedHandler?: () => void;
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: ApiClientOptions) {
    this.fetcher = options.fetcher ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  setUnauthorizedHandler(handler: (() => void) | undefined) {
    this.unauthorizedHandler = handler;
  }

  async request<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
    let baseUrl: string;
    try {
      baseUrl = this.options.baseUrl().trim().replace(/\/+$/, '');
      const parsed = new URL(baseUrl);
      if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.host) throw new Error('Invalid URL.');
    } catch {
      throw new ApiError('API address is not configured. Set EXPO_PUBLIC_API_BASE_URL in apps/mobile/.env.', 0, 'config');
    }

    const { auth = 'optional', headers: suppliedHeaders, ...requestOptions } = options;
    const headers = new Headers(suppliedHeaders);
    headers.set('Accept', 'application/json');
    if (requestOptions.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

    let token: string | null = null;
    if (auth !== 'none') {
      try {
        token = await this.options.storage.getToken();
      } catch {
        throw new ApiError('Secure session storage is unavailable. Please try again.', 0, 'config');
      }
      if (token) headers.set('Authorization', `Bearer ${token}`);
      if (auth === 'required' && !token) throw new ApiError('Sign in to continue.', 401, 'http');
    }

    const controller = new AbortController();
    const externalSignal = requestOptions.signal;
    const abortFromCaller = () => controller.abort();
    externalSignal?.addEventListener('abort', abortFromCaller, { once: true });
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);

    try {
      const response = await this.fetcher(`${baseUrl}${path}`, {
        ...requestOptions,
        headers,
        signal: controller.signal,
      });
      const raw = await response.text();
      let payload: unknown = {};
      if (raw) {
        try { payload = JSON.parse(raw); } catch { payload = {}; }
      }

      if (response.status === 401 && token && auth !== 'none') {
        await this.options.storage.deleteToken().catch(() => undefined);
        this.unauthorizedHandler?.();
      }
      if (!response.ok) {
        const fallback = response.status >= 500
          ? 'The server could not complete the request. Try again shortly.'
          : 'The request could not be completed.';
        throw new ApiError(safeMessage(payload, fallback), response.status, 'http');
      }
      return payload as T;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (timedOut) throw new ApiError('The request timed out. Check your connection and try again.', 0, 'timeout');
      if (externalSignal?.aborted) throw error;
      throw new ApiError('Could not reach Sutrula Payanam. Check your connection and try again.', 0, 'network');
    } finally {
      clearTimeout(timeout);
      externalSignal?.removeEventListener('abort', abortFromCaller);
    }
  }
}

export function getConfiguredApiBaseUrl() {
  return process.env.EXPO_PUBLIC_API_BASE_URL ?? '';
}

export const apiClient = new ApiClient({
  baseUrl: getConfiguredApiBaseUrl,
  storage: secureStorage,
});
