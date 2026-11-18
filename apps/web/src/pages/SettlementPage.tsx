import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import NotificationCenter from '../components/NotificationCenter';
import { apiRequest } from '../lib/apiClient';
import { getSessionToken } from '../lib/session';
import { useTripEvents } from '../lib/useTripEvents';

type Trip = {
  id: string;
  name: string;
  baseCurrency: string;
  status: string;
  members: Array<{ userId: string; role: string; isActive: boolean }>;
};

type ReviewExpense = {
  id: string;
  title: string;
  amount: string;
  currency: string;
  payers: Array<{ userId: string; amount: string; contributionStatus: string }>;
  allocations: Array<{ userId: string; allocatedAmount: string }>;
  reviews: Array<{ userId: string; status: string; comment: string | null; resolutionReason: string | null }>;
};

type PaymentEvent = {
  action: string;
  reason: string | null;
  createdAt: string;
};

type SettlementPaymentMethod = 'UPI' | 'CASH' | 'BANK_TRANSFER' | 'OTHER';

type Payment = {
  id: string;
  amount: string;
  refundedAmount: string;
  refundableAmount: string;
  status: string;
  transactionReference: string | null;
  paymentMethod: SettlementPaymentMethod | null;
  paymentDateTime: string | null;
  paymentNotes: string | null;
  events: PaymentEvent[];
};

type Settlement = {
  id: string;
  debtorUserId: string;
  creditorUserId: string;
  totalAmount: string;
  confirmedPaidAmount: string;
  remainingAmount: string;
  status: string;
  payments: Payment[];
};

type Overview = {
  tripStatus: string;
  currency: string;
  planRevision: number;
  balances: Array<{ userId: string; fullName: string; balance: string }>;
  settlements: Settlement[];
  reviews: { pending: number; disputed: number; resolved: number };
  closureRequests: Array<{ id: string; user: { fullName: string } | null; createdAt: string }>;
  paymentNotifications: Array<{
    id: string;
    title: string;
    message: string;
    createdAt: string;
  }>;
};

async function request<T>(
  token: string,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  return apiRequest<T>(path, {
    method: body === undefined ? 'GET' : 'POST',
    signal,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, token);
}

function money(value: string, currency: string) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(Number(value));
}

function newIdempotencyKey() {
  return globalThis.crypto.randomUUID();
}

function localDateTimeValue(date = new Date()) {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return localDate.toISOString().slice(0, 16);
}

function isSettlementPaymentMethod(value: string): value is SettlementPaymentMethod {
  return ['UPI', 'CASH', 'BANK_TRANSFER', 'OTHER'].includes(value);
}

export default function SettlementPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const token = getSessionToken();
  const initialTrip = new URLSearchParams(location.search).get('tripId') ?? '';
  const [trips, setTrips] = useState<Trip[]>([]);
  const [tripId, setTripId] = useState(initialTrip);
  const [currentUserId, setCurrentUserId] = useState('');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [reviewExpenses, setReviewExpenses] = useState<ReviewExpense[]>([]);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [refundAmounts, setRefundAmounts] = useState<Record<string, string>>({});
  const [references, setReferences] = useState<Record<string, string>>({});
  const [paymentMethods, setPaymentMethods] = useState<Record<string, SettlementPaymentMethod>>({});
  const [paymentDateTimes, setPaymentDateTimes] = useState<Record<string, string>>({});
  const [paymentNotes, setPaymentNotes] = useState<Record<string, string>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notificationRefreshKey, setNotificationRefreshKey] = useState(0);
  const requestSequence = useRef(0);

  useEffect(() => {
    if (!token) {
      navigate('/');
      return;
    }
    let active = true;
    void Promise.all([
      request<{ trips: Trip[] }>(token, '/api/trips'),
      request<{ user: { id: string } }>(token, '/api/auth/me'),
    ]).then(([tripPayload, userPayload]) => {
      if (!active) return;
      setTrips(tripPayload.trips);
      setCurrentUserId(userPayload.user.id);
      setTripId((selected) => selected || tripPayload.trips[0]?.id || '');
    }).catch((loadError: unknown) => {
      if (active) setError(loadError instanceof Error ? loadError.message : 'Could not load trips.');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [navigate, token]);

  const refresh = useCallback(async (selectedTripId: string, signal?: AbortSignal) => {
    if (!selectedTripId) return;
    const sequence = ++requestSequence.current;
    const [tripPayload, overviewPayload, reviewPayload] = await Promise.all([
      request<{ trip: Trip }>(token, `/api/trips/${selectedTripId}`, undefined, signal),
      request<Overview>(token, `/api/trips/${selectedTripId}/settlements`, undefined, signal),
      request<{ expenses: ReviewExpense[] }>(
        token, `/api/trips/${selectedTripId}/closure/reviews`, undefined, signal,
      ),
    ]);
    if (sequence !== requestSequence.current || signal?.aborted) return;
    setTrips((current) => current.map((trip) =>
      trip.id === selectedTripId ? { ...trip, ...tripPayload.trip } : trip,
    ));
    setOverview(overviewPayload);
    setReviewExpenses(reviewPayload.expenses);
  }, [token]);

  const handleTripEvent = useCallback(() => {
    if (!tripId) return;
    setNotificationRefreshKey((current) => current + 1);
    void refresh(tripId).catch((refreshError: unknown) => {
      setError(refreshError instanceof Error ? refreshError.message : 'Could not refresh trip updates.');
    });
  }, [refresh, tripId]);
  useTripEvents(tripId, handleTripEvent);

  useEffect(() => {
    if (!tripId) {
      setOverview(null);
      setReviewExpenses([]);
      return;
    }
    const controller = new AbortController();
    setError('');
    void refresh(tripId, controller.signal).catch((loadError: unknown) => {
      if (!controller.signal.aborted) {
        setError(loadError instanceof Error ? loadError.message : 'Could not load settlement details.');
      }
    });
    return () => {
      controller.abort();
      requestSequence.current += 1;
    };
  }, [refresh, tripId]);

  const selectedTrip = trips.find((trip) => trip.id === tripId);
  const role = selectedTrip?.members.find((member) => member.userId === currentUserId)?.role ?? 'MEMBER';
  const manager = role === 'OWNER' || role === 'ADMIN';

  async function perform(path: string, body?: unknown) {
    if (!tripId) return;
    setBusy(true);
    setError('');
    try {
      await request(token, `/api/trips/${tripId}${path}`, body);
      await refresh(tripId);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : 'The action could not be completed.');
    } finally {
      setBusy(false);
    }
  }

  async function submitPayment(event: FormEvent<HTMLFormElement>, settlement: Settlement) {
    event.preventDefault();
    const paymentDateTime = paymentDateTimes[settlement.id] ?? localDateTimeValue();
    await perform(`/settlements/${settlement.id}/payments`, {
      amount: amounts[settlement.id] ?? '',
      transactionReference: references[settlement.id]?.trim() || null,
      paymentMethod: paymentMethods[settlement.id] ?? 'UPI',
      paymentDateTime: new Date(paymentDateTime).toISOString(),
      paymentNotes: paymentNotes[settlement.id]?.trim() || null,
      idempotencyKey: newIdempotencyKey(),
    });
  }

  function memberName(userId: string) {
    return selectedTrip?.members.find((member) => member.userId === userId)?.userId === currentUserId
      ? 'You'
      : overview?.balances.find((member) => member.userId === userId)?.fullName ?? 'Trip member';
  }

  if (loading) {
    return <main className="mx-auto max-w-6xl px-4 py-10" aria-live="polite">Loading settlements…</main>;
  }

  return (
    <main className="min-h-screen px-4 py-8 text-slate-900 md:px-8">
      <div className="mx-auto max-w-6xl">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-4">
              <Link to="/dashboard" className="text-sm font-semibold text-primary">← Back to expenses</Link>
              <Link to={`/analytics?tripId=${tripId}`} className="text-sm font-semibold text-primary">Analytics</Link>
              <Link to={`/reports?tripId=${tripId}`} className="text-sm font-semibold text-primary">Reports</Link>
            </div>
            <p className="mt-4 text-xs font-semibold uppercase tracking-[0.2em] text-primary">TripLedger</p>
            <h1 className="mt-1 text-3xl font-bold">Trip settlement</h1>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            {tripId && <NotificationCenter tripId={tripId} refreshKey={notificationRefreshKey} />}
            <label className="min-w-52 text-sm font-medium" htmlFor="settlement-trip">
              Choose trip
              <select
                id="settlement-trip"
                className="input-field mt-1"
                value={tripId}
                onChange={(event) => {
                  setTripId(event.target.value);
                  setOverview(null);
                  setReviewExpenses([]);
                }}
              >
                {trips.map((trip) => <option key={trip.id} value={trip.id}>{trip.name}</option>)}
              </select>
            </label>
          </div>
        </header>

        {error && <div role="alert" className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-red-800">{error}</div>}
        {!selectedTrip || !overview ? (
          <section className="card-surface p-6">
            <h2 className="text-xl font-semibold">No settlement data yet</h2>
            <p className="mt-2 text-slate-600">Choose a trip to review expenses and settlement status.</p>
          </section>
        ) : (
          <>
            <section className="card-surface mb-6 p-5" aria-labelledby="closure-title">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 id="closure-title" className="text-xl font-semibold">{selectedTrip.name}</h2>
                  <p className="mt-1 text-sm text-slate-600">
                    Trip status: <strong>{overview.tripStatus.replaceAll('_', ' ')}</strong>
                    {' · '}Plan revision {overview.planRevision}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {overview.tripStatus === 'ACTIVE' && (
                    <>
                      <button type="button" className="btn-secondary min-h-11" disabled={busy} onClick={() => void perform('/closure-requests', {})}>
                        Request closure
                      </button>
                      {manager && (
                        <button type="button" className="btn-primary min-h-11" disabled={busy} onClick={() => void perform('/closure/initiate', {})}>
                          Initiate closure
                        </button>
                      )}
                    </>
                  )}
                  {manager && overview.tripStatus === 'CLOSING' && (
                    <button type="button" className="btn-primary min-h-11" disabled={busy} onClick={() => void perform('/closure/review/start', {})}>
                      Start expense review
                    </button>
                  )}
                  {overview.paymentNotifications.length > 0 && (
                    <section className="card-surface mb-6 p-5" aria-labelledby="payment-notifications-title">
                      <h2 id="payment-notifications-title" className="text-xl font-semibold">Payment notifications</h2>
                      <ul className="mt-3 space-y-3">
                        {overview.paymentNotifications.map((notification) => (
                          <li key={notification.id} className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                            <p className="font-semibold">{notification.title}</p>
                            <p className="mt-1 text-sm text-slate-700">{notification.message}</p>
                            <time className="mt-2 block text-xs text-slate-600" dateTime={notification.createdAt}>
                              {new Date(notification.createdAt).toLocaleString()}
                            </time>
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}

                  {manager && overview.tripStatus === 'EXPENSE_REVIEW' && (
                    <button type="button" className="btn-primary min-h-11" disabled={busy} onClick={() => void perform('/settlements/generate', {})}>
                      Generate settlement plan
                    </button>
                  )}
                  {manager && overview.tripStatus === 'FULLY_SETTLED' && (
                    <button type="button" className="btn-primary min-h-11" disabled={busy} onClick={() => void perform('/closure/finalize', {})}>
                      Close trip
                    </button>
                  )}
                  {role === 'OWNER' && overview.tripStatus === 'TRIP_CLOSED' && (
                    <button
                      type="button"
                      className="btn-secondary min-h-11"
                      disabled={busy || (reasons.reopen ?? '').trim().length < 3}
                      onClick={() => void perform('/closure/reopen', { reason: reasons.reopen, })}
                    >
                      Reopen trip
                    </button>
                  )}
                </div>
              </div>
              {role === 'OWNER' && overview.tripStatus === 'TRIP_CLOSED' && (
                <label className="mt-4 block max-w-xl text-sm font-medium" htmlFor="reopen-reason">
                  Reason for reopening
                  <textarea id="reopen-reason" className="input-field mt-1 min-h-20" value={reasons.reopen ?? ''}
                    onChange={(event) => setReasons((current) => ({ ...current, reopen: event.target.value }))} />
                </label>
              )}
              {overview.closureRequests.length > 0 && (
                <p className="mt-3 text-sm text-slate-600">
                  Closure requested by {overview.closureRequests.map((item) => item.user?.fullName ?? 'Trip member').join(', ')}.
                </p>
              )}
            </section>

            {overview.tripStatus === 'CLOSING' || overview.tripStatus === 'EXPENSE_REVIEW' ? (
              <section className="mb-6 space-y-4" aria-labelledby="review-title">
                <div>
                  <h2 id="review-title" className="text-xl font-semibold">Expense review</h2>
                  <p className="mt-1 text-sm text-slate-600">
                    Confirm your own expense responsibility and payer contributions. Pending reviews or disputes block plan generation.
                  </p>
                </div>
                {reviewExpenses.length === 0 && (
                  <div className="card-surface p-5 text-sm text-slate-600">No active expenses require review for this account.</div>
                )}
                {reviewExpenses.map((expense) => {
                  const myReview = expense.reviews.find((item) => item.userId === currentUserId);
                  const disputed = expense.reviews.filter((item) => item.status === 'DISPUTED');
                  return (
                    <article key={expense.id} className="card-surface p-5">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                          <h3 className="font-semibold">{expense.title}</h3>
                          <p className="mt-1 text-sm text-slate-600">{money(expense.amount, expense.currency)}</p>
                          <p className="mt-2 text-sm text-slate-600">
                            Your contribution: {expense.payers.find((payer) => payer.userId === currentUserId)?.contributionStatus ?? 'not a payer'}
                            {' · '}Your responsibility: {expense.allocations.find((allocation) => allocation.userId === currentUserId)?.allocatedAmount ?? 'none'}
                          </p>
                        </div>
                        {myReview?.status !== 'REVIEWED' && myReview?.status !== 'RESOLVED' && (
                          <button
                            type="button"
                            className="btn-primary min-h-11"
                            disabled={busy || myReview?.status === 'DISPUTED'}
                            onClick={() => void perform(`/closure/expenses/${expense.id}/review`, { status: 'REVIEWED' })}
                          >
                            Confirm my review
                          </button>
                        )}
                      </div>
                      {(expense.payers.some((payer) => payer.userId === currentUserId)
                        || expense.allocations.some((allocation) => allocation.userId === currentUserId))
                        && myReview?.status !== 'DISPUTED' && (
                          <form
                            className="mt-4 flex flex-col gap-2 sm:flex-row"
                            onSubmit={(event) => {
                              event.preventDefault();
                              void perform(`/closure/expenses/${expense.id}/review`, {
                                status: 'DISPUTED', comment: reasons[`expense-${expense.id}`] ?? '',
                              });
                            }}
                          >
                            <label className="sr-only" htmlFor={`expense-dispute-${expense.id}`}>Explain the expense review issue</label>
                            <input
                              id={`expense-dispute-${expense.id}`}
                              className="input-field min-h-11"
                              value={reasons[`expense-${expense.id}`] ?? ''}
                              onChange={(event) => setReasons((current) => ({ ...current, [`expense-${expense.id}`]: event.target.value }))}
                              minLength={3}
                              maxLength={500}
                              placeholder="Describe an issue with this expense"
                            />
                            <button type="submit" className="btn-secondary min-h-11" disabled={busy || (reasons[`expense-${expense.id}`] ?? '').trim().length < 3}>
                              Report issue
                            </button>
                          </form>
                        )}
                      {manager && disputed.map((review) => (
                        <form
                          key={review.userId}
                          className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4"
                          onSubmit={(event) => {
                            event.preventDefault();
                            void perform(`/closure/expenses/${expense.id}/resolve`, {
                              userId: review.userId, reason: reasons[`resolve-${expense.id}-${review.userId}`] ?? '',
                            });
                          }}
                        >
                          <p className="text-sm font-medium">Dispute from {memberName(review.userId)}: {review.comment}</p>
                          <label className="mt-3 block text-sm font-medium" htmlFor={`resolution-${expense.id}-${review.userId}`}>
                            Resolution explanation
                            <input
                              id={`resolution-${expense.id}-${review.userId}`}
                              className="input-field mt-1"
                              value={reasons[`resolve-${expense.id}-${review.userId}`] ?? ''}
                              onChange={(event) => setReasons((current) => ({
                                ...current, [`resolve-${expense.id}-${review.userId}`]: event.target.value,
                              }))}
                            />
                          </label>
                          <button className="btn-secondary mt-3 min-h-11" disabled={busy || (reasons[`resolve-${expense.id}-${review.userId}`] ?? '').trim().length < 3}>
                            Resolve with explanation
                          </button>
                        </form>
                      ))}
                    </article>
                  );
                })}
                <p className="text-sm text-slate-600" role="status">
                  {overview.reviews.pending} pending reviews · {overview.reviews.disputed} unresolved disputes
                </p>
              </section>
            ) : null}

            <section className="mb-6" aria-labelledby="balance-title">
              <h2 id="balance-title" className="mb-3 text-xl font-semibold">Member-wise outstanding balances</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {overview.balances.map((member) => (
                  <article key={member.userId} className="card-surface p-4">
                    <h3 className="font-semibold">{member.fullName}</h3>
                    <p className="mt-2 text-lg font-bold tabular-nums">{money(member.balance, overview.currency)}</p>
                    <p className="text-xs text-slate-600">
                      {Number(member.balance) < 0 ? 'Must pay' : Number(member.balance) > 0 ? 'Should receive' : 'Settled'}
                    </p>
                  </article>
                ))}
              </div>
            </section>

            <section aria-labelledby="transfers-title">
              <h2 id="transfers-title" className="text-xl font-semibold">Suggested transfers and payment history</h2>
              <p className="mb-4 mt-1 text-sm text-slate-600">
                Deterministic greedy matching reduces practical transfers; it does not guarantee a globally optimal solution.
                Transfers happen outside this app. A creditor must check their own payment history and confirm or dispute the record;
                the app does not verify bank transactions.
              </p>
              {overview.settlements.length === 0 ? (
                <div className="card-surface p-5 text-sm text-slate-600">No transfers are currently required.</div>
              ) : overview.settlements.map((settlement) => (
                <article key={settlement.id} className="card-surface mb-4 p-5">
                  <div className="flex flex-wrap justify-between gap-3">
                    <div>
                      <p className="text-xs text-slate-600">Settlement ID: <span className="break-all font-mono">{settlement.id}</span></p>
                      <h3 className="font-semibold">
                        {memberName(settlement.debtorUserId)} {settlement.debtorUserId === currentUserId ? 'pay' : 'pays'} {memberName(settlement.creditorUserId)}
                      </h3>
                      <p className="mt-1 text-sm text-slate-600">Status: {settlement.status.replaceAll('_', ' ')}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-bold">{money(settlement.remainingAmount, overview.currency)} remaining</p>
                      <p className="text-sm text-slate-600">
                        {money(settlement.confirmedPaidAmount, overview.currency)} of {money(settlement.totalAmount, overview.currency)} confirmed
                      </p>
                    </div>
                  </div>
                  {currentUserId === settlement.debtorUserId && Number(settlement.remainingAmount) > 0
                    && ['PAYMENTS_PENDING', 'PARTIALLY_SETTLED'].includes(overview.tripStatus) && (
                      <form className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4" onSubmit={(event) => void submitPayment(event, settlement)}>
                        <h4 className="font-semibold">Record an external payment</h4>
                        <p className="mt-1 text-sm text-slate-600">
                          Transfer outside TripLedger, then record what you sent. The creditor must confirm receipt.
                        </p>
                        <div className="mt-4 grid gap-4 sm:grid-cols-2">
                          <label className="text-sm font-medium" htmlFor={`amount-${settlement.id}`}>
                            Amount <span aria-hidden="true">*</span>
                            <input id={`amount-${settlement.id}`} className="input-field mt-1 min-h-11" type="number" inputMode="decimal" min="0.01" step="0.01" required
                              value={amounts[settlement.id] ?? ''} onChange={(event) => setAmounts((current) => ({ ...current, [settlement.id]: event.target.value }))} />
                          </label>
                          <label className="text-sm font-medium" htmlFor={`method-${settlement.id}`}>
                            Payment method <span aria-hidden="true">*</span>
                            <select id={`method-${settlement.id}`} className="input-field mt-1 min-h-11" required
                              value={paymentMethods[settlement.id] ?? 'UPI'}
                              onChange={(event) => {
                                const { value } = event.target;
                                if (isSettlementPaymentMethod(value)) {
                                  setPaymentMethods((current) => ({ ...current, [settlement.id]: value }));
                                }
                              }}>
                              <option value="UPI">UPI (external app)</option>
                              <option value="CASH">Cash</option>
                              <option value="BANK_TRANSFER">Bank transfer</option>
                              <option value="OTHER">Other</option>
                            </select>
                          </label>
                          <label className="text-sm font-medium" htmlFor={`payment-date-${settlement.id}`}>
                            Payment date and time <span aria-hidden="true">*</span>
                            <input id={`payment-date-${settlement.id}`} className="input-field mt-1 min-h-11" type="datetime-local" required
                              value={paymentDateTimes[settlement.id] ?? localDateTimeValue()}
                              onChange={(event) => setPaymentDateTimes((current) => ({ ...current, [settlement.id]: event.target.value }))} />
                          </label>
                          <label className="text-sm font-medium" htmlFor={`reference-${settlement.id}`}>
                            Transaction or bank reference <span className="font-normal text-slate-600">(optional)</span>
                            <input id={`reference-${settlement.id}`} className="input-field mt-1 min-h-11" maxLength={191}
                              value={references[settlement.id] ?? ''} onChange={(event) => setReferences((current) => ({ ...current, [settlement.id]: event.target.value }))} />
                          </label>
                          <label className="text-sm font-medium sm:col-span-2" htmlFor={`payment-notes-${settlement.id}`}>
                            Notes <span className="font-normal text-slate-600">(optional)</span>
                            <textarea id={`payment-notes-${settlement.id}`} className="input-field mt-1 min-h-20"
                              maxLength={500} value={paymentNotes[settlement.id] ?? ''}
                              onChange={(event) => setPaymentNotes((current) => ({ ...current, [settlement.id]: event.target.value }))} />
                          </label>
                        </div>
                        <p className="mt-3 text-xs text-slate-600">
                          A reference or note is supporting information only and does not verify a transfer.
                        </p>
                        <button className="btn-primary mt-4 min-h-11 w-full sm:w-auto" disabled={busy}>
                          Record payment for creditor confirmation
                        </button>
                      </form>
                    )}
                  <div className="mt-4 space-y-3">
                    {settlement.payments.map((payment) => (
                      <div key={payment.id} className="rounded-xl border border-orange-100 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <p className="text-sm">
                            {money(payment.amount, overview.currency)} · {payment.status.replaceAll('_', ' ')}
                            {payment.paymentMethod ? ` · ${payment.paymentMethod.replaceAll('_', ' ')}` : ''}
                            {payment.paymentDateTime ? ` · ${new Date(payment.paymentDateTime).toLocaleString()}` : ''}
                            {payment.transactionReference ? ` · Ref: ${payment.transactionReference}` : ''}
                          </p>
                          {payment.paymentNotes && <p className="mt-1 text-sm text-slate-600">{payment.paymentNotes}</p>}
                          {Number(payment.refundedAmount) > 0 && (
                            <p className="mt-1 text-xs text-slate-600">
                              Refunded {money(payment.refundedAmount, overview.currency)}
                            </p>
                          )}
                          {currentUserId === settlement.creditorUserId && payment.status === 'INITIATED' && (
                            <button className="btn-primary min-h-11" disabled={busy} onClick={() => void perform(
                              `/settlements/payments/${payment.id}/confirm`, { idempotencyKey: newIdempotencyKey() },
                            )}>
                              Confirm receipt
                            </button>
                          )}
                          {manager && payment.status === 'DISPUTED' && (
                            <div className="flex flex-col gap-2 sm:flex-row">
                              <label className="sr-only" htmlFor={`payment-reason-${payment.id}`}>Administrative resolution reason</label>
                              <input id={`payment-reason-${payment.id}`} className="input-field min-h-11"
                                value={reasons[`payment-${payment.id}`] ?? ''}
                                onChange={(event) => setReasons((current) => ({ ...current, [`payment-${payment.id}`]: event.target.value }))}
                                placeholder="Administrative resolution reason" />
                              <button className="btn-secondary min-h-11" disabled={busy || (reasons[`payment-${payment.id}`] ?? '').trim().length < 3}
                                onClick={() => void perform(`/settlements/payments/${payment.id}/resolve`, {
                                  status: 'SUCCESSFUL', reason: reasons[`payment-${payment.id}`], idempotencyKey: newIdempotencyKey(),
                                })}>Resolve as received</button>
                              <button className="btn-secondary min-h-11" disabled={busy || (reasons[`payment-${payment.id}`] ?? '').trim().length < 3}
                                onClick={() => void perform(`/settlements/payments/${payment.id}/resolve`, {
                                  status: 'DECLINED', reason: reasons[`payment-${payment.id}`], idempotencyKey: newIdempotencyKey(),
                                })}>Resolve as declined</button>
                            </div>
                          )}
                          {manager && payment.status === 'SUCCESSFUL' && Number(payment.refundableAmount) > 0 && (
                            <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => {
                              event.preventDefault();
                              void perform(`/settlements/payments/${payment.id}/refund`, {
                                amount: refundAmounts[payment.id] ?? '',
                                reason: reasons[`refund-${payment.id}`],
                                idempotencyKey: newIdempotencyKey(),
                              });
                            }}>
                              <label className="text-sm font-medium" htmlFor={`refund-amount-${payment.id}`}>
                                Refund amount (up to {money(payment.refundableAmount, overview.currency)})
                                <input id={`refund-amount-${payment.id}`} className="input-field mt-1 min-h-11 w-40"
                                  type="number" inputMode="decimal" min="0.01" step="0.01"
                                  max={payment.refundableAmount} required
                                  value={refundAmounts[payment.id] ?? ''}
                                  onChange={(event) => setRefundAmounts((current) => ({ ...current, [payment.id]: event.target.value }))} />
                              </label>
                              <label className="text-sm font-medium" htmlFor={`refund-reason-${payment.id}`}>
                                Reason
                                <input id={`refund-reason-${payment.id}`} className="input-field mt-1 min-h-11"
                                  required minLength={3} maxLength={500}
                                  value={reasons[`refund-${payment.id}`] ?? ''}
                                  onChange={(event) => setReasons((current) => ({ ...current, [`refund-${payment.id}`]: event.target.value }))} />
                              </label>
                              <button className="btn-secondary min-h-11" disabled={busy}>Record refund</button>
                            </form>
                          )}
                        </div>
                        {['INITIATED', 'SUCCESSFUL'].includes(payment.status) && (
                          <form className="mt-3 flex flex-col gap-2 sm:flex-row" onSubmit={(event) => {
                            event.preventDefault();
                            void perform(`/settlements/payments/${payment.id}/dispute`, {
                              reason: reasons[`payment-${payment.id}`], idempotencyKey: newIdempotencyKey(),
                            });
                          }}>
                            <label className="sr-only" htmlFor={`payment-reason-${payment.id}`}>Payment issue or administrative reason</label>
                            <input id={`payment-reason-${payment.id}`} className="input-field min-h-11"
                              value={reasons[`payment-${payment.id}`] ?? ''}
                              onChange={(event) => setReasons((current) => ({ ...current, [`payment-${payment.id}`]: event.target.value }))}
                              placeholder="Reason for dispute or administrative action" />
                            {[settlement.debtorUserId, settlement.creditorUserId].includes(currentUserId) && (
                              <button className="btn-secondary min-h-11" disabled={busy || (reasons[`payment-${payment.id}`] ?? '').trim().length < 3}>Dispute payment</button>
                            )}
                          </form>
                        )}
                        {payment.events.length > 0 && (
                          <ol className="mt-3 space-y-1 text-xs text-slate-600">
                            {payment.events.map((event) => (
                              <li key={`${event.action}-${event.createdAt}`}>
                                {event.action.replaceAll('_', ' ').toLowerCase()} · {new Date(event.createdAt).toLocaleString()}
                                {event.reason ? ` · ${event.reason}` : ''}
                              </li>
                            ))}
                          </ol>
                        )}
                      </div>
                    ))}
                  </div>
                </article>
              ))}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
