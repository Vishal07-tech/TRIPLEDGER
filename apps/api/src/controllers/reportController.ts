import type { Response } from 'express';

import { prisma } from '../lib/prisma.js';
import type { TripAwareRequest } from '../middleware/tripAccess.js';
import { validateDateRange } from '../services/analyticsService.js';
import { FinancialInputError } from '../services/financialMath.js';
import {
  buildCsvExport,
  generateTripReportData,
  reportTypes,
  type ReportType,
} from '../services/reportService.js';

function toSingleString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return '';
}

function sendReportError(error: unknown, res: Response) {
  if (error instanceof FinancialInputError) {
    const status = error.message === 'Trip not found.' ? 404 : 400;
    res.status(status).json({ message: error.message });
    return;
  }
  throw error;
}

export async function getTripReport(req: TripAwareRequest, res: Response) {
  const tripId = toSingleString(req.params.tripId);
  const typeParam = toSingleString(req.query.type) as ReportType;
  const startDateQuery = req.query.startDate as string | undefined;
  const endDateQuery = req.query.endDate as string | undefined;
  const memberId = toSingleString(req.query.memberId) || null;

  const reportType: ReportType = reportTypes.includes(typeParam) ? typeParam : 'complete';

  try {
    const { startDate, endDate } = validateDateRange(startDateQuery, endDateQuery);
    const data = await generateTripReportData(prisma, tripId, {
      reportType,
      startDate,
      endDate,
      memberId,
    });
    res.json(data);
  } catch (error) {
    sendReportError(error, res);
  }
}

export async function exportTripReportCsv(req: TripAwareRequest, res: Response) {
  const tripId = toSingleString(req.params.tripId);
  const typeParam = toSingleString(req.query.type) as ReportType;
  const startDateQuery = req.query.startDate as string | undefined;
  const endDateQuery = req.query.endDate as string | undefined;
  const memberId = toSingleString(req.query.memberId) || null;

  const reportType: ReportType = reportTypes.includes(typeParam) ? typeParam : 'complete';

  try {
    const { startDate, endDate } = validateDateRange(startDateQuery, endDateQuery);
    const data = await generateTripReportData(prisma, tripId, {
      reportType,
      startDate,
      endDate,
      memberId,
    });
    const { filename, content } = buildCsvExport(data);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(content);
  } catch (error) {
    sendReportError(error, res);
  }
}
