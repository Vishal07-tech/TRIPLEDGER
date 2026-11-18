import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Calendar,
  CheckCircle2,
  DollarSign,
  Filter,
  Layers,
  LogOut,
  PieChart,
  RefreshCw,
  Table as TableIcon,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import NotificationCenter from '../components/NotificationCenter';
import { apiRequest } from '../lib/apiClient';
import { clearSessionToken, getSessionToken } from '../lib/session';
import { useTripEvents } from '../lib/useTripEvents';

type Trip = {
  id: string;
  name: string;
  baseCurrency: string;
  status: string;
  members: Array<{ userId: string; role: string; isActive: boolean }>;
};

type CategoryItem = {
  category: string;
  amount: string;
  groupAmount: string;
  personalAmount: string;
  expenseCount: number;
  percentage: string;
};

type MemberItem = {
  userId: string;
  fullName: string;
  email: string;
  role: string;
  isActive: boolean;
  payerContribution: string;
  financialResponsibility: string;
  netBalance: string;
  groupResponsibility: string;
  personalExpenses: string;
  budget: {
    plannedBudget: string;
    remainingBudget: string;
    utilizationPct: string;
    overspending: string;
    warningLevel: string;
  } | null;
};

type BudgetMemberItem = {
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
};

type BudgetUtilization = {
  totalPlannedBudget: string;
  totalActualSpending: string;
  totalRemainingBudget: string;
  totalOverspending: string;
  overallUtilizationPct: string;
  members: BudgetMemberItem[];
};

type SettlementOverview = {
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
};

type DailyTrend = {
  date: string;
  amount: string;
  groupAmount: string;
  personalAmount: string;
  count: number;
};

type MonthlyTrend = {
  month: string;
  amount: string;
  groupAmount: string;
  personalAmount: string;
  count: number;
};

type AnalyticsReport = {
  tripId: string;
  tripName: string;
  baseCurrency: string;
  dateRange: {
    startDate: string | null;
    endDate: string | null;
  };
  spendingSummary: {
    totalSpending: string;
    groupSpending: string;
    personalSpending: string;
    totalPayerAdvances: string;
    totalResponsibility: string;
    activeExpenseCount: number;
    currency: string;
  };
  expenseTypes: {
    group: { amount: string; count: number; percentage: string };
    personal: { amount: string; count: number; percentage: string };
    total: { amount: string; count: number };
  };
  categoryBreakdown: CategoryItem[];
  memberBreakdown: MemberItem[];
  budgetUtilization: BudgetUtilization;
  settlementOverview: SettlementOverview;
  trends: {
    daily: DailyTrend[];
    monthly: MonthlyTrend[];
  };
};

function formatAmount(value: string, currency: string) {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return `${currency} ${value}`;

  const digits =
    new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
    }).resolvedOptions().maximumFractionDigits ?? 2;
  const isNegative = match[1] === '-';
  const whole = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(
    BigInt(match[2]),
  );
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

const CATEGORY_COLORS = [
  '#EA580C', // orange-600 (primary)
  '#0891B2', // cyan-600
  '#D97706', // amber-600
  '#7C3AED', // violet-600
  '#059669', // emerald-600
  '#DB2777', // pink-600
  '#2563EB', // blue-600
  '#4B5563', // gray-600
];

export default function AnalyticsDashboard() {
  const navigate = useNavigate();
  const location = useLocation();
  const [token] = useState(getSessionToken);

  const [trips, setTrips] = useState<Trip[]>([]);
  const [selectedTripId, setSelectedTripId] = useState('');
  const selectedTripIdRef = useRef('');
  const refreshSequenceRef = useRef(0);

  const [notificationRefreshKey, setNotificationRefreshKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  // Date filters
  const [preset, setPreset] = useState<'all' | '7d' | '30d' | 'thisMonth' | 'custom'>('all');
  const [startDateInput, setStartDateInput] = useState('');
  const [endDateInput, setEndDateInput] = useState('');
  const [appliedStartDate, setAppliedStartDate] = useState('');
  const [appliedEndDate, setAppliedEndDate] = useState('');

  // View toggle: 'visual' or 'table'
  const [viewMode, setViewMode] = useState<'visual' | 'table'>('visual');

  // Report data
  const [report, setReport] = useState<AnalyticsReport | null>(null);

  const queryTripId = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get('tripId') ?? '';
  }, [location.search]);

  const selectedTrip = useMemo(
    () => trips.find((t) => t.id === selectedTripId),
    [trips, selectedTripId],
  );

  const fetchAnalytics = useCallback(
    async (tripId: string, sDate?: string, eDate?: string) => {
      if (!token || !tripId) return;
      const sequence = (refreshSequenceRef.current += 1);
      setRefreshing(true);
      setError('');

      try {
        const queryParams = new URLSearchParams();
        if (sDate) queryParams.set('startDate', sDate);
        if (eDate) queryParams.set('endDate', eDate);
        const queryString = queryParams.toString() ? `?${queryParams.toString()}` : '';

        const data = await apiRequest<AnalyticsReport>(
          `/api/trips/${tripId}/analytics${queryString}`,
          undefined,
          token,
        );

        if (selectedTripIdRef.current !== tripId || sequence !== refreshSequenceRef.current) {
          return;
        }
        setReport(data);
      } catch (err) {
        if (selectedTripIdRef.current === tripId && sequence === refreshSequenceRef.current) {
          setError(err instanceof Error ? err.message : 'Could not load analytics report.');
        }
      } finally {
        if (selectedTripIdRef.current === tripId && sequence === refreshSequenceRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [token],
  );

  // SSE real-time integration
  const handleTripEvent = useCallback(() => {
    const tripId = selectedTripIdRef.current;
    if (!tripId) return;
    setNotificationRefreshKey((c) => c + 1);
    void fetchAnalytics(tripId, appliedStartDate, appliedEndDate);
  }, [fetchAnalytics, appliedStartDate, appliedEndDate]);

  useTripEvents(selectedTripId, handleTripEvent);

  // Initial load
  useEffect(() => {
    if (!token) {
      navigate('/');
      return;
    }

    let active = true;
    async function loadTrips() {
      try {
        const payload = await apiRequest<{ trips: Trip[] }>('/api/trips', undefined, token);
        if (!active) return;
        setTrips(payload.trips);

        const initialTripId =
          (queryTripId && payload.trips.some((t) => t.id === queryTripId) ? queryTripId : '') ||
          payload.trips[0]?.id ||
          '';

        setSelectedTripId(initialTripId);
        selectedTripIdRef.current = initialTripId;

        if (initialTripId) {
          void fetchAnalytics(initialTripId, appliedStartDate, appliedEndDate);
        } else {
          setLoading(false);
        }
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : 'Could not load trips.');
          setLoading(false);
        }
      }
    }

    void loadTrips();
    return () => {
      active = false;
    };
  }, [navigate, token, queryTripId, fetchAnalytics, appliedStartDate, appliedEndDate]);

  function handleTripChange(nextTripId: string) {
    selectedTripIdRef.current = nextTripId;
    setSelectedTripId(nextTripId);
    setReport(null);
    setLoading(true);
    void fetchAnalytics(nextTripId, appliedStartDate, appliedEndDate);
  }

  function handlePresetChange(nextPreset: 'all' | '7d' | '30d' | 'thisMonth' | 'custom') {
    setPreset(nextPreset);
    const now = new Date();

    if (nextPreset === 'all') {
      setStartDateInput('');
      setEndDateInput('');
      setAppliedStartDate('');
      setAppliedEndDate('');
      void fetchAnalytics(selectedTripId, '', '');
      return;
    }

    if (nextPreset === '7d') {
      const start = new Date(now.getTime() - 7 * 86_400_000);
      const sStr = start.toISOString().slice(0, 10);
      const eStr = now.toISOString().slice(0, 10);
      setStartDateInput(sStr);
      setEndDateInput(eStr);
      setAppliedStartDate(sStr);
      setAppliedEndDate(eStr);
      void fetchAnalytics(selectedTripId, sStr, eStr);
      return;
    }

    if (nextPreset === '30d') {
      const start = new Date(now.getTime() - 30 * 86_400_000);
      const sStr = start.toISOString().slice(0, 10);
      const eStr = now.toISOString().slice(0, 10);
      setStartDateInput(sStr);
      setEndDateInput(eStr);
      setAppliedStartDate(sStr);
      setAppliedEndDate(eStr);
      void fetchAnalytics(selectedTripId, sStr, eStr);
      return;
    }

    if (nextPreset === 'thisMonth') {
      const start = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
      const sStr = start.toISOString().slice(0, 10);
      const eStr = now.toISOString().slice(0, 10);
      setStartDateInput(sStr);
      setEndDateInput(eStr);
      setAppliedStartDate(sStr);
      setAppliedEndDate(eStr);
      void fetchAnalytics(selectedTripId, sStr, eStr);
      return;
    }
  }

  function handleApplyCustomDates(e: React.FormEvent) {
    e.preventDefault();
    if (startDateInput && endDateInput && startDateInput > endDateInput) {
      setError('Start date cannot be after end date.');
      return;
    }
    setError('');
    setAppliedStartDate(startDateInput);
    setAppliedEndDate(endDateInput);
    void fetchAnalytics(selectedTripId, startDateInput, endDateInput);
  }

  function handleResetFilters() {
    setPreset('all');
    setStartDateInput('');
    setEndDateInput('');
    setAppliedStartDate('');
    setAppliedEndDate('');
    setError('');
    void fetchAnalytics(selectedTripId, '', '');
  }

  function signOut() {
    clearSessionToken();
    navigate('/');
  }

  // Accessible chart unique IDs
  const categoryChartId = useId();
  const trendChartId = useId();
  const memberChartId = useId();

  const currency = report?.baseCurrency ?? selectedTrip?.baseCurrency ?? 'INR';

  return (
    <main className="min-h-screen px-4 py-8 text-slate-900 md:px-8">
      <div className="mx-auto max-w-7xl">
        {/* Navigation & Header */}
        <header className="mb-8 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-orange-100 bg-white p-5 shadow-soft">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
              TripLedger
            </p>
            <h1 className="mt-2 text-3xl font-bold">Trip Analytics</h1>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Link
              className="btn-secondary min-h-11"
              to={`/dashboard?tripId=${selectedTripId}`}
            >
              Expenses
            </Link>
            <Link
              className="btn-secondary min-h-11"
              to={`/settlements?tripId=${selectedTripId}`}
            >
              Settlement
            </Link>
            <Link
              className="btn-secondary min-h-11"
              to={`/reports?tripId=${selectedTripId}`}
            >
              Reports
            </Link>
            {selectedTripId && (
              <NotificationCenter
                tripId={selectedTripId}
                refreshKey={notificationRefreshKey}
              />
            )}
            <label className="sr-only" htmlFor="trip-select">
              Choose trip
            </label>
            <select
              id="trip-select"
              className="input-field min-w-48"
              value={selectedTripId}
              onChange={(e) => handleTripChange(e.target.value)}
              disabled={loading && trips.length === 0}
            >
              {trips.length === 0 && <option value="">No trips available</option>}
              {trips.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn-secondary"
              onClick={signOut}
              aria-label="Sign out"
            >
              <LogOut aria-hidden="true" size={18} />
            </button>
          </div>
        </header>

        {/* Error notification */}
        {error && (
          <div
            role="alert"
            className="mb-5 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
          >
            <AlertCircle size={18} className="shrink-0 text-red-600" />
            <span>{error}</span>
          </div>
        )}

        {/* Date Filter & Toolbar Bar */}
        <section
          aria-label="Filter and display options"
          className="mb-8 rounded-2xl border border-orange-100 bg-white p-5 shadow-soft"
        >
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
                <Filter size={14} /> Presets:
              </span>
              <button
                type="button"
                onClick={() => handlePresetChange('all')}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  preset === 'all'
                    ? 'bg-primary text-black'
                    : 'bg-orange-50 text-slate-700 hover:bg-orange-100'
                }`}
              >
                All Time
              </button>
              <button
                type="button"
                onClick={() => handlePresetChange('7d')}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  preset === '7d'
                    ? 'bg-primary text-black'
                    : 'bg-orange-50 text-slate-700 hover:bg-orange-100'
                }`}
              >
                Last 7 Days
              </button>
              <button
                type="button"
                onClick={() => handlePresetChange('30d')}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  preset === '30d'
                    ? 'bg-primary text-black'
                    : 'bg-orange-50 text-slate-700 hover:bg-orange-100'
                }`}
              >
                Last 30 Days
              </button>
              <button
                type="button"
                onClick={() => handlePresetChange('thisMonth')}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  preset === 'thisMonth'
                    ? 'bg-primary text-black'
                    : 'bg-orange-50 text-slate-700 hover:bg-orange-100'
                }`}
              >
                This Month
              </button>
              <button
                type="button"
                onClick={() => setPreset('custom')}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  preset === 'custom'
                    ? 'bg-primary text-black'
                    : 'bg-orange-50 text-slate-700 hover:bg-orange-100'
                }`}
              >
                Custom Range
              </button>
            </div>

            <div className="flex items-center gap-2">
              {/* Toggle view mode */}
              <div
                className="flex items-center rounded-xl border border-orange-200 bg-orange-50/50 p-1"
                role="group"
                aria-label="View representation mode"
              >
                <button
                  type="button"
                  onClick={() => setViewMode('visual')}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1 text-xs font-semibold transition ${
                    viewMode === 'visual'
                      ? 'bg-white text-primary shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                  aria-pressed={viewMode === 'visual'}
                >
                  <BarChart3 size={14} /> Charts
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('table')}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1 text-xs font-semibold transition ${
                    viewMode === 'table'
                      ? 'bg-white text-primary shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                  aria-pressed={viewMode === 'table'}
                >
                  <TableIcon size={14} /> Tables
                </button>
              </div>

              <button
                type="button"
                className="btn-secondary !px-3 !py-2"
                onClick={() =>
                  void fetchAnalytics(selectedTripId, appliedStartDate, appliedEndDate)
                }
                disabled={refreshing || !selectedTripId}
                aria-label="Refresh analytics"
                title="Refresh analytics data"
              >
                <RefreshCw
                  aria-hidden="true"
                  size={16}
                  className={refreshing ? 'animate-spin text-primary' : ''}
                />
              </button>
            </div>
          </div>

          {/* Custom Date Form */}
          {preset === 'custom' && (
            <form
              onSubmit={handleApplyCustomDates}
              className="mt-4 flex flex-wrap items-end gap-3 border-t border-orange-100 pt-4"
            >
              <div>
                <label
                  htmlFor="filter-start-date"
                  className="block text-xs font-medium text-slate-700"
                >
                  From
                </label>
                <input
                  id="filter-start-date"
                  type="date"
                  className="input-field !py-1.5 !text-xs"
                  value={startDateInput}
                  onChange={(e) => setStartDateInput(e.target.value)}
                />
              </div>
              <div>
                <label
                  htmlFor="filter-end-date"
                  className="block text-xs font-medium text-slate-700"
                >
                  To
                </label>
                <input
                  id="filter-end-date"
                  type="date"
                  className="input-field !py-1.5 !text-xs"
                  value={endDateInput}
                  onChange={(e) => setEndDateInput(e.target.value)}
                />
              </div>
              <button
                type="submit"
                className="btn-primary !px-4 !py-2 !text-xs"
                disabled={refreshing}
              >
                Apply Range
              </button>
              {(appliedStartDate || appliedEndDate) && (
                <button
                  type="button"
                  onClick={handleResetFilters}
                  className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
                >
                  Clear Filters
                </button>
              )}
            </form>
          )}

          {/* Active filter badge */}
          {(appliedStartDate || appliedEndDate) && (
            <div className="mt-3 flex items-center gap-2 text-xs text-slate-600">
              <Calendar size={13} className="text-primary" />
              <span>
                Filtered range:{' '}
                <strong>
                  {appliedStartDate || 'Beginning'} — {appliedEndDate || 'Present'}
                </strong>
              </span>
              <button
                type="button"
                onClick={handleResetFilters}
                className="text-xs font-semibold text-primary underline"
              >
                Reset to all time
              </button>
            </div>
          )}
        </section>

        {/* Main Content Areas */}
        {loading ? (
          <div
            role="status"
            aria-live="polite"
            className="card-surface flex min-h-[360px] items-center justify-center p-8 text-center text-slate-600"
          >
            <div className="space-y-3">
              <RefreshCw
                size={32}
                className="mx-auto animate-spin text-primary"
                aria-hidden="true"
              />
              <p className="text-sm font-medium">Crunching trip analytics…</p>
            </div>
          </div>
        ) : !selectedTrip ? (
          <div className="card-surface p-8 text-center">
            <h2 className="text-xl font-semibold">No trip selected</h2>
            <p className="mt-2 text-sm text-slate-600">
              Create or join a trip to inspect financial analytics and reports.
            </p>
          </div>
        ) : !report || report.spendingSummary.activeExpenseCount === 0 ? (
          <div className="card-surface p-12 text-center">
            <PieChart size={48} className="mx-auto text-orange-300" aria-hidden="true" />
            <h2 className="mt-4 text-2xl font-bold">No expenses found for this period</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-slate-600">
              {appliedStartDate || appliedEndDate
                ? 'No active expenses match your selected date range. Try widening the range or resetting filters.'
                : 'There are no active expenses recorded for this trip yet. Once expenses are added, real-time analytics will automatically appear here.'}
            </p>
            <div className="mt-6 flex justify-center gap-3">
              {(appliedStartDate || appliedEndDate) && (
                <button
                  type="button"
                  onClick={handleResetFilters}
                  className="btn-secondary"
                >
                  Show all time
                </button>
              )}
              <Link
                to={`/dashboard?tripId=${selectedTripId}`}
                className="btn-primary"
              >
                Record an expense
              </Link>
            </div>
          </div>
        ) : (
          <div className="space-y-8">
            {/* 1. Overall Trip Spending Summary Cards */}
            <section
              aria-label="Overall spending summary"
              className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
            >
              <div className="card-surface p-5">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Total Spending
                  </p>
                  <span className="rounded-full bg-orange-100 p-2 text-primary">
                    <DollarSign size={18} />
                  </span>
                </div>
                <p className="mt-3 text-2xl font-bold text-slate-900">
                  {formatAmount(report.spendingSummary.totalSpending, currency)}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Across {report.spendingSummary.activeExpenseCount} active expense
                  {report.spendingSummary.activeExpenseCount === 1 ? '' : 's'}
                </p>
              </div>

              <div className="card-surface p-5">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Group Expenses
                  </p>
                  <span className="rounded-full bg-cyan-100 p-2 text-secondary">
                    <Users size={18} />
                  </span>
                </div>
                <p className="mt-3 text-2xl font-bold text-slate-900">
                  {formatAmount(report.spendingSummary.groupSpending, currency)}
                </p>
                <div className="mt-1 flex items-center justify-between text-xs text-slate-500">
                  <span>{report.expenseTypes.group.count} shared bills</span>
                  <span className="font-semibold text-secondary">
                    {report.expenseTypes.group.percentage}%
                  </span>
                </div>
              </div>

              <div className="card-surface p-5">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Personal Expenses
                  </p>
                  <span className="rounded-full bg-amber-100 p-2 text-amber-700">
                    <Wallet size={18} />
                  </span>
                </div>
                <p className="mt-3 text-2xl font-bold text-slate-900">
                  {formatAmount(report.spendingSummary.personalSpending, currency)}
                </p>
                <div className="mt-1 flex items-center justify-between text-xs text-slate-500">
                  <span>{report.expenseTypes.personal.count} solo charges</span>
                  <span className="font-semibold text-amber-700">
                    {report.expenseTypes.personal.percentage}%
                  </span>
                </div>
              </div>

              <div className="card-surface p-5">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Ledger Balance
                  </p>
                  <span className="rounded-full bg-emerald-100 p-2 text-emerald-700">
                    <CheckCircle2 size={18} />
                  </span>
                </div>
                <p className="mt-3 text-2xl font-bold text-slate-900">
                  {formatAmount(report.spendingSummary.totalPayerAdvances, currency)}
                </p>
                <p className="mt-1 text-xs text-emerald-700">
                  Advances = Responsibilities (Balanced)
                </p>
              </div>
            </section>

            {/* 2. Category-wise Breakdown Section */}
            <section
              aria-labelledby="category-breakdown-heading"
              className="card-surface p-6"
            >
              <div className="mb-6 flex flex-wrap items-center justify-between gap-2 border-b border-orange-100 pb-4">
                <div>
                  <h2 id="category-breakdown-heading" className="text-xl font-bold">
                    Spending by Category
                  </h2>
                  <p className="text-xs text-slate-500">
                    Breakdown of trip expenses across spending categories
                  </p>
                </div>
                <span className="text-xs font-semibold text-slate-600">
                  {report.categoryBreakdown.length} categories active
                </span>
              </div>

              {/* Visual Bars vs Accessible Table */}
              <div className="grid items-start gap-8 lg:grid-cols-2">
                {/* Visual Proportion Bars */}
                <div
                  role="region"
                  aria-label="Category proportion chart"
                  className="space-y-4"
                >
                  <div
                    id={categoryChartId}
                    className="flex h-5 w-full overflow-hidden rounded-xl bg-orange-100"
                    role="img"
                    aria-label="Category distribution bar chart"
                  >
                    {report.categoryBreakdown.map((item, idx) => {
                      const color = CATEGORY_COLORS[idx % CATEGORY_COLORS.length];
                      const pct = Number(item.percentage);
                      if (pct <= 0) return null;
                      return (
                        <div
                          key={item.category}
                          style={{
                            width: `${pct}%`,
                            backgroundColor: color,
                          }}
                          className="transition-all hover:opacity-85"
                          title={`${item.category}: ${formatAmount(item.amount, currency)} (${item.percentage}%)`}
                          aria-hidden="true"
                        />
                      );
                    })}
                  </div>

                  {/* Category Legend & Cards */}
                  <div className="grid gap-3 sm:grid-cols-2">
                    {report.categoryBreakdown.map((item, idx) => {
                      const color = CATEGORY_COLORS[idx % CATEGORY_COLORS.length];
                      return (
                        <div
                          key={item.category}
                          className="flex items-start justify-between rounded-xl border border-orange-100 bg-orange-50/40 p-3"
                        >
                          <div className="flex items-start gap-2.5">
                            <span
                              className="mt-1 h-3 w-3 shrink-0 rounded-full"
                              style={{ backgroundColor: color }}
                              aria-hidden="true"
                            />
                            <div>
                              <p className="text-sm font-semibold text-slate-900">
                                {item.category}
                              </p>
                              <p className="text-xs text-slate-500">
                                {item.expenseCount} item{item.expenseCount === 1 ? '' : 's'} ·{' '}
                                {item.percentage}%
                              </p>
                            </div>
                          </div>
                          <p className="text-sm font-bold text-slate-900">
                            {formatAmount(item.amount, currency)}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Accessible Tabular Equivalent */}
                <div className="overflow-x-auto rounded-xl border border-orange-100">
                  <table
                    className="w-full text-left text-xs"
                    aria-label="Category spending breakdown table"
                  >
                    <thead className="bg-orange-50/80 font-semibold text-slate-700">
                      <tr>
                        <th className="px-4 py-3">Category</th>
                        <th className="px-4 py-3">Total Amount</th>
                        <th className="px-4 py-3">Group</th>
                        <th className="px-4 py-3">Personal</th>
                        <th className="px-4 py-3">% of Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-orange-100 bg-white">
                      {report.categoryBreakdown.map((cat, idx) => (
                        <tr key={cat.category} className="hover:bg-orange-50/30">
                          <td className="flex items-center gap-2 px-4 py-3 font-semibold text-slate-900">
                            <span
                              className="h-2.5 w-2.5 rounded-full"
                              style={{
                                backgroundColor:
                                  CATEGORY_COLORS[idx % CATEGORY_COLORS.length],
                              }}
                              aria-hidden="true"
                            />
                            {cat.category}
                          </td>
                          <td className="px-4 py-3 font-bold text-slate-900">
                            {formatAmount(cat.amount, currency)}
                          </td>
                          <td className="px-4 py-3 text-slate-600">
                            {formatAmount(cat.groupAmount, currency)}
                          </td>
                          <td className="px-4 py-3 text-slate-600">
                            {formatAmount(cat.personalAmount, currency)}
                          </td>
                          <td className="px-4 py-3 font-medium text-slate-700">
                            {cat.percentage}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>

            {/* 3. Member-wise Spending & Responsibility Comparison */}
            <section
              aria-labelledby="member-comparison-heading"
              className="card-surface p-6"
            >
              <div className="mb-6 flex flex-wrap items-center justify-between gap-2 border-b border-orange-100 pb-4">
                <div>
                  <h2 id="member-comparison-heading" className="text-xl font-bold">
                    Member Spending & Responsibility
                  </h2>
                  <p className="text-xs text-slate-500">
                    Mandatory separation of payer advances from financial responsibility
                  </p>
                </div>
                <div className="flex items-center gap-4 text-xs">
                  <div className="flex items-center gap-1.5">
                    <span className="h-3 w-3 rounded-sm bg-primary" aria-hidden="true" />
                    <span>Payer Advances</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="h-3 w-3 rounded-sm bg-secondary" aria-hidden="true" />
                    <span>Financial Responsibility</span>
                  </div>
                </div>
              </div>

              {/* Comparative Dual Bars / Table */}
              <div className="space-y-6">
                <div
                  id={memberChartId}
                  role="region"
                  aria-label="Member financial comparison"
                  className="space-y-4"
                >
                  {report.memberBreakdown.map((m) => {
                    const paid = Number(m.payerContribution);
                    const resp = Number(m.financialResponsibility);
                    const maxVal = Math.max(
                      ...report.memberBreakdown.map((x) =>
                        Math.max(Number(x.payerContribution), Number(x.financialResponsibility)),
                      ),
                      1,
                    );
                    const paidPct = Math.min(100, Math.round((paid / maxVal) * 100));
                    const respPct = Math.min(100, Math.round((resp / maxVal) * 100));
                    const net = Number(m.netBalance);

                    return (
                      <div
                        key={m.userId}
                        className="rounded-xl border border-orange-100 bg-white p-4 transition hover:shadow-sm"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-slate-900">
                              {m.fullName}
                            </span>
                            <span className="rounded bg-orange-100 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                              {m.role}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-slate-500">Net:</span>
                            <span
                              className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
                                net > 0
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : net < 0
                                    ? 'bg-amber-100 text-amber-800'
                                    : 'bg-slate-100 text-slate-700'
                              }`}
                            >
                              {net > 0 ? '+' : ''}
                              {formatAmount(m.netBalance, currency)}
                              {net > 0 ? ' (receives)' : net < 0 ? ' (owes)' : ' (even)'}
                            </span>
                          </div>
                        </div>

                        {/* Comparative Visual Bars */}
                        <div className="mt-3 space-y-1.5 text-xs">
                          <div>
                            <div className="flex justify-between text-slate-600">
                              <span>Paid (Advances):</span>
                              <span className="font-semibold text-primary">
                                {formatAmount(m.payerContribution, currency)}
                              </span>
                            </div>
                            <div className="h-2 w-full overflow-hidden rounded-full bg-orange-100">
                              <div
                                style={{ width: `${paidPct}%` }}
                                className="h-full rounded-full bg-primary transition-all duration-300"
                                aria-hidden="true"
                              />
                            </div>
                          </div>

                          <div>
                            <div className="flex justify-between text-slate-600">
                              <span>Responsibility (Group + Personal):</span>
                              <span className="font-semibold text-secondary">
                                {formatAmount(m.financialResponsibility, currency)}
                              </span>
                            </div>
                            <div className="h-2 w-full overflow-hidden rounded-full bg-cyan-100">
                              <div
                                style={{ width: `${respPct}%` }}
                                className="h-full rounded-full bg-secondary transition-all duration-300"
                                aria-hidden="true"
                              />
                            </div>
                          </div>
                        </div>

                        {/* Breakdown pills */}
                        <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-slate-500">
                          <span className="rounded-md bg-slate-50 px-2 py-0.5">
                            Group Share: {formatAmount(m.groupResponsibility, currency)}
                          </span>
                          <span className="rounded-md bg-slate-50 px-2 py-0.5">
                            Personal: {formatAmount(m.personalExpenses, currency)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Table representation */}
                <div className="overflow-x-auto rounded-xl border border-orange-100">
                  <table
                    className="w-full text-left text-xs"
                    aria-label="Member spending and responsibility data table"
                  >
                    <thead className="bg-orange-50/80 font-semibold text-slate-700">
                      <tr>
                        <th className="px-4 py-3">Member</th>
                        <th className="px-4 py-3">Role</th>
                        <th className="px-4 py-3">Payer Contribution</th>
                        <th className="px-4 py-3">Total Responsibility</th>
                        <th className="px-4 py-3">Group Share</th>
                        <th className="px-4 py-3">Personal</th>
                        <th className="px-4 py-3">Net Balance</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-orange-100 bg-white">
                      {report.memberBreakdown.map((m) => {
                        const net = Number(m.netBalance);
                        return (
                          <tr key={m.userId} className="hover:bg-orange-50/30">
                            <td className="px-4 py-3 font-semibold text-slate-900">
                              {m.fullName}
                            </td>
                            <td className="px-4 py-3 text-slate-500">{m.role}</td>
                            <td className="px-4 py-3 font-bold text-primary">
                              {formatAmount(m.payerContribution, currency)}
                            </td>
                            <td className="px-4 py-3 font-bold text-secondary">
                              {formatAmount(m.financialResponsibility, currency)}
                            </td>
                            <td className="px-4 py-3 text-slate-600">
                              {formatAmount(m.groupResponsibility, currency)}
                            </td>
                            <td className="px-4 py-3 text-slate-600">
                              {formatAmount(m.personalExpenses, currency)}
                            </td>
                            <td className="px-4 py-3 font-bold">
                              <span
                                className={
                                  net > 0
                                    ? 'text-emerald-700'
                                    : net < 0
                                      ? 'text-amber-700'
                                      : 'text-slate-600'
                                }
                              >
                                {net > 0 ? '+' : ''}
                                {formatAmount(m.netBalance, currency)}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>

            {/* 4. Budget Utilization & Member-wise Budget Comparison */}
            <section
              aria-labelledby="budget-utilization-heading"
              className="card-surface p-6"
            >
              <div className="mb-6 flex flex-wrap items-center justify-between gap-2 border-b border-orange-100 pb-4">
                <div>
                  <h2 id="budget-utilization-heading" className="text-xl font-bold">
                    Budget Utilization
                  </h2>
                  <p className="text-xs text-slate-500">
                    Planned budgets vs recorded member financial responsibilities
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs font-semibold text-slate-500">Overall Utilization</p>
                  <p className="text-lg font-bold text-slate-900">
                    {report.budgetUtilization.overallUtilizationPct}%
                  </p>
                </div>
              </div>

              {/* Trip-wide Summary Bar */}
              <div className="mb-6 rounded-xl border border-orange-100 bg-orange-50/30 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span>
                    Total Planned Budget:{' '}
                    <strong>
                      {formatAmount(report.budgetUtilization.totalPlannedBudget, currency)}
                    </strong>
                  </span>
                  <span>
                    Recorded Spending:{' '}
                    <strong>
                      {formatAmount(report.budgetUtilization.totalActualSpending, currency)}
                    </strong>
                  </span>
                  <span>
                    Remaining:{' '}
                    <strong className="text-emerald-700">
                      {formatAmount(report.budgetUtilization.totalRemainingBudget, currency)}
                    </strong>
                  </span>
                  {Number(report.budgetUtilization.totalOverspending) > 0 && (
                    <span>
                      Overspending:{' '}
                      <strong className="text-red-600">
                        {formatAmount(report.budgetUtilization.totalOverspending, currency)}
                      </strong>
                    </span>
                  )}
                </div>

                <div className="mt-2.5 h-3 w-full overflow-hidden rounded-full bg-orange-200/60">
                  <div
                    style={{
                      width: `${Math.min(100, Number(report.budgetUtilization.overallUtilizationPct))}%`,
                    }}
                    className={`h-full rounded-full transition-all duration-300 ${
                      Number(report.budgetUtilization.overallUtilizationPct) > 100
                        ? 'bg-red-600'
                        : Number(report.budgetUtilization.overallUtilizationPct) >= 90
                          ? 'bg-orange-500'
                          : Number(report.budgetUtilization.overallUtilizationPct) >= 75
                            ? 'bg-amber-500'
                            : 'bg-emerald-600'
                    }`}
                    aria-hidden="true"
                  />
                </div>
              </div>

              {/* Member-by-Member Budget Cards */}
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {report.budgetUtilization.members.map((bm) => {
                  const pct = Number(bm.utilizationPct);
                  const isExceeded = pct > 100 || bm.warningLevel === 'exceeded';
                  const isWarning = pct >= 75 && pct < 100;

                  return (
                    <div
                      key={bm.userId}
                      className={`rounded-xl border p-4 ${
                        isExceeded
                          ? 'border-red-200 bg-red-50/30'
                          : isWarning
                            ? 'border-amber-200 bg-amber-50/20'
                            : 'border-orange-100 bg-white'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-slate-900">{bm.fullName}</span>
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                            isExceeded
                              ? 'bg-red-100 text-red-800'
                              : isWarning
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-emerald-100 text-emerald-800'
                          }`}
                        >
                          {bm.warningLevel}
                        </span>
                      </div>

                      <div className="mt-3 space-y-1 text-xs text-slate-600">
                        <div className="flex justify-between">
                          <span>Planned:</span>
                          <span className="font-semibold text-slate-900">
                            {formatAmount(bm.plannedBudget, currency)}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>Responsibility:</span>
                          <span className="font-semibold text-slate-900">
                            {formatAmount(bm.recordedResponsibility, currency)}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>Remaining:</span>
                          <span
                            className={`font-semibold ${
                              isExceeded ? 'text-red-700' : 'text-emerald-700'
                            }`}
                          >
                            {formatAmount(bm.remainingBudget, currency)}
                          </span>
                        </div>
                      </div>

                      <div className="mt-3">
                        <div className="flex justify-between text-[11px] text-slate-500">
                          <span>Utilization</span>
                          <span className="font-bold">{bm.utilizationPct}%</span>
                        </div>
                        <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                          <div
                            style={{ width: `${Math.min(100, pct)}%` }}
                            className={`h-full rounded-full transition-all duration-300 ${
                              isExceeded
                                ? 'bg-red-600'
                                : isWarning
                                  ? 'bg-amber-500'
                                  : 'bg-emerald-600'
                            }`}
                            aria-hidden="true"
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* 5. Daily and Monthly Spending Trends */}
            <section
              aria-labelledby="spending-trends-heading"
              className="card-surface p-6"
            >
              <div className="mb-6 flex flex-wrap items-center justify-between gap-2 border-b border-orange-100 pb-4">
                <div>
                  <h2 id="spending-trends-heading" className="text-xl font-bold">
                    Spending Trends
                  </h2>
                  <p className="text-xs text-slate-500">
                    Chronological distribution of expenses
                  </p>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <div className="flex items-center gap-1.5">
                    <span className="h-3 w-3 rounded-sm bg-primary" aria-hidden="true" />
                    <span>Group Expense</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="h-3 w-3 rounded-sm bg-amber-500" aria-hidden="true" />
                    <span>Personal Expense</span>
                  </div>
                </div>
              </div>

              {/* Daily Trend Bars */}
              {report.trends.daily.length === 0 ? (
                <p className="text-sm text-slate-500">No trend data available.</p>
              ) : (
                <div className="space-y-6">
                  <div
                    id={trendChartId}
                    role="region"
                    aria-label="Daily spending timeline"
                    className="overflow-x-auto pb-2"
                  >
                    <div className="flex min-w-[500px] items-end gap-3 pt-6">
                      {report.trends.daily.map((item) => {
                        const total = Number(item.amount);
                        const maxDaily = Math.max(
                          ...report.trends.daily.map((d) => Number(d.amount)),
                          1,
                        );
                        const heightPct = Math.max(12, Math.round((total / maxDaily) * 100));
                        const groupPct = total > 0 ? (Number(item.groupAmount) / total) * 100 : 0;
                        const personalPct = total > 0 ? (Number(item.personalAmount) / total) * 100 : 0;

                        return (
                          <div
                            key={item.date}
                            className="flex flex-1 flex-col items-center gap-1 text-center"
                          >
                            <span className="text-[10px] font-bold text-slate-700">
                              {formatAmount(item.amount, currency)}
                            </span>
                            <div
                              style={{ height: `${heightPct * 1.5}px` }}
                              className="flex w-full min-w-[28px] max-w-[48px] flex-col justify-end overflow-hidden rounded-t-lg bg-orange-100 transition-all hover:opacity-80"
                              title={`${item.date}: Total ${formatAmount(item.amount, currency)} (Group: ${formatAmount(item.groupAmount, currency)}, Personal: ${formatAmount(item.personalAmount, currency)})`}
                              role="img"
                              aria-label={`Spending on ${item.date}: ${formatAmount(item.amount, currency)}`}
                            >
                              <div
                                style={{ height: `${personalPct}%` }}
                                className="w-full bg-amber-500"
                                aria-hidden="true"
                              />
                              <div
                                style={{ height: `${groupPct}%` }}
                                className="w-full bg-primary"
                                aria-hidden="true"
                              />
                            </div>
                            <span className="mt-1 text-[11px] font-medium text-slate-500">
                              {item.date.slice(5)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Monthly Rollup Table */}
                  <div className="overflow-x-auto rounded-xl border border-orange-100">
                    <table
                      className="w-full text-left text-xs"
                      aria-label="Monthly spending trend table"
                    >
                      <thead className="bg-orange-50/80 font-semibold text-slate-700">
                        <tr>
                          <th className="px-4 py-2.5">Month</th>
                          <th className="px-4 py-2.5">Total Spending</th>
                          <th className="px-4 py-2.5">Group Spending</th>
                          <th className="px-4 py-2.5">Personal Spending</th>
                          <th className="px-4 py-2.5">Expense Count</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-orange-100 bg-white">
                        {report.trends.monthly.map((m) => (
                          <tr key={m.month} className="hover:bg-orange-50/30">
                            <td className="px-4 py-2.5 font-bold text-slate-900">{m.month}</td>
                            <td className="px-4 py-2.5 font-bold text-slate-900">
                              {formatAmount(m.amount, currency)}
                            </td>
                            <td className="px-4 py-2.5 text-primary">
                              {formatAmount(m.groupAmount, currency)}
                            </td>
                            <td className="px-4 py-2.5 text-amber-700">
                              {formatAmount(m.personalAmount, currency)}
                            </td>
                            <td className="px-4 py-2.5 text-slate-600">{m.count}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </section>

            {/* 6. Settlement Overview */}
            <section
              aria-labelledby="settlement-overview-heading"
              className="card-surface p-6"
            >
              <div className="mb-6 flex flex-wrap items-center justify-between gap-2 border-b border-orange-100 pb-4">
                <div>
                  <h2 id="settlement-overview-heading" className="text-xl font-bold">
                    Settlement Status Overview
                  </h2>
                  <p className="text-xs text-slate-500">
                    Settlement clearing progress (strictly isolated from trip expense spending)
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                    Plan Revision: {report.settlementOverview.planRevision}
                  </span>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-bold uppercase ${
                      report.settlementOverview.isFullySettled
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-cyan-100 text-cyan-800'
                    }`}
                  >
                    {report.settlementOverview.tripStatus}
                  </span>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                <div className="rounded-xl border border-orange-100 bg-orange-50/20 p-4">
                  <p className="text-xs font-medium text-slate-500">Total Planned</p>
                  <p className="mt-1 text-lg font-bold text-slate-900">
                    {formatAmount(report.settlementOverview.totalPlanned, currency)}
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    {report.settlementOverview.settlementCount} transfer
                    {report.settlementOverview.settlementCount === 1 ? '' : 's'}
                  </p>
                </div>

                <div className="rounded-xl border border-emerald-100 bg-emerald-50/20 p-4">
                  <p className="text-xs font-medium text-slate-500">Confirmed Paid</p>
                  <p className="mt-1 text-lg font-bold text-emerald-700">
                    {formatAmount(report.settlementOverview.totalPaid, currency)}
                  </p>
                  <p className="mt-0.5 text-[11px] text-emerald-700">
                    {report.settlementOverview.completedCount} completed
                  </p>
                </div>

                <div className="rounded-xl border border-amber-100 bg-amber-50/20 p-4">
                  <p className="text-xs font-medium text-slate-500">Outstanding Debt</p>
                  <p className="mt-1 text-lg font-bold text-amber-700">
                    {formatAmount(report.settlementOverview.totalOutstanding, currency)}
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-500">Pending clearance</p>
                </div>

                <div className="rounded-xl border border-cyan-100 bg-cyan-50/20 p-4">
                  <p className="text-xs font-medium text-slate-500">In Progress</p>
                  <p className="mt-1 text-lg font-bold text-cyan-700">
                    {formatAmount(report.settlementOverview.totalPending, currency)}
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-500">Awaiting confirmation</p>
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50/30 p-4">
                  <p className="text-xs font-medium text-slate-500">Total Refunded</p>
                  <p className="mt-1 text-lg font-bold text-slate-700">
                    {formatAmount(report.settlementOverview.totalRefunded, currency)}
                  </p>
                  <p className="mt-0.5 text-[11px] text-slate-500">Returned transfers</p>
                </div>
              </div>

              <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-orange-100 bg-orange-50/40 p-4">
                <p className="text-xs text-slate-600">
                  Ready to manage transfers, submit proofs, verify receipts, or request closure?
                </p>
                <Link
                  to={`/settlements?tripId=${selectedTripId}`}
                  className="btn-secondary !px-4 !py-2 !text-xs"
                >
                  Go to Settlement Workspace
                </Link>
              </div>
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
