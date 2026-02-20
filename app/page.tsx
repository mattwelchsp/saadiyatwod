'use client';

import { useState } from 'react';
import { SectionCard } from '@/components/section-card';
import { todaysWod } from '@/data/wod';

const stats = [
  { label: 'Estimated time', value: '45–55 min' },
  { label: 'Intensity', value: 'Moderate / High' },
  { label: 'Equipment', value: 'DB, Wall Ball, Pull-up bar' }
];

export default function HomePage() {
  const [score, setScore] = useState('');
  const [scores, setScores] = useState<string[]>([]);

  const handleSubmit = () => {
    if (!score) return;
    setScores([score, ...scores]);
    setScore('');
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-8 px-6 py-12 lg:px-10">
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