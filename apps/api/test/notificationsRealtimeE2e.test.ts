import { afterAll, describe, expect, it } from 'vitest';

import app from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { processOutboxBatch } from '../src/services/outboxService.js';

type RegisteredUser = { id: string; token: string; email: string };

async function postJson(baseUrl: string, path: string, body: unknown, token?: string) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  return { response, payload: await response.json() };
}

async function getJson(baseUrl: string, path: string, token?: string) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  return { response, payload: await response.json() };
}

async function readUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
  expected: string,
) {
  const decoder = new TextDecoder();
  let output = '';
  while (!signal.aborted && !output.includes(expected)) {
    try {
      const { value, done } = await reader.read();
      if (done) break;
      output += decoder.decode(value, { stream: true });
    } catch (error) {
      if (!signal.aborted) throw error;
      break;
    }
  }
  return output;
}

describe('MySQL recipient notifications and shared trip event stream', () => {
  it('isolates notification history and unread actions, and streams authorized trip events', async () => {
    const server = app.listen(0);
    const emailPrefix = `notifications-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const users: RegisteredUser[] = [];
    let tripId: string | undefined;
    let streamAbort: AbortController | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Server did not bind to a TCP port.');
      const baseUrl = `http://127.0.0.1:${address.port}`;

      for (const [index, label] of ['Owner', 'Member One', 'Member Two', 'Outsider', 'Late Member'].entries()) {
        const { response, payload } = await postJson(baseUrl, '/api/auth/register', {
          email: `${emailPrefix}-${index}@example.com`,
          password: 'StrongPass!123',
          fullName: label,
        });
        expect(response.status).toBe(201);
        users.push({ id: payload.user.id, token: payload.token, email: payload.user.email });
      }

      const [owner, memberOne, memberTwo, outsider, lateMember] = users;
      const createdTrip = await postJson(baseUrl, '/api/trips', {
        name: 'Notifications E2E',
        baseCurrency: 'INR',
      }, owner.token);
      expect(createdTrip.response.status).toBe(201);
      tripId = createdTrip.payload.trip.id;
      await prisma.tripMember.createMany({
        data: [memberOne, memberTwo].map((member) => ({
          tripId: tripId!,
          userId: member.id,
          role: 'MEMBER' as const,
        })),
      });

      const expense = await postJson(baseUrl, `/api/trips/${tripId}/expenses`, {
        title: 'Shared dinner',
        amount: '24.00',
        currency: 'INR',
        category: 'Food',
        expenseType: 'GROUP',
        splitMethod: 'EQUAL',
        paymentMethod: 'CASH',
        date: new Date().toISOString(),
        splits: [{ userId: owner.id }, { userId: memberOne.id }],
        payers: [{ userId: owner.id, amount: '24.00' }],
      }, owner.token);
      expect(expense.response.status).toBe(201);
      const expenseEvent = await prisma.outboxEvent.findFirstOrThrow({
        where: { tripId, eventType: 'TRIP_EXPENSE_CREATED' },
        select: { createdAt: true },
      });
      await prisma.tripMember.create({
        data: {
          tripId,
          userId: lateMember.id,
          role: 'MEMBER',
          joinedAt: new Date(expenseEvent.createdAt.getTime() + 1_000),
        },
      });
      await processOutboxBatch(prisma, 50, tripId);

      const memberHistory = await getJson(baseUrl, `/api/trips/${tripId}/notifications`, memberOne.token);
      const secondMemberHistory = await getJson(baseUrl, `/api/trips/${tripId}/notifications`, memberTwo.token);
      const ownerHistory = await getJson(baseUrl, `/api/trips/${tripId}/notifications`, owner.token);
      const lateMemberHistory = await getJson(baseUrl, `/api/trips/${tripId}/notifications`, lateMember.token);
      expect(memberHistory.payload).toMatchObject({ unreadCount: 1 });
      expect(memberHistory.payload.notifications).toHaveLength(1);
      expect(memberHistory.payload.notifications[0]).toMatchObject({
        type: 'EXPENSE_CREATED',
        title: 'New trip expense',
        isRead: false,
      });
      expect(secondMemberHistory.payload.notifications).toHaveLength(1);
      expect(ownerHistory.payload.notifications).toHaveLength(0);
      expect(lateMemberHistory.payload.notifications).toHaveLength(0);
      expect((await getJson(baseUrl, `/api/trips/${tripId}/notifications`, outsider.token)).response.status).toBe(403);
      expect((await getJson(baseUrl, `/api/trips/${tripId}/notifications`)).response.status).toBe(401);

      const notificationId = memberHistory.payload.notifications[0].id as string;
      const unauthorizedRead = await fetch(
        `${baseUrl}/api/trips/${tripId}/notifications/${notificationId}/read`,
        { method: 'PATCH', headers: { Authorization: `Bearer ${owner.token}` } },
      );
      expect(unauthorizedRead.status).toBe(404);
      const markedRead = await fetch(
        `${baseUrl}/api/trips/${tripId}/notifications/${notificationId}/read`,
        { method: 'PATCH', headers: { Authorization: `Bearer ${memberOne.token}` } },
      );
      expect(markedRead.status).toBe(200);
      expect(await markedRead.json()).toMatchObject({ unreadCount: 0 });
      const markAll = await fetch(`${baseUrl}/api/trips/${tripId}/notifications/read-all`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${memberTwo.token}` },
      });
      expect(await markAll.json()).toMatchObject({ unreadCount: 0 });

      expect((await getJson(baseUrl, `/api/trips/${tripId}/events`, outsider.token)).response.status).toBe(403);
      expect((await getJson(baseUrl, `/api/trips/${tripId}/events`)).response.status).toBe(401);
      streamAbort = new AbortController();
      const stream = await fetch(`${baseUrl}/api/trips/${tripId}/events`, {
        headers: {
          Authorization: `Bearer ${memberOne.token}`,
          'Last-Event-ID': '0',
        },
        signal: streamAbort.signal,
      });
      expect(stream.status).toBe(200);
      expect(stream.headers.get('content-type')).toContain('text/event-stream');
      reader = stream.body!.getReader();
      const streamTimer = setTimeout(() => streamAbort?.abort(), 8_000);
      let streamText: string;
      try {
        streamText = await readUntil(reader, streamAbort.signal, 'id: 1');
      } finally {
        clearTimeout(streamTimer);
      }
      expect(streamText).toContain('event: ready');
      expect(streamText).toContain('event: trip-change');
      expect(streamText).toContain('"type":"TRIP_EXPENSE_CREATED"');
      expect(streamText).not.toContain('24.00');
      await reader.cancel();

      streamAbort = new AbortController();
      const revocationStream = await fetch(`${baseUrl}/api/trips/${tripId}/events`, {
        headers: {
          Authorization: `Bearer ${memberTwo.token}`,
          'Last-Event-ID': '1',
        },
        signal: streamAbort.signal,
      });
      reader = revocationStream.body!.getReader();
      const readyFrame = await readUntil(reader, streamAbort.signal, 'event: ready');
      expect(readyFrame).toContain('event: ready');
      await prisma.tripMember.update({
        where: { tripId_userId: { tripId, userId: memberTwo.id } },
        data: { isActive: false },
      });
      const revokeTimer = setTimeout(() => streamAbort?.abort(), 8_000);
      let revokeText: string;
      try {
        revokeText = await readUntil(reader, streamAbort.signal, 'event: access-revoked');
      } finally {
        clearTimeout(revokeTimer);
      }
      expect(revokeText).toContain('event: access-revoked');

      const retryEvent = await prisma.outboxEvent.create({
        data: {
          tripId,
          eventKey: `retry-test:${tripId}`,
          eventType: 'TRIP_EXPENSE_CREATED',
          payload: {},
          nextAttemptAt: new Date(0),
        },
      });
      await expect(processOutboxBatch(prisma, 50, tripId)).rejects.toThrow('has an invalid payload');
      expect(await prisma.outboxEvent.findUniqueOrThrow({ where: { id: retryEvent.id } })).toMatchObject({
        attempts: 1,
        processedAt: null,
        lockedAt: null,
      });
      await prisma.outboxEvent.update({
        where: { id: retryEvent.id },
        data: {
          payload: { entityType: 'Expense', entityId: 'missing-expense', actorUserId: owner.id },
          nextAttemptAt: new Date(0),
        },
      });
      await processOutboxBatch(prisma, 50, tripId);
      expect(await prisma.outboxEvent.findUniqueOrThrow({ where: { id: retryEvent.id } })).toMatchObject({
        attempts: 2,
        processedAt: expect.any(Date),
        lastError: null,
      });
    } finally {
      streamAbort?.abort();
      await reader?.cancel().catch(() => undefined);
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
      if (tripId) {
        await prisma.financialEntry.deleteMany({ where: { tripId, reversalOfId: { not: null } } });
        await prisma.financialEntry.deleteMany({ where: { tripId } });
        await prisma.expense.deleteMany({ where: { tripId, correctedFromExpenseId: { not: null } } });
        await prisma.expense.deleteMany({ where: { tripId } });
        await prisma.trip.delete({ where: { id: tripId } });
      }
      for (const user of users) {
        await prisma.user.delete({ where: { id: user.id } });
      }
    }
  }, 60_000);
});

afterAll(async () => {
  await prisma.$disconnect();
});
