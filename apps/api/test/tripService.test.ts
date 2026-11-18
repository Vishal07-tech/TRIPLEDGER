import { describe, expect, it } from 'vitest';

import {
  buildBudgetSnapshot,
  canManageTrip,
  createTripInput,
  normalizeCurrencyCode,
  resolveTripMemberRole,
  tripCreateSchema,
  tripSettingsSchema,
} from '../src/services/tripService.js';

describe('trip service', () => {
  it('normalizes and validates trip creation input', () => {
    const result = tripCreateSchema.safeParse({
      name: 'Bengaluru Weekend Escape',
      description: 'Shared itinerary and budget tracking',
      baseCurrency: 'inr',
      startDate: '2026-12-01',
      endDate: '2026-12-05',
      settings: { allowMemberExpenseEdit: false, allowPublicJoin: false },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(createTripInput(result.data).baseCurrency).toBe('INR');
      expect(result.data.startDate).toBe('2026-12-01');
      expect(result.data.settings.allowMemberExpenseEdit).toBe(false);
    }
  });

  it('rejects incomplete or reversed trip dates while preserving legacy date-less callers', () => {
    const base = { name: 'Trip dates', baseCurrency: 'INR' };
    expect(tripCreateSchema.safeParse(base).success).toBe(true);
    expect(tripCreateSchema.safeParse({ ...base, startDate: '2026-12-02' }).success).toBe(false);
    expect(tripCreateSchema.safeParse({ ...base, startDate: '2026-12-05', endDate: '2026-12-01' }).success).toBe(false);
    expect(tripCreateSchema.safeParse({ ...base, startDate: '2026-02-30', endDate: '2026-03-01' }).success).toBe(false);
  });

  it('normalizes currencies consistently for trip invariants', () => {
    expect(normalizeCurrencyCode(' usd ')).toBe('USD');
    expect(normalizeCurrencyCode('eur')).toBe('EUR');
  });

  it('controls trip authorization rules by role', () => {
    expect(canManageTrip('OWNER')).toBe(true);
    expect(canManageTrip('ADMIN')).toBe(true);
    expect(canManageTrip('MEMBER')).toBe(false);
    expect(canManageTrip('VIEWER')).toBe(false);
  });

  it('resolves trip member roles and budget snapshots', () => {
    expect(resolveTripMemberRole({ role: 'ADMIN' })).toBe('ADMIN');
    expect(resolveTripMemberRole(undefined)).toBe('MEMBER');

    const budget = buildBudgetSnapshot(2000, 1600, 0);
    expect(budget.remainingBudget).toBe(400);
    expect(budget.utilizationPct).toBe(1600);
    expect(budget.overspending).toBe(0);
  });

  it('accepts trip settings updates with booleans', () => {
    const result = tripSettingsSchema.safeParse({
      allowMemberExpenseEdit: false,
      requireLocationConfirmation: true,
      allowPublicJoin: false,
    });

    expect(result.success).toBe(true);
  });
});
