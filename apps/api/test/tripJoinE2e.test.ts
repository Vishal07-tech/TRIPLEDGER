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

describe('Trip join codes', () => {
  it('creates a unique code and only grants trip access after a successful join', async () => {
    const server = app.listen(0);
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const userIds: string[] = [];
    const tripIds: string[] = [];

    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Test server did not bind.');
      const baseUrl = `http://127.0.0.1:${address.port}`;

      async function register(fullName: string, index: number) {
        const result = await request(baseUrl, '/api/auth/register', '', 'POST', {
          fullName,
          email: `join-${suffix}-${index}@example.com`,
          password: 'StrongPass!123',
        });
        expect(result.response.status).toBe(201);
        userIds.push(result.payload.user.id);
        return { id: result.payload.user.id as string, token: result.payload.token as string };
      }

      const owner = await register('Join owner', 0);
      const joiner = await register('Join member', 1);

      const created = await request(baseUrl, '/api/trips', owner.token, 'POST', {
        name: 'Joinable trip',
        baseCurrency: 'INR',
        startDate: '2027-03-01',
        endDate: '2027-03-04',
      });
      expect(created.response.status).toBe(201);
      tripIds.push(created.payload.trip.id);

      const code = created.payload.trip.joinCode as string;
      expect(code).toMatch(/^[A-Z2-9]{8}$/);
      expect(code).not.toMatch(/[IO01]/);

      // Before joining, the second phone can neither see nor open the trip.
      const beforeJoin = await request(baseUrl, `/api/trips/${created.payload.trip.id}`, joiner.token);
      expect(beforeJoin.response.status).toBe(403);
      const joinerList = await request(baseUrl, '/api/trips', joiner.token);
      expect(joinerList.payload.trips).toHaveLength(0);

      // Codes are forgiving about the way people retype them: case, spaces, dashes.
      const messyCode = ` ${code.slice(0, 4)}-${code.slice(4)} `.toLowerCase();
      const joined = await request(baseUrl, '/api/trips/join', joiner.token, 'POST', { code: messyCode });
      expect(joined.response.status).toBe(201);
      expect(joined.payload.trip.id).toBe(created.payload.trip.id);
      expect(joined.payload.trip.joinCode).toBe(code);
      expect(joined.payload.trip.members.map((member: { userId: string }) => member.userId)).toContain(joiner.id);

      // Joining again is idempotent rather than an error, and must not duplicate the member.
      const rejoined = await request(baseUrl, '/api/trips/join', joiner.token, 'POST', { code });
      expect(rejoined.response.status).toBe(200);
      const activeJoiners = rejoined.payload.trip.members.filter(
        (member: { userId: string }) => member.userId === joiner.id,
      );
      expect(activeJoiners).toHaveLength(1);

      // Access is granted now.
      expect((await request(baseUrl, `/api/trips/${created.payload.trip.id}`, joiner.token)).response.status).toBe(200);

      // Wrong and malformed codes fail without revealing whether a trip exists.
      const wrong = await request(baseUrl, '/api/trips/join', joiner.token, 'POST', { code: 'ZZZZZZZZ' });
      expect(wrong.response.status).toBe(404);
      expect(wrong.payload.message).toBe('Invalid or expired trip code.');
      expect((await request(baseUrl, '/api/trips/join', joiner.token, 'POST', { code: '!!' })).response.status).toBe(400);

      // A closed trip cannot be entered even with the right code.
      await prisma.trip.update({ where: { id: created.payload.trip.id }, data: { status: 'TRIP_CLOSED' } });
      const closed = await request(baseUrl, '/api/trips/join', joiner.token, 'POST', { code });
      expect(closed.response.status).toBe(409);

      // Two trips never share a code.
      const second = await request(baseUrl, '/api/trips', owner.token, 'POST', { name: 'Second trip', baseCurrency: 'INR' });
      expect(second.response.status).toBe(201);
      tripIds.push(second.payload.trip.id);
      expect(second.payload.trip.joinCode).not.toBe(code);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
      if (tripIds.length) await prisma.trip.deleteMany({ where: { id: { in: tripIds } } });
      if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
  }, 60_000);
});

afterAll(async () => prisma.$disconnect());
