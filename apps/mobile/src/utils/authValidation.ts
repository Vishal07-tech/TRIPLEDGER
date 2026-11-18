import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().trim().email('Enter a valid email address.'),
  password: z.string().min(8, 'Password must be at least 8 characters.'),
});

export const registerSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter your full name.'),
  email: z.string().trim().email('Enter a valid email address.'),
  password: z.string().min(8, 'Password must be at least 8 characters.'),
});

export type FieldErrors = Record<string, string>;

export function validateLogin(email: string, password: string) {
  const result = loginSchema.safeParse({ email, password });
  if (result.success) return { input: { email: result.data.email.toLowerCase(), password: result.data.password }, errors: {} as FieldErrors };
  return { input: null, errors: Object.fromEntries(Object.entries(result.error.flatten().fieldErrors).map(([key, values]) => [key, values?.[0] ?? ''])) };
}

export function validateRegistration(fullName: string, email: string, password: string) {
  const result = registerSchema.safeParse({ fullName, email, password });
  if (result.success) return { input: { fullName: result.data.fullName, email: result.data.email.toLowerCase(), password: result.data.password }, errors: {} as FieldErrors };
  return { input: null, errors: Object.fromEntries(Object.entries(result.error.flatten().fieldErrors).map(([key, values]) => [key, values?.[0] ?? ''])) };
}
