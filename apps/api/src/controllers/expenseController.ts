import type { Response } from 'express';

import { prisma } from '../lib/prisma.js';
import type { TripAwareRequest } from '../middleware/tripAccess.js';
import {
  expenseCorrectionSchema,
  expenseInputSchema,
  expenseReversalSchema,
  correctExpense,
  createExpense,
  reverseExpense,
} from '../services/expenseService.js';
import { FinancialInputError, minorToDecimalString, parseStoredMoneyToMinor } from '../services/financialMath.js';

function toSingleString(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

function sendExpenseError(error: unknown, res: Response) {
  if (error instanceof FinancialInputError) {
    const status = error.message === 'Expense not found.' || error.message === 'Trip not found.' ? 404 : 400;
    res.status(status).json({ message: error.message });
    return;
  }
  throw error;
}

export async function listTripExpenses(req: TripAwareRequest, res: Response) {
  const tripId = toSingleString(req.params.tripId);
  const viewerId = req.tripMember!.userId;
  // Group spending is visible to the whole crew. A personal report is only
  // visible to the people it actually involves (who created it, who paid, and
  // who it was for) so nobody can browse another member's private ledger.
  const expenses = await prisma.expense.findMany({
    where: {
      tripId,
      OR: [
        { expenseType: 'GROUP' },
        { createdByUserId: viewerId },
        { payers: { some: { userId: viewerId } } },
        { allocations: { some: { userId: viewerId } } },
      ],
    },
    include: { payers: true, allocations: true },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
  });
  res.json({ expenses });
}

export async function createTripExpense(req: TripAwareRequest, res: Response) {
  const parsed = expenseInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Invalid expense payload.', issues: parsed.error.flatten() });
    return;
  }

  const tripId = toSingleString(req.params.tripId);
  const actor = req.tripMember!;
  if (actor.role === 'VIEWER') {
    res.status(403).json({ message: 'Viewers cannot create expenses.' });
    return;
  }

  try {
    const expense = await prisma.$transaction(async (tx) => {
      const settings = await tx.tripSetting.findUnique({ where: { tripId } });
      if (settings?.allowMemberExpenseEdit === false && !['OWNER', 'ADMIN'].includes(actor.role)) {
        throw new FinancialInputError('Trip settings do not allow members to add expenses.');
      }

      return createExpense(tx, tripId, actor.userId, parsed.data);
    });
    res.status(201).json({ expense });
  } catch (error) {
    sendExpenseError(error, res);
  }
}

export async function correctTripExpense(req: TripAwareRequest, res: Response) {
  const parsed = expenseCorrectionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Invalid expense correction payload.', issues: parsed.error.flatten() });
    return;
  }

  try {
    const expense = await prisma.$transaction((tx) =>
      correctExpense(
        tx,
        toSingleString(req.params.tripId),
        toSingleString(req.params.expenseId),
        req.tripMember!.userId,
        req.tripMember!.role,
        parsed.data.reason,
        parsed.data.replacement,
      ),
    );
    res.status(201).json({ expense });
  } catch (error) {
    sendExpenseError(error, res);
  }
}

export async function reverseTripExpense(req: TripAwareRequest, res: Response) {
  const parsed = expenseReversalSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Invalid expense reversal payload.', issues: parsed.error.flatten() });
    return;
  }

  try {
    const result = await prisma.$transaction((tx) =>
      reverseExpense(
        tx,
        toSingleString(req.params.tripId),
        toSingleString(req.params.expenseId),
        req.tripMember!.userId,
        req.tripMember!.role,
        parsed.data.reason,
      ),
    );
    res.json({ expense: result });
  } catch (error) {
    sendExpenseError(error, res);
  }
}

export async function getTripExpenseBalances(req: TripAwareRequest, res: Response) {
  const tripId = toSingleString(req.params.tripId);
  const trip = await prisma.trip.findUniqueOrThrow({
    where: { id: tripId },
    select: { baseCurrency: true },
  });
  const [members, entries, expenses] = await Promise.all([
    prisma.tripMember.findMany({
      where: { tripId },
      include: { user: { select: { id: true, fullName: true } } },
      orderBy: { joinedAt: 'asc' },
    }),
    prisma.financialEntry.findMany({
      where: { tripId },
      include: { reversalOf: { select: { entryType: true } } },
    }),
    prisma.expense.findMany({
      // Personal reports stay out of the shared trip total; only group spending
      // counts towards what the crew spent together.
      where: { tripId, status: 'ACTIVE', expenseType: 'GROUP' },
      select: { convertedAmount: true },
    }),
  ]);
  const byUser = new Map<string, { paid: bigint; responsibility: bigint; net: bigint }>();
  for (const entry of entries) {
    const current = byUser.get(entry.userId) ?? { paid: 0n, responsibility: 0n, net: 0n };
    const amount = parseStoredMoneyToMinor(String(entry.amount), trip.baseCurrency);
    current.net += amount;
    if (entry.entryType === 'PAYER_ADVANCE' || entry.reversalOf?.entryType === 'PAYER_ADVANCE') {
      current.paid += amount;
    } else if (entry.entryType === 'RESPONSIBILITY' || entry.reversalOf?.entryType === 'RESPONSIBILITY') {
      current.responsibility -= amount;
    }
    byUser.set(entry.userId, current);
  }

  const totalExpenseMinor = expenses.reduce(
    (total, expense) =>
      total + parseStoredMoneyToMinor(String(expense.convertedAmount ?? '0.00'), trip.baseCurrency),
    0n,
  );
  res.json({
    currency: trip.baseCurrency,
    totalExpenses: minorToDecimalString(totalExpenseMinor, trip.baseCurrency),
    members: members.map((member) => {
      const balance = byUser.get(member.userId) ?? { paid: 0n, responsibility: 0n, net: 0n };
      return {
        userId: member.userId,
        fullName: member.user.fullName,
        isActive: member.isActive,
        recordedAdvances: minorToDecimalString(balance.paid, trip.baseCurrency),
        responsibility: minorToDecimalString(balance.responsibility, trip.baseCurrency),
        netBalance: minorToDecimalString(balance.net, trip.baseCurrency),
      };
    }),
  });
}

export async function getTripExpenseHistory(req: TripAwareRequest, res: Response) {
  const tripId = toSingleString(req.params.tripId);
  const expenseId = toSingleString(req.params.expenseId);
  const expense = await prisma.expense.findFirst({
    where: { id: expenseId, tripId },
    select: { id: true },
  });
  if (!expense) {
    res.status(404).json({ message: 'Expense not found.' });
    return;
  }

  const history = await prisma.auditLog.findMany({
    where: { tripId, entityType: 'Expense', entityId: expenseId },
    include: { user: { select: { fullName: true } } },
    orderBy: { createdAt: 'asc' },
  });
  res.json({ history });
}
