import type { Response } from 'express';

import { prisma } from '../lib/prisma.js';
import type { TripAwareRequest } from '../middleware/tripAccess.js';
import { verifyAuthToken } from '../services/authService.js';
import { decodeTripEventCursor } from '../services/outboxService.js';

function toSingleString(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

function decodeNotificationCursor(value: string) {
  try {
    const [timestamp, id, extra] = Buffer.from(value, 'base64url').toString('utf8').split('\n');
    const createdAt = new Date(timestamp);
    if (!timestamp || !id || extra !== undefined || !Number.isFinite(createdAt.getTime())) {
      throw new Error('Invalid notification cursor.');
    }
    return { createdAt, id };
  } catch {
    throw new Error('Invalid notification cursor.');
  }
}

export async function listTripNotifications(req: TripAwareRequest, res: Response) {
  const tripId = toSingleString(req.params.tripId);
  const userId = req.tripMember!.userId;
  const rawLimit = Number(req.query.limit ?? 20);
  if (!Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > 100) {
    res.status(400).json({ message: 'Notification limit must be between 1 and 100.' });
    return;
  }

  let cursor: ReturnType<typeof decodeNotificationCursor> | null = null;
  const rawCursor = toSingleString(req.query.cursor as string | string[] | undefined);
  if (rawCursor) {
    try {
      cursor = decodeNotificationCursor(rawCursor);
    } catch {
      res.status(400).json({ message: 'Invalid notification cursor.' });
      return;
    }
  }

  const [rows, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: {
        tripId,
        userId,
        ...(cursor
          ? {
              OR: [
                { createdAt: { lt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        type: true,
        title: true,
        message: true,
        metadata: true,
        isRead: true,
        resolvedAt: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: rawLimit + 1,
    }),
    prisma.notification.count({ where: { tripId, userId, isRead: false } }),
  ]);
  const hasMore = rows.length > rawLimit;
  const notifications = hasMore ? rows.slice(0, rawLimit) : rows;
  const last = notifications.at(-1);
  res.json({
    notifications,
    unreadCount,
    nextCursor: hasMore && last
      ? Buffer.from(`${last.createdAt.toISOString()}\n${last.id}`).toString('base64url')
      : null,
  });
}

export async function markTripNotificationRead(req: TripAwareRequest, res: Response) {
  const tripId = toSingleString(req.params.tripId);
  const notificationId = toSingleString(req.params.notificationId);
  const userId = req.tripMember!.userId;
  const changed = await prisma.notification.updateMany({
    where: { id: notificationId, tripId, userId, isRead: false },
    data: { isRead: true },
  });
  if (!changed.count) {
    const notification = await prisma.notification.findFirst({
      where: { id: notificationId, tripId, userId },
      select: { id: true },
    });
    if (!notification) {
      res.status(404).json({ message: 'Notification not found.' });
      return;
    }
  }
  const unreadCount = await prisma.notification.count({ where: { tripId, userId, isRead: false } });
  res.json({ unreadCount });
}

export async function markAllTripNotificationsRead(req: TripAwareRequest, res: Response) {
  const tripId = toSingleString(req.params.tripId);
  const userId = req.tripMember!.userId;
  const unreadCount = await prisma.$transaction(async (tx) => {
    await tx.notification.updateMany({
      where: { tripId, userId, isRead: false },
      data: { isRead: true },
    });
    return tx.notification.count({ where: { tripId, userId, isRead: false } });
  });
  res.json({ unreadCount });
}

function writeSse(res: Response, event: string, data: unknown, id?: string) {
  if (id) res.write(`id: ${id}\n`);
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export async function streamTripEvents(req: TripAwareRequest, res: Response) {
  const tripId = toSingleString(req.params.tripId);
  const token = req.get('authorization')?.replace(/^Bearer\s+/i, '').trim() ?? '';
  const rawCursor = req.get('Last-Event-ID');
  let cursor: bigint | null = null;
  if (rawCursor) {
    try {
      cursor = decodeTripEventCursor(rawCursor);
    } catch {
      res.status(400).json({ message: 'Invalid trip event cursor.' });
      return;
    }
  }

  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    select: { eventSequence: true },
  });
  if (!trip) {
    res.status(404).json({ message: 'Trip not found.' });
    return;
  }
  let initialCursor = cursor;
  if (initialCursor === null) {
    const earliestPending = await prisma.outboxEvent.findFirst({
      where: { tripId, tripSequence: { not: null }, processedAt: null },
      select: { tripSequence: true },
      orderBy: { tripSequence: 'asc' },
    });
    if (earliestPending?.tripSequence !== null && earliestPending?.tripSequence !== undefined) {
      const lastProcessedBeforePending = await prisma.outboxEvent.findFirst({
        where: {
          tripId,
          tripSequence: { lt: earliestPending.tripSequence },
          processedAt: { not: null },
        },
        select: { tripSequence: true },
        orderBy: { tripSequence: 'desc' },
      });
      initialCursor = lastProcessedBeforePending?.tripSequence ?? 0n;
    } else {
      initialCursor = trip.eventSequence;
    }
  }
  if (initialCursor > trip.eventSequence) {
    res.status(400).json({ message: 'Trip event cursor is ahead of the current event stream.' });
    return;
  }

  res.status(200);
  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  writeSse(res, 'ready', { cursor: initialCursor.toString() });

  let closed = false;
  let cursorValue = initialCursor;
  let lastHeartbeat = Date.now();
  let nextAccessCheck = 0;
  res.on('close', () => { closed = true; });

  try {
    while (!closed) {
      if (Date.now() >= nextAccessCheck) {
        nextAccessCheck = Date.now() + 5_000;
        try {
          verifyAuthToken(token);
        } catch {
          writeSse(res, 'session-expired', {});
          break;
        }
        const membership = await prisma.tripMember.findFirst({
          where: { tripId, userId: req.user!.id, isActive: true },
          select: { id: true },
        });
        if (!membership) {
          writeSse(res, 'access-revoked', {});
          break;
        }
      }

      const events = await prisma.outboxEvent.findMany({
        where: { tripId, tripSequence: { gt: cursorValue } },
        select: { tripSequence: true, eventType: true, processedAt: true },
        orderBy: { tripSequence: 'asc' },
        take: 100,
      });
      for (const event of events) {
        if (closed || event.tripSequence === null) break;
        if (!event.processedAt) break;
        cursorValue = event.tripSequence;
        writeSse(res, 'trip-change', { type: event.eventType }, cursorValue.toString());
      }
      if (Date.now() - lastHeartbeat >= 15_000) {
        res.write(': keepalive\n\n');
        lastHeartbeat = Date.now();
      }
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
  } catch (error) {
    console.error('Trip event stream failed.', error);
  } finally {
    if (!res.writableEnded) res.end();
  }
}
