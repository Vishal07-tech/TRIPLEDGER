import { describe, expect, it } from 'vitest';

import {
  apportionMinorUnits,
  convertMinorUnits,
  FinancialInputError,
  minorToDecimalString,
  parseMoneyToMinor,
  parseStoredMoneyToMinor,
  splitAmount,
} from '../src/services/financialMath.js';

describe('financial math', () => {
  const firstUser = '00000000-0000-4000-8000-000000000001';
  const secondUser = '00000000-0000-4000-8000-000000000002';
  const thirdUser = '00000000-0000-4000-8000-000000000003';

  it('splits equal amounts in integer minor units with deterministic remainders', () => {
    const result = splitAmount(
      parseMoneyToMinor('10.01', 'USD'),
      'EQUAL',
      [{ userId: thirdUser }, { userId: firstUser }, { userId: secondUser }],
      'USD',
    );

    expect(result).toEqual([
      { userId: thirdUser, amountMinor: 333n },
      { userId: firstUser, amountMinor: 334n },
      { userId: secondUser, amountMinor: 334n },
    ]);
    expect(result.reduce((sum, item) => sum + item.amountMinor, 0n)).toBe(1001n);
  });

  it('validates exact split totals rather than tolerating rounding drift', () => {
    expect(() =>
      splitAmount(
        1001n,
        'EXACT',
        [
          { userId: firstUser, amount: '5.00' },
          { userId: secondUser, amount: '5.00' },
        ],
        'USD',
      ),
    ).toThrow('Exact split amounts must add up to the expense total.');
  });

  it('allocates percentage remainders exactly and accepts exact 100 percent', () => {
    const result = splitAmount(
      1001n,
      'PERCENTAGE',
      [
        { userId: firstUser, percentage: '33.33' },
        { userId: secondUser, percentage: '33.33' },
        { userId: thirdUser, percentage: '33.34' },
      ],
      'USD',
    );

    expect(result).toEqual([
      { userId: firstUser, amountMinor: 334n },
      { userId: secondUser, amountMinor: 333n },
      { userId: thirdUser, amountMinor: 334n },
    ]);
    expect(result.reduce((sum, item) => sum + item.amountMinor, 0n)).toBe(1001n);
    expect(() =>
      splitAmount(1001n, 'PERCENTAGE', [{ userId: firstUser, percentage: '99.99' }], 'USD'),
    ).toThrow('Percentages must add up to exactly 100.00%.');
  });

  it('allocates weighted shares without losing a cent', () => {
    const result = splitAmount(
      1001n,
      'WEIGHTED',
      [
        { userId: firstUser, weight: '1' },
        { userId: secondUser, weight: '2' },
      ],
      'USD',
    );

    expect(result).toEqual([
      { userId: firstUser, amountMinor: 334n },
      { userId: secondUser, amountMinor: 667n },
    ]);
    expect(result.reduce((sum, item) => sum + item.amountMinor, 0n)).toBe(1001n);
  });

  it('converts source currency using exact integer arithmetic and half-up rounding', () => {
    expect(convertMinorUnits(100n, 'USD', 'INR', '83.125')).toBe(8313n);
    expect(minorToDecimalString(8313n, 'INR')).toBe('83.13');
    expect(convertMinorUnits(8313n, 'INR', 'INR')).toBe(8313n);
  });

  it('supports zero-decimal currencies without accepting fractional units', () => {
    expect(parseMoneyToMinor('1200', 'JPY')).toBe(1200n);
    expect(minorToDecimalString(1200n, 'JPY')).toBe('1200.00');
    expect(parseStoredMoneyToMinor('1200.00', 'JPY')).toBe(1200n);
    expect(() => parseMoneyToMinor('1200.5', 'JPY')).toThrow(FinancialInputError);
  });

  it('rejects duplicate payees and invalid currency precision', () => {
    expect(() =>
      splitAmount(
        100n,
        'EQUAL',
        [{ userId: firstUser }, { userId: firstUser }],
        'USD',
      ),
    ).toThrow('A member may appear only once in the expense split.');
    expect(() => parseMoneyToMinor('1.001', 'USD')).toThrow('USD amounts support at most 2 decimal places.');
    expect(() => parseMoneyToMinor('1.000', 'KWD')).toThrow(
      'Currencies with more than two minor-unit digits are not supported.',
    );
    expect(() => convertMinorUnits(100n, 'USD', 'INR', '10000000000')).toThrow(
      'Exchange rate exceeds the supported database precision.',
    );
  });

  it('apportions converted totals without losing base-currency minor units', () => {
    const result = apportionMinorUnits(1001n, [
      { userId: firstUser, weight: 1n },
      { userId: secondUser, weight: 1n },
    ]);
    expect(result).toEqual([
      { userId: firstUser, amountMinor: 501n },
      { userId: secondUser, amountMinor: 500n },
    ]);
  });
});
