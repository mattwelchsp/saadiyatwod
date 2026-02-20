import { SectionCard } from '@/components/section-card';
import { todaysWod } from '@/data/wod';

const stats = [
  { label: 'Estimated time', value: '45–55 min' },
  { label: 'Intensity', value: 'Moderate / High' },
  { label: 'Equipment', value: 'DB, Wall Ball, Pull-up bar' }
];

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-8 px-6 py-12 lg:px-10">
      <section className="card p-8 md:p-10">
        <p className="text-sm uppercase tracking-[0.2em] text-brand-100">Saadiyat WOD</p>
        <h1 className="mt-3 text-3xl font-bold text-white md:text-5xl">{todaysWod.day}&apos;s Workout</h1>
        <p className="mt-3 max-w-2xl text-slate-200">{todaysWod.focus}</p>
        <p className="mt-5 rounded-xl border border-white/10 bg-slate-900/40 p-4 text-sm text-slate-300">
          Coach note: {todaysWod.coachNote}
        </p>
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          {stats.map((item) => (
            <div key={item.label} className="rounded-xl border border-white/10 bg-slate-900/50 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-400">{item.label}</p>
              <p className="mt-1 text-sm font-medium text-slate-100">{item.value}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-5 md:grid-cols-3">
        {todaysWod.blocks.map((block) => (
          <SectionCard key={block.title} block={block} />
        ))}
      </section>
    </main>
  );
}
