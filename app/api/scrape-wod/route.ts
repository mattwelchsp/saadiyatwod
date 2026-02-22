import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '../../../lib/supabase';

const TZ = process.env.APP_TIMEZONE ?? 'Asia/Dubai';
const BASE = 'https://vfuae.com';

function todayInTZ(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ });
}
function tomorrowInTZ(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toLocaleDateString('en-CA', { timeZone: TZ });
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#8211;/g, '–')
    .replace(/&#8217;/g, "'")
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function stripBoilerplate(text: string): string {
  return text
    .split('\n')
    .filter((line) => {
      const l = line.trim().toUpperCase();
      return (
        !l.startsWith('NO RESERVATION') &&
        !l.startsWith('MORE THAN 5 MINUTES') &&
        !l.includes('NO ENTRY TO CLASS') &&
        !l.includes('BOOK YOUR CLASS') &&
        l !== 'WOD' &&
        !l.match(/^VOGUE FITNESS/)
      );
    })
    .join('\n')
    .trim();
}

async function fetchJson(url: string): Promise<any | null> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        Accept: 'application/json',
      },
      next: { revalidate: 0 },
    });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('json')) return null;
    return res.json();
  } catch {
    return null;
  }
}

// ── Strategy 1: listo/v1 — custom WOD plugin ─────────────────────────────────
// The /wp-json/ discovery showed listo/v1 has a dynamic route:
//   /listo/v1/(?P<type>[a-z0-9_-]+)
// We probe likely type names to find the WOD data.
async function tryListoAPI(
  today: string,
  tomorrow: string,
  debug: boolean
): Promise<{ wods: { date: string; text: string }[]; debugInfo?: any }> {
  const wods: { date: string; text: string }[] = [];
  const logs: any[] = [];

  // Probe every plausible type name
  const typesToTry = [
    'wod', 'wods', 'workout', 'workouts', 'daily-wod', 'daily',
    'crossfit', 'class', 'classes', 'schedule', 'programming',
    'saadiyat', 'location', 'post', 'entry', 'entries',
  ];

  for (const type of typesToTry) {
    const url = `${BASE}/wp-json/listo/v1/${type}`;
    const data = await fetchJson(url);
    if (debug) logs.push({ url, response: data ? JSON.stringify(data).slice(0, 400) : 'null/error' });
    if (!data) continue;

    // Got a non-null response — this type exists! Log it fully in debug mode
    if (debug) logs.push({ HIT: type, fullResponse: JSON.stringify(data).slice(0, 2000) });

    // Try to extract WOD entries from whatever shape the data is
    const items: any[] = Array.isArray(data) ? data : (data.data ?? data.items ?? data.results ?? data.wods ?? []);

    for (const item of items) {
      // Try every possible date field
      const itemDate: string =
        item.date?.slice(0, 10) ??
        item.wod_date?.slice(0, 10) ??
        item.start_date?.slice(0, 10) ??
        item.post_date?.slice(0, 10) ??
        item.event_date?.slice(0, 10) ??
        '';

      if (itemDate && itemDate !== today && itemDate !== tomorrow) continue;

      // Try every possible location field
      const locationText = [
        item.location, item.venue, item.gym, item.branch, item.site,
        item.location_name, item.location?.name,
      ].filter(Boolean).join(' ').toLowerCase();

      if (locationText && !locationText.includes('saadiyat')) continue;

      // Extract content
      const title = stripHtml(item.title ?? item.name ?? item.post_title ?? item.wod_title ?? '');
      const content = stripHtml(
        item.content ?? item.description ?? item.workout ?? item.post_content ??
        item.text ?? item.body ?? ''
      );
      const clean = stripBoilerplate(`${title}\n${content}`);
      if (clean.length > 10) {
        wods.push({ date: itemDate || today, text: clean });
      }
    }

    if (wods.length > 0) break;
  }

  // Also try with query params on the base wod type
  if (wods.length === 0) {
    const urlsWithParams = [
      `${BASE}/wp-json/listo/v1/wod?date=${today}&location=saadiyat`,
      `${BASE}/wp-json/listo/v1/wod?date=${today}`,
      `${BASE}/wp-json/listo/v1/wod?location=saadiyat`,
      `${BASE}/wp-json/listo/v1/wod?per_page=10`,
      `${BASE}/wp-json/listo/v1/wods?date=${today}`,
    ];
    for (const url of urlsWithParams) {
      const data = await fetchJson(url);
      if (debug) logs.push({ url, response: data ? JSON.stringify(data).slice(0, 400) : 'null/error' });
      if (!data) continue;
      if (debug && data && JSON.stringify(data) !== '[]' && JSON.stringify(data) !== '{}') {
        logs.push({ HIT_WITH_PARAMS: url, fullResponse: JSON.stringify(data).slice(0, 2000) });
      }
    }
  }

  return { wods, debugInfo: debug ? { strategy: 'listo/v1', logs } : undefined };
}

// ── Strategy 2: WordPress custom post type "wod" ──────────────────────────────
// Check if they registered a plain WP REST endpoint for WODs
async function tryWpWodPostType(
  today: string,
  tomorrow: string,
  debug: boolean
): Promise<{ wods: { date: string; text: string }[]; debugInfo?: any }> {
  const wods: { date: string; text: string }[] = [];
  const logs: any[] = [];

  const slugsToTry = ['wod', 'wods', 'daily-wod', 'workout', 'workouts'];

  for (const slug of slugsToTry) {
    const url = `${BASE}/wp-json/wp/v2/${slug}?per_page=10&orderby=date&order=desc`;
    const data = await fetchJson(url);
    if (debug) logs.push({ url, response: data ? JSON.stringify(data).slice(0, 400) : 'null/error' });
    if (!Array.isArray(data) || data.length === 0) continue;

    if (debug) logs.push({ HIT: slug, count: data.length, sample: JSON.stringify(data[0]).slice(0, 600) });

    for (const item of data) {
      const postDate = (item.date ?? '').slice(0, 10);
      if (postDate !== today && postDate !== tomorrow) continue;

      const title = stripHtml(item.title?.rendered ?? '');
      const content = stripHtml(item.content?.rendered ?? '');
      const allText = [title, content].join(' ').toLowerCase();
      if (!allText.includes('saadiyat') && !allText.includes('wod') && !allText.includes('crossfit')) continue;

      const clean = stripBoilerplate(`${title}\n${content}`);
      if (clean.length > 10) wods.push({ date: postDate, text: clean });
    }

    if (wods.length > 0) break;
  }

  return { wods, debugInfo: debug ? { strategy: 'wp-wod-post-type', logs } : undefined };
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function scrapeWods(debug: boolean) {
  const today = todayInTZ();
  const tomorrow = tomorrowInTZ();
  const allDebug: any[] = [];

  const { wods: w1, debugInfo: d1 } = await tryListoAPI(today, tomorrow, debug);
  if (debug) allDebug.push(d1);
  if (w1.length > 0) return { wods: w1, debugInfo: debug ? { today, tomorrow, strategies: allDebug } : undefined };

  const { wods: w2, debugInfo: d2 } = await tryWpWodPostType(today, tomorrow, debug);
  if (debug) allDebug.push(d2);
  if (w2.length > 0) return { wods: w2, debugInfo: debug ? { today, tomorrow, strategies: allDebug } : undefined };

  return {
    wods: [],
    debugInfo: debug
      ? { today, tomorrow, strategies: allDebug, note: 'No WODs found. Paste this output to investigate further.' }
      : undefined,
  };
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const authHeader = req.headers.get('authorization');
  if (secret && authHeader && authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const debugMode = req.nextUrl.searchParams.get('debug') === '1';

  try {
    const { wods, debugInfo } = await scrapeWods(debugMode);

    if (debugMode) {
      return NextResponse.json({ wods, debug: debugInfo });
    }

    if (wods.length === 0) {
      return NextResponse.json({ message: 'No Saadiyat WODs found — try ?debug=1', saved: 0 });
    }

    const db = createServiceClient();
    let saved = 0;
    for (const { date, text } of wods) {
      const { error } = await db
        .from('wods')
        .upsert({ wod_date: date, wod_text: text }, { onConflict: 'wod_date' });
      if (!error) saved++;
      else console.error(`Failed to save WOD for ${date}:`, error.message);
    }

    return NextResponse.json({ message: 'Done', saved, dates: wods.map((w) => w.date) });
  } catch (err: any) {
    console.error('Scrape error:', err);
    return NextResponse.json({ error: err.message ?? 'Unknown error' }, { status: 500 });
  }
}
