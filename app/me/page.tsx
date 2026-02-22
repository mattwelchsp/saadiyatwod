'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabase';
import { detectWorkoutTypeFromWodText, formatSeconds, WorkoutType } from '../../lib/wodType';
import BottomNav from '../../components/BottomNav';

// ── Types ─────────────────────────────────────────────────────────────────────

type RecentScore = {
  wod_date: string;
  time_seconds: number | null;
  time_input: string | null;
  amrap_rounds: number | null;
  amrap_reps: number | null;
  amrap_input: string | null;
  is_rx: boolean;
  wod_text: string | null;
  workout_type_override: string | null;
};

type ScoreRaw = {
  wod_date: string;
  athlete_id: string;
  time_seconds: number | null;
  amrap_rounds: number | null;
  amrap_reps: number | null;
  team_id: string | null;
};

type WodRaw = {
  wod_date: string;
  wod_text: string;
  workout_type_override: string | null;
};

type AllTimeStats = {
  wodsLogged: number;
  dailyGold: number;
  dailySilver: number;
  dailyBronze: number;
  monthlyFirst: number;
  monthlySecond: number;
  monthlyThird: number;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function scoreDisplay(s: RecentScore): string {
  const type: WorkoutType = (s.workout_type_override as WorkoutType | null) ?? detectWorkoutTypeFromWodText(s.wod_text);
  if (type === 'TIME') {
    if (s.time_seconds != null) return formatSeconds(s.time_seconds);
    if (s.time_input) return s.time_input;
  }
  if (type === 'AMRAP') {
    if (s.amrap_rounds != null && s.amrap_reps != null) return `${s.amrap_rounds}+${s.amrap_reps}`;
    if (s.amrap_input) return s.amrap_input;
  }
  return '—';
}

function getEffectiveType(wod: WodRaw): WorkoutType {
  return (wod.workout_type_override as WorkoutType | null) ?? detectWorkoutTypeFromWodText(wod.wod_text);
}

/** Rank all scores for one WOD date. Returns [[1st place ids], [2nd], [3rd]] */
function rankForDate(scores: ScoreRaw[], type: WorkoutType): string[][] {
  if (type === 'NO_SCORE' || type === 'UNKNOWN') return [];

  // De-dupe by athlete, one rep per team
  const seen = new Set<string>();
  const teamMap = new Map<string, ScoreRaw>();
  const individuals: ScoreRaw[] = [];
  for (const s of scores) {
    if (s.team_id) {
      if (!teamMap.has(s.team_id)) teamMap.set(s.team_id, s);
    } else {
      if (!seen.has(s.athlete_id)) { seen.add(s.athlete_id); individuals.push(s); }
    }
  }
  const reps = [...Array.from(teamMap.values()), ...individuals];

  const sorted = [...reps].sort((a, b) => {
    if (type === 'TIME') return (a.time_seconds ?? Infinity) - (b.time_seconds ?? Infinity);
    const av = (a.amrap_rounds ?? -1) * 10000 + (a.amrap_reps ?? -1);
    const bv = (b.amrap_rounds ?? -1) * 10000 + (b.amrap_reps ?? -1);
    return bv - av;
  });

  if (sorted.length === 0) return [];

  const bands: string[][] = [];
  let i = 0;
  while (i < sorted.length && bands.length < 3) {
    const cur = sorted[i];
    const band: string[] = [];
    let j = i;
    while (j < sorted.length) {
      const next = sorted[j];
      const tied = type === 'TIME'
        ? (cur.time_seconds ?? Infinity) === (next.time_seconds ?? Infinity)
        : (cur.amrap_rounds ?? -1) === (next.amrap_rounds ?? -1) && (cur.amrap_reps ?? -1) === (next.amrap_reps ?? -1);
      if (!tied && j > i) break;
      // For team scores, expand to all team members
      if (next.team_id) {
        scores.filter((s) => s.team_id === next.team_id).forEach((s) => band.push(s.athlete_id));
      } else {
        band.push(next.athlete_id);
      }
      j++;
    }
    bands.push([...new Set(band)]);
    i = j;
  }
  return bands;
}

/** Compute points per athlete for a set of wods + scores. Returns map: athleteId → {gold,silver,bronze} */
function computeMonthlyPoints(
  wods: WodRaw[],
  scores: ScoreRaw[]
): Map<string, { gold: number; silver: number; bronze: number; total: number }> {
  const map = new Map<string, { gold: number; silver: number; bronze: number; total: number }>();
  const ensure = (id: string) => {
    if (!map.has(id)) map.set(id, { gold: 0, silver: 0, bronze: 0, total: 0 });
    return map.get(id)!;
  };

  for (const wod of wods) {
    const type = getEffectiveType(wod);
    const dayScores = scores.filter((s) => s.wod_date === wod.wod_date);
    const bands = rankForDate(dayScores, type);
    const pts = [3, 2, 1];
    bands.forEach((band, idx) => {
      const p = pts[idx] ?? 0;
      if (!p) return;
      for (const id of band) {
        const e = ensure(id);
        if (p === 3) e.gold++;
        else if (p === 2) e.silver++;
        else e.bronze++;
        e.total += p;
      }
    });
  }
  return map;
}

/** Compute all-time stats for a given athlete from raw data */
function computeStats(
  uid: string,
  myDates: string[],
  allScores: ScoreRaw[],
  allWods: WodRaw[]
): AllTimeStats {
  const wodMap = new Map(allWods.map((w) => [w.wod_date, w]));

  // WODs logged = distinct dates the user posted a score
  const wodsLogged = myDates.length;

  // Daily medals
  let dailyGold = 0, dailySilver = 0, dailyBronze = 0;
  for (const date of myDates) {
    const wod = wodMap.get(date);
    if (!wod) continue;
    const type = getEffectiveType(wod);
    const dayScores = allScores.filter((s) => s.wod_date === date);
    const bands = rankForDate(dayScores, type);
    if (bands[0]?.includes(uid)) dailyGold++;
    else if (bands[1]?.includes(uid)) dailySilver++;
    else if (bands[2]?.includes(uid)) dailyBronze++;
  }

  // Monthly podiums — for each month where user was active, compute full standings
  const currentMonth = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' }).slice(0, 7);
  // Only count completed months — the current month isn't finalised yet
  const completedMonths = [...new Set(myDates.map((d) => d.slice(0, 7)))].filter((m) => m < currentMonth);
  let monthlyFirst = 0, monthlySecond = 0, monthlyThird = 0;

  for (const month of completedMonths) {
    const monthWods = allWods.filter((w) => w.wod_date.startsWith(month));
    const monthScores = allScores.filter((s) => s.wod_date.startsWith(month));
    const pointsMap = computeMonthlyPoints(monthWods, monthScores);

    const ranked = [...pointsMap.entries()]
      .filter(([, v]) => v.total > 0)
      .sort(([, a], [, b]) => {
        if (b.total !== a.total) return b.total - a.total;
        if (b.gold !== a.gold) return b.gold - a.gold;
        if (b.silver !== a.silver) return b.silver - a.silver;
        return b.bronze - a.bronze;
      });

    const myRank = ranked.findIndex(([id]) => id === uid);
    if (myRank === 0) monthlyFirst++;
    else if (myRank === 1) monthlySecond++;
    else if (myRank === 2) monthlyThird++;
  }

  return { wodsLogged, dailyGold, dailySilver, dailyBronze, monthlyFirst, monthlySecond, monthlyThird };
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function MePage() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [userId, setUserId] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [recentScores, setRecentScores] = useState<RecentScore[]>([]);
  const [stats, setStats] = useState<AllTimeStats | null>(null);

  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: authData } = await supabase.auth.getUser();
      if (!authData.user) { router.replace('/login'); return; }

      const uid = authData.user.id;
      setUserId(uid);

      // Profile
      const { data: profile } = await supabase
        .from('profiles').select('display_name, avatar_url').eq('id', uid).single();
      if (profile) {
        setDisplayName(profile.display_name ?? '');
        setAvatarUrl(profile.avatar_url ?? null);
      }

      // User's own scores (all time) for date list + recent display
      const { data: myScoreRows } = await supabase
        .from('scores')
        .select('wod_date, time_seconds, time_input, amrap_rounds, amrap_reps, amrap_input, is_rx')
        .eq('athlete_id', uid)
        .order('wod_date', { ascending: false });

      if (!myScoreRows || myScoreRows.length === 0) return;

      const myDates = [...new Set(myScoreRows.map((s: any) => s.wod_date as string))];

      // WODs for all their dates
      const { data: wodRows } = await supabase
        .from('wods')
        .select('wod_date, wod_text, workout_type_override')
        .in('wod_date', myDates);

      const wodMap = new Map((wodRows ?? []).map((w: any) => [w.wod_date, w]));

      // Recent scores (last 20) with WOD info
      setRecentScores(
        myScoreRows.slice(0, 20).map((s: any) => ({
          ...s,
          wod_text: wodMap.get(s.wod_date)?.wod_text ?? null,
          workout_type_override: wodMap.get(s.wod_date)?.workout_type_override ?? null,
        }))
      );

      // All scores for all their active dates (for ranking)
      const { data: allScoreRows } = await supabase
        .from('scores')
        .select('wod_date, athlete_id, time_seconds, amrap_rounds, amrap_reps, team_id')
        .in('wod_date', myDates);

      if (allScoreRows && wodRows) {
        const computedStats = computeStats(
          uid,
          myDates,
          allScoreRows as ScoreRaw[],
          wodRows as WodRaw[]
        );
        setStats(computedStats);
      }
    })();
  }, [router]);

  const handleSaveName = async () => {
    if (!userId) return;
    setSaving(true); setMsg(null); setErr(null);
    const { error } = await supabase
      .from('profiles')
      .update({ display_name: displayName.trim() })
      .eq('id', userId);
    if (error) setErr(error.message);
    else setMsg('Saved!');
    setSaving(false);
  };

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!userId || !e.target.files?.[0]) return;
    const file = e.target.files[0];
    setUploading(true); setMsg(null); setErr(null);

    const ext = file.name.split('.').pop();
    const path = `${userId}/avatar.${ext}`;

    const { error: uploadErr } = await supabase.storage.from('avatars').upload(path, file, { upsert: true });
    if (uploadErr) { setErr(uploadErr.message); setUploading(false); return; }

    const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path);
    const publicUrl = `${urlData.publicUrl}?t=${Date.now()}`;

    const { error: updateErr } = await supabase.from('profiles').update({ avatar_url: publicUrl }).eq('id', userId);
    if (updateErr) setErr(updateErr.message);
    else { setAvatarUrl(publicUrl); setMsg('Avatar updated!'); }
    setUploading(false);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.replace('/login');
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-lg flex-col gap-5 bg-black px-4 py-10 pb-28 text-slate-100">

      <h1 className="text-xl font-bold text-white">My Profile</h1>

      {/* Avatar + name header */}
      <section className="flex items-center gap-5 rounded-2xl border border-white/10 bg-[#0a0f1e] p-5">
        <button onClick={() => fileRef.current?.click()} className="relative flex-shrink-0">
          {avatarUrl ? (
            <img src={avatarUrl} alt="" className="h-20 w-20 rounded-full object-cover" />
          ) : (
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-white/10 text-2xl font-bold text-white">
              {displayName[0]?.toUpperCase() ?? '?'}
            </div>
          )}
          <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 opacity-0 hover:opacity-100 transition-opacity">
            <span className="text-xs text-white">{uploading ? '...' : 'Change'}</span>
          </div>
        </button>
        <div>
          <p className="font-semibold text-white">{displayName || 'Set your name below'}</p>
          <p className="mt-0.5 text-xs text-slate-500">Tap photo to change avatar</p>
        </div>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
      </section>

      {/* All-time stats */}
      {stats && (
        <section className="rounded-2xl border border-white/10 bg-[#0a0f1e] p-5">
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-widest text-slate-500">All-Time</h2>

          {/* WODs logged */}
          <div className="mb-4 flex items-baseline justify-between border-b border-white/5 pb-4">
            <span className="text-sm text-slate-400">WODs logged</span>
            <span className="text-2xl font-bold text-white">{stats.wodsLogged}</span>
          </div>

          {/* Daily medals */}
          <p className="mb-2 text-xs text-slate-600 uppercase tracking-wider">Daily</p>
          <div className="mb-4 grid grid-cols-3 gap-3 border-b border-white/5 pb-4">
            {[
              { label: '🥇 1st', value: stats.dailyGold },
              { label: '🥈 2nd', value: stats.dailySilver },
              { label: '🥉 3rd', value: stats.dailyBronze },
            ].map(({ label, value }) => (
              <div key={label} className="rounded-xl bg-white/5 px-3 py-3 text-center">
                <p className="text-lg">{label}</p>
                <p className="mt-1 text-xl font-bold text-white">{value}</p>
              </div>
            ))}
          </div>

          {/* Monthly podiums */}
          <p className="mb-2 text-xs text-slate-600 uppercase tracking-wider">Monthly</p>
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: '🥇 1st', value: stats.monthlyFirst },
              { label: '🥈 2nd', value: stats.monthlySecond },
              { label: '🥉 3rd', value: stats.monthlyThird },
            ].map(({ label, value }) => (
              <div key={label} className="rounded-xl bg-white/5 px-3 py-3 text-center">
                <p className="text-lg">{label}</p>
                <p className="mt-1 text-xl font-bold text-white">{value}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Display name */}
      <section className="rounded-2xl border border-white/10 bg-[#0a0f1e] p-5">
        <label className="mb-2 block text-sm font-medium text-slate-300">
          Display name <span className="text-slate-600">(first name + last initial, e.g. Matt W.)</span>
        </label>
        <input
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSaveName()}
          placeholder="Matt W."
          className="w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-2.5 text-sm text-slate-100 placeholder-slate-600 focus:outline-none"
        />
        <button onClick={handleSaveName} disabled={saving}
          className="mt-3 rounded-xl bg-white px-5 py-2 text-sm font-semibold text-black hover:bg-slate-200 disabled:opacity-40">
          {saving ? 'Saving...' : 'Save'}
        </button>
        {msg && <p className="mt-2 text-sm text-green-400">{msg}</p>}
        {err && <p className="mt-2 text-sm text-red-400">{err}</p>}
      </section>

      {/* Recent scores */}
      {recentScores.length > 0 && (
        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-500">Recent Scores</h2>
          <div className="overflow-hidden rounded-2xl border border-white/10">
            <table className="w-full text-left text-sm">
              <tbody className="divide-y divide-white/5">
                {recentScores.map((s) => (
                  <tr key={s.wod_date} className="hover:bg-white/5">
                    <td className="px-4 py-3 text-slate-500 text-xs">{s.wod_date}</td>
                    <td className="px-4 py-3 font-bold text-white">{scoreDisplay(s)}</td>
                    <td className="px-4 py-3 text-right text-xs text-slate-600">{s.is_rx ? 'Rx' : 'Scaled'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Logout */}
      <button onClick={handleLogout}
        className="mt-2 rounded-xl border border-white/10 py-2.5 text-sm font-medium text-slate-400 hover:text-white">
        Log out
      </button>

      <BottomNav />
    </main>
  );
}
