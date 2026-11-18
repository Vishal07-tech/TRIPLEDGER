import { afterAll, describe, expect, it } from 'vitest';

import app from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';

type UserFixture = { id: string; email: string; token: string };

async function postJson(baseUrl: string, path: string, body: unknown, token?: string) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { response, payload: await response.json() };
}

async function getJson(baseUrl: string, path: string, token?: string) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return { response, payload: await response.json() };
}

describe('MySQL trip invitation lifecycle', () => {
  it('authorizes matching registered users, accepts once, and expires invitations after seven days', async () => {
    const server = app.listen(0);
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const users: UserFixture[] = [];
    let tripId: string | undefined;

    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Test server did not bind.');
      const baseUrl = `http://127.0.0.1:${address.port}`;

      for (const [index, fullName] of ['Invitation owner', 'Invited member', 'Wrong account', 'Expiring member'].entries()) {
        const email = `invitation-e2e-${suffix}-${index}@example.com`;
        const registered = await postJson(baseUrl, '/api/auth/register', {
          email: index === 1 ? email.toUpperCase() : email,
          password: 'StrongPass!123',
          fullName,
        });
        expect(registered.response.status).toBe(201);
        users.push({ id: registered.payload.user.id, email: registered.payload.user.email, token: registered.payload.token });
      }

      const [owner, invited, wrongAccount, expiring] = users;
      const tripResponse = await postJson(baseUrl, '/api/trips', { name: 'Invitation test trip', baseCurrency: 'INR' }, owner.token);
      expect(tripResponse.response.status).toBe(201);
      tripId = tripResponse.payload.trip.id;

      const create = await postJson(baseUrl, `/api/trips/${tripId}/invitations`, { email: invited.email }, owner.token);
      expect(create.response.status).toBe(201);
      const invitation = create.payload.invitation as { id: string; status: string; expiresAt: string };
      expect(invitation.status).toBe('pending');
      expect(new Date(invitation.expiresAt).getTime()).toBeGreaterThan(Date.now() + 6 * 24 * 60 * 60 * 1000);
      expect((await postJson(baseUrl, `/api/trips/${tripId}/invitations`, { email: invited.email }, owner.token)).response.status).toBe(409);
      expect((await postJson(baseUrl, `/api/trips/${tripId}/invitations`, { email: 'not-registered@example.com' }, owner.token)).response.status).toBe(404);
      expect((await postJson(baseUrl, `/api/trips/${tripId}/invitations`, { email: expiring.email }, invited.token)).response.status).toBe(403);

      const inbox = await getJson(baseUrl, '/api/invitations', invited.token);
      expect(inbox.response.status).toBe(200);
      expect(inbox.payload.invitations.map((item: { id: string }) => item.id)).toContain(invitation.id);
      expect((await getJson(baseUrl, '/api/invitations', wrongAccount.token)).payload.invitations).toHaveLength(0);
      expect((await getJson(baseUrl, '/api/invitations')).response.status).toBe(401);
      const managerInvitations = await getJson(baseUrl, `/api/trips/${tripId}/invitations`, owner.token);
      expect(managerInvitations.response.status).toBe(200);
      expect(managerInvitations.payload.invitations.map((item: { id: string }) => item.id)).toContain(invitation.id);
      expect((await getJson(baseUrl, `/api/trips/${tripId}/invitations`, invited.token)).response.status).toBe(403);
      expect((await postJson(baseUrl, `/api/invitations/${invitation.id}/accept`, {}, wrongAccount.token)).response.status).toBe(404);

      const accepted = await postJson(baseUrl, `/api/invitations/${invitation.id}/accept`, {}, invited.token);
      expect(accepted.response.status).toBe(200);
      expect(accepted.payload).toMatchObject({ accepted: true, alreadyAccepted: false, tripId });
      expect((await postJson(baseUrl, `/api/invitations/${invitation.id}/accept`, {}, invited.token)).payload.alreadyAccepted).toBe(true);
      expect(await prisma.tripMember.findUnique({ where: { tripId_userId: { tripId, userId: invited.id } } })).toMatchObject({
        role: 'MEMBER', isActive: true,
      });

      const declineInvite = await postJson(baseUrl, `/api/trips/${tripId}/invitations`, { email: wrongAccount.email }, owner.token);
      expect(declineInvite.response.status).toBe(201);
      const declineId = declineInvite.payload.invitation.id as string;
      expect((await postJson(baseUrl, `/api/invitations/${declineId}/decline`, {}, invited.token)).response.status).toBe(404);
      expect((await postJson(baseUrl, `/api/invitations/${declineId}/decline`, {}, wrongAccount.token)).payload).toMatchObject({ declined: true, tripId });
      expect(await prisma.tripInvitation.findUniqueOrThrow({ where: { id: declineId } })).toMatchObject({ status: 'declined' });

      const expiringInvite = await postJson(baseUrl, `/api/trips/${tripId}/invitations`, { email: expiring.email }, owner.token);
      expect(expiringInvite.response.status).toBe(201);
      const expiringId = expiringInvite.payload.invitation.id as string;
      await prisma.tripInvitation.update({ where: { id: expiringId }, data: { expiresAt: new Date(Date.now() - 1_000) } });
      const expired = await postJson(baseUrl, `/api/invitations/${expiringId}/accept`, {}, expiring.token);
      expect(expired.response.status).toBe(410);
      expect(await prisma.tripInvitation.findUniqueOrThrow({ where: { id: expiringId } })).toMatchObject({ status: 'expired' });

      const expiredDeclineInvite = await postJson(baseUrl, `/api/trips/${tripId}/invitations`, { email: expiring.email }, owner.token);
      expect(expiredDeclineInvite.response.status).toBe(201);
      const expiredDeclineId = expiredDeclineInvite.payload.invitation.id as string;
      await prisma.tripInvitation.update({ where: { id: expiredDeclineId }, data: { expiresAt: new Date(Date.now() - 1_000) } });
      expect((await postJson(baseUrl, `/api/invitations/${expiredDeclineId}/decline`, {}, expiring.token)).response.status).toBe(410);
      expect(await prisma.tripInvitation.findUniqueOrThrow({ where: { id: expiredDeclineId } })).toMatchObject({ status: 'expired' });
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      if (tripId) await prisma.trip.delete({ where: { id: tripId } });
      if (users.length) await prisma.user.deleteMany({ where: { id: { in: users.map((user) => user.id) } } });
    }
  }, 60_000);
});

afterAll(async () => prisma.$disconnect());
