'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { detectWorkoutTypeFromWodText, parseTimeInput, formatSeconds, WorkoutType } from '../lib/wodType';
import {
  todayInTZ, formatDateDisplay, isSaturday, isSunday, isWeekend, shiftDate, isoWeekday,
} from '../lib/timezone';
import BottomNav from '../components/BottomNav';

// ── Types ────────────────────────────────────────────────────────────────────

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
  guest_names: string[];
  created_at: string;
  last_edited_at: string | null;
  display_name: string | null;
  avatar_url: string | null;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

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

function groupTeams(scores: Score[]): Score[][] {
  const groups = new Map<string, Score[]>();
  const solo: Score[] = [];
  for (const s of scores) {
    if (s.team_id) {
      const g = groups.get(s.team_id) ?? [];
      g.push(s);
      groups.set(s.team_id, g);
    } else {
      solo.push(s);
    }
  }
  const result: Score[][] = [];
  groups.forEach((g) => result.push(g));
  solo.forEach((s) => result.push([s]));
  return result;
}

function canEdit(score: Score): boolean {
  if (score.last_edited_at) return false;
  return Date.now() - new Date(score.created_at).getTime() < 30 * 60 * 1000;
}

/** Get the Monday of the week containing `dateStr`, then offset by `weekDelta` weeks. */
function getWeekDates(dateStr: string, weekDelta: number): string[] {
  const wd = isoWeekday(dateStr); // 1=Mon … 7=Sun
  const monday = shiftDate(dateStr, -(wd - 1) + weekDelta * 7);
  return Array.from({ length: 7 }, (_, i) => shiftDate(monday, i));
}

const MEDALS = ['🥇', '🥈', '🥉'];
const DAY_LABELS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

function TypeBadge({ type }: { type: WorkoutType }) {
  if (type !== 'TIME' && type !== 'AMRAP') return null;
  return (
    <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${
      type === 'TIME' ? 'border-blue-500/30 bg-blue-500/10 text-blue-300'
                     : 'border-orange-500/30 bg-orange-500/10 text-orange-300'
    }`}>{type}</span>
  );
}

// ── Teammate Picker ──────────────────────────────────────────────────────────

function TeammatePicker({
  members, meId, selected, onToggle, guestNames, onAddGuest, onRemoveGuest,
}: {
  members: Profile[]; meId: string; selected: string[];
  onToggle: (id: string) => void; guestNames: string[];
  onAddGuest: (name: string) => void; onRemoveGuest: (name: string) => void;
}) {
  const [showGuestInput, setShowGuestInput] = useState(false);
  const [guestInput, setGuestInput] = useState('');

  const commitGuest = () => {
    const name = guestInput.trim();
    if (name && !guestNames.includes(name)) onAddGuest(name);
    setGuestInput('');
  };

  return (
    <div className="mt-4 space-y-3">
      <p className="text-xs text-slate-500">Teammates <span className="text-slate-600">(you are auto-included)</span></p>

      {members.filter((m) => m.id !== meId).length > 0 && (
        <div className="max-h-48 overflow-y-auto space-y-1 rounded-xl border border-white/10 bg-slate-900 p-2">
          {members.filter((m) => m.id !== meId).map((m) => {
            const active = selected.includes(m.id);
            return (
              <button key={m.id} type="button" onClick={() => onToggle(m.id)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors ${active ? 'bg-white/15' : 'hover:bg-white/5'}`}>
                {m.avatar_url ? (
                  <img src={m.avatar_url} alt="" className="h-7 w-7 flex-shrink-0 rounded-full object-cover" />
                ) : (
                  <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-bold text-white">
                    {(m.display_name ?? '?')[0]?.toUpperCase()}
                  </div>
                )}
                <span className={`flex-1 text-sm ${active ? 'font-semibold text-white' : 'text-slate-300'}`}>
                  {m.display_name ?? m.id}
                </span>
                {active && (
                  <svg className="h-4 w-4 flex-shrink-0 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}

      {guestNames.map((name) => (
        <div key={name} className="flex items-center justify-between rounded-lg border border-white/10 bg-slate-900 px-3 py-2">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-xs font-bold text-slate-400">
              {name[0]?.toUpperCase()}
            </div>
            <span className="text-sm text-slate-300">{name}</span>
            <span className="rounded-full border border-white/10 px-1.5 py-0.5 text-xs text-slate-500">guest</span>
          </div>
          <button type="button" onClick={() => onRemoveGuest(name)} className="text-slate-600 hover:text-slate-300">✕</button>
        </div>
      ))}

      {!showGuestInput ? (
        <button type="button" onClick={() => setShowGuestInput(true)}
          className="text-xs text-slate-500 hover:text-slate-300 underline underline-offset-2">
          + Partner not in the app?
        </button>
      ) : (
        <div className="flex gap-2">
          <input type="text" autoFocus value={guestInput}
            onChange={(e) => setGuestInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitGuest(); } }}
            placeholder="Their name (e.g. Sara K.)"
            className="flex-1 rounded-xl border border-white/10 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none" />
          <button type="button" onClick={commitGuest}
            className="rounded-xl bg-white/10 px-3 py-2 text-sm font-medium text-white hover:bg-white/20">Add</button>
          <button type="button" onClick={() => { setShowGuestInput(false); setGuestInput(''); }}
            className="rounded-xl px-3 py-2 text-sm text-slate-500 hover:text-slate-300">Cancel</button>
        </div>
      )}
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function HomePage() {
  const today = todayInTZ();
  const tomorrow = shiftDate(today, 1);

  // Calendar state
  const [selectedDate, setSelectedDate] = useState(today);
  const [weekDelta, setWeekDelta] = useState(0); // 0 = week containing today
  const [wodDates, setWodDates] = useState<Set<string>>(new Set());

  // Auth + profile
  const [meId, setMeId] = useState<string | null>(null);
  const [meProfile, setMeProfile] = useState<Profile | null>(null);
  const [members, setMembers] = useState<Profile[]>([]);

  // Data for selected date
  const [wod, setWod] = useState<Wod | null>(null);
  const [tomorrowWod, setTomorrowWod] = useState<Wod | null>(null);
  const [scores, setScores] = useState<Score[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [initialLoading, setInitialLoading] = useState(true);

  // WOD tab (only relevant when selectedDate === today)
  const [wodTab, setWodTab] = useState<'today' | 'tomorrow'>('today');

  // Score submission
  const [isRx, setIsRx] = useState(true);
  const [timeInput, setTimeInput] = useState('');
  const [amrapRounds, setAmrapRounds] = useState('');
  const [amrapReps, setAmrapReps] = useState('');
  const [teamMates, setTeamMates] = useState<string[]>([]);
  const [guestNames, setGuestNames] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submitMsg, setSubmitMsg] = useState<string | null>(null);
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  // One-time auth + member load
  useEffect(() => {
    (async () => {
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
    })();
  }, []);

  // Load WOD dates for the visible week (for calendar dots)
  const weekDates = getWeekDates(today, weekDelta);
  useEffect(() => {
    const from = weekDates[0];
    const to = weekDates[6];
    supabase.from('wods').select('wod_date').gte('wod_date', from).lte('wod_date', to)
      .then(({ data }) => {
        if (data) setWodDates(new Set(data.map((r: any) => r.wod_date)));
      });
  }, [weekDelta]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load WOD + scores whenever selectedDate changes
  const loadDateData = useCallback(async (date: string) => {
    setDataLoading(true);
    setSubmitMsg(null); setSubmitErr(null);

    const [wodRes, scoreRows, allProfiles] = await Promise.all([
      supabase.from('wods').select('wod_date, wod_text, workout_type_override, is_team, team_size').eq('wod_date', date).maybeSingle(),
      supabase.from('scores').select('id, athlete_id, time_seconds, time_input, amrap_rounds, amrap_reps, amrap_input, is_rx, team_id, guest_names, created_at, last_edited_at').eq('wod_date', date),
      supabase.from('profiles').select('id, display_name, avatar_url'),
    ]);

    const wodData = wodRes.data as Wod | null;
    setWod(wodData);

    // Also load tomorrow's WOD for the preview tab (only relevant when date === today)
    if (date === today) {
      supabase.from('wods').select('wod_date, wod_text, workout_type_override, is_team, team_size').eq('wod_date', tomorrow).maybeSingle()
        .then(({ data }) => setTomorrowWod(data as Wod | null));
    } else {
      setTomorrowWod(null);
    }

    if (scoreRows.data) {
      const nameMap = new Map((allProfiles.data ?? []).map((m: any) => [m.id, m as Profile]));
      const mapped: Score[] = scoreRows.data.map((r: any) => ({
        ...r,
        guest_names: r.guest_names ?? [],
        display_name: nameMap.get(r.athlete_id)?.display_name ?? null,
        avatar_url: nameMap.get(r.athlete_id)?.avatar_url ?? null,
      }));
      setScores(sortScores(mapped, effectiveType(wodData)));
    } else {
      setScores([]);
    }

    setDataLoading(false);
    setInitialLoading(false);
  }, [today, tomorrow]);

  useEffect(() => { loadDateData(selectedDate); }, [selectedDate, loadDateData]);

  const type = effectiveType(wod);
  const myScore = scores.find((s) => s.athlete_id === meId);
  const isToday = selectedDate === today;

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

    if (wod?.is_team) {
      const totalPartners = teamMates.length + guestNames.filter((n) => n.trim()).length;
      if (totalPartners < 1) {
        setSubmitErr('Add at least one teammate or guest partner');
        setSubmitting(false);
        return;
      }
    }

    const teamIds = wod?.is_team ? Array.from(new Set([meId, ...teamMates])) : [meId];
    const teamId = wod?.is_team ? crypto.randomUUID() : null;
    const cleanGuests = guestNames.filter((n) => n.trim());

    let anyError = false;
    for (const athleteId of (wod?.is_team ? teamIds : [meId])) {
      const payload: any = {
        athlete_id: athleteId, entered_by: meId, submitted_by: meId,
        wod_date: today, is_rx: isRx, is_team: wod?.is_team ?? false, team_id: teamId,
        time_seconds: timeSeconds, time_input: timeSeconds != null ? timeInput : null,
        amrap_rounds: rounds, amrap_reps: reps,
        amrap_input: rounds != null ? `${rounds}+${reps}` : null,
        guest_names: cleanGuests,
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
      setTimeInput(''); setAmrapRounds(''); setAmrapReps('');
      setTeamMates([]); setGuestNames([]); setEditing(false);
      await loadDateData(today);
    }
    setSubmitting(false);
  };

  const selectDate = (d: string) => {
    setSelectedDate(d);
    setWodTab('today');
    setEditing(false);
    setTeamMates([]); setGuestNames([]);
  };

  if (initialLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-black">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-white" />
      </main>
    );
  }

  // ── Header ──────────────────────────────────────────────────────────────────
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

  // ── Calendar strip ──────────────────────────────────────────────────────────
  const canGoForward = weekDelta < 0 || weekDates.some((d) => d <= tomorrow);
  const isCurrentWeek = weekDelta === 0;

  const calendar = (
    <div className="rounded-2xl border border-white/10 bg-[#0a0f1e] px-3 py-3">
      <div className="flex items-center gap-1">
        {/* Prev week */}
        <button onClick={() => setWeekDelta((w) => w - 1)}
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-white/10 hover:text-white transition-colors">
          ‹
        </button>

        {/* Day cells */}
        <div className="flex flex-1 justify-around">
          {weekDates.map((d, i) => {
            const isSelected = d === selectedDate;
            const isTodayCell = d === today;
            const isFuture = d > tomorrow;
            const weekend = isWeekend(d);
            const hasWod = wodDates.has(d);

            return (
              <button
                key={d}
                disabled={isFuture}
                onClick={() => selectDate(d)}
                className={`flex flex-col items-center gap-0.5 rounded-xl px-2 py-1.5 transition-colors ${
                  isSelected
                    ? 'bg-white text-black'
                    : isFuture
                    ? 'cursor-not-allowed opacity-25'
                    : weekend
                    ? 'text-slate-600 hover:bg-white/5 hover:text-slate-400'
                    : 'text-slate-400 hover:bg-white/10 hover:text-white'
                }`}
              >
                <span className="text-xs font-medium">{DAY_LABELS[i]}</span>
                <span className={`text-sm font-bold leading-none ${isSelected ? 'text-black' : ''}`}>
                  {d.slice(8)}
                </span>
                {/* dot: today indicator (when not selected) or WOD exists */}
                <span className="h-1 w-1 rounded-full mt-0.5">
                  {!isSelected && isTodayCell ? (
                    <span className="block h-1 w-1 rounded-full bg-white" />
                  ) : !isSelected && hasWod ? (
                    <span className={`block h-1 w-1 rounded-full ${weekend ? 'bg-slate-600' : 'bg-slate-400'}`} />
                  ) : null}
                </span>
              </button>
            );
          })}
        </div>

        {/* Next week */}
        <button
          onClick={() => setWeekDelta((w) => w + 1)}
          disabled={isCurrentWeek}
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-white/10 hover:text-white transition-colors disabled:opacity-20 disabled:cursor-not-allowed">
          ›
        </button>
      </div>
    </div>
  );

  // ── Weekend view (when selected date is a weekend) ──────────────────────────
  const selectedIsWeekend = isWeekend(selectedDate);
  const selectedIsSaturday = isSaturday(selectedDate);

  if (selectedIsWeekend) {
    const weekendType = effectiveType(wod);
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-lg flex-col gap-5 bg-black px-4 py-10 pb-28 text-slate-100">
        {header}
        {calendar}
        <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-center">
          {selectedIsSaturday ? (
            <>
              <div className="text-4xl">💪</div>
              <p className="mt-3 text-xl font-bold text-white">Send It Saturday!</p>
              <p className="mt-1 text-sm text-slate-400">No leaderboard today — just vibes.</p>
            </>
          ) : (
            <>
              <div className="text-4xl">🛌</div>
              <p className="mt-3 text-xl font-bold text-white">Rest Day</p>
              <p className="mt-1 text-sm text-slate-400">Leaderboard is Mon – Fri only.</p>
            </>
          )}
        </div>
        <WodCard
          wod={wod}
          tomorrowWod={isToday ? tomorrowWod : null}
          date={selectedDate}
          isToday={isToday}
          tab={wodTab}
          onTabChange={setWodTab}
          type={weekendType}
        />
        <BottomNav />
      </main>
    );
  }

  // ── Weekday view ─────────────────────────────────────────────────────────────
  const scoreable = type === 'TIME' || type === 'AMRAP';
  const displayedGroups = wod?.is_team ? groupTeams(scores) : scores.map((s) => [s]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-lg flex-col gap-5 bg-black px-4 py-10 pb-28 text-slate-100">
      {header}
      {calendar}

      {/* Score submission — only for today */}
      {isToday && scoreable && wod && (
        <section className="rounded-2xl border border-white/10 bg-[#0a0f1e] p-5">
          {!meId ? (
            <div className="flex flex-col items-center gap-3 py-2 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/5 text-xl">🔒</div>
              <div>
                <p className="text-sm font-semibold text-white">Log in to post your score</p>
                <p className="mt-0.5 text-xs text-slate-500">Track your results and compete on the leaderboard</p>
              </div>
              <a href="/login" className="mt-1 rounded-xl bg-white px-6 py-2 text-sm font-semibold text-black hover:bg-slate-200 transition-colors">
                Log in
              </a>
            </div>
          ) : myScore && !editing ? (
            <>
              <h2 className="mb-3 text-sm font-semibold text-slate-300">Your Score</h2>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-2xl font-bold text-white">{scoreDisplay(myScore, type)}</p>
                  <p className="mt-0.5 text-xs text-slate-500">{myScore.is_rx ? 'Rx' : 'Scaled'}</p>
                </div>
                {canEdit(myScore) && (
                  <button onClick={() => { setEditing(true); setSubmitMsg(null); }}
                    className="rounded-xl border border-white/20 px-4 py-1.5 text-xs font-medium text-slate-300 hover:bg-white/10">
                    Edit (30 min)
                  </button>
                )}
              </div>
            </>
          ) : (
            <>
              <h2 className="mb-4 text-sm font-semibold text-slate-300">
                {editing ? 'Edit Score' : 'Submit Score'}
              </h2>
              <div className="mb-4 flex rounded-xl border border-white/10 p-0.5 text-sm">
                {['Rx', 'Scaled'].map((label) => (
                  <button key={label} onClick={() => setIsRx(label === 'Rx')}
                    className={`flex-1 rounded-lg py-1.5 font-medium transition-colors ${
                      (label === 'Rx') === isRx ? 'bg-white text-black' : 'text-slate-400 hover:text-white'
                    }`}>
                    {label}
                  </button>
                ))}
              </div>
              {type === 'TIME' && (
                <input type="text" value={timeInput} onChange={(e) => setTimeInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSubmit(editing)}
                  placeholder="mm:ss"
                  className="w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-2.5 text-sm text-slate-100 placeholder-slate-600 focus:outline-none" />
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
                <TeammatePicker members={members} meId={meId}
                  selected={teamMates}
                  onToggle={(id) => setTeamMates((p) => p.includes(id) ? p.filter((x) => x !== id) : [...p, id])}
                  guestNames={guestNames}
                  onAddGuest={(name) => setGuestNames((p) => [...p, name])}
                  onRemoveGuest={(name) => setGuestNames((p) => p.filter((n) => n !== name))} />
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

      {/* Leaderboard */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-slate-500">Leaderboard</h2>
          {!isToday && (
            <span className="text-xs text-slate-600">{formatDateDisplay(selectedDate)}</span>
          )}
        </div>

        {dataLoading ? (
          <div className="flex justify-center py-8">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/20 border-t-white" />
          </div>
        ) : !scoreable ? (
          <p className="text-sm text-slate-500">No leaderboard for this workout type.</p>
        ) : displayedGroups.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-[#0a0f1e] px-6 py-8 text-center text-sm text-slate-500">
            {isToday ? 'Be the first to suffer.' : 'No scores posted for this day.'}
          </div>
        ) : wod?.is_team ? (
          /* Team leaderboard */
          <div className="flex flex-col gap-2">
            {displayedGroups.map((group, idx) => {
              const rep = group[0];
              const isMyGroup = group.some((s) => s.athlete_id === meId);
              const guests = rep.guest_names ?? [];
              return (
                <div key={rep.id} className={`rounded-2xl border px-4 py-3 ${isMyGroup ? 'border-white/20 bg-white/10' : 'border-white/10 bg-[#0a0f1e]'}`}>
                  <div className="flex items-center gap-3">
                    <span className="w-8 flex-shrink-0 text-center text-xl">{MEDALS[idx] ?? <span className="text-sm text-slate-500">{idx + 1}</span>}</span>
                    <div className="flex flex-1 flex-col gap-1">
                      {group.map((s) => (
                        <div key={s.id} className="flex items-center gap-2">
                          {s.avatar_url ? (
                            <img src={s.avatar_url} alt="" className="h-6 w-6 rounded-full object-cover" />
                          ) : (
                            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-white/10 text-xs font-bold">
                              {(s.display_name ?? '?')[0]?.toUpperCase()}
                            </div>
                          )}
                          <span className="text-sm text-slate-200">{s.display_name ?? 'Unknown'}</span>
                        </div>
                      ))}
                      {guests.map((g) => (
                        <div key={g} className="flex items-center gap-2">
                          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-white/5 text-xs text-slate-500">
                            {g[0]?.toUpperCase()}
                          </div>
                          <span className="text-sm text-slate-400">{g}</span>
                          <span className="text-xs text-slate-600">(guest)</span>
                        </div>
                      ))}
                      <span className="mt-0.5 text-xs text-slate-500">{rep.is_rx ? 'Rx' : 'Scaled'}</span>
                    </div>
                    <span className="flex-shrink-0 text-sm font-bold text-white">{scoreDisplay(rep, type)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* Individual leaderboard */
          <div className="overflow-hidden rounded-2xl border border-white/10">
            <table className="w-full text-left text-sm">
              <thead className="bg-white/5 text-xs text-slate-500">
                <tr>
                  <th className="px-4 py-2.5">#</th>
                  <th className="px-4 py-2.5">Athlete</th>
                  <th className="px-4 py-2.5 text-right">Score</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {scores.map((s, idx) => {
                  const isMe = s.athlete_id === meId;
                  return (
                    <tr key={s.id} className={isMe ? 'bg-white/10' : 'hover:bg-white/5'}>
                      <td className="w-10 px-4 py-3 text-slate-400 text-sm">
                        {MEDALS[idx] ?? <span className="text-xs text-slate-500">{idx + 1}</span>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          {s.avatar_url ? (
                            <img src={s.avatar_url} alt="" className="h-7 w-7 rounded-full object-cover" />
                          ) : (
                            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-xs font-bold">
                              {(s.display_name ?? '?')[0]?.toUpperCase()}
                            </div>
                          )}
                          <div>
                            <p className={`font-medium ${isMe ? 'text-white' : 'text-slate-100'}`}>{s.display_name ?? 'Unknown'}</p>
                            <p className="text-xs text-slate-600">{s.is_rx ? 'Rx' : 'Scaled'}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-bold text-white">{scoreDisplay(s, type)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* WOD */}
      <WodCard
        wod={wod}
        tomorrowWod={isToday ? tomorrowWod : null}
        date={selectedDate}
        isToday={isToday}
        tab={wodTab}
        onTabChange={setWodTab}
        type={type}
      />

      <BottomNav />
    </main>
  );
}

// ── WOD Card ─────────────────────────────────────────────────────────────────

function WodCard({
  wod, tomorrowWod, date, isToday, tab, onTabChange, type,
}: {
  wod: Wod | null;
  tomorrowWod: Wod | null;
  date: string;
  isToday: boolean;
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
        <div className="flex items-center gap-3">
          {isToday ? (
            /* Today: show today/tomorrow toggle */
            <div className="flex rounded-lg border border-white/10 p-0.5 text-xs">
              {(['today', 'tomorrow'] as const).map((t) => (
                <button key={t} onClick={() => onTabChange(t)}
                  disabled={t === 'tomorrow' && !hasTomorrow}
                  className={`rounded-md px-3 py-1 font-medium capitalize transition-colors ${
                    tab === t ? 'bg-white/15 text-white' : 'text-slate-500 hover:text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed'
                  }`}>
                  {t}
                </button>
              ))}
            </div>
          ) : (
            /* Past date: show the date label */
            <span className="text-xs font-medium text-slate-400">
              WOD · {formatDateDisplay(date)}
            </span>
          )}
        </div>
        <TypeBadge type={displayedType} />
      </div>

      {displayed ? (
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-100">{displayed.wod_text}</p>
      ) : (
        <p className="text-sm text-slate-500">
          {tab === 'tomorrow' ? "Tomorrow's WOD hasn't been posted yet." : 'No WOD posted for this day.'}
        </p>
      )}
    </section>
  );
}
