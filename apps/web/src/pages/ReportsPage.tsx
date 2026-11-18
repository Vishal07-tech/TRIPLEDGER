import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { FileDown, Printer, RefreshCw } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import NotificationCenter from '../components/NotificationCenter';
import { apiFetch, apiRequest } from '../lib/apiClient';
import { clearSessionToken, getSessionToken } from '../lib/session';
import { useTripEvents } from '../lib/useTripEvents';

type ReportType = 'complete' | 'expenses' | 'members' | 'group-vs-personal' | 'budgets' | 'settlements';
type Trip = {
  id: string;
  name: string;
  baseCurrency: string;
  status: string;
  members: Array<{ userId: string; role: string; isActive: boolean }>;
};
type ReportMember = {
  userId: string;
  fullName: string;
  role: string;
  isActive: boolean;
  payerContribution: string;
  financialResponsibility: string;
  groupResponsibility: string;
  personalExpenses: string;
  netBalance: string;
  settlementOutstandingPayable: string;
  settlementOutstandingReceivable: string;
  settlementBalance: string;
  plannedBudget: string | null;
  utilizationPct: string | null;
  warningLevel: string;
};
type ReportExpense = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  category: string;
  expenseType: string;
  paymentMethod: string;
  date: string;
  convertedAmount: string;
  originalAmount: string;
  originalCurrency: string;
  correctedFrom: { id: string; title: string; status: string } | null;
  payers: Array<{ fullName: string; amount: string; paymentStatus: string }>;
  allocations: Array<{ fullName: string; allocatedAmount: string; currency: string }>;
};
type ReportPayment = {
  id: string;
  amount: string;
  paymentMethod: string | null;
  paymentDateTime: string | null;
  transactionReference: string | null;
  paymentNotes: string | null;
  status: string;
  refundedAmount: string;
  debtorSubmittedAt: string | null;
  creditorConfirmedAt: string | null;
  disputedAt: string | null;
  disputeReason: string | null;
  events: Array<{ actorUserId: string; action: string; reason: string | null; createdAt: string }>;
  refunds: Array<{ id: string; amount: string; currency: string; reason: string; createdAt: string }>;
};
type ReportSettlement = {
  id: string;
  debtorName: string;
  creditorName: string;
  planRevision: number;
  createdAt: string;
  createdByUserId: string | null;
  totalAmount: string;
  confirmedPaidAmount: string;
  remainingAmount: string;
  status: string;
  payments: ReportPayment[];
};
type ReportData = {
  meta: {
    reportType: ReportType;
    generatedAt: string;
    tripName: string;
    tripStatus: string;
    baseCurrency: string;
    settlementRevision: number;
    dateRange: { startDate: string | null; endDate: string | null };
    notes: string[];
  };
  spendingSummary: {
    totalSpending: string;
    groupSpending: string;
    personalSpending: string;
    activeExpenseCount: number;
    correctedExpenseCount: number;
    reversedExpenseCount: number;
  };
  expenseTypes: {
    group: { amount: string; count: number; percentage: string };
    personal: { amount: string; count: number; percentage: string };
  };
  categories: Array<{
    category: string;
    amount: string;
    groupAmount: string;
    personalAmount: string;
    expenseCount: number;
    percentage: string;
  }>;
  members: ReportMember[];
  availableMembers: Array<{ userId: string; fullName: string; isActive: boolean }>;
  budgets: {
    totalPlannedBudget: string;
    totalActualSpending: string;
    totalRemainingBudget: string;
    totalOverspending: string;
    overallUtilizationPct: string;
    members: Array<{
      userId: string;
      fullName: string;
      plannedBudget: string;
      recordedResponsibility: string;
      periodResponsibility: string;
      remainingBudget: string;
      overspending: string;
      utilizationPct: string;
      warningLevel: string;
      hasBudget: boolean;
    }>;
  };
  settlements: {
    tripStatus: string;
    planRevision: number;
    totalPlanned: string;
    totalPaid: string;
    totalPending: string;
    totalOutstanding: string;
    totalRefunded: string;
    settlementCount: number;
    completedCount: number;
    isFullySettled: boolean;
    settlements: ReportSettlement[];
    history: ReportSettlement[];
    refunds: Array<{ id: string; paymentId: string; amount: string; reason: string; createdAt: string }>;
  };
  expenses: ReportExpense[];
  auditHistory: Array<{
    id: string;
    action: string;
    entityId: string;
    actorName: string;
    details: unknown;
    createdAt: string;
  }>;
};

const reportOptions: Array<{ value: ReportType; label: string }> = [
  { value: 'complete', label: 'Complete trip financial report' },
  { value: 'expenses', label: 'Expense history' },
  { value: 'members', label: 'Member-wise financial report' },
  { value: 'group-vs-personal', label: 'Group vs personal expenses' },
  { value: 'budgets', label: 'Budget utilization' },
  { value: 'settlements', label: 'Settlement and refund history' },
];

function formatMoney(value: string, currency: string) {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return `${currency} ${value}`;
  const fraction = match[3] ?? '';
  try {
    const formatter = new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      minimumFractionDigits: fraction.length,
      maximumFractionDigits: fraction.length,
    });
    const whole = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(BigInt(match[2]));
    return formatter.formatToParts(match[1] ? -1 : 1).map((part) => {
      if (part.type === 'integer') return whole;
      if (part.type === 'fraction') return fraction;
      if (part.type === 'decimal' && fraction.length === 0) return '';
      return part.value;
    }).join('');
  } catch {
    return `${currency} ${value}`;
  }
}

function formatDate(value: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function buildReportQuery(type: ReportType, startDate: string, endDate: string, memberId: string) {
  const query = new URLSearchParams({ type });
  if (startDate) query.set('startDate', startDate);
  if (endDate) query.set('endDate', endDate);
  if (memberId) query.set('memberId', memberId);
  return query.toString();
}

export default function ReportsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const token = getSessionToken();
  const initialTripId = useMemo(
    () => new URLSearchParams(location.search).get('tripId') ?? '',
    [location.search],
  );
  const [trips, setTrips] = useState<Trip[]>([]);
  const [tripId, setTripId] = useState(initialTripId);
  const [reportType, setReportType] = useState<ReportType>('complete');
  const [startDateDraft, setStartDateDraft] = useState('');
  const [endDateDraft, setEndDateDraft] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [memberId, setMemberId] = useState('');
  const [report, setReport] = useState<ReportData | null>(null);
  const [loadingTrips, setLoadingTrips] = useState(true);
  const [loadingReport, setLoadingReport] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [notificationRefreshKey, setNotificationRefreshKey] = useState(0);
  const [liveRefreshKey, setLiveRefreshKey] = useState(0);
  const requestSequence = useRef(0);

  useEffect(() => {
    if (!token) {
      navigate('/');
      return;
    }
    let active = true;
    void apiRequest<{ trips: Trip[] }>('/api/trips', undefined, token)
      .then(({ trips: availableTrips }) => {
        if (!active) return;
        setTrips(availableTrips);
        const selected = availableTrips.some((trip) => trip.id === initialTripId)
          ? initialTripId
          : availableTrips[0]?.id ?? '';
        setTripId(selected);
      })
      .catch((loadError: unknown) => {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Could not load trips.');
      })
      .finally(() => {
        if (active) setLoadingTrips(false);
      });
    return () => { active = false; };
  }, [initialTripId, navigate, token]);

  useEffect(() => {
    if (!tripId || !token) {
      setReport(null);
      setLoadingReport(false);
      return undefined;
    }
    const controller = new AbortController();
    const sequence = ++requestSequence.current;
    const query = buildReportQuery(reportType, startDate, endDate, memberId);
    setLoadingReport(true);
    setError('');
    setStatusMessage('');
    void apiRequest<ReportData>(
      `/api/trips/${tripId}/reports?${query}`,
      { signal: controller.signal },
      token,
    ).then((data) => {
      if (sequence === requestSequence.current && !controller.signal.aborted) setReport(data);
    }).catch((loadError: unknown) => {
      if (sequence === requestSequence.current && !controller.signal.aborted) {
        setError(loadError instanceof Error ? loadError.message : 'Could not load this report.');
        setReport(null);
      }
    }).finally(() => {
      if (sequence === requestSequence.current && !controller.signal.aborted) setLoadingReport(false);
    });
    return () => {
      controller.abort();
      requestSequence.current += 1;
    };
  }, [endDate, liveRefreshKey, memberId, reportType, startDate, token, tripId]);

  const handleTripEvent = useCallback(() => {
    setNotificationRefreshKey((current) => current + 1);
    setLiveRefreshKey((current) => current + 1);
  }, []);
  useTripEvents(tripId, handleTripEvent);

  const selectedTrip = trips.find((trip) => trip.id === tripId);
  const currency = report?.meta.baseCurrency ?? selectedTrip?.baseCurrency ?? 'INR';
  const memberOptions = report?.availableMembers ?? [];
  const hasExpenses = Boolean(report && report.expenses.length > 0);

  function applyDateFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (startDateDraft && endDateDraft && startDateDraft > endDateDraft) {
      setError('Start date cannot be after end date.');
      return;
    }
    setError('');
    setStartDate(startDateDraft);
    setEndDate(endDateDraft);
  }

  function changeTrip(nextTripId: string) {
    setTripId(nextTripId);
    setReport(null);
    setMemberId('');
    setStartDate('');
    setEndDate('');
    setStartDateDraft('');
    setEndDateDraft('');
    navigate(`/reports?tripId=${encodeURIComponent(nextTripId)}`, { replace: true });
  }

  async function downloadCsv() {
    if (!tripId) return;
    setDownloading(true);
    setError('');
    setStatusMessage('');
    try {
      const query = buildReportQuery(reportType, startDate, endDate, memberId);
      const response = await apiFetch(`/api/trips/${tripId}/reports/export?${query}`);
      if (!response.ok) {
        const payload = await response.json() as { message?: string };
        throw new Error(payload.message ?? 'CSV export could not be downloaded.');
      }
      const blob = await response.blob();
      const disposition = response.headers.get('content-disposition') ?? '';
      const filename = /filename="([^"]+)"/i.exec(disposition)?.[1] ?? 'trip-report.csv';
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      anchor.style.display = 'none';
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setStatusMessage('CSV download started. Recorded payments are manual reports, not bank-verified transactions.');
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : 'CSV export could not be downloaded.');
    } finally {
      setDownloading(false);
    }
  }

  function signOut() {
    clearSessionToken();
    navigate('/');
  }

  const showExpenses = reportType === 'complete' || reportType === 'expenses';
  const showMembers = reportType === 'complete' || reportType === 'members';
  const showCategories = reportType === 'complete' || reportType === 'group-vs-personal';
  const showBudgets = reportType === 'complete' || reportType === 'budgets';
  const showSettlements = reportType === 'complete' || reportType === 'settlements';

  return (
    <main className="min-h-screen px-4 py-8 text-slate-900 md:px-8">
      <div className="mx-auto max-w-7xl">
        <header className="no-print mb-8 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-orange-100 bg-white p-5 shadow-soft">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">TripLedger</p>
            <h1 className="mt-2 text-3xl font-bold">Trip reports</h1>
          </div>
          <nav aria-label="Trip navigation" className="flex flex-wrap items-center gap-2">
            <Link className="btn-secondary min-h-11" to={`/dashboard?tripId=${tripId}`}>Expenses</Link>
            <Link className="btn-secondary min-h-11" to={`/settlements?tripId=${tripId}`}>Settlement</Link>
            <Link className="btn-secondary min-h-11" to={`/analytics?tripId=${tripId}`}>Analytics</Link>
            {tripId && <NotificationCenter tripId={tripId} refreshKey={notificationRefreshKey} />}
            <button type="button" className="btn-secondary min-h-11" onClick={signOut}>Sign out</button>
          </nav>
        </header>

        <section className="no-print card-surface mb-6 p-5 md:p-6" aria-labelledby="report-controls-heading">
          <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 id="report-controls-heading" className="text-xl font-semibold">Build a report</h2>
              <p className="mt-1 text-sm text-slate-600">Choose a trip, report type and optional filters.</p>
            </div>
            <label className="min-w-52 flex-1 sm:flex-none">
              <span className="mb-1 block text-sm font-medium">Trip</span>
              <select
                className="input-field"
                aria-label="Choose trip"
                value={tripId}
                onChange={(event) => changeTrip(event.target.value)}
                disabled={loadingTrips || trips.length === 0}
              >
                {trips.length === 0 && <option value="">No trips available</option>}
                {trips.map((trip) => <option key={trip.id} value={trip.id}>{trip.name}</option>)}
              </select>
            </label>
          </div>

          <form onSubmit={applyDateFilters} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
            <label>
              <span className="mb-1 block text-sm font-medium">Report type</span>
              <select
                className="input-field"
                value={reportType}
                onChange={(event) => setReportType(event.target.value as ReportType)}
              >
                {reportOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label>
              <span className="mb-1 block text-sm font-medium">From date</span>
              <input className="input-field" type="date" value={startDateDraft} onChange={(event) => setStartDateDraft(event.target.value)} />
            </label>
            <label>
              <span className="mb-1 block text-sm font-medium">To date</span>
              <input className="input-field" type="date" value={endDateDraft} onChange={(event) => setEndDateDraft(event.target.value)} />
            </label>
            <label>
              <span className="mb-1 block text-sm font-medium">Member</span>
              <select className="input-field" value={memberId} onChange={(event) => setMemberId(event.target.value)}>
                <option value="">All trip members</option>
                {memberOptions.map((member) => (
                  <option key={member.userId} value={member.userId}>
                    {member.fullName}{member.isActive ? '' : ' (inactive)'}
                  </option>
                ))}
              </select>
            </label>
            <button className="btn-primary min-h-11" type="submit" disabled={loadingReport}>
              {loadingReport ? 'Updating…' : 'Apply date range'}
            </button>
          </form>
          <p className="mt-3 text-xs leading-5 text-slate-600">
            Date range filters expense dates and period budget responsibility. Budgets also show trip-to-date totals; settlement balances are the current plan snapshot.
          </p>
        </section>

        <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn-primary min-h-11 gap-2" onClick={() => void downloadCsv()} disabled={!report || loadingReport || downloading}>
              <FileDown size={18} aria-hidden="true" />
              {downloading ? 'Preparing CSV…' : 'Download CSV'}
            </button>
            <button type="button" className="btn-secondary min-h-11 gap-2" onClick={() => window.print()} disabled={!report || loadingReport}>
              <Printer size={18} aria-hidden="true" />
              Print / Save as PDF
            </button>
          </div>
          {loadingReport && <p role="status" className="flex items-center gap-2 text-sm text-slate-600"><RefreshCw size={16} aria-hidden="true" /> Loading report…</p>}
        </div>
        {error && <p className="no-print mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">{error}</p>}
        {statusMessage && <p className="no-print mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900" role="status">{statusMessage}</p>}

        {loadingTrips ? (
          <div className="card-surface p-8 text-center text-slate-600" role="status">Loading trips…</div>
        ) : trips.length === 0 ? (
          <div className="card-surface p-8 text-center">
            <h2 className="text-lg font-semibold">No trips available</h2>
            <p className="mt-2 text-sm text-slate-600">Create or join a trip before generating a report.</p>
          </div>
        ) : loadingReport && !report ? (
          <div className="card-surface p-8 text-center text-slate-600" role="status">Preparing your report…</div>
        ) : report ? (
          <article id="trip-report-preview" className="report-preview card-surface p-5 md:p-8">
            <header className="report-heading border-b border-orange-100 pb-5">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">TripLedger · Financial report</p>
              <h2 className="mt-2 text-2xl font-bold">{report.meta.tripName}</h2>
              <dl className="mt-3 grid gap-2 text-sm text-slate-600 sm:grid-cols-2 lg:grid-cols-4">
                <div><dt className="font-medium text-slate-800">Trip status</dt><dd>{report.meta.tripStatus}</dd></div>
                <div><dt className="font-medium text-slate-800">Base currency</dt><dd>{report.meta.baseCurrency}</dd></div>
                <div><dt className="font-medium text-slate-800">Plan revision</dt><dd>{report.meta.settlementRevision}</dd></div>
                <div><dt className="font-medium text-slate-800">Generated</dt><dd>{formatDate(report.meta.generatedAt)}</dd></div>
              </dl>
              {(startDate || endDate) && (
                <p className="mt-2 text-sm text-slate-600">Expense dates: {startDate || 'All'} to {endDate || 'All'}</p>
              )}
            </header>

            {(reportType === 'complete' || reportType === 'group-vs-personal') && (
              <section className="report-section mt-6" aria-labelledby="spending-summary-heading">
                <h3 id="spending-summary-heading" className="text-lg font-semibold">Spending summary</h3>
                <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <SummaryCard label="Total spending" value={formatMoney(report.spendingSummary.totalSpending, currency)} />
                  <SummaryCard label="Group expenses" value={formatMoney(report.spendingSummary.groupSpending, currency)} />
                  <SummaryCard label="Personal expenses" value={formatMoney(report.spendingSummary.personalSpending, currency)} />
                  <SummaryCard label="Expense records" value={String(report.spendingSummary.activeExpenseCount)} detail={`${report.spendingSummary.correctedExpenseCount} corrected · ${report.spendingSummary.reversedExpenseCount} reversed`} />
                </div>
              </section>
            )}

            {showCategories && (
              <section className="report-section mt-7" aria-labelledby="category-report-heading">
                <h3 id="category-report-heading" className="text-lg font-semibold">Group vs personal by category</h3>
                {report.categories.length === 0 ? <EmptyRows /> : (
                  <ReportTable headers={['Category', 'Total', 'Group', 'Personal', 'Share', 'Expenses']}>
                    {report.categories.map((category) => (
                      <tr key={category.category}>
                        <th scope="row">{category.category}</th>
                        <td>{formatMoney(category.amount, currency)}</td>
                        <td>{formatMoney(category.groupAmount, currency)}</td>
                        <td>{formatMoney(category.personalAmount, currency)}</td>
                        <td>{category.percentage}%</td>
                        <td>{category.expenseCount}</td>
                      </tr>
                    ))}
                  </ReportTable>
                )}
              </section>
            )}

            {showMembers && (
              <section className="report-section mt-7" aria-labelledby="member-report-heading">
                <h3 id="member-report-heading" className="text-lg font-semibold">Member-wise financial position</h3>
                <p className="mt-1 text-sm text-slate-600">Payer contributions and financial responsibility are separate. Settlement balances are shown independently.</p>
                {report.members.length === 0 ? <EmptyRows /> : (
                  <ReportTable headers={['Member', 'Paid toward expenses', 'Responsibility', 'Expense net', 'Settlement payable', 'Settlement receivable', 'Budget']}>
                    {report.members.map((member) => (
                      <tr key={member.userId}>
                        <th scope="row">{member.fullName}</th>
                        <td>{formatMoney(member.payerContribution, currency)}</td>
                        <td>{formatMoney(member.financialResponsibility, currency)}</td>
                        <td>{formatMoney(member.netBalance, currency)}</td>
                        <td>{formatMoney(member.settlementOutstandingPayable, currency)}</td>
                        <td>{formatMoney(member.settlementOutstandingReceivable, currency)}</td>
                        <td>{member.plannedBudget ? `${formatMoney(member.plannedBudget, currency)} · ${member.utilizationPct ?? '0.00'}%` : 'Not set'}</td>
                      </tr>
                    ))}
                  </ReportTable>
                )}
              </section>
            )}

            {showBudgets && (
              <section className="report-section mt-7" aria-labelledby="budget-report-heading">
                <h3 id="budget-report-heading" className="text-lg font-semibold">Budget utilization</h3>
                <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <SummaryCard label="Planned" value={formatMoney(report.budgets.totalPlannedBudget, currency)} />
                  <SummaryCard label="Actual responsibility" value={formatMoney(report.budgets.totalActualSpending, currency)} />
                  <SummaryCard label="Remaining" value={formatMoney(report.budgets.totalRemainingBudget, currency)} />
                  <SummaryCard label="Utilization" value={`${report.budgets.overallUtilizationPct}%`} />
                </div>
                {report.budgets.members.length === 0 ? <EmptyRows /> : (
                  <ReportTable headers={['Member', 'Planned', 'Trip-to-date responsibility', 'Period responsibility', 'Remaining', 'Overspending', 'Utilization']}>
                    {report.budgets.members.map((budget) => (
                      <tr key={budget.userId}>
                        <th scope="row">{budget.fullName}</th>
                        <td>{formatMoney(budget.plannedBudget, currency)}</td>
                        <td>{formatMoney(budget.recordedResponsibility, currency)}</td>
                        <td>{formatMoney(budget.periodResponsibility, currency)}</td>
                        <td>{formatMoney(budget.remainingBudget, currency)}</td>
                        <td>{formatMoney(budget.overspending, currency)}</td>
                        <td>{budget.utilizationPct}% · {budget.warningLevel}</td>
                      </tr>
                    ))}
                  </ReportTable>
                )}
              </section>
            )}

            {showExpenses && (
              <section className="report-section mt-7" aria-labelledby="expense-history-heading">
                <h3 id="expense-history-heading" className="text-lg font-semibold">Expense history</h3>
                <p className="mt-1 text-sm text-slate-600">Corrected and reversed expense records remain visible and are not included as active spending.</p>
                {!hasExpenses ? <EmptyRows /> : (
                  <ReportTable headers={['Date', 'Description', 'Category / type', 'Status', 'Method', 'Payer contributions', 'Financial responsibility', 'Amount']}>
                    {report.expenses.map((expense) => (
                      <tr key={expense.id}>
                        <td>{formatDate(expense.date)}</td>
                        <th scope="row">
                          <span>{expense.title}</span>
                          {expense.correctedFrom && <small className="block text-slate-500">Corrects: {expense.correctedFrom.title}</small>}
                          {expense.description && <small className="block text-slate-500">{expense.description}</small>}
                        </th>
                        <td>{expense.category} · {expense.expenseType}</td>
                        <td>{expense.status}</td>
                        <td>{expense.paymentMethod}</td>
                        <td>{expense.payers.map((payer) => `${payer.fullName}: ${formatMoney(payer.amount, expense.originalCurrency)} (${payer.paymentStatus})`).join('; ') || '—'}</td>
                        <td>{expense.allocations.map((allocation) => `${allocation.fullName}: ${formatMoney(allocation.allocatedAmount, allocation.currency)}`).join('; ') || '—'}</td>
                        <td>{formatMoney(expense.convertedAmount, currency)}</td>
                      </tr>
                    ))}
                  </ReportTable>
                )}
                {report.auditHistory.some((entry) => entry.action.startsWith('EXPENSE_')) && (
                  <details className="mt-4 rounded-xl border border-orange-100 p-4">
                    <summary className="cursor-pointer font-medium">
                      Expense correction and reversal audit history ({report.auditHistory.filter((entry) => entry.action.startsWith('EXPENSE_')).length})
                    </summary>
                    <ul className="mt-3 space-y-2 text-sm">
                      {report.auditHistory.filter((entry) => entry.action.startsWith('EXPENSE_')).map((entry) => (
                        <li key={entry.id}>
                          <strong>{entry.action}</strong> · {entry.actorName} · {formatDate(entry.createdAt)}
                          {Boolean(entry.details) && <span> · {JSON.stringify(entry.details)}</span>}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </section>
            )}

            {showSettlements && (
              <section className="report-section mt-7" aria-labelledby="settlement-report-heading">
                <h3 id="settlement-report-heading" className="text-lg font-semibold">Settlement and refund history</h3>
                <p className="mt-1 text-sm text-slate-600">Payments are recorded manually by members and are not bank-verified. Only creditor-confirmed payments affect settlement balances.</p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <SummaryCard label="Current plan" value={`Revision ${report.settlements.planRevision}`} detail={`${report.settlements.settlementCount} transfers`} />
                  <SummaryCard label="Confirmed net paid" value={formatMoney(report.settlements.totalPaid, currency)} />
                  <SummaryCard label="Outstanding" value={formatMoney(report.settlements.totalOutstanding, currency)} />
                  <SummaryCard label="Final status" value={report.settlements.isFullySettled ? 'Fully settled' : 'Outstanding'} detail={`${formatMoney(report.settlements.totalRefunded, currency)} refunded`} />
                </div>
                {report.settlements.history.length === 0 ? <EmptyRows /> : (
                  <div className="mt-4 space-y-4">
                    {report.settlements.history.map((settlement) => (
                      <div className="report-settlement rounded-xl border border-orange-100 p-4" key={settlement.id}>
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <h4 className="font-semibold">{settlement.debtorName} pays {settlement.creditorName}</h4>
                            <p className="text-sm text-slate-600">
                              Plan revision {settlement.planRevision} · {settlement.status} · created {formatDate(settlement.createdAt)}
                              {settlement.createdByUserId ? ` · recorded by ${settlement.createdByUserId}` : ''}
                            </p>
                          </div>
                          <p className="font-semibold tabular-nums">{formatMoney(settlement.totalAmount, currency)} planned · {formatMoney(settlement.remainingAmount, currency)} outstanding</p>
                        </div>
                        {settlement.payments.length === 0 ? <p className="mt-3 text-sm text-slate-600">No payment attempts recorded.</p> : (
                          <div className="mt-3 space-y-3">
                            {settlement.payments.map((payment) => (
                              <div className="rounded-lg bg-orange-50/60 p-3" key={payment.id}>
                                <p className="font-medium">{formatMoney(payment.amount, currency)} · {payment.paymentMethod ?? 'Method unspecified'} · {payment.status}</p>
                                <p className="mt-1 text-sm text-slate-600">
                                  Entered {formatDate(payment.paymentDateTime)} · Submitted {formatDate(payment.debtorSubmittedAt)} · Confirmed {formatDate(payment.creditorConfirmedAt)}
                                </p>
                                {payment.transactionReference && <p className="text-sm text-slate-600">Reference: {payment.transactionReference}</p>}
                                {payment.paymentNotes && <p className="text-sm text-slate-600">Notes: {payment.paymentNotes}</p>}
                                {payment.disputeReason && <p className="text-sm text-amber-900">Dispute: {payment.disputeReason} · {formatDate(payment.disputedAt)}</p>}
                                {payment.refunds.map((refund) => (
                                  <p className="text-sm text-slate-700" key={refund.id}>Refund {formatMoney(refund.amount, refund.currency)} · {refund.reason} · {formatDate(refund.createdAt)}</p>
                                ))}
                                {payment.events.length > 0 && (
                                  <details className="mt-2 text-sm">
                                    <summary className="cursor-pointer font-medium">Payment audit events ({payment.events.length})</summary>
                                    <ul className="mt-2 space-y-1">
                                      {payment.events.map((event, index) => (
                                        <li key={`${event.action}-${event.createdAt}-${index}`}>{event.action} · {formatDate(event.createdAt)} · {event.reason ?? 'No reason recorded'}</li>
                                      ))}
                                    </ul>
                                  </details>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}

            <footer className="report-footer mt-8 border-t border-orange-100 pt-4 text-xs text-slate-600">
              <p>{report.meta.tripName} · {report.meta.tripStatus} · Base currency {currency}</p>
              <p>Generated {formatDate(report.meta.generatedAt)} · Manual payment records are not independently verified.</p>
              <p className="mt-2">Trip and settlement audit history: {report.auditHistory.filter((entry) => entry.action === 'TRIP_REOPENED' || entry.action === 'TRIP_CLOSED' || entry.action === 'SETTLEMENT_PLAN_GENERATED').length} lifecycle events recorded.</p>
            </footer>
          </article>
        ) : null}
      </div>
    </main>
  );
}

function SummaryCard({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-xl border border-orange-100 bg-orange-50/40 p-4">
      <p className="text-sm text-slate-600">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
      {detail && <p className="mt-1 text-xs text-slate-600">{detail}</p>}
    </div>
  );
}

function EmptyRows() {
  return <p className="mt-3 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">No records match the selected filters.</p>;
}

function ReportTable({ headers, children }: { headers: string[]; children: ReactNode }) {
  return (
    <div className="mt-3 max-w-full overflow-x-auto rounded-xl border border-orange-100">
      <table className="w-full min-w-[760px] border-collapse text-left text-sm">
        <thead className="bg-orange-50 text-xs uppercase tracking-wide text-slate-700">
          <tr>{headers.map((header) => <th className="px-3 py-3 font-semibold" key={header} scope="col">{header}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-orange-100 [&_td]:px-3 [&_td]:py-3 [&_th[scope=row]]:px-3 [&_th[scope=row]]:py-3 [&_th[scope=row]]:font-medium">
          {children}
        </tbody>
      </table>
    </div>
  );
}
