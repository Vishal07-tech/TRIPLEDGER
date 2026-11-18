import { type FormEvent, useEffect, useState } from 'react';
import { apiRequest } from '../lib/apiClient';

type Member = { userId: string; fullName: string };
type Trip = { id: string; baseCurrency: string; cashManagerUserId: string | null };
type SplitMethod = 'EQUAL' | 'EXACT' | 'PERCENTAGE' | 'WEIGHTED';
type ExpenseType = 'PERSONAL' | 'GROUP';
type PaymentMethod = 'CASH' | 'UPI';

type Props = {
  token: string;
  trip: Trip;
  members: Member[];
  currentUserId: string;
  onSaved: () => Promise<void>;
  correction?: ExpenseCorrectionDraft;
  onCancelCorrection?: () => void;
};

export type ExpenseCorrectionDraft = {
  id: string;
  title: string;
  description: string | null;
  amount: string;
  currency: string;
  exchangeRate: string | null;
  category: string;
  expenseType: ExpenseType;
  paymentMethod: PaymentMethod;
  date: string;
  allocations: Array<{ userId: string; allocatedAmount: string }>;
  payers: Array<{ userId: string; amount: string }>;
};

async function submitRequest(
  token: string,
  tripId: string,
  body: unknown,
  correction?: ExpenseCorrectionDraft,
  reason?: string,
) {
  const path = correction
    ? `/api/trips/${tripId}/expenses/${correction.id}/corrections`
    : `/api/trips/${tripId}/expenses`;
  await apiRequest(path, {
    method: 'POST',
    body: JSON.stringify(correction ? { reason, replacement: body } : body),
  }, token);
}

function localDateTime(value?: string) {
  const now = value ? new Date(value) : new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 16);
}

function equalPercentages(userIds: string[]) {
  if (userIds.length === 0) return {};
  const each = Math.floor(10_000 / userIds.length);
  const remainder = 10_000 - each * userIds.length;
  return Object.fromEntries(
    userIds.map((userId, index) => {
      const basisPoints = each + (index === userIds.length - 1 ? remainder : 0);
      return [userId, `${Math.floor(basisPoints / 100)}.${(basisPoints % 100).toString().padStart(2, '0')}`];
    }),
  );
}

export default function ExpenseForm({
  token,
  trip,
  members,
  currentUserId,
  onSaved,
  correction,
  onCancelCorrection,
}: Props) {
  const memberIdsKey = members.map((member) => member.userId).join(',');
  const [title, setTitle] = useState(correction?.title ?? '');
  const [description, setDescription] = useState(correction?.description ?? '');
  const [amount, setAmount] = useState(correction?.amount ?? '');
  const [currency, setCurrency] = useState(correction?.currency ?? trip.baseCurrency);
  const [exchangeRate, setExchangeRate] = useState(correction?.exchangeRate ?? '');
  const [category, setCategory] = useState(correction?.category ?? 'General');
  const [expenseType, setExpenseType] = useState<ExpenseType>(correction?.expenseType ?? 'GROUP');
  const [splitMethod, setSplitMethod] = useState<SplitMethod>(correction ? 'EXACT' : 'EQUAL');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(correction?.paymentMethod ?? 'CASH');
  const [expenseDate, setExpenseDate] = useState(correction ? localDateTime(correction.date) : localDateTime());
  const [responsibleUserId, setResponsibleUserId] = useState(correction?.allocations[0]?.userId ?? currentUserId);
  const [reason, setReason] = useState('');
  const [participantIds, setParticipantIds] = useState<string[]>([]);
  const [splitValues, setSplitValues] = useState<Record<string, string>>({});
  const [payerIds, setPayerIds] = useState<string[]>([]);
  const [payerAmounts, setPayerAmounts] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const userIds = memberIdsKey ? memberIdsKey.split(',') : [];
    const splitIds = correction?.expenseType === 'GROUP'
      ? correction.allocations.map((allocation) => allocation.userId)
      : userIds;
    setParticipantIds(splitIds);
    setSplitValues(correction
      ? Object.fromEntries(correction.allocations.map((allocation) => [allocation.userId, allocation.allocatedAmount]))
      : Object.fromEntries(userIds.map((userId) => [userId, '1'])));
    setPayerIds(correction
      ? correction.payers.map((payer) => payer.userId)
      : [trip.cashManagerUserId ?? currentUserId].filter(Boolean));
    setPayerAmounts(correction
      ? Object.fromEntries(correction.payers.map((payer) => [payer.userId, payer.amount]))
      : {});
    setResponsibleUserId(correction?.allocations[0]?.userId ?? currentUserId ?? userIds[0] ?? '');
  }, [correction?.id, currentUserId, memberIdsKey, trip.cashManagerUserId]);

  useEffect(() => {
    setCurrency(correction?.currency ?? trip.baseCurrency);
    setExchangeRate(correction?.exchangeRate ?? '');
  }, [correction?.id, correction?.currency, correction?.exchangeRate, trip.baseCurrency, trip.id]);

  useEffect(() => {
    if (payerIds.length === 1 && amount) {
      setPayerAmounts((current) => ({ ...current, [payerIds[0]]: amount }));
    }
  }, [amount, payerIds]);

  function setExpenseSplitMethod(method: SplitMethod) {
    setSplitMethod(method);
    if (method === 'WEIGHTED') {
      setSplitValues((current) => Object.fromEntries(participantIds.map((id) => [id, current[id] || '1'])));
    }
    if (method === 'PERCENTAGE') {
      setSplitValues((current) => ({ ...current, ...equalPercentages(participantIds) }));
    }
  }

  function toggleParticipant(userId: string) {
    const next = participantIds.includes(userId)
      ? participantIds.filter((id) => id !== userId)
      : [...participantIds, userId];
    setParticipantIds(next);
    if (splitMethod === 'PERCENTAGE') {
      setSplitValues((values) => ({ ...values, ...equalPercentages(next) }));
    }
  }

  function togglePayer(userId: string) {
    if (paymentMethod === 'CASH' && userId === trip.cashManagerUserId) return;
    setPayerIds((current) => current.includes(userId)
      ? current.filter((id) => id !== userId)
      : [...current, userId]);
  }

  function changePaymentMethod(method: PaymentMethod) {
    setPaymentMethod(method);
    if (method === 'CASH' && trip.cashManagerUserId && !payerIds.includes(trip.cashManagerUserId)) {
      setPayerIds((current) => [...current, trip.cashManagerUserId!]);
      setPayerAmounts((current) => ({
        ...current,
        [trip.cashManagerUserId!]: payerIds.length === 0 ? amount : current[trip.cashManagerUserId!] ?? '',
      }));
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSaving(true);

    try {
      const payload = {
        title,
        description: description || undefined,
        amount,
        currency: currency.toUpperCase(),
        exchangeRate: currency.toUpperCase() === trip.baseCurrency ? undefined : exchangeRate,
        category,
        expenseType,
        splitMethod,
        paymentMethod,
        date: new Date(expenseDate).toISOString(),
        responsibleUserId: expenseType === 'PERSONAL' ? responsibleUserId : undefined,
        splits: expenseType === 'GROUP'
          ? participantIds.map((userId) => ({
            userId,
            ...(splitMethod === 'EXACT' ? { amount: splitValues[userId] ?? '' } : {}),
            ...(splitMethod === 'PERCENTAGE' ? { percentage: splitValues[userId] ?? '' } : {}),
            ...(splitMethod === 'WEIGHTED' ? { weight: splitValues[userId] ?? '' } : {}),
          }))
          : undefined,
        payers: payerIds.map((userId) => ({ userId, amount: payerAmounts[userId] ?? '' })),
      };

      await submitRequest(token, trip.id, payload, correction, reason);
      setTitle('');
      setDescription('');
      await onSaved();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Could not save this expense.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="card-surface p-5 md:p-6" aria-labelledby="expense-form-title">
      <div className="mb-5">
        <h2 id="expense-form-title" className="text-xl font-semibold">
          {correction ? `Correct ${correction.title}` : 'Record an expense'}
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Who paid and who is responsible are recorded independently.
        </p>
      </div>

      <form className="space-y-4" onSubmit={handleSubmit}>
        {correction && (
          <label className="block text-sm font-medium">
            Correction reason
            <input
              className="input-field mt-1"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              minLength={3}
              maxLength={500}
              required
            />
          </label>
        )}
        <label className="block text-sm font-medium">
          Expense name
          <input className="input-field mt-1" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} required />
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-medium">
            Amount
            <input
              className="input-field mt-1"
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="0.00"
              required
            />
          </label>
          <label className="block text-sm font-medium">
            Currency
            <input
              className="input-field mt-1 uppercase"
              value={currency}
              onChange={(event) => setCurrency(event.target.value)}
              maxLength={3}
              required
            />
          </label>
        </div>

        {currency.toUpperCase() !== trip.baseCurrency && (
          <label className="block text-sm font-medium">
            Exchange rate ({currency.toUpperCase()} to {trip.baseCurrency})
            <input
              className="input-field mt-1"
              type="text"
              inputMode="decimal"
              value={exchangeRate}
              onChange={(event) => setExchangeRate(event.target.value)}
              placeholder="1.00000000"
              required
            />
          </label>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-medium">
            Category
            <input className="input-field mt-1" value={category} onChange={(event) => setCategory(event.target.value)} maxLength={60} required />
          </label>
          <label className="block text-sm font-medium">
            Date
            <input className="input-field mt-1" type="datetime-local" value={expenseDate} onChange={(event) => setExpenseDate(event.target.value)} required />
          </label>
        </div>

        <label className="block text-sm font-medium">
          Expense type
          <select
            className="input-field mt-1"
            value={expenseType}
            onChange={(event) => setExpenseType(event.target.value as ExpenseType)}
          >
            <option value="GROUP">Group expense</option>
            <option value="PERSONAL">Personal responsibility</option>
          </select>
        </label>

        {expenseType === 'PERSONAL' ? (
          <label className="block text-sm font-medium">
            Responsible member
            <select className="input-field mt-1" value={responsibleUserId} onChange={(event) => setResponsibleUserId(event.target.value)} required>
              {members.map((member) => <option key={member.userId} value={member.userId}>{member.fullName}</option>)}
            </select>
          </label>
        ) : (
          <fieldset className="space-y-3 rounded-xl border border-orange-100 p-4">
            <legend className="px-1 text-sm font-semibold">Share responsibility with</legend>
            <label className="block text-sm font-medium">
              Split method
              <select
                className="input-field mt-1"
                value={splitMethod}
                onChange={(event) => setExpenseSplitMethod(event.target.value as SplitMethod)}
              >
                <option value="EQUAL">Equally</option>
                <option value="EXACT">Exact amounts</option>
                <option value="PERCENTAGE">Percentages</option>
                <option value="WEIGHTED">Weights</option>
              </select>
            </label>
            <div className="space-y-2">
              {members.map((member) => {
                const selected = participantIds.includes(member.userId);
                return (
                  <div key={member.userId} className="flex flex-wrap items-center gap-3">
                    <label className="flex min-w-0 flex-1 items-center gap-2 text-sm">
                      <input type="checkbox" checked={selected} onChange={() => toggleParticipant(member.userId)} />
                      <span>{member.fullName}</span>
                    </label>
                    {selected && splitMethod !== 'EQUAL' && (
                      <label className="sr-only" htmlFor={`split-${member.userId}`}>
                        {splitMethod.toLowerCase()} for {member.fullName}
                      </label>
                    )}
                    {selected && splitMethod !== 'EQUAL' && (
                      <div className="flex items-center gap-2">
                        <input
                          id={`split-${member.userId}`}
                          className="input-field w-32 py-2"
                          type="text"
                          inputMode="decimal"
                          value={splitValues[member.userId] ?? ''}
                          onChange={(event) => setSplitValues((current) => ({ ...current, [member.userId]: event.target.value }))}
                          aria-label={`${splitMethod.toLowerCase()} for ${member.fullName}`}
                          required
                        />
                        {splitMethod === 'PERCENTAGE' && <span className="text-sm text-slate-500">%</span>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-slate-500">
              Only selected members share financial responsibility. Amounts are reconciled exactly in minor units.
            </p>
          </fieldset>
        )}

        <fieldset className="space-y-3 rounded-xl border border-orange-100 p-4">
          <legend className="px-1 text-sm font-semibold">Who paid?</legend>
          <label className="block text-sm font-medium">
            Recorded payment method
            <select
              className="input-field mt-1"
              value={paymentMethod}
              onChange={(event) => changePaymentMethod(event.target.value as PaymentMethod)}
            >
              <option value="CASH">Cash</option>
              <option value="UPI">UPI (record only)</option>
            </select>
          </label>
          {paymentMethod === 'CASH' && (
            <p className="text-xs text-slate-600">
              Cash expenses must include the trip cash manager as a payer. This records their own-funds disbursement without changing responsibility.
            </p>
          )}
          {paymentMethod === 'UPI' && (
            <p className="text-xs text-cyan-900">
              Payer amounts are member-recorded only; this phase does not verify UPI transactions.
            </p>
          )}
          <div className="space-y-2">
            {members.map((member) => {
              const selected = payerIds.includes(member.userId);
              return (
                <div key={member.userId} className="flex flex-wrap items-center gap-3">
                  <label className="flex min-w-0 flex-1 items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={selected}
                      disabled={paymentMethod === 'CASH' && member.userId === trip.cashManagerUserId}
                      onChange={() => togglePayer(member.userId)}
                    />
                    <span>{member.fullName}{member.userId === trip.cashManagerUserId ? ' · cash manager' : ''}</span>
                  </label>
                  {selected && (
                    <label className="flex items-center gap-2 text-sm">
                      <span className="sr-only">Amount paid by {member.fullName}</span>
                      <input
                        className="input-field w-32 py-2"
                        type="text"
                        inputMode="decimal"
                        value={payerAmounts[member.userId] ?? ''}
                        onChange={(event) => setPayerAmounts((current) => ({ ...current, [member.userId]: event.target.value }))}
                        placeholder="0.00"
                        required
                      />
                      <span className="text-slate-500">{currency.toUpperCase()}</span>
                    </label>
                  )}
                </div>
              );
            })}
          </div>
          <p className="text-xs text-slate-500">Payer amounts must add up exactly to the expense total.</p>
        </fieldset>

        <label className="block text-sm font-medium">
          Notes (optional)
          <textarea className="input-field mt-1 min-h-20" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={1000} />
        </label>

        {error && (
          <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="flex gap-3">
          {correction && (
            <button type="button" className="btn-secondary flex-1" onClick={onCancelCorrection}>
              Cancel
            </button>
          )}
          <button type="submit" className="btn-primary flex-1" disabled={saving || members.length === 0}>
            {saving ? 'Saving expense…' : correction ? 'Save correction' : 'Save expense'}
          </button>
        </div>
      </form>
    </section>
  );
}
