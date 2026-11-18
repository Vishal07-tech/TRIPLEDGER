import { afterAll, describe, expect, it } from 'vitest';

import app from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';

type TestUser = { id: string; token: string };

async function postJson(baseUrl: string, path: string, body: unknown, token?: string) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: ['Bearer', token].join(' ') } : {}),
    },
    body: JSON.stringify(body),
  });
  return { response, payload: await response.json() };
}

async function getJson(baseUrl: string, path: string, token: string) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { Authorization: ['Bearer', token].join(' ') },
  });
  return { response, payload: await response.json() };
}

async function setBudget(baseUrl: string, tripId: string, userId: string, amount: string, token: string) {
  return postJson(baseUrl, `/api/trips/${tripId}/budgets`, { userId, plannedBudget: amount }, token);
}

async function createPersonalExpense(
  baseUrl: string,
  tripId: string,
  actor: TestUser,
  responsibleUserId: string,
  amount: string,
  title: string,
) {
  return postJson(
    baseUrl,
    `/api/trips/${tripId}/expenses`,
    {
      title,
      amount,
      currency: 'INR',
      category: 'Test',
      expenseType: 'PERSONAL',
      splitMethod: 'EQUAL',
      paymentMethod: 'UPI',
      date: new Date().toISOString(),
      responsibleUserId,
      payers: [{ userId: responsibleUserId, amount }],
    },
    actor.token,
  );
}

describe('MySQL budget notification lifecycle and recipient access', () => {
  it('resolves and recreates threshold warnings, and isolates notifications by recipient and trip', async () => {
    const server = app.listen(0);
    const users: TestUser[] = [];
    const tripIds: string[] = [];

    try {
      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Server did not bind to a TCP port.');
      }
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const emailPrefix = `budget-notification-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      for (const [index, fullName] of ['Trip A owner', 'Shared member', 'Trip B owner'].entries()) {
        const { response, payload } = await postJson(baseUrl, '/api/auth/register', {
          email: `${emailPrefix}-${index}@example.com`,
          password: 'StrongPass!123',
          fullName,
        }, '');
        expect(response.status).toBe(201);
        users.push({ id: payload.user.id, token: payload.token });
      }

      const [tripAOwner, sharedMember, tripBOwner] = users;
      const tripAResult = await postJson(
        baseUrl,
        '/api/trips',
        { name: 'Budget warning trip A', baseCurrency: 'INR' },
        tripAOwner.token,
      );
      expect(tripAResult.response.status).toBe(201);
      const tripAId = tripAResult.payload.trip.id as string;
      tripIds.push(tripAId);
      await prisma.tripMember.create({
        data: { tripId: tripAId, userId: sharedMember.id, role: 'MEMBER' },
      });

      const tripBResult = await postJson(
        baseUrl,
        '/api/trips',
        { name: 'Budget warning trip B', baseCurrency: 'INR' },
        tripBOwner.token,
      );
      expect(tripBResult.response.status).toBe(201);
      const tripBId = tripBResult.payload.trip.id as string;
      tripIds.push(tripBId);
      await prisma.tripMember.create({
        data: { tripId: tripBId, userId: sharedMember.id, role: 'MEMBER' },
      });

      for (const [tripId, memberId, manager] of [
        [tripAId, sharedMember.id, tripAOwner],
        [tripAId, tripAOwner.id, tripAOwner],
        [tripBId, sharedMember.id, tripBOwner],
      ] as const) {
        expect((await setBudget(baseUrl, tripId, memberId, '100.00', manager.token)).response.status).toBe(201);
      }

      const firstExpense = await createPersonalExpense(
        baseUrl, tripAId, tripAOwner, sharedMember.id, '60.00', 'Initial threshold crossing',
      );
      expect(firstExpense.response.status).toBe(201);
      const ownerExpense = await createPersonalExpense(
        baseUrl, tripAId, tripAOwner, tripAOwner.id, '80.00', 'Owner threshold crossing',
      );
      expect(ownerExpense.response.status).toBe(201);
      const tripBExpense = await createPersonalExpense(
        baseUrl, tripBId, tripBOwner, sharedMember.id, '80.00', 'Other trip threshold crossing',
      );
      expect(tripBExpense.response.status).toBe(201);

      const memberTripAWarnings = await getJson(baseUrl, `/api/trips/${tripAId}/budgets`, sharedMember.token);
      expect(memberTripAWarnings.response.status).toBe(200);
      expect(memberTripAWarnings.payload.notifications).toHaveLength(1);
      expect(memberTripAWarnings.payload.notifications[0]).toMatchObject({
        title: 'Budget 50% reached',
        resolvedAt: null,
      });
      expect(memberTripAWarnings.payload.notifications[0]).not.toHaveProperty('userId');

      const ownerTripAWarnings = await getJson(baseUrl, `/api/trips/${tripAId}/budgets`, tripAOwner.token);
      expect(ownerTripAWarnings.payload.notifications).toHaveLength(2);
      expect(ownerTripAWarnings.payload.notifications.map(
        (notification: { title: string }) => notification.title,
      )).toContain('Budget 75% reached');

      const memberTripBWarnings = await getJson(baseUrl, `/api/trips/${tripBId}/budgets`, sharedMember.token);
      expect(memberTripBWarnings.response.status).toBe(200);
      expect(memberTripBWarnings.payload.notifications).toHaveLength(2);
      expect(memberTripBWarnings.payload.notifications.map(
        (notification: { id: string }) => notification.id,
      )).not.toContain(memberTripAWarnings.payload.notifications[0].id);
      expect((await getJson(baseUrl, `/api/trips/${tripBId}/budgets`, tripAOwner.token)).response.status).toBe(403);

      const firstWarningId = memberTripAWarnings.payload.notifications[0].id as string;
      expect((await setBudget(baseUrl, tripAId, sharedMember.id, '200.00', tripAOwner.token)).response.status).toBe(201);
      const budgetIncreaseResolution = await prisma.notification.findUniqueOrThrow({ where: { id: firstWarningId } });
      expect(budgetIncreaseResolution.resolvedAt).toBeInstanceOf(Date);
      expect(budgetIncreaseResolution.dedupeKey).toBeNull();

      expect((await setBudget(baseUrl, tripAId, sharedMember.id, '100.00', tripAOwner.token)).response.status).toBe(201);
      let memberWarnings = await getJson(baseUrl, `/api/trips/${tripAId}/budgets`, sharedMember.token);
      let activeFiftyPercent = memberWarnings.payload.notifications.filter(
        (notification: { title: string; resolvedAt: string | null }) =>
          notification.title === 'Budget 50% reached' && notification.resolvedAt === null,
      );
      expect(activeFiftyPercent).toHaveLength(1);
      expect(activeFiftyPercent[0].id).not.toBe(firstWarningId);

      const correction = await postJson(
        baseUrl,
        `/api/trips/${tripAId}/expenses/${firstExpense.payload.expense.id}/corrections`,
        {
          reason: 'Correcting the responsibility amount',
          replacement: {
            title: 'Corrected threshold expense',
            amount: '40.00',
            currency: 'INR',
            category: 'Test',
            expenseType: 'PERSONAL',
            splitMethod: 'EQUAL',
            paymentMethod: 'UPI',
            date: new Date().toISOString(),
            responsibleUserId: sharedMember.id,
            payers: [{ userId: sharedMember.id, amount: '40.00' }],
          },
        },
        tripAOwner.token,
      );
      expect(correction.response.status).toBe(201);
      memberWarnings = await getJson(baseUrl, `/api/trips/${tripAId}/budgets`, sharedMember.token);
      activeFiftyPercent = memberWarnings.payload.notifications.filter(
        (notification: { title: string; resolvedAt: string | null }) =>
          notification.title === 'Budget 50% reached' && notification.resolvedAt === null,
      );
      expect(activeFiftyPercent).toHaveLength(0);
      expect(memberWarnings.payload.notifications.some(
        (notification: { title: string; resolvedAt: string | null }) =>
          notification.title === 'Budget 50% reached' && notification.resolvedAt !== null,
      )).toBe(true);

      const recrossingExpense = await createPersonalExpense(
        baseUrl, tripAId, tripAOwner, sharedMember.id, '60.00', 'Reversal lifecycle expense',
      );
      expect(recrossingExpense.response.status).toBe(201);
      const recrossingWarnings = await getJson(baseUrl, `/api/trips/${tripAId}/budgets`, sharedMember.token);
      activeFiftyPercent = recrossingWarnings.payload.notifications.filter(
        (notification: { title: string; resolvedAt: string | null }) =>
          notification.title === 'Budget 50% reached' && notification.resolvedAt === null,
      );
      expect(activeFiftyPercent).toHaveLength(1);
      const reversal = await postJson(
        baseUrl,
        `/api/trips/${tripAId}/expenses/${recrossingExpense.payload.expense.id}/reversal`,
        { reason: 'Reversing the threshold test expense' },
        tripAOwner.token,
      );
      expect(reversal.response.status).toBe(200);
      memberWarnings = await getJson(baseUrl, `/api/trips/${tripAId}/budgets`, sharedMember.token);
      activeFiftyPercent = memberWarnings.payload.notifications.filter(
        (notification: { title: string; resolvedAt: string | null }) =>
          notification.title === 'Budget 50% reached' && notification.resolvedAt === null,
      );
      expect(activeFiftyPercent).toHaveLength(0);

      const finalExpense = await createPersonalExpense(
        baseUrl, tripAId, tripAOwner, sharedMember.id, '10.00', 'Duplicate active warning check',
      );
      expect(finalExpense.response.status).toBe(201);
      for (let attempt = 0; attempt < 2; attempt += 1) {
        expect((await setBudget(baseUrl, tripAId, sharedMember.id, '100.00', tripAOwner.token)).response.status).toBe(201);
      }
      memberWarnings = await getJson(baseUrl, `/api/trips/${tripAId}/budgets`, sharedMember.token);
      const finalActiveWarnings = memberWarnings.payload.notifications.filter(
        (notification: { resolvedAt: string | null }) => notification.resolvedAt === null,
      );
      expect(finalActiveWarnings).toHaveLength(1);
      expect(finalActiveWarnings.map((notification: { title: string }) => notification.title).sort()).toEqual([
        'Budget 50% reached',
      ]);
      const activeWarningRows = await prisma.notification.findMany({
        where: {
          tripId: tripAId,
          userId: sharedMember.id,
          type: { in: ['BUDGET_APPROACHING', 'BUDGET_EXCEEDED'] },
          resolvedAt: null,
        },
      });
      const activeByThreshold = new Map<number, number>();
      for (const row of activeWarningRows) {
        const threshold = Number((row.dedupeKey ?? '').split(':').at(-1));
        activeByThreshold.set(threshold, (activeByThreshold.get(threshold) ?? 0) + 1);
      }
      expect([...activeByThreshold.values()].every((count) => count === 1)).toBe(true);
      expect((await prisma.memberBudget.findUniqueOrThrow({
        where: { tripId_userId: { tripId: tripAId, userId: sharedMember.id } },
      })).warningLevel).toBe('approaching');
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      for (const tripId of tripIds) {
        await prisma.notification.deleteMany({ where: { tripId } });
        await prisma.financialEntry.deleteMany({ where: { tripId, reversalOfId: { not: null } } });
        await prisma.financialEntry.deleteMany({ where: { tripId } });
        await prisma.expense.deleteMany({ where: { tripId, correctedFromExpenseId: { not: null } } });
        await prisma.expense.deleteMany({ where: { tripId } });
        await prisma.memberBudget.deleteMany({ where: { tripId } });
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
