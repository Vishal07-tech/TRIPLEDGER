/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import ReportsPage from './ReportsPage';
import { clearSessionToken, setSessionToken } from '../lib/session';

function jsonResponse(payload: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
    headers: new Headers(),
  } as Response;
}

function reportFixture() {
  return {
    meta: {
      reportType: 'complete',
      generatedAt: '2026-11-10T12:00:00.000Z',
      tripName: 'Goa Holiday',
      tripStatus: 'PARTIALLY_SETTLED',
      baseCurrency: 'INR',
      settlementRevision: 2,
      dateRange: { startDate: null, endDate: null },
      notes: [],
    },
    spendingSummary: {
      totalSpending: '1200.00',
      groupSpending: '1000.00',
      personalSpending: '200.00',
      activeExpenseCount: 2,
      correctedExpenseCount: 1,
      reversedExpenseCount: 1,
    },
    expenseTypes: {
      group: { amount: '1000.00', count: 1, percentage: '83.33' },
      personal: { amount: '200.00', count: 1, percentage: '16.67' },
    },
    categories: [{
      category: 'Food',
      amount: '1000.00',
      groupAmount: '1000.00',
      personalAmount: '0.00',
      expenseCount: 1,
      percentage: '83.33',
    }],
    members: [{
      userId: 'member-a',
      fullName: 'Alice',
      role: 'OWNER',
      isActive: true,
      payerContribution: '1000.00',
      financialResponsibility: '500.00',
      groupResponsibility: '500.00',
      personalExpenses: '0.00',
      netBalance: '500.00',
      settlementOutstandingPayable: '0.00',
      settlementOutstandingReceivable: '100.00',
      settlementBalance: '100.00',
      plannedBudget: '2000.00',
      utilizationPct: '25.00',
      warningLevel: 'normal',
    }],
    availableMembers: [
      { userId: 'member-a', fullName: 'Alice', isActive: true },
      { userId: 'member-b', fullName: 'Bob', isActive: true },
    ],
    budgets: {
      totalPlannedBudget: '2000.00',
      totalActualSpending: '500.00',
      totalRemainingBudget: '1500.00',
      totalOverspending: '0.00',
      overallUtilizationPct: '25.00',
      members: [{
        userId: 'member-a',
        fullName: 'Alice',
        plannedBudget: '2000.00',
        recordedResponsibility: '500.00',
        periodResponsibility: '100.00',
        remainingBudget: '1500.00',
        overspending: '0.00',
        utilizationPct: '25.00',
        warningLevel: 'normal',
        hasBudget: true,
      }],
    },
    settlements: {
      tripStatus: 'PARTIALLY_SETTLED',
      planRevision: 2,
      totalPlanned: '500.00',
      totalPaid: '100.00',
      totalPending: '0.00',
      totalOutstanding: '400.00',
      totalRefunded: '0.00',
      settlementCount: 1,
      completedCount: 0,
      isFullySettled: false,
      settlements: [],
      history: [{
        id: 'settlement-1',
        debtorName: 'Bob',
        creditorName: 'Alice',
        planRevision: 2,
        createdAt: '2026-11-01T10:00:00.000Z',
        createdByUserId: 'owner-a',
        totalAmount: '500.00',
        confirmedPaidAmount: '100.00',
        remainingAmount: '400.00',
        status: 'PARTIALLY_SETTLED',
        payments: [{
          id: 'payment-1',
          amount: '100.00',
          paymentMethod: 'UPI',
          paymentDateTime: '2026-11-02T10:00:00.000Z',
          transactionReference: null,
          paymentNotes: null,
          status: 'SUCCESSFUL',
          refundedAmount: '0.00',
          debtorSubmittedAt: '2026-11-02T10:01:00.000Z',
          creditorConfirmedAt: '2026-11-02T10:02:00.000Z',
          disputedAt: null,
          disputeReason: null,
          events: [],
          refunds: [],
        }],
      }],
      refunds: [],
    },
    expenses: [{
      id: 'expense-1',
      title: 'Dinner',
      description: 'Shared meal',
      status: 'ACTIVE',
      category: 'Food',
      expenseType: 'GROUP',
      paymentMethod: 'CASH',
      date: '2026-11-01T18:00:00.000Z',
      convertedAmount: '1000.00',
      originalAmount: '1000.00',
      originalCurrency: 'INR',
      correctedFrom: null,
      payers: [{ fullName: 'Alice', amount: '1000.00', paymentStatus: 'PAID' }],
      allocations: [{ fullName: 'Alice', allocatedAmount: '500.00', currency: 'INR' }],
    }],
    auditHistory: [],
  };
}

function tripPayload() {
  return {
    trips: [{
      id: 'trip-1',
      name: 'Goa Holiday',
      baseCurrency: 'INR',
      status: 'PARTIALLY_SETTLED',
      members: [{ userId: 'member-a', role: 'OWNER', isActive: true }],
    }],
  };
}

describe('ReportsPage', () => {
  beforeEach(() => {
    setSessionToken('reports-token');
  });

  afterEach(() => {
    clearSessionToken();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('previews financial sections and applies report type, dates and member filters', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const path = String(input);
      calls.push(path);
      if (path.endsWith('/api/trips')) return Promise.resolve(jsonResponse(tripPayload()));
      if (path.includes('/events')) return Promise.resolve(jsonResponse({}, 403));
      if (path.includes('/notifications')) {
        return Promise.resolve(jsonResponse({ notifications: [], unreadCount: 0, nextCursor: null }));
      }
      if (path.includes('/reports')) return Promise.resolve(jsonResponse(reportFixture()));
      return Promise.reject(new Error(`Unhandled path: ${path}`));
    }));

    render(<MemoryRouter initialEntries={['/reports?tripId=trip-1']}><ReportsPage /></MemoryRouter>);

    expect(await screen.findByRole('heading', { name: 'Goa Holiday' })).toBeTruthy();
    expect(screen.getByText('Payer contributions and financial responsibility are separate. Settlement balances are shown independently.')).toBeTruthy();
    expect(screen.getByText('Bob pays Alice')).toBeTruthy();
    expect(screen.getByText(/not bank-verified/i)).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Report type'), { target: { value: 'settlements' } });
    await waitFor(() => expect(calls.some((path) => path.includes('/reports?type=settlements'))).toBe(true));
    await screen.findByRole('button', { name: 'Apply date range' });

    fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-11-01' } });
    fireEvent.change(screen.getByLabelText('To date'), { target: { value: '2026-11-10' } });
    fireEvent.change(screen.getByLabelText('Member'), { target: { value: 'member-b' } });
    await screen.findByRole('button', { name: /apply date range/i });
    fireEvent.click(screen.getByRole('button', { name: 'Apply date range' }));

    await waitFor(() => {
      expect(calls.some((path) => path.includes('startDate=2026-11-01')
        && path.includes('endDate=2026-11-10')
        && path.includes('memberId=member-b'))).toBe(true);
    });
  });

  it('downloads the selected CSV and offers print output', async () => {
    const csvResponse = {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-disposition': 'attachment; filename="goa-holiday-report.csv"' }),
      blob: async () => new Blob(['Section,Value\r\nTrip,Goa Holiday']),
    } as Response;
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith('/api/trips')) return Promise.resolve(jsonResponse(tripPayload()));
      if (path.includes('/events')) return Promise.resolve(jsonResponse({}, 403));
      if (path.includes('/notifications')) {
        return Promise.resolve(jsonResponse({ notifications: [], unreadCount: 0, nextCursor: null }));
      }
      if (path.includes('/reports/export')) return Promise.resolve(csvResponse);
      if (path.includes('/reports')) return Promise.resolve(jsonResponse(reportFixture()));
      return Promise.reject(new Error(`Unhandled path: ${path}`));
    }));
    const createObjectURL = vi.fn(() => 'blob:report');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);

    render(<MemoryRouter initialEntries={['/reports?tripId=trip-1']}><ReportsPage /></MemoryRouter>);
    await screen.findByRole('heading', { name: 'Goa Holiday' });
    fireEvent.click(screen.getByRole('button', { name: /download csv/i }));
    expect(await screen.findByRole('status')).toBeTruthy();
    await waitFor(() => expect(anchorClick).toHaveBeenCalled());
    expect(createObjectURL).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:report');
    fireEvent.click(screen.getByRole('button', { name: /print \/ save as pdf/i }));
    expect(print).toHaveBeenCalled();
  });
});
