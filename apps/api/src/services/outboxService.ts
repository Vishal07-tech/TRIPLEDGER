import { Prisma } from '@prisma/client';
import type { OutboxEvent, PrismaClient } from '@prisma/client';

import { ident } from '../lib/sqlDialect.js';

type Transaction = Prisma.TransactionClient;

export const tripEventTypes = [
  'TRIP_SETTINGS_UPDATED',
  'TRIP_INVITATION_CREATED',
  'TRIP_MEMBER_ADDED',
  'TRIP_MEMBER_UPDATED',
  'TRIP_CASH_MANAGER_UPDATED',
  'TRIP_CLOSURE_REQUESTED',
  'TRIP_CLOSURE_INITIATED',
  'TRIP_EXPENSE_REVIEW_STARTED',
  'SETTLEMENT_EXPENSE_REVIEW_UPDATED',
  'SETTLEMENT_PLAN_GENERATED',
  'TRIP_CLOSED',
  'TRIP_REOPENED',
  'TRIP_EXPENSE_CREATED',
  'TRIP_EXPENSE_CORRECTED',
  'TRIP_EXPENSE_REVERSED',
  'TRIP_BUDGET_UPDATED',
  'SETTLEMENT_PAYMENT_SUBMITTED',
  'SETTLEMENT_PAYMENT_CONFIRMED',
  'SETTLEMENT_PAYMENT_STATUS_UPDATED',
  'SETTLEMENT_PAYMENT_DISPUTED',
  'SETTLEMENT_PAYMENT_RESOLVED',
  'SETTLEMENT_PAYMENT_REFUNDED',
] as const;

export type TripEventType = (typeof tripEventTypes)[number];

export type TripEventPayload = {
  entityType: 'Expense' | 'MemberBudget' | 'SettlementPayment' | 'Trip';
  entityId: string;
  actorUserId: string;
  relatedEntityId?: string;
};

export type TripEventRecord = Pick<
  OutboxEvent,
  'id' | 'tripId' | 'eventKey' | 'eventType' | 'payload' | 'createdAt'
>;

export type TripEventCursor = bigint;

async function allocateTripSequence(tx: Transaction, tripId: string) {
  try {
    const trip = await tx.trip.update({
      where: { id: tripId },
      data: { eventSequence: { increment: BigInt(1) } },
      select: { eventSequence: true },
    });
    return trip.eventSequence;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      throw new Error('Trip event could not be sequenced because the trip no longer exists.');
    }
    throw error;
  }
}

export async function enqueueTripEvent(
  tx: Transaction,
  input: {
    tripId: string;
    eventKey: string;
    eventType: TripEventType;
    payload: TripEventPayload;
  },
) {
  if (input.eventKey.length < 1 || input.eventKey.length > 191) {
    throw new Error('Trip event keys must contain between 1 and 191 characters.');
  }

  const payload: TripEventPayload = {
    entityType: input.payload.entityType,
    entityId: input.payload.entityId,
    actorUserId: input.payload.actorUserId,
    ...(input.payload.relatedEntityId ? { relatedEntityId: input.payload.relatedEntityId } : {}),
  };
  const existing = await tx.outboxEvent.findUnique({ where: { eventKey: input.eventKey } });
  if (existing) {
    const sameEvent = existing.tripId === input.tripId
      && existing.eventType === input.eventType
      && JSON.stringify(existing.payload) === JSON.stringify(payload);
    if (!sameEvent) throw new Error('A trip event key cannot be reused for a different event.');
    if (existing.tripSequence !== null) return existing;
    const tripSequence = await allocateTripSequence(tx, input.tripId);
    return tx.outboxEvent.update({
      where: { id: existing.id },
      data: { tripSequence },
    });
  }

  const tripSequence = await allocateTripSequence(tx, input.tripId);
  return tx.outboxEvent.create({
    data: {
      tripId: input.tripId,
      tripSequence,
      eventKey: input.eventKey,
      eventType: input.eventType,
      payload,
    },
  });
}

export function getOutboxRetryDelay(attempt: number) {
  const boundedAttempt = Math.max(1, Math.min(Math.trunc(attempt), 8));
  return Math.min(300_000, 1_000 * (2 ** (boundedAttempt - 1)));
}

export function encodeTripEventCursor(sequence: bigint | string) {
  const value = typeof sequence === 'bigint' ? sequence.toString() : sequence;
  if (!/^\d+$/.test(value)) throw new Error('Invalid trip event cursor.');
  return value;
}

export function decodeTripEventCursor(value: string): TripEventCursor {
  if (!/^\d+$/.test(value)) {
    throw new Error('Invalid trip event cursor.');
  }
  return BigInt(value);
}

export async function listTripEventsAfter(
  tx: Transaction,
  tripId: string,
  cursor: TripEventCursor | null,
  limit = 100,
) {
  const safeLimit = Math.max(1, Math.min(Math.trunc(limit), 500));
  return tx.outboxEvent.findMany({
    where: {
      tripId,
      ...(cursor !== null
        ? { tripSequence: { gt: cursor } }
        : { tripSequence: { not: null } }),
    },
    select: {
      id: true,
      tripId: true,
      tripSequence: true,
      eventKey: true,
      eventType: true,
      payload: true,
    },
    orderBy: { tripSequence: 'asc' },
    take: safeLimit,
  });
}

function eventPayload(value: Prisma.JsonValue): TripEventPayload | null {
  if (
    typeof value !== 'object'
    || value === null
    || Array.isArray(value)
    || !('entityType' in value)
    || !('entityId' in value)
    || !('actorUserId' in value)
  ) {
    return null;
  }
  const payload = value as { entityType: unknown; entityId: unknown; actorUserId: unknown; relatedEntityId?: unknown };
  if (
    (payload.entityType !== 'Expense'
      && payload.entityType !== 'MemberBudget'
      && payload.entityType !== 'SettlementPayment'
      && payload.entityType !== 'Trip')
    || typeof payload.entityId !== 'string'
    || typeof payload.actorUserId !== 'string'
    || (payload.relatedEntityId !== undefined && typeof payload.relatedEntityId !== 'string')
  ) {
    return null;
  }
  return payload as TripEventPayload;
}

async function writeNotification(
  tx: Transaction,
  input: {
    tripId: string;
    userId: string;
    dedupeKey: string;
    type: 'MEMBER_JOINED' | 'EXPENSE_CREATED' | 'EXPENSE_UPDATED' | 'PAYMENT_CONFIRMED' | 'SETTLEMENT_DISPUTED' | 'PAYMENT_DISPUTE_RESOLVED' | 'PAYMENT_REFUNDED' | 'TRIP_CLOSED';
    title: string;
    message: string;
    metadata: Prisma.InputJsonValue;
  },
) {
  await tx.notification.upsert({
    where: { dedupeKey: input.dedupeKey },
    create: input,
    update: {},
  });
}

async function materializeTripNotifications(
  tx: Transaction,
  event: TripEventRecord,
) {
  if (!event.tripId) return;
  const payload = eventPayload(event.payload);
  if (!payload) throw new Error(`Outbox event ${event.id} has an invalid payload.`);
  const dedupePrefix = `outbox:${event.id}`;

  if (event.eventType === 'TRIP_MEMBER_ADDED') {
    const members = await tx.tripMember.findMany({
      where: {
        tripId: event.tripId,
        isActive: true,
        joinedAt: { lte: event.createdAt },
        userId: { not: payload.actorUserId },
      },
      select: { userId: true },
    });
    for (const member of members) {
      await writeNotification(tx, {
        tripId: event.tripId,
        userId: member.userId,
        dedupeKey: `${dedupePrefix}:${member.userId}`,
        type: 'MEMBER_JOINED',
        title: 'New trip member',
        message: 'A new member joined this trip.',
        metadata: { tripId: event.tripId },
      });
    }
    return;
  }

  if (event.eventType === 'TRIP_CLOSED') {
    const members = await tx.tripMember.findMany({
      where: {
        tripId: event.tripId,
        isActive: true,
        joinedAt: { lte: event.createdAt },
        userId: { not: payload.actorUserId },
      },
      select: { userId: true },
    });
    for (const member of members) {
      await writeNotification(tx, {
        tripId: event.tripId,
        userId: member.userId,
        dedupeKey: `${dedupePrefix}:${member.userId}`,
        type: 'TRIP_CLOSED',
        title: 'Trip closed',
        message: 'An authorized trip manager finalized this trip.',
        metadata: { tripId: event.tripId },
      });
    }
    return;
  }

  if (
    event.eventType === 'TRIP_EXPENSE_CREATED'
    || event.eventType === 'TRIP_EXPENSE_CORRECTED'
    || event.eventType === 'TRIP_EXPENSE_REVERSED'
  ) {
    const expense = await tx.expense.findFirst({
      where: { id: payload.entityId, tripId: event.tripId },
      select: { title: true },
    });
    if (!expense) return;
    const members = await tx.tripMember.findMany({
      where: {
        tripId: event.tripId,
        isActive: true,
        joinedAt: { lte: event.createdAt },
        userId: { not: payload.actorUserId },
      },
      select: { userId: true },
    });
    const created = event.eventType === 'TRIP_EXPENSE_CREATED';
    const reversed = event.eventType === 'TRIP_EXPENSE_REVERSED';
    for (const member of members) {
      await writeNotification(tx, {
        tripId: event.tripId,
        userId: member.userId,
        dedupeKey: `${dedupePrefix}:${member.userId}`,
        type: created ? 'EXPENSE_CREATED' : 'EXPENSE_UPDATED',
        title: created ? 'New trip expense' : reversed ? 'Trip expense reversed' : 'Trip expense updated',
        message: created
          ? `${expense.title} was added to this trip.`
          : reversed
            ? `${expense.title} was reversed.`
            : `${expense.title} was updated.`,
        metadata: { expenseId: payload.entityId, eventType: event.eventType },
      });
    }
    return;
  }

  if (event.eventType === 'SETTLEMENT_PAYMENT_SUBMITTED') {
    return;
  }

  if (!event.eventType.startsWith('SETTLEMENT_PAYMENT_')) return;
  const payment = await tx.settlementPayment.findFirst({
    where: { id: payload.entityId, settlement: { tripId: event.tripId } },
    select: {
      settlementId: true,
      settlement: { select: { debtorUserId: true, creditorUserId: true } },
    },
  });
  if (!payment) return;

  const recipientByType: Record<string, Array<{ userId: string; type: 'PAYMENT_CONFIRMED' | 'SETTLEMENT_DISPUTED' | 'PAYMENT_DISPUTE_RESOLVED' | 'PAYMENT_REFUNDED'; title: string; message: string }>> = {
    SETTLEMENT_PAYMENT_CONFIRMED: [{
      userId: payment.settlement.debtorUserId,
      type: 'PAYMENT_CONFIRMED',
      title: 'Payment receipt confirmed',
      message: 'The creditor confirmed receipt of your recorded settlement payment.',
    }],
    SETTLEMENT_PAYMENT_DISPUTED: [{
      userId: payment.settlement.debtorUserId,
      type: 'SETTLEMENT_DISPUTED',
      title: 'Payment disputed',
      message: 'The creditor disputed a recorded settlement payment. Review the settlement details.',
    }],
    SETTLEMENT_PAYMENT_RESOLVED: [payment.settlement.debtorUserId, payment.settlement.creditorUserId].map((userId) => ({
      userId,
      type: 'PAYMENT_DISPUTE_RESOLVED',
      title: 'Payment dispute resolved',
      message: 'An authorized trip manager resolved a settlement payment dispute.',
    })),
    SETTLEMENT_PAYMENT_REFUNDED: [payment.settlement.debtorUserId, payment.settlement.creditorUserId].map((userId) => ({
      userId,
      type: 'PAYMENT_REFUNDED',
      title: 'Settlement refund recorded',
      message: 'A refund was recorded for a settlement payment.',
    })),
  };
  const recipients = recipientByType[event.eventType] ?? [];
  for (const recipient of recipients) {
    await writeNotification(tx, {
      tripId: event.tripId,
      userId: recipient.userId,
      dedupeKey: `${dedupePrefix}:${recipient.userId}`,
      type: recipient.type,
      title: recipient.title,
      message: recipient.message,
      metadata: { paymentId: payload.entityId, settlementId: payment.settlementId },
    });
  }
}

export async function processOutboxBatch(client: PrismaClient, batchSize = 50, tripId?: string) {
  const claimed = await client.$transaction(async (tx) => {
    const now = new Date();
    const lockCutoff = new Date(now.getTime() - 30_000);
    const tripFilter = tripId ? Prisma.sql`AND ${ident('tripId')} = ${tripId}` : Prisma.empty;
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT ${ident('id')}
      FROM ${ident('OutboxEvent')}
      WHERE ${ident('processedAt')} IS NULL
        AND ${ident('nextAttemptAt')} <= ${now}
        AND (${ident('lockedAt')} IS NULL OR ${ident('lockedAt')} < ${lockCutoff})
        ${tripFilter}
      ORDER BY ${ident('createdAt')}, ${ident('id')}
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED
    `);
    if (!rows.length) return [];

    const ids = rows.map((row) => row.id);
    await tx.outboxEvent.updateMany({
      where: { id: { in: ids } },
      data: { lockedAt: new Date(), attempts: { increment: 1 } },
    });
    return tx.outboxEvent.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        tripId: true,
        tripSequence: true,
        eventKey: true,
        eventType: true,
        payload: true,
        createdAt: true,
        attempts: true,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  });

  let firstDeliveryError: unknown;
  for (const event of claimed) {
    try {
      await client.$transaction(async (tx) => {
        const [lockedEvent] = await tx.$queryRaw<Array<{ processedAt: Date | null }>>(Prisma.sql`
          SELECT ${ident('processedAt')}
          FROM ${ident('OutboxEvent')}
          WHERE ${ident('id')} = ${event.id}
          FOR UPDATE
        `);
        if (!lockedEvent || lockedEvent.processedAt) return;
        await materializeTripNotifications(tx, event);
        await tx.outboxEvent.update({
          where: { id: event.id },
          data: { processedAt: new Date(), lockedAt: null, lastError: null },
        });
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Trip event delivery failed.';
      await client.outboxEvent.updateMany({
        where: { id: event.id, processedAt: null },
        data: {
          lockedAt: null,
          lastError: message.slice(0, 1000),
          nextAttemptAt: new Date(Date.now() + getOutboxRetryDelay(event.attempts)),
        },
      });
      firstDeliveryError ??= error;
    }
  }

  if (firstDeliveryError) throw firstDeliveryError;
  return claimed.length;
}

export function startOutboxWorker(client: PrismaClient, intervalMs = 1_000) {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    void processOutboxBatch(client)
      .catch((error: unknown) => {
        console.error('Outbox event processing failed.', error);
      })
      .finally(() => {
        running = false;
      });
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
