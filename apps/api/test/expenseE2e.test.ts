import { afterAll, describe, expect, it } from 'vitest';

import app from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { parseMoneyToMinor, parseStoredMoneyToMinor } from '../src/services/financialMath.js';
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

describe('MySQL expense and ledger workflows', () => {
  it('records split responsibility separately from payers, budgets, corrections and reversals', async () => {
    const server = app.listen(0);
    const emailPrefix = `expense-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const users: RegisteredUser[] = [];
    let tripId: string | undefined;

    try {
      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Server did not bind to a TCP port.');
      }
      const baseUrl = `http://127.0.0.1:${address.port}`;

      for (const [index, label] of ['Owner', 'Member One', 'Member Two', 'Outsider'].entries()) {
        const { response, payload } = await postJson(baseUrl, '/api/auth/register', {
          email: `${emailPrefix}-${index}@example.com`,
          password: 'StrongPass!123',
          fullName: label,
        });
        expect(response.status).toBe(201);
        users.push({ id: payload.user.id, token: payload.token, email: payload.user.email });
      }

      const [owner, memberOne, memberTwo, outsider] = users;
      const tripResult = await postJson(
        baseUrl,
        '/api/trips',
        { name: 'Expense Ledger E2E', baseCurrency: 'INR' },
        owner.token,
      );
      expect(tripResult.response.status).toBe(201);
      tripId = tripResult.payload.trip.id;

      await prisma.tripMember.createMany({
        data: [memberOne, memberTwo].map((member) => ({
          tripId: tripId!,
          userId: member.id,
          role: 'MEMBER' as const,
        })),
      });

      for (const member of [owner, memberOne, memberTwo]) {
        const { response } = await postJson(
          baseUrl,
          `/api/trips/${tripId}/budgets`,
          { userId: member.id, plannedBudget: member.id === memberTwo.id ? 10 : 4 },
          owner.token,
        );
        expect(response.status).toBe(201);
      }
      const budgetEvents = await prisma.outboxEvent.findMany({
        where: { tripId, eventType: 'TRIP_BUDGET_UPDATED' },
      });
      expect(budgetEvents).toHaveLength(3);
      expect(budgetEvents.every((event) =>
        (event.payload as { actorUserId?: string }).actorUserId === owner.id,
      )).toBe(true);

      const groupExpense = {
        title: 'Shared meal',
        amount: '10.01',
        currency: 'INR',
        category: 'Food',
        expenseType: 'GROUP',
        splitMethod: 'EQUAL',
        paymentMethod: 'CASH',
        date: new Date().toISOString(),
        splits: [{ userId: owner.id }, { userId: memberOne.id }],
        payers: [
          { userId: owner.id, amount: '6.01' },
          { userId: memberOne.id, amount: '4.00' },
        ],
      };
      const createdGroup = await postJson(
        baseUrl,
        `/api/trips/${tripId}/expenses`,
        groupExpense,
        owner.token,
      );
      expect(createdGroup.response.status).toBe(201);
      const group = createdGroup.payload.expense;
      const expenseCreatedEvent = await prisma.outboxEvent.findUniqueOrThrow({
        where: { eventKey: `expense:${group.id}:created` },
      });
      expect(expenseCreatedEvent).toMatchObject({
        tripId,
        eventType: 'TRIP_EXPENSE_CREATED',
        payload: { entityType: 'Expense', entityId: group.id, actorUserId: owner.id },
      });
      expect(Object.keys(expenseCreatedEvent.payload as object).sort()).toEqual([
        'actorUserId',
        'entityId',
        'entityType',
      ]);
      const sequencedEvents = await prisma.outboxEvent.findMany({
        where: { tripId },
        orderBy: { tripSequence: 'asc' },
        select: { tripSequence: true },
      });
      expect(sequencedEvents.map((event) => event.tripSequence)).toEqual([1n, 2n, 3n, 4n]);
      await Promise.all([
        processOutboxBatch(prisma, 50, tripId),
        processOutboxBatch(prisma, 50, tripId),
      ]);
      const createdNotifications = await prisma.notification.findMany({
        where: { tripId, type: 'EXPENSE_CREATED' },
        select: { userId: true, dedupeKey: true },
      });
      expect(createdNotifications).toHaveLength(2);
      expect(createdNotifications.map((notification) => notification.userId).sort()).toEqual(
        [memberOne.id, memberTwo.id].sort(),
      );
      await processOutboxBatch(prisma, 50, tripId);
      expect(await prisma.notification.count({ where: { tripId, type: 'EXPENSE_CREATED' } })).toBe(2);
      expect((await prisma.outboxEvent.findUniqueOrThrow({ where: { id: expenseCreatedEvent.id } })).processedAt)
        .toBeInstanceOf(Date);
      expect(group.payers.find((payer: { userId: string }) => payer.userId === owner.id)?.isCashManagerDisbursement).toBe(true);
      expect(
        group.allocations.reduce(
          (sum: bigint, allocation: { allocatedAmount: string }) =>
            sum + parseMoneyToMinor(allocation.allocatedAmount, 'INR'),
          0n,
        ),
      ).toBe(parseMoneyToMinor(groupExpense.amount, 'INR'));
      expect(group.allocations.map((allocation: { userId: string }) => allocation.userId).sort()).toEqual([owner.id, memberOne.id].sort());

      const invalidCash = await postJson(
        baseUrl,
        `/api/trips/${tripId}/expenses`,
        {
          ...groupExpense,
          title: 'Missing cash manager',
          payers: [{ userId: memberOne.id, amount: '10.01' }],
        },
        owner.token,
      );
      expect(invalidCash.response.status).toBe(400);

      const personalExpense = await postJson(
        baseUrl,
        `/api/trips/${tripId}/expenses`,
        {
          title: 'Personal ticket',
          amount: '5.00',
          currency: 'INR',
          category: 'Transport',
          expenseType: 'PERSONAL',
          splitMethod: 'EQUAL',
          paymentMethod: 'UPI',
          date: new Date().toISOString(),
          responsibleUserId: memberTwo.id,
          payers: [{ userId: memberOne.id, amount: '5.00' }],
        },
        owner.token,
      );
      expect(personalExpense.response.status).toBe(201);
      const personal = personalExpense.payload.expense;
      expect(personal.allocations).toHaveLength(1);
      expect(personal.allocations[0].userId).toBe(memberTwo.id);
      expect(personal.payers[0].userId).toBe(memberOne.id);
      expect(personal.payers[0].paymentStatus).toBe('PENDING');
      expect(personal.payers[0].isCashManagerDisbursement).toBe(false);

      const outsiderResponse = await fetch(`${baseUrl}/api/trips/${tripId}/expenses`, {
        headers: { Authorization: `Bearer ${outsider.token}` },
      });
      expect(outsiderResponse.status).toBe(403);

      const budgetsBeforeCorrection = await prisma.memberBudget.findMany({ where: { tripId } });
      const budgetByUser = new Map(budgetsBeforeCorrection.map((budget) => [budget.userId, budget]));
      expect(String(budgetByUser.get(memberTwo.id)?.remainingBudget)).toBe('5');
      const memberOneGroupShare = parseMoneyToMinor(
        group.allocations.find((allocation: { userId: string }) => allocation.userId === memberOne.id).allocatedAmount,
        'INR',
      );
      expect(
        parseStoredMoneyToMinor(String(budgetByUser.get(memberOne.id)?.remainingBudget), 'INR'),
      ).toBe(400n - memberOneGroupShare);

      const correction = await postJson(
        baseUrl,
        `/api/trips/${tripId}/expenses/${group.id}/corrections`,
        {
          reason: 'Correcting the receipt total',
          replacement: {
            ...groupExpense,
            title: 'Corrected shared meal',
            amount: '12.00',
            splitMethod: 'EXACT',
            splits: [
              { userId: owner.id, amount: '6.00' },
              { userId: memberOne.id, amount: '6.00' },
            ],
            payers: [
              { userId: owner.id, amount: '8.00' },
              { userId: memberOne.id, amount: '4.00' },
            ],
          },
        },
        owner.token,
      );
      expect(correction.response.status).toBe(201);
      const corrected = correction.payload.expense;
      expect(corrected.correctedFromExpenseId).toBe(group.id);
      expect(await prisma.outboxEvent.findUniqueOrThrow({
        where: { eventKey: `expense:${corrected.id}:corrected` },
      })).toMatchObject({
        tripId,
        eventType: 'TRIP_EXPENSE_CORRECTED',
        payload: {
          entityType: 'Expense',
          entityId: corrected.id,
          actorUserId: owner.id,
          relatedEntityId: group.id,
        },
      });
      expect((await prisma.expense.findUnique({ where: { id: group.id } }))?.status).toBe('CORRECTED');

      const reversal = await postJson(
        baseUrl,
        `/api/trips/${tripId}/expenses/${personal.id}/reversal`,
        { reason: 'Receipt was entered in error' },
        owner.token,
      );
      expect(reversal.response.status).toBe(200);
      expect(await prisma.outboxEvent.findUniqueOrThrow({
        where: { eventKey: `expense:${personal.id}:reversed` },
      })).toMatchObject({
        tripId,
        eventType: 'TRIP_EXPENSE_REVERSED',
        payload: { entityType: 'Expense', entityId: personal.id, actorUserId: owner.id },
      });
      expect((await prisma.expense.findUnique({ where: { id: personal.id } }))?.status).toBe('REVERSED');
      const duplicateReversal = await postJson(
        baseUrl,
        `/api/trips/${tripId}/expenses/${personal.id}/reversal`,
        { reason: 'Attempt duplicate reversal' },
        owner.token,
      );
      expect(duplicateReversal.response.status).toBe(400);

      const personalHistoryResponse = await fetch(
        `${baseUrl}/api/trips/${tripId}/expenses/${personal.id}/history`,
        { headers: { Authorization: `Bearer ${owner.token}` } },
      );
      expect(personalHistoryResponse.status).toBe(200);
      const personalHistory = await personalHistoryResponse.json();
      const reversalAudit = personalHistory.history.find(
        (item: { action: string }) => item.action === 'EXPENSE_REVERSED',
      );
      expect(reversalAudit).toMatchObject({
        entityId: personal.id,
        userId: owner.id,
        action: 'EXPENSE_REVERSED',
      });

      const reversedEntries = await prisma.financialEntry.findMany({
        where: { tripId, expenseId: personal.id },
      });
      expect(reversedEntries).toHaveLength(4);
      expect(
        reversedEntries.reduce(
          (sum, entry) => sum + parseStoredMoneyToMinor(String(entry.amount), entry.currency),
          0n,
        ),
      ).toBe(0n);
      expect(reversedEntries.filter((entry) => entry.reversalOfId !== null)).toHaveLength(2);

      const cashPersonal = await postJson(
        baseUrl,
        `/api/trips/${tripId}/expenses`,
        {
          title: 'Cash manager paid another member ticket',
          amount: '7.25',
          currency: 'INR',
          category: 'Transport',
          expenseType: 'PERSONAL',
          splitMethod: 'EQUAL',
          paymentMethod: 'CASH',
          date: new Date().toISOString(),
          responsibleUserId: memberTwo.id,
          payers: [{ userId: owner.id, amount: '7.25' }],
        },
        owner.token,
      );
      expect(cashPersonal.response.status).toBe(201);
      const cashPersonalExpense = cashPersonal.payload.expense;
      expect(cashPersonalExpense.payers).toMatchObject([
        { userId: owner.id, amount: '7.25', isCashManagerDisbursement: true },
      ]);
      expect(cashPersonalExpense.allocations).toMatchObject([
        { userId: memberTwo.id, allocatedAmount: '7.25' },
      ]);
      const cashPersonalEntries = await prisma.financialEntry.findMany({
        where: { tripId, expenseId: cashPersonalExpense.id },
        orderBy: { entryType: 'asc' },
      });
      expect(cashPersonalEntries).toHaveLength(2);
      expect(cashPersonalEntries.map((entry) => ({
        userId: entry.userId,
        entryType: entry.entryType,
        amountMinor: parseStoredMoneyToMinor(String(entry.amount), entry.currency),
      }))).toEqual([
        { userId: owner.id, entryType: 'PAYER_ADVANCE', amountMinor: 725n },
        { userId: memberTwo.id, entryType: 'RESPONSIBILITY', amountMinor: -725n },
      ]);

      const balanceResponse = await fetch(`${baseUrl}/api/trips/${tripId}/expenses/balances`, {
        headers: { Authorization: `Bearer ${owner.token}` },
      });
      expect(balanceResponse.status).toBe(200);
      const balances = await balanceResponse.json();
      const balanceByUser = new Map(balances.members.map((member: { userId: string; recordedAdvances: string; responsibility: string; netBalance: string }) => [member.userId, member]));
      expect(balanceByUser.get(owner.id)).toMatchObject({
        recordedAdvances: '15.25',
        responsibility: '6.00',
        netBalance: '9.25',
      });
      expect(balanceByUser.get(memberOne.id)).toMatchObject({
        recordedAdvances: '4.00',
        responsibility: '6.00',
        netBalance: '-2.00',
      });
      expect(balanceByUser.get(memberTwo.id)).toMatchObject({
        recordedAdvances: '0.00',
        responsibility: '7.25',
        netBalance: '-7.25',
      });

      const entries = await prisma.financialEntry.findMany({ where: { tripId } });
      expect(entries).toHaveLength(18);
      expect(
        entries.reduce((sum, entry) => sum + parseStoredMoneyToMinor(String(entry.amount), entry.currency), 0n),
      ).toBe(0n);
      const budgetAfterCorrection = await prisma.memberBudget.findUnique({
        where: { tripId_userId: { tripId, userId: owner.id } },
      });
      expect(String(budgetAfterCorrection?.remainingBudget)).toBe('-2');
      const budgetAfterCashPersonalExpense = await prisma.memberBudget.findUnique({
        where: { tripId_userId: { tripId, userId: memberTwo.id } },
      });
      expect(String(budgetAfterCashPersonalExpense?.remainingBudget)).toBe('2.75');

      const budgetResponse = await fetch(`${baseUrl}/api/trips/${tripId}/budgets`, {
        headers: { Authorization: ['Bearer', owner.token].join(' ') },
      });
      expect(budgetResponse.status).toBe(200);
      const budgetPayload = await budgetResponse.json();
      const budgetByMember = new Map(
        budgetPayload.members.map((member: {
          userId: string;
          responsibility: string;
          plannedBudget: string | null;
          remainingBudget: string | null;
          warningThresholds: number[];
        }) => [member.userId, member]),
      );
      expect(budgetByMember.get(memberTwo.id)).toMatchObject({
        responsibility: '7.25',
        plannedBudget: '10.00',
        remainingBudget: '2.75',
        warningThresholds: [50],
      });
      expect(budgetByMember.get(owner.id)).toMatchObject({
        responsibility: '6.00',
        plannedBudget: '4.00',
        remainingBudget: '-2.00',
        warningThresholds: [50, 75, 90, 100],
      });
      expect(budgetPayload.trip.responsibility).toBe('19.25');
      expect(budgetPayload.forecast.method).toContain('responsibility to date');
      expect(budgetPayload.notifications.length).toBeGreaterThan(0);

      const outsiderBudget = await fetch(`${baseUrl}/api/trips/${tripId}/budgets`, {
        headers: { Authorization: ['Bearer', outsider.token].join(' ') },
      });
      expect(outsiderBudget.status).toBe(403);

      const notificationsBeforeRepeat = await prisma.notification.count({
        where: { tripId, userId: memberTwo.id, type: 'BUDGET_APPROACHING' },
      });
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const { response } = await postJson(
          baseUrl,
          `/api/trips/${tripId}/budgets`,
          { userId: memberTwo.id, plannedBudget: '10.00' },
          owner.token,
        );
        expect(response.status).toBe(201);
      }
      expect(await prisma.notification.count({
        where: { tripId, userId: memberTwo.id, type: 'BUDGET_APPROACHING' },
      })).toBe(notificationsBeforeRepeat);

      const historyResponse = await fetch(`${baseUrl}/api/trips/${tripId}/expenses/${group.id}/history`, {
        headers: { Authorization: `Bearer ${owner.token}` },
      });
      expect(historyResponse.status).toBe(200);
      const history = await historyResponse.json();
      expect(history.history.map((item: { action: string }) => item.action)).toContain('EXPENSE_CORRECTED');

      const foreignExpense = await postJson(
        baseUrl,
        `/api/trips/${tripId}/expenses`,
        {
          title: 'Foreign currency meal',
          amount: '10.01',
          currency: 'USD',
          exchangeRate: '83.125',
          category: 'Food',
          expenseType: 'GROUP',
          splitMethod: 'EQUAL',
          paymentMethod: 'UPI',
          date: new Date().toISOString(),
          splits: [{ userId: owner.id }, { userId: memberOne.id }],
          payers: [{ userId: owner.id, amount: '10.01' }],
        },
        owner.token,
      );
      expect(foreignExpense.response.status).toBe(201);
      const foreign = foreignExpense.payload.expense;
      expect(String(foreign.amount)).toBe('10.01');
      expect(foreign.currency).toBe('USD');
      expect(String(foreign.exchangeRate)).toBe('83.125');
      expect(String(foreign.convertedAmount)).toBe('832.08');
      const capturedAt = new Date(foreign.exchangeRateCapturedAt);
      expect(Number.isNaN(capturedAt.getTime())).toBe(false);
      expect(capturedAt.getTime()).toBeLessThanOrEqual(Date.now());
      expect(capturedAt.getTime()).toBeGreaterThan(Date.now() - 60_000);
      expect(
        foreignExpense.payload.expense.allocations.reduce(
          (sum: bigint, allocation: { allocatedAmount: string }) =>
            sum + parseMoneyToMinor(allocation.allocatedAmount, 'USD'),
          0n,
        ),
      ).toBe(1001n);
      expect(foreignExpense.payload.expense.payers[0].paymentStatus).toBe('PENDING');
      const foreignLedgerEntries = await prisma.financialEntry.findMany({
        where: { expenseId: foreignExpense.payload.expense.id },
      });
      expect(
        foreignLedgerEntries.reduce(
          (sum, entry) => sum + parseStoredMoneyToMinor(String(entry.amount), entry.currency),
          0n,
        ),
      ).toBe(0n);
      expect(
        foreignLedgerEntries
          .filter((entry) => entry.entryType === 'PAYER_ADVANCE')
          .reduce((sum, entry) => sum + parseStoredMoneyToMinor(String(entry.amount), entry.currency), 0n),
      ).toBe(83208n);

      const correctionCapturedAt = new Date();
      const foreignCorrection = await postJson(
        baseUrl,
        `/api/trips/${tripId}/expenses/${foreign.id}/corrections`,
        {
          reason: 'Captured exchange rate correction',
          replacement: {
            title: 'Corrected foreign currency meal',
            amount: '11.00',
            currency: 'USD',
            exchangeRate: '84.00000000',
            category: 'Food',
            expenseType: 'GROUP',
            splitMethod: 'EQUAL',
            paymentMethod: 'UPI',
            date: new Date().toISOString(),
            splits: [{ userId: owner.id }, { userId: memberOne.id }],
            payers: [{ userId: owner.id, amount: '11.00' }],
          },
        },
        owner.token,
      );
      expect(foreignCorrection.response.status).toBe(201);

      const savedOriginal = await prisma.expense.findUniqueOrThrow({ where: { id: foreign.id } });
      expect(String(savedOriginal.amount)).toBe('10.01');
      expect(savedOriginal.currency).toBe('USD');
      expect(String(savedOriginal.exchangeRate)).toBe('83.125');
      expect(String(savedOriginal.convertedAmount)).toBe('832.08');
      expect(savedOriginal.exchangeRateCapturedAt?.getTime()).toBe(capturedAt.getTime());

      const replacement = foreignCorrection.payload.expense;
      expect(String(replacement.amount)).toBe('11');
      expect(replacement.currency).toBe('USD');
      expect(String(replacement.exchangeRate)).toBe('84');
      expect(String(replacement.convertedAmount)).toBe('924');
      expect(new Date(replacement.exchangeRateCapturedAt).getTime()).toBeGreaterThanOrEqual(
        correctionCapturedAt.getTime(),
      );
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
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
