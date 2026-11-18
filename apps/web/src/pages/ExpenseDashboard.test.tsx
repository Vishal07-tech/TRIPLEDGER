import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import ExpenseDashboard from './ExpenseDashboard';

function jsonResponse(payload: unknown) {
  return {
    ok: true,
    json: async () => payload,
  } as Response;
}

function forbiddenResponse() {
  return {
    ok: false,
    status: 403,
    json: async () => ({ message: 'Trip membership required.' }),
  } as Response;
}

function budgetPayload(memberName: string, amount: string) {
  return {
    currency: 'INR',
    trip: {
      plannedBudget: '100.00',
      responsibility: amount,
      remainingBudget: '100.00',
      utilizationPct: '0.00',
      overspending: '0.00',
      warningThresholds: [],
      projectedNext30Days: amount,
    },
    forecast: { method: 'Run rate from responsibility.', elapsedDays: 1, horizonDays: 30 },
    members: [{
      userId: memberName,
      fullName: memberName,
      isActive: true,
      plannedBudget: null,
      responsibility: amount,
      remainingBudget: null,
      utilizationPct: null,
      overspending: null,
      warningLevel: 'normal',
      warningThresholds: [],
      projectedNext30Days: amount,
    }],
    notifications: [],
  };
}

describe('ExpenseDashboard trip switching', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('ignores delayed responses from a previously selected trip', async () => {
    localStorage.setItem('tripledger_token', 'test-token');
    const pendingTripA: Array<(response: Response) => void> = [];
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith('/api/trips')) {
        return Promise.resolve(jsonResponse({
          trips: [
            {
              id: 'trip-a',
              name: 'Trip A',
              baseCurrency: 'INR',
              cashManagerUserId: null,
              members: [{ userId: 'current-user', role: 'OWNER' }],
            },
            {
              id: 'trip-b',
              name: 'Trip B',
              baseCurrency: 'INR',
              cashManagerUserId: null,
              members: [{ userId: 'current-user', role: 'OWNER' }],
            },
          ],
        }));
      }
      if (path.endsWith('/api/auth/me')) {
        return Promise.resolve(jsonResponse({ user: { id: 'current-user' } }));
      }
      if (path.endsWith('/api/invitations')) {
        return Promise.resolve(jsonResponse({ invitations: [] }));
      }
      if (path.endsWith('/events')) return Promise.resolve(forbiddenResponse());
      if (path.includes('/notifications')) {
        return Promise.resolve(jsonResponse({ notifications: [], unreadCount: 0, nextCursor: null }));
      }

      const tripId = path.includes('/trip-a') ? 'trip-a' : 'trip-b';
      const resource = path.split('/').pop();
      if (tripId === 'trip-a') {
        return new Promise<Response>((resolve) => pendingTripA.push(resolve));
      }
      if (path.endsWith('/api/trips/trip-b')) {
        return Promise.resolve(jsonResponse({
          trip: {
            id: 'trip-b',
            name: 'Trip B',
            baseCurrency: 'INR',
            cashManagerUserId: null,
            members: [{ userId: 'current-user', role: 'OWNER', isActive: true }],
          },
        }));
      }
      if (resource === 'expenses') return Promise.resolve(jsonResponse({ expenses: [] }));
      if (resource === 'balances') {
        return Promise.resolve(jsonResponse({ currency: 'INR', totalExpenses: '0.00', members: [] }));
      }
      return Promise.resolve(jsonResponse(budgetPayload('Trip B member', '22.00')));
    }));

    render(
      <MemoryRouter>
        <ExpenseDashboard />
      </MemoryRouter>,
    );

    await waitFor(() => expect(pendingTripA).toHaveLength(4));
    fireEvent.change(screen.getByLabelText('Choose trip'), { target: { value: 'trip-b' } });
    expect(await screen.findByText('Trip B member')).toBeTruthy();

    for (const resolve of pendingTripA) {
      resolve(jsonResponse(budgetPayload('Trip A member', '11.00')));
    }

    await waitFor(() => expect(screen.getByText('Trip B member')).toBeTruthy());
    expect(screen.queryByText('Trip A member')).toBeNull();
  });

  it('shows pending invitations and accepts one into the signed-in account', async () => {
    localStorage.setItem('tripledger_token', 'test-token');
    let accepted = false;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith('/api/trips')) {
        return Promise.resolve(jsonResponse({ trips: accepted ? [{
          id: 'invite-trip',
          name: 'Weekend trip',
          baseCurrency: 'INR',
          cashManagerUserId: null,
          members: [{ userId: 'current-user', role: 'MEMBER', isActive: true }],
        }] : [] }));
      }
      if (path.endsWith('/api/auth/me')) return Promise.resolve(jsonResponse({ user: { id: 'current-user' } }));
      if (path.endsWith('/api/invitations')) return Promise.resolve(jsonResponse({ invitations: accepted ? [] : [{
        id: 'invitation-1',
        tripId: 'invite-trip',
        expiresAt: '2026-11-20T12:00:00.000Z',
        trip: { name: 'Weekend trip', baseCurrency: 'INR', status: 'ACTIVE' },
      }] }));
      if (path.includes('/accept')) {
        accepted = true;
        return Promise.resolve(jsonResponse({ accepted: true, tripId: 'invite-trip' }));
      }
      if (path.endsWith('/events')) return Promise.resolve(forbiddenResponse());
      if (path.includes('/notifications')) return Promise.resolve(jsonResponse({ notifications: [], unreadCount: 0, nextCursor: null }));
      if (path.endsWith('/invite-trip')) return Promise.resolve(jsonResponse({ trip: {
        id: 'invite-trip', name: 'Weekend trip', baseCurrency: 'INR', cashManagerUserId: null,
        members: [{ userId: 'current-user', role: 'MEMBER', isActive: true }],
      } }));
      if (path.endsWith('/expenses')) return Promise.resolve(jsonResponse({ expenses: [] }));
      if (path.endsWith('/balances')) return Promise.resolve(jsonResponse({ currency: 'INR', totalExpenses: '0.00', members: [] }));
      return Promise.resolve(jsonResponse(budgetPayload('Member', '0.00')));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<MemoryRouter><ExpenseDashboard /></MemoryRouter>);

    expect(await screen.findByRole('heading', { name: 'Trip invitations' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Accept invitation' }));
    expect(await screen.findByText('You joined Weekend trip.')).toBeTruthy();
    expect(fetchMock.mock.calls.some(([input, init]) => String(input).includes('/api/invitations/invitation-1/accept')
      && (init as RequestInit | undefined)?.method === 'POST')).toBe(true);
  });
});
