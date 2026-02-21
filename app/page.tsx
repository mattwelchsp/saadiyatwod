'use client';

import { useEffect, useState } from 'react';
import { detectWorkoutTypeFromWodText } from '../lib/wodType';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type WodBlock = {
  title: string;
  items: string[];
};

type TodaysWod = {
  day: string;
  focus: string;
  blocks: WodBlock[];
};

type Member = {
  id: string;
  display_name: string | null;
};

const todaysWod: TodaysWod = {
  day: 'Today',
  focus: 'Post the WOD here (exact text as posted).',
  blocks: [
    { title: 'Warm-up', items: [''] },
    { title: 'Strength', items: [''] },
    { title: 'Conditioning', items: [''] },
  ],
};

function SectionCard({ block }: { block: WodBlock }) {
  return (
    <section className="card p-6">
      <h3 className="text-base font-semibold text-white">{block.title}</h3>
      {block.items?.length ? (
        <ul className="mt-3 space-y-2">
          {block.items.map((item, idx) => (
            <li key={idx} className="rounded-lg bg-slate-900 p-3 text-slate-200">
              {item || <span className="text-slate-500">—</span>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-slate-400">—</p>
      )}
    </section>
  );
}

export default function HomePage() {
  const [meId, setMeId] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [avatarPath, setAvatarPath] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);

  const [members, setMembers] = useState<Member[]>([]);
  const [selectedAthleteId, setSelectedAthleteId] = useState<string | null>(null);

  const [score, setScore] = useState('');
  const [wodText, setWodText] = useState<string | null>(null);
  const [scores, setScores] = useState<
    Array<{
      id: string;
      athlete_id: string;
      time_input: string | null;
      amrap_input: string | null;
      created_at: string;
      athlete_display_name: string | null;
    }>
  >([]);

  useEffect(() => {
    async function loadMeAndMembers() {
      const { data } = await supabase.auth.getUser();
      const user = data.user;

      if (!user) return;

      setMeId(user.id);
      setSelectedAthleteId(user.id); // default = me
      setEmail(user.email ?? null);

      const { data: profile } = await supabase
        .from('profiles')
        .select('display_name, avatar_path')
        .eq('id', user.id)
        .single();

      if (profile) {
        setDisplayName(profile.display_name ?? null);
        setAvatarPath(profile.avatar_path ?? null);
      }

      const { data: allMembers, error: membersError } = await supabase
        .from('profiles')
        .select('id, display_name')
        .order('display_name', { ascending: true });

      if (!membersError && allMembers) {
        setMembers(allMembers as Member[]);
      } else {
        console.error('Error loading members:', membersError);
      }

      // Load latest WOD date (for now) and fetch leaderboard scores from DB
      const { data: latestWod, error: latestWodErr } = await supabase
        .from('wods')
.select('wod_date, wod_text')
        .order('wod_date', { ascending: false })
        .limit(1)
        .single();
      if (latestWod?.wod_text) {
  setWodText(latestWod.wod_text);
}

      if (latestWodErr || !latestWod?.wod_date) {
        console.error('Error loading latest WOD date for leaderboard:', latestWodErr);
        return;
      }

      const { data: scoreRows, error: scoreErr } = await supabase
        .from('scores')
        .select('id, athlete_id, time_input, amrap_input, created_at')
        .eq('wod_date', latestWod.wod_date)
        .order('created_at', { ascending: false });

      if (scoreErr) {
        console.error('Error loading scores:', scoreErr);
        return;
      }

      // Map athlete_id -> display_name using the members list we just loaded
      const nameById = new Map<string, string | null>();
      (allMembers ?? []).forEach((m: any) => nameById.set(m.id, m.display_name ?? null));


            const mapped = (scoreRows ?? []).map((r: any) => ({
        id: r.id,
        athlete_id: r.athlete_id,
        time_input: r.time_input ?? null,
        amrap_input: r.amrap_input ?? null,
        created_at: r.created_at,
        athlete_display_name: nameById.get(r.athlete_id) ?? null,
      }));

      // Sort TIME workouts (lowest time = best)
      // Sort leaderboard based on detected workout type
mapped.sort((a, b) => {
  // TIME: lowest total seconds wins
  if (workoutType === 'TIME') {
    if (!a.time_input && !b.time_input) return 0;
    if (!a.time_input) return 1;
    if (!b.time_input) return -1;

    const toSeconds = (t: string) => {
      const parts = t.split(':').map((p) => Number(p));
      if (parts.length !== 2 || parts.some((n) => Number.isNaN(n))) return Number.POSITIVE_INFINITY;
      const [m, s] = parts;
      return m * 60 + s;
    };

    return toSeconds(a.time_input) - toSeconds(b.time_input);
  }

  // AMRAP: highest (rounds, then reps) wins; supports "5+12" and also plain "123"
  if (workoutType === 'AMRAP') {
    const parseAmrap = (v: string | null) => {
      if (!v) return { rounds: -1, reps: -1, total: -1 };

      const s = v.trim();
      const plusMatch = /^(\d+)\s*\+\s*(\d+)$/.exec(s);
      if (plusMatch) {
        const rounds = Number(plusMatch[1]);
        const reps = Number(plusMatch[2]);
        if (Number.isNaN(rounds) || Number.isNaN(reps)) return { rounds: -1, reps: -1, total: -1 };
        // total is only a fallback; rounds/reps are the real comparison
        return { rounds, reps, total: rounds * 1000 + reps };
      }

      // If someone enters a plain number, treat as reps
      const num = Number(s);
      if (!Number.isNaN(num)) return { rounds: 0, reps: num, total: num };

      return { rounds: -1, reps: -1, total: -1 };
    };

    const aVal = parseAmrap(a.amrap_input);
    const bVal = parseAmrap(b.amrap_input);

    // Missing values go to bottom
    const aMissing = aVal.total < 0;
    const bMissing = bVal.total < 0;
    if (aMissing && bMissing) return 0;
    if (aMissing) return 1;
    if (bMissing) return -1;

    // Higher rounds wins; if tied, higher reps wins
    if (aVal.rounds !== bVal.rounds) return bVal.rounds - aVal.rounds;
    return bVal.reps - aVal.reps;
  }

  // UNKNOWN / NO_SCORE: keep newest-first (created_at already ordered desc)
  return 0;
});

      setScores(mapped);
    }

    loadMeAndMembers();
  }, []);

  const handleSubmit = async () => {
  if (!score) return;
  if (!selectedAthleteId) return;
  if (!meId) return;

  const { data: latestWod, error: wodErr } = await supabase
    .from('wods')
    .select('wod_date')
    .order('wod_date', { ascending: false })
    .limit(1)
    .single();

  if (wodErr || !latestWod?.wod_date) {
    console.error('Error loading latest WOD date:', wodErr);
    alert('No WOD found to attach this score to. Import/create today’s WOD first.');
    return;
  }

  const wodDate = latestWod.wod_date;

  const insertPayload: any = {
    athlete_id: selectedAthleteId,
    entered_by: meId, // REQUIRED by your schema
    submitted_by: meId, // keep for compatibility if it exists
    wod_date: wodDate,
    is_rx: true,
    is_team: false,
    time_input: null,
    amrap_input: null,
  };

  if (workoutType === 'TIME') {
    insertPayload.time_input = score;
  } else if (workoutType === 'AMRAP') {
    insertPayload.amrap_input = score;
  } else {
    alert('This workout does not accept scores (or type is unknown).');
    return;
  }

  const { error } = await supabase.from('scores').insert(insertPayload);

  if (error) {
    console.error('Error inserting score:', error);
    alert(`Error saving score: ${error.message}`);
    return;
  }

  // Clear input
  setScore('');

  // Reload leaderboard from DB for this WOD date
  const { data: scoreRows, error: scoreErr } = await supabase
    .from('scores')
    .select('id, athlete_id, time_input, amrap_input, created_at')
    .eq('wod_date', wodDate)
    .order('created_at', { ascending: false });

  if (scoreErr) {
    console.error('Error loading scores after submit:', scoreErr);
    return;
  }

  // Map athlete_id -> display_name using the members list already loaded
  const nameById = new Map<string, string | null>();
  members.forEach((m: any) => nameById.set(m.id, m.display_name ?? null));

  const mapped = (scoreRows ?? []).map((r: any) => ({
    id: r.id,
    athlete_id: r.athlete_id,
    time_input: r.time_input ?? null,
    amrap_input: r.amrap_input ?? null,
    created_at: r.created_at,
    athlete_display_name: nameById.get(r.athlete_id) ?? null,
  }));

  // Sort based on detected workout type (same logic as initial load)
  mapped.sort((a, b) => {
    if (workoutType === 'TIME') {
      if (!a.time_input && !b.time_input) return 0;
      if (!a.time_input) return 1;
      if (!b.time_input) return -1;

      const toSeconds = (t: string) => {
        const parts = t.split(':').map((p) => Number(p));
        if (parts.length !== 2 || parts.some((n) => Number.isNaN(n))) return Number.POSITIVE_INFINITY;
        const [m, s] = parts;
        return m * 60 + s;
      };

      return toSeconds(a.time_input) - toSeconds(b.time_input);
    }

    if (workoutType === 'AMRAP') {
      const parseAmrap = (v: string | null) => {
        if (!v) return { rounds: -1, reps: -1, total: -1 };

        const s = v.trim();
        const plusMatch = /^(\d+)\s*\+\s*(\d+)$/.exec(s);
        if (plusMatch) {
          const rounds = Number(plusMatch[1]);
          const reps = Number(plusMatch[2]);
          if (Number.isNaN(rounds) || Number.isNaN(reps)) return { rounds: -1, reps: -1, total: -1 };
          return { rounds, reps, total: rounds * 1000 + reps };
        }

        const num = Number(s);
        if (!Number.isNaN(num)) return { rounds: 0, reps: num, total: num };

        return { rounds: -1, reps: -1, total: -1 };
      };

      const aVal = parseAmrap(a.amrap_input);
      const bVal = parseAmrap(b.amrap_input);

      const aMissing = aVal.total < 0;
      const bMissing = bVal.total < 0;
      if (aMissing && bMissing) return 0;
      if (aMissing) return 1;
      if (bMissing) return -1;

      if (aVal.rounds !== bVal.rounds) return bVal.rounds - aVal.rounds;
      return bVal.reps - aVal.reps;
    }

    return 0;
  });

  setScores(mapped);
};

  const fallbackName = email ? email.split('@')[0] : '';
  const otherMembers = members.filter((m) => m.id !== meId);
    const workoutType = detectWorkoutTypeFromWodText(wodText);

  return (
<main className="relative mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-8 px-6 py-12 pb-24 lg:px-10">      <div className="absolute right-6 top-6 flex items-center gap-3">
        <div className="h-10 w-10 rounded-full border border-white/10 bg-white/10" />
        <div className="text-sm font-medium text-slate-200">
          {displayName ?? fallbackName}
        </div>
      </div>

      {/* --- YOUR EXISTING PAGE CONTENT GOES BELOW --- */}
      {/* If you already had a big block of JSX here previously (WOD card, submit form, leaderboard, etc),
          paste it back in here from your previous commit after this deploy is green. */}

      <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-slate-200">
        <div className="text-sm text-slate-300">Workout type detected:</div>
        <div className="mt-1 text-lg font-semibold">{workoutType}</div>
      </div>
        {/* Bottom Navigation */}
    <div className="fixed bottom-0 left-0 right-0 border-t border-white/10 bg-black/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-around px-6 py-3">
        <a
          href="/"
          className="text-sm font-semibold text-white"
        >
          Home
        </a>
        <a
          href="/monthly"
          className="text-sm font-medium text-slate-300"
        >
          Monthly
        </a>
      </div>
    </div>
  </main>
  );
}
