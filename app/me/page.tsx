'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Cropper from 'react-easy-crop';
import { supabase } from '../../lib/supabase';
import { detectWorkoutTypeFromWodText, formatSeconds, WorkoutType } from '../../lib/wodType';
import BottomNav from '../../components/BottomNav';

// ── Image crop helper ──────────────────────────────────────────────────────────

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.addEventListener('load', () => resolve(img));
    img.addEventListener('error', reject);
    img.src = src;
  });
}

async function getCroppedBlob(
  imageSrc: string,
  pixelCrop: { x: number; y: number; width: number; height: number }
): Promise<Blob | null> {
  const image = await loadImage(imageSrc);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  canvas.width = 400;
  canvas.height = 400;
  ctx.drawImage(image, pixelCrop.x, pixelCrop.y, pixelCrop.width, pixelCrop.height, 0, 0, 400, 400);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.92));
}

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
  is_rx: boolean;
};

type WodRaw = {
  wod_date: string;
  wod_text: string;
  workout_type_override: string | null;
};

type PlacementPoint = { date: string; rank: number };

type AllTimeStats = {
  wodsLogged: number;
  dailyGold: number;
  dailySilver: number;
  dailyBronze: number;
  dailyGoldDates: string[];
  dailySilverDates: string[];
  dailyBronzeDates: string[];
  weeklyFirst: number;
  weeklySecond: number;
  weeklyThird: number;
  weeklyFirstWeeks: string[];
  weeklySecondWeeks: string[];
  weeklyThirdWeeks: string[];
  monthlyFirst: number;
  monthlySecond: number;
  monthlyThird: number;
  monthlyFirstMonths: string[];
  monthlySecondMonths: string[];
  monthlyThirdMonths: string[];
  placements: PlacementPoint[];
  avgPlace: number | null;
  avgPlaceMonth: number | null;
  thisMonthCount: number;
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
  if (type === 'CALORIES') {
    if (s.amrap_reps != null) return `${s.amrap_reps.toLocaleString()} cal`;
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
    // AMRAP and CALORIES: higher is better
    const av = (a.amrap_rounds ?? -1) * 10000 + (a.amrap_reps ?? -1);
    const bv = (b.amrap_rounds ?? -1) * 10000 + (b.amrap_reps ?? -1);
    return bv - av;
  });

  if (sorted.length === 0) return [];

  const bands: string[][] = [];
  let i = 0;
  let rank = 1;
  while (i < sorted.length && rank <= 3) {
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
    rank += band.length; // advance by tie group size, not just 1
    i = j;
  }
  return bands;
}

/** Compute points per athlete for a set of wods + scores. Returns map: athleteId → {gold,silver,bronze,total} */
function computeMonthlyPoints(
  wods: WodRaw[],
  scores: ScoreRaw[]
): Map<string, { gold: number; silver: number; bronze: number; total: number }> {
  const map = new Map<string, { gold: number; silver: number; bronze: number; total: number }>();
  const ensure = (id: string) => {
    if (!map.has(id)) map.set(id, { gold: 0, silver: 0, bronze: 0, total: 0 });
    return map.get(id)!;
  };

  // Build rxMap: athleteId → set of dates they submitted Rx on a scored WOD
  const rxMap = new Map<string, Set<string>>();
  for (const s of scores) {
    if (!s.is_rx || !s.athlete_id) continue;
    const wod = wods.find((w) => w.wod_date === s.wod_date);
    if (!wod) continue;
    const t = getEffectiveType(wod);
    if (t === 'NO_SCORE' || t === 'UNKNOWN') continue;
    if (!rxMap.has(s.athlete_id)) rxMap.set(s.athlete_id, new Set());
    rxMap.get(s.athlete_id)!.add(s.wod_date);
  }

  for (const wod of wods) {
    const type = getEffectiveType(wod);
    const dayScores = scores.filter((s) => s.wod_date === wod.wod_date);
    const bands = rankForDate(dayScores, type);
    let rank = 1;
    for (const band of bands) {
      const p = rank === 1 ? 3 : rank === 2 ? 2 : rank === 3 ? 1 : 0;
      if (!p) break;
      for (const id of band) {
        const e = ensure(id);
        if (p === 3) e.gold++;
        else if (p === 2) e.silver++;
        else e.bronze++;
        e.total += p;
      }
      rank += band.length;
    }
  }

  // Add Rx bonus: +0.5 per Rx submission per unique date
  for (const [id, dates] of rxMap) {
    const e = ensure(id);
    e.total += dates.size * 0.5;
  }

  return map;
}

/** Returns the Monday (YYYY-MM-DD) of the week containing dateStr */
function getWeekMonday(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  const day = d.getDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toLocaleDateString('en-CA');
}

/** Returns the Friday (YYYY-MM-DD) of the week starting on mondayStr */
function getWeekFriday(mondayStr: string): string {
  const d = new Date(mondayStr + 'T12:00:00');
  d.setDate(d.getDate() + 4);
  return d.toLocaleDateString('en-CA');
}

/** Returns a readable label like "Mar 3–7" for a week starting on mondayStr */
function formatWeekLabel(mondayStr: string): string {
  const mon = new Date(mondayStr + 'T12:00:00');
  const fri = new Date(mondayStr + 'T12:00:00');
  fri.setDate(fri.getDate() + 4);
  const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${fmt(mon)}–${fmt(fri)}`;
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

  // Daily medals: only count completed days (before today — today's WOD isn't over yet)
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' });
  const currentMonthStr = todayStr.slice(0, 7);
  const completedDates = myDates.filter((d) => d < todayStr);

  let dailyGold = 0, dailySilver = 0, dailyBronze = 0;
  const dailyGoldDates: string[] = [];
  const dailySilverDates: string[] = [];
  const dailyBronzeDates: string[] = [];
  const placements: PlacementPoint[] = [];

  for (const date of completedDates) {
    const wod = wodMap.get(date);
    if (!wod) continue;
    const type = getEffectiveType(wod);
    if (type === 'NO_SCORE' || type === 'UNKNOWN') continue;
    const dayScores = allScores.filter((s) => s.wod_date === date);
    const bands = rankForDate(dayScores, type);
    if (bands[0]?.includes(uid)) { dailyGold++; dailyGoldDates.push(date); placements.push({ date, rank: 1 }); }
    else if (bands[1]?.includes(uid)) { dailySilver++; dailySilverDates.push(date); placements.push({ date, rank: 2 }); }
    else if (bands[2]?.includes(uid)) { dailyBronze++; dailyBronzeDates.push(date); placements.push({ date, rank: 3 }); }
    else {
      // Rank beyond 3: count how many distinct better scores exist
      const myScoreRow = dayScores.find((s) => s.athlete_id === uid);
      if (myScoreRow) {
        let rank = 4;
        for (const s of dayScores) {
          if (s.athlete_id === uid) continue;
          if (type === 'TIME') {
            if ((s.time_seconds ?? Infinity) < (myScoreRow.time_seconds ?? Infinity)) rank++;
          } else {
            const sv = (s.amrap_rounds ?? -1) * 10000 + (s.amrap_reps ?? -1);
            const mv = (myScoreRow.amrap_rounds ?? -1) * 10000 + (myScoreRow.amrap_reps ?? -1);
            if (sv > mv) rank++;
          }
        }
        // Clamp so that rank 4 = "just outside medals"
        placements.push({ date, rank: Math.min(rank, 10) });
      }
    }
  }

  // Sort placements chronologically
  placements.sort((a, b) => a.date.localeCompare(b.date));

  // Average placement (only days with a ranked score)
  const avgPlace = placements.length > 0
    ? placements.reduce((sum, p) => sum + p.rank, 0) / placements.length
    : null;

  // Average placement this month only
  const monthPlacements = placements.filter((p) => p.date.startsWith(currentMonthStr));
  const avgPlaceMonth = monthPlacements.length > 0
    ? monthPlacements.reduce((sum, p) => sum + p.rank, 0) / monthPlacements.length
    : null;

  // This month count
  const thisMonthCount = myDates.filter((d) => d.startsWith(currentMonthStr)).length;

  // Monthly podiums — for each month where user was active, compute full standings
  const currentMonth = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' }).slice(0, 7);
  // Only count completed months — the current month isn't finalised yet
  const completedMonths = [...new Set(myDates.map((d) => d.slice(0, 7)))].filter((m) => m < currentMonth);
  let monthlyFirst = 0, monthlySecond = 0, monthlyThird = 0;
  const monthlyFirstMonths: string[] = [];
  const monthlySecondMonths: string[] = [];
  const monthlyThirdMonths: string[] = [];

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
    if (myRank === 0) { monthlyFirst++; monthlyFirstMonths.push(month); }
    else if (myRank === 1) { monthlySecond++; monthlySecondMonths.push(month); }
    else if (myRank === 2) { monthlyThird++; monthlyThirdMonths.push(month); }
  }

  // Weekly podiums — for each completed Mon–Fri week
  const weekMondaySet = new Set<string>();
  for (const d of myDates) {
    const day = new Date(d + 'T12:00:00').getDay();
    if (day >= 1 && day <= 5) weekMondaySet.add(getWeekMonday(d));
  }
  const completedWeeks = [...weekMondaySet]
    .filter((mon) => getWeekFriday(mon) < todayStr)
    .sort();

  let weeklyFirst = 0, weeklySecond = 0, weeklyThird = 0;
  const weeklyFirstWeeks: string[] = [];
  const weeklySecondWeeks: string[] = [];
  const weeklyThirdWeeks: string[] = [];

  for (const mon of completedWeeks) {
    const fri = getWeekFriday(mon);
    const weekWods = allWods.filter((w) => w.wod_date >= mon && w.wod_date <= fri);
    const weekScores = allScores.filter((s) => s.wod_date >= mon && s.wod_date <= fri);
    const pointsMap = computeMonthlyPoints(weekWods, weekScores);

    const ranked = [...pointsMap.entries()]
      .filter(([, v]) => v.total > 0)
      .sort(([, a], [, b]) => {
        if (b.total !== a.total) return b.total - a.total;
        if (b.gold !== a.gold) return b.gold - a.gold;
        if (b.silver !== a.silver) return b.silver - a.silver;
        return b.bronze - a.bronze;
      });

    const label = formatWeekLabel(mon);
    const myRankW = ranked.findIndex(([id]) => id === uid);
    if (myRankW === 0) { weeklyFirst++; weeklyFirstWeeks.push(label); }
    else if (myRankW === 1) { weeklySecond++; weeklySecondWeeks.push(label); }
    else if (myRankW === 2) { weeklyThird++; weeklyThirdWeeks.push(label); }
  }

  return {
    wodsLogged, dailyGold, dailySilver, dailyBronze,
    dailyGoldDates, dailySilverDates, dailyBronzeDates,
    weeklyFirst, weeklySecond, weeklyThird,
    weeklyFirstWeeks, weeklySecondWeeks, weeklyThirdWeeks,
    monthlyFirst, monthlySecond, monthlyThird,
    monthlyFirstMonths, monthlySecondMonths, monthlyThirdMonths,
    placements, avgPlace, avgPlaceMonth, thisMonthCount,
  };
}

// ── Placement Chart ───────────────────────────────────────────────────────────

function PlacementChart({ placements, limit }: { placements: PlacementPoint[]; limit: number }) {
  const visible = placements.slice(-limit);
  const W = 280, H = 80;
  const PAD = { top: 8, bottom: 24, left: 24, right: 8 };
  const chartW = W - PAD.left - PAD.right;
  const chartH = H - PAD.top - PAD.bottom;

  const maxRank = Math.max(4, ...visible.map((p) => p.rank));
  const n = visible.length;

  const xFor = (i: number) => PAD.left + (n === 1 ? chartW / 2 : (i / (n - 1)) * chartW);
  const yFor = (rank: number) => PAD.top + ((rank - 1) / (maxRank - 1)) * chartH;

  const dotColor = (rank: number) =>
    rank === 1 ? '#FFD700' : rank === 2 ? '#C0C0C0' : rank === 3 ? '#CD7F32' : '#475569';

  const polyPoints = visible.map((p, i) => `${xFor(i)},${yFor(p.rank)}`).join(' ');

  const labelIndices = new Set([0, n - 1]);
  if (n > 4) labelIndices.add(Math.floor(n / 2));

  return (
    <div className="overflow-x-auto">
      <svg width={W} height={H} className="overflow-visible">
        {[1, 2, 3].map((r) => (
          <g key={r}>
            <line x1={PAD.left} x2={W - PAD.right} y1={yFor(r)} y2={yFor(r)} stroke="rgba(255,255,255,0.05)" strokeWidth={1} />
            <text x={PAD.left - 4} y={yFor(r) + 4} textAnchor="end" fill="#475569" fontSize={8}>{r}</text>
          </g>
        ))}
        {n > 1 && (
          <polyline points={polyPoints} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth={1.5} strokeLinejoin="round" />
        )}
        {visible.map((p, i) => (
          <circle key={p.date} cx={xFor(i)} cy={yFor(p.rank)} r={4} fill={dotColor(p.rank)} />
        ))}
        {visible.map((p, i) => {
          if (!labelIndices.has(i)) return null;
          const label = new Date(p.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          return (
            <text key={p.date} x={xFor(i)} y={H - 2} textAnchor="middle" fill="#475569" fontSize={8}>{label}</text>
          );
        })}
      </svg>
      <p className="mt-1 text-right text-xs text-slate-600">lower = better</p>
    </div>
  );
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
  const [expandedMedal, setExpandedMedal] = useState<string | null>(null);
  const [chartLimit, setChartLimit] = useState(20);
  const [editingProfile, setEditingProfile] = useState(false);
  const [streak, setStreak] = useState(0);

  // Crop modal state
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const onCropComplete = useCallback((_: unknown, pixels: { x: number; y: number; width: number; height: number }) => {
    setCroppedAreaPixels(pixels);
  }, []);

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
        .select('wod_date, athlete_id, time_seconds, amrap_rounds, amrap_reps, team_id, is_rx')
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

      // Streak: fetch all attendance + score dates and compute consecutive weekdays
      const { data: attendRows } = await supabase
        .from('attendance')
        .select('wod_date')
        .eq('athlete_id', uid);

      const todayDubai = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' });
      const attendedSet = new Set<string>([
        ...(attendRows ?? []).map((r: any) => r.wod_date as string),
        ...myDates, // score submission implies attendance
      ]);

      function calcStreak(attended: Set<string>, today: string): number {
        let s = 0;
        const d = new Date(today + 'T12:00:00');
        for (let i = 0; i < 365; i++) {
          const dow = d.getDay();
          if (dow === 0 || dow === 6) { d.setDate(d.getDate() - 1); continue; }
          const ds = d.toLocaleDateString('en-CA');
          if (attended.has(ds)) { s++; d.setDate(d.getDate() - 1); }
          else if (ds === today) { d.setDate(d.getDate() - 1); } // day not over
          else break;
        }
        return s;
      }

      setStreak(calcStreak(attendedSet, todayDubai));
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

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.[0]) return;
    const file = e.target.files[0];
    const reader = new FileReader();
    reader.onload = () => {
      setCropSrc(reader.result as string);
      setCrop({ x: 0, y: 0 });
      setZoom(1);
    };
    reader.readAsDataURL(file);
    // Reset input so the same file can be re-selected
    e.target.value = '';
  };

  const handleCropConfirm = async () => {
    if (!userId || !cropSrc || !croppedAreaPixels) return;
    setUploading(true); setMsg(null); setErr(null);
    setCropSrc(null);

    const blob = await getCroppedBlob(cropSrc, croppedAreaPixels);
    if (!blob) { setErr('Crop failed'); setUploading(false); return; }

    const path = `${userId}/avatar.jpg`;
    const { error: uploadErr } = await supabase.storage.from('avatars').upload(path, blob, { upsert: true, contentType: 'image/jpeg' });
    if (uploadErr) { setErr(uploadErr.message); setUploading(false); return; }

    const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path);
    const publicUrl = `${urlData.publicUrl}?t=${Date.now()}`;

    const { error: updateErr } = await supabase.from('profiles').update({ avatar_url: publicUrl }).eq('id', userId);
    if (updateErr) setErr(updateErr.message);
    else { setAvatarUrl(publicUrl); setMsg('Photo updated!'); }
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
      <section className="rounded-2xl border border-white/10 bg-[#0a0f1e] p-5">
        <button
          onClick={() => setEditingProfile((v) => !v)}
          className="flex w-full items-center gap-5 text-left"
        >
          <div className="relative flex-shrink-0">
            {avatarUrl ? (
              <img src={avatarUrl} alt="" className="h-20 w-20 rounded-full object-cover" />
            ) : (
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-white/10 text-2xl font-bold text-white">
                {displayName[0]?.toUpperCase() ?? '?'}
              </div>
            )}
            {uploading && (
              <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/60">
                <span className="text-xs text-white">...</span>
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-white">{displayName || 'Set your name'}</p>
            <p className="mt-0.5 text-xs text-slate-500">Tap to change display name or photo</p>
          </div>
          <svg className={`h-4 w-4 flex-shrink-0 text-slate-500 transition-transform ${editingProfile ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {editingProfile && (
          <div className="mt-4 border-t border-white/5 pt-4 space-y-3">
            <div>
              <label className="mb-1 block text-xs text-slate-500">Display name <span className="text-slate-600">(e.g. Matt W.)</span></label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSaveName()}
                placeholder="Matt W."
                className="w-full rounded-xl border border-white/10 bg-slate-900 px-4 py-2.5 text-sm text-slate-100 placeholder-slate-600 focus:outline-none"
              />
            </div>
            <div className="flex gap-2">
              <button onClick={handleSaveName} disabled={saving}
                className="flex-1 rounded-xl bg-white py-2 text-sm font-semibold text-black hover:bg-slate-200 disabled:opacity-40">
                {saving ? 'Saving...' : 'Save name'}
              </button>
              <button onClick={() => fileRef.current?.click()}
                className="flex-1 rounded-xl border border-white/20 py-2 text-sm font-medium text-slate-300 hover:bg-white/10">
                Change photo
              </button>
            </div>
            {msg && <p className="text-sm text-green-400">{msg}</p>}
            {err && <p className="text-sm text-red-400">{err}</p>}
          </div>
        )}

        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
      </section>

      {/* Streak + this month — always shown once stats loaded */}
      {stats && (
        <section className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl border border-white/10 bg-[#0a0f1e] px-4 py-4 text-center">
            <p className="text-2xl">{streak > 0 ? '🔥' : '💤'}</p>
            <p className="mt-1 text-2xl font-bold text-white">{streak}</p>
            <p className="mt-0.5 text-xs text-slate-500">M–F streak</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-[#0a0f1e] px-4 py-4 text-center">
            <p className="text-2xl">📅</p>
            <p className="mt-1 text-2xl font-bold text-white">{stats.thisMonthCount}</p>
            <p className="mt-0.5 text-xs text-slate-500">WODs this month</p>
          </div>
        </section>
      )}

      {/* Avg place + placement trend — own section */}
      {stats && (stats.avgPlace !== null || stats.avgPlaceMonth !== null) && (
        <section className="rounded-2xl border border-white/10 bg-[#0a0f1e] p-5">
          <div className="mb-4 grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-white/5 px-3 py-3 text-center">
              <p className="text-xs text-slate-500 mb-1">Avg. place (month)</p>
              <p className="text-2xl font-bold text-white">{stats.avgPlaceMonth !== null ? stats.avgPlaceMonth.toFixed(1) : '—'}</p>
            </div>
            <div className="rounded-xl bg-white/5 px-3 py-3 text-center">
              <p className="text-xs text-slate-500 mb-1">Avg. place (all-time)</p>
              <p className="text-2xl font-bold text-white">{stats.avgPlace !== null ? stats.avgPlace.toFixed(1) : '—'}</p>
            </div>
          </div>
          {stats.placements.length >= 3 && (
            <>
              <div className="mb-3 flex items-center justify-between">
                <p className="text-xs text-slate-600 uppercase tracking-wider">Placement Trend</p>
                <div className="flex rounded-lg border border-white/10 p-0.5 text-xs">
                  {([10, 20, 50] as const).map((n) => (
                    <button
                      key={n}
                      onClick={() => setChartLimit(n)}
                      className={`rounded-md px-2 py-0.5 font-medium transition-colors ${
                        chartLimit === n ? 'bg-white/15 text-white' : 'text-slate-500 hover:text-slate-300'
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
              <PlacementChart placements={stats.placements} limit={chartLimit} />
            </>
          )}
        </section>
      )}

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
          <div className="mb-1 grid grid-cols-3 gap-3">
            {([
              { key: 'gold',   label: '🥇 1st', value: stats.dailyGold,   dates: stats.dailyGoldDates },
              { key: 'silver', label: '🥈 2nd', value: stats.dailySilver, dates: stats.dailySilverDates },
              { key: 'bronze', label: '🥉 3rd', value: stats.dailyBronze, dates: stats.dailyBronzeDates },
            ] as const).map(({ key, label, value, dates }) => (
              <button
                key={key}
                type="button"
                disabled={value === 0}
                onClick={() => setExpandedMedal(expandedMedal === `daily-${key}` ? null : `daily-${key}`)}
                className={`rounded-xl px-3 py-3 text-center transition-colors ${
                  expandedMedal === `daily-${key}` ? 'bg-white/15 ring-1 ring-white/20' : 'bg-white/5 hover:bg-white/10'
                } disabled:cursor-default disabled:opacity-60`}
              >
                <p className="text-lg">{label}</p>
                <p className="mt-1 text-xl font-bold text-white">{value}</p>
              </button>
            ))}
          </div>
          {(['gold', 'silver', 'bronze'] as const).map((key) => {
            const dates = key === 'gold' ? stats.dailyGoldDates : key === 'silver' ? stats.dailySilverDates : stats.dailyBronzeDates;
            if (expandedMedal !== `daily-${key}` || dates.length === 0) return null;
            return (
              <div key={key} className="mb-3 mt-2 rounded-xl border border-white/10 bg-slate-900 px-3 py-2">
                <div className="flex flex-wrap gap-1.5">
                  {dates.map((d) => (
                    <span key={d} className="rounded-lg bg-white/10 px-2 py-1 text-xs text-slate-300">
                      {new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}

          <div className="mb-4 border-b border-white/5 pb-4" />

          {/* Weekly podiums */}
          <p className="mb-2 text-xs text-slate-600 uppercase tracking-wider">Weekly</p>
          <div className="mb-1 grid grid-cols-3 gap-3">
            {([
              { key: 'first',  label: '🥇 1st', value: stats.weeklyFirst,  weeks: stats.weeklyFirstWeeks },
              { key: 'second', label: '🥈 2nd', value: stats.weeklySecond, weeks: stats.weeklySecondWeeks },
              { key: 'third',  label: '🥉 3rd', value: stats.weeklyThird,  weeks: stats.weeklyThirdWeeks },
            ] as const).map(({ key, label, value, weeks }) => (
              <button
                key={key}
                type="button"
                disabled={value === 0}
                onClick={() => setExpandedMedal(expandedMedal === `weekly-${key}` ? null : `weekly-${key}`)}
                className={`rounded-xl px-3 py-3 text-center transition-colors ${
                  expandedMedal === `weekly-${key}` ? 'bg-white/15 ring-1 ring-white/20' : 'bg-white/5 hover:bg-white/10'
                } disabled:cursor-default disabled:opacity-60`}
              >
                <p className="text-lg">{label}</p>
                <p className="mt-1 text-xl font-bold text-white">{value}</p>
              </button>
            ))}
          </div>
          {(['first', 'second', 'third'] as const).map((key) => {
            const weeks = key === 'first' ? stats.weeklyFirstWeeks : key === 'second' ? stats.weeklySecondWeeks : stats.weeklyThirdWeeks;
            if (expandedMedal !== `weekly-${key}` || weeks.length === 0) return null;
            return (
              <div key={key} className="mb-3 mt-2 rounded-xl border border-white/10 bg-slate-900 px-3 py-2">
                <div className="flex flex-wrap gap-1.5">
                  {weeks.map((w) => (
                    <span key={w} className="rounded-lg bg-white/10 px-2 py-1 text-xs text-slate-300">{w}</span>
                  ))}
                </div>
              </div>
            );
          })}

          <div className="mb-4 border-b border-white/5 pb-4" />

          {/* Monthly podiums */}
          <p className="mb-2 text-xs text-slate-600 uppercase tracking-wider">Monthly</p>
          <div className="mb-1 grid grid-cols-3 gap-3">
            {([
              { key: 'first',  label: '🥇 1st', value: stats.monthlyFirst,  months: stats.monthlyFirstMonths },
              { key: 'second', label: '🥈 2nd', value: stats.monthlySecond, months: stats.monthlySecondMonths },
              { key: 'third',  label: '🥉 3rd', value: stats.monthlyThird,  months: stats.monthlyThirdMonths },
            ] as const).map(({ key, label, value, months }) => (
              <button
                key={key}
                type="button"
                disabled={value === 0}
                onClick={() => setExpandedMedal(expandedMedal === `monthly-${key}` ? null : `monthly-${key}`)}
                className={`rounded-xl px-3 py-3 text-center transition-colors ${
                  expandedMedal === `monthly-${key}` ? 'bg-white/15 ring-1 ring-white/20' : 'bg-white/5 hover:bg-white/10'
                } disabled:cursor-default disabled:opacity-60`}
              >
                <p className="text-lg">{label}</p>
                <p className="mt-1 text-xl font-bold text-white">{value}</p>
              </button>
            ))}
          </div>
          {(['first', 'second', 'third'] as const).map((key) => {
            const months = key === 'first' ? stats.monthlyFirstMonths : key === 'second' ? stats.monthlySecondMonths : stats.monthlyThirdMonths;
            if (expandedMedal !== `monthly-${key}` || months.length === 0) return null;
            return (
              <div key={key} className="mt-2 rounded-xl border border-white/10 bg-slate-900 px-3 py-2">
                <div className="flex flex-wrap gap-1.5">
                  {months.map((m) => (
                    <span key={m} className="rounded-lg bg-white/10 px-2 py-1 text-xs text-slate-300">
                      {new Date(m + '-15').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </section>
      )}

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

      {/* Crop modal */}
      {cropSrc && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black">
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
            <button
              onClick={() => setCropSrc(null)}
              className="text-sm text-slate-400 hover:text-white"
            >
              Cancel
            </button>
            <p className="text-sm font-semibold text-white">Adjust Photo</p>
            <button
              onClick={handleCropConfirm}
              className="rounded-xl bg-white px-4 py-1.5 text-sm font-semibold text-black hover:bg-slate-200"
            >
              Save
            </button>
          </div>
          <div className="relative flex-1">
            <Cropper
              image={cropSrc}
              crop={crop}
              zoom={zoom}
              aspect={1}
              cropShape="round"
              showGrid={false}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={onCropComplete}
            />
          </div>
          <div className="flex items-center gap-3 bg-black px-6 py-4">
            <span className="text-xs text-slate-500">Zoom</span>
            <input
              type="range"
              min={1}
              max={3}
              step={0.05}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="flex-1 accent-white"
            />
          </div>
        </div>
      )}
    </main>
  );
}
