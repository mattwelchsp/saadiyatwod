'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';
import { detectWorkoutTypeFromWodText } from '../../lib/wodType';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function AdminPage() {
  const router = useRouter();

  const [authed, setAuthed] = useState(false);
  const [wodDate, setWodDate] = useState(todayISO());
  const [wodText, setWodText] = useState('');
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const workoutType = detectWorkoutTypeFromWodText(wodText);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) {
        router.replace('/login');
      } else {
        setAuthed(true);
      }
    });
  }, [router]);

  const handleSave = async () => {
    if (!wodText.trim()) return;

    setSaving(true);
    setSuccessMsg(null);
    setErrorMsg(null);

    const { error } = await supabase
      .from('wods')
      .upsert({ wod_date: wodDate, wod_text: wodText.trim() }, { onConflict: 'wod_date' });

    if (error) {
      setErrorMsg(error.message);
    } else {
      setSuccessMsg(`WOD saved for ${wodDate}.`);
    }

    setSaving(false);
  };

  const typeColor: Record<string, string> = {
    TIME: 'text-blue-400 border-blue-400/30 bg-blue-400/10',
    AMRAP: 'text-orange-400 border-orange-400/30 bg-orange-400/10',
    NO_SCORE: 'text-slate-400 border-slate-400/30 bg-slate-400/10',
    UNKNOWN: 'text-slate-500 border-slate-500/20 bg-white/5',
  };

  if (!authed) return null;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 px-6 py-12 pb-24 text-slate-100">

      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Post WOD</h1>
        <a href="/" className="text-sm text-slate-400 hover:text-white">
          Back to Home
        </a>
      </div>

      {/* Date */}
      <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
        <label className="mb-2 block text-sm font-medium text-slate-300">Date</label>
        <input
          type="date"
          value={wodDate}
          onChange={(e) => {
            setWodDate(e.target.value);
            setSuccessMsg(null);
            setErrorMsg(null);
          }}
          className="w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-2 text-sm text-slate-100 focus:outline-none"
        />
      </section>

      {/* WOD Text */}
      <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
        <div className="mb-2 flex items-center justify-between">
          <label className="text-sm font-medium text-slate-300">WOD Text</label>
          {wodText.trim() && (
            <span className={`rounded-full border px-3 py-0.5 text-xs font-medium ${typeColor[workoutType]}`}>
              {workoutType}
            </span>
          )}
        </div>
        <textarea
          value={wodText}
          onChange={(e) => {
            setWodText(e.target.value);
            setSuccessMsg(null);
            setErrorMsg(null);
          }}
          rows={10}
          placeholder={"For time:\n21-15-9\nThrusters (43/30kg)\nPull-ups"}
          className="w-full resize-none rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-sm text-slate-100 placeholder-slate-600 focus:outline-none"
        />
        <p className="mt-2 text-xs text-slate-500">
          Paste the WOD exactly as posted. The workout type is detected automatically.
        </p>
      </section>

      {/* Save */}
      <button
        onClick={handleSave}
        disabled={saving || !wodText.trim()}
        className="rounded-xl bg-white px-6 py-3 text-sm font-semibold text-black hover:bg-slate-200 disabled:opacity-40"
      >
        {saving ? 'Saving...' : 'Save WOD'}
      </button>

      {successMsg && (
        <p className="text-sm font-medium text-green-400">{successMsg}</p>
      )}
      {errorMsg && (
        <p className="text-sm text-red-400">{errorMsg}</p>
      )}

      {/* Bottom Nav */}
      <div className="fixed bottom-0 left-0 right-0 border-t border-white/10 bg-black/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-around px-6 py-3">
          <a href="/" className="text-sm font-medium text-slate-300">Home</a>
          <a href="/monthly" className="text-sm font-medium text-slate-300">Monthly</a>
          <a href="/admin" className="text-sm font-semibold text-white">Post WOD</a>
        </div>
      </div>

    </main>
  );
}
