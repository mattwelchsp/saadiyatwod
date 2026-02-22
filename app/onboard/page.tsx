'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../lib/supabase';

export default function OnboardPage() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [userId, setUserId] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: authData } = await supabase.auth.getUser();
      if (!authData.user) { router.replace('/login'); return; }

      const uid = authData.user.id;
      const emailPrefix = (authData.user.email ?? '').split('@')[0].toLowerCase();
      setUserId(uid);

      // If they already have a real display name (not just the email prefix),
      // they've already onboarded — send them home.
      const { data: profile } = await supabase
        .from('profiles')
        .select('display_name, avatar_url')
        .eq('id', uid)
        .single();

      const dn = (profile?.display_name ?? '').toLowerCase();
      if (dn && dn !== emailPrefix) {
        router.replace('/');
        return;
      }

      if (profile?.avatar_url) setAvatarUrl(profile.avatar_url);
    })();
  }, [router]);

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!userId || !e.target.files?.[0]) return;
    const file = e.target.files[0];
    setUploading(true); setErr(null);

    const ext = file.name.split('.').pop();
    const path = `${userId}/avatar.${ext}`;

    const { error: uploadErr } = await supabase.storage
      .from('avatars')
      .upload(path, file, { upsert: true });

    if (uploadErr) { setErr(uploadErr.message); setUploading(false); return; }

    const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path);
    const publicUrl = `${urlData.publicUrl}?t=${Date.now()}`;

    await supabase.from('profiles').update({ avatar_url: publicUrl }).eq('id', userId);
    setAvatarUrl(publicUrl);
    setUploading(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = displayName.trim();
    if (!trimmed) { setErr('Please enter your name to continue.'); return; }
    if (!userId) return;

    setSaving(true); setErr(null);

    const { error } = await supabase
      .from('profiles')
      .update({ display_name: trimmed })
      .eq('id', userId);

    if (error) { setErr(error.message); setSaving(false); return; }

    router.replace('/');
  };

  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-black text-white">
      <div className="w-full max-w-sm">

        {/* Logo / title */}
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-bold text-white">Welcome to SaadiyatWOD 👋</h1>
          <p className="mt-2 text-sm text-slate-400">Set up your profile to get started</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">

          {/* Avatar picker */}
          <div className="flex flex-col items-center gap-3">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="relative group"
            >
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt=""
                  className="h-24 w-24 rounded-full object-cover ring-2 ring-white/20"
                />
              ) : (
                <div className="flex h-24 w-24 items-center justify-center rounded-full bg-white/10 ring-2 ring-white/20 text-3xl font-bold text-slate-400">
                  {displayName[0]?.toUpperCase() ?? '?'}
                </div>
              )}
              <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity">
                <span className="text-xs text-white font-medium">
                  {uploading ? 'Uploading…' : '+ Photo'}
                </span>
              </div>
            </button>
            <p className="text-xs text-slate-500">
              {uploading ? 'Uploading photo…' : 'Tap to add a profile photo (optional)'}
            </p>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleAvatarChange}
            />
          </div>

          {/* Display name */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-300">
              Your name <span className="text-slate-500">(first name + last initial)</span>
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="e.g. Matt W."
              autoFocus
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-100 placeholder-slate-600 focus:border-white/30 focus:outline-none"
            />
            <p className="mt-1 text-xs text-slate-600">
              This is how you&apos;ll appear on the leaderboard.
            </p>
          </div>

          {err && <p className="text-sm text-red-400">{err}</p>}

          <button
            type="submit"
            disabled={saving || uploading}
            className="w-full rounded-xl bg-white py-3 text-sm font-semibold text-black hover:bg-slate-100 disabled:opacity-40 transition-colors"
          >
            {saving ? 'Saving…' : "Let's go →"}
          </button>

        </form>
      </div>
    </main>
  );
}
