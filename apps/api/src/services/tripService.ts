import { z } from 'zod';
import { randomInt } from 'node:crypto';

export const tripCreateSchema = z.object({
  name: z.string().trim().min(2, 'Trip name must contain at least 2 characters.'),
  description: z.string().trim().max(500).optional(),
  baseCurrency: z
    .string()
    .trim()
    .min(3)
    .max(3)
    .transform((value) => value.toUpperCase()),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid start date.').optional(),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid end date.').optional(),
  settings: z.object({
    allowMemberExpenseEdit: z.boolean().default(true),
    requireLocationConfirmation: z.boolean().default(true),
    allowPublicJoin: z.boolean().default(false),
  }).default({}),
}).refine((trip) => {
  if (!trip.startDate && !trip.endDate) return true;
  if (!trip.startDate || !trip.endDate) return false;
  const start = new Date(`${trip.startDate}T00:00:00.000Z`);
  const end = new Date(`${trip.endDate}T00:00:00.000Z`);
  return !Number.isNaN(start.valueOf()) && !Number.isNaN(end.valueOf()) && start <= end &&
    start.toISOString().slice(0, 10) === trip.startDate && end.toISOString().slice(0, 10) === trip.endDate;
}, { message: 'Provide valid start and end dates, with the end date on or after the start date.', path: ['endDate'] });

export const tripSettingsSchema = z.object({
  allowMemberExpenseEdit: z.boolean().optional(),
  requireLocationConfirmation: z.boolean().optional(),
  allowPublicJoin: z.boolean().optional(),
});

export const tripInvitationSchema = z.object({
  email: z.string().trim().email('Use a valid email address.').transform((value) => value.toLowerCase()),
});

/**
 * Codes are short enough to read aloud but long enough (40 bits over a
 * 32-character alphabet) to resist guessing when combined with rate limiting.
 * Ambiguous characters (I, O, 0, 1) are excluded on purpose.
 */
const JOIN_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const JOIN_CODE_LENGTH = 8;

export function generateJoinCode(length = JOIN_CODE_LENGTH) {
  let code = '';
  for (let index = 0; index < length; index += 1) {
    code += JOIN_CODE_ALPHABET[randomInt(JOIN_CODE_ALPHABET.length)];
  }
  return code;
}

export const joinTripSchema = z.object({
  code: z
    .string()
    .trim()
    .min(1, 'Enter a trip code.')
    .max(20)
    .transform((value) => value.replace(/[\s-]/g, '').toUpperCase())
    .refine((value) => /^[A-Z0-9]{6,12}$/.test(value), 'Enter a valid trip code.'),
});

export const tripMemberSchema = z
  .object({
    userId: z.string().uuid().optional(),
    email: z.string().trim().email().optional(),
    role: z.enum(['OWNER', 'ADMIN', 'MEMBER', 'VIEWER']).default('MEMBER'),
    budgetLimit: z.number().positive('Budget limit must be greater than zero.').optional(),
  })
  .refine((value) => Boolean(value.userId || value.email), {
    message: 'Provide either a userId or an email address for the trip member.',
    path: ['userId'],
  });

export const memberRoleSchema = z.object({
  role: z.enum(['OWNER', 'ADMIN', 'MEMBER', 'VIEWER']),
  isActive: z.boolean().optional(),
  budgetLimit: z.number().positive().optional(),
});

export const memberBudgetSchema = z.object({
  userId: z.string().uuid(),
  plannedBudget: z.union([
    z.string()
      .trim()
      .regex(/^\d+(?:\.\d+)?$/, 'Planned budget must be a positive decimal amount.')
      .refine((value) => /[1-9]/.test(value), 'Planned budget must be greater than zero.'),
    z.number().finite().positive('Planned budget must be greater than zero.').transform(String),
  ]),
});

export function normalizeCurrencyCode(currency: string) {
  return currency.trim().toUpperCase();
}

export function canManageTrip(role: string) {
  return ['OWNER', 'ADMIN'].includes(role);
}

export function isTripOwnerOrAdmin(role: string) {
  return ['OWNER', 'ADMIN'].includes(role);
}

export function createTripInput(input: z.infer<typeof tripCreateSchema>) {
  return {
    ...input,
    baseCurrency: normalizeCurrencyCode(input.baseCurrency),
  };
}

export function resolveTripMemberRole(input: z.infer<typeof tripMemberSchema> | undefined) {
  const role = input?.role ?? 'MEMBER';
  return role;
}

export function buildBudgetSnapshot(plannedBudget: number, utilizationPct: number, overspending: number) {
  return {
    plannedBudget,
    remainingBudget: Math.max(plannedBudget - utilizationPct, 0),
    utilizationPct,
    overspending: Math.max(overspending, 0),
  };
}
