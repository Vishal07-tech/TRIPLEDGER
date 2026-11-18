import { FinancialInputError, minorToDecimalString, parseStoredMoneyToMinor } from './financialMath.js';

export type SettlementBalance = {
  userId: string;
  fullName: string;
  balanceMinor: bigint;
};

export type SuggestedTransfer = {
  debtorUserId: string;
  creditorUserId: string;
  amountMinor: bigint;
};

export function calculateSuggestedTransfers(
  balances: SettlementBalance[],
): SuggestedTransfer[] {
  const total = balances.reduce((sum, member) => sum + member.balanceMinor, 0n);
  if (total !== 0n) {
    throw new FinancialInputError('Member balances must sum to zero before settlement planning.');
  }

  const debtors = balances
    .filter((member) => member.balanceMinor < 0n)
    .map((member) => ({ userId: member.userId, remaining: -member.balanceMinor }))
    .sort((left, right) => left.userId < right.userId ? -1 : left.userId > right.userId ? 1 : 0);
  const creditors = balances
    .filter((member) => member.balanceMinor > 0n)
    .map((member) => ({ userId: member.userId, remaining: member.balanceMinor }))
    .sort((left, right) => left.userId < right.userId ? -1 : left.userId > right.userId ? 1 : 0);

  const transfers: SuggestedTransfer[] = [];
  let debtorIndex = 0;
  let creditorIndex = 0;

  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const debtor = debtors[debtorIndex];
    const creditor = creditors[creditorIndex];
    const amountMinor = debtor.remaining < creditor.remaining ? debtor.remaining : creditor.remaining;

    transfers.push({
      debtorUserId: debtor.userId,
      creditorUserId: creditor.userId,
      amountMinor,
    });

    debtor.remaining -= amountMinor;
    creditor.remaining -= amountMinor;
    if (debtor.remaining === 0n) debtorIndex += 1;
    if (creditor.remaining === 0n) creditorIndex += 1;
  }

  if (debtorIndex !== debtors.length || creditorIndex !== creditors.length) {
    throw new FinancialInputError('Settlement transfers did not reconcile every member balance.');
  }

  return transfers;
}

export function settlementBalancesFromEntries(
  currency: string,
  entries: Array<{ userId: string; amount: string }>,
  members: Array<{ userId: string; fullName: string }>,
) {
  const totals = new Map<string, bigint>();
  for (const entry of entries) {
    totals.set(
      entry.userId,
      (totals.get(entry.userId) ?? 0n) + parseStoredMoneyToMinor(entry.amount, currency),
    );
  }

  const names = new Map(members.map((member) => [member.userId, member.fullName]));
  for (const userId of totals.keys()) {
    if (!names.has(userId)) {
      throw new FinancialInputError('A ledger entry belongs to a user who is not a trip member.');
    }
  }

  return [...new Set([...names.keys(), ...totals.keys()])]
    .map((userId) => ({
      userId,
      fullName: names.get(userId) ?? 'Trip member',
      balanceMinor: totals.get(userId) ?? 0n,
    }))
    .sort((left, right) => left.userId < right.userId ? -1 : left.userId > right.userId ? 1 : 0);
}

export function formatSettlementAmount(amountMinor: bigint, currency: string) {
  return minorToDecimalString(amountMinor, currency);
}
