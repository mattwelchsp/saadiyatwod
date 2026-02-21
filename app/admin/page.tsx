'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabase';
import { detectWorkoutTypeFromWodText } from '../../lib/wodType';
import { todayInTZ } from '../../lib/timezone';
import BottomNav from '../../components/BottomNav';

function todayISO() { return todayInTZ(); }

export default function AdminPage() {
  const router = useRouter();
  const [authed, setAuthed] = useState(false);

  // Post WOD form
  const [wodDate, setWodDate] = useState(todayISO());
  const [wodText, setWodText] = useState('');
  const [typeOverride, setTypeOverride] = useState<'' | 'TIME' | 'AMRAP' | 'NO_SCORE'>('');
  const [isTeam, setIsTeam] = useState(false);
  const [teamSize, setTeamSize] = useState(2);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  // Scrape
  const [scraping, setScraping] = useState(false);
  const [scrapeMsg, setScrapeMsg] = useState<string | null>(null);
  const [scrapeErr, setScrapeErr] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) router.replace('/login');
      else setAuthed(true);
    });
  }, [router]);

  const detectedType = detectWorkoutTypeFromWodText(wodText);
  const typeColor: Record<string, string> = {
    TIME: 'text-blue-300 border-blue-500/30 bg-blue-500/10',
    AMRAP: 'text-orange-300 border-orange-500/30 bg-orange-500/10',
    NO_SCORE: 'text-slate-400 border-slate-500/30 bg-slate-500/10',
    UNKNOWN: 'text-slate-500 border-slate-500/20 bg-white/5',
  };

  const handleSave = async () => {
    if (!wodText.trim()) return;
    setSaving(true); setSaveMsg(null); setSaveErr(null);

    const payload: any = {
      wod_date: wodDate,
      wod_text: wodText.trim(),
      workout_type_override: typeOverride || null,
      is_team: isTeam,
      team_size: teamSize,
    };

    const { error } = await supabase.from('wods').upsert(payload, { onConflict: 'wod_date' });
    if (error) setSaveErr(error.message);
    else { setSaveMsg(`WOD saved for ${wodDate}.`); setWodText(''); setTypeOverride(''); setIsTeam(false); }
    setSaving(false);
  };

  const handleScrape = async () => {
    setScraping(true); setScrapeMsg(null); setScrapeErr(null);
    try {
      const res = await fetch('/api/scrape-wod');
      const json = await res.json();
      if (!res.ok) setScrapeErr(json.error ?? 'Scrape failed');
      else setScrapeMsg(`Done — saved ${json.saved} WOD(s) for: ${(json.dates ?? []).join(', ') || 'none'}`);
    } catch (e: any) {
      setScrapeErr(e.message ?? 'Network error');
    }
    setScraping(false);
  };

  if (!authed) return null;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-lg flex-col gap-5 bg-black px-4 py-10 pb-28 text-slate-100">

      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-white">Admin</h1>
      </div>

      {/* Auto-scrape */}
      <section className="rounded-2xl border border-white/10 bg-[#0a0f1e] p-5">
        <h2 className="mb-1 text-sm font-semibold text-slate-300">Auto-scrape from vfuae.com</h2>
        <p className="mb-4 text-xs text-slate-500">Runs automatically at 6 AM and 2 PM (UAE time). Trigger manually here to test.</p>
        <button
          onClick={handleScrape}
          disabled={scraping}
          className="rounded-xl bg-white px-5 py-2 text-sm font-semibold text-black hover:bg-slate-200 disabled:opacity-40"
        >
          {scraping ? 'Scraping...' : 'Scrape Now'}
        </button>
        {scrapeMsg && <p className="mt-3 text-sm text-green-400">{scrapeMsg}</p>}
        {scrapeErr && <p className="mt-3 text-sm text-red-400">{scrapeErr}</p>}
      </section>

      {/* Manual WOD post */}
      <section className="rounded-2xl border border-white/10 bg-[#0a0f1e] p-5">
        <h2 className="mb-4 text-sm font-semibold text-slate-300">Post / Edit WOD</h2>

        {/* Date */}
        <div className="mb-4">
          <label className="mb-1 block text-xs text-slate-500">Date</label>
          <input
            type="date" value={wodDate}
            onChange={(e) => { setWodDate(e.target.value); setSaveMsg(null); setSaveErr(null); }}
            className="w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-2 text-sm text-slate-100 focus:outline-none"
          />
        </div>

        {/* WOD text */}
        <div className="mb-4">
          <div className="mb-1 flex items-center justify-between">
            <label className="text-xs text-slate-500">WOD Text</label>
            {wodText.trim() && (
              <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${typeColor[detectedType]}`}>
                detected: {detectedType}
              </span>
            )}
          </div>
          <textarea
            value={wodText}
            onChange={(e) => { setWodText(e.target.value); setSaveMsg(null); setSaveErr(null); }}
            rows={8}
            placeholder={"For time:\n21-15-9\nThrusters (43/30kg)\nPull-ups"}
            className="w-full resize-none rounded-xl border border-white/10 bg-slate-900 px-4 py-3 text-sm text-slate-100 placeholder-slate-600 focus:outline-none"
          />
        </div>

        {/* Type override */}
        <div className="mb-4">
          <label className="mb-1 block text-xs text-slate-500">Workout type override <span className="text-slate-700">(leave blank to auto-detect)</span></label>
          <div className="flex gap-2">
            {(['', 'TIME', 'AMRAP', 'NO_SCORE'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTypeOverride(t)}
                className={`rounded-xl border px-3 py-1.5 text-xs font-medium transition-colors ${
                  typeOverride === t
                    ? 'border-white/30 bg-white/20 text-white'
                    : 'border-white/10 text-slate-500 hover:text-slate-300'
                }`}
              >
                {t || 'Auto'}
              </button>
            ))}
          </div>
        </div>

        {/* Team toggle */}
        <div className="mb-5 flex items-center gap-4">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox" checked={isTeam}
              onChange={(e) => setIsTeam(e.target.checked)}
              className="accent-white h-4 w-4"
            />
            Team WOD
          </label>
          {isTeam && (
            <div className="flex items-center gap-2">
              <label className="text-xs text-slate-500">Team size</label>
              <select
                value={teamSize}
                onChange={(e) => setTeamSize(Number(e.target.value))}
                className="rounded-lg border border-white/10 bg-slate-900 px-2 py-1 text-sm text-slate-100 focus:outline-none"
              >
                <option value={2}>2</option>
                <option value={3}>3</option>
              </select>
            </div>
          )}
        </div>

        <button
          onClick={handleSave}
          disabled={saving || !wodText.trim()}
          className="w-full rounded-xl bg-white py-2.5 text-sm font-semibold text-black hover:bg-slate-200 disabled:opacity-40"
        >
          {saving ? 'Saving...' : 'Save WOD'}
        </button>
        {saveMsg && <p className="mt-3 text-sm text-green-400">{saveMsg}</p>}
        {saveErr && <p className="mt-3 text-sm text-red-400">{saveErr}</p>}
      </section>

      <BottomNav />
    </main>
  );
}
