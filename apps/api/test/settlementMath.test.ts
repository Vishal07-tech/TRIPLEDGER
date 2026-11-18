import { describe, expect, it } from 'vitest';

import { parseMoneyToMinor, parseStoredMoneyToMinor } from '../src/services/financialMath.js';
import { calculateSuggestedTransfers, settlementBalancesFromEntries } from '../src/services/settlementMath.js';

const currency = 'INR';

describe('settlement math', () => {
  it('creates deterministic debtor-to-creditor transfers that exactly reconcile balances', () => {
    const balances = [
      { userId: 'c', fullName: 'Creditor C', balanceMinor: 125n },
      { userId: 'a', fullName: 'Debtor A', balanceMinor: -100n },
      { userId: 'b', fullName: 'Debtor B', balanceMinor: -25n },
    ];

    expect(calculateSuggestedTransfers(balances)).toEqual([
      { debtorUserId: 'a', creditorUserId: 'c', amountMinor: 100n },
      { debtorUserId: 'b', creditorUserId: 'c', amountMinor: 25n },
    ]);
  });

  it('handles multiple creditors and a single debtor with exact minor-unit matching', () => {
    const transfers = calculateSuggestedTransfers([
      { userId: 'debtor', fullName: 'Debtor', balanceMinor: -1001n },
      { userId: 'creditor-a', fullName: 'A', balanceMinor: 501n },
      { userId: 'creditor-b', fullName: 'B', balanceMinor: 500n },
    ]);
    expect(transfers).toEqual([
      { debtorUserId: 'debtor', creditorUserId: 'creditor-a', amountMinor: 501n },
      { debtorUserId: 'debtor', creditorUserId: 'creditor-b', amountMinor: 500n },
    ]);
    expect(transfers.reduce((sum, transfer) => sum + transfer.amountMinor, 0n)).toBe(1001n);
  });

  it('ignores zero balances and returns no transfers when everyone is even', () => {
    expect(calculateSuggestedTransfers([
      { userId: 'a', fullName: 'A', balanceMinor: 0n },
      { userId: 'b', fullName: 'B', balanceMinor: 0n },
    ])).toEqual([]);
  });

  it('rejects non-zero aggregate balances', () => {
    expect(() => calculateSuggestedTransfers([
      { userId: 'a', fullName: 'A', balanceMinor: -1n },
      { userId: 'b', fullName: 'B', balanceMinor: 0n },
    ])).toThrow('Member balances must sum to zero');
  });

  it('builds exact balances from signed financial and settlement ledger entries', () => {
    const balances = settlementBalancesFromEntries(
      currency,
      [
        { userId: 'debtor', amount: '-10.01' },
        { userId: 'creditor', amount: '10.01' },
        { userId: 'debtor', amount: '2.00' },
        { userId: 'creditor', amount: '-2.00' },
      ],
      [
        { userId: 'debtor', fullName: 'Debtor' },
        { userId: 'creditor', fullName: 'Creditor' },
      ],
    );
    expect(balances.map(({ userId, balanceMinor }) => [userId, balanceMinor])).toEqual([
      ['creditor', parseStoredMoneyToMinor('8.01', currency)],
      ['debtor', parseStoredMoneyToMinor('-8.01', currency)],
    ]);
  });
});
