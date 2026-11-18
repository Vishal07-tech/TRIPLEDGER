import { describe, expect, it } from 'vitest';

import { paymentAttemptSchema } from '../src/services/settlementService.js';

describe('manual settlement payment input', () => {
  const baseInput = {
    amount: '25.50',
    paymentDateTime: '2026-11-09T12:00:00.000Z',
    idempotencyKey: 'manual-payment-key-1',
  };

  it.each(['UPI', 'CASH', 'BANK_TRANSFER', 'OTHER'] as const)(
    'accepts %s with an optional transaction reference',
    (paymentMethod) => {
      const result = paymentAttemptSchema.safeParse({ ...baseInput, paymentMethod });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.transactionReference).toBeNull();
        expect(result.data.paymentNotes).toBeNull();
      }
    },
  );

  it('normalizes blank optional references and notes', () => {
    const result = paymentAttemptSchema.safeParse({
      ...baseInput,
      paymentMethod: 'BANK_TRANSFER',
      transactionReference: '   ',
      paymentNotes: '   ',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.transactionReference).toBeNull();
      expect(result.data.paymentNotes).toBeNull();
    }
  });

  it('rejects unsupported methods, invalid payment dates, and oversized notes', () => {
    expect(paymentAttemptSchema.safeParse({
      ...baseInput,
      paymentMethod: 'PROVIDER',
    }).success).toBe(false);
    expect(paymentAttemptSchema.safeParse({
      ...baseInput,
      paymentMethod: 'CASH',
      paymentDateTime: 'not-a-date',
    }).success).toBe(false);
    expect(paymentAttemptSchema.safeParse({
      ...baseInput,
      paymentMethod: 'OTHER',
      paymentNotes: 'x'.repeat(501),
    }).success).toBe(false);
  });
});
