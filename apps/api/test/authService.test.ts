import { describe, expect, it } from 'vitest';

import { comparePasswords, createAuthToken, hashPassword, loginSchema, registerSchema, verifyAuthToken } from '../src/services/authService.js';

describe('auth service', () => {
  it('validates registration input', () => {
    const result = registerSchema.safeParse({
      fullName: 'Alex Morgan',
      email: 'alex@example.com',
      password: 'securePass123',
    });

    expect(result.success).toBe(true);
  });

  it('validates login input', () => {
    const result = loginSchema.safeParse({
      email: 'alex@example.com',
      password: 'securePass123',
    });

    expect(result.success).toBe(true);
  });

  it('hashes and verifies password', async () => {
    const password = 'veryStrongPass123';
    const hash = await hashPassword(password);

    expect(hash).not.toBe(password);
    await expect(comparePasswords(password, hash)).resolves.toBe(true);
  });

  it('issues and verifies JWT tokens', () => {
    const token = createAuthToken({ id: 'u_123', email: 'alex@example.com', role: 'MEMBER' });
    const payload = verifyAuthToken(token);

    expect(payload.sub).toBe('u_123');
    expect(payload.email).toBe('alex@example.com');
    expect(payload.role).toBe('MEMBER');
  });
});
