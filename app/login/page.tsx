'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabase';

export default function LoginPage() {
  const router = useRouter();

  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [signupDone, setSignupDone] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setLoading(true);

    if (mode === 'signup') {
      if (password !== confirm) {
        setErr('Passwords do not match.');
        setLoading(false);
        return;
      }
      if (password.length < 8) {
        setErr('Password must be at least 8 characters.');
        setLoading(false);
        return;
      }

      const { data, error } = await supabase.auth.signUp({ email, password });

      if (error) { setErr(error.message); setLoading(false); return; }

      // If email confirmation is required, Supabase won't return a session yet
      if (!data.session) {
        setSignupDone(true);
        setLoading(false);
        return;
      }

      // Signed up and immediately logged in (email confirm disabled) → onboard
      router.replace('/onboard');
      return;
    }

    // Sign in
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) { setErr(error.message); setLoading(false); return; }

    // Check if this user has set a real display name yet.
    // The DB trigger auto-fills display_name with the email prefix on sign-up,
    // so we treat that as "not yet onboarded" (no space, no last initial).
    const uid = data.user?.id;
    const emailPrefix = (data.user?.email ?? '').split('@')[0].toLowerCase();
    if (uid) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('display_name')
        .eq('id', uid)
        .single();

      const dn = (profile?.display_name ?? '').toLowerCase();
      if (!dn || dn === emailPrefix) {
        router.replace('/onboard');
        return;
      }
    }

    router.replace('/');
  }

  // Email confirm required — show a holding screen
  if (signupDone) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6 bg-black text-white">
        <div className="w-full max-w-sm text-center space-y-4">
          <div className="text-4xl">📬</div>
          <h1 className="text-xl font-semibold">Check your inbox</h1>
          <p className="text-sm text-slate-400">
            We sent a confirmation link to <span className="text-white">{email}</span>.
            Click it to activate your account, then come back here to log in.
          </p>
          <button
            onClick={() => { setSignupDone(false); setMode('signin'); }}
            className="mt-4 text-sm text-slate-400 hover:text-white underline"
          >
            Back to sign in
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-black text-white">
      <div className="w-full max-w-sm space-y-6">

        <div className="text-center">
          <h1 className="text-2xl font-bold">SaadiyatWOD</h1>
        </div>

        {/* Mode toggle */}
        <div className="flex rounded-xl border border-white/10 p-1 bg-white/5">
          <button
            type="button"
            onClick={() => { setMode('signin'); setErr(null); }}
            className={`flex-1 rounded-lg py-2 text-sm font-medium transition-colors ${
              mode === 'signin' ? 'bg-white text-black' : 'text-slate-400 hover:text-white'
            }`}
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={() => { setMode('signup'); setErr(null); }}
            className={`flex-1 rounded-lg py-2 text-sm font-medium transition-colors ${
              mode === 'signup' ? 'bg-white text-black' : 'text-slate-400 hover:text-white'
            }`}
          >
            Create account
          </button>
        </div>

        <form onSubmit={onSubmit} className="space-y-3">
          <input
            className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-100 placeholder-slate-600 focus:border-white/30 focus:outline-none"
            placeholder="Email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />

          <input
            className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-100 placeholder-slate-600 focus:border-white/30 focus:outline-none"
            placeholder="Password"
            type="password"
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />

          {mode === 'signup' && (
            <input
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-100 placeholder-slate-600 focus:border-white/30 focus:outline-none"
              placeholder="Confirm password"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
            />
          )}

          {err && <p className="text-sm text-red-400">{err}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-white py-3 text-sm font-semibold text-black hover:bg-slate-100 disabled:opacity-40 transition-colors"
          >
            {loading
              ? mode === 'signup' ? 'Creating account…' : 'Signing in…'
              : mode === 'signup' ? 'Create account' : 'Sign in'}
          </button>
        </form>

      </div>
    </main>
  );
}
