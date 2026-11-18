import { describe, expect, it } from 'vitest';

import { formatPercentage, validateDateRange } from '../src/services/analyticsService.js';
import { FinancialInputError } from '../src/services/financialMath.js';

describe('analytics math and validation unit tests', () => {
  it('formats percentages with exact minor unit integer arithmetic', () => {
    expect(formatPercentage(0n, 1000n)).toBe('0.00');
    expect(formatPercentage(100n, 0n)).toBe('0.00');
    expect(formatPercentage(500n, 1000n)).toBe('50.00');
    expect(formatPercentage(1n, 3n)).toBe('33.33');
    expect(formatPercentage(2n, 3n)).toBe('66.67');
    expect(formatPercentage(1000n, 1000n)).toBe('100.00');
    expect(formatPercentage(1250n, 1000n)).toBe('125.00');
  });

  it('validates and normalizes date ranges correctly', () => {
    // Both undefined / empty
    const empty = validateDateRange(undefined, '');
    expect(empty.startDate).toBeNull();
    expect(empty.endDate).toBeNull();

    // Valid YYYY-MM-DD
    const dateRange = validateDateRange('2026-11-01', '2026-11-15');
    expect(dateRange.startDate?.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(dateRange.endDate?.toISOString()).toBe('2026-11-15T23:59:59.999Z');

    // Valid full ISO
    const isoRange = validateDateRange(
      '2026-11-01T10:00:00.000Z',
      '2026-11-05T18:00:00.000Z',
    );
    expect(isoRange.startDate?.toISOString()).toBe('2026-11-01T10:00:00.000Z');
    expect(isoRange.endDate?.toISOString()).toBe('2026-11-05T18:00:00.000Z');

    // Start only
    const startOnly = validateDateRange('2026-11-01');
    expect(startOnly.startDate?.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(startOnly.endDate).toBeNull();

    // End only
    const endOnly = validateDateRange(undefined, '2026-11-30');
    expect(endOnly.startDate).toBeNull();
    expect(endOnly.endDate?.toISOString()).toBe('2026-11-30T23:59:59.999Z');
  });

  it('rejects invalid date formats or inverted ranges', () => {
    expect(() => validateDateRange('not-a-date')).toThrowError(FinancialInputError);
    expect(() => validateDateRange('2026-11-01', 'invalid-end')).toThrowError(
      FinancialInputError,
    );

    // Start date after end date
    expect(() => validateDateRange('2026-11-20', '2026-11-10')).toThrowError(
      FinancialInputError,
    );
  });
});
