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

/** Strip HTML tags from a string */
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

/** Strip gym policy boilerplate */
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

/** Fetch JSON from a URL, return null on error */
async function fetchJson(url: string): Promise<any | null> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
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

// ── Strategy 1: The Events Calendar (Tribe) REST API ──────────────────────────
// Used by many CrossFit/fitness WordPress sites
async function tryTribeEventsAPI(
  today: string,
  tomorrow: string,
  debug: boolean
): Promise<{ wods: { date: string; text: string }[]; debugInfo?: any }> {
  const wods: { date: string; text: string }[] = [];
  const debugLogs: any[] = [];

  // Try fetching events for today and tomorrow
  const urlsToTry = [
    // With location filter
    `${BASE}/wp-json/tribe/events/v1/events?per_page=50&start_date=${today}&end_date=${tomorrow}&search=saadiyat`,
    // Without location filter — grab all and filter by location field
    `${BASE}/wp-json/tribe/events/v1/events?per_page=50&start_date=${today}&end_date=${tomorrow}`,
    // Wider range in case dates are off
    `${BASE}/wp-json/tribe/events/v1/events?per_page=50`,
  ];

  for (const url of urlsToTry) {
    const data = await fetchJson(url);
    if (debug) debugLogs.push({ url, response: data ? JSON.stringify(data).slice(0, 500) : 'null/error' });
    if (!data) continue;

    const events: any[] = data.events ?? (Array.isArray(data) ? data : []);
    if (events.length === 0) continue;

    for (const ev of events) {
      // Extract date
      const eventDate: string =
        ev.start_date?.slice(0, 10) ??
        ev.start_date_details?.year
          ? `${ev.start_date_details?.year}-${String(ev.start_date_details?.month).padStart(2, '0')}-${String(ev.start_date_details?.day).padStart(2, '0')}`
          : '';

      if (eventDate !== today && eventDate !== tomorrow) continue;

      // Check if this event is for Saadiyat location
      const title: string = ev.title ?? '';
      const description: string = stripHtml(ev.description ?? '');
      const venue: string = ev.venue?.venue ?? '';
      const categories: string[] = (ev.categories ?? []).map((c: any) => c.name ?? '');
      const allText = [title, description, venue, ...categories].join(' ').toLowerCase();

      if (!allText.includes('saadiyat') && !allText.includes('wod')) continue;

      const clean = stripBoilerplate(`${title}\n${description}`);
      if (clean.length > 10 && !wods.find((w) => w.date === eventDate)) {
        wods.push({ date: eventDate, text: clean });
      }
    }

    if (wods.length > 0) break; // Found what we need
  }

  return { wods, debugInfo: debug ? { strategy: 'tribe-events', logs: debugLogs } : undefined };
}

// ── Strategy 2: WordPress REST API posts ──────────────────────────────────────
async function tryWpPostsAPI(
  today: string,
  tomorrow: string,
  debug: boolean
): Promise<{ wods: { date: string; text: string }[]; debugInfo?: any }> {
  const wods: { date: string; text: string }[] = [];
  const debugLogs: any[] = [];

  const urlsToTry = [
    // Posts with WOD search term, recent
    `${BASE}/wp-json/wp/v2/posts?per_page=20&search=wod&orderby=date&order=desc`,
    // All recent posts (last 2 days worth)
    `${BASE}/wp-json/wp/v2/posts?per_page=20&after=${today}T00:00:00&orderby=date&order=desc`,
    // Try a custom post type "wod" if it exists
    `${BASE}/wp-json/wp/v2/wod?per_page=20&orderby=date&order=desc`,
  ];

  for (const url of urlsToTry) {
    const data = await fetchJson(url);
    if (debug) debugLogs.push({ url, response: data ? JSON.stringify(data).slice(0, 500) : 'null/error' });
    if (!Array.isArray(data) || data.length === 0) continue;

    for (const post of data) {
      const postDate: string = (post.date ?? '').slice(0, 10);
      if (postDate !== today && postDate !== tomorrow) continue;

      const title: string = post.title?.rendered ?? '';
      const content: string = stripHtml(post.content?.rendered ?? '');
      const allText = [title, content].join(' ').toLowerCase();

      if (!allText.includes('saadiyat') && !allText.includes('wod')) continue;

      const clean = stripBoilerplate(`${title}\n${content}`);
      if (clean.length > 10 && !wods.find((w) => w.date === postDate)) {
        wods.push({ date: postDate, text: clean });
      }
    }

    if (wods.length > 0) break;
  }

  return { wods, debugInfo: debug ? { strategy: 'wp-posts', logs: debugLogs } : undefined };
}

// ── Strategy 3: WordPress REST API — discover custom post types ───────────────
async function tryWpTypesDiscovery(
  today: string,
  tomorrow: string,
  debug: boolean
): Promise<{ wods: { date: string; text: string }[]; debugInfo?: any }> {
  const wods: { date: string; text: string }[] = [];
  const debugLogs: any[] = [];

  // Discover what post types / namespaces exist
  const types = await fetchJson(`${BASE}/wp-json/wp/v2/types`);
  if (debug) debugLogs.push({ url: `${BASE}/wp-json/wp/v2/types`, response: types ? JSON.stringify(types).slice(0, 1000) : 'null' });

  const namespaces = await fetchJson(`${BASE}/wp-json/`);
  if (debug) debugLogs.push({ url: `${BASE}/wp-json/`, namespaces: namespaces?.namespaces ?? 'null' });

  // If we found custom post types, try fetching from them
  if (types && typeof types === 'object') {
    for (const [slug, typeInfo] of Object.entries(types)) {
      const info = typeInfo as any;
      const restBase: string = info?.rest_base ?? slug;
      if (['post', 'page', 'attachment', 'revision', 'nav_menu_item'].includes(slug)) continue;

      if (debug) debugLogs.push({ trying: `${BASE}/wp-json/wp/v2/${restBase}` });

      const data = await fetchJson(`${BASE}/wp-json/wp/v2/${restBase}?per_page=20&orderby=date&order=desc`);
      if (!Array.isArray(data) || data.length === 0) continue;

      for (const item of data) {
        const itemDate: string = (item.date ?? '').slice(0, 10);
        if (itemDate !== today && itemDate !== tomorrow) continue;

        const title: string = item.title?.rendered ?? '';
        const content: string = stripHtml(item.content?.rendered ?? '');
        const clean = stripBoilerplate(`${title}\n${content}`);

        if (clean.length > 10 && !wods.find((w) => w.date === itemDate)) {
          wods.push({ date: itemDate, text: clean });
        }
      }
    }
  }

  return { wods, debugInfo: debug ? { strategy: 'wp-types-discovery', logs: debugLogs } : undefined };
}

// ── Main scrape function ───────────────────────────────────────────────────────
async function scrapeWods(debug: boolean): Promise<{
  wods: { date: string; text: string }[];
  debugInfo?: any;
}> {
  const today = todayInTZ();
  const tomorrow = tomorrowInTZ();
  const allDebug: any[] = [];

  // Try each strategy in order
  const { wods: w1, debugInfo: d1 } = await tryTribeEventsAPI(today, tomorrow, debug);
  if (debug) allDebug.push(d1);
  if (w1.length > 0) return { wods: w1, debugInfo: debug ? { today, tomorrow, strategies: allDebug } : undefined };

  const { wods: w2, debugInfo: d2 } = await tryWpPostsAPI(today, tomorrow, debug);
  if (debug) allDebug.push(d2);
  if (w2.length > 0) return { wods: w2, debugInfo: debug ? { today, tomorrow, strategies: allDebug } : undefined };

  const { wods: w3, debugInfo: d3 } = await tryWpTypesDiscovery(today, tomorrow, debug);
  if (debug) allDebug.push(d3);
  if (w3.length > 0) return { wods: w3, debugInfo: debug ? { today, tomorrow, strategies: allDebug } : undefined };

  return {
    wods: [],
    debugInfo: debug ? { today, tomorrow, strategies: allDebug, note: 'All strategies returned 0 results. Check the debug logs to see what APIs returned.' } : undefined,
  };
}

// ── Route handler ─────────────────────────────────────────────────────────────

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
      return NextResponse.json({ message: 'No Saadiyat WODs found — try ?debug=1 to inspect', saved: 0 });
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
