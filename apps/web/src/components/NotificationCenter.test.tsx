import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import NotificationCenter from './NotificationCenter';

function jsonResponse(payload: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
  } as Response;
}

describe('NotificationCenter', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows recipient history and marks an item read', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        notifications: [{
          id: 'notice-1',
          type: 'EXPENSE_CREATED',
          title: 'New trip expense',
          message: 'Shared dinner was added to this trip.',
          isRead: false,
          resolvedAt: null,
          createdAt: '2026-11-10T00:00:00.000Z',
        }],
        unreadCount: 1,
        nextCursor: null,
      }))
      .mockResolvedValueOnce(jsonResponse({ unreadCount: 0 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<NotificationCenter tripId="trip-1" />);

    fireEvent.click(document.querySelector('summary')!);
    expect(await screen.findByText('Shared dinner was added to this trip.')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('1 unread notification');
    fireEvent.click(screen.getByRole('button', { name: 'Mark New trip expense as read' }));

    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('0 unread notifications'));
    expect(fetchMock).toHaveBeenLastCalledWith(
      'http://localhost:4000/api/trips/trip-1/notifications/notice-1/read',
      expect.objectContaining({ method: 'PATCH' }),
    );
  });
});
