import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import BudgetOverview, { type BudgetSummary } from './BudgetOverview';

const budget: BudgetSummary = {
  currency: 'INR',
  trip: {
    plannedBudget: '1000.00',
    responsibility: '725.00',
    remainingBudget: '275.00',
    utilizationPct: '72.50',
    overspending: '0.00',
    warningThresholds: [50],
    projectedNext30Days: '21750.00',
  },
  forecast: {
    method: 'Responsibility to date divided by elapsed trip days, multiplied by 30.',
    elapsedDays: 1,
    horizonDays: 30,
  },
  members: [{
    userId: 'member-1',
    fullName: 'Member One',
    isActive: true,
    plannedBudget: '1000.00',
    responsibility: '725.00',
    remainingBudget: '275.00',
    utilizationPct: '72.50',
    overspending: '0.00',
    warningLevel: 'approaching',
    warningThresholds: [50],
    projectedNext30Days: '21750.00',
  }],
  notifications: [{
    id: 'notice-1',
    title: 'Budget 50% reached',
    message: 'Responsibility reached half of the planned budget.',
    createdAt: '2026-11-09T12:00:00.000Z',
    resolvedAt: null,
  }],
};

describe('BudgetOverview', () => {
  it('shows responsibility-based budget status, forecast assumptions, and warning notifications', () => {
    render(<BudgetOverview budget={budget} canManage={false} onSaveBudget={vi.fn()} />);

    expect(screen.getByText('Budget overview')).toBeTruthy();
    expect(screen.getAllByText('72.50%')).toHaveLength(2);
    expect(screen.getByText(/calculated from financial responsibility, never from who paid/i)).toBeTruthy();
    expect(screen.getByText(budget.forecast.method)).toBeTruthy();
    expect(screen.getByText(/Budget 50% reached · Active/)).toBeTruthy();
    expect(screen.getByText('No resolved warnings.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save budget' })).toBeNull();
  });

  it('distinguishes resolved warnings from active warnings', () => {
    render(
      <BudgetOverview
        budget={{
          ...budget,
          notifications: [{
            ...budget.notifications[0],
            id: 'notice-resolved',
            resolvedAt: '2026-11-09T13:00:00.000Z',
          }],
        }}
        canManage={false}
        onSaveBudget={vi.fn()}
      />,
    );

    expect(screen.getByText('Resolved warning history')).toBeTruthy();
    expect(screen.getByText(/Budget 50% reached · Resolved/)).toBeTruthy();
    expect(screen.getByText('No active budget warnings.')).toBeTruthy();
  });

  it('lets trip managers set an individual planned budget', async () => {
    const onSaveBudget = vi.fn().mockResolvedValue(undefined);
    render(<BudgetOverview budget={budget} canManage onSaveBudget={onSaveBudget} />);

    fireEvent.change(screen.getByLabelText('Update budget'), { target: { value: '1250.50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save budget' }));

    await waitFor(() => expect(onSaveBudget).toHaveBeenCalledWith('member-1', '1250.50'));
  });

  it('explains invalid budget input beside the related field', () => {
    const onSaveBudget = vi.fn();
    render(<BudgetOverview budget={budget} canManage onSaveBudget={onSaveBudget} />);

    fireEvent.change(screen.getByLabelText('Update budget'), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save budget' }));

    expect(screen.getByRole('alert').textContent).toContain('greater than zero');
    expect(onSaveBudget).not.toHaveBeenCalled();
  });
});
