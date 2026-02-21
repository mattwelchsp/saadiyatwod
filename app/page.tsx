'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { detectWorkoutTypeFromWodText, WorkoutType } from '../lib/wodType';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// ── Types ──────────────────────────────────────────────────────────────────────

type Member = {
  id: string;
  display_name: string | null;
};

type ScoreEntry = {
  id: string;
  athlete_id: string;
  time_input: string | null;
  amrap_input: string | null;
  created_at: string;
  athlete_display_name: string | null;
};

// ── Sort helper ────────────────────────────────────────────────────────────────

function sortScores(rows: ScoreEntry[], workoutType: WorkoutType): ScoreEntry[] {
  const copy = [...rows];

  if (workoutType === 'TIME') {
    const toSeconds = (t: string | null): number => {
      if (!t) return Number.POSITIVE_INFINITY;
      const parts = t.trim().split(':').map(Number);
      if (parts.length !== 2 || parts.some(Number.isNaN)) return Number.POSITIVE_INFINITY;
      return parts[0] * 60 + parts[1];
    };
    copy.sort((a, b) => toSeconds(a.time_input) - toSeconds(b.time_input));
    return copy;
  }

  if (workoutType === 'AMRAP') {
    const parseAmrap = (v: string | null) => {
      if (!v) return { rounds: -1, reps: -1 };
      const s = v.trim();
      const plus = /^(\d+)\s*\+\s*(\d+)$/.exec(s);
      if (plus) return { rounds: Number(plus[1]), reps: Number(plus[2]) };
      const num = Number(s);
      if (!Number.isNaN(num)) return { rounds: 0, reps: num };
      return { rounds: -1, reps: -1 };
    };
    copy.sort((a, b) => {
      const av = parseAmrap(a.amrap_input);
      const bv = parseAmrap(b.amrap_input);
      if (av.rounds < 0 && bv.rounds < 0) return 0;
      if (av.rounds < 0) return 1;
      if (bv.rounds < 0) return -1;
      if (av.rounds !== bv.rounds) return bv.rounds - av.rounds;
      return bv.reps - av.reps;
    });
    return copy;
  }

  // NO_SCORE / UNKNOWN: newest-first
  return copy.sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
}

// ── Page component ─────────────────────────────────────────────────────────────

export default function HomePage() {
  const router = useRouter();

  const [meId, setMeId] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);

  const [members, setMembers] = useState<Member[]>([]);
  const [selectedAthleteId, setSelectedAthleteId] = useState<string | null>(null);

  const [score, setScore] = useState('');
  const [wodText, setWodText] = useState<string | null>(null);
  const [scores, setScores] = useState<ScoreEntry[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const workoutType = detectWorkoutTypeFromWodText(wodText);

  useEffect(() => {
    async function load() {
      const { data } = await supabase.auth.getUser();
      const user = data.user;

      if (!user) {
        router.replace('/login');
        return;
      }

      setMeId(user.id);
      setSelectedAthleteId(user.id);
      setEmail(user.email ?? null);

      const { data: profile } = await supabase
        .from('profiles')
        .select('display_name')
        .eq('id', user.id)
        .single();

      if (profile) setDisplayName(profile.display_name ?? null);

      const { data: allMembers } = await supabase
        .from('profiles')
        .select('id, display_name')
        .order('display_name', { ascending: true });

      const memberList = (allMembers ?? []) as Member[];
      setMembers(memberList);

      const { data: latestWod } = await supabase
        .from('wods')
        .select('wod_date, wod_text')
        .order('wod_date', { ascending: false })
        .limit(1)
        .single();

      if (latestWod?.wod_text) setWodText(latestWod.wod_text);

      if (!latestWod?.wod_date) return;

      const { data: scoreRows } = await supabase
        .from('scores')
        .select('id, athlete_id, time_input, amrap_input, created_at')
        .eq('wod_date', latestWod.wod_date)
        .order('created_at', { ascending: false });

      const nameById = new Map<string, string | null>(
        memberList.map((m) => [m.id, m.display_name])
      );

      const mapped: ScoreEntry[] = (scoreRows ?? []).map((r: any) => ({
        id: r.id,
        athlete_id: r.athlete_id,
        time_input: r.time_input ?? null,
        amrap_input: r.amrap_input ?? null,
        created_at: r.created_at,
        athlete_display_name: nameById.get(r.athlete_id) ?? null,
      }));

      setScores(sortScores(mapped, detectWorkoutTypeFromWodText(latestWod.wod_text)));
    }

    load();
  }, [router]);

  const handleSubmit = async () => {
    if (!score.trim() || !selectedAthleteId || !meId) return;
    if (workoutType === 'NO_SCORE' || workoutType === 'UNKNOWN') {
      setSubmitError('This workout type does not accept a score.');
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    setSuccessMsg(null);

    const { data: latestWod, error: wodErr } = await supabase
      .from('wods')
      .select('wod_date')
      .order('wod_date', { ascending: false })
      .limit(1)
      .single();

    if (wodErr || !latestWod?.wod_date) {
      setSubmitError('No WOD found. Add today\'s WOD first.');
      setSubmitting(false);
      return;
    }

    const wodDate = latestWod.wod_date;

    const insertPayload: any = {
      athlete_id: selectedAthleteId,
      entered_by: meId,
      submitted_by: meId,
      wod_date: wodDate,
      is_rx: true,
      is_team: false,
      time_input: null,
      amrap_input: null,
    };

    if (workoutType === 'TIME') {
      insertPayload.time_input = score.trim();
    } else {
      insertPayload.amrap_input = score.trim();
    }

    const { error: insertErr } = await supabase.from('scores').insert(insertPayload);

    if (insertErr) {
      setSubmitError(insertErr.message);
      setSubmitting(false);
      return;
    }

    setScore('');

    const athleteName =
      members.find((m) => m.id === selectedAthleteId)?.display_name ??
      displayName ??
      'Athlete';
    setSuccessMsg(`Stay hard, ${athleteName}!`);

    // Reload leaderboard
    const { data: scoreRows } = await supabase
      .from('scores')
      .select('id, athlete_id, time_input, amrap_input, created_at')
      .eq('wod_date', wodDate)
      .order('created_at', { ascending: false });

    const nameById = new Map<string, string | null>(
      members.map((m) => [m.id, m.display_name])
    );

    const mapped: ScoreEntry[] = (scoreRows ?? []).map((r: any) => ({
      id: r.id,
      athlete_id: r.athlete_id,
      time_input: r.time_input ?? null,
      amrap_input: r.amrap_input ?? null,
      created_at: r.created_at,
      athlete_display_name: nameById.get(r.athlete_id) ?? null,
    }));

    setScores(sortScores(mapped, workoutType));
    setSubmitting(false);
  };

  const fallbackName = email ? email.split('@')[0] : '';
  const userName = displayName ?? fallbackName;

  const todayLabel = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  const scoreLabel =
    workoutType === 'TIME'
      ? 'Time (MM:SS)'
      : workoutType === 'AMRAP'
      ? 'Score (rounds+reps, e.g. 5+12)'
      : null;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-6 px-6 py-12 pb-24 text-slate-100">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">SaadiyatWOD</h1>
          <p className="mt-1 text-sm text-slate-400">{todayLabel}</p>
        </div>
        <div className="text-sm font-medium text-slate-300">{userName}</div>
      </div>

      {/* WOD Card */}
      <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
        <h2 className="text-base font-semibold text-white">Today&apos;s WOD</h2>
        {wodText ? (
          <pre className="mt-3 whitespace-pre-wrap text-sm text-slate-200">{wodText}</pre>
        ) : (
          <p className="mt-3 text-sm text-slate-400">No WOD posted yet.</p>
        )}
        {workoutType !== 'UNKNOWN' && (
          <span className="mt-4 inline-block rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs font-medium text-slate-200">
            {workoutType}
          </span>
        )}
      </section>

      {/* Score Submission */}
      {scoreLabel && (
        <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
          <h2 className="text-base font-semibold text-white">Submit Score</h2>

          {/* Athlete selector */}
          {members.length > 1 && (
            <div className="mt-4">
              <label className="mb-1 block text-xs text-slate-400">Athlete</label>
              <select
                value={selectedAthleteId ?? ''}
                onChange={(e) => setSelectedAthleteId(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-2 text-sm text-slate-100 focus:outline-none"
              >
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.display_name ?? m.id}
                    {m.id === meId ? ' (me)' : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Score input */}
          <div className="mt-4">
            <label className="mb-1 block text-xs text-slate-400">{scoreLabel}</label>
            <input
              type="text"
              value={score}
              onChange={(e) => {
                setScore(e.target.value);
                setSuccessMsg(null);
                setSubmitError(null);
              }}
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
              placeholder={workoutType === 'TIME' ? '12:34' : '5+12'}
              className="w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none"
            />
          </div>

          <button
            onClick={handleSubmit}
            disabled={submitting || !score.trim()}
            className="mt-4 rounded-xl bg-white px-6 py-2 text-sm font-semibold text-black hover:bg-slate-200 disabled:opacity-40"
          >
            {submitting ? 'Saving...' : 'Submit'}
          </button>

          {successMsg && (
            <p className="mt-3 text-sm font-medium text-green-400">{successMsg}</p>
          )}
          {submitError && (
            <p className="mt-3 text-sm text-red-400">{submitError}</p>
          )}
        </section>
      )}

      {/* Leaderboard */}
      <section>
        <h2 className="mb-3 text-base font-semibold text-white">Today&apos;s Leaderboard</h2>

        {scores.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-white/5 px-6 py-8 text-center text-sm text-slate-400">
            No scores yet. Be the first to suffer.
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-white/10">
            <table className="w-full text-left text-sm">
              <thead className="bg-white/5 text-slate-400">
                <tr>
                  <th className="px-4 py-3 font-medium">#</th>
                  <th className="px-4 py-3 font-medium">Athlete</th>
                  <th className="px-4 py-3 text-right font-medium">Score</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {scores.map((s, idx) => {
                  const isMe = s.athlete_id === meId;
                  const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : null;
                  const scoreDisplay =
                    s.time_input ?? s.amrap_input ?? '—';
                  return (
                    <tr
                      key={s.id}
                      className={isMe ? 'bg-white/10' : 'hover:bg-white/5'}
                    >
                      <td className="px-4 py-3 text-slate-400">
                        {medal ?? idx + 1}
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-100">
                        {s.athlete_display_name ?? 'Unknown'}
                        {isMe && (
                          <span className="ml-2 text-xs text-slate-400">(you)</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-slate-100">
                        {scoreDisplay}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Bottom Nav */}
      <div className="fixed bottom-0 left-0 right-0 border-t border-white/10 bg-black/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-around px-6 py-3">
          <a href="/" className="text-sm font-semibold text-white">Home</a>
          <a href="/monthly" className="text-sm font-medium text-slate-300">Monthly</a>
          <a href="/admin" className="text-sm font-medium text-slate-300">Post WOD</a>
        </div>
      </div>

    </main>
  );
}
