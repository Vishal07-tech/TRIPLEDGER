import { z } from 'zod';
import type { Prisma } from '@prisma/client';

import {
  apportionMinorUnits,
  convertMinorUnits,
  FinancialInputError,
  minorToDecimalString,
  parseMoneyToMinor,
  parseStoredMoneyToMinor,
  splitAmount,
  type SplitInput,
  type SplitMethod,
} from './financialMath.js';
import { syncMemberBudget } from './budgetService.js';
import { enqueueTripEvent } from './outboxService.js';

const memberSplitSchema = z.object({
  userId: z.string().uuid(),
  amount: z.string().trim().optional(),
  percentage: z.string().trim().optional(),
  weight: z.string().trim().optional(),
});

const payerSchema = z.object({
  userId: z.string().uuid(),
  amount: z.string().trim(),
});

export const expenseInputSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).optional(),
  amount: z.string().trim(),
  currency: z.string().trim().length(3).transform((value) => value.toUpperCase()),
  exchangeRate: z.string().trim().optional(),
  category: z.string().trim().min(1).max(60),
  expenseType: z.enum(['PERSONAL', 'GROUP']),
  splitMethod: z.enum(['EQUAL', 'EXACT', 'PERCENTAGE', 'WEIGHTED']),
  paymentMethod: z.enum(['CASH', 'UPI']),
  date: z.string().datetime({ offset: true }),
  responsibleUserId: z.string().uuid().optional(),
  splits: z.array(memberSplitSchema).optional(),
  payers: z.array(payerSchema).min(1),
});

export const expenseCorrectionSchema = z.object({
  reason: z.string().trim().min(3).max(500),
  replacement: expenseInputSchema,
});

export const expenseReversalSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});

type ExpenseInput = z.infer<typeof expenseInputSchema>;
type Transaction = Prisma.TransactionClient;

function assertUniqueMemberIds(userIds: string[]) {
  if (new Set(userIds).size !== userIds.length) {
    throw new FinancialInputError('A member may appear only once in the expense.');
  }
}

function buildResponsibleSplits(input: ExpenseInput): {
  method: SplitMethod;
  splits: SplitInput[];
  isManual: boolean;
} {
  if (input.expenseType === 'PERSONAL') {
    if (!input.responsibleUserId || input.splits?.length) {
      throw new FinancialInputError('Personal expenses require exactly one responsible member.');
    }

    return {
      method: 'EXACT',
      splits: [{ userId: input.responsibleUserId, amount: input.amount }],
      isManual: true,
    };
  }

  if (input.responsibleUserId || !input.splits?.length) {
    throw new FinancialInputError('Group expenses require a list of responsible members.');
  }

  return {
    method: input.splitMethod,
    splits: input.splits,
    isManual: input.splitMethod === 'EXACT',
  };
}

async function updateMemberBudgets(
  tx: Transaction,
  tripId: string,
  currency: string,
  userIds: string[],
) {
  const uniqueIds = [...new Set(userIds)];
  for (const userId of uniqueIds) {
    await syncMemberBudget(tx, tripId, userId, currency);
  }
}

async function assertCanModifyExpense(
  tx: Transaction,
  tripId: string,
  creatorUserId: string,
  actorUserId: string,
  actorRole: string,
) {
  if (actorRole === 'VIEWER') {
    throw new FinancialInputError('Viewers cannot modify expenses.');
  }
  if (['OWNER', 'ADMIN'].includes(actorRole)) {
    return;
  }
  if (creatorUserId !== actorUserId) {
    throw new FinancialInputError('Only the expense creator, trip owner, or trip admin can modify this expense.');
  }
  const settings = await tx.tripSetting.findUnique({ where: { tripId } });
  if (settings?.allowMemberExpenseEdit === false) {
    throw new FinancialInputError('Trip settings do not allow members to modify expenses.');
  }
}

async function appendLedgerEntries(
  tx: Transaction,
  input: {
    expenseId: string;
    tripId: string;
    actorUserId: string;
    currency: string;
    payerAmounts: Array<{ userId: string; amountMinor: bigint }>;
    allocations: Array<{ userId: string; amountMinor: bigint }>;
    convertedTotal: bigint;
  },
) {
  const payerShares = apportionMinorUnits(
    input.convertedTotal,
    input.payerAmounts.map(({ userId, amountMinor }) => ({ userId, weight: amountMinor })),
  );
  const responsibilityShares = apportionMinorUnits(
    input.convertedTotal,
    input.allocations
      .filter(({ amountMinor }) => amountMinor > 0n)
      .map(({ userId, amountMinor }) => ({ userId, weight: amountMinor })),
  );
  const entries = [
    ...payerShares.map((share) => ({
      tripId: input.tripId,
      expenseId: input.expenseId,
      userId: share.userId,
      createdByUserId: input.actorUserId,
      entryType: 'PAYER_ADVANCE',
      amount: minorToDecimalString(share.amountMinor, input.currency),
      currency: input.currency,
    })),
    ...responsibilityShares.map((share) => ({
      tripId: input.tripId,
      expenseId: input.expenseId,
      userId: share.userId,
      createdByUserId: input.actorUserId,
      entryType: 'RESPONSIBILITY',
      amount: minorToDecimalString(-share.amountMinor, input.currency),
      currency: input.currency,
    })),
  ];

  await tx.financialEntry.createMany({ data: entries });
  return entries;
}

async function createExpenseInTransaction(
  tx: Transaction,
  tripId: string,
  actorUserId: string,
  input: ExpenseInput,
  correctedFromExpenseId?: string,
) {
  const trip = await tx.trip.findUnique({
    where: { id: tripId },
    select: {
      baseCurrency: true,
      cashManagerUserId: true,
      status: true,
    },
  });
  if (!trip) {
    throw new FinancialInputError('Trip not found.');
  }
  if (trip.status !== 'ACTIVE') {
    throw new FinancialInputError('Expenses can only be added to active trips.');
  }

  const totalMinor = parseMoneyToMinor(input.amount, input.currency);
  const exchangeRateCapturedAt = input.currency === trip.baseCurrency ? null : new Date();
  const convertedTotal = convertMinorUnits(totalMinor, input.currency, trip.baseCurrency, input.exchangeRate);
  const { method, splits, isManual } = buildResponsibleSplits(input);
  const allocations = splitAmount(totalMinor, method, splits, input.currency);
  const payerAmounts = input.payers.map((payer) => ({
    userId: payer.userId,
    amountMinor: parseMoneyToMinor(payer.amount, input.currency),
  }));
  assertUniqueMemberIds(payerAmounts.map((payer) => payer.userId));

  if (payerAmounts.reduce((sum, payer) => sum + payer.amountMinor, 0n) !== totalMinor) {
    throw new FinancialInputError('Payer amounts must add up exactly to the expense total.');
  }

  if (input.paymentMethod === 'CASH' && !trip.cashManagerUserId) {
    throw new FinancialInputError('Assign a cash manager before recording cash expenses.');
  }
  if (
    input.paymentMethod === 'CASH' &&
    !payerAmounts.some((payer) => payer.userId === trip.cashManagerUserId)
  ) {
    throw new FinancialInputError('The cash manager must be recorded as a payer for cash expenses.');
  }

  const participantIds = [
    ...payerAmounts.map((payer) => payer.userId),
    ...allocations.map((allocation) => allocation.userId),
  ];
  assertUniqueMemberIds(allocations.map((allocation) => allocation.userId));
  const members = await tx.tripMember.findMany({
    where: {
      tripId,
      userId: { in: [...new Set(participantIds)] },
      isActive: true,
    },
    select: { userId: true },
  });
  const activeIds = new Set(members.map((member) => member.userId));
  if (participantIds.some((userId) => !activeIds.has(userId))) {
    throw new FinancialInputError('Every payer and responsible member must be active in this trip.');
  }

  const expense = await tx.expense.create({
    data: {
      tripId,
      title: input.title,
      description: input.description,
      amount: minorToDecimalString(totalMinor, input.currency),
      currency: input.currency,
      convertedAmount: minorToDecimalString(convertedTotal, trip.baseCurrency),
      exchangeRate: input.currency === trip.baseCurrency ? null : input.exchangeRate,
      exchangeRateCapturedAt,
      category: input.category,
      expenseType: input.expenseType,
      splitMethod: method,
      paymentMethod: input.paymentMethod,
      date: new Date(input.date),
      createdByUserId: actorUserId,
      correctedFromExpenseId,
      payers: {
        create: input.payers.map((payer) => ({
          userId: payer.userId,
          amount: minorToDecimalString(parseMoneyToMinor(payer.amount, input.currency), input.currency),
          currency: input.currency,
          isCashManagerDisbursement:
            input.paymentMethod === 'CASH' && payer.userId === trip.cashManagerUserId,
        })),
      },
      allocations: {
        create: allocations.map((allocation) => {
          const split = splits.find((candidate) => candidate.userId === allocation.userId);
          return {
            userId: allocation.userId,
            allocatedAmount: minorToDecimalString(allocation.amountMinor, input.currency),
            percentage: split?.percentage,
            weight: split?.weight,
            isManual,
          };
        }),
      },
    },
    include: { payers: true, allocations: true },
  });

  await appendLedgerEntries(tx, {
    expenseId: expense.id,
    tripId,
    actorUserId,
    currency: trip.baseCurrency,
    payerAmounts,
    allocations,
    convertedTotal,
  });
  await updateMemberBudgets(
    tx,
    tripId,
    trip.baseCurrency,
    allocations.map((allocation) => allocation.userId),
  );

  await tx.auditLog.create({
    data: {
      tripId,
      userId: actorUserId,
      entityType: 'Expense',
      entityId: expense.id,
      action: correctedFromExpenseId ? 'EXPENSE_CORRECTION_CREATED' : 'EXPENSE_CREATED',
      details: {
        amount: input.amount,
        currency: input.currency,
        exchangeRate: input.currency === trip.baseCurrency ? null : input.exchangeRate,
        exchangeRateCapturedAt: exchangeRateCapturedAt?.toISOString() ?? null,
        convertedAmount: minorToDecimalString(convertedTotal, trip.baseCurrency),
        expenseType: input.expenseType,
        splitMethod: method,
        payerUserIds: payerAmounts.map((payer) => payer.userId),
        responsibleUserIds: allocations.map((allocation) => allocation.userId),
        correctedFromExpenseId: correctedFromExpenseId ?? null,
        recordedPaymentMethod: input.paymentMethod,
      },
    },
  });
  await enqueueTripEvent(tx, {
    tripId,
    eventKey: `expense:${expense.id}:${correctedFromExpenseId ? 'corrected' : 'created'}`,
    eventType: correctedFromExpenseId ? 'TRIP_EXPENSE_CORRECTED' : 'TRIP_EXPENSE_CREATED',
    payload: {
      entityType: 'Expense',
      entityId: expense.id,
      actorUserId,
      ...(correctedFromExpenseId ? { relatedEntityId: correctedFromExpenseId } : {}),
    },
  });

  return expense;
}

async function reverseExpenseLedger(tx: Transaction, expenseId: string, actorUserId: string) {
  const originalEntries = await tx.financialEntry.findMany({
    where: { expenseId },
    select: {
      id: true,
      tripId: true,
      expenseId: true,
      userId: true,
      entryType: true,
      amount: true,
      currency: true,
    },
  });
  if (!originalEntries.length) {
    throw new FinancialInputError('Expense has no ledger entries to reverse.');
  }

  const reversedEntryIds = await tx.financialEntry.findMany({
    where: { reversalOfId: { in: originalEntries.map((entry) => entry.id) } },
    select: { reversalOfId: true },
  });
  const alreadyReversed = new Set(reversedEntryIds.map((entry) => entry.reversalOfId));
  const pendingReversals = originalEntries.filter((entry) => !alreadyReversed.has(entry.id));
  if (pendingReversals.length !== originalEntries.length) {
    throw new FinancialInputError('Expense ledger entries have already been reversed.');
  }

  await tx.financialEntry.createMany({
    data: originalEntries.map((entry) => ({
      tripId: entry.tripId,
      expenseId: entry.expenseId,
      userId: entry.userId,
      createdByUserId: actorUserId,
      entryType: 'REVERSAL',
      amount: minorToDecimalString(
        -parseStoredMoneyToMinor(String(entry.amount), entry.currency),
        entry.currency,
      ),
      currency: entry.currency,
      reversalOfId: entry.id,
    })),
  });

  return originalEntries;
}

export async function createExpense(
  tx: Transaction,
  tripId: string,
  actorUserId: string,
  input: ExpenseInput,
) {
  return createExpenseInTransaction(tx, tripId, actorUserId, input);
}

export async function correctExpense(
  tx: Transaction,
  tripId: string,
  expenseId: string,
  actorUserId: string,
  actorRole: string,
  reason: string,
  replacement: ExpenseInput,
) {
  const original = await tx.expense.findFirst({
    where: { id: expenseId, tripId },
    include: { payers: true, allocations: true },
  });
  if (!original) {
    throw new FinancialInputError('Expense not found.');
  }
  if (original.status !== 'ACTIVE') {
    throw new FinancialInputError('Only active expenses can be corrected.');
  }
  const tripStatus = await tx.trip.findUnique({
    where: { id: tripId },
    select: { status: true },
  });
  if (tripStatus?.status !== 'ACTIVE') {
    throw new FinancialInputError('Expenses cannot be corrected after trip closure has started.');
  }
  await assertCanModifyExpense(tx, tripId, original.createdByUserId, actorUserId, actorRole);

  const oldLedgerEntries = await reverseExpenseLedger(tx, original.id, actorUserId);
  await tx.expense.update({
    where: { id: original.id },
    data: { status: 'CORRECTED', updatedByUserId: actorUserId },
  });

  const correctedExpense = await createExpenseInTransaction(
    tx,
    tripId,
    actorUserId,
    replacement,
    original.id,
  );
  const trip = await tx.trip.findUniqueOrThrow({
    where: { id: tripId },
    select: { baseCurrency: true },
  });
  await updateMemberBudgets(
    tx,
    tripId,
    trip.baseCurrency,
    oldLedgerEntries.map((entry) => entry.userId),
  );
  await tx.auditLog.create({
    data: {
      tripId,
      userId: actorUserId,
      entityType: 'Expense',
      entityId: original.id,
      action: 'EXPENSE_CORRECTED',
      details: {
        reason,
        replacementExpenseId: correctedExpense.id,
        reversedLedgerEntryIds: oldLedgerEntries.map((entry) => entry.id),
      },
    },
  });

  return correctedExpense;
}

export async function reverseExpense(
  tx: Transaction,
  tripId: string,
  expenseId: string,
  actorUserId: string,
  actorRole: string,
  reason: string,
) {
  const original = await tx.expense.findFirst({
    where: { id: expenseId, tripId },
  });
  if (!original) {
    throw new FinancialInputError('Expense not found.');
  }
  if (original.status !== 'ACTIVE') {
    throw new FinancialInputError('Only active expenses can be reversed.');
  }
  const tripStatus = await tx.trip.findUnique({
    where: { id: tripId },
    select: { status: true },
  });
  if (tripStatus?.status !== 'ACTIVE') {
    throw new FinancialInputError('Expenses cannot be reversed after trip closure has started.');
  }
  await assertCanModifyExpense(tx, tripId, original.createdByUserId, actorUserId, actorRole);

  const originalEntries = await reverseExpenseLedger(tx, original.id, actorUserId);
  await tx.expense.update({
    where: { id: original.id },
    data: { status: 'REVERSED', updatedByUserId: actorUserId },
  });
  const trip = await tx.trip.findUniqueOrThrow({
    where: { id: tripId },
    select: { baseCurrency: true },
  });
  await updateMemberBudgets(
    tx,
    tripId,
    trip.baseCurrency,
    originalEntries.map((entry) => entry.userId),
  );
  await tx.auditLog.create({
    data: {
      tripId,
      userId: actorUserId,
      entityType: 'Expense',
      entityId: original.id,
      action: 'EXPENSE_REVERSED',
      details: {
        reason,
        reversedLedgerEntryIds: originalEntries.map((entry) => entry.id),
      },
    },
  });
  await enqueueTripEvent(tx, {
    tripId,
    eventKey: `expense:${original.id}:reversed`,
    eventType: 'TRIP_EXPENSE_REVERSED',
    payload: { entityType: 'Expense', entityId: original.id, actorUserId },
  });

  return { id: original.id, status: 'REVERSED' };
}
