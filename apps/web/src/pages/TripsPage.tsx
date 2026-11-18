import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, CalendarDays, Compass, Plus, Users } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';

import { apiRequest } from '../lib/apiClient';
import { getSessionToken } from '../lib/session';

type Trip = {
  id: string; name: string; description: string | null; startDate: string | null; endDate: string | null;
  baseCurrency: string; status: string; members: Array<{ userId: string; role: string; isActive: boolean }>;
};
type Invitation = {
  id: string; tripId: string; expiresAt: string;
  trip: { name: string; baseCurrency: string; status: string };
};

const currencies = ['INR', 'USD', 'EUR', 'GBP', 'CAD', 'AUD', 'SGD', 'JPY'];
const initialSettings = { allowMemberExpenseEdit: true, requireLocationConfirmation: true, allowPublicJoin: false };

function errorText(error: unknown) { return error instanceof Error ? error.message : 'The request could not be completed.'; }
function dateLabel(value: string | null) { return value ? new Date(`${value.slice(0, 10)}T00:00:00`).toLocaleDateString() : 'Dates not set'; }

export default function TripsPage() {
  const navigate = useNavigate();
  const token = getSessionToken();
  const [trips, setTrips] = useState<Trip[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [actionId, setActionId] = useState('');
  const [form, setForm] = useState({ name: '', description: '', startDate: '', endDate: '', baseCurrency: 'INR', ...initialSettings });

  const load = useCallback(async () => {
    if (!token) { navigate('/'); return; }
    setError('');
    try {
      const [tripData, invitationData, userData] = await Promise.all([
        apiRequest<{ trips: Trip[] }>('/api/trips', {}, token),
        apiRequest<{ invitations: Invitation[] }>('/api/invitations', {}, token),
        apiRequest<{ user: { email: string } }>('/api/auth/me', {}, token),
      ]);
      setTrips(tripData.trips);
      setInvitations(invitationData.invitations);
      setEmail(userData.user.email);
    } catch (err) { setError(errorText(err)); }
    finally { setLoading(false); }
  }, [navigate, token]);

  useEffect(() => { void load(); }, [load]);

  async function createTrip(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(''); setNotice(''); setSubmitting(true);
    try {
      const { trip } = await apiRequest<{ trip: Trip }>('/api/trips', {
        method: 'POST', body: JSON.stringify({
          name: form.name.trim(), description: form.description.trim() || undefined,
          startDate: form.startDate, endDate: form.endDate, baseCurrency: form.baseCurrency,
          settings: { allowMemberExpenseEdit: form.allowMemberExpenseEdit, requireLocationConfirmation: form.requireLocationConfirmation, allowPublicJoin: form.allowPublicJoin },
        }),
      }, token);
      setTrips((current) => [trip, ...current]);
      setShowCreate(false);
      setForm({ name: '', description: '', startDate: '', endDate: '', baseCurrency: 'INR', ...initialSettings });
      setNotice('Trip created. You can now invite members and set budgets.');
      navigate(`/trips/${trip.id}`);
    } catch (err) { setError(errorText(err)); }
    finally { setSubmitting(false); }
  }

  async function respondToInvitation(invitation: Invitation, action: 'accept' | 'decline') {
    const prompt = action === 'accept'
      ? `Join ${invitation.trip.name} with the signed-in account ${email}?`
      : `Decline the invitation to ${invitation.trip.name}?`;
    if (!window.confirm(prompt)) return;
    setError(''); setNotice(''); setActionId(invitation.id);
    try {
      await apiRequest(`/api/invitations/${invitation.id}/${action}`, { method: 'POST' }, token);
      setInvitations((current) => current.filter((item) => item.id !== invitation.id));
      if (action === 'accept') {
        setNotice(`You joined ${invitation.trip.name} as the signed-in account ${email}.`);
        await load();
      } else setNotice(`Invitation to ${invitation.trip.name} declined.`);
    } catch (err) { setError(errorText(err)); }
    finally { setActionId(''); }
  }

  const groups = useMemo(() => {
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const completed = trips.filter((trip) => ['TRIP_CLOSED', 'FULLY_SETTLED'].includes(trip.status) || Boolean(trip.endDate && trip.endDate.slice(0, 10) < today));
    const upcoming = trips.filter((trip) => !completed.includes(trip) && (trip.startDate?.slice(0, 10) ?? '') > today);
    const active = trips.filter((trip) => !completed.includes(trip) && !upcoming.includes(trip));
    return [{ title: 'Active trips', items: active }, { title: 'Upcoming trips', items: upcoming }, { title: 'Completed trips', items: completed }];
  }, [trips]);

  if (loading) return <main className="mx-auto max-w-6xl px-4 py-12" aria-live="polite">Loading your trips…</main>;

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 text-slate-900 sm:px-6 lg:px-8">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-primary">TripLedger · Your travel ledger</p>
          <h1 className="mt-2 text-4xl font-bold">My trips</h1>
          <p className="mt-2 text-slate-600">Plan together, keep spending clear, and settle up when you’re home.</p>
        </div>
        <div className="flex gap-2">
          <Link to="/dashboard" className="btn-secondary !px-4 !py-2.5">Expense dashboard</Link>
          <button type="button" className="btn-primary !px-4 !py-2.5" onClick={() => setShowCreate((value) => !value)}>
            <Plus size={18} aria-hidden="true" /> <span className="ml-2">Create trip</span>
          </button>
        </div>
      </header>

      {error && <div role="alert" className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}
      {notice && <div role="status" className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{notice}</div>}

      {showCreate && <section className="card-surface mb-8 p-5 sm:p-7" aria-labelledby="create-trip-title">
        <div className="mb-5 flex items-start justify-between gap-3">
          <div><p className="text-sm font-semibold text-primary">Start with the essentials</p><h2 id="create-trip-title" className="mt-1 text-2xl font-bold">Create a trip</h2></div>
          <button type="button" className="btn-secondary !px-3 !py-2" onClick={() => setShowCreate(false)}>Close</button>
        </div>
        <form onSubmit={createTrip} className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="text-sm font-medium">Trip name<input className="input-field mt-1" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} minLength={2} maxLength={100} required placeholder="Coastal weekend" /></label>
            <label className="text-sm font-medium">Base currency<select className="input-field mt-1" value={form.baseCurrency} onChange={(e) => setForm({ ...form, baseCurrency: e.target.value })}>{currencies.map((currency) => <option key={currency}>{currency}</option>)}</select></label>
            <label className="text-sm font-medium">Start date<input className="input-field mt-1" type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} required /></label>
            <label className="text-sm font-medium">End date<input className="input-field mt-1" type="date" min={form.startDate} value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} required /></label>
          </div>
          <label className="block text-sm font-medium">Description <span className="font-normal text-slate-500">(optional)</span><textarea className="input-field mt-1 min-h-20" maxLength={500} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="A little context for your travel group" /></label>
          <fieldset className="rounded-xl border border-orange-100 p-4">
            <legend className="px-1 text-sm font-semibold">Initial trip settings</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                ['allowMemberExpenseEdit', 'Members can edit their expenses'],
                ['requireLocationConfirmation', 'Ask members to confirm expense locations'],
                ['allowPublicJoin', 'Allow public joining'],
              ].map(([key, label]) => <label key={key} className="flex items-start gap-3 text-sm text-slate-700"><input className="mt-1 accent-orange-600" type="checkbox" checked={form[key as keyof typeof form] as boolean} onChange={(e) => setForm({ ...form, [key]: e.target.checked })} /><span>{label}</span></label>)}
            </div>
          </fieldset>
          <p className="text-xs text-slate-500">You’ll be the trip owner and initial cash manager. Cash manager advances remain personal payments; no shared cash pool is created.</p>
          <button type="submit" className="btn-primary !px-5 !py-3" disabled={submitting}>{submitting ? 'Creating trip…' : 'Create trip'}</button>
        </form>
      </section>}

      <section className="card-surface mb-8 p-5 sm:p-6" aria-labelledby="invitations-title">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><p className="text-sm font-semibold text-secondary">For {email || 'your account'}</p><h2 id="invitations-title" className="mt-1 text-2xl font-bold">Invitations</h2></div>
          <p className="text-sm text-slate-500">Accepting uses this signed-in account’s email.</p>
        </div>
        {invitations.length === 0 ? <p className="mt-4 rounded-xl bg-orange-50/70 px-4 py-3 text-sm text-slate-600">No pending invitations. New invitations to your registered email will appear here.</p> :
          <ul className="mt-4 divide-y divide-orange-100">{invitations.map((invitation) => <li key={invitation.id} className="flex flex-wrap items-center justify-between gap-4 py-4">
            <div><p className="font-semibold">{invitation.trip.name}</p><p className="mt-1 text-sm text-slate-600">{invitation.trip.baseCurrency} · Expires {new Date(invitation.expiresAt).toLocaleString()}</p><p className="mt-1 text-xs text-slate-500">This invitation is for {email}.</p></div>
            <div className="flex gap-2"><button type="button" className="btn-primary !px-4 !py-2" disabled={actionId === invitation.id} onClick={() => void respondToInvitation(invitation, 'accept')}>{actionId === invitation.id ? 'Working…' : 'Accept'}</button><button type="button" className="btn-secondary !px-4 !py-2" disabled={actionId === invitation.id} onClick={() => void respondToInvitation(invitation, 'decline')}>Decline</button></div>
          </li>)}</ul>}
      </section>

      {groups.map(({ title, items }) => <section key={title} className="mb-9" aria-labelledby={`${title.replaceAll(' ', '-')}-title`}>
        <div className="mb-3 flex items-baseline justify-between"><h2 id={`${title.replaceAll(' ', '-')}-title`} className="text-2xl font-bold">{title}</h2><span className="text-sm text-slate-500">{items.length} {items.length === 1 ? 'trip' : 'trips'}</span></div>
        {items.length === 0 ? <div className="card-surface flex flex-col items-start gap-3 p-6 sm:flex-row sm:items-center sm:justify-between"><div className="flex gap-3"><Compass className="mt-1 shrink-0 text-primary" aria-hidden="true" /><div><p className="font-semibold">{title === 'Active trips' && trips.length === 0 ? 'Your next trip starts here' : `No ${title.toLowerCase()} yet`}</p><p className="mt-1 text-sm text-slate-600">{title === 'Active trips' && trips.length === 0 ? 'Create a trip or accept an invitation to see it here.' : 'Trips will appear here as their dates and status change.'}</p></div></div>{title === 'Active trips' && trips.length === 0 && <button type="button" className="btn-primary !px-4 !py-2.5" onClick={() => setShowCreate(true)}>Create trip</button>}</div> :
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{items.map((trip) => <article key={trip.id} className="card-surface flex min-h-52 flex-col p-5 transition hover:-translate-y-0.5 hover:shadow-md">
            <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wider text-primary">{trip.baseCurrency} · {trip.status.toLowerCase().replaceAll('_', ' ')}</p><h3 className="mt-2 text-xl font-bold">{trip.name}</h3></div><CalendarDays className="shrink-0 text-orange-500" aria-hidden="true" /></div>
            <p className="mt-3 text-sm text-slate-600">{dateLabel(trip.startDate)} – {dateLabel(trip.endDate)}</p>
            <p className="mt-2 flex items-center gap-2 text-sm text-slate-500"><Users size={16} aria-hidden="true" />{trip.members.filter((member) => member.isActive).length} members</p>
            <Link to={`/trips/${trip.id}`} className="mt-auto inline-flex items-center gap-2 pt-5 text-sm font-semibold text-primary hover:underline">Trip members and settings <ArrowRight size={16} aria-hidden="true" /></Link>
            <Link to={`/dashboard?tripId=${trip.id}`} className="mt-2 text-sm font-semibold text-slate-700 hover:underline">Open expense dashboard</Link>
          </article>)}</div>}
      </section>)}
    </main>
  );
}
