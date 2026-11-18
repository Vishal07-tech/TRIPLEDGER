import { useCallback, useEffect, useRef, useState } from 'react';
import { LogOut, RefreshCw } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';

import BudgetOverview, { type BudgetSummary } from '../components/BudgetOverview';
import ExpenseForm, { type ExpenseCorrectionDraft } from '../components/ExpenseForm';
import NotificationCenter from '../components/NotificationCenter';
import { apiRequest } from '../lib/apiClient';
import { clearSessionToken, getSessionToken } from '../lib/session';
import { useTripEvents } from '../lib/useTripEvents';

type Trip = {
  id: string;
  name: string;
  baseCurrency: string;
  cashManagerUserId: string | null;
  members: Array<{ userId: string; role: string; isActive: boolean }>;
};

type PendingInvitation = {
  id: string;
  tripId: string;
  expiresAt: string;
  trip: { name: string; baseCurrency: string; status: string };
};

type MemberBalance = {
  userId: string;
  fullName: string;
  isActive: boolean;
  recordedAdvances: string;
  responsibility: string;
  netBalance: string;
};

type Expense = {
  id: string;
  title: string;
  description: string | null;
  amount: string;
  currency: string;
  exchangeRate: string | null;
  category: string;
  date: string;
  expenseType: 'PERSONAL' | 'GROUP';
  splitMethod: 'EQUAL' | 'EXACT' | 'PERCENTAGE' | 'WEIGHTED';
  paymentMethod: 'CASH' | 'UPI';
  status: string;
  payers: Array<{ userId: string; amount: string; isCashManagerDisbursement: boolean }>;
  allocations: Array<{ userId: string; allocatedAmount: string }>;
};

type ExpenseAuditEntry = {
  id: string;
  action: string;
  createdAt: string;
  details: Record<string, unknown> | null;
  user: { fullName: string } | null;
};

type Balances = {
  currency: string;
  totalExpenses: string;
  members: MemberBalance[];
};

async function request<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  return apiRequest<T>(path, init, token);
}

function formatAmount(value: string, currency: string) {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return `${currency} ${value}`;

  const digits = new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
  }).resolvedOptions().maximumFractionDigits ?? 2;
  const isNegative = match[1] === '-';
  const whole = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(BigInt(match[2]));
  const fraction = (match[3] ?? '').slice(0, digits).padEnd(digits, '0');
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
    .formatToParts(isNegative ? -1 : 1)
    .map((part) => {
      if (part.type === 'integer') return whole;
      if (part.type === 'fraction') return fraction;
      return part.type === 'decimal' && digits === 0 ? '' : part.value;
    })
    .join('');
}

export default function ExpenseDashboard() {
  const navigate = useNavigate();
  const [token] = useState(getSessionToken);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [invitations, setInvitations] = useState<PendingInvitation[]>([]);
  const [invitationError, setInvitationError] = useState('');
  const [invitationMessage, setInvitationMessage] = useState('');
  const [acceptingInvitationId, setAcceptingInvitationId] = useState('');
  const [selectedTripId, setSelectedTripId] = useState('');
  const selectedTripIdRef = useRef('');
  const refreshSequenceRef = useRef(0);
  const [currentUserId, setCurrentUserId] = useState('');
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [balances, setBalances] = useState<Balances | null>(null);
  const [budget, setBudget] = useState<BudgetSummary | null>(null);
  const [notificationRefreshKey, setNotificationRefreshKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reversalTarget, setReversalTarget] = useState<Expense | null>(null);
  const [reversalReason, setReversalReason] = useState('');
  const [reversing, setReversing] = useState(false);
  const [historyExpenseId, setHistoryExpenseId] = useState('');
  const [historyEntries, setHistoryEntries] = useState<ExpenseAuditEntry[]>([]);
  const [correctionTarget, setCorrectionTarget] = useState<ExpenseCorrectionDraft | null>(null);

  const refreshTrip = useCallback(async (tripId: string) => {
    if (selectedTripIdRef.current !== tripId) {
      return;
    }
    const requestId = ++refreshSequenceRef.current;
    const [tripPayload, expensePayload, balancePayload, budgetPayload] = await Promise.all([
      request<{ trip: Trip }>(token, `/api/trips/${tripId}`),
      request<{ expenses: Expense[] }>(token, `/api/trips/${tripId}/expenses`),
      request<Balances>(token, `/api/trips/${tripId}/expenses/balances`),
      request<BudgetSummary>(token, `/api/trips/${tripId}/budgets`),
    ]);
    if (selectedTripIdRef.current !== tripId || requestId !== refreshSequenceRef.current) {
      return;
    }
    setExpenses(expensePayload.expenses);
    setBalances(balancePayload);
    setBudget(budgetPayload);
    setTrips((current) => current.map((trip) =>
      trip.id === tripId ? { ...trip, ...tripPayload.trip } : trip,
    ));
  }, [token]);

  const handleTripEvent = useCallback(() => {
    const tripId = selectedTripIdRef.current;
    if (!tripId) return;
    setNotificationRefreshKey((current) => current + 1);
    void refreshTrip(tripId).catch((refreshError: unknown) => {
      setError(refreshError instanceof Error ? refreshError.message : 'Could not refresh trip updates.');
    });
  }, [refreshTrip]);
  useTripEvents(selectedTripId, handleTripEvent);

  useEffect(() => {
    if (!token) {
      navigate('/');
      return;
    }

    let active = true;
    async function loadTrips() {
      try {
        const [tripPayload, userPayload] = await Promise.all([
          request<{ trips: Trip[] }>(token, '/api/trips'),
          request<{ user: { id: string } }>(token, '/api/auth/me'),
        ]);
        if (!active) return;
        setTrips(tripPayload.trips);
        setCurrentUserId(userPayload.user.id);
        setSelectedTripId((selected) => {
          const requested = new URLSearchParams(window.location.search).get('tripId') ?? '';
          const requestedIsAccessible = tripPayload.trips.some((trip) => trip.id === requested);
          const nextTripId = requestedIsAccessible ? requested : selected || tripPayload.trips[0]?.id || '';
          selectedTripIdRef.current = nextTripId;
          return nextTripId;
        });
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Could not load trips.');
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadTrips();
    return () => {
      active = false;
    };
  }, [navigate, token]);

  useEffect(() => {
    if (!token) return;
    let active = true;
    void request<{ invitations: PendingInvitation[] }>(token, '/api/invitations')
      .then(({ invitations: pending }) => {
        if (active) setInvitations(pending);
      })
      .catch((loadError: unknown) => {
        if (active) setInvitationError(loadError instanceof Error ? loadError.message : 'Could not load invitations.');
      });
    return () => { active = false; };
  }, [token]);

  useEffect(() => {
    if (!token || !selectedTripId) {
      setExpenses([]);
      setBalances(null);
      setBudget(null);
      return;
    }

    let active = true;
    setError('');
    void refreshTrip(selectedTripId).catch((loadError: unknown) => {
      if (active) setError(loadError instanceof Error ? loadError.message : 'Could not load trip expenses.');
    });
    return () => {
      active = false;
    };
  }, [refreshTrip, selectedTripId, token]);

  const selectedTrip = trips.find((trip) => trip.id === selectedTripId) ?? null;

  async function handleSaved() {
    if (selectedTripId) {
      await refreshTrip(selectedTripId);
    }
    setCorrectionTarget(null);
  }

  async function handleSaveBudget(userId: string, plannedBudget: string) {
    if (!selectedTripId) return;
    const requestTripId = selectedTripId;
    await request<{ budget: unknown }>(token, `/api/trips/${requestTripId}/budgets`, {
      method: 'POST',
      body: JSON.stringify({ userId, plannedBudget }),
    });
    if (selectedTripIdRef.current === requestTripId) {
      await refreshTrip(requestTripId);
    }
  }

  async function handleReverse() {
    if (!selectedTripId || !reversalTarget || reversalReason.trim().length < 3) return;
    setReversing(true);
    setError('');
    try {
      await request<{ expense: { id: string } }>(
        token,
        `/api/trips/${selectedTripId}/expenses/${reversalTarget.id}/reversal`,
        {
          method: 'POST',
          body: JSON.stringify({ reason: reversalReason }),
        },
      );
      setReversalTarget(null);
      setReversalReason('');
      await refreshTrip(selectedTripId);
    } catch (reverseError) {
      setError(reverseError instanceof Error ? reverseError.message : 'Could not reverse this expense.');
    } finally {
      setReversing(false);
    }
  }

  async function toggleHistory(expenseId: string) {
    if (historyExpenseId === expenseId) {
      setHistoryExpenseId('');
      setHistoryEntries([]);
      return;
    }

    try {
      const payload = await request<{ history: ExpenseAuditEntry[] }>(
        token,
        `/api/trips/${selectedTripId}/expenses/${expenseId}/history`,
      );
      setHistoryExpenseId(expenseId);
      setHistoryEntries(payload.history);
    } catch (historyError) {
      setError(historyError instanceof Error ? historyError.message : 'Could not load expense history.');
    }
  }

  async function handleAcceptInvitation(invitation: PendingInvitation) {
    if (!token) return;
    setAcceptingInvitationId(invitation.id);
    setInvitationError('');
    setInvitationMessage('');
    try {
      await request<{ accepted: boolean; tripId: string }>(token, `/api/invitations/${invitation.id}/accept`, {
        method: 'POST',
      });
      setInvitations((current) => current.filter((item) => item.id !== invitation.id));
      const tripPayload = await request<{ trips: Trip[] }>(token, '/api/trips');
      setTrips(tripPayload.trips);
      if (!selectedTripIdRef.current) {
        selectedTripIdRef.current = invitation.tripId;
        setSelectedTripId(invitation.tripId);
      }
      setInvitationMessage(`You joined ${invitation.trip.name}.`);
    } catch (acceptError) {
      setInvitationError(acceptError instanceof Error ? acceptError.message : 'Could not accept this invitation.');
    } finally {
      setAcceptingInvitationId('');
    }
  }

  function signOut() {
    clearSessionToken();
    navigate('/');
  }

  return (
    <main className="min-h-screen px-4 py-8 text-slate-900 md:px-8">
      <div className="mx-auto max-w-7xl">
        <header className="mb-8 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-orange-100 bg-white p-5 shadow-soft">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">TripLedger</p>
            <h1 className="mt-2 text-3xl font-bold">Shared expenses</h1>
          </div>
          <div className="flex items-center gap-3">
            <Link className="btn-secondary min-h-11" to="/trips">My Trips</Link>
            <a className="btn-secondary min-h-11" href="#budgets">Budgets</a>
            <Link className="btn-secondary min-h-11" to={`/settlements?tripId=${selectedTripId}`}>Settlement</Link>
            <Link className="btn-secondary min-h-11" to={`/analytics?tripId=${selectedTripId}`}>Analytics</Link>
            <Link className="btn-secondary min-h-11" to={`/reports?tripId=${selectedTripId}`}>Reports</Link>
            {selectedTripId && (
              <Link className="btn-secondary min-h-11" to={`/trips/${selectedTripId}`}>Manage trip</Link>
            )}
            {selectedTripId && (
              <NotificationCenter tripId={selectedTripId} refreshKey={notificationRefreshKey} />
            )}
            <label className="sr-only" htmlFor="trip-select">Choose trip</label>
            <select
              id="trip-select"
              className="input-field min-w-48"
              value={selectedTripId}
              onChange={(event) => {
                const nextTripId = event.target.value;
                selectedTripIdRef.current = nextTripId;
                refreshSequenceRef.current += 1;
                setSelectedTripId(nextTripId);
                setExpenses([]);
                setBalances(null);
                setBudget(null);
                setCorrectionTarget(null);
              }}
              disabled={loading || trips.length === 0}
            >
              {trips.length === 0 && <option value="">No trips available</option>}
              {trips.map((trip) => (
                <option key={trip.id} value={trip.id}>{trip.name}</option>
              ))}
            </select>
            <button type="button" className="btn-secondary" onClick={signOut} aria-label="Sign out">
              <LogOut aria-hidden="true" size={18} />
            </button>
          </div>
        </header>

        {error && (
          <div role="alert" className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        )}

        {(invitations.length > 0 || invitationError || invitationMessage) && (
          <section className="card-surface mb-6 p-5" aria-labelledby="invitations-heading">
            <h2 id="invitations-heading" className="text-lg font-semibold">Trip invitations</h2>
            <p className="mt-1 text-sm text-slate-600">Invitations are for your signed-in account and expire after seven days.</p>
            {invitationError && <p className="mt-3 text-sm text-red-800" role="alert">{invitationError}</p>}
            {invitationMessage && <p className="mt-3 text-sm text-emerald-800" role="status">{invitationMessage}</p>}
            <ul className="mt-3 space-y-3">
              {invitations.map((invitation) => (
                <li key={invitation.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-orange-100 p-4">
                  <div>
                    <p className="font-medium">{invitation.trip.name}</p>
                    <p className="text-sm text-slate-600">{invitation.trip.baseCurrency} · Expires {new Date(invitation.expiresAt).toLocaleString()}</p>
                  </div>
                  <button
                    type="button"
                    className="btn-primary min-h-11"
                    disabled={Boolean(acceptingInvitationId)}
                    onClick={() => void handleAcceptInvitation(invitation)}
                  >
                    {acceptingInvitationId === invitation.id ? 'Accepting…' : 'Accept invitation'}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {loading ? (
          <div className="card-surface p-8 text-center text-slate-600">Loading your trips…</div>
        ) : !selectedTrip ? (
          <div className="card-surface p-8">
            <h2 className="text-xl font-semibold">No trips yet</h2>
            <p className="mt-2 text-sm text-slate-600">Create or join a trip before recording shared expenses.</p>
          </div>
        ) : (
          <>
            <section aria-label="Trip financial summary" className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <SummaryCard title="Recorded trip expenses" amount={balances?.totalExpenses ?? '0.00'} currency={selectedTrip.baseCurrency} />
              <SummaryCard
                title="My responsibility"
                amount={balances?.members.find((member) => member.userId === currentUserId)?.responsibility ?? '0.00'}
                currency={selectedTrip.baseCurrency}
              />
              <SummaryCard
                title="My recorded advances"
                amount={balances?.members.find((member) => member.userId === currentUserId)?.recordedAdvances ?? '0.00'}
                currency={selectedTrip.baseCurrency}
              />
            </section>

            {budget && (
              <BudgetOverview
                budget={budget}
                canManage={selectedTrip.members.some(
                  (member) => member.userId === currentUserId && ['OWNER', 'ADMIN'].includes(member.role),
                )}
                onSaveBudget={handleSaveBudget}
              />
            )}

            {balances && (
              <section className="card-surface mb-8 overflow-hidden">
                <div className="border-b border-orange-100 px-5 py-4">
                  <h2 className="text-lg font-semibold">Member balances</h2>
                  <p className="mt-1 text-sm text-slate-600">
                    Recorded advances and financial responsibility are tracked separately.
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-left text-sm">
                    <thead className="bg-orange-50 text-slate-600">
                      <tr>
                        <th className="px-5 py-3 font-semibold">Member</th>
                        <th className="px-5 py-3 font-semibold">Recorded advances</th>
                        <th className="px-5 py-3 font-semibold">Responsibility</th>
                        <th className="px-5 py-3 font-semibold">Net balance</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-orange-50">
                      {balances.members.map((member) => (
                        <tr key={member.userId}>
                          <th scope="row" className="px-5 py-3 font-medium">
                            {member.fullName}{member.isActive ? '' : ' (former member)'}
                          </th>
                          <td className="px-5 py-3">{formatAmount(member.recordedAdvances, balances.currency)}</td>
                          <td className="px-5 py-3">{formatAmount(member.responsibility, balances.currency)}</td>
                          <td className="px-5 py-3 font-semibold">{formatAmount(member.netBalance, balances.currency)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            <div className="grid items-start gap-8 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
              <ExpenseForm
                key={correctionTarget?.id ?? `${selectedTrip.id}-new`}
                token={token}
                trip={selectedTrip}
                members={balances?.members.filter((member) => member.isActive) ?? []}
                currentUserId={currentUserId}
                onSaved={handleSaved}
                correction={correctionTarget ?? undefined}
                onCancelCorrection={() => setCorrectionTarget(null)}
              />
              <section className="space-y-4" aria-labelledby="expense-list-title">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 id="expense-list-title" className="text-xl font-semibold">Expense history</h2>
                    <p className="mt-1 text-sm text-slate-600">{expenses.length} recorded entries</p>
                  </div>
                  <button
                    type="button"
                    className="btn-secondary !px-3 !py-2"
                    onClick={() => void handleSaved()}
                    aria-label="Refresh expenses"
                  >
                    <RefreshCw aria-hidden="true" size={17} />
                  </button>
                </div>
                {expenses.length === 0 ? (
                  <div className="card-surface p-6 text-sm text-slate-600">No expenses recorded for this trip yet.</div>
                ) : expenses.map((expense) => (
                  <article key={expense.id} className="card-surface p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h3 className="font-semibold">{expense.title}</h3>
                        <p className="mt-1 text-sm text-slate-500">
                          {new Date(expense.date).toLocaleDateString()} · {expense.expenseType.toLowerCase()} · {expense.status.toLowerCase()}
                        </p>
                      </div>
                      <p className="text-lg font-bold">{formatAmount(expense.amount, expense.currency)}</p>
                    </div>
                    <div className="mt-4 grid gap-3 border-t border-orange-100 pt-4 text-sm sm:grid-cols-2">
                      <p className="text-slate-600">
                        Paid by {expense.payers.map((payer) => balances?.members.find((member) => member.userId === payer.userId)?.fullName ?? 'Trip member').join(', ')}
                      </p>
                      <p className="text-slate-600">
                        Responsibility for {expense.allocations.length} member{expense.allocations.length === 1 ? '' : 's'}
                      </p>
                    </div>
                    {expense.paymentMethod === 'UPI' && (
                      <p className="mt-3 rounded-lg bg-cyan-50 px-3 py-2 text-xs text-cyan-900">
                        Payer amounts are member-recorded; no UPI payment verification is performed.
                      </p>
                    )}
                    {expense.status === 'ACTIVE' && (
                      <div className="mt-4 flex flex-wrap gap-4">
                        <button
                          type="button"
                          className="text-sm font-semibold text-primary underline-offset-2 hover:underline"
                          onClick={() => setCorrectionTarget(expense)}
                        >
                          Correct expense
                        </button>
                        <button
                          type="button"
                          className="text-sm font-semibold text-red-700 underline-offset-2 hover:underline"
                          onClick={() => setReversalTarget(expense)}
                        >
                          Reverse expense
                        </button>
                      </div>
                    )}
                    <button
                      type="button"
                      className="ml-4 mt-4 text-sm font-semibold text-primary underline-offset-2 hover:underline"
                      onClick={() => void toggleHistory(expense.id)}
                    >
                      {historyExpenseId === expense.id ? 'Hide audit history' : 'View audit history'}
                    </button>
                    {historyExpenseId === expense.id && (
                      <ol className="mt-4 space-y-3 border-t border-orange-100 pt-4 text-sm">
                        {historyEntries.map((entry) => (
                          <li key={entry.id}>
                            <p className="font-medium">{entry.action.replaceAll('_', ' ').toLowerCase()}</p>
                            <p className="text-xs text-slate-500">
                              {entry.user?.fullName ?? 'Trip member'} · {new Date(entry.createdAt).toLocaleString()}
                            </p>
                            {typeof entry.details?.reason === 'string' && (
                              <p className="mt-1 text-slate-600">{entry.details.reason}</p>
                            )}
                          </li>
                        ))}
                        {historyEntries.length === 0 && <li className="text-slate-500">No audit entries recorded.</li>}
                      </ol>
                    )}
                  </article>
                ))}
              </section>
            </div>
          </>
        )}
      </div>

      {reversalTarget && (
        <div className="fixed inset-0 z-10 grid place-items-center bg-slate-950/40 p-4" role="presentation">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="reverse-title"
            className="card-surface w-full max-w-md p-6"
          >
            <h2 id="reverse-title" className="text-xl font-semibold">Reverse {reversalTarget.title}</h2>
            <p className="mt-2 text-sm text-slate-600">
              This appends reversing ledger entries and preserves the original expense history.
            </p>
            <label className="mt-4 block text-sm font-medium" htmlFor="reversal-reason">
              Reason
              <textarea
                id="reversal-reason"
                className="input-field mt-1 min-h-24"
                value={reversalReason}
                onChange={(event) => setReversalReason(event.target.value)}
                minLength={3}
                maxLength={500}
                required
              />
            </label>
            <div className="mt-5 flex justify-end gap-3">
              <button type="button" className="btn-secondary" onClick={() => setReversalTarget(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary"
                onClick={() => void handleReverse()}
                disabled={reversing || reversalReason.trim().length < 3}
              >
                {reversing ? 'Reversing…' : 'Confirm reversal'}
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

function SummaryCard({ title, amount, currency }: { title: string; amount: string; currency: string }) {
  return (
    <div className="card-surface p-5">
      <p className="text-sm font-medium text-slate-600">{title}</p>
      <p className="mt-3 text-3xl font-bold">{formatAmount(amount, currency)}</p>
    </div>
  );
}
