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

/** Strip HTML tags */
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

// ── Strategy 1: Modern Events Calendar (mec/v1) ───────────────────────────────
// vfuae.com uses the MEC plugin — confirmed by /wp-json/ namespaces list
async function tryMecAPI(
  today: string,
  tomorrow: string,
  debug: boolean
): Promise<{ wods: { date: string; text: string }[]; debugInfo?: any }> {
  const wods: { date: string; text: string }[] = [];
  const logs: any[] = [];

  // MEC REST API endpoints to try
  const urlsToTry = [
    // Standard MEC events list with date range
    `${BASE}/wp-json/mec/v1/events?start=${today}&end=${tomorrow}`,
    `${BASE}/wp-json/mec/v1/events?from=${today}&to=${tomorrow}`,
    `${BASE}/wp-json/mec/v1/events?date=${today}`,
    // MEC events custom post type via wp/v2
    `${BASE}/wp-json/wp/v2/mec-events?per_page=50&orderby=date&order=desc&after=${today}T00:00:00`,
    `${BASE}/wp-json/wp/v2/mec-events?per_page=50&orderby=date&order=desc`,
    // MEC might use a "single_day" param
    `${BASE}/wp-json/mec/v1/events?single_day=${today}`,
    // Just grab all recent events
    `${BASE}/wp-json/mec/v1/events?per_page=50`,
    `${BASE}/wp-json/mec/v1/events`,
  ];

  for (const url of urlsToTry) {
    const data = await fetchJson(url);
    const preview = data ? JSON.stringify(data).slice(0, 600) : 'null/error';
    if (debug) logs.push({ url, response: preview });
    if (!data) continue;

    // MEC can return { events: [...] } or just [...]
    const events: any[] = data.events ?? data.data ?? (Array.isArray(data) ? data : []);
    if (events.length === 0) continue;

    if (debug) logs.push({ found: events.length, firstEvent: JSON.stringify(events[0]).slice(0, 400) });

    for (const ev of events) {
      // MEC stores dates differently — try multiple fields
      const eventDate: string =
        ev.date?.start?.date?.slice(0, 10) ??
        ev.start?.slice(0, 10) ??
        ev.start_date?.slice(0, 10) ??
        ev.date?.slice(0, 10) ??
        (ev.date?.start ? String(ev.date.start).slice(0, 10) : '') ??
        '';

      if (eventDate && eventDate !== today && eventDate !== tomorrow) continue;

      const title: string = stripHtml(ev.title ?? ev.post_title ?? '');
      const content: string = stripHtml(
        ev.content ?? ev.post_content ?? ev.description ?? ev.excerpt ?? ''
      );
      const location: string = ev.location?.name ?? ev.venue ?? ev.location ?? '';
      const allText = [title, content, location].join(' ').toLowerCase();

      // Must relate to Saadiyat or be a WOD entry
      if (!allText.includes('saadiyat') && !allText.includes('wod')) {
        // If no date filter worked, try title-based WOD detection
        if (!title.toLowerCase().includes('crossfit') && !content.toLowerCase().includes('amrap')) continue;
      }

      const clean = stripBoilerplate(`${title}\n${content}`);
      if (clean.length > 10) {
        const useDate = eventDate || today;
        if (!wods.find((w) => w.date === useDate)) {
          wods.push({ date: useDate, text: clean });
        }
      }
    }

    if (wods.length > 0) break;
  }

  return {
    wods,
    debugInfo: debug ? { strategy: 'mec/v1', logs } : undefined,
  };
}

// ── Strategy 2: mec-events custom post type ───────────────────────────────────
async function tryMecPostType(
  today: string,
  tomorrow: string,
  debug: boolean
): Promise<{ wods: { date: string; text: string }[]; debugInfo?: any }> {
  const wods: { date: string; text: string }[] = [];
  const logs: any[] = [];

  const url = `${BASE}/wp-json/wp/v2/mec-events?per_page=50&orderby=modified&order=desc`;
  const data = await fetchJson(url);
  if (debug) logs.push({ url, response: data ? JSON.stringify(data).slice(0, 800) : 'null/error' });

  if (Array.isArray(data) && data.length > 0) {
    if (debug) logs.push({ count: data.length, firstItem: JSON.stringify(data[0]).slice(0, 600) });

    for (const item of data) {
      const postDate: string = (item.date ?? '').slice(0, 10);
      const meta = item.meta ?? {};
      // MEC stores event start in meta fields
      const mecStart: string =
        meta.mec_start_date ??
        meta.mec_start_datetime ??
        '';
      const useDate = mecStart ? mecStart.slice(0, 10) : postDate;

      if (useDate && useDate !== today && useDate !== tomorrow) continue;

      const title: string = stripHtml(item.title?.rendered ?? '');
      const content: string = stripHtml(item.content?.rendered ?? '');
      const allText = [title, content].join(' ').toLowerCase();

      if (!allText.includes('saadiyat') && !allText.includes('wod') && !allText.includes('crossfit')) continue;

      const clean = stripBoilerplate(`${title}\n${content}`);
      if (clean.length > 10 && !wods.find((w) => w.date === (useDate || today))) {
        wods.push({ date: useDate || today, text: clean });
      }
    }
  }

  return { wods, debugInfo: debug ? { strategy: 'mec-post-type', logs } : undefined };
}

// ── Strategy 3: listo/v1 (the other custom namespace on their site) ────────────
async function tryListoAPI(
  today: string,
  _tomorrow: string,
  debug: boolean
): Promise<{ wods: { date: string; text: string }[]; debugInfo?: any }> {
  const logs: any[] = [];

  // Probe what listo/v1 offers
  const root = await fetchJson(`${BASE}/wp-json/listo/v1`);
  if (debug) logs.push({ url: `${BASE}/wp-json/listo/v1`, response: root ? JSON.stringify(root).slice(0, 600) : 'null/error' });

  const events = await fetchJson(`${BASE}/wp-json/listo/v1/events?date=${today}`);
  if (debug) logs.push({ url: `${BASE}/wp-json/listo/v1/events?date=${today}`, response: events ? JSON.stringify(events).slice(0, 600) : 'null/error' });

  const wods: { date: string; text: string }[] = [];
  return { wods, debugInfo: debug ? { strategy: 'listo/v1', logs } : undefined };
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function scrapeWods(debug: boolean) {
  const today = todayInTZ();
  const tomorrow = tomorrowInTZ();
  const allDebug: any[] = [];

  const { wods: w1, debugInfo: d1 } = await tryMecAPI(today, tomorrow, debug);
  if (debug) allDebug.push(d1);
  if (w1.length > 0) return { wods: w1, debugInfo: debug ? { today, tomorrow, strategies: allDebug } : undefined };

  const { wods: w2, debugInfo: d2 } = await tryMecPostType(today, tomorrow, debug);
  if (debug) allDebug.push(d2);
  if (w2.length > 0) return { wods: w2, debugInfo: debug ? { today, tomorrow, strategies: allDebug } : undefined };

  const { wods: w3, debugInfo: d3 } = await tryListoAPI(today, tomorrow, debug);
  if (debug) allDebug.push(d3);
  if (w3.length > 0) return { wods: w3, debugInfo: debug ? { today, tomorrow, strategies: allDebug } : undefined };

  return {
    wods: [],
    debugInfo: debug
      ? { today, tomorrow, strategies: allDebug, note: 'All strategies returned 0 WODs. See strategy logs for raw API responses.' }
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
