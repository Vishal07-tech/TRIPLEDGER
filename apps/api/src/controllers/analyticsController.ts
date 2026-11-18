import type { Response } from 'express';

import { prisma } from '../lib/prisma.js';
import type { TripAwareRequest } from '../middleware/tripAccess.js';
import {
  getTripAnalyticsData,
  validateDateRange,
} from '../services/analyticsService.js';
import { FinancialInputError } from '../services/financialMath.js';

function toSingleString(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

function sendAnalyticsError(error: unknown, res: Response) {
  if (error instanceof FinancialInputError) {
    const status = error.message === 'Trip not found.' ? 404 : 400;
    res.status(status).json({ message: error.message });
    return;
  }
  throw error;
}

export async function getTripAnalyticsReport(req: TripAwareRequest, res: Response) {
  const tripId = toSingleString(req.params.tripId);
  const startDateQuery = req.query.startDate as string | undefined;
  const endDateQuery = req.query.endDate as string | undefined;

  try {
    const { startDate, endDate } = validateDateRange(startDateQuery, endDateQuery);
    const data = await getTripAnalyticsData(prisma, tripId, { startDate, endDate });
    res.json(data);
  } catch (error) {
    sendAnalyticsError(error, res);
  }
}

export async function getTripCategoryAnalytics(req: TripAwareRequest, res: Response) {
  const tripId = toSingleString(req.params.tripId);
  const startDateQuery = req.query.startDate as string | undefined;
  const endDateQuery = req.query.endDate as string | undefined;

  try {
    const { startDate, endDate } = validateDateRange(startDateQuery, endDateQuery);
    const data = await getTripAnalyticsData(prisma, tripId, { startDate, endDate });
    res.json({
      tripId: data.tripId,
      baseCurrency: data.baseCurrency,
      dateRange: data.dateRange,
      totalSpending: data.spendingSummary.totalSpending,
      categories: data.categoryBreakdown,
      expenseTypes: data.expenseTypes,
    });
  } catch (error) {
    sendAnalyticsError(error, res);
  }
}

export async function getTripMemberAnalytics(req: TripAwareRequest, res: Response) {
  const tripId = toSingleString(req.params.tripId);
  const startDateQuery = req.query.startDate as string | undefined;
  const endDateQuery = req.query.endDate as string | undefined;

  try {
    const { startDate, endDate } = validateDateRange(startDateQuery, endDateQuery);
    const data = await getTripAnalyticsData(prisma, tripId, { startDate, endDate });
    res.json({
      tripId: data.tripId,
      baseCurrency: data.baseCurrency,
      dateRange: data.dateRange,
      totalPayerAdvances: data.spendingSummary.totalPayerAdvances,
      totalResponsibility: data.spendingSummary.totalResponsibility,
      members: data.memberBreakdown,
    });
  } catch (error) {
    sendAnalyticsError(error, res);
  }
}

export async function getTripBudgetAnalytics(req: TripAwareRequest, res: Response) {
  const tripId = toSingleString(req.params.tripId);
  const startDateQuery = req.query.startDate as string | undefined;
  const endDateQuery = req.query.endDate as string | undefined;

  try {
    const { startDate, endDate } = validateDateRange(startDateQuery, endDateQuery);
    const data = await getTripAnalyticsData(prisma, tripId, { startDate, endDate });
    res.json({
      tripId: data.tripId,
      baseCurrency: data.baseCurrency,
      budgetUtilization: data.budgetUtilization,
    });
  } catch (error) {
    sendAnalyticsError(error, res);
  }
}

export async function getTripSettlementAnalytics(req: TripAwareRequest, res: Response) {
  const tripId = toSingleString(req.params.tripId);

  try {
    const data = await getTripAnalyticsData(prisma, tripId);
    res.json({
      tripId: data.tripId,
      baseCurrency: data.baseCurrency,
      settlementOverview: data.settlementOverview,
    });
  } catch (error) {
    sendAnalyticsError(error, res);
  }
}

export async function getTripTrendAnalytics(req: TripAwareRequest, res: Response) {
  const tripId = toSingleString(req.params.tripId);
  const startDateQuery = req.query.startDate as string | undefined;
  const endDateQuery = req.query.endDate as string | undefined;

  try {
    const { startDate, endDate } = validateDateRange(startDateQuery, endDateQuery);
    const data = await getTripAnalyticsData(prisma, tripId, { startDate, endDate });
    res.json({
      tripId: data.tripId,
      baseCurrency: data.baseCurrency,
      dateRange: data.dateRange,
      trends: data.trends,
    });
  } catch (error) {
    sendAnalyticsError(error, res);
  }
}
