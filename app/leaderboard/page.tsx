'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabase';
import { detectWorkoutTypeFromWodText, formatSeconds, WorkoutType } from '../../lib/wodType';
import { todayInTZ, formatDateDisplay, isWeekend, shiftDate } from '../../lib/timezone';
import { QUOTES } from '../../lib/quotes';
import BottomNav from '../../components/BottomNav';

type Profile = { id: string; display_name: string | null; avatar_url: string | null };

type Wod = {
  wod_date: string;
  wod_text: string;
  workout_type_override: string | null;
  is_team: boolean;
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
  display_name: string | null;
  avatar_url: string | null;
};

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
  if (type === 'TIME') {
    return copy.sort((a, b) => (a.time_seconds ?? Infinity) - (b.time_seconds ?? Infinity));
  }
  if (type === 'AMRAP') {
    return copy.sort((a, b) => {
      const av = (a.amrap_rounds ?? -1) * 10000 + (a.amrap_reps ?? -1);
      const bv = (b.amrap_rounds ?? -1) * 10000 + (b.amrap_reps ?? -1);
      return bv - av;
    });
  }
  return copy;
}

/** Group scores by team_id (for team WOD display) */
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

const MEDALS = ['🥇', '🥈', '🥉'];

export default function LeaderboardPage() {
  const router = useRouter();
  const today = todayInTZ();

  const [meId, setMeId] = useState<string | null>(null);
  const [date, setDate] = useState(today);
  const [wod, setWod] = useState<Wod | null>(null);
  const [scores, setScores] = useState<Score[]>([]);
  const [loading, setLoading] = useState(true);
  const [quote] = useState(() => QUOTES[Math.floor(Math.random() * QUOTES.length)]);

  // Swipe handling
  const touchStartX = useRef<number | null>(null);
  const onTouchStart = (e: React.TouchEvent) => { touchStartX.current = e.touches[0].clientX; };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    if (Math.abs(dx) > 60) setDate((d) => shiftDate(d, dx < 0 ? 1 : -1));
    touchStartX.current = null;
  };

  const loadDate = useCallback(async (d: string) => {
    setLoading(true);

    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) { router.replace('/login'); return; }
    setMeId(authData.user.id);

    const [wodRes, membersRes] = await Promise.all([
      supabase.from('wods').select('wod_date, wod_text, workout_type_override, is_team').eq('wod_date', d).maybeSingle(),
      supabase.from('profiles').select('id, display_name, avatar_url'),
    ]);

    const wodData = wodRes.data as Wod | null;
    setWod(wodData);

    const nameMap = new Map((membersRes.data ?? []).map((m: any) => [m.id, m as Profile]));

    if (wodData) {
      const { data: scoreRows } = await supabase
        .from('scores')
        .select('id, athlete_id, time_seconds, time_input, amrap_rounds, amrap_reps, amrap_input, is_rx, team_id')
        .eq('wod_date', d);

      const mapped: Score[] = (scoreRows ?? []).map((r: any) => ({
        ...r,
        display_name: nameMap.get(r.athlete_id)?.display_name ?? null,
        avatar_url: nameMap.get(r.athlete_id)?.avatar_url ?? null,
      }));

      setScores(sortScores(mapped, effectiveType(wodData)));
    } else {
      setScores([]);
    }
    setLoading(false);
  }, [router]);

  useEffect(() => { loadDate(date); }, [date, loadDate]);

  const type = effectiveType(wod);
  const weekend = isWeekend(date);
  const isToday = date === today;

  return (
    <main
      className="mx-auto flex min-h-screen w-full max-w-lg flex-col gap-5 bg-black px-4 py-10 pb-28 text-slate-100"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/* Date nav */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => setDate((d) => shiftDate(d, -1))}
          className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 text-slate-400 hover:text-white"
        >
          ‹
        </button>
        <div className="text-center">
          <p className="text-sm font-semibold text-white">{formatDateDisplay(date)}</p>
          {isToday && <p className="text-xs text-slate-500">Today</p>}
        </div>
        <button
          onClick={() => setDate((d) => shiftDate(d, 1))}
          disabled={date >= today}
          className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 text-slate-400 hover:text-white disabled:opacity-30"
        >
          ›
        </button>
      </div>

      {loading ? (
        <div className="flex flex-1 items-center justify-center py-20">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-white" />
        </div>
      ) : weekend ? (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-center">
          <div className="text-3xl">🏖️</div>
          <p className="mt-3 text-sm text-slate-400">Weekend — no leaderboard.</p>
        </div>
      ) : !wod ? (
        <div className="rounded-2xl border border-white/10 bg-[#0a0f1e] px-6 py-8 text-center text-sm text-slate-500">
          No WOD for this date.
        </div>
      ) : (
        <>
          {/* WOD snippet */}
          <section className="rounded-2xl border border-white/10 bg-[#0a0f1e] p-4">
            <div className="mb-2 flex items-center gap-2">
              <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
                type === 'TIME' ? 'border-blue-500/30 bg-blue-500/10 text-blue-300' :
                type === 'AMRAP' ? 'border-orange-500/30 bg-orange-500/10 text-orange-300' :
                'border-slate-500/30 bg-slate-500/10 text-slate-400'
              }`}>{type}</span>
              {wod.is_team && <span className="rounded-full border border-purple-500/30 bg-purple-500/10 px-2 py-0.5 text-xs text-purple-300">TEAM</span>}
            </div>
            <pre className="whitespace-pre-wrap text-xs leading-relaxed text-slate-400">{wod.wod_text}</pre>
          </section>

          {/* Leaderboard */}
          {type === 'NO_SCORE' ? (
            <p className="text-center text-sm text-slate-500">No scores for this workout type.</p>
          ) : scores.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-[#0a0f1e] px-6 py-10 text-center text-sm text-slate-500">
              Be the first to suffer.
            </div>
          ) : wod.is_team ? (
            /* Team leaderboard */
            <div className="flex flex-col gap-2">
              {groupTeams(scores).map((group, idx) => {
                const representative = group[0];
                const isMyTeam = group.some((s) => s.athlete_id === meId);
                return (
                  <div key={representative.id} className={`rounded-2xl border px-4 py-3 ${isMyTeam ? 'border-white/20 bg-white/10' : 'border-white/10 bg-[#0a0f1e]'}`}>
                    <div className="flex items-center gap-3">
                      <span className="w-8 text-center text-xl">{MEDALS[idx] ?? idx + 1}</span>
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
                      </div>
                      <span className="text-sm font-bold text-white">{scoreDisplay(representative, type)}</span>
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
                        <td className="w-10 px-4 py-3 text-slate-400">
                          {MEDALS[idx] ?? idx + 1}
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
                              <p className="font-medium text-slate-100">{s.display_name ?? 'Unknown'}</p>
                              <p className="text-xs text-slate-600">{s.is_rx ? 'Rx' : 'Scaled'}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right font-bold text-white">
                          {scoreDisplay(s, type)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Rotating quote */}
          <div className="mt-2 text-center">
            <p className="text-xs italic text-slate-600">&ldquo;{quote.text}&rdquo;</p>
            <p className="mt-0.5 text-xs text-slate-700">— {quote.source}</p>
          </div>
        </>
      )}

      <BottomNav />
    </main>
  );
}
