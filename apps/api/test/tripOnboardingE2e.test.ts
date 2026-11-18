import { afterAll, describe, expect, it } from 'vitest';

import app from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';

async function request(baseUrl: string, path: string, token: string, method = 'GET', body?: unknown) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { response, payload: await response.json() };
}

describe('MySQL trip onboarding and management', () => {
  it('enforces manager permissions for members, budgets, and cash manager assignment', async () => {
    const server = app.listen(0);
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const userIds: string[] = [];
    let tripId: string | undefined;
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Test server did not bind.');
      const baseUrl = `http://127.0.0.1:${address.port}`;
      const accounts: Array<{ id: string; email: string; token: string }> = [];
      for (const [index, fullName] of ['Onboarding owner', 'Onboarding member', 'Onboarding outsider'].entries()) {
        const result = await request(baseUrl, '/api/auth/register', '', 'POST', {
          fullName, email: `onboarding-${suffix}-${index}@example.com`, password: 'StrongPass!123',
        });
        expect(result.response.status).toBe(201);
        accounts.push({ id: result.payload.user.id, email: result.payload.user.email, token: result.payload.token });
        userIds.push(result.payload.user.id);
      }
      const [owner, member, outsider] = accounts;
      const created = await request(baseUrl, '/api/trips', owner.token, 'POST', {
        name: 'Onboarding test trip', baseCurrency: 'INR', startDate: '2027-02-10', endDate: '2027-02-15',
        settings: { allowMemberExpenseEdit: false, requireLocationConfirmation: true, allowPublicJoin: false },
        ownerId: outsider.id,
      });
      expect(created.response.status).toBe(201);
      tripId = created.payload.trip.id;
      expect(created.payload.trip.createdByUserId).toBe(owner.id);
      expect(created.payload.trip.cashManagerUserId).toBe(owner.id);
      expect(created.payload.trip.settings.allowMemberExpenseEdit).toBe(false);

      const add = await request(baseUrl, `/api/trips/${tripId}/members`, owner.token, 'POST', { email: member.email, role: 'MEMBER' });
      expect(add.response.status).toBe(201);
      const tripMember = await request(baseUrl, `/api/trips/${tripId}`, member.token);
      expect(tripMember.payload.trip.members.find((entry: { userId: string }) => entry.userId === member.id).user.fullName).toBe('Onboarding member');
      expect((await request(baseUrl, `/api/trips/${tripId}/members`, member.token, 'POST', { email: outsider.email, role: 'MEMBER' })).response.status).toBe(403);
      expect((await request(baseUrl, `/api/trips/${tripId}/members`, outsider.token, 'POST', { email: member.email, role: 'MEMBER' })).response.status).toBe(403);

      expect((await request(baseUrl, `/api/trips/${tripId}/cash-manager`, owner.token, 'PATCH', { userId: member.id })).response.status).toBe(200);
      expect((await request(baseUrl, `/api/trips/${tripId}/cash-manager`, member.token, 'PATCH', { userId: outsider.id })).response.status).toBe(403);
      expect((await request(baseUrl, `/api/trips/${tripId}/cash-manager`, owner.token, 'PATCH', { userId: outsider.id })).response.status).toBe(404);

      expect((await request(baseUrl, `/api/trips/${tripId}/budgets`, owner.token, 'POST', { userId: member.id, plannedBudget: '1250.00' })).response.status).toBe(201);
      expect((await request(baseUrl, `/api/trips/${tripId}/budgets`, member.token, 'POST', { userId: member.id, plannedBudget: '99999.00' })).response.status).toBe(403);
      const budgetView = await request(baseUrl, `/api/trips/${tripId}/budgets`, member.token);
      expect(budgetView.payload.members.find((entry: { userId: string }) => entry.userId === member.id)).toMatchObject({
        plannedBudget: '1250.00', responsibility: '0.00', remainingBudget: '1250.00',
      });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      if (tripId) await prisma.trip.delete({ where: { id: tripId } });
      if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
  }, 60_000);
});

afterAll(async () => prisma.$disconnect());
