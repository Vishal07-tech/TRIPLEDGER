import { type FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { apiRequest } from '../lib/apiClient';
import { setSessionToken } from '../lib/session';

type AuthMode = 'login' | 'register';

export default function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<AuthMode>('login');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setError('');

    try {
      const endpoint = mode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const payload = await apiRequest<{ token: string }>(endpoint, {
        method: 'POST',
        body: JSON.stringify(
          mode === 'login'
            ? { email, password }
            : { fullName, email, password },
        ),
      }, null);

      setSessionToken(payload.token);
      navigate('/trips');
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : 'Authentication failed.';
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-background px-4 py-10 text-slate-900 md:px-8">
      <div className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-[1.2fr_0.8fr]">
        <section className="rounded-[2rem] border border-orange-100 bg-white/80 p-8 shadow-soft backdrop-blur-md md:p-12">
          <div className="mb-10 inline-flex items-center gap-2 rounded-full bg-orange-50 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-primary">
            TripLedger
          </div>

          <h1 className="max-w-xl text-5xl font-bold leading-tight text-slate-900 md:text-6xl">
            Travel smarter together.
          </h1>

          <p className="mt-6 max-w-lg text-lg text-slate-600">
            Manage shared travel budgets, split expenses, track payments, and settle balances with clarity.
          </p>

          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {[
              ['Trips', 'Plan & share'],
              ['Expenses', 'Track every spend'],
              ['Settlements', 'Close cleanly'],
            ].map(([label, detail]) => (
              <div key={label} className="card-surface p-4">
                <p className="text-lg font-semibold text-slate-900">{label}</p>
                <p className="mt-2 text-sm text-slate-600">{detail}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="card-surface p-6 md:p-8">
          <div className="mb-6 inline-flex w-full rounded-2xl bg-orange-50 p-1">
            {['login', 'register'].map((choice) => {
              const selected = mode === choice;
              return (
                <button
                  key={choice}
                  type="button"
                  onClick={() => setMode(choice as AuthMode)}
                  className={`flex-1 rounded-xl px-3 py-2 text-sm font-semibold transition ${
                    selected ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                  }`}
                >
                  {choice === 'login' ? 'Sign in' : 'Register'}
                </button>
              );
            })}
          </div>

          <form className="space-y-4" onSubmit={handleSubmit}>
            {mode === 'register' && (
              <label className="block text-sm font-medium text-slate-700">
                Full name
                <input
                  className="input-field mt-1"
                  type="text"
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  placeholder="Alex Morgan"
                  required
                />
              </label>
            )}

            <label className="block text-sm font-medium text-slate-700">
              Email address
              <input
                className="input-field mt-1"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="alex@example.com"
                required
              />
            </label>

            <label className="block text-sm font-medium text-slate-700">
              Password
              <input
                className="input-field mt-1"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="••••••••"
                required
              />
            </label>

            {error && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}

            <button type="submit" className="btn-primary mt-2 w-full" disabled={isSubmitting}>
              {isSubmitting
                ? 'Please wait...'
                : mode === 'login'
                  ? 'Sign in to TripLedger'
                  : 'Create account'}
            </button>
          </form>

          <div className="mt-5 rounded-2xl border border-orange-100 bg-orange-50 p-4 text-sm text-slate-600">
            Secure authentication, role-based access, and trip-specific access control are enforced on the backend.
          </div>
        </section>
      </div>
    </main>
  );
}
