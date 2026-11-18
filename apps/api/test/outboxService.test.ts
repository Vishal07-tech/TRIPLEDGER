import { describe, expect, it } from 'vitest';

import {
  decodeTripEventCursor,
  encodeTripEventCursor,
  getOutboxRetryDelay,
  tripEventTypes,
} from '../src/services/outboxService.js';

describe('transactional trip event foundation', () => {
  it('uses capped exponential retry delays', () => {
    expect([1, 2, 3, 8, 20].map(getOutboxRetryDelay)).toEqual([
      1_000,
      2_000,
      4_000,
      128_000,
      128_000,
    ]);
  });

  it('limits domain event types to supported application changes', () => {
    expect(tripEventTypes).toContain('TRIP_EXPENSE_CREATED');
    expect(tripEventTypes).toContain('SETTLEMENT_PAYMENT_CONFIRMED');
    expect(tripEventTypes).not.toContain('BANK_TRANSFER_VERIFIED');
  });

  it('round-trips a per-trip monotonic event cursor', () => {
    const sequence = 987654321n;
    expect(decodeTripEventCursor(encodeTripEventCursor(sequence))).toBe(sequence);
    expect(() => decodeTripEventCursor('invalid')).toThrow('Invalid trip event cursor.');
    expect(() => decodeTripEventCursor('-1')).toThrow('Invalid trip event cursor.');
  });
});
