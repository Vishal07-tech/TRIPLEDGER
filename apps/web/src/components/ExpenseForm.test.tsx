import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import ExpenseForm from './ExpenseForm';

describe('ExpenseForm', () => {
  it('records payer advances separately from equal group responsibility', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ expense: { id: 'expense-1' } }), { status: 201 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const onSaved = vi.fn().mockResolvedValue(undefined);
    const cashManagerId = '00000000-0000-4000-8000-000000000001';
    const secondMemberId = '00000000-0000-4000-8000-000000000002';

    render(
      <ExpenseForm
        token="test-token"
        trip={{ id: 'trip-1', baseCurrency: 'INR', cashManagerUserId: cashManagerId }}
        members={[
          { userId: cashManagerId, fullName: 'Cash Manager' },
          { userId: secondMemberId, fullName: 'Other Member' },
        ]}
        currentUserId={secondMemberId}
        onSaved={onSaved}
      />,
    );

    fireEvent.change(screen.getByLabelText('Expense name'), { target: { value: 'Shared meal' } });
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '10.01' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Save expense' }).closest('form')!);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const [, options] = fetchMock.mock.calls[0];
    const payload = JSON.parse(options.body as string);
    expect(payload.payers).toEqual([{ userId: cashManagerId, amount: '10.01' }]);
    expect(payload.splits).toEqual([
      { userId: cashManagerId },
      { userId: secondMemberId },
    ]);
    expect(payload.expenseType).toBe('GROUP');
    expect(payload.paymentMethod).toBe('CASH');
    expect(onSaved).toHaveBeenCalledOnce();
  });

  it('submits corrections as a replacement with an audit reason', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ expense: { id: 'replacement-1' } }), { status: 201 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const onSaved = vi.fn().mockResolvedValue(undefined);
    const userId = '00000000-0000-4000-8000-000000000001';

    render(
      <ExpenseForm
        token="test-token"
        trip={{ id: 'trip-1', baseCurrency: 'INR', cashManagerUserId: userId }}
        members={[{ userId, fullName: 'Cash Manager' }]}
        currentUserId={userId}
        correction={{
          id: 'expense-1',
          title: 'Meal',
          description: null,
          amount: '10.00',
          currency: 'INR',
          exchangeRate: null,
          category: 'Food',
          expenseType: 'GROUP',
          paymentMethod: 'CASH',
          date: new Date().toISOString(),
          allocations: [{ userId, allocatedAmount: '10.00' }],
          payers: [{ userId, amount: '10.00' }],
        }}
        onSaved={onSaved}
      />,
    );

    fireEvent.change(screen.getByLabelText('Correction reason'), { target: { value: 'Receipt amount corrected' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Save correction' }).closest('form')!);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const [url, options] = fetchMock.mock.calls[0];
    const payload = JSON.parse(options.body as string);
    expect(url).toBe('http://localhost:4000/api/trips/trip-1/expenses/expense-1/corrections');
    expect(payload.reason).toBe('Receipt amount corrected');
    expect(payload.replacement.payers).toEqual([{ userId, amount: '10.00' }]);
    expect(payload.replacement.splits).toEqual([{ userId, amount: '10.00' }]);
    expect(onSaved).toHaveBeenCalledOnce();
  });
});
