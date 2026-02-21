'use client';

import { useEffect, useState } from 'react';
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
  const [scores, setScores] = useState<string[]>([]);

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
    }

    loadMeAndMembers();
  }, []);

  const handleSubmit = async () => {
    if (!score) return;
    if (!selectedAthleteId) return;
    if (!meId) return;

    const today = new Date().toISOString().split('T')[0];

    const { error } = await supabase.from('scores').insert({
      athlete_id: selectedAthleteId,
      entered_by: meId,   // REQUIRED by your schema
      submitted_by: meId, // keep for compatibility if it exists
      wod_date: today,
      is_rx: true,
      is_team: false,
      time_input: score,
    });

    if (error) {
      console.error('Error inserting score:', error);
      alert(`Error saving score: ${error.message}`);
      return;
    }

    const athlete = members.find((m) => m.id === selectedAthleteId);
    const athleteLabel =
      selectedAthleteId === meId ? 'Me' : athlete?.display_name || selectedAthleteId.slice(0, 8);

    setScores((prev) => [`${score} (${athleteLabel})`, ...prev]);
    setScore('');
  };

  const fallbackName = email ? email.split('@')[0] : '';
  const otherMembers = members.filter((m) => m.id !== meId);

  return (
    <main className="relative mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-8 px-6 py-12 lg:px-10">
      <div className="absolute right-6 top-6 flex items-center gap-3">
        <div className="h-10 w-10 rounded-full border border-white/10 bg-white/10" />
        <div className="text-sm font-medium text-slate-200">
          {displayName ?? fallbackName}
        </div>
      </div>

      <section className="card p-8 md:p-10">
        <p className="text-sm uppercase tracking-[0.2em] text-brand-100">Saadiyat WOD</p>
        <h1 className="mt-3 text-3xl font-bold text-white md:text-5xl">
          {todaysWod.day}&apos;s Workout
        </h1>
        <p className="mt-3 max-w-2xl text-slate-200">{todaysWod.focus}</p>

        <div className="mt-6">
          <label className="mb-2 block text-sm text-white/70">Submit score for</label>
          <select
            value={selectedAthleteId ?? ''}
            onChange={(e) => setSelectedAthleteId(e.target.value)}
            className="w-full rounded-lg bg-slate-900 p-3 text-white border border-white/10"
          >
            {meId ? <option value={meId}>Me</option> : <option value="">Me</option>}
            {otherMembers.length > 0 && <option disabled>──────────</option>}
            {otherMembers.map((m) => (
              <option key={m.id} value={m.id}>
                {m.display_name || m.id.slice(0, 8)}
              </option>
            ))}
          </select>

          <input
            value={score}
            onChange={(e) => setScore(e.target.value)}
            placeholder="Enter your score (e.g. 5+12 or 12:34)"
            className="mt-3 w-full rounded-lg bg-slate-900 p-3 text-white"
          />

          <button
            onClick={handleSubmit}
            className="mt-3 w-full rounded-lg bg-brand-500 py-3 font-semibold"
          >
            Submit Score
          </button>
        </div>
      </section>

      <section className="card p-6">
        <h2 className="mb-4 text-xl font-semibold">Leaderboard</h2>
        {scores.length === 0 ? (
          <p className="text-slate-400">Be the first to suffer.</p>
        ) : (
          <ul className="space-y-2">
            {scores.map((s, i) => (
              <li key={i} className="rounded-lg bg-slate-900 p-3">
                {s}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="grid gap-5 md:grid-cols-3">
        {todaysWod.blocks.map((block) => (
          <SectionCard key={block.title} block={block} />
        ))}
      </section>
    </main>
  );
}
