import { getSessionToken, notifySessionExpired } from './session';

type ApiPayload = { message?: string };

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

export function getApiBaseUrl() {
  return import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000';
}

export async function apiFetch(
  path: string,
  init: RequestInit = {},
  suppliedToken?: string | null,
): Promise<Response> {
  const token = suppliedToken === undefined ? getSessionToken() : suppliedToken;
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    ...init,
    headers,
  });
  if (response.status === 401 && token) notifySessionExpired();
  return response;
}

export async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
  suppliedToken?: string | null,
): Promise<T> {
  const response = await apiFetch(path, init, suppliedToken);
  const payload = (await response.json()) as ApiPayload & T;
  if (!response.ok) {
    throw new ApiError(payload.message ?? 'The request could not be completed.', response.status);
  }
  return payload;
}
