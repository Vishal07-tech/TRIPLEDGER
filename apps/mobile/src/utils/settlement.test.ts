import { calculateSuggestedTransfers, type SettlementMemberBalance } from './settlement';

function member(userId: string, fullName: string, netBalanceMinor: number): SettlementMemberBalance {
  return { userId, fullName, netBalanceMinor };
}

describe('calculateSuggestedTransfers', () => {
  it('asks a member who owes the full share to pay the payer', () => {
    // Vishal paid ₹120 for himself and Barath.
    expect(calculateSuggestedTransfers([member('v', 'Vishal', 6000), member('b', 'Barath', -6000)])).toEqual([
      {
        fromUserId: 'b',
        toUserId: 'v',
        fromName: 'Barath',
        toName: 'Vishal',
        amountMinor: 6000,
      },
    ]);
  });

  it('matches one payer against several members for the ₹160 tea example', () => {
    const transfers = calculateSuggestedTransfers([
      member('v', 'Vishal', 14000),
      member('n', 'N', -2000),
      member('a', 'A', -2000),
      member('h', 'H', -2000),
      member('s', 'S', -2000),
      member('m', 'M', -2000),
      member('r', 'R', -2000),
      member('g', 'G', -2000),
    ]);

    expect(transfers).toHaveLength(7);
    expect(transfers.every((transfer) => transfer.toUserId === 'v')).toBe(true);
    expect(transfers.every((transfer) => transfer.amountMinor === 2000)).toBe(true);
    expect(transfers.reduce((sum, transfer) => sum + transfer.amountMinor, 0)).toBe(14000);
  });

  it('nets several expenses into the fewest transfers', () => {
    const transfers = calculateSuggestedTransfers([
      member('a', 'Alice', -4000),
      member('b', 'Bob', -6000),
      member('c', 'Chandra', 10000),
    ]);

    expect(transfers).toEqual([
      { fromUserId: 'a', toUserId: 'c', fromName: 'Alice', toName: 'Chandra', amountMinor: 4000 },
      { fromUserId: 'b', toUserId: 'c', fromName: 'Bob', toName: 'Chandra', amountMinor: 6000 },
    ]);
  });

  it('returns nothing when everyone is settled', () => {
    expect(calculateSuggestedTransfers([member('a', 'Alice', 0), member('b', 'Bob', 0)])).toEqual([]);
  });

  it('keeps the transfer total equal to the money owed', () => {
    const transfers = calculateSuggestedTransfers([
      member('a', 'Alice', -3333),
      member('b', 'Bob', -3334),
      member('c', 'Chandra', 6667),
    ]);

    expect(transfers.reduce((sum, transfer) => sum + transfer.amountMinor, 0)).toBe(6667);
  });
});
