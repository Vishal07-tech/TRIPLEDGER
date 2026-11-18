export type SettlementMemberBalance = {
  userId: string;
  fullName: string;
  /** Positive means the member paid more than their share and is owed money. */
  netBalanceMinor: number;
};

export type SuggestedTransfer = {
  fromUserId: string;
  toUserId: string;
  fromName: string;
  toName: string;
  amountMinor: number;
};

/**
 * Turns per-member net balances into the smallest useful set of "who pays whom"
 * transfers by matching the largest debtor against the largest creditor.
 *
 * Mirrors the server's settlement planner so the tally shown on each phone
 * agrees with the plan the server generates when a trip closes.
 */
export function calculateSuggestedTransfers(
  members: SettlementMemberBalance[],
): SuggestedTransfer[] {
  const debtors = members
    .filter((member) => member.netBalanceMinor < 0)
    .map((member) => ({ ...member, remaining: -member.netBalanceMinor }))
    .sort((left, right) => (left.userId < right.userId ? -1 : left.userId > right.userId ? 1 : 0));
  const creditors = members
    .filter((member) => member.netBalanceMinor > 0)
    .map((member) => ({ ...member, remaining: member.netBalanceMinor }))
    .sort((left, right) => (left.userId < right.userId ? -1 : left.userId > right.userId ? 1 : 0));

  const transfers: SuggestedTransfer[] = [];
  let debtorIndex = 0;
  let creditorIndex = 0;

  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const debtor = debtors[debtorIndex];
    const creditor = creditors[creditorIndex];
    const amountMinor = Math.min(debtor.remaining, creditor.remaining);

    if (amountMinor > 0) {
      transfers.push({
        fromUserId: debtor.userId,
        toUserId: creditor.userId,
        fromName: debtor.fullName,
        toName: creditor.fullName,
        amountMinor,
      });
    }

    debtor.remaining -= amountMinor;
    creditor.remaining -= amountMinor;

    if (debtor.remaining === 0) debtorIndex += 1;
    if (creditor.remaining === 0) creditorIndex += 1;
  }

  return transfers;
}
