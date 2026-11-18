import { describe, expect, it } from 'vitest';

import app from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';

describe('MySQL auth and trip workflows', () => {
  it('registers a user, logs in, and creates a trip using the live MySQL database', async () => {
    const uniqueEmail = `mysql-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
    const server = app.listen(0);
    let createdUserId: string | undefined;
    let createdTripId: string | undefined;

    try {
      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('Server did not bind to a TCP port.');
      }

      const baseUrl = `http://127.0.0.1:${address.port}`;

      const registerResponse = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: uniqueEmail,
          password: 'StrongPass!123',
          fullName: 'MySQL E2E User',
        }),
      });

      expect(registerResponse.status).toBe(201);
      const registerJson = await registerResponse.json();
      expect(registerJson.user.email).toBe(uniqueEmail);
      expect(registerJson.token).toBeTruthy();
      createdUserId = registerJson.user.id;

      const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: uniqueEmail,
          password: 'StrongPass!123',
        }),
      });

      expect(loginResponse.status).toBe(200);
      const loginJson = await loginResponse.json();
      expect(loginJson.user.email).toBe(uniqueEmail);
      expect(loginJson.token).toBeTruthy();

      const tripResponse = await fetch(`${baseUrl}/api/trips`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${loginJson.token}`,
        },
        body: JSON.stringify({
          name: 'MySQL Trip',
          description: 'Trip created through the live MySQL workflow.',
          baseCurrency: 'inr',
          startDate: '2026-12-01',
          endDate: '2026-12-04',
          settings: { allowMemberExpenseEdit: false, requireLocationConfirmation: true, allowPublicJoin: false },
        }),
      });

      expect(tripResponse.status).toBe(201);
      const tripJson = await tripResponse.json();
      expect(tripJson.trip.name).toBe('MySQL Trip');
      expect(tripJson.trip.baseCurrency).toBe('INR');
      expect(tripJson.trip.startDate).toContain('2026-12-01');
      expect(tripJson.trip.endDate).toContain('2026-12-04');
      expect(tripJson.trip.settings.allowMemberExpenseEdit).toBe(false);
      createdTripId = tripJson.trip.id;

      const savedUser = await prisma.user.findUnique({ where: { email: uniqueEmail } });
      expect(savedUser).not.toBeNull();

      const savedTrip = await prisma.trip.findUnique({ where: { id: createdTripId } });
      expect(savedTrip).not.toBeNull();
      expect(savedTrip?.baseCurrency).toBe('INR');
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });

      if (createdTripId) {
        await prisma.trip.delete({ where: { id: createdTripId } });
      }

      if (createdUserId) {
        await prisma.user.delete({ where: { id: createdUserId } });
      }
    }
  });
});
