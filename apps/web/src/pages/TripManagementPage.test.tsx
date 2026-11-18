/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import TripManagementPage from './TripManagementPage';
import { clearSessionToken, setSessionToken } from '../lib/session';

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}
const trip = { id: 'trip-a', name: 'Summer coast', description: null, startDate: '2027-07-01', endDate: '2027-07-05', baseCurrency: 'INR', status: 'ACTIVE', cashManagerUserId: 'user-a', members: [
  { id: 'member-a', userId: 'user-a', role: 'OWNER', isActive: true, user: { fullName: 'Alex Owner', email: 'alex@example.com' } },
  { id: 'member-b', userId: 'user-b', role: 'MEMBER', isActive: true, user: { fullName: 'Sam Member', email: 'sam@example.com' } },
] };

describe('Trip member and budget management', () => {
  beforeEach(() => setSessionToken('test-token'));
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); clearSessionToken(); });

  it('loads members, pending invitations and responsibility-based budget fields', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith('/api/trips/trip-a')) return json({ trip });
      if (path.endsWith('/budgets')) return json({ currency: 'INR', members: [
        { userId: 'user-a', fullName: 'Alex Owner', isActive: true, plannedBudget: '5000.00', responsibility: '800.00', remainingBudget: '4200.00', utilizationPct: '16.00' },
        { userId: 'user-b', fullName: 'Sam Member', isActive: true, plannedBudget: null, responsibility: '200.00', remainingBudget: null, utilizationPct: null },
      ] });
      if (path.endsWith('/invitations')) return json({ invitations: [{ id: 'invite-1', email: 'new@example.com', expiresAt: '2026-12-20T00:00:00Z', createdAt: '2026-12-13T00:00:00Z' }] });
      return json({ user: { id: 'user-a' } });
    }));
    render(<MemoryRouter initialEntries={['/trips/trip-a']}><Routes><Route path="/trips/:tripId" element={<TripManagementPage />} /></Routes></MemoryRouter>);
    expect((await screen.findAllByText('Sam Member')).length).toBeGreaterThan(0);
    expect(screen.getByText(/Remaining: ₹4,200.00/)).toBeTruthy();
    expect(screen.getByText('new@example.com')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Cash manager' })).toBeTruthy();
  });

  it('uses existing secured APIs for invitations, member adds, budgets and cash manager changes', async () => {
    const calls: Array<{ path: string; method: string; body: unknown }> = [];
    vi.stubGlobal('confirm', vi.fn(() => true));
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input).replace('http://localhost:4000', '');
      if (init?.method) calls.push({ path, method: init.method, body: init.body ? JSON.parse(String(init.body)) : null });
      if (path === '/api/trips/trip-a') return json({ trip });
      if (path.endsWith('/budgets')) return json({ currency: 'INR', members: [{ userId: 'user-a', fullName: 'Alex Owner', isActive: true, plannedBudget: '5000.00', responsibility: '800.00', remainingBudget: '4200.00', utilizationPct: '16.00' }, { userId: 'user-b', fullName: 'Sam Member', isActive: true, plannedBudget: null, responsibility: '200.00', remainingBudget: null, utilizationPct: null }] });
      if (path.endsWith('/invitations') && !init?.method) return json({ invitations: [] });
      if (path === '/api/auth/me') return json({ user: { id: 'user-a' } });
      if (path.endsWith('/cash-manager') && init?.method === 'PATCH') return json({ trip: { ...trip, cashManagerUserId: 'user-b' } });
      return json({ ok: true }, 201);
    }));
    render(<MemoryRouter initialEntries={['/trips/trip-a']}><Routes><Route path="/trips/:tripId" element={<TripManagementPage />} /></Routes></MemoryRouter>);
    await screen.findAllByText('Sam Member');
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'invite@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create invitation' }));
    await waitFor(() => expect(calls.some((call) => call.path === '/api/trips/trip-a/invitations' && call.method === 'POST')).toBe(true));
    fireEvent.change(screen.getByLabelText('Registered user email'), { target: { value: 'member@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add member' }));
    await waitFor(() => expect(calls.some((call) => call.path === '/api/trips/trip-a/members' && (call.body as { role?: string }).role === 'MEMBER')).toBe(true));
    fireEvent.change(screen.getByLabelText('Sam Member planned budget'), { target: { value: '1200.00' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Save budget' })[1]);
    await waitFor(() => expect(calls.some((call) => call.path === '/api/trips/trip-a/budgets' && (call.body as { userId?: string }).userId === 'user-b')).toBe(true));
    fireEvent.change(screen.getByLabelText('Assign cash manager'), { target: { value: 'user-b' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update manager' }));
    await waitFor(() => expect(calls.some((call) => call.path === '/api/trips/trip-a/cash-manager' && call.method === 'PATCH')).toBe(true));
    expect(calls.find((call) => call.path === '/api/trips/trip-a/members' && call.method === 'POST')?.body).toEqual({ email: 'member@example.com', role: 'MEMBER' });
  });

  it('hides management controls from ordinary members', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith('/api/trips/trip-a')) return json({ trip });
      if (path.endsWith('/budgets')) return json({ currency: 'INR', members: [] });
      if (path.endsWith('/invitations')) return json({ invitations: [] });
      return json({ user: { id: 'user-b' } });
    }));
    render(<MemoryRouter initialEntries={['/trips/trip-a']}><Routes><Route path="/trips/:tripId" element={<TripManagementPage />} /></Routes></MemoryRouter>);
    expect(await screen.findByText(/available to trip owners and admins/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add member' })).toBeNull();
  });
});
