'use client';

import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";

export default function HomePage() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const [displayName, setDisplayName] = useState<string | null>(null);
  const [avatarPath, setAvatarPath] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);

  const [score, setScore] = useState('');
  const [scores, setScores] = useState<string[]>([]);

  useEffect(() => {
    async function loadMe() {
      const { data } = await supabase.auth.getUser();
      const user = data.user;
      console.log("USER:", user);

      if (!user) return;

      setEmail(user.email ?? null);

      const { data: profile, error } = await supabase
        .from("profiles")
        .select("display_name, avatar_path")
        .eq("id", user.id)
        .single();

      if (!error && profile) {
        setDisplayName(profile.display_name ?? null);
        setAvatarPath(profile.avatar_path ?? null);
      }
    }

    loadMe();
  }, []);

  const handleSubmit = () => {
    if (!score) return;
    setScores([score, ...scores]);
    setScore('');
  };

  // Fallback name if profile not set yet
  const fallbackName = email ? email.split("@")[0] : "";

  return (
    <main className="relative mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-8 px-6 py-12 lg:px-10">
      {/* Top-right "Me" badge (minimal) */}
      <div className="absolute right-6 top-6 flex items-center gap-3">
        {/* Placeholder avatar for now; we'll wire real avatar URLs on the Profile page step */}
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
          <input
            value={score}
            onChange={(e) => setScore(e.target.value)}
            placeholder="Enter your score (e.g. 5+12 or 12:34)"
            className="w-full rounded-lg bg-slate-900 p-3 text-white"
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
        <h2 className="text-xl font-semibold mb-4">Leaderboard</h2>
        {scores.length === 0 ? (
          <p className="text-slate-400">Be the first to suffer.</p>
        ) : (
          <ul className="space-y-2">
            {scores.map((s, i) => (
              <li key={i} className="bg-slate-900 p-3 rounded-lg">
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
