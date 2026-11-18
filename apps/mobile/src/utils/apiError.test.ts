import { ApiError } from '../services/api/apiClient';
import { describeApiError } from './apiError';

const FALLBACK = 'Something went wrong. Try again.';

describe('describeApiError', () => {
  it('keeps messages the person can act on', () => {
    for (const status of [400, 403, 404, 409, 429]) {
      expect(describeApiError(new ApiError(`status ${status}`, status, 'http'), FALLBACK)).toBe(`status ${status}`);
    }
  });

  it('hides server-side failures behind the fallback', () => {
    expect(describeApiError(new ApiError('prisma: P2002 unique constraint', 500, 'http'), FALLBACK)).toBe(FALLBACK);
    expect(describeApiError(new ApiError('bad gateway', 502, 'http'), FALLBACK)).toBe(FALLBACK);
    expect(describeApiError(new ApiError('unexpected 401', 401, 'http'), FALLBACK)).toBe(FALLBACK);
  });

  it('shows client-authored network, timeout and config copy', () => {
    expect(describeApiError(new ApiError('Could not reach Sutrula Payanam.', 0, 'network'), FALLBACK)).toBe(
      'Could not reach Sutrula Payanam.',
    );
    expect(describeApiError(new ApiError('The request timed out.', 0, 'timeout'), FALLBACK)).toBe(
      'The request timed out.',
    );
    expect(describeApiError(new ApiError('API address is not configured.', 0, 'config'), FALLBACK)).toBe(
      'API address is not configured.',
    );
  });

  it('falls back for non-ApiError values', () => {
    expect(describeApiError(new Error('boom'), FALLBACK)).toBe(FALLBACK);
    expect(describeApiError('boom', FALLBACK)).toBe(FALLBACK);
    expect(describeApiError(undefined, FALLBACK)).toBe(FALLBACK);
  });
});
