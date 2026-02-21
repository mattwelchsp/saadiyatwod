'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabase';
import { detectWorkoutTypeFromWodText, formatSeconds, WorkoutType } from '../../lib/wodType';
import BottomNav from '../../components/BottomNav';

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

export default function MePage() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [userId, setUserId] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [recentScores, setRecentScores] = useState<RecentScore[]>([]);

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

      const { data: profile } = await supabase
        .from('profiles')
        .select('display_name, avatar_url')
        .eq('id', uid)
        .single();

      if (profile) {
        setDisplayName(profile.display_name ?? '');
        setAvatarUrl(profile.avatar_url ?? null);
      }

      // Recent scores with WOD info
      const { data: scores } = await supabase
        .from('scores')
        .select('wod_date, time_seconds, time_input, amrap_rounds, amrap_reps, amrap_input, is_rx')
        .eq('athlete_id', uid)
        .order('wod_date', { ascending: false })
        .limit(20);

      if (scores && scores.length > 0) {
        const dates = scores.map((s: any) => s.wod_date);
        const { data: wods } = await supabase
          .from('wods')
          .select('wod_date, wod_text, workout_type_override')
          .in('wod_date', dates);

        const wodMap = new Map((wods ?? []).map((w: any) => [w.wod_date, w]));
        setRecentScores(
          scores.map((s: any) => ({
            ...s,
            wod_text: wodMap.get(s.wod_date)?.wod_text ?? null,
            workout_type_override: wodMap.get(s.wod_date)?.workout_type_override ?? null,
          }))
        );
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

    const { error: updateErr } = await supabase
      .from('profiles')
      .update({ avatar_url: publicUrl })
      .eq('id', userId);

    if (updateErr) { setErr(updateErr.message); }
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

      {/* Avatar */}
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
        <button
          onClick={handleSaveName}
          disabled={saving}
          className="mt-3 rounded-xl bg-white px-5 py-2 text-sm font-semibold text-black hover:bg-slate-200 disabled:opacity-40"
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
        {msg && <p className="mt-2 text-sm text-green-400">{msg}</p>}
        {err && <p className="mt-2 text-sm text-red-400">{err}</p>}
      </section>

      {/* Recent scores */}
      {recentScores.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-widest text-slate-500">Recent Scores</h2>
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
      <button
        onClick={handleLogout}
        className="mt-2 rounded-xl border border-white/10 py-2.5 text-sm font-medium text-slate-400 hover:text-white"
      >
        Log out
      </button>

      <BottomNav />
    </main>
  );
}
