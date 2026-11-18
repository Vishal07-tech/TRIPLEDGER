import type { Prisma, PrismaClient } from '@prisma/client';

import {
  FinancialInputError,
  minorToDecimalString,
  parseStoredMoneyToMinor,
} from './financialMath.js';
import { formatBudgetUtilization } from './budgetService.js';

type TransactionOrClient = PrismaClient | Prisma.TransactionClient;

export function formatPercentage(numeratorMinor: bigint, denominatorMinor: bigint): string {
  if (denominatorMinor <= 0n || numeratorMinor <= 0n) return '0.00';
  const scaled = (numeratorMinor * 10_000n + denominatorMinor / 2n) / denominatorMinor;
  const whole = scaled / 100n;
  const fraction = (scaled % 100n).toString().padStart(2, '0');
  return `${whole}.${fraction}`;
}

export function validateDateRange(
  startDateQuery?: string,
  endDateQuery?: string,
): { startDate: Date | null; endDate: Date | null; startDateStr: string | null; endDateStr: string | null } {
  let startDate: Date | null = null;
  let endDate: Date | null = null;

  if (startDateQuery && startDateQuery.trim()) {
    const s = startDateQuery.trim();
    const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(s);
    const dateObj = new Date(isDateOnly ? `${s}T00:00:00.000Z` : s);
    if (Number.isNaN(dateObj.getTime())) {
      throw new FinancialInputError('Invalid startDate format. Use YYYY-MM-DD or ISO 8601 string.');
    }
    startDate = dateObj;
  }

  if (endDateQuery && endDateQuery.trim()) {
    const s = endDateQuery.trim();
    const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(s);
    const dateObj = new Date(isDateOnly ? `${s}T23:59:59.999Z` : s);
    if (Number.isNaN(dateObj.getTime())) {
      throw new FinancialInputError('Invalid endDate format. Use YYYY-MM-DD or ISO 8601 string.');
    }
    endDate = dateObj;
  }

  if (startDate && endDate && startDate.getTime() > endDate.getTime()) {
    throw new FinancialInputError('startDate cannot be after endDate.');
  }

  return {
    startDate,
    endDate,
    startDateStr: startDate ? startDate.toISOString() : null,
    endDateStr: endDate ? endDate.toISOString() : null,
  };
}

function isDebtorPaymentLedgerEntry(entryType: string) {
  return (
    entryType === 'PAYMENT_DEBTOR' ||
    entryType === 'DISPUTE_REVERSAL_PAYMENT_DEBTOR' ||
    (entryType.startsWith('DISPUTE_REVERSAL_') && entryType.endsWith('_PAYMENT_DEBTOR')) ||
    (entryType.startsWith('DISPUTE_RESOLUTION_') && entryType.endsWith('_PAYMENT_DEBTOR')) ||
    entryType.startsWith('REFUND_PAYMENT_DEBTOR_')
  );
}

export type AnalyticsOptions = {
  startDate?: Date | null;
  endDate?: Date | null;
};

export async function getTripAnalyticsData(
  db: TransactionOrClient,
  tripId: string,
  options: AnalyticsOptions = {},
) {
  const trip = await db.trip.findUnique({
    where: { id: tripId },
    select: {
      id: true,
      name: true,
      baseCurrency: true,
      status: true,
      settlementRevision: true,
    },
  });

  if (!trip) {
    throw new FinancialInputError('Trip not found.');
  }

  const currency = trip.baseCurrency;
  const { startDate, endDate } = options;

  const dateFilter =
    startDate || endDate
      ? {
          ...(startDate ? { gte: startDate } : {}),
          ...(endDate ? { lte: endDate } : {}),
        }
      : undefined;

  const [activeExpenses, members, memberBudgets, settlements, settlementEntries, refunds] =
    await Promise.all([
      db.expense.findMany({
        where: {
          tripId,
          status: 'ACTIVE',
          ...(dateFilter ? { date: dateFilter } : {}),
        },
        include: {
          payers: true,
          allocations: true,
        },
        orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      }),
      db.tripMember.findMany({
        where: { tripId },
        include: {
          user: { select: { id: true, fullName: true, email: true } },
        },
        orderBy: { joinedAt: 'asc' },
      }),
      db.memberBudget.findMany({
        where: { tripId },
      }),
      db.settlement.findMany({
        where: { tripId, planRevision: trip.settlementRevision },
        include: {
          payments: {
            include: {
              refunds: { select: { amount: true } },
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      }),
      db.settlementLedgerEntry.findMany({
        where: { tripId },
        select: { settlementId: true, userId: true, entryType: true, amount: true },
      }),
      db.settlementRefund.findMany({
        where: { payment: { settlement: { tripId, planRevision: trip.settlementRevision } } },
        select: { amount: true },
      }),
    ]);

  const activeExpenseIds = activeExpenses.map((expense) => expense.id);

  // Authoritative financial entries for these active expenses
  const financialEntries =
    activeExpenseIds.length > 0
      ? await db.financialEntry.findMany({
          where: {
            tripId,
            expenseId: { in: activeExpenseIds },
          },
          select: {
            expenseId: true,
            userId: true,
            entryType: true,
            amount: true,
          },
        })
      : [];

  // All-time financial entries for all active expenses (for overall budget & total responsibility)
  const allActiveExpenses = await db.expense.findMany({
    where: { tripId, status: 'ACTIVE' },
    select: { id: true, convertedAmount: true, expenseType: true },
  });
  const allActiveExpenseIds = allActiveExpenses.map((expense) => expense.id);
  const allTimeFinancialEntries =
    allActiveExpenseIds.length > 0
      ? await db.financialEntry.findMany({
          where: {
            tripId,
            expenseId: { in: allActiveExpenseIds },
          },
          select: {
            expenseId: true,
            userId: true,
            entryType: true,
            amount: true,
          },
        })
      : [];

  // 1. Spending Summary & Personal vs Group
  let totalSpendingMinor = 0n;
  let groupSpendingMinor = 0n;
  let personalSpendingMinor = 0n;
  let groupCount = 0;
  let personalCount = 0;

  const expenseById = new Map(activeExpenses.map((exp) => [exp.id, exp]));

  for (const exp of activeExpenses) {
    const amountMinor = parseStoredMoneyToMinor(
      String(exp.convertedAmount ?? exp.amount),
      currency,
    );
    totalSpendingMinor += amountMinor;
    if (exp.expenseType === 'GROUP') {
      groupSpendingMinor += amountMinor;
      groupCount += 1;
    } else {
      personalSpendingMinor += amountMinor;
      personalCount += 1;
    }
  }

  // 2. Category Breakdown
  const categoryMap = new Map<
    string,
    {
      category: string;
      totalMinor: bigint;
      groupMinor: bigint;
      personalMinor: bigint;
      count: number;
    }
  >();

  for (const exp of activeExpenses) {
    const cat = exp.category;
    const existing = categoryMap.get(cat) ?? {
      category: cat,
      totalMinor: 0n,
      groupMinor: 0n,
      personalMinor: 0n,
      count: 0,
    };
    const amountMinor = parseStoredMoneyToMinor(
      String(exp.convertedAmount ?? exp.amount),
      currency,
    );
    existing.totalMinor += amountMinor;
    existing.count += 1;
    if (exp.expenseType === 'GROUP') {
      existing.groupMinor += amountMinor;
    } else {
      existing.personalMinor += amountMinor;
    }
    categoryMap.set(cat, existing);
  }

  const categoryBreakdown = [...categoryMap.values()]
    .sort((a, b) => (a.totalMinor > b.totalMinor ? -1 : a.totalMinor < b.totalMinor ? 1 : 0))
    .map((item) => ({
      category: item.category,
      amount: minorToDecimalString(item.totalMinor, currency),
      groupAmount: minorToDecimalString(item.groupMinor, currency),
      personalAmount: minorToDecimalString(item.personalMinor, currency),
      expenseCount: item.count,
      percentage: formatPercentage(item.totalMinor, totalSpendingMinor),
    }));

  // 3. Member-wise Payer Contributions and Financial Responsibility (from FinancialEntry)
  type MemberAgg = {
    paidMinor: bigint;
    responsibilityMinor: bigint;
    groupResponsibilityMinor: bigint;
    personalResponsibilityMinor: bigint;
  };

  const memberAggMap = new Map<string, MemberAgg>();
  for (const m of members) {
    memberAggMap.set(m.userId, {
      paidMinor: 0n,
      responsibilityMinor: 0n,
      groupResponsibilityMinor: 0n,
      personalResponsibilityMinor: 0n,
    });
  }

  for (const entry of financialEntries) {
    const agg = memberAggMap.get(entry.userId) ?? {
      paidMinor: 0n,
      responsibilityMinor: 0n,
      groupResponsibilityMinor: 0n,
      personalResponsibilityMinor: 0n,
    };
    const amount = parseStoredMoneyToMinor(String(entry.amount), currency);
    const exp = entry.expenseId ? expenseById.get(entry.expenseId) : undefined;

    if (entry.entryType === 'PAYER_ADVANCE') {
      agg.paidMinor += amount;
    } else if (entry.entryType === 'RESPONSIBILITY') {
      const resp = -amount;
      agg.responsibilityMinor += resp;
      if (exp?.expenseType === 'PERSONAL') {
        agg.personalResponsibilityMinor += resp;
      } else {
        agg.groupResponsibilityMinor += resp;
      }
    }
    memberAggMap.set(entry.userId, agg);
  }

  // All-time responsibility per member
  const allTimeResponsibilityMap = new Map<string, bigint>();
  for (const entry of allTimeFinancialEntries) {
    if (entry.entryType === 'RESPONSIBILITY') {
      const resp = -parseStoredMoneyToMinor(String(entry.amount), currency);
      allTimeResponsibilityMap.set(
        entry.userId,
        (allTimeResponsibilityMap.get(entry.userId) ?? 0n) + resp,
      );
    }
  }

  let totalPayerAdvancesMinor = 0n;
  let totalResponsibilityMinor = 0n;

  for (const agg of memberAggMap.values()) {
    totalPayerAdvancesMinor += agg.paidMinor;
    totalResponsibilityMinor += agg.responsibilityMinor;
  }

  const memberBreakdown = members.map((member) => {
    const agg = memberAggMap.get(member.userId) ?? {
      paidMinor: 0n,
      responsibilityMinor: 0n,
      groupResponsibilityMinor: 0n,
      personalResponsibilityMinor: 0n,
    };
    const netMinor = agg.paidMinor - agg.responsibilityMinor;
    const mb = memberBudgets.find((b) => b.userId === member.userId);

    return {
      userId: member.userId,
      fullName: member.user.fullName,
      email: member.user.email,
      role: member.role,
      isActive: member.isActive,
      payerContribution: minorToDecimalString(agg.paidMinor, currency),
      financialResponsibility: minorToDecimalString(agg.responsibilityMinor, currency),
      netBalance: minorToDecimalString(netMinor, currency),
      groupResponsibility: minorToDecimalString(agg.groupResponsibilityMinor, currency),
      personalExpenses: minorToDecimalString(agg.personalResponsibilityMinor, currency),
      budget: mb
        ? {
            plannedBudget: String(mb.plannedBudget),
            remainingBudget: String(mb.remainingBudget),
            utilizationPct: String(mb.utilizationPct ?? '0.00'),
            overspending: String(mb.overspending),
            warningLevel: mb.warningLevel,
          }
        : null,
    };
  });

  // 4. Budget Utilization & Comparison
  let totalPlannedBudgetMinor = 0n;
  let totalAllTimeResponsibilityMinor = 0n;
  let totalOverspendingMinor = 0n;

  const budgetMembers = members.map((member) => {
    const mb = memberBudgets.find((b) => b.userId === member.userId);
    const plannedMinor = mb
      ? parseStoredMoneyToMinor(String(mb.plannedBudget), currency)
      : member.budgetLimit
        ? parseStoredMoneyToMinor(String(member.budgetLimit), currency)
        : 0n;
    totalPlannedBudgetMinor += plannedMinor;

    const allTimeResp = allTimeResponsibilityMap.get(member.userId) ?? 0n;
    totalAllTimeResponsibilityMinor += allTimeResp;

    const remainingMinor = plannedMinor > 0n ? plannedMinor - allTimeResp : 0n;
    const overspendingMinor = plannedMinor > 0n && allTimeResp > plannedMinor ? allTimeResp - plannedMinor : 0n;
    totalOverspendingMinor += overspendingMinor;

    const utilizationPct = formatBudgetUtilization(plannedMinor, allTimeResp);
    const dateFilteredResp = memberAggMap.get(member.userId)?.responsibilityMinor ?? 0n;

    return {
      userId: member.userId,
      fullName: member.user.fullName,
      plannedBudget: minorToDecimalString(plannedMinor, currency),
      recordedResponsibility: minorToDecimalString(allTimeResp, currency),
      periodResponsibility: minorToDecimalString(dateFilteredResp, currency),
      remainingBudget: minorToDecimalString(remainingMinor, currency),
      overspending: minorToDecimalString(overspendingMinor, currency),
      utilizationPct,
      warningLevel: mb?.warningLevel ?? (utilizationPct === '100.00' || Number(utilizationPct) > 100 ? 'exceeded' : 'normal'),
      hasBudget: plannedMinor > 0n,
    };
  });

  const totalRemainingBudgetMinor =
    totalPlannedBudgetMinor > totalAllTimeResponsibilityMinor
      ? totalPlannedBudgetMinor - totalAllTimeResponsibilityMinor
      : 0n;

  const budgetUtilization = {
    totalPlannedBudget: minorToDecimalString(totalPlannedBudgetMinor, currency),
    totalActualSpending: minorToDecimalString(totalAllTimeResponsibilityMinor, currency),
    totalRemainingBudget: minorToDecimalString(totalRemainingBudgetMinor, currency),
    totalOverspending: minorToDecimalString(totalOverspendingMinor, currency),
    overallUtilizationPct: formatBudgetUtilization(
      totalPlannedBudgetMinor,
      totalAllTimeResponsibilityMinor,
    ),
    members: budgetMembers,
  };

  // 5. Settlement Overview
  let totalSettlementPlannedMinor = 0n;
  let totalSettlementPaidMinor = 0n;
  let totalSettlementPendingMinor = 0n;
  let completedCount = 0;

  for (const s of settlements) {
    const originalMinor = parseStoredMoneyToMinor(String(s.totalAmount), currency);
    totalSettlementPlannedMinor += originalMinor;

    const paidMinor = settlementEntries
      .filter(
        (entry) =>
          entry.settlementId === s.id &&
          entry.userId === s.debtorUserId &&
          isDebtorPaymentLedgerEntry(entry.entryType),
      )
      .reduce(
        (sum, entry) => sum + parseStoredMoneyToMinor(String(entry.amount), currency),
        0n,
      );

    totalSettlementPaidMinor += paidMinor;
    if (paidMinor >= originalMinor && originalMinor > 0n) {
      completedCount += 1;
    }

    for (const payment of s.payments) {
      if (payment.status === 'PENDING' || payment.status === 'INITIATED') {
        totalSettlementPendingMinor += parseStoredMoneyToMinor(String(payment.amount), currency);
      }
    }
  }

  const totalSettlementOutstandingMinor =
    totalSettlementPlannedMinor > totalSettlementPaidMinor
      ? totalSettlementPlannedMinor - totalSettlementPaidMinor
      : 0n;

  const totalSettlementRefundedMinor = refunds.reduce(
    (sum, r) => sum + parseStoredMoneyToMinor(String(r.amount), currency),
    0n,
  );

  const settlementOverview = {
    tripStatus: trip.status,
    planRevision: trip.settlementRevision,
    totalPlanned: minorToDecimalString(totalSettlementPlannedMinor, currency),
    totalPaid: minorToDecimalString(totalSettlementPaidMinor, currency),
    totalPending: minorToDecimalString(totalSettlementPendingMinor, currency),
    totalOutstanding: minorToDecimalString(totalSettlementOutstandingMinor, currency),
    totalRefunded: minorToDecimalString(totalSettlementRefundedMinor, currency),
    settlementCount: settlements.length,
    completedCount,
    isFullySettled:
      trip.status === 'FULLY_SETTLED' ||
      trip.status === 'TRIP_CLOSED' ||
      (settlements.length > 0 && completedCount === settlements.length),
  };

  // 6. Daily and Monthly Expense Trends
  const dailyMap = new Map<
    string,
    { date: string; amountMinor: bigint; groupMinor: bigint; personalMinor: bigint; count: number }
  >();
  const monthlyMap = new Map<
    string,
    { month: string; amountMinor: bigint; groupMinor: bigint; personalMinor: bigint; count: number }
  >();

  for (const exp of activeExpenses) {
    const dateStr = exp.date.toISOString().slice(0, 10);
    const monthStr = exp.date.toISOString().slice(0, 7);
    const amountMinor = parseStoredMoneyToMinor(
      String(exp.convertedAmount ?? exp.amount),
      currency,
    );

    const daily = dailyMap.get(dateStr) ?? {
      date: dateStr,
      amountMinor: 0n,
      groupMinor: 0n,
      personalMinor: 0n,
      count: 0,
    };
    daily.amountMinor += amountMinor;
    daily.count += 1;
    if (exp.expenseType === 'GROUP') {
      daily.groupMinor += amountMinor;
    } else {
      daily.personalMinor += amountMinor;
    }
    dailyMap.set(dateStr, daily);

    const monthly = monthlyMap.get(monthStr) ?? {
      month: monthStr,
      amountMinor: 0n,
      groupMinor: 0n,
      personalMinor: 0n,
      count: 0,
    };
    monthly.amountMinor += amountMinor;
    monthly.count += 1;
    if (exp.expenseType === 'GROUP') {
      monthly.groupMinor += amountMinor;
    } else {
      monthly.personalMinor += amountMinor;
    }
    monthlyMap.set(monthStr, monthly);
  }

  const dailyTrends = [...dailyMap.values()]
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .map((item) => ({
      date: item.date,
      amount: minorToDecimalString(item.amountMinor, currency),
      groupAmount: minorToDecimalString(item.groupMinor, currency),
      personalAmount: minorToDecimalString(item.personalMinor, currency),
      count: item.count,
    }));

  const monthlyTrends = [...monthlyMap.values()]
    .sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0))
    .map((item) => ({
      month: item.month,
      amount: minorToDecimalString(item.amountMinor, currency),
      groupAmount: minorToDecimalString(item.groupMinor, currency),
      personalAmount: minorToDecimalString(item.personalMinor, currency),
      count: item.count,
    }));

  return {
    tripId: trip.id,
    tripName: trip.name,
    baseCurrency: currency,
    dateRange: {
      startDate: startDate ? startDate.toISOString() : null,
      endDate: endDate ? endDate.toISOString() : null,
    },
    spendingSummary: {
      totalSpending: minorToDecimalString(totalSpendingMinor, currency),
      groupSpending: minorToDecimalString(groupSpendingMinor, currency),
      personalSpending: minorToDecimalString(personalSpendingMinor, currency),
      totalPayerAdvances: minorToDecimalString(totalPayerAdvancesMinor, currency),
      totalResponsibility: minorToDecimalString(totalResponsibilityMinor, currency),
      activeExpenseCount: activeExpenses.length,
      currency,
    },
    expenseTypes: {
      group: {
        amount: minorToDecimalString(groupSpendingMinor, currency),
        count: groupCount,
        percentage: formatPercentage(groupSpendingMinor, totalSpendingMinor),
      },
      personal: {
        amount: minorToDecimalString(personalSpendingMinor, currency),
        count: personalCount,
        percentage: formatPercentage(personalSpendingMinor, totalSpendingMinor),
      },
      total: {
        amount: minorToDecimalString(totalSpendingMinor, currency),
        count: activeExpenses.length,
      },
    },
    categoryBreakdown,
    memberBreakdown,
    budgetUtilization,
    settlementOverview,
    trends: {
      daily: dailyTrends,
      monthly: monthlyTrends,
    },
  };
}
