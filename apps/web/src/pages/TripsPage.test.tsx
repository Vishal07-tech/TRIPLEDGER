/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import TripsPage from './TripsPage';
import { clearSessionToken, setSessionToken } from '../lib/session';

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('My Trips onboarding', () => {
  beforeEach(() => setSessionToken('test-token'));
  afterEach(() => { vi.unstubAllGlobals(); clearSessionToken(); });

  it('shows trip categories and pending invitations for the authenticated email', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith('/api/trips')) return json({ trips: [{ id: 'trip-a', name: 'Summer coast', description: null, startDate: '2027-07-01', endDate: '2027-07-05', baseCurrency: 'INR', status: 'ACTIVE', members: [{ userId: 'user-a', role: 'OWNER', isActive: true }] }] });
      if (path.endsWith('/api/invitations')) return json({ invitations: [{ id: 'invite-a', tripId: 'trip-b', expiresAt: '2026-12-20T00:00:00Z', trip: { name: 'Mountain break', baseCurrency: 'EUR', status: 'ACTIVE' } }] });
      return json({ user: { email: 'alex@example.com' } });
    }));
    render(<MemoryRouter initialEntries={['/trips']}><Routes><Route path="/trips" element={<TripsPage />} /><Route path="/trips/:tripId" element={<div>Trip management page</div>} /></Routes></MemoryRouter>);
    expect(await screen.findByText('Summer coast')).toBeTruthy();
    expect(screen.getByText('Upcoming trips')).toBeTruthy();
    expect(screen.getAllByText(/alex@example.com/).length).toBeGreaterThan(0);
    expect(screen.getByText('Mountain break')).toBeTruthy();
  });

  it('submits dates, currency, settings and trip details without a client-supplied owner', async () => {
    let submitted: Record<string, unknown> | undefined;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith('/api/trips') && init?.method === 'POST') {
        submitted = JSON.parse(String(init.body));
        return json({ trip: { id: 'new-trip', name: 'Coastal weekend', startDate: '2027-01-02', endDate: '2027-01-05', baseCurrency: 'USD', status: 'ACTIVE', members: [{ userId: 'owner', role: 'OWNER' }] } }, 201);
      }
      if (path.endsWith('/api/trips')) return json({ trips: [] });
      if (path.endsWith('/api/invitations')) return json({ invitations: [] });
      return json({ user: { email: 'owner@example.com' } });
    }));
    render(<MemoryRouter initialEntries={['/trips']}><Routes><Route path="/trips" element={<TripsPage />} /><Route path="/trips/:tripId" element={<div>Trip management page</div>} /></Routes></MemoryRouter>);
    fireEvent.click((await screen.findAllByRole('button', { name: /Create trip/ }))[0]);
    fireEvent.change(screen.getByLabelText('Trip name'), { target: { value: 'Coastal weekend' } });
    fireEvent.change(screen.getByLabelText('Base currency'), { target: { value: 'USD' } });
    fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2027-01-02' } });
    fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2027-01-05' } });
    fireEvent.click(screen.getByLabelText('Allow public joining'));
    fireEvent.submit(screen.getByLabelText('Trip name').closest('form')!);
    await waitFor(() => expect(submitted).toBeDefined());
    expect(submitted).toMatchObject({ name: 'Coastal weekend', baseCurrency: 'USD', startDate: '2027-01-02', endDate: '2027-01-05', settings: { allowPublicJoin: true } });
    expect(submitted).not.toHaveProperty('ownerId');
  });

  it('accepts a listed invitation through the authenticated acceptance endpoint', async () => {
    const calls: Array<{ path: string; method?: string; authorization?: string }> = [];
    let accepted = false;
    vi.stubGlobal('confirm', vi.fn(() => true));
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input).replace('http://localhost:4000', '');
      calls.push({ path, method: init?.method, authorization: new Headers(init?.headers).get('Authorization') ?? undefined });
      if (path === '/api/trips') return json({ trips: [] });
      if (path === '/api/invitations') return json({ invitations: accepted ? [] : [{ id: 'invite-a', tripId: 'trip-b', expiresAt: '2026-12-20T00:00:00Z', trip: { name: 'Mountain break', baseCurrency: 'EUR', status: 'ACTIVE' } }] });
      if (path === '/api/auth/me') return json({ user: { email: 'alex@example.com' } });
      if (path === '/api/invitations/invite-a/accept') { accepted = true; return json({ accepted: true, tripId: 'trip-b' }); }
      return json({});
    }));
    render(<MemoryRouter initialEntries={['/trips']}><Routes><Route path="/trips" element={<TripsPage />} /></Routes></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(calls.some((call) => call.path === '/api/invitations/invite-a/accept' && call.method === 'POST' && call.authorization === 'Bearer test-token')).toBe(true));
    expect((await screen.findByRole('status')).textContent).toMatch(/joined Mountain break as the signed-in account alex@example.com/i);
  });

  it('shows a useful loading error when trips cannot be fetched', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ message: 'Service unavailable.' }, 503)));
    render(<MemoryRouter initialEntries={['/trips']}><Routes><Route path="/trips" element={<TripsPage />} /></Routes></MemoryRouter>);
    expect(await screen.findByRole('alert')).toBeTruthy();
  });
});
