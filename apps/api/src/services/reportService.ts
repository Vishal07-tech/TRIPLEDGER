import type { Prisma, PrismaClient } from '@prisma/client';

import {
  FinancialInputError,
  minorToDecimalString,
  parseStoredMoneyToMinor,
} from './financialMath.js';
import { formatBudgetUtilization } from './budgetService.js';
import { formatPercentage, validateDateRange } from './analyticsService.js';

type TransactionOrClient = PrismaClient | Prisma.TransactionClient;

export type ReportType =
  | 'complete'
  | 'expenses'
  | 'members'
  | 'group-vs-personal'
  | 'budgets'
  | 'settlements';

export const reportTypes: ReportType[] = [
  'complete',
  'expenses',
  'members',
  'group-vs-personal',
  'budgets',
  'settlements',
];

export type ReportFilterOptions = {
  reportType?: ReportType;
  startDate?: Date | null;
  endDate?: Date | null;
  memberId?: string | null;
};

// ============================================================================
// CSV Formatting & Formula Injection Protection
// ============================================================================

export function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) {
    return '""';
  }
  let str = String(value);

  // Spreadsheet Formula Injection Protection (CSV Injection / CWE-1236):
  // If the cell begins with '=', '+', '-', '@', '\t', '\r', or '%' (or whitespace followed by these),
  // spreadsheet apps (Excel, Google Sheets, LibreOffice) might evaluate it as a formula or DDE command.
  // Exception: Safe negative numeric values like "-50.00" or "-100" are permitted.
  const trimmed = str.trimStart();
  const isSafeNegativeNumber = /^-\d+(\.\d+)?$/.test(trimmed);

  if (/^[=+@\t\r%]/.test(trimmed) || (trimmed.startsWith('-') && !isSafeNegativeNumber)) {
    str = `'${str}`;
  }

  // Escape any existing double quotes by doubling them
  const escaped = str.replace(/"/g, '""');
  return `"${escaped}"`;
}

export function toCsvString(headers: string[], rows: Array<Array<unknown>>): string {
  const headerLine = headers.map(escapeCsvCell).join(',');
  const rowLines = rows.map((row) => row.map(escapeCsvCell).join(','));
  return [headerLine, ...rowLines].join('\r\n');
}

// Helper for debtor payment ledger entries
function isDebtorPaymentLedgerEntry(entryType: string) {
  return (
    entryType === 'PAYMENT_DEBTOR' ||
    entryType === 'DISPUTE_REVERSAL_PAYMENT_DEBTOR' ||
    (entryType.startsWith('DISPUTE_REVERSAL_') && entryType.endsWith('_PAYMENT_DEBTOR')) ||
    (entryType.startsWith('DISPUTE_RESOLUTION_') && entryType.endsWith('_PAYMENT_DEBTOR')) ||
    entryType.startsWith('REFUND_PAYMENT_DEBTOR_')
  );
}

// ============================================================================
// Core Report Generation
// ============================================================================

export async function generateTripReportData(
  db: TransactionOrClient,
  tripId: string,
  options: ReportFilterOptions = {},
) {
  const reportType: ReportType = options.reportType && reportTypes.includes(options.reportType)
    ? options.reportType
    : 'complete';

  const { startDate, endDate, memberId } = options;

  const trip = await db.trip.findUnique({
    where: { id: tripId },
    select: {
      id: true,
      name: true,
      description: true,
      baseCurrency: true,
      status: true,
      settlementRevision: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!trip) {
    throw new FinancialInputError('Trip not found.');
  }

  const currency = trip.baseCurrency;

  // Build date query for expenses
  const dateFilter =
    startDate || endDate
      ? {
          ...(startDate ? { gte: startDate } : {}),
          ...(endDate ? { lte: endDate } : {}),
        }
      : undefined;

  // Fetch all related entities in parallel
  const [
    allExpenses,
    members,
    memberBudgets,
    settlements,
    settlementEntries,
    refunds,
    auditLogs,
  ] = await Promise.all([
    db.expense.findMany({
      where: {
        tripId,
        ...(dateFilter ? { date: dateFilter } : {}),
        ...(memberId
          ? {
              OR: [
                { payers: { some: { userId: memberId } } },
                { allocations: { some: { userId: memberId } } },
              ],
            }
          : {}),
      },
      include: {
        payers: true,
        allocations: true,
        correctedFrom: {
          select: { id: true, title: true, amount: true, currency: true, status: true },
        },
      },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
    }),
    db.tripMember.findMany({
      where: { tripId },
      include: {
        user: { select: { id: true, fullName: true } },
      },
      orderBy: { joinedAt: 'asc' },
    }),
    db.memberBudget.findMany({
      where: { tripId },
    }),
    db.settlement.findMany({
      where: { tripId },
      include: {
        payments: {
          include: {
            refunds: true,
            events: {
              select: { actorUserId: true, action: true, reason: true, createdAt: true },
              orderBy: { createdAt: 'asc' },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { createdAt: 'asc' },
    }),
    db.settlementLedgerEntry.findMany({
      where: { tripId },
      select: { settlementId: true, paymentId: true, userId: true, entryType: true, amount: true, createdAt: true },
    }),
    db.settlementRefund.findMany({
      where: { payment: { settlement: { tripId } } },
      select: {
        id: true,
        paymentId: true,
        amount: true,
        currency: true,
        reason: true,
        createdByUserId: true,
        createdAt: true,
        payment: {
          select: {
            settlementId: true,
            settlement: { select: { planRevision: true } },
          },
        },
      },
    }),
    db.auditLog.findMany({
      where: {
        tripId,
        OR: [
          {
            entityType: 'Expense',
            action: { in: ['EXPENSE_CREATED', 'EXPENSE_CORRECTED', 'EXPENSE_REVERSED'] },
          },
          {
            entityType: { in: ['Trip', 'SettlementPlan'] },
            action: { in: ['TRIP_REOPENED', 'TRIP_CLOSED', 'SETTLEMENT_PLAN_GENERATED'] },
          },
        ],
      },
      include: {
        user: { select: { fullName: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  const memberNameMap = new Map<string, string>();
  for (const m of members) {
    memberNameMap.set(m.userId, m.user.fullName);
  }

  // Active expenses vs Corrected vs Reversed
  const activeExpenses = allExpenses.filter((e) => e.status === 'ACTIVE');
  const correctedExpenses = allExpenses.filter((e) => e.status === 'CORRECTED');
  const reversedExpenses = allExpenses.filter((e) => e.status === 'REVERSED');

  const activeExpenseIds = activeExpenses.map((e) => e.id);

  // Financial ledger entries for active expenses in range
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

  // All-time financial entries for member budget & net balance tracking
  const allActiveExpensesAllTime = await db.expense.findMany({
    where: { tripId, status: 'ACTIVE' },
    select: { id: true },
  });
  const allActiveIds = allActiveExpensesAllTime.map((e) => e.id);
  const allTimeFinancialEntries =
    allActiveIds.length > 0
      ? await db.financialEntry.findMany({
          where: {
            tripId,
            expenseId: { in: allActiveIds },
          },
          select: {
            expenseId: true,
            userId: true,
            entryType: true,
            amount: true,
          },
        })
      : [];

  // ==========================================================================
  // Calculations: Spending & Personal vs Group
  // ==========================================================================
  let totalSpendingMinor = 0n;
  let groupSpendingMinor = 0n;
  let personalSpendingMinor = 0n;
  let groupCount = 0;
  let personalCount = 0;

  const categoryMap = new Map<
    string,
    { category: string; totalMinor: bigint; groupMinor: bigint; personalMinor: bigint; count: number }
  >();

  const activeExpenseMap = new Map(activeExpenses.map((e) => [e.id, e]));

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

    const cat = exp.category;
    const catEntry = categoryMap.get(cat) ?? {
      category: cat,
      totalMinor: 0n,
      groupMinor: 0n,
      personalMinor: 0n,
      count: 0,
    };
    catEntry.totalMinor += amountMinor;
    catEntry.count += 1;
    if (exp.expenseType === 'GROUP') {
      catEntry.groupMinor += amountMinor;
    } else {
      catEntry.personalMinor += amountMinor;
    }
    categoryMap.set(cat, catEntry);
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

  // ==========================================================================
  // Calculations: Member Payer Advances & Responsibilities
  // ==========================================================================
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
    const exp = entry.expenseId ? activeExpenseMap.get(entry.expenseId) : undefined;

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

  // All-time responsibility for budgets
  const allTimeRespMap = new Map<string, bigint>();
  for (const entry of allTimeFinancialEntries) {
    if (entry.entryType === 'RESPONSIBILITY') {
      const resp = -parseStoredMoneyToMinor(String(entry.amount), currency);
      allTimeRespMap.set(entry.userId, (allTimeRespMap.get(entry.userId) ?? 0n) + resp);
    }
  }

  const memberFinancialList = members.map((m) => {
    const agg = memberAggMap.get(m.userId) ?? {
      paidMinor: 0n,
      responsibilityMinor: 0n,
      groupResponsibilityMinor: 0n,
      personalResponsibilityMinor: 0n,
    };
    const netMinor = agg.paidMinor - agg.responsibilityMinor;
    const mb = memberBudgets.find((b) => b.userId === m.userId);

    return {
      userId: m.userId,
      fullName: m.user.fullName,
      role: m.role,
      isActive: m.isActive,
      payerContribution: minorToDecimalString(agg.paidMinor, currency),
      financialResponsibility: minorToDecimalString(agg.responsibilityMinor, currency),
      groupResponsibility: minorToDecimalString(agg.groupResponsibilityMinor, currency),
      personalExpenses: minorToDecimalString(agg.personalResponsibilityMinor, currency),
      netBalance: minorToDecimalString(netMinor, currency),
      plannedBudget: mb
        ? minorToDecimalString(parseStoredMoneyToMinor(String(mb.plannedBudget), currency), currency)
        : m.budgetLimit
          ? minorToDecimalString(parseStoredMoneyToMinor(String(m.budgetLimit), currency), currency)
          : null,
      remainingBudget: mb
        ? minorToDecimalString(parseStoredMoneyToMinor(String(mb.remainingBudget), currency), currency)
        : null,
      utilizationPct: mb ? String(mb.utilizationPct ?? '0.00') : null,
      warningLevel: mb?.warningLevel ?? 'normal',
    };
  });

  // Filter member report if requested
  const filteredMemberList = memberId
    ? memberFinancialList.filter((m) => m.userId === memberId)
    : memberFinancialList;

  // ==========================================================================
  // Calculations: Budget Utilization
  // ==========================================================================
  const budgetMemberList = members.map((m) => {
    const mb = memberBudgets.find((b) => b.userId === m.userId);
    const plannedMinor = mb
      ? parseStoredMoneyToMinor(String(mb.plannedBudget), currency)
      : m.budgetLimit
        ? parseStoredMoneyToMinor(String(m.budgetLimit), currency)
        : 0n;

    const allTimeResp = allTimeRespMap.get(m.userId) ?? 0n;

    const remainingMinor = plannedMinor > 0n ? (plannedMinor > allTimeResp ? plannedMinor - allTimeResp : 0n) : 0n;
    const overspendingMinor = plannedMinor > 0n && allTimeResp > plannedMinor ? allTimeResp - plannedMinor : 0n;

    const utilizationPct = formatBudgetUtilization(plannedMinor, allTimeResp);
    const dateFilteredResp = memberAggMap.get(m.userId)?.responsibilityMinor ?? 0n;

    return {
      userId: m.userId,
      fullName: m.user.fullName,
      plannedBudget: minorToDecimalString(plannedMinor, currency),
      recordedResponsibility: minorToDecimalString(allTimeResp, currency),
      periodResponsibility: minorToDecimalString(dateFilteredResp, currency),
      remainingBudget: minorToDecimalString(remainingMinor, currency),
      overspending: minorToDecimalString(overspendingMinor, currency),
      utilizationPct,
      warningLevel: mb?.warningLevel ?? (Number(utilizationPct) >= 100 ? 'exceeded' : 'normal'),
      hasBudget: plannedMinor > 0n,
    };
  });

  const reportBudgetMembers = memberId
    ? budgetMemberList.filter((member) => member.userId === memberId)
    : budgetMemberList;
  const reportBudgetTotals = reportBudgetMembers.reduce(
    (totals, member) => ({
      planned: totals.planned + parseStoredMoneyToMinor(member.plannedBudget, currency),
      actual: totals.actual + parseStoredMoneyToMinor(member.recordedResponsibility, currency),
      remaining: totals.remaining + parseStoredMoneyToMinor(member.remainingBudget, currency),
      overspending: totals.overspending + parseStoredMoneyToMinor(member.overspending, currency),
    }),
    { planned: 0n, actual: 0n, remaining: 0n, overspending: 0n },
  );
  const budgetSummary = {
    totalPlannedBudget: minorToDecimalString(reportBudgetTotals.planned, currency),
    totalActualSpending: minorToDecimalString(reportBudgetTotals.actual, currency),
    totalRemainingBudget: minorToDecimalString(reportBudgetTotals.remaining, currency),
    totalOverspending: minorToDecimalString(reportBudgetTotals.overspending, currency),
    overallUtilizationPct: formatBudgetUtilization(reportBudgetTotals.planned, reportBudgetTotals.actual),
    members: reportBudgetMembers,
  };

  // ==========================================================================
  // Calculations: Settlements & Refunds
  // ==========================================================================
  let totalSettlementPlannedMinor = 0n;
  let totalSettlementPaidMinor = 0n;
  let totalSettlementPendingMinor = 0n;
  let completedCount = 0;
  const memberSettlementNet = new Map<string, bigint>();

  const settlementHistory = settlements
    .filter((s) => !memberId || s.debtorUserId === memberId || s.creditorUserId === memberId)
    .map((s) => {
    const originalMinor = parseStoredMoneyToMinor(String(s.totalAmount), currency);
    const isCurrentRevision = s.planRevision === trip.settlementRevision;
    if (isCurrentRevision) totalSettlementPlannedMinor += originalMinor;

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

    if (isCurrentRevision) {
      totalSettlementPaidMinor += paidMinor;
      if (paidMinor >= originalMinor && originalMinor > 0n) {
        completedCount += 1;
      }
    }

    const remainingMinor = originalMinor > paidMinor ? originalMinor - paidMinor : 0n;
    if (isCurrentRevision) {
      memberSettlementNet.set(
        s.debtorUserId,
        (memberSettlementNet.get(s.debtorUserId) ?? 0n) - remainingMinor,
      );
      memberSettlementNet.set(
        s.creditorUserId,
        (memberSettlementNet.get(s.creditorUserId) ?? 0n) + remainingMinor,
      );
    }

    for (const payment of s.payments) {
      if (isCurrentRevision && (payment.status === 'PENDING' || payment.status === 'INITIATED')) {
        totalSettlementPendingMinor += parseStoredMoneyToMinor(String(payment.amount), currency);
      }
    }

    return {
      id: s.id,
      debtorUserId: s.debtorUserId,
      debtorName: memberNameMap.get(s.debtorUserId) ?? 'Debtor',
      creditorUserId: s.creditorUserId,
      creditorName: memberNameMap.get(s.creditorUserId) ?? 'Creditor',
      planRevision: s.planRevision,
      createdAt: s.createdAt.toISOString(),
      createdByUserId: s.createdByUserId,
      totalAmount: minorToDecimalString(originalMinor, currency),
      confirmedPaidAmount: minorToDecimalString(paidMinor, currency),
      remainingAmount: minorToDecimalString(remainingMinor, currency),
      status: remainingMinor === 0n ? 'COMPLETED' : s.status,
      payments: s.payments.map((p) => {
        const refundedMinor = p.refunds.reduce(
          (sum, r) => sum + parseStoredMoneyToMinor(String(r.amount), currency),
          0n,
        );
        return {
          id: p.id,
          amount: minorToDecimalString(
            parseStoredMoneyToMinor(String(p.amount), p.currency),
            p.currency,
          ),
          currency: p.currency,
          paymentMethod: p.paymentMethod,
          paymentDateTime: p.paymentDateTime ? p.paymentDateTime.toISOString() : null,
          transactionReference: p.transactionReference,
          paymentNotes: p.paymentNotes,
          status: p.status,
          refundedAmount: minorToDecimalString(refundedMinor, currency),
          submittedByUserId: p.submittedByUserId,
          confirmedByUserId: p.confirmedByUserId,
          createdAt: p.createdAt.toISOString(),
          debtorSubmittedAt: p.debtorSubmittedAt ? p.debtorSubmittedAt.toISOString() : null,
          creditorConfirmedAt: p.creditorConfirmedAt ? p.creditorConfirmedAt.toISOString() : null,
          disputedAt: p.disputedAt ? p.disputedAt.toISOString() : null,
          disputeReason: p.disputeReason,
          events: p.events.map((event) => ({
            actorUserId: event.actorUserId,
            action: event.action,
            reason: event.reason,
            createdAt: event.createdAt.toISOString(),
          })),
          refunds: p.refunds.map((refund) => ({
            id: refund.id,
            amount: minorToDecimalString(
              parseStoredMoneyToMinor(String(refund.amount), refund.currency),
              refund.currency,
            ),
            currency: refund.currency,
            reason: refund.reason,
            createdByUserId: refund.createdByUserId,
            createdAt: refund.createdAt.toISOString(),
          })),
        };
      }),
    };
  });

  const detailedSettlements = settlementHistory.filter(
    (settlement) => settlement.planRevision === trip.settlementRevision,
  );

  const totalSettlementOutstandingMinor =
    totalSettlementPlannedMinor > totalSettlementPaidMinor
      ? totalSettlementPlannedMinor - totalSettlementPaidMinor
      : 0n;

  const reportSettlementIds = new Set(settlementHistory.map((settlement) => settlement.id));
  const visibleRefunds = refunds.filter((refund) =>
    reportSettlementIds.has(refund.payment.settlementId),
  );
  const currentRefunds = visibleRefunds.filter(
    (refund) => refund.payment.settlement.planRevision === trip.settlementRevision,
  );
  const totalSettlementRefundedMinor = currentRefunds.reduce(
    (sum, refund) => sum + parseStoredMoneyToMinor(String(refund.amount), currency),
    0n,
  );

  const membersWithSettlementBalances = filteredMemberList.map((member) => {
    const netMinor = memberSettlementNet.get(member.userId) ?? 0n;
    const payableMinor = netMinor < 0n ? -netMinor : 0n;
    const receivableMinor = netMinor > 0n ? netMinor : 0n;
    return {
      ...member,
      settlementOutstandingPayable: minorToDecimalString(payableMinor, currency),
      settlementOutstandingReceivable: minorToDecimalString(receivableMinor, currency),
      settlementBalance: minorToDecimalString(netMinor, currency),
    };
  });

  const settlementOverview = {
    tripStatus: trip.status,
    planRevision: trip.settlementRevision,
    totalPlanned: minorToDecimalString(totalSettlementPlannedMinor, currency),
    totalPaid: minorToDecimalString(totalSettlementPaidMinor, currency),
    totalPending: minorToDecimalString(totalSettlementPendingMinor, currency),
    totalOutstanding: minorToDecimalString(totalSettlementOutstandingMinor, currency),
    totalRefunded: minorToDecimalString(totalSettlementRefundedMinor, currency),
    settlementCount: detailedSettlements.length,
    completedCount,
    isFullySettled:
      trip.status === 'FULLY_SETTLED' ||
      trip.status === 'TRIP_CLOSED' ||
      (detailedSettlements.length > 0 && completedCount === detailedSettlements.length),
    settlements: detailedSettlements,
    history: settlementHistory,
    refunds: visibleRefunds.map((r) => ({
      id: r.id,
      paymentId: r.paymentId,
      amount: minorToDecimalString(
        parseStoredMoneyToMinor(String(r.amount), r.currency),
        r.currency,
      ),
      currency: r.currency,
      reason: r.reason,
      createdByUserId: r.createdByUserId,
      planRevision: r.payment.settlement.planRevision,
      createdAt: r.createdAt.toISOString(),
    })),
  };

  // ==========================================================================
  // Formatted Detailed Expenses List
  // ==========================================================================
  const expenseDetailList = allExpenses.map((exp) => {
    return {
      id: exp.id,
      title: exp.title,
      description: exp.description,
      status: exp.status,
      category: exp.category,
      expenseType: exp.expenseType,
      splitMethod: exp.splitMethod,
      paymentMethod: exp.paymentMethod,
      date: exp.date.toISOString(),
      originalAmount: minorToDecimalString(
        parseStoredMoneyToMinor(String(exp.amount), exp.currency),
        exp.currency,
      ),
      originalCurrency: exp.currency,
      exchangeRate: exp.exchangeRate ? String(exp.exchangeRate) : null,
      convertedAmount: minorToDecimalString(
        parseStoredMoneyToMinor(String(exp.convertedAmount ?? exp.amount), currency),
        currency,
      ),
      baseCurrency: currency,
      correctedFromExpenseId: exp.correctedFromExpenseId,
      correctedFrom: exp.correctedFrom
        ? {
            id: exp.correctedFrom.id,
            title: exp.correctedFrom.title,
            status: exp.correctedFrom.status,
          }
        : null,
      createdByUserId: exp.createdByUserId,
      updatedByUserId: exp.updatedByUserId,
      payers: exp.payers.map((p) => ({
        userId: p.userId,
        fullName: memberNameMap.get(p.userId) ?? 'Member',
        amount: minorToDecimalString(
          parseStoredMoneyToMinor(String(p.amount), p.currency),
          p.currency,
        ),
        currency: p.currency,
        paymentStatus: p.paymentStatus,
        paidAt: p.paidAt?.toISOString() ?? null,
      })),
      allocations: exp.allocations.map((a) => ({
        userId: a.userId,
        fullName: memberNameMap.get(a.userId) ?? 'Member',
        allocatedAmount: minorToDecimalString(
          parseStoredMoneyToMinor(String(a.allocatedAmount), exp.currency),
          exp.currency,
        ),
        currency: exp.currency,
      })),
      createdAt: exp.createdAt.toISOString(),
    };
  });

  return {
    meta: {
      reportType,
      generatedAt: new Date().toISOString(),
      tripId: trip.id,
      tripName: trip.name,
      tripDescription: trip.description,
      tripStatus: trip.status,
      baseCurrency: currency,
      settlementRevision: trip.settlementRevision,
      dateRange: {
        startDate: startDate ? startDate.toISOString() : null,
        endDate: endDate ? endDate.toISOString() : null,
      },
      memberFilter: memberId
        ? { id: memberId, name: memberNameMap.get(memberId) ?? 'Member' }
        : null,
      notes: [
        'Authoritative source: MySQL financial ledger and double-entry accounting entries.',
        'Payer advances and split responsibilities are tracked independently.',
        'Personal expenses are isolated and do not enter group responsibility splits.',
        'Settlement payments are peer-to-peer transfers and are never counted as trip expenses.',
        'Payer and settlement records are member-recorded without direct banking integration.',
      ],
    },
    spendingSummary: {
      totalSpending: minorToDecimalString(totalSpendingMinor, currency),
      groupSpending: minorToDecimalString(groupSpendingMinor, currency),
      personalSpending: minorToDecimalString(personalSpendingMinor, currency),
      activeExpenseCount: activeExpenses.length,
      correctedExpenseCount: correctedExpenses.length,
      reversedExpenseCount: reversedExpenses.length,
      totalExpenseRecords: allExpenses.length,
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
    },
    categories: categoryBreakdown,
    members: membersWithSettlementBalances,
    availableMembers: members.map((member) => ({
      userId: member.userId,
      fullName: member.user.fullName,
      isActive: member.isActive,
    })),
    budgets: budgetSummary,
    settlements: settlementOverview,
    expenses: expenseDetailList,
    auditHistory: auditLogs.map((log) => ({
      id: log.id,
      action: log.action,
      entityId: log.entityId,
      actorName: log.user?.fullName ?? 'System',
      details: log.details,
      createdAt: log.createdAt.toISOString(),
    })),
  };
}

// ============================================================================
// CSV Export Builders (Formula-Injection Protected)
// ============================================================================

export type GeneratedReport = Awaited<ReturnType<typeof generateTripReportData>>;

export function buildCsvExport(report: GeneratedReport): { filename: string; content: string } {
  const tripSlug = report.meta.tripName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'trip';
  const timestamp = new Date().toISOString().slice(0, 10);
  const type = report.meta.reportType;
  const currency = report.meta.baseCurrency;

  switch (type) {
    case 'expenses': {
      const filename = `${tripSlug}-expense-history-${timestamp}.csv`;
      const headers = [
        'Date',
        'Title',
        'Status',
        'Category',
        'Type',
        'Payment Method',
        'Split Method',
        'Original Amount',
        'Currency',
        'Exchange Rate',
        `Converted Amount (${currency})`,
        'Paid By',
        'Responsible Members',
        'Correction Source',
        'Description',
        'Expense ID',
        'Corrected From ID',
      ];
      const rows = report.expenses.map((e) => [
        e.date.slice(0, 10),
        e.title,
        e.status,
        e.category,
        e.expenseType,
        e.paymentMethod,
        e.splitMethod,
        e.originalAmount,
        e.originalCurrency,
        e.exchangeRate ?? '1.00',
        e.convertedAmount,
        e.payers.map((p) =>
          `${p.fullName}: ${p.amount} (${p.paymentStatus}${p.paidAt ? ` at ${p.paidAt}` : ''})`,
        ).join('; '),
        e.allocations.map((a) => `${a.fullName}: ${a.allocatedAmount} ${a.currency}`).join('; '),
        e.correctedFrom?.title ?? '',
        e.description ?? '',
        e.id,
        e.correctedFromExpenseId ?? '',
      ]);
      for (const audit of report.auditHistory.filter((entry) => entry.action.startsWith('EXPENSE_'))) {
        rows.push([
          audit.createdAt,
          `Expense history ${audit.action}`,
          'AUDIT',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          `Actor: ${audit.actorName}`,
          '',
          '',
          JSON.stringify(audit.details ?? ''),
          audit.entityId,
          '',
        ]);
      }
      return { filename, content: toCsvString(headers, rows) };
    }

    case 'members': {
      const filename = `${tripSlug}-member-financials-${timestamp}.csv`;
      const headers = [
        'Member Name',
        'Role',
        'Status',
        `Planned Budget (${currency})`,
        `Payer Advances (${currency})`,
        `Financial Responsibility (${currency})`,
        `Group Share (${currency})`,
        `Personal Expenses (${currency})`,
        `Expense Net Balance (${currency})`,
        `Settlement Payable (${currency})`,
        `Settlement Receivable (${currency})`,
        `Settlement Net Balance (${currency})`,
        'Utilization %',
        'Warning Level',
      ];
      const rows = report.members.map((m) => [
        m.fullName,
        m.role,
        m.isActive ? 'Active' : 'Inactive',
        m.plannedBudget ?? 'None',
        m.payerContribution,
        m.financialResponsibility,
        m.groupResponsibility,
        m.personalExpenses,
        m.netBalance,
        m.settlementOutstandingPayable,
        m.settlementOutstandingReceivable,
        m.settlementBalance,
        m.utilizationPct ? `${m.utilizationPct}%` : '0.00%',
        m.warningLevel,
      ]);
      return { filename, content: toCsvString(headers, rows) };
    }

    case 'group-vs-personal': {
      const filename = `${tripSlug}-group-vs-personal-${timestamp}.csv`;
      const headers = [
        'Category',
        `Total Spending (${currency})`,
        `Group Expenses (${currency})`,
        `Personal Expenses (${currency})`,
        '% of Total',
        'Expense Count',
      ];
      const rows = report.categories.map((c) => [
        c.category,
        c.amount,
        c.groupAmount,
        c.personalAmount,
        `${c.percentage}%`,
        c.expenseCount,
      ]);
      // Append summary section
      rows.push([
        '--- TOTAL SUMMARY ---',
        report.spendingSummary.totalSpending,
        report.spendingSummary.groupSpending,
        report.spendingSummary.personalSpending,
        '100.00%',
        report.spendingSummary.activeExpenseCount,
      ]);
      return { filename, content: toCsvString(headers, rows) };
    }

    case 'budgets': {
      const filename = `${tripSlug}-budget-utilization-${timestamp}.csv`;
      const headers = [
        'Member Name',
        `Planned Budget (${currency})`,
        `Recorded Responsibility (${currency})`,
        `Period Responsibility (${currency})`,
        `Remaining Budget (${currency})`,
        `Overspending (${currency})`,
        'Utilization %',
        'Warning Level',
      ];
      const rows = report.budgets.members.map((b) => [
        b.fullName,
        b.plannedBudget,
        b.recordedResponsibility,
        b.periodResponsibility,
        b.remainingBudget,
        b.overspending,
        `${b.utilizationPct}%`,
        b.warningLevel,
      ]);
      rows.push([
        'TOTAL',
        report.budgets.totalPlannedBudget,
        report.budgets.totalActualSpending,
        '',
        report.budgets.totalRemainingBudget,
        report.budgets.totalOverspending,
        `${report.budgets.overallUtilizationPct}%`,
        '',
      ]);
      return { filename, content: toCsvString(headers, rows) };
    }

    case 'settlements': {
      const filename = `${tripSlug}-settlement-history-${timestamp}.csv`;
      const headers = [
        'Plan Revision',
        'Transfer ID',
        'Debtor (Payer)',
        'Creditor (Recipient)',
        `Planned Transfer (${currency})`,
        `Confirmed Paid (${currency})`,
        `Remaining (${currency})`,
        'Record Type',
        'Payment ID',
        'Payment Method',
        `Payment Amount (${currency})`,
        'Payment Date',
        'Payment Status',
        'Submitted At',
        'Confirmed At',
        'Disputed At',
        'Dispute Reason',
        'Transaction Reference',
        'Payment Notes',
        'Refund ID',
        `Refund Amount (${currency})`,
        'Refund Reason',
        'Refund Recorded By',
        'Refund Date',
        'Event Action',
        'Event Actor ID',
        'Event Reason',
        'Event Date',
      ];
      const rows: Array<Array<unknown>> = [];
      for (const settlement of report.settlements.history) {
        const base = [
          settlement.planRevision,
          settlement.id,
          settlement.debtorName,
          settlement.creditorName,
          settlement.totalAmount,
          settlement.confirmedPaidAmount,
          settlement.remainingAmount,
        ];
        if (settlement.payments.length === 0) {
          rows.push([...base, 'TRANSFER', ...Array(20).fill('')]);
          continue;
        }
        for (const payment of settlement.payments) {
          const paymentFields = [
            ...base,
            'PAYMENT',
            payment.id,
            payment.paymentMethod ?? 'Unspecified',
            payment.amount,
            payment.paymentDateTime ?? '',
            payment.status,
            payment.debtorSubmittedAt ?? '',
            payment.creditorConfirmedAt ?? '',
            payment.disputedAt ?? '',
            payment.disputeReason ?? '',
            payment.transactionReference ?? '',
            payment.paymentNotes ?? '',
          ];
          rows.push([...paymentFields, ...Array(9).fill('')]);
          for (const refund of payment.refunds) {
            rows.push([
              ...paymentFields.slice(0, 19),
              refund.id,
              refund.amount,
              refund.reason,
              refund.createdByUserId,
              refund.createdAt,
              '',
              '',
              '',
              '',
            ]);
          }
          for (const event of payment.events) {
            rows.push([
              ...paymentFields.slice(0, 19),
              '',
              '',
              '',
              '',
              '',
              event.action,
              event.actorUserId,
              event.reason ?? '',
              event.createdAt,
            ]);
          }
        }
      }
      return { filename, content: toCsvString(headers, rows) };
    }

    case 'complete':
    default: {
      const filename = `${tripSlug}-complete-financial-report-${timestamp}.csv`;
      const headers = [
        'Section',
        'Item / Member / Date',
        'Classification / Category / Role',
        `Amount (${currency})`,
        `Group Share (${currency})`,
        `Personal Share (${currency})`,
        `Net Balance / Status`,
        'Additional Notes',
      ];
      const rows: Array<Array<unknown>> = [];

      // Section 1: Metadata
      rows.push(['TRIP INFO', report.meta.tripName, `Status: ${report.meta.tripStatus}`, '', '', '', '', `Base Currency: ${currency}`]);
      rows.push(['REPORT INFO', `Generated: ${report.meta.generatedAt}`, `Type: Complete`, '', '', '', '', '']);

      // Section 2: Summary
      rows.push(['SUMMARY', 'Total Trip Spending', 'All Active Expenses', report.spendingSummary.totalSpending, report.spendingSummary.groupSpending, report.spendingSummary.personalSpending, `${report.spendingSummary.activeExpenseCount} expenses`, '']);
      rows.push(['BUDGET SUMMARY', 'Planned / Actual / Remaining', 'Current trip budgets', report.budgets.totalPlannedBudget, '', '', report.budgets.totalRemainingBudget, `Actual responsibility: ${report.budgets.totalActualSpending}; utilization ${report.budgets.overallUtilizationPct}%`]);
      rows.push(['SETTLEMENT SUMMARY', 'Current plan outstanding', `Revision ${report.settlements.planRevision}`, report.settlements.totalPlanned, '', '', report.settlements.totalOutstanding, `Confirmed net payments: ${report.settlements.totalPaid}; recorded refunds: ${report.settlements.totalRefunded}; ${report.settlements.isFullySettled ? 'Fully settled' : 'Not fully settled'}`]);

      // Section 3: Categories
      for (const cat of report.categories) {
        rows.push(['CATEGORY', cat.category, `${cat.percentage}% of total`, cat.amount, cat.groupAmount, cat.personalAmount, `${cat.expenseCount} items`, '']);
      }

      // Section 4: Members
      for (const m of report.members) {
        rows.push(['MEMBER', m.fullName, m.role, m.payerContribution, m.groupResponsibility, m.personalExpenses, m.netBalance, `Budget: ${m.plannedBudget ?? 'None'} (${m.utilizationPct ?? '0.00'}%)`]);
        rows.push(['SETTLEMENT BALANCE', m.fullName, 'Outstanding payable / receivable', m.settlementOutstandingPayable, m.settlementOutstandingReceivable, '', m.settlementBalance, 'Settlement obligations are separate from trip expenses.']);
      }

      // Section 5: Expenses
      for (const e of report.expenses) {
        rows.push(['EXPENSE', `${e.date.slice(0, 10)} - ${e.title}`, `${e.category} (${e.status})`, e.convertedAmount, '', '', e.paymentMethod, `Paid by: ${e.payers.map((p) => p.fullName).join(', ')}`]);
      }
      for (const audit of report.auditHistory) {
        rows.push(['EXPENSE AUDIT', audit.entityId, audit.action, '', '', '', audit.createdAt, `${audit.actorName}: ${JSON.stringify(audit.details ?? '')}`]);
      }

      // Section 6: Settlements
      for (const s of report.settlements.history) {
        rows.push(['SETTLEMENT', `${s.debtorName} -> ${s.creditorName}`, `Revision ${s.planRevision} · ${s.status}`, s.totalAmount, '', '', `Remaining: ${s.remainingAmount}`, `Paid: ${s.confirmedPaidAmount}`]);
        for (const payment of s.payments) {
          rows.push(['PAYMENT ATTEMPT', payment.id, `${payment.paymentMethod ?? 'Unspecified'} · ${payment.status}`, payment.amount, '', '', payment.paymentDateTime ?? '', `Recorded manually; not bank-verified. Ref: ${payment.transactionReference ?? 'None'}`]);
          for (const refund of payment.refunds) {
            rows.push(['REFUND', refund.id, refund.reason, refund.amount, '', '', refund.createdAt, `Payment ${payment.id}`]);
          }
          for (const event of payment.events) {
            rows.push(['PAYMENT EVENT', event.action, event.actorUserId, '', '', '', event.createdAt, event.reason ?? '']);
          }
        }
      }

      return { filename, content: toCsvString(headers, rows) };
    }
  }
}
