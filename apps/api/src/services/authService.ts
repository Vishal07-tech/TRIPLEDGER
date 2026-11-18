import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';

import { config } from '../config/env.js';

export const registerSchema = z.object({
  fullName: z.string().min(2, 'Full name is required.'),
  email: z.string().trim().email('Use a valid email address.').transform((value) => value.toLowerCase()),
  password: z.string().min(8, 'Password should be at least 8 characters long.'),
});

export const loginSchema = z.object({
  email: z.string().trim().email('Use a valid email address.').transform((value) => value.toLowerCase()),
  password: z.string().min(8, 'Password should be at least 8 characters long.'),
});

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}

export async function comparePasswords(password: string, passwordHash: string) {
  return bcrypt.compare(password, passwordHash);
}

export function createAuthToken(user: { id: string; email: string; role: string }) {
  return jwt.sign({ sub: user.id, email: user.email, role: user.role }, config.jwtSecret, {
    expiresIn: '7d',
  });
}

export function verifyAuthToken(token: string) {
  return jwt.verify(token, config.jwtSecret) as { sub: string; email: string; role: string };
}
