import type { WorkoutBlock } from '@/data/wod';

type SectionCardProps = {
  block: WorkoutBlock;
};

export function SectionCard({ block }: SectionCardProps) {
  return (
    <article className="card p-6 shadow-soft">
      <header className="mb-4 flex items-end justify-between gap-3">
        <h3 className="text-xl font-semibold text-white">{block.title}</h3>
        <span className="rounded-full bg-brand-500/20 px-3 py-1 text-xs font-medium uppercase tracking-wide text-brand-100">
          {block.duration}
        </span>
      </header>
      <ul className="space-y-2 text-sm leading-relaxed text-slate-200">
        {block.details.map((item) => (
          <li key={item} className="flex gap-2">
            <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </article>
  );
}
