import { describe, expect, it } from 'vitest';

import { validateJwtSecret } from '../src/config/env.js';

describe('JWT startup configuration', () => {
  it('requires an explicitly configured secret in every environment', () => {
    expect(() => validateJwtSecret(undefined, 'development')).toThrow(/JWT_SECRET must be configured/);
    expect(() => validateJwtSecret('   ', 'test')).toThrow(/JWT_SECRET must be configured/);
  });

  it('requires at least 32 bytes in production without exposing the value', () => {
    expect(() => validateJwtSecret('short-local-secret', 'production')).toThrow(/at least 32 bytes/);
    const secret = 'a'.repeat(32);
    expect(validateJwtSecret(secret, 'production')).toBe(secret);
  });

  it('accepts a configured local secret without imposing production length requirements', () => {
    expect(validateJwtSecret('local-test-secret', 'development')).toBe('local-test-secret');
  });
});
