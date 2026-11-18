import type { Response } from 'express';
import { z } from 'zod';

import { prisma } from '../lib/prisma.js';
import type { TripAwareRequest } from '../middleware/tripAccess.js';
import { FinancialInputError } from '../services/financialMath.js';
import {
  confirmPaymentReceipt,
  createPaymentAttempt,
  disputePayment,
  finalizeTrip,
  generateSettlementPlan,
  getSettlementOverview,
  getTripExpenseReviews,
  initiateTripClosure,
  markPaymentUnsuccessful,
  overridePaymentSchema,
  paymentActionSchema,
  paymentAttemptSchema,
  refundPayment,
  refundSchema,
  requestTripClosure,
  reopenTrip,
  resolutionSchema,
  resolveExpenseReview,
  resolvePaymentDispute,
  reviewSchema,
  startTripExpenseReview,
  submitExpenseReview,
} from '../services/settlementService.js';

function routeId(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

function fail(error: unknown, res: Response) {
  if (error instanceof FinancialInputError) {
    const notFound = /not found/i.test(error.message);
    res.status(notFound ? 404 : 400).json({ message: error.message });
    return;
  }
  if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
    res.status(409).json({ message: 'This request has already been processed.' });
    return;
  }
  throw error;
}

export async function requestClosure(req: TripAwareRequest, res: Response) {
  try {
    await prisma.$transaction((tx) =>
      requestTripClosure(tx, routeId(req.params.tripId), req.tripMember!),
    );
    res.status(201).json({ message: 'Trip closure request recorded for owner/admin review.' });
  } catch (error) {
    fail(error, res);
  }
}

export async function initiateClosure(req: TripAwareRequest, res: Response) {
  try {
    await prisma.$transaction((tx) =>
      initiateTripClosure(tx, routeId(req.params.tripId), req.tripMember!),
    );
    res.json({ status: 'CLOSING' });
  } catch (error) {
    fail(error, res);
  }
}

export async function startExpenseReview(req: TripAwareRequest, res: Response) {
  try {
    await prisma.$transaction((tx) =>
      startTripExpenseReview(tx, routeId(req.params.tripId), req.tripMember!),
    );
    res.json({ status: 'EXPENSE_REVIEW' });
  } catch (error) {
    fail(error, res);
  }
}

export async function getExpenseReviews(req: TripAwareRequest, res: Response) {
  try {
    const data = await getTripExpenseReviews(prisma, routeId(req.params.tripId), req.tripMember!);
    res.json(data);
  } catch (error) {
    fail(error, res);
  }
}

export async function reviewExpense(req: TripAwareRequest, res: Response) {
  const parsed = reviewSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Invalid expense review.', issues: parsed.error.flatten() });
    return;
  }
  try {
    await prisma.$transaction((tx) =>
      submitExpenseReview(
        tx,
        routeId(req.params.tripId),
        routeId(req.params.expenseId),
        req.tripMember!,
        parsed.data,
      ),
    );
    res.json({ status: parsed.data.status });
  } catch (error) {
    fail(error, res);
  }
}

export async function resolveReview(req: TripAwareRequest, res: Response) {
  const parsed = resolutionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Invalid review resolution.', issues: parsed.error.flatten() });
    return;
  }
  try {
    await prisma.$transaction((tx) =>
      resolveExpenseReview(
        tx,
        routeId(req.params.tripId),
        routeId(req.params.expenseId),
        req.tripMember!,
        parsed.data.userId,
        parsed.data.reason,
      ),
    );
    res.json({ status: 'RESOLVED' });
  } catch (error) {
    fail(error, res);
  }
}

export async function generatePlan(req: TripAwareRequest, res: Response) {
  try {
    const plan = await prisma.$transaction((tx) =>
      generateSettlementPlan(tx, routeId(req.params.tripId), req.tripMember!),
    );
    res.status(201).json(plan);
  } catch (error) {
    fail(error, res);
  }
}

export async function getOverview(req: TripAwareRequest, res: Response) {
  try {
    res.json(await getSettlementOverview(prisma, routeId(req.params.tripId), req.tripMember!));
  } catch (error) {
    fail(error, res);
  }
}

export async function initiatePayment(req: TripAwareRequest, res: Response) {
  const parsed = paymentAttemptSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Invalid payment attempt.', issues: parsed.error.flatten() });
    return;
  }
  try {
    const result = await prisma.$transaction((tx) =>
      createPaymentAttempt(
        tx,
        routeId(req.params.tripId),
        routeId(req.params.settlementId),
        req.tripMember!,
        parsed.data,
      ),
    );
    res.status(201).json(result);
  } catch (error) {
    fail(error, res);
  }
}

export async function confirmPayment(req: TripAwareRequest, res: Response) {
  const parsed = paymentActionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'A valid confirmation idempotency key is required.' });
    return;
  }
  try {
    const payment = await prisma.$transaction((tx) =>
      confirmPaymentReceipt(
        tx,
        routeId(req.params.tripId),
        routeId(req.params.paymentId),
        req.tripMember!,
        parsed.data.idempotencyKey,
      ),
    );
    res.json({ payment });
  } catch (error) {
    fail(error, res);
  }
}

export async function updatePaymentStatus(req: TripAwareRequest, res: Response) {
  const schema = z.object({
    status: z.enum(['FAILED', 'EXPIRED', 'DECLINED']),
    idempotencyKey: z.string().trim().min(8).max(191),
    reason: z.string().trim().max(500).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Invalid payment status update.', issues: parsed.error.flatten() });
    return;
  }
  try {
    const payment = await prisma.$transaction((tx) =>
      markPaymentUnsuccessful(
        tx,
        routeId(req.params.tripId),
        routeId(req.params.paymentId),
        req.tripMember!,
        parsed.data.status,
        parsed.data.idempotencyKey,
        parsed.data.reason,
      ),
    );
    res.json({ payment });
  } catch (error) {
    fail(error, res);
  }
}

export async function raisePaymentDispute(req: TripAwareRequest, res: Response) {
  const parsed = paymentActionSchema.safeParse(req.body);
  if (!parsed.success || !parsed.data.reason) {
    res.status(400).json({ message: 'A dispute reason and idempotency key are required.' });
    return;
  }
  try {
    await prisma.$transaction((tx) =>
      disputePayment(
        tx,
        routeId(req.params.tripId),
        routeId(req.params.paymentId),
        req.tripMember!,
        parsed.data.reason!,
        parsed.data.idempotencyKey,
      ),
    );
    res.json({ status: 'DISPUTED' });
  } catch (error) {
    fail(error, res);
  }
}

export async function resolvePayment(req: TripAwareRequest, res: Response) {
  const parsed = overridePaymentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'Invalid payment dispute resolution.', issues: parsed.error.flatten() });
    return;
  }
  try {
    await prisma.$transaction((tx) =>
      resolvePaymentDispute(
        tx,
        routeId(req.params.tripId),
        routeId(req.params.paymentId),
        req.tripMember!,
        parsed.data,
      ),
    );
    res.json({ status: parsed.data.status });
  } catch (error) {
    fail(error, res);
  }
}

export async function refundSettlementPayment(req: TripAwareRequest, res: Response) {
  const parsed = refundSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'A refund amount, reason and idempotency key are required.', issues: parsed.error.flatten() });
    return;
  }
  try {
    await prisma.$transaction((tx) =>
      refundPayment(
        tx,
        routeId(req.params.tripId),
        routeId(req.params.paymentId),
        req.tripMember!,
        parsed.data,
      ),
    );
    res.json({ status: 'REFUNDED' });
  } catch (error) {
    fail(error, res);
  }
}

export async function closeTrip(req: TripAwareRequest, res: Response) {
  try {
    await prisma.$transaction((tx) => finalizeTrip(tx, routeId(req.params.tripId), req.tripMember!));
    res.json({ status: 'TRIP_CLOSED' });
  } catch (error) {
    fail(error, res);
  }
}

export async function reopenClosedTrip(req: TripAwareRequest, res: Response) {
  const parsed = z.object({ reason: z.string().trim().min(3).max(500) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: 'An explanation is required to reopen the trip.' });
    return;
  }
  try {
    await prisma.$transaction((tx) =>
      reopenTrip(tx, routeId(req.params.tripId), req.tripMember!, parsed.data.reason),
    );
    res.json({ status: 'ACTIVE' });
  } catch (error) {
    fail(error, res);
  }
}
