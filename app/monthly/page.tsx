'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type ScoreRow = {
  athlete_id: string;
  wod_date: string;
  time_input: string | null;
  amrap_input: string | null;
  profiles: { display_name: string | null } | null;
};

type MonthlyAgg = {
  athlete_id: string;
  display_name: string;
  gold: number;
  silver: number;
  bronze: number;
  points: number;
};

function getMonthRangeUtc(date = new Date()) {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const start = new Date(Date.UTC(year, month, 1));
  const end = new Date(Date.UTC(year, month + 1, 1));
  const toYmd = (d: Date) => d.toISOString().slice(0, 10);
  return { startYmd: toYmd(start), endYmd: toYmd(end) };
}

function parseTimeToSeconds(input: string): number | null {
  const match = /^(\d+):([0-5]\d)$/.exec(input.trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function parseAmrapToReps(input: string): number | null {
  const plusMatch = /^(\d+)\s*\+\s*(\d+)$/.exec(input.trim());
  if (plusMatch) return Number(plusMatch[1]) * 1000 + Number(plusMatch[2]);
  const numMatch = /^(\d+)$/.exec(input.trim());
  if (numMatch) return Number(numMatch[1]);
  return null;
}

function scoreToComparable(s: ScoreRow): { kind: 'TIME' | 'AMRAP' | 'NONE'; value: number | null } {
  if (s.time_input?.trim()) return { kind: 'TIME', value: parseTimeToSeconds(s.time_input) };
  if (s.amrap_input?.trim()) return { kind: 'AMRAP', value: parseAmrapToReps(s.amrap_input) };
  return { kind: 'NONE', value: null };
}

function computeLeaderboard(scores: ScoreRow[]): MonthlyAgg[] {
  const byDate = new Map<string, ScoreRow[]>();
  for (const s of scores) {
    if (!byDate.has(s.wod_date)) byDate.set(s.wod_date, []);
    byDate.get(s.wod_date)!.push(s);
  }

  const agg = new Map<string, MonthlyAgg>();
  const ensureAgg = (s: ScoreRow) => {
    if (!agg.has(s.athlete_id)) {
      agg.set(s.athlete_id, {
        athlete_id: s.athlete_id,
        display_name: s.profiles?.display_name ?? 'Unknown',
        gold: 0,
        silver: 0,
        bronze: 0,
        points: 0,
      });
    }
    return agg.get(s.athlete_id)!;
  };

  const award = (id: string, medal: 'gold' | 'silver' | 'bronze') => {
    const a = agg.get(id);
    if (!a) return;
    a[medal] += 1;
    a.points += medal === 'gold' ? 3 : medal === 'silver' ? 2 : 1;
  };

  for (const dayScores of byDate.values()) {
    const timeScores: { athlete_id: string; v: number }[] = [];
    const amrapScores: { athlete_id: string; v: number }[] = [];

    for (const s of dayScores) {
      ensureAgg(s);
      const comp = scoreToComparable(s);
      if (comp.kind === 'TIME' && comp.value !== null)
        timeScores.push({ athlete_id: s.athlete_id, v: comp.value });
      if (comp.kind === 'AMRAP' && comp.value !== null)
        amrapScores.push({ athlete_id: s.athlete_id, v: comp.value });
    }

    const useTime = timeScores.length >= amrapScores.length;
    const sorted = (useTime ? timeScores : amrapScores).sort((a, b) =>
      useTime ? a.v - b.v : b.v - a.v
    );

    const top = sorted.slice(0, 3);
    if (top[0]) award(top[0].athlete_id, 'gold');
    if (top[1]) award(top[1].athlete_id, 'silver');
    if (top[2]) award(top[2].athlete_id, 'bronze');
  }

  return Array.from(agg.values()).sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.gold !== a.gold) return b.gold - a.gold;
    if (b.silver !== a.silver) return b.silver - a.silver;
    if (b.bronze !== a.bronze) return b.bronze - a.bronze;
    return a.display_name.localeCompare(b.display_name);
  });
}

export default function MonthlyLeaderboardPage() {
  const router = useRouter();
  const [leaderboard, setLeaderboard] = useState<MonthlyAgg[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.replace('/login');
        return;
      }

      const { startYmd, endYmd } = getMonthRangeUtc();

      const { data: rows, error: fetchError } = await supabase
        .from('scores')
        .select(
          `
          athlete_id,
          wod_date,
          time_input,
          amrap_input,
          profiles:athlete_id ( display_name )
        `
        )
        .gte('wod_date', startYmd)
        .lt('wod_date', endYmd);

      if (fetchError) {
        setError(fetchError.message);
        setLoading(false);
        return;
      }

      setLeaderboard(computeLeaderboard((rows ?? []) as unknown as ScoreRow[]));
      setLoading(false);
    }

    load();
  }, [router]);

  const monthLabel = new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' });

  if (loading) {
    return (
      <main className="mx-auto min-h-screen w-full max-w-4xl px-6 py-12 text-slate-100">
        <p className="text-sm text-slate-400">Loading...</p>
      </main>
    );
  }

  if (error) {
    return (
      <main className="mx-auto min-h-screen w-full max-w-4xl px-6 py-12 text-slate-100">
        <h1 className="text-2xl font-semibold">Monthly Leaderboard</h1>
        <p className="mt-4 text-sm text-red-300">Error loading scores: {error}</p>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-4xl px-6 py-12 pb-24 text-slate-100">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Monthly Leaderboard</h1>
          <p className="mt-1 text-sm text-slate-300">{monthLabel} • Points: 3 / 2 / 1</p>
        </div>
        
          href="/"
          className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-200 hover:bg-white/10"
        >
          Back to Daily
        </a>
      </div>

      <div className="mt-8 overflow-hidden rounded-2xl border border-white/10">
        <table className="w-full text-left text-sm">
          <thead className="bg-white/5 text-slate-200">
            <tr>
              <th className="px-4 py-3">Rank</th>
              <th className="px-4 py-3">Athlete</th>
              <th className="px-4 py-3 text-center">🥇</th>
              <th className="px-4 py-3 text-center">🥈</th>
              <th className="px-4 py-3 text-center">🥉</th>
              <th className="px-4 py-3 text-right">Points</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {leaderboard.length === 0 ? (
              <tr>
                <td className="px-4 py-6 text-slate-300" colSpan={6}>
                  No scores this month yet. Be the first to suffer.
                </td>
              </tr>
            ) : (
              leaderboard.map((row, idx) => (
                <tr key={row.athlete_id} className="hover:bg-white/5">
                  <td className="px-4 py-3 text-slate-300">{idx + 1}</td>
                  <td className="px-4 py-3 font-medium">{row.display_name}</td>
                  <td className="px-4 py-3 text-center">{row.gold > 0 ? row.gold : '-'}</td>
                  <td className="px-4 py-3 text-center">{row.silver > 0 ? row.silver : '-'}</td>
                  <td className="px-4 py-3 text-center">{row.bronze > 0 ? row.bronze : '-'}</td>
                  <td className="px-4 py-3 text-right font-semibold">{row.points}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="fixed bottom-0 left-0 right-0 border-t border-white/10 bg-black/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-around px-6 py-3">
          <a href="/" className="text-sm font-medium text-slate-300">
            Home
          </a>
          <a href="/monthly" className="text-sm font-semibold text-white">
            Monthly
          </a>
        </div>
      </div>
    </main>
  );
}
