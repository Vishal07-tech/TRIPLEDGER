import { useState } from 'react';

export type BudgetMember = {
  userId: string;
  fullName: string;
  isActive: boolean;
  plannedBudget: string | null;
  responsibility: string;
  remainingBudget: string | null;
  utilizationPct: string | null;
  overspending: string | null;
  warningLevel: string;
  warningThresholds: number[];
  projectedNext30Days: string;
};

export type BudgetSummary = {
  currency: string;
  trip: {
    plannedBudget: string | null;
    responsibility: string;
    remainingBudget: string | null;
    utilizationPct: string | null;
    overspending: string | null;
    warningThresholds: number[];
    projectedNext30Days: string;
  };
  forecast: {
    method: string;
    elapsedDays: number;
    horizonDays: number;
  };
  members: BudgetMember[];
  notifications: Array<{
    id: string;
    title: string;
    message: string;
    createdAt: string;
    resolvedAt: string | null;
  }>;
};

type Props = {
  budget: BudgetSummary;
  canManage: boolean;
  onSaveBudget: (userId: string, plannedBudget: string) => Promise<void>;
};

function formatAmount(value: string | null, currency: string) {
  if (value === null) return 'Not set';
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return `${currency} ${value}`;
  const fractionDigits = new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
  }).resolvedOptions().maximumFractionDigits ?? 2;
  const whole = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(BigInt(match[2]));
  const fraction = (match[3] ?? '').slice(0, fractionDigits).padEnd(fractionDigits, '0');
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).formatToParts(match[1] === '-' ? -1 : 1).map((part) => {
    if (part.type === 'integer') return whole;
    if (part.type === 'fraction') return fraction;
    if (part.type === 'decimal' && fractionDigits === 0) return '';
    return part.value;
  }).join('');
}

function thresholdSummary(thresholds: number[]) {
  if (thresholds.length === 0) return 'No warning threshold reached';
  return `Warning thresholds reached: ${thresholds.map((threshold) => `${threshold}%`).join(', ')}`;
}

export default function BudgetOverview({ budget, canManage, onSaveBudget }: Props) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingUserId, setSavingUserId] = useState('');
  const [saveErrors, setSaveErrors] = useState<Record<string, string>>({});

  async function saveBudget(userId: string) {
    const plannedBudget = drafts[userId]?.trim();
    if (!plannedBudget || !/^\d+(?:\.\d{1,2})?$/.test(plannedBudget) || !/[1-9]/.test(plannedBudget)) {
      setSaveErrors((current) => ({
        ...current,
        [userId]: 'Enter a budget greater than zero with no more than two decimal places.',
      }));
      return;
    }

    setSavingUserId(userId);
    setSaveErrors((current) => ({ ...current, [userId]: '' }));
    try {
      await onSaveBudget(userId, plannedBudget);
      setDrafts((current) => ({ ...current, [userId]: '' }));
    } catch (error) {
      setSaveErrors((current) => ({
        ...current,
        [userId]: error instanceof Error ? error.message : 'Could not save this budget.',
      }));
    } finally {
      setSavingUserId('');
    }
  }

  return (
    <section id="budgets" className="card-surface mb-8 scroll-mt-6" aria-labelledby="budget-title">
      <div className="border-b border-orange-100 px-5 py-4">
        <h2 id="budget-title" className="text-xl font-semibold">Budget overview</h2>
        <p className="mt-1 text-sm text-slate-600">
          Budget use is calculated from financial responsibility, never from who paid.
        </p>
      </div>

      <div className="grid gap-4 p-5 sm:grid-cols-2 xl:grid-cols-4">
        <BudgetMetric label="Combined member budgets" value={formatAmount(budget.trip.plannedBudget, budget.currency)} />
        <BudgetMetric label="Trip responsibility" value={formatAmount(budget.trip.responsibility, budget.currency)} />
        <BudgetMetric label="Budget remaining" value={formatAmount(budget.trip.remainingBudget, budget.currency)} />
        <BudgetMetric label="Responsibility forecast · next 30 days" value={formatAmount(budget.trip.projectedNext30Days, budget.currency)} />
      </div>
      {budget.trip.plannedBudget !== null && (
        <p className="px-5 pb-5 text-sm text-slate-700">
          Trip utilization: <strong>{budget.trip.utilizationPct}%</strong>
          {' · '}Overspending: <strong>{formatAmount(budget.trip.overspending, budget.currency)}</strong>
          {' · '}{thresholdSummary(budget.trip.warningThresholds)}
        </p>
      )}

      {budget.trip.plannedBudget === null && (
        <p className="mx-5 mb-5 rounded-xl bg-orange-50 p-4 text-sm text-slate-700">
          No member budgets are set yet. {canManage ? 'Set budgets below to start tracking trip spending.' : 'A trip owner or admin can set member budgets.'}
        </p>
      )}

      <div className="grid gap-4 px-5 pb-5 md:grid-cols-2">
        {budget.members.map((member) => (
          <article key={member.userId} className="rounded-xl border border-orange-100 p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="font-semibold">{member.fullName}{member.isActive ? '' : ' (former member)'}</h3>
                <p className="mt-1 text-sm text-slate-600">
                  Responsibility: {formatAmount(member.responsibility, budget.currency)}
                </p>
              </div>
              <span className="rounded-full bg-orange-50 px-3 py-1 text-sm font-medium text-slate-800">
                {member.warningLevel}
              </span>
            </div>
            {member.plannedBudget === null ? (
              <p className="mt-3 text-sm text-slate-600">No budget set · {thresholdSummary(member.warningThresholds)}</p>
            ) : (
              <>
                <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <p><span className="block text-slate-600">Planned</span><strong>{formatAmount(member.plannedBudget, budget.currency)}</strong></p>
                  <p><span className="block text-slate-600">Remaining</span><strong>{formatAmount(member.remainingBudget, budget.currency)}</strong></p>
                  <p><span className="block text-slate-600">Utilization</span><strong>{member.utilizationPct}%</strong></p>
                  <p><span className="block text-slate-600">Overspending</span><strong>{formatAmount(member.overspending, budget.currency)}</strong></p>
                </div>
                <progress
                  className="mt-4 h-2 w-full accent-orange-600"
                  aria-label={`${member.fullName} budget utilization`}
                  max={100}
                  value={Math.min(100, Math.max(0, Number(member.utilizationPct ?? 0)))}
                />
                <p className="mt-2 text-sm text-slate-600">{thresholdSummary(member.warningThresholds)}</p>
                <p className="mt-1 text-sm text-slate-600">
                  Responsibility forecast for next 30 days: {formatAmount(member.projectedNext30Days, budget.currency)}
                </p>
              </>
            )}

            {canManage && member.isActive && (
              <form
                className="mt-4 flex flex-wrap items-end gap-2 border-t border-orange-100 pt-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveBudget(member.userId);
                }}
              >
                <label className="min-w-40 flex-1 text-sm font-medium" htmlFor={`budget-${member.userId}`}>
                  {member.plannedBudget === null ? 'Set budget' : 'Update budget'}
                  <input
                    id={`budget-${member.userId}`}
                    className="input-field mt-1 min-h-11 w-full"
                    inputMode="decimal"
                    value={drafts[member.userId] ?? ''}
                    onChange={(event) => setDrafts((current) => ({
                      ...current,
                      [member.userId]: event.target.value,
                    }))}
                    placeholder={member.plannedBudget ?? '0.00'}
                    aria-describedby={`budget-${member.userId}-help${saveErrors[member.userId] ? ` budget-${member.userId}-error` : ''}`}
                  />
                </label>
                <p id={`budget-${member.userId}-help`} className="sr-only">
                  Enter a positive amount in {budget.currency}.
                </p>
                <button
                  type="submit"
                  className="btn-secondary min-h-11"
                  disabled={savingUserId === member.userId}
                >
                  {savingUserId === member.userId ? 'Saving…' : 'Save budget'}
                </button>
                {saveErrors[member.userId] && (
                  <p id={`budget-${member.userId}-error`} className="w-full text-sm text-red-700" role="alert">
                    {saveErrors[member.userId]}
                  </p>
                )}
              </form>
            )}
          </article>
        ))}
      </div>

      <div className="border-t border-orange-100 px-5 py-4">
        <h3 className="font-semibold">How the forecast works</h3>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">{budget.forecast.method}</p>
      </div>

      <div className="border-t border-orange-100 px-5 py-4">
        <NotificationList
          title="Active budget warnings"
          notifications={budget.notifications.filter((notification) => notification.resolvedAt === null)}
          emptyMessage="No active budget warnings."
        />
        <NotificationList
          title="Resolved warning history"
          notifications={budget.notifications.filter((notification) => notification.resolvedAt !== null)}
          emptyMessage="No resolved warnings."
          className="mt-5 border-t border-orange-100 pt-4"
        />
      </div>
    </section>
  );
}

function BudgetMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-orange-50/70 p-4">
      <p className="text-sm font-medium text-slate-700">{label}</p>
      <p className="mt-2 break-words text-xl font-bold tabular-nums text-slate-900">{value}</p>
    </div>
  );
}

function NotificationList({
  title,
  notifications,
  emptyMessage,
  className = '',
}: {
  title: string;
  notifications: BudgetSummary['notifications'];
  emptyMessage: string;
  className?: string;
}) {
  return (
    <section className={className} aria-label={title}>
      <h3 className="font-semibold">{title}</h3>
      {notifications.length === 0 ? (
        <p className="mt-2 text-sm text-slate-600">{emptyMessage}</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {notifications.map((notification) => (
            <li
              key={notification.id}
              className={`rounded-lg px-4 py-3 text-sm ${
                notification.resolvedAt ? 'bg-slate-100 text-slate-700' : 'bg-amber-50 text-amber-950'
              }`}
            >
              <p className="font-medium">
                {notification.title} · {notification.resolvedAt ? 'Resolved' : 'Active'}
              </p>
              <p className="mt-1">{notification.message}</p>
              <time className="mt-1 block text-xs" dateTime={notification.createdAt}>
                Created {new Date(notification.createdAt).toLocaleString()}
              </time>
              {notification.resolvedAt && (
                <time className="mt-1 block text-xs" dateTime={notification.resolvedAt}>
                  Resolved {new Date(notification.resolvedAt).toLocaleString()}
                </time>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
