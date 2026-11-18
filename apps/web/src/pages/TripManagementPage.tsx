import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { apiRequest } from '../lib/apiClient';
import { getSessionToken } from '../lib/session';

type Member = { id: string; userId: string; role: string; isActive: boolean; user?: { fullName: string; email: string } };
type Trip = { id: string; name: string; description: string | null; startDate: string | null; endDate: string | null; baseCurrency: string; status: string; cashManagerUserId: string | null; members: Member[] };
type BudgetMember = { userId: string; fullName: string; isActive: boolean; plannedBudget: string | null; responsibility: string; remainingBudget: string | null; utilizationPct: string | null };
type BudgetPayload = { currency: string; members: BudgetMember[] };
type PendingInvite = { id: string; email: string; expiresAt: string; createdAt: string };

function message(error: unknown) { return error instanceof Error ? error.message : 'The request could not be completed.'; }
function money(amount: string | null, currency: string) { if (amount === null) return 'Not set'; try { return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(Number(amount)); } catch { return `${currency} ${amount}`; } }

export default function TripManagementPage() {
  const { tripId = '' } = useParams();
  const navigate = useNavigate();
  const token = getSessionToken();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [budgets, setBudgets] = useState<BudgetPayload | null>(null);
  const [invitations, setInvitations] = useState<PendingInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [memberEmail, setMemberEmail] = useState('');
  const [budgetDrafts, setBudgetDrafts] = useState<Record<string, string>>({});
  const [cashManagerId, setCashManagerId] = useState('');
  const [currentUserId, setCurrentUserId] = useState('');
  const currentTripId = useRef(tripId);
  currentTripId.current = tripId;

  const canManage = useMemo(() => trip?.members.some((member) => member.isActive && ['OWNER', 'ADMIN'].includes(member.role) && member.userId === currentUserId) ?? false, [currentUserId, trip]);

  const load = useCallback(async () => {
    if (!token) { navigate('/'); return; }
    setError('');
    try {
      const [tripResult, budgetResult, userResult] = await Promise.all([
        apiRequest<{ trip: Trip }>(`/api/trips/${tripId}`, {}, token),
        apiRequest<BudgetPayload>(`/api/trips/${tripId}/budgets`, {}, token),
        apiRequest<{ user: { id: string } }>('/api/auth/me', {}, token),
      ]);
      if (currentTripId.current !== tripId) return;
      setTrip(tripResult.trip);
      setBudgets(budgetResult);
      setCurrentUserId(userResult.user.id);
      setCashManagerId(tripResult.trip.cashManagerUserId ?? '');
      setBudgetDrafts(Object.fromEntries(budgetResult.members.map((member) => [member.userId, member.plannedBudget ?? ''])));
      const hasManagementPermission = tripResult.trip.members.some((member) => member.userId === userResult.user.id && member.isActive && ['OWNER', 'ADMIN'].includes(member.role));
      if (hasManagementPermission) {
        try {
          const inviteResult = await apiRequest<{ invitations: PendingInvite[] }>(`/api/trips/${tripId}/invitations`, {}, token);
          if (currentTripId.current !== tripId) return;
          setInvitations(inviteResult.invitations);
        } catch { setInvitations([]); }
      } else setInvitations([]);
    } catch (err) { setError(message(err)); }
    finally { setLoading(false); }
  }, [navigate, token, tripId]);

  useEffect(() => { void load(); }, [load]);

  async function submitAction(path: string, body: unknown, success: string) {
    setError(''); setNotice(''); setBusy(true);
    try { await apiRequest(path, { method: 'POST', body: JSON.stringify(body) }, token); setNotice(success); await load(); }
    catch (err) { setError(message(err)); }
    finally { setBusy(false); }
  }

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitAction(`/api/trips/${tripId}/invitations`, { email: inviteEmail.trim().toLowerCase() }, 'Invitation created. It expires in seven days; email delivery is not configured.');
    setInviteEmail('');
  }
  async function addMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitAction(`/api/trips/${tripId}/members`, { email: memberEmail.trim().toLowerCase(), role: 'MEMBER' }, 'Registered user added as a member.');
    setMemberEmail('');
  }
  async function saveBudget(event: FormEvent<HTMLFormElement>, userId: string) {
    event.preventDefault();
    const plannedBudget = budgetDrafts[userId]?.trim() ?? '';
    if (!/^(?:\d+)(?:\.\d{1,2})?$/.test(plannedBudget) || Number(plannedBudget) <= 0) { setError('Enter a positive budget amount with up to two decimal places.'); return; }
    await submitAction(`/api/trips/${tripId}/budgets`, { userId, plannedBudget }, 'Member budget saved. Remaining budget is calculated from financial responsibility.');
  }
  async function saveCashManager(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!trip || !window.confirm('Change the assigned cash manager? This does not create a shared cash balance. The assigned member must use personal money for advances.')) return;
    setError(''); setNotice(''); setBusy(true);
    try {
      const response = await apiRequest<{ trip: Trip }>(`/api/trips/${tripId}/cash-manager`, { method: 'PATCH', body: JSON.stringify({ userId: cashManagerId }) }, token);
      setTrip((current) => current ? { ...current, cashManagerUserId: response.trip.cashManagerUserId } : current);
      setNotice('Cash manager assignment updated. Advances remain that member’s personal payments.');
    } catch (err) { setError(message(err)); }
    finally { setBusy(false); }
  }

  if (loading) return <main className="mx-auto max-w-5xl px-4 py-12" aria-live="polite">Loading trip members and budgets…</main>;
  if (!trip) return <main className="mx-auto max-w-5xl px-4 py-10"><div role="alert" className="card-surface p-6"><h1 className="text-2xl font-bold">Trip details unavailable</h1><p className="mt-2 text-sm text-slate-600">{error || 'You may not have access to this trip.'}</p><Link to="/trips" className="mt-4 inline-block font-semibold text-primary underline">Back to My Trips</Link></div></main>;
  const activeMembers = trip.members.filter((member) => member.isActive);
  const displayName = (member: Member) => member.user?.fullName ?? budgets?.members.find((budget) => budget.userId === member.userId)?.fullName ?? member.user?.email ?? 'Trip member';
  const assigned = trip.members.find((member) => member.userId === trip.cashManagerUserId);

  return <main className="mx-auto max-w-6xl px-4 py-8 text-slate-900 sm:px-6 lg:px-8">
    <nav className="mb-5 flex items-center gap-2 text-sm text-slate-500"><Link className="hover:text-primary" to="/trips">My Trips</Link><span aria-hidden="true">/</span><span className="text-slate-800">{trip.name}</span></nav>
    <header className="mb-7 flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm font-semibold uppercase tracking-wider text-primary">Trip settings and members</p><h1 className="mt-1 text-4xl font-bold">{trip.name}</h1><p className="mt-2 text-sm text-slate-600">{trip.baseCurrency} · {trip.startDate ? new Date(`${trip.startDate.slice(0, 10)}T00:00:00`).toLocaleDateString() : 'Start date not set'} – {trip.endDate ? new Date(`${trip.endDate.slice(0, 10)}T00:00:00`).toLocaleDateString() : 'End date not set'}</p></div><Link className="btn-secondary !px-4 !py-2.5" to={`/dashboard?tripId=${trip.id}`}>Open expenses</Link></header>
    {error && <div role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}
    {notice && <div role="status" className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{notice}</div>}

    <section className="card-surface mb-7 overflow-hidden" aria-labelledby="members-title">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-orange-100 p-5"><div><h2 id="members-title" className="text-2xl font-bold">Trip members</h2><p className="mt-1 text-sm text-slate-600">Roles and budget responsibility for this trip.</p></div><span className="text-sm text-slate-500">{activeMembers.length} active</span></div>
      <ul className="divide-y divide-orange-100">{trip.members.map((member) => { const budget = budgets?.members.find((item) => item.userId === member.userId); return <li key={member.id} className="flex flex-wrap items-center justify-between gap-4 px-5 py-4"><div><p className="font-semibold">{displayName(member)}{member.user?.email ? <span className="ml-2 font-normal text-slate-500">{member.user.email}</span> : null}</p><p className="mt-1 text-xs uppercase tracking-wide text-slate-500">{member.isActive ? member.role : 'Former member'}{trip.cashManagerUserId === member.userId ? ' · Cash manager' : ''}</p></div><div className="text-right text-sm"><p>Planned budget: <strong>{money(budget?.plannedBudget ?? null, trip.baseCurrency)}</strong></p><p className="mt-1 text-slate-600">Responsibility: {money(budget?.responsibility ?? '0', trip.baseCurrency)} · Remaining: {money(budget?.remainingBudget ?? null, trip.baseCurrency)}</p></div></li>; })}</ul>
    </section>

    {canManage ? <div className="grid gap-6 lg:grid-cols-2">
      <section className="card-surface p-5 sm:p-6"><h2 className="text-xl font-bold">Invite a registered user</h2><p className="mt-1 text-sm text-slate-600">The recipient accepts from their signed-in account. Invitations expire after seven days. No email provider is configured.</p><form className="mt-4 flex flex-col gap-3 sm:flex-row" onSubmit={(event) => void invite(event)}><label className="sr-only" htmlFor="invite-email">Email address</label><input id="invite-email" type="email" className="input-field" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} required placeholder="person@example.com"/><button className="btn-primary shrink-0 !px-4 !py-2.5" disabled={busy}>{busy ? 'Saving…' : 'Create invitation'}</button></form>
        <h3 className="mt-6 font-semibold">Pending invitations</h3>{invitations.length === 0 ? <p className="mt-2 text-sm text-slate-500">There are no pending invitations.</p> : <ul className="mt-2 divide-y divide-orange-100">{invitations.map((invite) => <li key={invite.id} className="flex flex-wrap justify-between gap-2 py-3 text-sm"><span>{invite.email}</span><span className="text-slate-500">Expires {new Date(invite.expiresAt).toLocaleDateString()}</span></li>)}</ul>}
      </section>
      <section className="card-surface p-5 sm:p-6"><h2 className="text-xl font-bold">Add a member directly</h2><p className="mt-1 text-sm text-slate-600">For a registered account whose membership should begin now. New members receive the MEMBER role.</p><form className="mt-4 flex flex-col gap-3 sm:flex-row" onSubmit={(event) => void addMember(event)}><label className="sr-only" htmlFor="member-email">Registered user email</label><input id="member-email" type="email" className="input-field" value={memberEmail} onChange={(event) => setMemberEmail(event.target.value)} required placeholder="person@example.com"/><button className="btn-secondary shrink-0 !px-4 !py-2.5" disabled={busy}>{busy ? 'Saving…' : 'Add member'}</button></form></section>
      <section className="card-surface p-5 sm:p-6"><h2 className="text-xl font-bold">Cash manager</h2><p className="mt-1 text-sm text-slate-600">Current assignment: <strong>{assigned ? displayName(assigned) : 'Not assigned'}</strong>. Any advances use the assigned member’s personal money, not a shared pool.</p><form className="mt-4 flex flex-col gap-3 sm:flex-row" onSubmit={(event) => void saveCashManager(event)}><label className="sr-only" htmlFor="cash-manager">Assign cash manager</label><select id="cash-manager" className="input-field" value={cashManagerId} onChange={(event) => setCashManagerId(event.target.value)} required>{activeMembers.map((member) => <option key={member.userId} value={member.userId}>{displayName(member)} · {member.role}</option>)}</select><button className="btn-primary shrink-0 !px-4 !py-2.5" disabled={busy || !cashManagerId}>{busy ? 'Saving…' : 'Update manager'}</button></form></section>
      <section className="card-surface p-5 sm:p-6"><h2 className="text-xl font-bold">Member budgets</h2><p className="mt-1 text-sm text-slate-600">Remaining amounts use each person’s financial responsibility, never payer advances.</p><div className="mt-4 space-y-3">{budgets?.members.filter((member) => member.isActive).map((member) => <form key={member.userId} className="grid gap-2 border-t border-orange-100 pt-3 sm:grid-cols-[minmax(0,1fr)_8rem_auto] sm:items-center" onSubmit={(event) => void saveBudget(event, member.userId)}><div><p className="font-medium">{member.fullName}</p><p className="text-xs text-slate-500">Remaining {money(member.remainingBudget, trip.baseCurrency)} · used {member.utilizationPct ?? '0'}%</p></div><label className="text-xs text-slate-500">Planned amount<input className="input-field mt-1 !py-2" inputMode="decimal" aria-label={`${member.fullName} planned budget`} value={budgetDrafts[member.userId] ?? ''} onChange={(event) => setBudgetDrafts({ ...budgetDrafts, [member.userId]: event.target.value })} placeholder="0.00" /></label><button className="btn-secondary !px-3 !py-2" disabled={busy}>{busy ? 'Saving…' : 'Save budget'}</button></form>)}</div></section>
    </div> : <div role="status" className="card-surface p-5 text-sm text-slate-600">Member, invitation, cash-manager and budget settings are available to trip owners and admins. Contact a trip administrator if you need a change.</div>}
  </main>;
}
