import { useCallback, useEffect, useState } from 'react';
import { Bell, Check, ChevronDown } from 'lucide-react';

import { apiRequest } from '../lib/apiClient';

type NotificationItem = {
  id: string;
  type: string;
  title: string;
  message: string;
  isRead: boolean;
  resolvedAt: string | null;
  createdAt: string;
};

type NotificationPage = {
  notifications: NotificationItem[];
  unreadCount: number;
  nextCursor: string | null;
};

export default function NotificationCenter({
  tripId,
  refreshKey = 0,
}: {
  tripId: string;
  refreshKey?: number;
}) {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadNotifications = useCallback(async (cursor?: string, append = false, signal?: AbortSignal) => {
    if (!tripId) return;
    setLoading(true);
    setError('');
    try {
      const query = new URLSearchParams({ limit: '20' });
      if (cursor) query.set('cursor', cursor);
      const page = await apiRequest<NotificationPage>(
        `/api/trips/${tripId}/notifications?${query.toString()}`,
        { signal },
      );
      if (
        !Array.isArray(page.notifications)
        || !Number.isInteger(page.unreadCount)
        || (page.nextCursor !== null && typeof page.nextCursor !== 'string')
      ) {
        throw new Error('The notification service returned an invalid response.');
      }
      setNotifications((current) => append ? [...current, ...page.notifications] : page.notifications);
      setUnreadCount(page.unreadCount);
      setNextCursor(page.nextCursor);
    } catch (loadError) {
      if (!signal?.aborted) {
        setError(loadError instanceof Error ? loadError.message : 'Could not load notifications.');
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [tripId]);

  useEffect(() => {
    const controller = new AbortController();
    void loadNotifications(undefined, false, controller.signal);
    return () => controller.abort();
  }, [loadNotifications, refreshKey]);

  async function markRead(notificationId: string) {
    try {
      const result = await apiRequest<{ unreadCount: number }>(
        `/api/trips/${tripId}/notifications/${notificationId}/read`,
        { method: 'PATCH' },
      );
      setNotifications((current) =>
        current.map((notification) => notification.id === notificationId
          ? { ...notification, isRead: true }
          : notification),
      );
      setUnreadCount(result.unreadCount);
    } catch (markError) {
      setError(markError instanceof Error ? markError.message : 'Could not update this notification.');
    }
  }

  async function markAllRead() {
    try {
      await apiRequest(`/api/trips/${tripId}/notifications/read-all`, { method: 'POST' });
      setNotifications((current) => current.map((notification) => ({ ...notification, isRead: true })));
      setUnreadCount(0);
    } catch (markError) {
      setError(markError instanceof Error ? markError.message : 'Could not update notifications.');
    }
  }

  return (
    <details className="relative">
      <summary className="btn-secondary min-h-11 cursor-pointer list-none gap-2" aria-label="Notifications">
        <Bell aria-hidden="true" size={18} />
        <span>Notifications</span>
        <span role="status" aria-atomic="true" className="rounded-full bg-primary/15 px-2 py-0.5 text-xs font-semibold">
          {unreadCount} unread notification{unreadCount === 1 ? '' : 's'}
        </span>
        <ChevronDown aria-hidden="true" size={16} />
      </summary>
      <section
        aria-label="Notification history"
        className="absolute right-0 z-30 mt-2 max-h-[min(70vh,36rem)] w-[min(24rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl border border-orange-200 bg-white p-4 shadow-xl"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Notification history</h2>
          <button
            type="button"
            className="btn-secondary min-h-10 !px-3 !py-2 text-sm"
            disabled={unreadCount === 0 || loading}
            onClick={() => void markAllRead()}
          >
            <Check aria-hidden="true" size={16} />
            Mark all read
          </button>
        </div>
        {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
        {notifications.length === 0 && !loading ? (
          <p className="mt-4 rounded-xl bg-orange-50 p-4 text-sm text-slate-600">No notifications for this trip yet.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {notifications.map((notification) => (
              <li key={notification.id} className={`rounded-xl border p-3 ${notification.isRead ? 'border-slate-200 bg-white' : 'border-orange-200 bg-orange-50'}`}>
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-semibold">{notification.title}</h3>
                  {!notification.isRead && (
                    <button
                      type="button"
                      className="min-h-11 min-w-11 rounded-lg text-sm font-medium text-primary underline focus:outline-none focus:ring-2 focus:ring-primary/40"
                      aria-label={`Mark ${notification.title} as read`}
                      onClick={() => void markRead(notification.id)}
                    >
                      Read
                    </button>
                  )}
                </div>
                <p className="mt-1 text-sm leading-6 text-slate-700">{notification.message}</p>
                {notification.resolvedAt && (
                  <p className="mt-2 text-xs font-medium text-slate-600">Resolved</p>
                )}
                <time className="mt-2 block text-xs text-slate-600" dateTime={notification.createdAt}>
                  {new Date(notification.createdAt).toLocaleString()}
                </time>
              </li>
            ))}
          </ul>
        )}
        {nextCursor && (
          <button
            type="button"
            className="btn-secondary mt-3 min-h-11 w-full"
            disabled={loading}
            onClick={() => void loadNotifications(nextCursor, true)}
          >
            {loading ? 'Loading…' : 'Load older notifications'}
          </button>
        )}
      </section>
    </details>
  );
}
