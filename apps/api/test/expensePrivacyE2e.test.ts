import { afterAll, describe, expect, it } from 'vitest';

import app from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';

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

async function listExpenses(baseUrl: string, tripId: string, token: string) {
  const response = await fetch(`${baseUrl}/api/trips/${tripId}/expenses`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return { response, payload: await response.json() };
}

function personalExpense(title: string, amount: string, responsibleUserId: string, payerUserId: string) {
  return {
    title,
    amount,
    currency: 'INR',
    category: 'Other',
    expenseType: 'PERSONAL',
    splitMethod: 'EQUAL',
    paymentMethod: 'UPI',
    date: new Date().toISOString(),
    responsibleUserId,
    payers: [{ userId: payerUserId, amount }],
  };
}

describe('Trip expense privacy and group totals', () => {
  it('shows group spending to everyone but keeps personal reports private', async () => {
    const server = app.listen(0);
    const emailPrefix = `expense-privacy-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const users: RegisteredUser[] = [];
    let tripId: string | undefined;

    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Server did not bind to a TCP port.');
      const baseUrl = `http://127.0.0.1:${address.port}`;

      for (const [index, label] of ['Owner', 'Member A', 'Member B', 'Outsider'].entries()) {
        const { response, payload } = await postJson(baseUrl, '/api/auth/register', {
          email: `${emailPrefix}-${index}@example.com`,
          password: 'StrongPass!123',
          fullName: label,
        });
        expect(response.status).toBe(201);
        users.push({ id: payload.user.id, token: payload.token, email: payload.user.email });
      }

      const [owner, memberA, memberB, outsider] = users;
      const tripResult = await postJson(
        baseUrl,
        '/api/trips',
        { name: 'Expense privacy', baseCurrency: 'INR' },
        owner.token,
      );
      expect(tripResult.response.status).toBe(201);
      tripId = tripResult.payload.trip.id;

      await prisma.tripMember.createMany({
        data: [memberA, memberB].map((member) => ({ tripId: tripId!, userId: member.id, role: 'MEMBER' as const })),
      });

      const group = await postJson(
        baseUrl,
        `/api/trips/${tripId}/expenses`,
        {
          title: 'Shared dinner',
          amount: '100.00',
          currency: 'INR',
          category: 'Food',
          expenseType: 'GROUP',
          splitMethod: 'EQUAL',
          paymentMethod: 'UPI',
          date: new Date().toISOString(),
          splits: [{ userId: owner.id }, { userId: memberA.id }],
          payers: [{ userId: owner.id, amount: '100.00' }],
        },
        owner.token,
      );
      expect(group.response.status).toBe(201);

      const ownPersonal = await postJson(
        baseUrl,
        `/api/trips/${tripId}/expenses`,
        personalExpense('Member A private coffee', '20.00', memberA.id, memberA.id),
        memberA.token,
      );
      expect(ownPersonal.response.status).toBe(201);

      const paidForB = await postJson(
        baseUrl,
        `/api/trips/${tripId}/expenses`,
        personalExpense('Owner paid for B ticket', '30.00', memberB.id, owner.id),
        owner.token,
      );
      expect(paidForB.response.status).toBe(201);

      const groupId = group.payload.expense.id;
      const ownPersonalId = ownPersonal.payload.expense.id;
      const paidForBId = paidForB.payload.expense.id;

      const ownerView = await listExpenses(baseUrl, tripId, owner.token);
      expect(ownerView.response.status).toBe(200);
      const ownerIds = ownerView.payload.expenses.map((expense: { id: string }) => expense.id);
      expect(ownerIds).toContain(groupId);
      expect(ownerIds).toContain(paidForBId);
      expect(ownerIds).not.toContain(ownPersonalId);

      const memberAView = await listExpenses(baseUrl, tripId, memberA.token);
      expect(memberAView.response.status).toBe(200);
      const memberAIds = memberAView.payload.expenses.map((expense: { id: string }) => expense.id);
      expect(memberAIds).toContain(groupId);
      expect(memberAIds).toContain(ownPersonalId);
      expect(memberAIds).not.toContain(paidForBId);

      const memberBView = await listExpenses(baseUrl, tripId, memberB.token);
      expect(memberBView.response.status).toBe(200);
      const memberBIds = memberBView.payload.expenses.map((expense: { id: string }) => expense.id);
      expect(memberBIds).toContain(groupId);
      expect(memberBIds).toContain(paidForBId);
      expect(memberBIds).not.toContain(ownPersonalId);

      const outsiderView = await listExpenses(baseUrl, tripId, outsider.token);
      expect(outsiderView.response.status).toBe(403);

      const balanceResponse = await fetch(`${baseUrl}/api/trips/${tripId}/expenses/balances`, {
        headers: { Authorization: `Bearer ${owner.token}` },
      });
      expect(balanceResponse.status).toBe(200);
      const balances = await balanceResponse.json();
      // Personal reports never inflate the shared total, even for the payer.
      expect(balances.totalExpenses).toBe('100.00');
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      if (tripId) {
        await prisma.financialEntry.deleteMany({ where: { tripId, reversalOfId: { not: null } } });
        await prisma.financialEntry.deleteMany({ where: { tripId } });
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
