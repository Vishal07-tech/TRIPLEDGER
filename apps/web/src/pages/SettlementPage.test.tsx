import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import SettlementPage from './SettlementPage';

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

describe('SettlementPage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('loads live trip settlement status and sends closure requests', async () => {
    localStorage.setItem('tripledger_token', 'test-token');
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith('/events')) return forbiddenResponse();
      if (path.includes('/notifications')) {
        return jsonResponse({ notifications: [], unreadCount: 0, nextCursor: null });
      }
      if (path.endsWith('/api/trips/trip-1')) {
        return jsonResponse({
          trip: {
            id: 'trip-1',
            name: 'Weekend trip',
            baseCurrency: 'INR',
            status: 'ACTIVE',
            members: [{ userId: 'owner-1', role: 'OWNER', isActive: true }],
          },
        });
      }
      if (path.endsWith('/api/trips')) {
        return jsonResponse({
          trips: [{
            id: 'trip-1',
            name: 'Weekend trip',
            baseCurrency: 'INR',
            status: 'ACTIVE',
            members: [{ userId: 'owner-1', role: 'OWNER', isActive: true }],
          }],
        });
      }
      if (path.endsWith('/api/auth/me')) return jsonResponse({ user: { id: 'owner-1' } });
      if (path.endsWith('/settlements')) {
        return jsonResponse({
          tripStatus: 'ACTIVE',
          currency: 'INR',
          planRevision: 1,
          balances: [],
          settlements: [],
          reviews: { pending: 0, disputed: 0, resolved: 0 },
          closureRequests: [],
          paymentNotifications: [],
        });
      }
      if (path.endsWith('/closure/reviews')) return jsonResponse({ expenses: [] });
      if (path.endsWith('/closure-requests') && init?.method === 'POST') {
        return jsonResponse({ message: 'Trip closure request recorded.' });
      }
      return jsonResponse({});
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <MemoryRouter initialEntries={['/settlements?tripId=trip-1']}>
        <SettlementPage />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: 'Trip settlement' })).toBeTruthy();
    expect(screen.getByText(/Trip status:/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Request closure' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        'http://localhost:4000/api/trips/trip-1/closure-requests',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  it('records an explicitly entered partial refund with a reason', async () => {
    localStorage.setItem('tripledger_token', 'test-token');
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith('/events')) return forbiddenResponse();
      if (path.includes('/notifications')) {
        return jsonResponse({ notifications: [], unreadCount: 0, nextCursor: null });
      }
      if (path.endsWith('/api/trips/trip-1')) {
        return jsonResponse({
          trip: {
            id: 'trip-1',
            name: 'Weekend trip',
            baseCurrency: 'INR',
            status: 'PAYMENTS_PENDING',
            members: [{ userId: 'owner-1', role: 'OWNER', isActive: true }],
          },
        });
      }
      if (path.endsWith('/api/trips')) {
        return jsonResponse({
          trips: [{
            id: 'trip-1',
            name: 'Weekend trip',
            baseCurrency: 'INR',
            status: 'PAYMENTS_PENDING',
            members: [{ userId: 'owner-1', role: 'OWNER', isActive: true }],
          }],
        });
      }
      if (path.endsWith('/api/auth/me')) return jsonResponse({ user: { id: 'owner-1' } });
      if (path.endsWith('/settlements')) {
        return jsonResponse({
          tripStatus: 'PAYMENTS_PENDING',
          currency: 'INR',
          planRevision: 1,
          balances: [],
          settlements: [{
            id: 'settlement-1',
            debtorUserId: 'member-1',
            creditorUserId: 'owner-1',
            totalAmount: '10.00',
            confirmedPaidAmount: '4.00',
            remainingAmount: '6.00',
            status: 'PARTIALLY_SETTLED',
            payments: [{
              id: 'payment-1',
              amount: '4.00',
              refundedAmount: '0.00',
              refundableAmount: '4.00',
              status: 'SUCCESSFUL',
              transactionReference: 'bank-ref',
              events: [],
            }],
          }],
          reviews: { pending: 0, disputed: 0, resolved: 0 },
          closureRequests: [],
          paymentNotifications: [],
        });
      }
      if (path.endsWith('/closure/reviews')) return jsonResponse({ expenses: [] });
      return jsonResponse({});
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <MemoryRouter initialEntries={['/settlements?tripId=trip-1']}>
        <SettlementPage />
      </MemoryRouter>,
    );

    fireEvent.change(await screen.findByLabelText(/Refund amount/), { target: { value: '1.25' } });
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Partial bank return' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record refund' }));

    await waitFor(() => {
      const refundRequest = fetchMock.mock.calls.find(([input]) => String(input).endsWith('/payments/payment-1/refund'));
      expect(refundRequest).toBeTruthy();
      expect(JSON.parse(String(refundRequest?.[1]?.body))).toMatchObject({
        amount: '1.25',
        reason: 'Partial bank return',
      });
    });
  });

  it('records an external payment without requiring a reference and shows backend-selected settlement parties', async () => {
    localStorage.setItem('tripledger_token', 'test-token');
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith('/events')) return forbiddenResponse();
      if (path.includes('/notifications')) {
        return jsonResponse({ notifications: [], unreadCount: 0, nextCursor: null });
      }
      if (path.endsWith('/api/trips/trip-1')) {
        return jsonResponse({
          trip: {
            id: 'trip-1',
            name: 'Weekend trip',
            baseCurrency: 'INR',
            status: 'PAYMENTS_PENDING',
            members: [
              { userId: 'owner-1', role: 'OWNER', isActive: true },
              { userId: 'member-1', role: 'MEMBER', isActive: true },
            ],
          },
        });
      }
      if (path.endsWith('/api/trips')) {
        return jsonResponse({
          trips: [{
            id: 'trip-1',
            name: 'Weekend trip',
            baseCurrency: 'INR',
            status: 'PAYMENTS_PENDING',
            members: [
              { userId: 'owner-1', role: 'OWNER', isActive: true },
              { userId: 'member-1', role: 'MEMBER', isActive: true },
            ],
          }],
        });
      }
      if (path.endsWith('/api/auth/me')) return jsonResponse({ user: { id: 'member-1' } });
      if (path.endsWith('/settlements')) {
        return jsonResponse({
          tripStatus: 'PAYMENTS_PENDING',
          currency: 'INR',
          planRevision: 1,
          balances: [
            { userId: 'owner-1', fullName: 'Trip Owner', balance: '10.00' },
            { userId: 'member-1', fullName: 'Trip Member', balance: '-10.00' },
          ],
          settlements: [{
            id: 'server-settlement-id',
            debtorUserId: 'member-1',
            creditorUserId: 'owner-1',
            totalAmount: '10.00',
            confirmedPaidAmount: '0.00',
            remainingAmount: '10.00',
            status: 'PLANNED',
            payments: [],
          }],
          reviews: { pending: 0, disputed: 0, resolved: 0 },
          closureRequests: [],
          paymentNotifications: [],
        });
      }
      if (path.endsWith('/closure/reviews')) return jsonResponse({ expenses: [] });
      if (path.endsWith('/payments') && init?.method === 'POST') {
        return jsonResponse({ payment: { id: 'payment-1' } });
      }
      return jsonResponse({});
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <MemoryRouter initialEntries={['/settlements?tripId=trip-1']}>
        <SettlementPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('You pay Trip Owner')).toBeTruthy();
    expect(screen.getByText('Settlement ID:')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Amount *'), { target: { value: '4.25' } });
    fireEvent.change(screen.getByLabelText('Payment method *'), { target: { value: 'BANK_TRANSFER' } });
    fireEvent.change(screen.getByLabelText('Payment date and time *'), { target: { value: '2026-11-09T14:15' } });
    fireEvent.change(screen.getByLabelText(/Transaction or bank reference/), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText(/Notes/), { target: { value: 'Sent from my bank app.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record payment for creditor confirmation' }));

    await waitFor(() => {
      const paymentRequest = fetchMock.mock.calls.find(([input]) =>
        String(input).endsWith('/settlements/server-settlement-id/payments'));
      expect(paymentRequest).toBeTruthy();
      expect(JSON.parse(String(paymentRequest?.[1]?.body))).toMatchObject({
        amount: '4.25',
        transactionReference: null,
        paymentMethod: 'BANK_TRANSFER',
        paymentDateTime: new Date('2026-11-09T14:15').toISOString(),
        paymentNotes: 'Sent from my bank app.',
      });
    });
  });
});
