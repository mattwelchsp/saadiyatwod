'use client';

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { detectWorkoutTypeFromWodText, parseTimeInput, formatSeconds, WorkoutType } from '../lib/wodType';
import { todayInTZ, formatDateDisplay, isSaturday, isSunday, shiftDate } from '../lib/timezone';
import BottomNav from '../components/BottomNav';

// ── Types ───────────────────────────────────────────────────────────────────

type Profile = { id: string; display_name: string | null; avatar_url: string | null };

type Wod = {
  wod_date: string;
  wod_text: string;
  workout_type_override: string | null;
  is_team: boolean;
  team_size: number;
};

type Score = {
  id: string;
  athlete_id: string;
  time_seconds: number | null;
  time_input: string | null;
  amrap_rounds: number | null;
  amrap_reps: number | null;
  amrap_input: string | null;
  is_rx: boolean;
  team_id: string | null;
  created_at: string;
  last_edited_at: string | null;
  display_name: string | null;
  avatar_url: string | null;
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function effectiveType(wod: Wod | null): WorkoutType {
  if (!wod) return 'UNKNOWN';
  return (wod.workout_type_override as WorkoutType | null) ?? detectWorkoutTypeFromWodText(wod.wod_text);
}

function scoreDisplay(s: Score, type: WorkoutType): string {
  if (type === 'TIME') {
    if (s.time_seconds != null) return formatSeconds(s.time_seconds);
    if (s.time_input) return s.time_input;
    return '—';
  }
  if (type === 'AMRAP') {
    if (s.amrap_rounds != null && s.amrap_reps != null) return `${s.amrap_rounds}+${s.amrap_reps}`;
    if (s.amrap_input) return s.amrap_input;
    return '—';
  }
  return '—';
}

function sortScores(rows: Score[], type: WorkoutType): Score[] {
  const copy = [...rows];
  if (type === 'TIME') return copy.sort((a, b) => (a.time_seconds ?? Infinity) - (b.time_seconds ?? Infinity));
  if (type === 'AMRAP') {
    return copy.sort((a, b) => {
      const av = (a.amrap_rounds ?? -1) * 10000 + (a.amrap_reps ?? -1);
      const bv = (b.amrap_rounds ?? -1) * 10000 + (b.amrap_reps ?? -1);
      return bv - av;
    });
  }
  return copy;
}

function canEdit(score: Score): boolean {
  if (score.last_edited_at) return false;
  return Date.now() - new Date(score.created_at).getTime() < 30 * 60 * 1000;
}

const MEDALS = ['🥇', '🥈', '🥉'];

function TypeBadge({ type }: { type: WorkoutType }) {
  if (type !== 'TIME' && type !== 'AMRAP') return null;
  return (
    <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${
      type === 'TIME' ? 'border-blue-500/30 bg-blue-500/10 text-blue-300'
                     : 'border-orange-500/30 bg-orange-500/10 text-orange-300'
    }`}>{type}</span>
  );
}

// ── Component ────────────────────────────────────────────────────────────────

export default function HomePage() {
  const today = todayInTZ();
  const tomorrow = shiftDate(today, 1);
  const saturday = isSaturday(today);
  const sunday = isSunday(today);

  const [meId, setMeId] = useState<string | null>(null);
  const [meProfile, setMeProfile] = useState<Profile | null>(null);
  const [members, setMembers] = useState<Profile[]>([]);
  const [wod, setWod] = useState<Wod | null>(null);
  const [tomorrowWod, setTomorrowWod] = useState<Wod | null>(null);
  const [scores, setScores] = useState<Score[]>([]);
  const [loading, setLoading] = useState(true);
  const [wodTab, setWodTab] = useState<'today' | 'tomorrow'>('today');

  // submission state
  const [isRx, setIsRx] = useState(true);
  const [timeInput, setTimeInput] = useState('');
  const [amrapRounds, setAmrapRounds] = useState('');
  const [amrapReps, setAmrapReps] = useState('');
  const [teamMates, setTeamMates] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitMsg, setSubmitMsg] = useState<string | null>(null);
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const type = effectiveType(wod);

  const loadData = useCallback(async () => {
    // Check auth — but don't redirect; everyone can view
    const { data: authData } = await supabase.auth.getUser();
    const user = authData.user ?? null;

    if (user) {
      setMeId(user.id);
      const [profileRes, membersRes] = await Promise.all([
        supabase.from('profiles').select('id, display_name, avatar_url').eq('id', user.id).single(),
        supabase.from('profiles').select('id, display_name, avatar_url').order('display_name'),
      ]);
      if (profileRes.data) setMeProfile(profileRes.data as Profile);
      if (membersRes.data) setMembers(membersRes.data as Profile[]);
    }

    // WODs (public)
    const [wodRes, tomorrowRes] = await Promise.all([
      supabase.from('wods').select('wod_date, wod_text, workout_type_override, is_team, team_size').eq('wod_date', today).maybeSingle(),
      supabase.from('wods').select('wod_date, wod_text, workout_type_override, is_team, team_size').eq('wod_date', tomorrow).maybeSingle(),
    ]);

    const todayWodData = wodRes.data as Wod | null;
    setWod(todayWodData);
    setTomorrowWod(tomorrowRes.data as Wod | null);

    // Scores (public — load names separately for display)
    if (todayWodData) {
      const [scoreRows, allProfiles] = await Promise.all([
        supabase.from('scores').select('id, athlete_id, time_seconds, time_input, amrap_rounds, amrap_reps, amrap_input, is_rx, team_id, created_at, last_edited_at').eq('wod_date', today),
        supabase.from('profiles').select('id, display_name, avatar_url'),
      ]);
      if (scoreRows.data) {
        const nameMap = new Map((allProfiles.data ?? []).map((m: any) => [m.id, m as Profile]));
        const mapped: Score[] = scoreRows.data.map((r: any) => ({
          ...r,
          display_name: nameMap.get(r.athlete_id)?.display_name ?? null,
          avatar_url: nameMap.get(r.athlete_id)?.avatar_url ?? null,
        }));
        setScores(sortScores(mapped, effectiveType(todayWodData)));
      }
    }

    setLoading(false);
  }, [today, tomorrow]);

  useEffect(() => { loadData(); }, [loadData]);

  const myScore = scores.find((s) => s.athlete_id === meId);
  const top3 = scores.slice(0, 3);

  const handleSubmit = async (editMode = false) => {
    if (!meId) return;
    setSubmitting(true); setSubmitErr(null); setSubmitMsg(null);

    let timeSeconds: number | null = null;
    let rounds: number | null = null;
    let reps: number | null = null;

    if (type === 'TIME') {
      const parsed = parseTimeInput(timeInput);
      if (parsed === null) { setSubmitErr('Enter time as mm:ss (e.g. 12:34)'); setSubmitting(false); return; }
      timeSeconds = parsed;
    } else if (type === 'AMRAP') {
      const r = parseInt(amrapRounds, 10);
      const e = parseInt(amrapReps, 10);
      if (isNaN(r) || isNaN(e)) { setSubmitErr('Enter whole numbers for rounds and reps'); setSubmitting(false); return; }
      rounds = r; reps = e;
    }

    const teamIds = wod?.is_team ? Array.from(new Set([meId, ...teamMates])) : [meId];
    if (wod?.is_team && teamIds.length < 2) { setSubmitErr('Select at least one teammate'); setSubmitting(false); return; }
    const teamId = wod?.is_team ? crypto.randomUUID() : null;

    let anyError = false;
    for (const athleteId of (wod?.is_team ? teamIds : [meId])) {
      const payload: any = {
        athlete_id: athleteId, entered_by: meId, submitted_by: meId,
        wod_date: today, is_rx: isRx, is_team: wod?.is_team ?? false, team_id: teamId,
        time_seconds: timeSeconds, time_input: timeSeconds != null ? timeInput : null,
        amrap_rounds: rounds, amrap_reps: reps,
        amrap_input: rounds != null ? `${rounds}+${reps}` : null,
      };
      if (editMode && myScore) {
        const { error } = await supabase.from('scores').update({ ...payload, last_edited_at: new Date().toISOString() }).eq('id', myScore.id);
        if (error) { setSubmitErr(error.message); anyError = true; break; }
      } else {
        const { error } = await supabase.from('scores').insert(payload);
        if (error) { setSubmitErr(error.message); anyError = true; break; }
      }
    }

    if (!anyError) {
      setSubmitMsg('✓ Stay hard — David Goggins');
      setTimeInput(''); setAmrapRounds(''); setAmrapReps(''); setEditing(false);
      await loadData();
    }
    setSubmitting(false);
  };

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-black">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-white" />
      </main>
    );
  }

  // ── Shared header ──────────────────────────────────────────────────────────
  const header = (
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-white">SaadiyatWOD</h1>
        <p className="mt-0.5 text-xs text-slate-500">{formatDateDisplay(today)}</p>
      </div>
      {meId ? (
        <a href="/me" className="flex items-center gap-2">
          {meProfile?.avatar_url ? (
            <img src={meProfile.avatar_url} alt="" className="h-8 w-8 rounded-full object-cover" />
          ) : (
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-xs font-bold text-white">
              {(meProfile?.display_name ?? '?')[0]?.toUpperCase()}
            </div>
          )}
          <span className="text-sm text-slate-300">{meProfile?.display_name ?? ''}</span>
        </a>
      ) : (
        <a href="/login" className="rounded-xl border border-white/20 px-4 py-1.5 text-sm font-medium text-slate-300 hover:bg-white/10 transition-colors">
          Log in
        </a>
      )}
    </div>
  );

  // ── Saturday ───────────────────────────────────────────────────────────────
  if (saturday) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-lg flex-col gap-5 bg-black px-4 py-10 pb-28 text-slate-100">
        {header}
        <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-center">
          <div className="text-4xl">💪</div>
          <p className="mt-3 text-xl font-bold text-white">Send It Saturday!</p>
          <p className="mt-1 text-sm text-slate-400">No leaderboard today — just vibes.</p>
        </div>
        <BottomNav />
      </main>
    );
  }

  // ── Sunday ─────────────────────────────────────────────────────────────────
  if (sunday) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-lg flex-col gap-5 bg-black px-4 py-10 pb-28 text-slate-100">
        {header}
        <WodCard wod={wod} tomorrowWod={tomorrowWod} tab={wodTab} onTabChange={setWodTab} type={type} />
        <div className="rounded-2xl border border-white/10 bg-white/5 p-5 text-center">
          <p className="text-sm font-semibold text-white">Leaderboard is Mon – Fri only</p>
          <p className="mt-1 text-xs text-slate-500">Get it done today. Compete tomorrow.</p>
        </div>
        <BottomNav />
      </main>
    );
  }

  // ── Weekday ────────────────────────────────────────────────────────────────
  const scoreable = type === 'TIME' || type === 'AMRAP';

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-lg flex-col gap-5 bg-black px-4 py-10 pb-28 text-slate-100">
      {header}

      {/* 1. Score submission — top of page */}
      {scoreable && wod && (
        <section className="rounded-2xl border border-white/10 bg-[#0a0f1e] p-5">
          {!meId ? (
            /* Logged-out state */
            <div className="flex flex-col items-center gap-3 py-2 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/5 text-xl">🔒</div>
              <div>
                <p className="text-sm font-semibold text-white">Log in to post your score</p>
                <p className="mt-0.5 text-xs text-slate-500">Track your results and compete on the leaderboard</p>
              </div>
              <a
                href="/login"
                className="mt-1 rounded-xl bg-white px-6 py-2 text-sm font-semibold text-black hover:bg-slate-200 transition-colors"
              >
                Log in
              </a>
            </div>
          ) : myScore && !editing ? (
            /* Already submitted */
            <>
              <h2 className="mb-3 text-sm font-semibold text-slate-300">Your Score</h2>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-2xl font-bold text-white">{scoreDisplay(myScore, type)}</p>
                  <p className="mt-0.5 text-xs text-slate-500">{myScore.is_rx ? 'Rx' : 'Scaled'}</p>
                </div>
                {canEdit(myScore) && (
                  <button
                    onClick={() => { setEditing(true); setSubmitMsg(null); }}
                    className="rounded-xl border border-white/20 px-4 py-1.5 text-xs font-medium text-slate-300 hover:bg-white/10"
                  >
                    Edit (30 min)
                  </button>
                )}
              </div>
            </>
          ) : (
            /* Submission form */
            <>
              <h2 className="mb-4 text-sm font-semibold text-slate-300">
                {editing ? 'Edit Score' : 'Submit Score'}
              </h2>

              {/* Rx / Scaled */}
              <div className="mb-4 flex rounded-xl border border-white/10 p-0.5 text-sm">
                {['Rx', 'Scaled'].map((label) => (
                  <button
                    key={label}
                    onClick={() => setIsRx(label === 'Rx')}
                    className={`flex-1 rounded-lg py-1.5 font-medium transition-colors ${
                      (label === 'Rx') === isRx ? 'bg-white text-black' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {type === 'TIME' && (
                <input
                  type="text" value={timeInput}
                  onChange={(e) => setTimeInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSubmit(editing)}
                  placeholder="mm:ss"
                  className="w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-2.5 text-sm text-slate-100 placeholder-slate-600 focus:outline-none"
                />
              )}

              {type === 'AMRAP' && (
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="mb-1 block text-xs text-slate-500">Rounds</label>
                    <input type="number" min="0" value={amrapRounds} onChange={(e) => setAmrapRounds(e.target.value)} placeholder="0"
                      className="w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-2.5 text-sm text-slate-100 placeholder-slate-600 focus:outline-none" />
                  </div>
                  <div className="flex-1">
                    <label className="mb-1 block text-xs text-slate-500">Extra reps</label>
                    <input type="number" min="0" value={amrapReps} onChange={(e) => setAmrapReps(e.target.value)} placeholder="0"
                      className="w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-2.5 text-sm text-slate-100 placeholder-slate-600 focus:outline-none" />
                  </div>
                </div>
              )}

              {wod.is_team && (
                <div className="mt-4">
                  <label className="mb-2 block text-xs text-slate-500">Teammates (you are auto-included)</label>
                  <div className="max-h-40 overflow-y-auto rounded-xl border border-white/10 bg-slate-900 p-2">
                    {members.filter((m) => m.id !== meId).map((m) => (
                      <label key={m.id} className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 hover:bg-white/5">
                        <input type="checkbox" checked={teamMates.includes(m.id)}
                          onChange={(e) => {
                            if (e.target.checked) setTeamMates((p) => [...p, m.id]);
                            else setTeamMates((p) => p.filter((x) => x !== m.id));
                          }}
                          className="accent-white" />
                        <span className="text-sm text-slate-200">{m.display_name ?? m.id}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <button onClick={() => handleSubmit(editing)} disabled={submitting}
                className="mt-4 w-full rounded-xl bg-white py-2.5 text-sm font-semibold text-black hover:bg-slate-200 disabled:opacity-40">
                {submitting ? 'Saving…' : editing ? 'Save Edit' : 'Submit Score'}
              </button>
              {editing && (
                <button onClick={() => setEditing(false)} className="mt-2 w-full text-xs text-slate-500 hover:text-slate-300">
                  Cancel
                </button>
              )}
            </>
          )}

          {submitMsg && <p className="mt-3 text-sm font-medium text-green-400">{submitMsg}</p>}
          {submitErr && <p className="mt-3 text-sm text-red-400">{submitErr}</p>}
        </section>
      )}

      {/* 2. Top 3 */}
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-500">Top 3 Today</h2>
        {!scoreable ? (
          <p className="text-sm text-slate-500">No leaderboard for this workout.</p>
        ) : top3.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-[#0a0f1e] px-6 py-8 text-center text-sm text-slate-500">
            Be the first to suffer.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {top3.map((s, idx) => (
              <div key={s.id} className={`flex items-center gap-3 rounded-2xl border px-4 py-3 ${
                s.athlete_id === meId ? 'border-white/20 bg-white/10' : 'border-white/10 bg-[#0a0f1e]'
              }`}>
                <span className="w-8 text-center text-xl">{MEDALS[idx]}</span>
                {s.avatar_url ? (
                  <img src={s.avatar_url} alt="" className="h-8 w-8 rounded-full object-cover" />
                ) : (
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-xs font-bold">
                    {(s.display_name ?? '?')[0]?.toUpperCase()}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-white">{s.display_name ?? 'Unknown'}</p>
                  <p className="text-xs text-slate-500">{s.is_rx ? 'Rx' : 'Scaled'}</p>
                </div>
                <span className="text-sm font-bold text-white">{scoreDisplay(s, type)}</span>
              </div>
            ))}
            {scores.length > 3 && (
              <a href="/leaderboard" className="mt-1 text-center text-xs text-slate-500 hover:text-slate-300">
                View full leaderboard →
              </a>
            )}
          </div>
        )}
      </section>

      {/* 3. WOD — with today/tomorrow toggle */}
      <WodCard wod={wod} tomorrowWod={tomorrowWod} tab={wodTab} onTabChange={setWodTab} type={type} />

      <BottomNav />
    </main>
  );
}

// ── WOD Card (shared between weekday + sunday) ────────────────────────────────

function WodCard({
  wod, tomorrowWod, tab, onTabChange, type,
}: {
  wod: Wod | null;
  tomorrowWod: Wod | null;
  tab: 'today' | 'tomorrow';
  onTabChange: (t: 'today' | 'tomorrow') => void;
  type: WorkoutType;
}) {
  const displayed = tab === 'today' ? wod : tomorrowWod;
  const displayedType = tab === 'today' ? type : effectiveType(tomorrowWod);
  const hasTomorrow = !!tomorrowWod;

  return (
    <section className="rounded-2xl border border-white/10 bg-[#0a0f1e] p-5">
      <div className="mb-3 flex items-center justify-between">
        {/* Today / Tomorrow toggle */}
        <div className="flex rounded-lg border border-white/10 p-0.5 text-xs">
          {(['today', 'tomorrow'] as const).map((t) => (
            <button
              key={t}
              onClick={() => onTabChange(t)}
              disabled={t === 'tomorrow' && !hasTomorrow}
              className={`rounded-md px-3 py-1 font-medium capitalize transition-colors ${
                tab === t
                  ? 'bg-white/15 text-white'
                  : 'text-slate-500 hover:text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        <TypeBadge type={displayedType} />
      </div>

      {displayed ? (
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-100">{displayed.wod_text}</p>
      ) : (
        <p className="text-sm text-slate-500">
          {tab === 'tomorrow' ? "Tomorrow's WOD hasn't been posted yet." : 'No WOD posted yet.'}
        </p>
      )}
    </section>
  );
}
