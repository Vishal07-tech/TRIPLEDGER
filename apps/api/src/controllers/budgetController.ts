import type { Response } from 'express';

import { prisma } from '../lib/prisma.js';
import type { TripAwareRequest } from '../middleware/tripAccess.js';
import {
  createBudgetSnapshot,
  getBudgetWarningLevel,
  getElapsedTripDays,
  getReachedBudgetThresholds,
  projectThirtyDayResponsibility,
} from '../services/budgetService.js';
import { minorToDecimalString, parseStoredMoneyToMinor } from '../services/financialMath.js';

function toSingleString(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

export async function getTripBudgets(req: TripAwareRequest, res: Response) {
  const tripId = toSingleString(req.params.tripId);
  const trip = await prisma.trip.findUniqueOrThrow({
    where: { id: tripId },
    select: { baseCurrency: true, createdAt: true },
  });
  const [members, entries, budgets, activeNotifications, resolvedNotifications] = await Promise.all([
    prisma.tripMember.findMany({
      where: { tripId },
      include: { user: { select: { fullName: true } } },
      orderBy: { joinedAt: 'asc' },
    }),
    prisma.financialEntry.findMany({
      where: { tripId },
      include: { reversalOf: { select: { entryType: true } } },
    }),
    prisma.memberBudget.findMany({ where: { tripId } }),
    prisma.notification.findMany({
      where: {
        tripId,
        userId: req.tripMember!.userId,
        type: { in: ['BUDGET_APPROACHING', 'BUDGET_EXCEEDED'] },
        resolvedAt: null,
      },
      select: {
        id: true,
        type: true,
        title: true,
        message: true,
        metadata: true,
        createdAt: true,
        resolvedAt: true,
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.notification.findMany({
      where: {
        tripId,
        userId: req.tripMember!.userId,
        type: { in: ['BUDGET_APPROACHING', 'BUDGET_EXCEEDED'] },
        resolvedAt: { not: null },
      },
      select: {
        id: true,
        type: true,
        title: true,
        message: true,
        metadata: true,
        createdAt: true,
        resolvedAt: true,
      },
      orderBy: { resolvedAt: 'desc' },
    }),
  ]);
  const notifications = [...activeNotifications, ...resolvedNotifications];
  const responsibilityByUser = new Map<string, bigint>();
  for (const entry of entries) {
    if (entry.entryType !== 'RESPONSIBILITY' && entry.reversalOf?.entryType !== 'RESPONSIBILITY') {
      continue;
    }
    const amount = parseStoredMoneyToMinor(String(entry.amount), trip.baseCurrency);
    responsibilityByUser.set(entry.userId, (responsibilityByUser.get(entry.userId) ?? 0n) - amount);
  }

  const budgetByUser = new Map(budgets.map((budget) => [budget.userId, budget]));
  const totalResponsibilityMinor = [...responsibilityByUser.values()].reduce((total, value) => total + value, 0n);
  const totalPlannedMinor = budgets.reduce(
    (total, budget) => total + parseStoredMoneyToMinor(String(budget.plannedBudget), trip.baseCurrency),
    0n,
  );
  const elapsedDays = getElapsedTripDays(trip.createdAt, new Date());
  const overallSnapshot =
    totalPlannedMinor > 0n
      ? createBudgetSnapshot(totalPlannedMinor, totalResponsibilityMinor, trip.baseCurrency)
      : null;

  res.json({
    currency: trip.baseCurrency,
    trip: {
      plannedBudget: totalPlannedMinor > 0n ? minorToDecimalString(totalPlannedMinor, trip.baseCurrency) : null,
      responsibility: minorToDecimalString(totalResponsibilityMinor, trip.baseCurrency),
      remainingBudget: overallSnapshot?.remainingBudget ?? null,
      utilizationPct: overallSnapshot?.utilizationPct ?? null,
      overspending: overallSnapshot?.overspending ?? null,
      warningThresholds: totalPlannedMinor > 0n
        ? getReachedBudgetThresholds(totalPlannedMinor, totalResponsibilityMinor)
        : [],
      projectedNext30Days: minorToDecimalString(
        projectThirtyDayResponsibility(totalResponsibilityMinor, elapsedDays),
        trip.baseCurrency,
      ),
    },
    forecast: {
      method: '30-day run rate: net financial responsibility to date divided by elapsed trip days (minimum 1), multiplied by 30. This is not a trip-end prediction.',
      elapsedDays,
      horizonDays: 30,
    },
    members: members.map((member) => {
      const responsibilityMinor = responsibilityByUser.get(member.userId) ?? 0n;
      const budget = budgetByUser.get(member.userId);
      if (!budget) {
        return {
          userId: member.userId,
          fullName: member.user.fullName,
          isActive: member.isActive,
          plannedBudget: null,
          responsibility: minorToDecimalString(responsibilityMinor, trip.baseCurrency),
          remainingBudget: null,
          utilizationPct: null,
          overspending: null,
          warningLevel: 'normal',
          warningThresholds: [],
          projectedNext30Days: minorToDecimalString(
            projectThirtyDayResponsibility(responsibilityMinor, elapsedDays),
            trip.baseCurrency,
          ),
        };
      }

      const plannedMinor = parseStoredMoneyToMinor(String(budget.plannedBudget), trip.baseCurrency);
      const snapshot = createBudgetSnapshot(plannedMinor, responsibilityMinor, trip.baseCurrency);
      return {
        userId: member.userId,
        fullName: member.user.fullName,
        isActive: member.isActive,
        ...snapshot,
        responsibility: minorToDecimalString(responsibilityMinor, trip.baseCurrency),
        warningLevel: getBudgetWarningLevel(budget.warningLevel),
        warningThresholds: getReachedBudgetThresholds(plannedMinor, responsibilityMinor),
        projectedNext30Days: minorToDecimalString(
          projectThirtyDayResponsibility(responsibilityMinor, elapsedDays),
          trip.baseCurrency,
        ),
      };
    }),
    notifications,
  });
}
