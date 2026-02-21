// app/monthly/page.tsx
import { redirect } from "next/navigation";
import { getSupabaseEnv } from "@/lib/env";
import { createClient } from '@supabase/supabase-js';

const { url: supabaseUrl, anonKey: supabaseAnonKey } = getSupabaseEnv();

type ScoreRow = {
athlete_id: string;
wod_date: string; // YYYY-MM-DD
time_input: string | null;
amrap_input: string | null;
profiles: {
display_name: string | null;
}[] | null;
};

function getMonthRangeUtc(date = new Date()) {
const year = date.getUTCFullYear();
const month = date.getUTCMonth(); // 0-11
const start = new Date(Date.UTC(year, month, 1));
const end = new Date(Date.UTC(year, month + 1, 1)); // exclusive
const toYmd = (d: Date) => d.toISOString().slice(0, 10);
return { startYmd: toYmd(start), endYmd: toYmd(end) };
}

function parseTimeToSeconds(input: string): number | null {
// supports mm:ss or m:ss
const trimmed = input.trim();
const match = /^(\d+):([0-5]\d)$/.exec(trimmed);
if (!match) return null;
const mins = Number(match[1]);
const secs = Number(match[2]);
if (!Number.isFinite(mins) || !Number.isFinite(secs)) return null;
return mins * 60 + secs;
}

function parseAmrapToReps(input: string): number | null {
// supports "5+12" meaning 5 rounds + 12 reps (assumes 1 round = 100 reps is NOT correct)
// Since your app already has AMRAP sorting logic elsewhere, we keep it simple:
// If it’s "rounds+reps", convert to rounds*1000 + reps so rounds dominate ordering.
// If it’s a plain number, treat it as reps.
const trimmed = input.trim();

const plusMatch = /^(\d+)\s*+\s*(\d+)$/.exec(trimmed);
if (plusMatch) {
const rounds = Number(plusMatch[1]);
const reps = Number(plusMatch[2]);
if (!Number.isFinite(rounds) || !Number.isFinite(reps)) return null;
return rounds * 1000 + reps;
}

const numMatch = /^(\d+)$/.exec(trimmed);
if (numMatch) {
const reps = Number(numMatch[1]);
if (!Number.isFinite(reps)) return null;
return reps;
}

return null;
}

function scoreToComparable(s: ScoreRow): { kind: "TIME" | "AMRAP" | "NONE"; value: number | null } {
if (s.time_input && s.time_input.trim().length > 0) {
return { kind: "TIME", value: parseTimeToSeconds(s.time_input) };
}
if (s.amrap_input && s.amrap_input.trim().length > 0) {
return { kind: "AMRAP", value: parseAmrapToReps(s.amrap_input) };
}
return { kind: "NONE", value: null };
}

type MonthlyAgg = {
athlete_id: string;
display_name: string;
gold: number;
silver: number;
bronze: number;
points: number;
};

export default async function MonthlyLeaderboardPage() {
const supabase = createClient(supabaseUrl, supabaseAnonKey);

const {
data: { user },
} = await supabase.auth.getUser();

if (!user) redirect("/login");

const { startYmd, endYmd } = getMonthRangeUtc(new Date());

// Pull all scores for the month, plus each athlete's display_name
const { data: rows, error } = await supabase
.from("scores")
.select(
athlete_id, wod_date, time_input, amrap_input, profiles:athlete_id ( display_name )
)
.gte("wod_date", startYmd)
.lt("wod_date", endYmd);

if (error) {
return (
<main className="mx-auto min-h-screen w-full max-w-4xl px-6 py-12 text-slate-100">
<h1 className="text-2xl font-semibold">Monthly Leaderboard</h1>
<p className="mt-4 text-sm text-red-300">Error loading scores: {error.message}</p>
</main>
);
}

const scores = (rows ?? []) as ScoreRow[];

// Group scores by date
const byDate = new Map<string, ScoreRow[]>();
for (const s of scores) {
if (!byDate.has(s.wod_date)) byDate.set(s.wod_date, []);
byDate.get(s.wod_date)!.push(s);
}

// Aggregate medals per athlete
const agg = new Map<string, MonthlyAgg>();
const ensureAgg = (s: ScoreRow) => {
const id = s.athlete_id;
if (!agg.has(id)) {
agg.set(id, {
athlete_id: id,
display_name: s.profiles?.[0]?.display_name ?? "Unknown",
gold: 0,
silver: 0,
bronze: 0,
points: 0,
});
}
return agg.get(id)!;
};

// Medal points: 3/2/1 (default)
const award = (athleteId: string, medal: "gold" | "silver" | "bronze") => {
const a = agg.get(athleteId);
if (!a) return;
if (medal === "gold") {
a.gold += 1;
a.points += 3;
} else if (medal === "silver") {
a.silver += 1;
a.points += 2;
} else {
a.bronze += 1;
a.points += 1;
}
};

for (const [date, dayScores] of byDate.entries()) {
// Partition into TIME and AMRAP buckets based on which field is present
const timeScores: { athlete_id: string; v: number }[] = [];
const amrapScores: { athlete_id: string; v: number }[] = [];

for (const s of dayScores) {
  ensureAgg(s);

  const comp = scoreToComparable(s);
  if (comp.kind === "TIME" && comp.value !== null) timeScores.push({ athlete_id: s.athlete_id, v: comp.value });
  if (comp.kind === "AMRAP" && comp.value !== null) amrapScores.push({ athlete_id: s.athlete_id, v: comp.value });
}

// If both exist for a date (shouldn’t happen), prefer whichever has more entries
const useTime = timeScores.length >= amrapScores.length;

const sorted = (useTime ? timeScores : amrapScores).sort((a, b) => {
  // TIME: lower is better. AMRAP: higher is better.
  if (useTime) return a.v - b.v;
  return b.v - a.v;
});

// Top 3 (ties ignored for now; we’ll improve later)
const top = sorted.slice(0, 3);

if (top[0]) award(top[0].athlete_id, "gold");
if (top[1]) award(top[1].athlete_id, "silver");
if (top[2]) award(top[2].athlete_id, "bronze");
}

const leaderboard = Array.from(agg.values()).sort((a, b) => {
if (b.points !== a.points) return b.points - a.points;
// tie-breaker: more gold, then silver, then bronze, then name
if (b.gold !== a.gold) return b.gold - a.gold;
if (b.silver !== a.silver) return b.silver - a.silver;
if (b.bronze !== a.bronze) return b.bronze - a.bronze;
return a.display_name.localeCompare(b.display_name);
});

const monthLabel = new Date().toLocaleString("en-US", { month: "long", year: "numeric" });

return (
<main className="mx-auto min-h-screen w-full max-w-4xl px-6 py-12 text-slate-100">
<div className="flex items-end justify-between gap-4">
<div>
<h1 className="text-2xl font-semibold">Monthly Leaderboard</h1>
<p className="mt-1 text-sm text-slate-300">{monthLabel} • Points: 3 / 2 / 1</p>
</div>

    <a
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
          <th className="px-4 py-3 text-right">Total Points</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-white/10">
        {leaderboard.length === 0 ? (
          <tr>
            <td className="px-4 py-6 text-slate-300" colSpan={6}>
              No scores this month yet.
            </td>
          </tr>
        ) : (
          leaderboard.map((row, idx) => (
            <tr key={row.athlete_id} className="bg-black/0">
              <td className="px-4 py-3 text-slate-300">{idx + 1}</td>
              <td className="px-4 py-3 font-medium">{row.display_name}</td>
              <td className="px-4 py-3 text-center">{row.gold}</td>
              <td className="px-4 py-3 text-center">{row.silver}</td>
              <td className="px-4 py-3 text-center">{row.bronze}</td>
              <td className="px-4 py-3 text-right font-semibold">{row.points}</td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  </div>

  <p className="mt-6 text-xs text-slate-400">
    Note: ties aren’t handled yet (we’ll fix this next). Also, this page infers TIME vs AMRAP per day based on which
    score type is present.
  </p>
</main>
);
}
