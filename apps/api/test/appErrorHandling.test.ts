import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { apiErrorHandler } from '../src/app.js';
import { config } from '../src/config/env.js';
import { asyncHandler } from '../src/middleware/asyncHandler.js';

describe('global API error handling', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns a generic response and logs a detailed error with configured secrets redacted', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const secretMarker = config.jwtSecret;
    const serverApp = express();
    serverApp.get('/failure', asyncHandler(async () => {
      throw new Error(`database failure involving ${secretMarker}`);
    }));
    serverApp.use(apiErrorHandler);
    const server = serverApp.listen(0);

    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Test server did not bind.');
      const response = await fetch(`http://127.0.0.1:${address.port}/failure`);
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ message: 'Unexpected server error.' });
      expect(log).toHaveBeenCalledWith('[api] Unhandled request error', expect.objectContaining({
        name: 'Error',
        message: 'database failure involving [REDACTED]',
        stack: expect.stringContaining('[REDACTED]'),
      }));
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
