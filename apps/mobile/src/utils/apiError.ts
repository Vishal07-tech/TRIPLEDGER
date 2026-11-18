import { ApiError } from '../services/api/apiClient';

/**
 * Statuses whose messages are authored for the person using the app (validation,
 * permissions, missing records, conflicts, throttling). Anything else — a 500,
 * a gateway error, an unexpected exception — falls back to caller-supplied copy
 * so server internals never reach the screen.
 */
const CLIENT_ACTIONABLE_STATUSES = new Set([400, 403, 404, 409, 429]);

/**
 * Returns the message to show for a failed request.
 *
 * `ApiError`s raised before a response arrived (network, timeout, config) carry
 * copy written by the API client itself, so those are always safe to show.
 */
export function describeApiError(error: unknown, fallback: string): string {
  if (!(error instanceof ApiError)) return fallback;
  if (error.kind !== 'http') return error.message;
  return CLIENT_ACTIONABLE_STATUSES.has(error.status) ? error.message : fallback;
}
