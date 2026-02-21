'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabase';
import { detectWorkoutTypeFromWodText, formatSeconds, WorkoutType } from '../../lib/wodType';
import { todayInTZ } from '../../lib/timezone';
import BottomNav from '../../components/BottomNav';

// ── Types ──────────────────────────────────────────────────────────────────────

type Profile = { id: string; display_name: string | null; avatar_url: string | null };

type ScoreRaw = {
  id: string;
  wod_date: string;
  athlete_id: string;
  time_seconds: number | null;
  time_input: string | null;
  amrap_rounds: number | null;
  amrap_reps: number | null;
  amrap_input: string | null;
  is_rx: boolean;
  team_id: string | null;
};

type WodRaw = {
  wod_date: string;
  wod_text: string;
  workout_type_override: string | null;
};

type AthletePoints = {
  id: string;
  display_name: string;
  avatar_url: string | null;
  gold: number;
  silver: number;
  bronze: number;
  total: number;
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function effectiveType(wod: WodRaw): WorkoutType {
  return (wod.workout_type_override as WorkoutType | null) ?? detectWorkoutTypeFromWodText(wod.wod_text);
}

/** Sort scores for a single WOD and return ranked athlete_ids in order */
function rankForDate(scores: ScoreRaw[], type: WorkoutType): string[][] {
  if (type === 'NO_SCORE' || type === 'UNKNOWN') return [];

  // De-dupe by athlete (first occurrence wins)
  const seen = new Set<string>();
  const unique = scores.filter((s) => {
    if (seen.has(s.athlete_id)) return false;
    seen.add(s.athlete_id);
    return true;
  });

  const sorted = [...unique].sort((a, b) => {
    if (type === 'TIME') {
      const as = a.time_seconds ?? Infinity;
      const bs = b.time_seconds ?? Infinity;
      return as - bs;
    }
    // AMRAP
    const av = (a.amrap_rounds ?? -1) * 10000 + (a.amrap_reps ?? -1);
    const bv = (b.amrap_rounds ?? -1) * 10000 + (b.amrap_reps ?? -1);
    return bv - av;
  });

  if (sorted.length === 0) return [];

  // Group ties into bands
  const ranks: string[][] = [];
  let i = 0;
  while (i < sorted.length) {
    const current = sorted[i];
    const band: string[] = [current.athlete_id];
    let j = i + 1;

    while (j < sorted.length) {
      const next = sorted[j];
      const tied =
        type === 'TIME'
          ? (current.time_seconds ?? Infinity) === (next.time_seconds ?? Infinity)
          : (current.amrap_rounds ?? -1) === (next.amrap_rounds ?? -1) &&
            (current.amrap_reps ?? -1) === (next.amrap_reps ?? -1);
      if (tied) { band.push(next.athlete_id); j++; }
      else break;
    }

    ranks.push(band);
    i = j;
  }

  return ranks.slice(0, 3); // only top 3 medal positions
}

function computePoints(
  wods: WodRaw[],
  allScores: ScoreRaw[],
  profiles: Profile[]
): AthletePoints[] {
  const profileMap = new Map(profiles.map((p) => [p.id, p]));
  const pointsMap = new Map<string, { gold: number; silver: number; bronze: number }>();

  const ensure = (id: string) => {
    if (!pointsMap.has(id)) pointsMap.set(id, { gold: 0, silver: 0, bronze: 0 });
    return pointsMap.get(id)!;
  };

  for (const wod of wods) {
    const type = effectiveType(wod);
    const scoresForDate = allScores.filter((s) => s.wod_date === wod.wod_date);

    // For team WODs, group by team_id and pick one representative per team
    const teamMap = new Map<string, ScoreRaw>();
    const individuals: ScoreRaw[] = [];
    for (const s of scoresForDate) {
      if (s.team_id) {
        if (!teamMap.has(s.team_id)) teamMap.set(s.team_id, s);
      } else {
        individuals.push(s);
      }
    }
    const representatives = [...Array.from(teamMap.values()), ...individuals];

    const rankBands = rankForDate(representatives, type);
    const pts = [3, 2, 1];

    rankBands.forEach((band, rankIdx) => {
      const p = pts[rankIdx] ?? 0;
      if (p === 0) return;

      for (const athleteId of band) {
        const rep = scoresForDate.find((s) => s.athlete_id === athleteId);
        if (!rep) continue;

        // For team scores, give points to ALL team members
        const teamMembers = rep.team_id
          ? scoresForDate.filter((s) => s.team_id === rep.team_id).map((s) => s.athlete_id)
          : [athleteId];

        for (const memberId of teamMembers) {
          const entry = ensure(memberId);
          if (p === 3) entry.gold++;
          else if (p === 2) entry.silver++;
          else entry.bronze++;
        }
      }
    });
  }

  const result: AthletePoints[] = [];
  pointsMap.forEach((pts, id) => {
    const profile = profileMap.get(id);
    result.push({
      id,
      display_name: profile?.display_name ?? 'Unknown',
      avatar_url: profile?.avatar_url ?? null,
      gold: pts.gold,
      silver: pts.silver,
      bronze: pts.bronze,
      total: pts.gold * 3 + pts.silver * 2 + pts.bronze,
    });
  });

  return result.sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total;
    if (b.gold !== a.gold) return b.gold - a.gold;
    if (b.silver !== a.silver) return b.silver - a.silver;
    if (b.bronze !== a.bronze) return b.bronze - a.bronze;
    return a.display_name.localeCompare(b.display_name);
  });
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function MonthlyPage() {
  const router = useRouter();
  const todayStr = todayInTZ();
  const [year, setYear] = useState(() => parseInt(todayStr.slice(0, 4)));
  const [month, setMonth] = useState(() => parseInt(todayStr.slice(5, 7)));
  const [meId, setMeId] = useState<string | null>(null);
  const [rows, setRows] = useState<AthletePoints[]>([]);
  const [loading, setLoading] = useState(true);

  const loadMonth = useCallback(async (y: number, m: number) => {
    setLoading(true);

    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) { router.replace('/login'); return; }
    setMeId(authData.user.id);

    const from = `${y}-${String(m).padStart(2, '0')}-01`;
    const lastDay = new Date(y, m, 0).getDate();
    const to = `${y}-${String(m).padStart(2, '0')}-${lastDay}`;

    const [wodsRes, scoresRes, profilesRes] = await Promise.all([
      supabase.from('wods').select('wod_date, wod_text, workout_type_override').gte('wod_date', from).lte('wod_date', to),
      supabase.from('scores').select('id, wod_date, athlete_id, time_seconds, time_input, amrap_rounds, amrap_reps, amrap_input, is_rx, team_id').gte('wod_date', from).lte('wod_date', to),
      supabase.from('profiles').select('id, display_name, avatar_url'),
    ]);

    const wods = (wodsRes.data ?? []) as WodRaw[];
    const scores = (scoresRes.data ?? []) as ScoreRaw[];
    const profiles = (profilesRes.data ?? []) as Profile[];

    setRows(computePoints(wods, scores, profiles));
    setLoading(false);
  }, [router]);

  useEffect(() => { loadMonth(year, month); }, [year, month, loadMonth]);

  const prevMonth = () => {
    if (month === 1) { setYear((y) => y - 1); setMonth(12); }
    else setMonth((m) => m - 1);
  };
  const nextMonth = () => {
    const nextIsAfterToday = (year === parseInt(todayStr.slice(0, 4)) && month >= parseInt(todayStr.slice(5, 7)));
    if (nextIsAfterToday) return;
    if (month === 12) { setYear((y) => y + 1); setMonth(1); }
    else setMonth((m) => m + 1);
  };

  const monthLabel = new Date(year, month - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const atMax = year === parseInt(todayStr.slice(0, 4)) && month >= parseInt(todayStr.slice(5, 7));

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-lg flex-col gap-5 bg-black px-4 py-10 pb-28 text-slate-100">

      {/* Month nav */}
      <div className="flex items-center justify-between">
        <button onClick={prevMonth} className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 text-slate-400 hover:text-white">‹</button>
        <p className="text-sm font-semibold text-white">{monthLabel}</p>
        <button onClick={nextMonth} disabled={atMax} className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 text-slate-400 hover:text-white disabled:opacity-30">›</button>
      </div>

      {/* Points key */}
      <div className="flex justify-center gap-4 text-xs text-slate-500">
        <span>🥇 = 3 pts</span>
        <span>🥈 = 2 pts</span>
        <span>🥉 = 1 pt</span>
      </div>

      {loading ? (
        <div className="flex flex-1 items-center justify-center py-20">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-white" />
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-white/10 bg-[#0a0f1e] px-6 py-10 text-center text-sm text-slate-500">
          No scores yet this month.
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-white/10">
          <table className="w-full text-left text-sm">
            <thead className="bg-white/5 text-xs text-slate-500">
              <tr>
                <th className="px-4 py-2.5">#</th>
                <th className="px-4 py-2.5">Athlete</th>
                <th className="px-3 py-2.5 text-center">🥇</th>
                <th className="px-3 py-2.5 text-center">🥈</th>
                <th className="px-3 py-2.5 text-center">🥉</th>
                <th className="px-4 py-2.5 text-right">Pts</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {rows.map((r, idx) => {
                const isMe = r.id === meId;
                return (
                  <tr key={r.id} className={isMe ? 'bg-white/10' : 'hover:bg-white/5'}>
                    <td className="w-10 px-4 py-3 text-slate-500 text-xs">{idx + 1}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        {r.avatar_url ? (
                          <img src={r.avatar_url} alt="" className="h-7 w-7 rounded-full object-cover" />
                        ) : (
                          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10 text-xs font-bold">
                            {(r.display_name ?? '?')[0]?.toUpperCase()}
                          </div>
                        )}
                        <span className={`font-medium ${isMe ? 'text-white' : 'text-slate-200'}`}>{r.display_name}</span>
                      </div>
                    </td>
                    <td className="px-3 py-3 text-center text-sm">{r.gold || '—'}</td>
                    <td className="px-3 py-3 text-center text-sm">{r.silver || '—'}</td>
                    <td className="px-3 py-3 text-center text-sm">{r.bronze || '—'}</td>
                    <td className="px-4 py-3 text-right font-bold text-white">{r.total}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <BottomNav />
    </main>
  );
}
