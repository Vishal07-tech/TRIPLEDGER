/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import AnalyticsDashboard from './AnalyticsDashboard';
import { clearSessionToken, setSessionToken } from '../lib/session';

function jsonResponse(payload: unknown) {
  return {
    ok: true,
    json: async () => payload,
  } as Response;
}

function mockReport(tripName: string, totalSpending: string, primaryMember = 'Alice Walker') {
  return {
    tripId: 'trip-1',
    tripName,
    baseCurrency: 'INR',
    dateRange: { startDate: null, endDate: null },
    spendingSummary: {
      totalSpending,
      groupSpending: '4000.00',
      personalSpending: '1000.00',
      totalPayerAdvances: totalSpending,
      totalResponsibility: totalSpending,
      activeExpenseCount: 3,
      currency: 'INR',
    },
    expenseTypes: {
      group: { amount: '4000.00', count: 2, percentage: '80.00' },
      personal: { amount: '1000.00', count: 1, percentage: '20.00' },
      total: { amount: totalSpending, count: 3 },
    },
    categoryBreakdown: [
      {
        category: 'Food & Dining',
        amount: '3000.00',
        groupAmount: '3000.00',
        personalAmount: '0.00',
        expenseCount: 1,
        percentage: '60.00',
      },
      {
        category: 'Transportation',
        amount: '1000.00',
        groupAmount: '1000.00',
        personalAmount: '0.00',
        expenseCount: 1,
        percentage: '20.00',
      },
      {
        category: 'Shopping',
        amount: '1000.00',
        groupAmount: '0.00',
        personalAmount: '1000.00',
        expenseCount: 1,
        percentage: '20.00',
      },
    ],
    memberBreakdown: [
      {
        userId: 'user-1',
        fullName: primaryMember,
        email: 'alice@example.com',
        role: 'OWNER',
        isActive: true,
        payerContribution: '3000.00',
        financialResponsibility: '2000.00',
        netBalance: '1000.00',
        groupResponsibility: '2000.00',
        personalExpenses: '0.00',
        budget: {
          plannedBudget: '10000.00',
          remainingBudget: '8000.00',
          utilizationPct: '20.00',
          overspending: '0.00',
          warningLevel: 'normal',
        },
      },
      {
        userId: 'user-2',
        fullName: 'Bob Builder',
        email: 'bob@example.com',
        role: 'MEMBER',
        isActive: true,
        payerContribution: '2000.00',
        financialResponsibility: '3000.00',
        netBalance: '-1000.00',
        groupResponsibility: '2000.00',
        personalExpenses: '1000.00',
        budget: null,
      },
    ],
    budgetUtilization: {
      totalPlannedBudget: '10000.00',
      totalActualSpending: '5000.00',
      totalRemainingBudget: '5000.00',
      totalOverspending: '0.00',
      overallUtilizationPct: '50.00',
      members: [
        {
          userId: 'user-1',
          fullName: primaryMember,
          plannedBudget: '10000.00',
          recordedResponsibility: '2000.00',
          periodResponsibility: '2000.00',
          remainingBudget: '8000.00',
          overspending: '0.00',
          utilizationPct: '20.00',
          warningLevel: 'normal',
          hasBudget: true,
        },
      ],
    },
    settlementOverview: {
      tripStatus: 'ACTIVE',
      planRevision: 1,
      totalPlanned: '1000.00',
      totalPaid: '400.00',
      totalPending: '0.00',
      totalOutstanding: '600.00',
      totalRefunded: '0.00',
      settlementCount: 1,
      completedCount: 0,
      isFullySettled: false,
    },
    trends: {
      daily: [
        {
          date: '2026-11-05',
          amount: '1000.00',
          groupAmount: '1000.00',
          personalAmount: '0.00',
          count: 1,
        },
        {
          date: '2026-11-10',
          amount: '4000.00',
          groupAmount: '3000.00',
          personalAmount: '1000.00',
          count: 2,
        },
      ],
      monthly: [
        {
          month: '2026-11',
          amount: '5000.00',
          groupAmount: '4000.00',
          personalAmount: '1000.00',
          count: 3,
        },
      ],
    },
  };
}

describe('AnalyticsDashboard', () => {
  beforeEach(() => {
    setSessionToken('test-token');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearSessionToken();
  });

  it('renders overall spending summary, category breakdown, member comparison, budgets, and settlement status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const path = String(input);
        if (path.endsWith('/api/trips')) {
          return Promise.resolve(
            jsonResponse({
              trips: [
                {
                  id: 'trip-1',
                  name: 'Goa Holiday',
                  baseCurrency: 'INR',
                  status: 'ACTIVE',
                  members: [{ userId: 'user-1', role: 'OWNER', isActive: true }],
                },
              ],
            }),
          );
        }
        if (path.includes('/events')) {
          return Promise.resolve({ ok: false, status: 403 } as Response);
        }
        if (path.includes('/notifications')) {
          return Promise.resolve(
            jsonResponse({ notifications: [], unreadCount: 0, nextCursor: null }),
          );
        }
        if (path.includes('/analytics')) {
          return Promise.resolve(jsonResponse(mockReport('Goa Holiday', '5000.00')));
        }
        return Promise.reject(new Error(`Unhandled path: ${path}`));
      }),
    );

    render(
      <MemoryRouter>
        <AnalyticsDashboard />
      </MemoryRouter>,
    );

    // Summary stats
    expect((await screen.findAllByText('Total Spending')).length).toBeGreaterThanOrEqual(1);
    expect((await screen.findAllByText('Group Expenses')).length).toBeGreaterThanOrEqual(1);
    expect((await screen.findAllByText('Personal Expenses')).length).toBeGreaterThanOrEqual(1);

    // Category breakdown
    expect(screen.getAllByText('Food & Dining').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Transportation').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Shopping').length).toBeGreaterThanOrEqual(1);

    // Members
    expect((await screen.findAllByText('Alice Walker')).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Bob Builder').length).toBeGreaterThanOrEqual(1);

    // Budget utilization
    expect(screen.getByText('Budget Utilization')).toBeTruthy();
    expect(screen.getByText('Overall Utilization')).toBeTruthy();

    // Settlement overview
    expect(screen.getByText('Settlement Status Overview')).toBeTruthy();
    expect(screen.getByText('Outstanding Debt')).toBeTruthy();
  });

  it('allows toggling between visual charts and accessible data tables', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const path = String(input);
        if (path.endsWith('/api/trips')) {
          return Promise.resolve(
            jsonResponse({
              trips: [
                {
                  id: 'trip-1',
                  name: 'Goa Holiday',
                  baseCurrency: 'INR',
                  status: 'ACTIVE',
                  members: [{ userId: 'user-1', role: 'OWNER', isActive: true }],
                },
              ],
            }),
          );
        }
        if (path.includes('/events')) {
          return Promise.resolve({ ok: false, status: 403 } as Response);
        }
        if (path.includes('/notifications')) {
          return Promise.resolve(
            jsonResponse({ notifications: [], unreadCount: 0, nextCursor: null }),
          );
        }
        if (path.includes('/analytics')) {
          return Promise.resolve(jsonResponse(mockReport('Goa Holiday', '5000.00')));
        }
        return Promise.reject(new Error(`Unhandled path: ${path}`));
      }),
    );

    render(
      <MemoryRouter>
        <AnalyticsDashboard />
      </MemoryRouter>,
    );

    expect((await screen.findAllByText('Total Spending')).length).toBeGreaterThanOrEqual(1);

    // Toggle to tables mode
    const tableButton = screen.getByRole('button', { name: /tables/i });
    fireEvent.click(tableButton);
    expect(tableButton.getAttribute('aria-pressed')).toBe('true');

    // Toggle back to charts mode
    const chartButton = screen.getByRole('button', { name: /charts/i });
    fireEvent.click(chartButton);
    expect(chartButton.getAttribute('aria-pressed')).toBe('true');
  });

  it('handles race conditions when switching trips, ignoring stale responses', async () => {
    const pendingTripA: Array<(response: Response) => void> = [];

    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const path = String(input);
        if (path.endsWith('/api/trips')) {
          return Promise.resolve(
            jsonResponse({
              trips: [
                {
                  id: 'trip-a',
                  name: 'Trip Alpha',
                  baseCurrency: 'INR',
                  status: 'ACTIVE',
                  members: [{ userId: 'user-1', role: 'OWNER', isActive: true }],
                },
                {
                  id: 'trip-b',
                  name: 'Trip Beta',
                  baseCurrency: 'INR',
                  status: 'ACTIVE',
                  members: [{ userId: 'user-1', role: 'OWNER', isActive: true }],
                },
              ],
            }),
          );
        }
        if (path.includes('/events')) return Promise.resolve({ ok: false, status: 403 } as Response);
        if (path.includes('/notifications')) {
          return Promise.resolve(
            jsonResponse({ notifications: [], unreadCount: 0, nextCursor: null }),
          );
        }

        if (path.includes('/trip-a/analytics')) {
          return new Promise<Response>((resolve) => pendingTripA.push(resolve));
        }

        if (path.includes('/trip-b/analytics')) {
          return Promise.resolve(
            jsonResponse(mockReport('Trip Beta', '8888.00', 'Trip Beta Primary Member')),
          );
        }

        return Promise.reject(new Error(`Unhandled path: ${path}`));
      }),
    );

    render(
      <MemoryRouter>
        <AnalyticsDashboard />
      </MemoryRouter>,
    );

    // Initial load will query trip-a and pause in pendingTripA
    await waitFor(() => expect(pendingTripA).toHaveLength(1));

    // User switches to trip-b
    fireEvent.change(screen.getByLabelText('Choose trip'), { target: { value: 'trip-b' } });

    // Trip Beta report should load with Trip Beta member
    expect((await screen.findAllByText('Trip Beta Primary Member')).length).toBeGreaterThanOrEqual(1);

    // Now resolve delayed Trip Alpha response
    for (const resolve of pendingTripA) {
      resolve(jsonResponse(mockReport('Trip Alpha', '1111.00', 'Trip Alpha Member')));
    }

    // Trip Beta should remain active, Trip Alpha response ignored
    await waitFor(() => expect(screen.getAllByText('Trip Beta Primary Member').length).toBeGreaterThanOrEqual(1));
    expect(screen.queryByText('Trip Alpha Member')).toBeNull();
  });
});
