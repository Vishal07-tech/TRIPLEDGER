import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import type { SettlementPaymentStatus } from '@prisma/client';

import { ident, moneyAsText } from '../lib/sqlDialect.js';
import {
  FinancialInputError,
  minorToDecimalString,
  parseMoneyToMinor,
  parseStoredMoneyToMinor,
} from './financialMath.js';
import {
  calculateSuggestedTransfers,
  settlementBalancesFromEntries,
  type SettlementBalance,
} from './settlementMath.js';
import { enqueueTripEvent, type TripEventType } from './outboxService.js';

type Transaction = Prisma.TransactionClient;
type Actor = { userId: string; role: string };

async function enqueueTripStateEvent(
  tx: Transaction,
  tripId: string,
  actorUserId: string,
  eventType: TripEventType,
) {
  await enqueueTripEvent(tx, {
    tripId,
    eventKey: `trip-state:${tripId}:${eventType}:${randomUUID()}`,
    eventType,
    payload: { entityType: 'Trip', entityId: tripId, actorUserId },
  });
}

export const reviewSchema = z.object({
  status: z.enum(['REVIEWED', 'DISPUTED']),
  comment: z.string().trim().max(500).optional(),
}).superRefine((value, context) => {
  if (value.status === 'DISPUTED' && (value.comment?.trim().length ?? 0) < 3) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['comment'], message: 'Explain the expense dispute.' });
  }
});

export const resolutionSchema = z.object({
  userId: z.string().uuid(),
  reason: z.string().trim().min(3).max(500),
});

export const paymentAttemptSchema = z.object({
  amount: z.string().trim(),
  transactionReference: z.string().trim().max(191).nullable().optional().transform((value) => value || null),
  paymentMethod: z.enum(['UPI', 'CASH', 'BANK_TRANSFER', 'OTHER']),
  paymentDateTime: z.string().datetime({ offset: true }),
  paymentNotes: z.string().trim().max(500).nullable().optional().transform((value) => value || null),
  idempotencyKey: z.string().trim().min(8).max(191),
});

export const paymentActionSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(191),
  reason: z.string().trim().min(3).max(500).optional(),
});

export const overridePaymentSchema = z.object({
  status: z.enum(['SUCCESSFUL', 'DECLINED']),
  idempotencyKey: z.string().trim().min(8).max(191),
  reason: z.string().trim().min(3).max(500),
});

export const refundSchema = z.object({
  amount: z.string().trim(),
  idempotencyKey: z.string().trim().min(8).max(191),
  reason: z.string().trim().min(3).max(500),
});

function assertManager(actor: Actor) {
  if (actor.role !== 'OWNER' && actor.role !== 'ADMIN') {
    throw new FinancialInputError('Only the trip owner or an admin can perform this action.');
  }
}

function assertPaymentIdempotencyKey(value: string) {
  if (value.length < 8 || value.length > 191) {
    throw new FinancialInputError('A valid idempotency key is required.');
  }
}

async function writeAudit(
  tx: Transaction,
  tripId: string,
  actorUserId: string,
  entityType: string,
  entityId: string,
  action: string,
  details?: Prisma.InputJsonValue,
) {
  await tx.auditLog.create({
    data: { tripId, userId: actorUserId, entityType, entityId, action, details },
  });
}

export async function requestTripClosure(tx: Transaction, tripId: string, actor: Actor) {
  const trip = await tx.trip.findUnique({ where: { id: tripId }, select: { status: true } });
  if (!trip) throw new FinancialInputError('Trip not found.');
  if (trip.status !== 'ACTIVE') throw new FinancialInputError('Closure requests are only available during an active trip.');

  await writeAudit(tx, tripId, actor.userId, 'TripClosureRequest', tripId, 'TRIP_CLOSURE_REQUESTED');
  await enqueueTripStateEvent(tx, tripId, actor.userId, 'TRIP_CLOSURE_REQUESTED');
}

export async function initiateTripClosure(tx: Transaction, tripId: string, actor: Actor) {
  assertManager(actor);
  const changed = await tx.trip.updateMany({
    where: { id: tripId, status: 'ACTIVE' },
    data: { status: 'CLOSING' },
  });
  if (changed.count !== 1) throw new FinancialInputError('Only an active trip can enter closure.');
  await writeAudit(tx, tripId, actor.userId, 'Trip', tripId, 'TRIP_CLOSURE_INITIATED');
  await enqueueTripStateEvent(tx, tripId, actor.userId, 'TRIP_CLOSURE_INITIATED');
}

export async function startTripExpenseReview(tx: Transaction, tripId: string, actor: Actor) {
  assertManager(actor);
  const trip = await tx.trip.findUnique({ where: { id: tripId }, select: { status: true } });
  if (!trip) throw new FinancialInputError('Trip not found.');
  if (trip.status !== 'CLOSING') throw new FinancialInputError('Closure must be initiated before expense review.');

  const [tripRecord, expenses] = await Promise.all([
    tx.trip.findUniqueOrThrow({ where: { id: tripId }, select: { settlementRevision: true } }),
    tx.expense.findMany({
    where: { tripId, status: 'ACTIVE' },
    select: { id: true, payers: { select: { userId: true } }, allocations: { select: { userId: true } } },
    }),
  ]);
  for (const expense of expenses) {
    const participants = [...new Set([
      ...expense.payers.map((payer) => payer.userId),
      ...expense.allocations.map((allocation) => allocation.userId),
    ])];
    for (const userId of participants) {
      await tx.settlementExpenseReview.upsert({
        where: {
          expenseId_userId_reviewRevision: {
            expenseId: expense.id, userId, reviewRevision: tripRecord.settlementRevision,
          },
        },
        create: {
          tripId, expenseId: expense.id, userId, reviewRevision: tripRecord.settlementRevision,
        },
        update: {},
      });
    }
  }

  await tx.trip.update({ where: { id: tripId }, data: { status: 'EXPENSE_REVIEW' } });
  await writeAudit(tx, tripId, actor.userId, 'Trip', tripId, 'EXPENSE_REVIEW_STARTED', {
    activeExpenseCount: expenses.length,
  });
  await enqueueTripStateEvent(tx, tripId, actor.userId, 'TRIP_EXPENSE_REVIEW_STARTED');
}

export async function getTripExpenseReviews(
  tx: Transaction,
  tripId: string,
  actor: Actor,
) {
  const tripRecord = await tx.trip.findUniqueOrThrow({
    where: { id: tripId },
    select: { settlementRevision: true },
  });
  const expenses = await tx.expense.findMany({
    where: { tripId, status: 'ACTIVE' },
    include: {
      payers: true,
      allocations: true,
      settlementReviews: { where: { reviewRevision: tripRecord.settlementRevision } },
    },
    orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
  });
  const canSeeAll = actor.role === 'OWNER' || actor.role === 'ADMIN';
  return {
    expenses: expenses
      .filter((expense) => canSeeAll || expense.payers.some((payer) => payer.userId === actor.userId)
        || expense.allocations.some((allocation) => allocation.userId === actor.userId))
      .map((expense) => ({
        id: expense.id,
        title: expense.title,
        amount: String(expense.amount),
        currency: expense.currency,
        status: expense.status,
        payers: expense.payers.map((payer) => ({
          userId: payer.userId,
          amount: String(payer.amount),
          contributionStatus: payer.paymentStatus,
        })),
        allocations: expense.allocations.map((allocation) => ({
          userId: allocation.userId,
          allocatedAmount: String(allocation.allocatedAmount),
        })),
        reviews: expense.settlementReviews.map((review) => ({
          userId: review.userId,
          status: review.status,
          comment: review.comment,
          resolutionReason: review.resolutionReason,
          reviewedAt: review.reviewedAt,
        })),
      })),
  };
}

export async function submitExpenseReview(
  tx: Transaction,
  tripId: string,
  expenseId: string,
  actor: Actor,
  input: z.infer<typeof reviewSchema>,
) {
  if (actor.role === 'VIEWER') throw new FinancialInputError('Viewers cannot review expenses.');
  const expense = await tx.expense.findFirst({
    where: { id: expenseId, tripId, status: 'ACTIVE' },
    include: { payers: true, allocations: true },
  });
  if (!expense) throw new FinancialInputError('Active expense not found.');
  const trip = await tx.trip.findUniqueOrThrow({
    where: { id: tripId },
    select: { status: true, settlementRevision: true },
  });
  if (!['CLOSING', 'EXPENSE_REVIEW'].includes(trip.status)) {
    throw new FinancialInputError('Expense reviews are only available during trip closure.');
  }
  const isPayer = expense.payers.some((payer) => payer.userId === actor.userId);
  const isResponsible = expense.allocations.some((allocation) => allocation.userId === actor.userId);
  if (!isPayer && !isResponsible) throw new FinancialInputError('You are not responsible for this expense.');
  if (input.status === 'DISPUTED' && (input.comment?.trim().length ?? 0) < 3) {
    throw new FinancialInputError('Explain the expense dispute.');
  }

  const status = input.status;
  const tripRecord = await tx.trip.findUniqueOrThrow({
    where: { id: tripId },
    select: { settlementRevision: true },
  });
  const priorReview = await tx.settlementExpenseReview.findUnique({
    where: {
      expenseId_userId_reviewRevision: {
        expenseId, userId: actor.userId, reviewRevision: tripRecord.settlementRevision,
      },
    },
  });
  if (priorReview?.status === 'DISPUTED') {
    throw new FinancialInputError('Only an owner or admin can resolve an expense dispute.');
  }
  await tx.settlementExpenseReview.upsert({
    where: {
      expenseId_userId_reviewRevision: {
        expenseId, userId: actor.userId, reviewRevision: tripRecord.settlementRevision,
      },
    },
    create: {
      tripId, expenseId, userId: actor.userId, status,
      reviewRevision: tripRecord.settlementRevision,
      comment: input.comment ?? null,
      reviewedAt: status === 'REVIEWED' ? new Date() : null,
    },
    update: {
      status,
      comment: input.comment ?? null,
      reviewedAt: status === 'REVIEWED' ? new Date() : null,
      resolvedAt: null,
      resolvedByUserId: null,
      resolutionReason: null,
    },
  });
  if (isPayer) {
    await tx.expensePayer.update({
      where: { expenseId_userId: { expenseId, userId: actor.userId } },
      data: { paymentStatus: status === 'REVIEWED' ? 'VERIFIED' : 'DISPUTED' },
    });
  }
  await writeAudit(tx, tripId, actor.userId, 'Expense', expenseId,
    status === 'REVIEWED' ? 'EXPENSE_REVIEW_CONFIRMED' : 'EXPENSE_REVIEW_DISPUTED',
    { comment: input.comment ?? null });
  await enqueueTripStateEvent(tx, tripId, actor.userId, 'SETTLEMENT_EXPENSE_REVIEW_UPDATED');
}

export async function resolveExpenseReview(
  tx: Transaction,
  tripId: string,
  expenseId: string,
  actor: Actor,
  userId: string,
  reason: string,
) {
  assertManager(actor);
  if (reason.trim().length < 3) throw new FinancialInputError('A resolution explanation is required.');
  const trip = await tx.trip.findUniqueOrThrow({
    where: { id: tripId },
    select: { status: true, settlementRevision: true },
  });
  if (!['CLOSING', 'EXPENSE_REVIEW'].includes(trip.status)) {
    throw new FinancialInputError('Expense disputes can only be resolved during trip review.');
  }
  const review = await tx.settlementExpenseReview.findFirst({
    where: {
      tripId, expenseId, userId, status: 'DISPUTED',
      reviewRevision: trip.settlementRevision,
    },
  });
  if (!review) throw new FinancialInputError('No unresolved dispute exists for this member and expense.');

  await tx.settlementExpenseReview.update({
    where: { id: review.id },
    data: {
      status: 'RESOLVED', resolvedByUserId: actor.userId,
      resolutionReason: reason.trim(), resolvedAt: new Date(),
    },
  });
  await tx.expensePayer.updateMany({
    where: { expenseId, userId, paymentStatus: 'DISPUTED' },
    data: { paymentStatus: 'VERIFIED' },
  });
  await writeAudit(tx, tripId, actor.userId, 'Expense', expenseId, 'EXPENSE_REVIEW_DISPUTE_RESOLVED', {
    reviewedUserId: userId, reason: reason.trim(),
  });
  await enqueueTripStateEvent(tx, tripId, actor.userId, 'SETTLEMENT_EXPENSE_REVIEW_UPDATED');
}

async function computeFinalBalances(tx: Transaction, tripId: string) {
  const trip = await tx.trip.findUniqueOrThrow({
    where: { id: tripId },
    select: { baseCurrency: true, settlementRevision: true },
  });
  const [members, expenses, settlementEntries] = await Promise.all([
    tx.tripMember.findMany({
      where: { tripId },
      include: { user: { select: { fullName: true } } },
    }),
    tx.expense.findMany({
      where: { tripId, status: 'ACTIVE' },
      include: {
        payers: true,
        allocations: true,
        settlementReviews: true,
      },
    }),
    tx.settlementLedgerEntry.findMany({
      where: { tripId },
      select: { settlementId: true, userId: true, entryType: true, amount: true, refundId: true },
    }),
  ]);
  const blockers: string[] = [];
  const entries = await tx.financialEntry.findMany({
    where: { tripId, expenseId: { in: expenses.map((expense) => expense.id) } },
    select: { userId: true, amount: true },
  });

  for (const expense of expenses) {
    const participants = new Set([
      ...expense.payers.map((payer) => payer.userId),
      ...expense.allocations.map((allocation) => allocation.userId),
    ]);
    for (const userId of participants) {
      const review = expense.settlementReviews.find((item) =>
        item.userId === userId && item.reviewRevision === trip.settlementRevision,
      );
      if (!review || !['REVIEWED', 'RESOLVED'].includes(review.status)) {
        blockers.push(`${expense.id}:${userId}`);
      }
    }
    if (expense.payers.some((payer) => payer.paymentStatus !== 'VERIFIED')) {
      blockers.push(`${expense.id}:unverified-payer-contribution`);
    }
  }
  if (blockers.length) {
    throw new FinancialInputError('Settlement planning is blocked by incomplete expense reviews or unresolved payer disputes.');
  }

  const allEntries = [
    ...entries.map((entry) => ({ userId: entry.userId, amount: String(entry.amount) })),
    ...settlementEntries.map((entry) => ({ userId: entry.userId, amount: String(entry.amount) })),
  ];
  const balances = settlementBalancesFromEntries(
    trip.baseCurrency,
    allEntries,
    members.map((member) => ({ userId: member.userId, fullName: member.user.fullName })),
  );
  return { trip, balances };
}

export async function generateSettlementPlan(tx: Transaction, tripId: string, actor: Actor) {
  assertManager(actor);
  await tx.$queryRaw(Prisma.sql`SELECT ${ident('id')} FROM ${ident('Trip')} WHERE ${ident('id')} = ${tripId} FOR UPDATE`);
  const trip = await tx.trip.findUnique({ where: { id: tripId }, select: { status: true } });
  if (!trip) throw new FinancialInputError('Trip not found.');
  if (trip.status !== 'EXPENSE_REVIEW') {
    throw new FinancialInputError('Settlement generation is only available after expense review.');
  }

  const { trip: details, balances } = await computeFinalBalances(tx, tripId);
  const transfers = calculateSuggestedTransfers(balances);
  const settlementRows = await Promise.all(transfers.map((transfer) =>
    tx.settlement.create({
      data: {
        tripId,
        debtorUserId: transfer.debtorUserId,
        creditorUserId: transfer.creditorUserId,
        totalAmount: minorToDecimalString(transfer.amountMinor, details.baseCurrency),
        currency: details.baseCurrency,
        planRevision: details.settlementRevision,
        createdByUserId: actor.userId,
        status: 'PLANNED',
      },
    }),
  ));
  await tx.trip.update({
    where: { id: tripId },
    data: { status: settlementRows.length ? 'PAYMENTS_PENDING' : 'FULLY_SETTLED' },
  });
  await writeAudit(tx, tripId, actor.userId, 'SettlementPlan', tripId, 'SETTLEMENT_PLAN_GENERATED', {
    planRevision: details.settlementRevision,
    transferCount: transfers.length,
    totalTransfers: transfers.reduce((sum, transfer) => sum + transfer.amountMinor, 0n).toString(),
  });
  await enqueueTripStateEvent(tx, tripId, actor.userId, 'SETTLEMENT_PLAN_GENERATED');
  return {
    currency: details.baseCurrency,
    balances: balances.map(({ balanceMinor, ...member }) => ({
      ...member,
      balance: minorToDecimalString(balanceMinor, details.baseCurrency),
      balanceMinor: balanceMinor.toString(),
    })),
    settlements: settlementRows,
  };
}

export async function getSettlementOverview(tx: Transaction, tripId: string, actor: Actor) {
  const trip = await tx.trip.findUniqueOrThrow({
    where: { id: tripId },
    select: { status: true, baseCurrency: true, settlementRevision: true },
  });
  const [members, expenses, financialEntries, settlementEntries, settlements, reviews, paymentNotifications] = await Promise.all([
    tx.tripMember.findMany({
      where: { tripId },
      include: { user: { select: { fullName: true } } },
    }),
    tx.expense.findMany({ where: { tripId, status: 'ACTIVE' }, select: { id: true } }),
    tx.financialEntry.findMany({ where: { tripId }, select: { expenseId: true, userId: true, amount: true } }),
    tx.settlementLedgerEntry.findMany({
      where: { tripId },
      select: { settlementId: true, userId: true, entryType: true, amount: true },
    }),
    tx.settlement.findMany({
      where: { tripId, planRevision: trip.settlementRevision },
      include: {
        payments: {
          include: {
            events: { orderBy: { createdAt: 'asc' } },
            refunds: { select: { amount: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { createdAt: 'asc' },
    }),
    tx.settlementExpenseReview.findMany({
      where: { tripId, reviewRevision: trip.settlementRevision },
      select: { status: true },
    }),
    tx.notification.findMany({
      where: { tripId, userId: actor.userId, type: 'PAYMENT_INITIATED' },
      select: { id: true, title: true, message: true, metadata: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
  ]);
  const activeExpenseIds = new Set(expenses.map((expense) => expense.id));
  const currentExpenseEntries = financialEntries
    .filter((entry) => entry.expenseId && activeExpenseIds.has(entry.expenseId))
    .map((entry) => ({ userId: entry.userId, amount: String(entry.amount) }));
  const balances = settlementBalancesFromEntries(
    trip.baseCurrency,
    [
      ...currentExpenseEntries,
      ...settlementEntries.map((entry) => ({ userId: entry.userId, amount: String(entry.amount) })),
    ],
    members.map((member) => ({ userId: member.userId, fullName: member.user.fullName })),
  );
  const currencyScale = trip.baseCurrency;
  const settlementsWithTotals = settlements.map((settlement) => {
    const originalMinor = parseStoredMoneyToMinor(String(settlement.totalAmount), currencyScale);
    const paidMinor = settlementEntries
      .filter((entry) =>
        entry.settlementId === settlement.id
        && entry.userId === settlement.debtorUserId
        && isDebtorPaymentLedgerEntry(entry.entryType),
      )
      .reduce(
        (sum, entry) => sum + parseStoredMoneyToMinor(String(entry.amount), currencyScale),
        0n,
      );
    return {
      ...settlement,
      totalAmount: String(settlement.totalAmount),
      confirmedPaidAmount: minorToDecimalString(paidMinor, currencyScale),
      remainingAmount: minorToDecimalString(originalMinor - paidMinor, currencyScale),
      payments: settlement.payments.map((payment) => {
        const refundedMinor = payment.refunds.reduce(
          (sum, refund) => sum + parseStoredMoneyToMinor(String(refund.amount), currencyScale),
          0n,
        );
        return {
          ...payment,
          amount: String(payment.amount),
          refundedAmount: minorToDecimalString(refundedMinor, currencyScale),
          refundableAmount: minorToDecimalString(
            parseStoredMoneyToMinor(String(payment.amount), currencyScale) - refundedMinor,
            currencyScale,
          ),
        };
      }),
    };
  });
  return {
    tripStatus: trip.status,
    currency: trip.baseCurrency,
    planRevision: trip.settlementRevision,
    balances: balances.map((member) => ({
      ...member,
      balance: minorToDecimalString(member.balanceMinor, trip.baseCurrency),
      balanceMinor: member.balanceMinor.toString(),
    })),
    settlements: settlementsWithTotals,
    paymentNotifications,
    closureRequests: await tx.auditLog.findMany({
      where: { tripId, entityType: 'TripClosureRequest', action: 'TRIP_CLOSURE_REQUESTED' },
      include: { user: { select: { fullName: true } } },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
    reviews: {
      pending: reviews.filter((review) => review.status === 'PENDING').length,
      disputed: reviews.filter((review) => review.status === 'DISPUTED').length,
      resolved: reviews.filter((review) => review.status === 'RESOLVED').length,
    },
  };
}

function isDebtorPaymentLedgerEntry(entryType: string) {
  return entryType === 'PAYMENT_DEBTOR'
    || entryType === 'DISPUTE_REVERSAL_PAYMENT_DEBTOR'
    || (entryType.startsWith('DISPUTE_REVERSAL_') && entryType.endsWith('_PAYMENT_DEBTOR'))
    || (entryType.startsWith('DISPUTE_RESOLUTION_') && entryType.endsWith('_PAYMENT_DEBTOR'))
    || entryType.startsWith('REFUND_PAYMENT_DEBTOR_');
}

async function lockSettlement(tx: Transaction, settlementId: string) {
  await tx.$queryRaw(Prisma.sql`SELECT ${ident('id')} FROM ${ident('Settlement')} WHERE ${ident('id')} = ${settlementId} FOR UPDATE`);
}

async function currentConfirmedAmount(tx: Transaction, settlementId: string, currency: string) {
  const settlement = await tx.settlement.findUniqueOrThrow({
    where: { id: settlementId },
    select: { debtorUserId: true },
  });
  const entries = await tx.$queryRaw<Array<{ amount: string; entryType: string }>>(Prisma.sql`
    SELECT CAST(${ident('amount')} AS ${moneyAsText}) AS amount, ${ident('entryType')}
    FROM ${ident('SettlementLedgerEntry')}
    WHERE ${ident('settlementId')} = ${settlementId} AND ${ident('userId')} = ${settlement.debtorUserId}
    FOR UPDATE
  `);
  return entries.reduce(
    (sum, entry) => {
      const type = entry.entryType;
      return isDebtorPaymentLedgerEntry(type)
        ? sum + parseStoredMoneyToMinor(String(entry.amount), currency)
        : sum;
    },
    0n,
  );
}

async function getPaymentLedgerNetMinor(
  tx: Transaction,
  paymentId: string,
  currency: string,
  debtorUserId: string,
) {
  const entries = await tx.$queryRaw<Array<{ amount: string; entryType: string }>>(Prisma.sql`
    SELECT CAST(${ident('amount')} AS ${moneyAsText}) AS amount, ${ident('entryType')}
    FROM ${ident('SettlementLedgerEntry')}
    WHERE ${ident('paymentId')} = ${paymentId} AND ${ident('userId')} = ${debtorUserId}
    FOR UPDATE
  `);
  return entries.reduce(
    (sum, entry) => isDebtorPaymentLedgerEntry(entry.entryType)
      ? sum + parseStoredMoneyToMinor(entry.amount, currency)
      : sum,
    0n,
  );
}

async function getOriginalPaymentNetMinor(
  tx: Transaction,
  paymentId: string,
  currency: string,
  debtorUserId: string,
) {
  const entries = await tx.$queryRaw<Array<{ amount: string; entryType: string }>>(Prisma.sql`
    SELECT CAST(${ident('amount')} AS ${moneyAsText}) AS amount, ${ident('entryType')}
    FROM ${ident('SettlementLedgerEntry')}
    WHERE ${ident('paymentId')} = ${paymentId}
      AND ${ident('userId')} = ${debtorUserId}
    FOR UPDATE
  `);
  return entries.reduce(
    (sum, entry) => entry.entryType === 'PAYMENT_DEBTOR'
      || entry.entryType.startsWith('REFUND_PAYMENT_DEBTOR_')
      ? sum + parseStoredMoneyToMinor(entry.amount, currency)
      : sum,
    0n,
  );
}

async function currentReservedAmount(tx: Transaction, settlementId: string, currency: string) {
  const attempts = await tx.$queryRaw<Array<{ amount: string }>>(Prisma.sql`
    SELECT CAST(${ident('amount')} AS ${moneyAsText}) AS amount
    FROM ${ident('SettlementPayment')}
    WHERE ${ident('settlementId')} = ${settlementId} AND ${ident('status')} = 'INITIATED'
    FOR UPDATE
  `);
  return attempts.reduce(
    (sum, payment) => sum + parseStoredMoneyToMinor(payment.amount, currency),
    0n,
  );
}

async function writePaymentLedger(tx: Transaction, paymentId: string, actorUserId: string) {
  const payment = await tx.settlementPayment.findUniqueOrThrow({
    where: { id: paymentId },
    include: { settlement: true },
  });
  const amount = String(payment.amount);
  const existing = await tx.settlementLedgerEntry.count({
    where: { paymentId, entryType: { in: ['PAYMENT_DEBTOR', 'PAYMENT_CREDITOR'] } },
  });
  if (existing === 2) return;
  if (existing !== 0) throw new FinancialInputError('Confirmed payment ledger is incomplete.');
  const entries = [
    {
      tripId: payment.settlement.tripId,
      settlementId: payment.settlementId,
      paymentId,
      userId: payment.settlement.debtorUserId,
      createdByUserId: actorUserId,
      entryType: 'PAYMENT_DEBTOR',
      amount,
      currency: payment.currency,
    },
    {
      tripId: payment.settlement.tripId,
      settlementId: payment.settlementId,
      paymentId,
      userId: payment.settlement.creditorUserId,
      createdByUserId: actorUserId,
      entryType: 'PAYMENT_CREDITOR',
      amount: minorToDecimalString(-parseStoredMoneyToMinor(amount, payment.currency), payment.currency),
      currency: payment.currency,
    },
  ];
  await tx.settlementLedgerEntry.createMany({ data: entries });
}

async function writePaymentLedgerAdjustment(
  tx: Transaction,
  paymentId: string,
  actorUserId: string,
  entryPrefix: string,
  debtorAdjustmentMinor: bigint,
) {
  const payment = await tx.settlementPayment.findUniqueOrThrow({
    where: { id: paymentId },
    include: { settlement: true },
  });
  if (debtorAdjustmentMinor === 0n) throw new FinancialInputError('A ledger adjustment cannot be zero.');
  await tx.settlementLedgerEntry.createMany({
    data: [
      {
        tripId: payment.settlement.tripId,
        settlementId: payment.settlementId,
        paymentId,
        userId: payment.settlement.debtorUserId,
        createdByUserId: actorUserId,
        entryType: `${entryPrefix}_PAYMENT_DEBTOR`,
        amount: minorToDecimalString(debtorAdjustmentMinor, payment.currency),
        currency: payment.currency,
      },
      {
        tripId: payment.settlement.tripId,
        settlementId: payment.settlementId,
        paymentId,
        userId: payment.settlement.creditorUserId,
        createdByUserId: actorUserId,
        entryType: `${entryPrefix}_PAYMENT_CREDITOR`,
        amount: minorToDecimalString(-debtorAdjustmentMinor, payment.currency),
        currency: payment.currency,
      },
    ],
  });
}

async function refreshSettlementStatuses(tx: Transaction, tripId: string, planRevision: number) {
  const settlements = await tx.settlement.findMany({
    where: { tripId, planRevision },
    include: { payments: true },
  });
  let anyPaid = false;
  let allPaid = true;
  for (const settlement of settlements) {
    const paid = await currentConfirmedAmount(tx, settlement.id, settlement.currency);
    const total = parseStoredMoneyToMinor(String(settlement.totalAmount), settlement.currency);
    if (paid > 0n) anyPaid = true;
    const outstanding = total - paid;
    if (outstanding > 0n) allPaid = false;
    await tx.settlement.update({
      where: { id: settlement.id },
      data: { status: outstanding === 0n ? 'SUCCESSFUL' : paid > 0n ? 'PARTIALLY_SETTLED' : 'PLANNED' },
    });
  }
  const status = allPaid ? 'FULLY_SETTLED' : anyPaid ? 'PARTIALLY_SETTLED' : 'PAYMENTS_PENDING';
  const trip = await tx.trip.findUniqueOrThrow({
    where: { id: tripId },
    select: { settlementRevision: true, status: true },
  });
  if (trip.settlementRevision === planRevision && trip.status !== 'TRIP_CLOSED') {
    await tx.trip.update({ where: { id: tripId }, data: { status } });
  }
}

export async function createPaymentAttempt(
  tx: Transaction,
  tripId: string,
  settlementId: string,
  actor: Actor,
  input: z.infer<typeof paymentAttemptSchema>,
) {
  assertPaymentIdempotencyKey(input.idempotencyKey);
  const existing = await tx.settlementPayment.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
    include: { settlement: { select: { id: true, debtorUserId: true, creditorUserId: true } } },
  });
  if (existing) {
    if (existing.settlementId !== settlementId
      || existing.submittedByUserId !== actor.userId
      || parseStoredMoneyToMinor(String(existing.amount), existing.currency)
        !== parseMoneyToMinor(input.amount, existing.currency)
      || existing.transactionReference !== input.transactionReference
      || existing.paymentMethod !== input.paymentMethod
      || existing.paymentDateTime?.getTime() !== new Date(input.paymentDateTime).getTime()
      || existing.paymentNotes !== input.paymentNotes) {
      throw new FinancialInputError('This idempotency key was already used for a different payment attempt.');
    }
    return {
      payment: existing,
      settlement: existing.settlement,
    };
  }

  const settlement = await tx.settlement.findFirst({
    where: { id: settlementId, tripId },
    include: { trip: { select: { status: true, settlementRevision: true } } },
  });
  if (!settlement) throw new FinancialInputError('Settlement not found.');
  if (actor.userId !== settlement.debtorUserId) throw new FinancialInputError('Only the debtor may initiate this transfer.');
  if (!['PAYMENTS_PENDING', 'PARTIALLY_SETTLED'].includes(settlement.trip.status)
    || settlement.planRevision !== settlement.trip.settlementRevision) {
    throw new FinancialInputError('This settlement plan is not accepting payment attempts.');
  }

  await lockSettlement(tx, settlementId);
  const retriedAttempt = await tx.settlementPayment.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
    include: { settlement: { select: { id: true, debtorUserId: true, creditorUserId: true } } },
  });
  if (retriedAttempt) {
    if (retriedAttempt.settlementId !== settlementId
      || retriedAttempt.submittedByUserId !== actor.userId
      || parseStoredMoneyToMinor(String(retriedAttempt.amount), retriedAttempt.currency)
        !== parseMoneyToMinor(input.amount, retriedAttempt.currency)
      || retriedAttempt.transactionReference !== input.transactionReference
      || retriedAttempt.paymentMethod !== input.paymentMethod
      || retriedAttempt.paymentDateTime?.getTime() !== new Date(input.paymentDateTime).getTime()
      || retriedAttempt.paymentNotes !== input.paymentNotes) {
      throw new FinancialInputError('This idempotency key was already used for a different payment attempt.');
    }
    return {
      payment: retriedAttempt,
      settlement: retriedAttempt.settlement,
    };
  }
  const lockedSettlement = await tx.settlement.findFirst({
    where: { id: settlementId, tripId },
    include: { trip: { select: { status: true, settlementRevision: true } } },
  });
  if (!lockedSettlement
    || lockedSettlement.planRevision !== lockedSettlement.trip.settlementRevision
    || !['PAYMENTS_PENDING', 'PARTIALLY_SETTLED'].includes(lockedSettlement.trip.status)) {
    throw new FinancialInputError('This settlement plan is no longer accepting payments.');
  }
  const amountMinor = parseMoneyToMinor(input.amount, settlement.currency);
  const totalMinor = parseStoredMoneyToMinor(String(settlement.totalAmount), settlement.currency);
  const confirmedMinor = await currentConfirmedAmount(tx, settlementId, settlement.currency);
  const reservedMinor = await currentReservedAmount(tx, settlementId, settlement.currency);
  if (amountMinor > totalMinor - confirmedMinor - reservedMinor) {
    throw new FinancialInputError('Payment amount exceeds the remaining settlement balance.');
  }

  const payment = await tx.settlementPayment.create({
    data: {
      settlementId,
      amount: minorToDecimalString(amountMinor, settlement.currency),
      currency: settlement.currency,
      status: 'INITIATED',
      transactionReference: input.transactionReference,
      paymentMethod: input.paymentMethod,
      paymentDateTime: new Date(input.paymentDateTime),
      paymentNotes: input.paymentNotes,
      idempotencyKey: input.idempotencyKey,
      submittedByUserId: actor.userId,
      debtorSubmittedAt: new Date(),
      initiatedAt: new Date(),
    },
  });
  await tx.settlementPaymentEvent.create({
    data: {
      paymentId: payment.id,
      idempotencyKey: `init:${input.idempotencyKey}`,
      actorUserId: actor.userId,
      action: 'DEBTOR_MARKED_PAID',
      details: {
        transactionReference: input.transactionReference,
        paymentMethod: input.paymentMethod,
        paymentDateTime: input.paymentDateTime,
      },
    },
  });
  await tx.notification.create({
    data: {
      tripId,
      userId: settlement.creditorUserId,
      dedupeKey: `settlement-payment-${payment.id}`,
      type: 'PAYMENT_INITIATED',
      title: 'Manual payment recorded',
      message: `A debtor recorded ${minorToDecimalString(amountMinor, settlement.currency)} ${settlement.currency} by ${input.paymentMethod.replace('_', ' ')}. Confirm receipt or dispute the record after checking your own payment history.`,
      metadata: { paymentId: payment.id, settlementId, debtorUserId: settlement.debtorUserId },
    },
  });
  await writeAudit(tx, tripId, actor.userId, 'SettlementPayment', payment.id, 'SETTLEMENT_PAYMENT_INITIATED', {
    settlementId,
    amount: String(payment.amount),
    paymentMethod: input.paymentMethod,
    paymentDateTime: input.paymentDateTime,
  });
  await enqueueTripEvent(tx, {
    tripId,
    eventKey: `settlement-payment:${payment.id}:submitted`,
    eventType: 'SETTLEMENT_PAYMENT_SUBMITTED',
    payload: {
      entityType: 'SettlementPayment',
      entityId: payment.id,
      actorUserId: actor.userId,
    },
  });
  return {
    payment,
    settlement: {
      id: settlement.id,
      debtorUserId: settlement.debtorUserId,
      creditorUserId: settlement.creditorUserId,
    },
  };
}

export async function confirmPaymentReceipt(
  tx: Transaction,
  tripId: string,
  paymentId: string,
  actor: Actor,
  idempotencyKey: string,
) {
  assertPaymentIdempotencyKey(idempotencyKey);
  const eventKey = `confirm:${idempotencyKey}`;
  const payment = await tx.settlementPayment.findFirst({
    where: { id: paymentId, settlement: { tripId } },
    include: {
      settlement: {
        include: { trip: { select: { status: true, settlementRevision: true } } },
      },
    },
  });
  if (!payment) throw new FinancialInputError('Payment attempt not found.');
  if (actor.userId !== payment.settlement.creditorUserId) {
    throw new FinancialInputError('Only the creditor may confirm receipt.');
  }
  if (
    payment.settlement.planRevision !== payment.settlement.trip.settlementRevision
    || !['PAYMENTS_PENDING', 'PARTIALLY_SETTLED'].includes(payment.settlement.trip.status)
  ) {
    throw new FinancialInputError('This payment belongs to an inactive settlement plan.');
  }
  await lockSettlement(tx, payment.settlementId);
  const [completedRetry] = await tx.$queryRaw<Array<{ paymentId: string }>>(Prisma.sql`
    SELECT ${ident('paymentId')} FROM ${ident('SettlementPaymentEvent')} WHERE ${ident('idempotencyKey')} = ${eventKey} FOR UPDATE
  `);
  const [lockedPayment] = await tx.$queryRaw<Array<{ status: SettlementPaymentStatus }>>(Prisma.sql`
    SELECT ${ident('status')} FROM ${ident('SettlementPayment')} WHERE ${ident('id')} = ${paymentId} FOR UPDATE
  `);
  if (completedRetry) {
    if (completedRetry.paymentId !== paymentId) throw new FinancialInputError('This idempotency key was already used.');
    return { ...payment, status: lockedPayment?.status ?? payment.status };
  }
  const totalMinor = parseStoredMoneyToMinor(String(payment.settlement.totalAmount), payment.currency);
  const confirmedMinor = await currentConfirmedAmount(tx, payment.settlementId, payment.currency);
  const attemptMinor = parseStoredMoneyToMinor(String(payment.amount), payment.currency);
  if (lockedPayment?.status !== 'INITIATED' || !payment.debtorSubmittedAt) {
    throw new FinancialInputError('Only a debtor-submitted payment can be confirmed.');
  }
  if (confirmedMinor + attemptMinor > totalMinor) {
    throw new FinancialInputError('Confirmation would exceed the outstanding settlement amount.');
  }

  const changed = await tx.settlementPayment.updateMany({
    where: { id: paymentId, status: 'INITIATED', creditorConfirmedAt: null },
    data: {
      status: 'SUCCESSFUL',
      creditorConfirmedAt: new Date(),
      confirmedByUserId: actor.userId,
      confirmedAt: new Date(),
      acknowledgementStatus: 'confirmed',
    },
  });
  if (changed.count !== 1) throw new FinancialInputError('This payment has already been confirmed or changed.');
  await tx.settlementPaymentEvent.create({
    data: {
      paymentId, idempotencyKey: eventKey, actorUserId: actor.userId, action: 'CREDITOR_CONFIRMED_RECEIPT',
    },
  });
  await writePaymentLedger(tx, paymentId, actor.userId);
  await writeAudit(tx, tripId, actor.userId, 'SettlementPayment', paymentId, 'SETTLEMENT_PAYMENT_CONFIRMED', {
    settlementId: payment.settlementId, amount: String(payment.amount),
  });
  await enqueueTripEvent(tx, {
    tripId,
    eventKey: `settlement-payment:${paymentId}:confirmed`,
    eventType: 'SETTLEMENT_PAYMENT_CONFIRMED',
    payload: {
      entityType: 'SettlementPayment',
      entityId: paymentId,
      actorUserId: actor.userId,
    },
  });
  await refreshSettlementStatuses(tx, tripId, payment.settlement.planRevision);
  return tx.settlementPayment.findUniqueOrThrow({ where: { id: paymentId } });
}

export async function markPaymentUnsuccessful(
  tx: Transaction,
  tripId: string,
  paymentId: string,
  actor: Actor,
  status: 'FAILED' | 'EXPIRED' | 'DECLINED',
  idempotencyKey: string,
  reason?: string,
) {
  assertPaymentIdempotencyKey(idempotencyKey);
  const eventKey = `unsuccessful:${idempotencyKey}`;
  const payment = await tx.settlementPayment.findFirst({
    where: { id: paymentId, settlement: { tripId } },
    include: { settlement: true },
  });
  if (!payment) throw new FinancialInputError('Payment attempt not found.');
  if (actor.userId !== payment.settlement.debtorUserId && actor.role !== 'OWNER' && actor.role !== 'ADMIN') {
    throw new FinancialInputError('Only the debtor, trip owner, or admin may update this attempt.');
  }
  await lockSettlement(tx, payment.settlementId);
  const [priorEvent] = await tx.$queryRaw<Array<{ paymentId: string; action: string }>>(Prisma.sql`
    SELECT ${ident('paymentId')}, ${ident('action')}
    FROM ${ident('SettlementPaymentEvent')}
    WHERE ${ident('idempotencyKey')} = ${eventKey}
    FOR UPDATE
  `);
  if (priorEvent) {
    if (priorEvent.paymentId !== paymentId || priorEvent.action !== status) {
      throw new FinancialInputError('This idempotency key was already used for a different action.');
    }
    return tx.settlementPayment.findUniqueOrThrow({ where: { id: paymentId } });
  }
  await tx.$queryRaw(Prisma.sql`SELECT ${ident('id')} FROM ${ident('SettlementPayment')} WHERE ${ident('id')} = ${paymentId} FOR UPDATE`);
  const changed = await tx.settlementPayment.updateMany({
    where: { id: paymentId, status: 'INITIATED' },
    data: { status, disputes: reason ?? null },
  });
  if (changed.count !== 1) {
    throw new FinancialInputError('Only an initiated payment can be marked unsuccessful.');
  }
  await tx.settlementPaymentEvent.create({
    data: { paymentId, idempotencyKey: `unsuccessful:${idempotencyKey}`, actorUserId: actor.userId, action: status, reason },
  });
  await writeAudit(tx, tripId, actor.userId, 'SettlementPayment', paymentId, `SETTLEMENT_PAYMENT_${status}`, { reason });
  await enqueueTripEvent(tx, {
    tripId,
    eventKey: `settlement-payment:${paymentId}:status:${idempotencyKey}`,
    eventType: 'SETTLEMENT_PAYMENT_STATUS_UPDATED',
    payload: {
      entityType: 'SettlementPayment',
      entityId: paymentId,
      actorUserId: actor.userId,
    },
  });
  return tx.settlementPayment.findUniqueOrThrow({ where: { id: paymentId } });
}

export async function disputePayment(
  tx: Transaction,
  tripId: string,
  paymentId: string,
  actor: Actor,
  reason: string,
  idempotencyKey: string,
) {
  assertPaymentIdempotencyKey(idempotencyKey);
  if (reason.trim().length < 3) throw new FinancialInputError('Explain why the payment is disputed.');
  const eventKey = `dispute:${idempotencyKey}`;
  const payment = await tx.settlementPayment.findFirst({
    where: { id: paymentId, settlement: { tripId } },
    include: { settlement: true },
  });
  if (!payment) throw new FinancialInputError('Payment attempt not found.');
  if (actor.userId !== payment.settlement.creditorUserId) {
    throw new FinancialInputError('Only the creditor may dispute this payment.');
  }
  const priorEvent = await tx.settlementPaymentEvent.findUnique({ where: { idempotencyKey: eventKey } });
  if (priorEvent) {
    if (priorEvent.paymentId !== paymentId) throw new FinancialInputError('This idempotency key was already used.');
    return;
  }
  await lockSettlement(tx, payment.settlementId);
  const [lockedPayment] = await tx.$queryRaw<Array<{ status: string }>>(Prisma.sql`
    SELECT ${ident('status')} FROM ${ident('SettlementPayment')} WHERE ${ident('id')} = ${paymentId} FOR UPDATE
  `);
  const priorEventAfterLock = await tx.settlementPaymentEvent.findUnique({ where: { idempotencyKey: eventKey } });
  if (priorEventAfterLock) {
    if (priorEventAfterLock.paymentId !== paymentId) throw new FinancialInputError('This idempotency key was already used.');
    return;
  }
  if (
    !lockedPayment
    || (lockedPayment.status !== 'INITIATED' && lockedPayment.status !== 'SUCCESSFUL')
  ) {
    throw new FinancialInputError('This payment cannot be disputed in its current state.');
  }
  const previousStatus = lockedPayment.status;
  const changed = await tx.settlementPayment.updateMany({
    where: { id: paymentId, status: previousStatus },
    data: { status: 'DISPUTED', disputedAt: new Date(), disputeReason: reason.trim() },
  });
  if (changed.count !== 1) throw new FinancialInputError('This payment can no longer be disputed.');
  const disputeEvent = await tx.settlementPaymentEvent.create({
    data: {
      paymentId, idempotencyKey: eventKey, actorUserId: actor.userId,
      action: 'PAYMENT_DISPUTED', reason: reason.trim(),
      details: { previousStatus },
    },
  });
  if (previousStatus === 'SUCCESSFUL') {
    const netMinor = await getPaymentLedgerNetMinor(tx, paymentId, payment.currency, payment.settlement.debtorUserId);
    if (netMinor > 0n) {
      await writePaymentLedgerAdjustment(
        tx,
        paymentId,
        actor.userId,
        `DISPUTE_REVERSAL_${disputeEvent.id}`,
        -netMinor,
      );
    }
  }
  await writeAudit(tx, tripId, actor.userId, 'SettlementPayment', paymentId, 'SETTLEMENT_PAYMENT_DISPUTED', {
    reason: reason.trim(),
    previousStatus,
  });
  await enqueueTripEvent(tx, {
    tripId,
    eventKey: `settlement-payment:${paymentId}:disputed:${idempotencyKey}`,
    eventType: 'SETTLEMENT_PAYMENT_DISPUTED',
    payload: {
      entityType: 'SettlementPayment',
      entityId: paymentId,
      actorUserId: actor.userId,
    },
  });
  await refreshSettlementStatuses(tx, tripId, payment.settlement.planRevision);
}

export async function resolvePaymentDispute(
  tx: Transaction,
  tripId: string,
  paymentId: string,
  actor: Actor,
  input: z.infer<typeof overridePaymentSchema>,
) {
  assertManager(actor);
  assertPaymentIdempotencyKey(input.idempotencyKey);
  const eventKey = `override:${input.idempotencyKey}`;
  const priorEvent = await tx.settlementPaymentEvent.findUnique({ where: { idempotencyKey: eventKey } });
  if (priorEvent) {
    if (priorEvent.paymentId !== paymentId) throw new FinancialInputError('This idempotency key was already used.');
    return;
  }
  const payment = await tx.settlementPayment.findFirst({
    where: { id: paymentId, settlement: { tripId } },
    include: { settlement: true },
  });
  if (!payment || payment.status !== 'DISPUTED') throw new FinancialInputError('No disputed payment exists.');
  await lockSettlement(tx, payment.settlementId);
  const [lockedPayment] = await tx.$queryRaw<Array<{ status: string }>>(Prisma.sql`
    SELECT ${ident('status')} FROM ${ident('SettlementPayment')} WHERE ${ident('id')} = ${paymentId} FOR UPDATE
  `);
  if (lockedPayment?.status !== 'DISPUTED') throw new FinancialInputError('No disputed payment exists.');
  const totalMinor = parseStoredMoneyToMinor(String(payment.settlement.totalAmount), payment.currency);
  const confirmedMinor = await currentConfirmedAmount(tx, payment.settlementId, payment.currency);
  const netMinor = await getPaymentLedgerNetMinor(tx, paymentId, payment.currency, payment.settlement.debtorUserId);
  const originalLedgerCount = await tx.settlementLedgerEntry.count({
    where: { paymentId, entryType: { in: ['PAYMENT_DEBTOR', 'PAYMENT_CREDITOR'] } },
  });
  const attemptMinor = parseStoredMoneyToMinor(String(payment.amount), payment.currency);
  const resolutionAmount = originalLedgerCount === 0
    ? attemptMinor
    : await getOriginalPaymentNetMinor(tx, paymentId, payment.currency, payment.settlement.debtorUserId);
  if (input.status === 'SUCCESSFUL' && confirmedMinor + (resolutionAmount - netMinor) > totalMinor) {
    throw new FinancialInputError('Resolution would exceed the settlement amount.');
  }
  const changed = await tx.settlementPayment.updateMany({
    where: { id: paymentId, status: 'DISPUTED' },
    data: {
      status: input.status,
      confirmedAt: input.status === 'SUCCESSFUL' ? new Date() : null,
      creditorConfirmedAt: input.status === 'SUCCESSFUL' ? new Date() : null,
      confirmedByUserId: actor.userId,
      acknowledgementStatus: input.status === 'SUCCESSFUL' ? 'overridden' : 'declined',
    },
  });
  if (changed.count !== 1) throw new FinancialInputError('The disputed payment was already resolved.');
  const resolutionEvent = await tx.settlementPaymentEvent.create({
    data: {
      paymentId,
      idempotencyKey: eventKey,
      actorUserId: actor.userId,
      action: `ADMIN_OVERRIDE_${input.status}`,
      reason: input.reason,
    },
  });
  if (input.status === 'SUCCESSFUL') {
    if (originalLedgerCount === 0) {
      await writePaymentLedger(tx, paymentId, actor.userId);
    } else if (netMinor < resolutionAmount) {
      await writePaymentLedgerAdjustment(
        tx,
        paymentId,
        actor.userId,
        `DISPUTE_RESOLUTION_${resolutionEvent.id}`,
        resolutionAmount - netMinor,
      );
    }
  } else if (netMinor > 0n) {
    await writePaymentLedgerAdjustment(tx, paymentId, actor.userId, `DISPUTE_REVERSAL_${resolutionEvent.id}`, netMinor);
  }
  await writeAudit(tx, tripId, actor.userId, 'SettlementPayment', paymentId, 'SETTLEMENT_PAYMENT_DISPUTE_RESOLVED', {
    status: input.status, reason: input.reason,
  });
  await enqueueTripEvent(tx, {
    tripId,
    eventKey: `settlement-payment:${paymentId}:resolved:${input.idempotencyKey}`,
    eventType: 'SETTLEMENT_PAYMENT_RESOLVED',
    payload: {
      entityType: 'SettlementPayment',
      entityId: paymentId,
      actorUserId: actor.userId,
    },
  });
  await refreshSettlementStatuses(tx, tripId, payment.settlement.planRevision);
}

export async function refundPayment(
  tx: Transaction,
  tripId: string,
  paymentId: string,
  actor: Actor,
  input: z.infer<typeof refundSchema>,
) {
  assertManager(actor);
  assertPaymentIdempotencyKey(input.idempotencyKey);
  const payment = await tx.settlementPayment.findFirst({
    where: { id: paymentId, settlement: { tripId } },
    include: { settlement: true, ledgerEntries: true },
  });
  if (!payment || payment.status !== 'SUCCESSFUL') throw new FinancialInputError('Only a successful payment can be refunded.');
  await lockSettlement(tx, payment.settlementId);
  const [lockedPayment] = await tx.$queryRaw<Array<{ status: string }>>(Prisma.sql`
    SELECT ${ident('status')} FROM ${ident('SettlementPayment')} WHERE ${ident('id')} = ${paymentId} FOR UPDATE
  `);
  const [retry] = await tx.$queryRaw<Array<{ id: string; paymentId: string }>>(Prisma.sql`
    SELECT ${ident('id')}, ${ident('paymentId')} FROM ${ident('SettlementRefund')} WHERE ${ident('idempotencyKey')} = ${input.idempotencyKey} FOR UPDATE
  `);
  if (retry) {
    if (retry.paymentId !== paymentId) throw new FinancialInputError('This idempotency key was already used.');
    return;
  }
  if (lockedPayment?.status !== 'SUCCESSFUL') {
    throw new FinancialInputError('Only a successful payment can be refunded.');
  }
  const previousRefunds = await tx.$queryRaw<Array<{ amount: string }>>(Prisma.sql`
    SELECT CAST(${ident('amount')} AS ${moneyAsText}) AS amount
    FROM ${ident('SettlementRefund')} WHERE ${ident('paymentId')} = ${paymentId} FOR UPDATE
  `);
  const refundedMinor = previousRefunds.reduce(
    (sum, refund) => sum + parseStoredMoneyToMinor(refund.amount, payment.currency),
    0n,
  );
  const paymentMinor = parseStoredMoneyToMinor(String(payment.amount), payment.currency);
  const refundMinor = parseMoneyToMinor(input.amount, payment.currency);
  if (refundMinor > paymentMinor - refundedMinor) {
    throw new FinancialInputError('Refund amount exceeds the unrefunded successful payment.');
  }
  const refund = await tx.settlementRefund.create({
    data: {
      paymentId,
      idempotencyKey: input.idempotencyKey,
      createdByUserId: actor.userId,
      amount: minorToDecimalString(refundMinor, payment.currency),
      currency: payment.currency,
      reason: input.reason,
    },
  });

  const originals = payment.ledgerEntries.filter((entry) =>
    ['PAYMENT_DEBTOR', 'PAYMENT_CREDITOR'].includes(entry.entryType),
  );
  if (originals.length !== 2) throw new FinancialInputError('Confirmed payment ledger is incomplete; refund was not applied.');
  const debtor = payment.settlement.debtorUserId;
  const creditor = payment.settlement.creditorUserId;
  await tx.settlementLedgerEntry.createMany({
    data: [
      {
        tripId, settlementId: payment.settlementId, paymentId, refundId: refund.id,
        userId: debtor, createdByUserId: actor.userId,
        entryType: `REFUND_PAYMENT_DEBTOR_${refund.id}`,
        amount: minorToDecimalString(-refundMinor, payment.currency), currency: payment.currency,
      },
      {
        tripId, settlementId: payment.settlementId, paymentId, refundId: refund.id,
        userId: creditor, createdByUserId: actor.userId,
        entryType: `REFUND_PAYMENT_CREDITOR_${refund.id}`,
        amount: minorToDecimalString(refundMinor, payment.currency), currency: payment.currency,
      },
    ],
  });
  const totalRefunded = refundedMinor + refundMinor;
  if (totalRefunded === paymentMinor) {
    await tx.settlementPayment.update({ where: { id: paymentId }, data: { status: 'REFUNDED' } });
  }
  const eventAction = totalRefunded === paymentMinor ? 'PAYMENT_REFUNDED' : 'PAYMENT_PARTIALLY_REFUNDED';
  await tx.settlementPaymentEvent.create({
    data: {
      paymentId,
      idempotencyKey: `refund:${input.idempotencyKey}`,
      actorUserId: actor.userId,
      action: eventAction,
      reason: input.reason,
      details: { refundId: refund.id, amount: input.amount },
    },
  });
  await writeAudit(tx, tripId, actor.userId, 'SettlementPayment', paymentId, 'SETTLEMENT_PAYMENT_REFUNDED', {
    reason: input.reason, amount: input.amount, refundId: refund.id,
  });
  await enqueueTripEvent(tx, {
    tripId,
    eventKey: `settlement-payment:${paymentId}:refunded:${input.idempotencyKey}`,
    eventType: 'SETTLEMENT_PAYMENT_REFUNDED',
    payload: {
      entityType: 'SettlementPayment',
      entityId: paymentId,
      actorUserId: actor.userId,
      relatedEntityId: refund.id,
    },
  });
  await refreshSettlementStatuses(tx, tripId, payment.settlement.planRevision);
}

export async function finalizeTrip(tx: Transaction, tripId: string, actor: Actor) {
  assertManager(actor);
  const trip = await tx.trip.findUnique({ where: { id: tripId }, select: { status: true, settlementRevision: true } });
  if (!trip) throw new FinancialInputError('Trip not found.');
  if (trip.status !== 'FULLY_SETTLED') throw new FinancialInputError('All settlement balances must be zero before trip closure.');
  const [currentSettlements, unresolvedPayments] = await Promise.all([
    tx.settlement.findMany({
      where: { tripId, planRevision: trip.settlementRevision },
      include: { payments: true },
    }),
    tx.settlementPayment.count({
      where: {
        settlement: { tripId, planRevision: trip.settlementRevision },
        status: 'DISPUTED',
      },
    }),
  ]);
  if (unresolvedPayments > 0) throw new FinancialInputError('Resolve all payment disputes before closing the trip.');
  for (const settlement of currentSettlements) {
    const confirmedMinor = await currentConfirmedAmount(tx, settlement.id, settlement.currency);
    if (confirmedMinor !== parseStoredMoneyToMinor(String(settlement.totalAmount), settlement.currency)) {
      throw new FinancialInputError('All settlement balances must be zero before trip closure.');
    }
  }
  const { balances } = await computeFinalBalances(tx, tripId);
  if (calculateSuggestedTransfers(balances).length) {
    throw new FinancialInputError('All member balances must be zero before trip closure.');
  }
  await tx.trip.update({ where: { id: tripId }, data: { status: 'TRIP_CLOSED' } });
  await tx.settlement.updateMany({
    where: { tripId, planRevision: trip.settlementRevision },
    data: { finalizedAt: new Date() },
  });
  await writeAudit(tx, tripId, actor.userId, 'Trip', tripId, 'TRIP_CLOSED');
  await enqueueTripStateEvent(tx, tripId, actor.userId, 'TRIP_CLOSED');
}

export async function reopenTrip(tx: Transaction, tripId: string, actor: Actor, reason: string) {
  if (actor.role !== 'OWNER') throw new FinancialInputError('Only the trip owner can reopen a finalized trip.');
  if (reason.trim().length < 3) throw new FinancialInputError('An explanation is required to reopen the trip.');
  const trip = await tx.trip.findUnique({
    where: { id: tripId },
    select: { status: true, settlementRevision: true },
  });
  if (!trip || trip.status !== 'TRIP_CLOSED') throw new FinancialInputError('Only a closed trip can be reopened.');
  await tx.settlement.updateMany({
    where: { tripId, planRevision: trip.settlementRevision, status: { not: 'SUCCESSFUL' } },
    data: { status: 'SUPERSEDED' },
  });
  await tx.trip.update({
    where: { id: tripId },
    data: { status: 'ACTIVE', settlementRevision: { increment: 1 } },
  });
  await writeAudit(tx, tripId, actor.userId, 'Trip', tripId, 'TRIP_REOPENED', {
    previousPlanRevision: trip.settlementRevision,
    nextPlanRevision: trip.settlementRevision + 1,
    reason: reason.trim(),
  });
  await enqueueTripStateEvent(tx, tripId, actor.userId, 'TRIP_REOPENED');
}

export function getOutstandingAmount(totalAmount: string, successfulPayments: string[], currency: string) {
  const total = parseStoredMoneyToMinor(totalAmount, currency);
  const paid = successfulPayments.reduce((sum, amount) => sum + parseStoredMoneyToMinor(amount, currency), 0n);
  if (paid > total) throw new FinancialInputError('Confirmed payments exceed the planned settlement.');
  return total - paid;
}

export function parseSettlementAmount(amount: string, currency: string) {
  return parseMoneyToMinor(amount, currency);
}
