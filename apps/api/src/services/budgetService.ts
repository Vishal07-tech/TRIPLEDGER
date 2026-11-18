import type { Prisma } from '@prisma/client';

import {
  minorToDecimalString,
  parseStoredMoneyToMinor,
} from './financialMath.js';

export const budgetWarningThresholds = [50, 75, 90, 100] as const;

export type BudgetWarningLevel = 'normal' | 'approaching' | 'warning' | 'reached' | 'exceeded';

const warningLevelByThreshold: Record<number, BudgetWarningLevel> = {
  50: 'approaching',
  75: 'warning',
  90: 'reached',
  100: 'exceeded',
};

type BudgetTransaction = Prisma.TransactionClient;

export function getBudgetWarningLevel(value: string | null | undefined): BudgetWarningLevel {
  if (value === 'approaching' || value === 'warning' || value === 'reached' || value === 'exceeded') {
    return value;
  }
  return 'normal';
}

export function getReachedBudgetThresholds(plannedMinor: bigint, responsibilityMinor: bigint) {
  if (plannedMinor <= 0n || responsibilityMinor <= 0n) {
    return [];
  }

  return budgetWarningThresholds.filter(
    (threshold) => responsibilityMinor * 100n >= plannedMinor * BigInt(threshold),
  );
}

export function formatBudgetUtilization(plannedMinor: bigint, responsibilityMinor: bigint) {
  if (plannedMinor <= 0n) {
    return '0.00';
  }

  const scaledNumerator = responsibilityMinor * 10_000n;
  const rounded =
    scaledNumerator >= 0n
      ? (scaledNumerator + plannedMinor / 2n) / plannedMinor
      : (scaledNumerator - plannedMinor / 2n) / plannedMinor;
  const negative = rounded < 0n;
  const absolute = negative ? -rounded : rounded;
  return `${negative ? '-' : ''}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, '0')}`;
}

export function createBudgetSnapshot(
  plannedMinor: bigint,
  responsibilityMinor: bigint,
  currency: string,
) {
  const remainingMinor = plannedMinor - responsibilityMinor;
  const overspendingMinor = remainingMinor < 0n ? -remainingMinor : 0n;
  return {
    plannedBudget: minorToDecimalString(plannedMinor, currency),
    remainingBudget: minorToDecimalString(remainingMinor, currency),
    utilizationPct: formatBudgetUtilization(plannedMinor, responsibilityMinor),
    overspending: minorToDecimalString(overspendingMinor, currency),
  };
}

export function getElapsedTripDays(startedAt: Date, asOf: Date) {
  const elapsedMilliseconds = Math.max(0, asOf.getTime() - startedAt.getTime());
  return Math.max(1, Math.ceil(elapsedMilliseconds / 86_400_000));
}

export function projectThirtyDayResponsibility(responsibilityMinor: bigint, elapsedDays: number) {
  const safeElapsedDays = BigInt(Math.max(1, Math.trunc(elapsedDays)));
  const numerator = responsibilityMinor * 30n;
  const quotient = numerator / safeElapsedDays;
  const remainder = numerator % safeElapsedDays;
  if (remainder === 0n || (remainder < 0n ? -remainder : remainder) * 2n < safeElapsedDays) {
    return quotient;
  }
  return quotient + (numerator < 0n ? -1n : 1n);
}

export async function getMemberResponsibilityMinor(
  tx: BudgetTransaction,
  tripId: string,
  userId: string,
  currency: string,
) {
  const entries = await tx.financialEntry.findMany({
    where: {
      tripId,
      userId,
      OR: [
        { entryType: 'RESPONSIBILITY' },
        { reversalOf: { is: { entryType: 'RESPONSIBILITY' } } },
      ],
    },
    select: { amount: true },
  });
  return -entries.reduce(
    (total, entry) => total + parseStoredMoneyToMinor(String(entry.amount), currency),
    0n,
  );
}

export async function syncMemberBudget(
  tx: BudgetTransaction,
  tripId: string,
  userId: string,
  currency: string,
) {
  const budget = await tx.memberBudget.findUnique({
    where: { tripId_userId: { tripId, userId } },
  });
  if (!budget) {
    return null;
  }

  const plannedMinor = parseStoredMoneyToMinor(String(budget.plannedBudget), currency);
  const responsibilityMinor = await getMemberResponsibilityMinor(tx, tripId, userId, currency);
  const newThresholds = getReachedBudgetThresholds(plannedMinor, responsibilityMinor);
  const activeWarnings = await tx.notification.findMany({
    where: {
      tripId,
      userId,
      type: { in: ['BUDGET_APPROACHING', 'BUDGET_EXCEEDED'] },
      resolvedAt: null,
    },
    select: { id: true, dedupeKey: true },
  });

  for (const warning of activeWarnings) {
    const thresholdMatch = warning.dedupeKey?.match(/:(50|75|90|100)$/);
    const threshold = thresholdMatch ? Number(thresholdMatch[1]) : null;
    if (threshold !== null && newThresholds.includes(threshold as (typeof budgetWarningThresholds)[number])) {
      continue;
    }

    await tx.notification.update({
      where: { id: warning.id },
      data: {
        resolvedAt: new Date(),
        dedupeKey: null,
      },
    });
  }

  for (const threshold of newThresholds) {
    const level = warningLevelByThreshold[threshold];
    const notificationType = threshold === 100 ? 'BUDGET_EXCEEDED' : 'BUDGET_APPROACHING';
    const dedupeKey = `budget:${tripId}:${userId}:${threshold}`;
    await tx.notification.upsert({
      where: { dedupeKey },
      create: {
        tripId,
        userId,
        type: notificationType,
        title: `Budget ${threshold}% reached`,
        message: `Your recorded financial responsibility has reached ${threshold}% of your planned trip budget.`,
        metadata: {
          kind: 'member-budget-threshold',
          userId,
          threshold,
          plannedBudget: String(budget.plannedBudget),
          responsibility: minorToDecimalString(responsibilityMinor, currency),
          currency,
        },
        dedupeKey,
      },
      update: {},
    });
  }

  const reachedThresholds = getReachedBudgetThresholds(plannedMinor, responsibilityMinor);
  const highestThreshold = reachedThresholds.at(-1);
  const nextLevel = highestThreshold === undefined ? 'normal' : warningLevelByThreshold[highestThreshold];
  const snapshot = createBudgetSnapshot(plannedMinor, responsibilityMinor, currency);

  return tx.memberBudget.update({
    where: { id: budget.id },
    data: {
      ...snapshot,
      warningLevel: nextLevel,
    },
  });
}
