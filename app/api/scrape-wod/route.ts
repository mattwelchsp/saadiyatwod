import { NextRequest, NextResponse } from 'next/server';
import { parse } from 'node-html-parser';
import { createServiceClient } from '../../../lib/supabase';

const WOD_URL = 'https://vfuae.com/wod/';
const TZ = process.env.APP_TIMEZONE ?? 'Asia/Dubai';

function todayInTZ(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ });
}
function tomorrowInTZ(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toLocaleDateString('en-CA', { timeZone: TZ });
}

/** Parse DD/MM/YYYY → YYYY-MM-DD */
function parseDDMMYYYY(s: string): string | null {
  const m = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/.exec(s);
  if (!m) return null;
  const [, d, mo, y] = m;
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

/** Parse any recognisable date format → YYYY-MM-DD */
function parseAnyDate(s: string): string | null {
  if (!s) return null;
  // DD/MM/YYYY (site format)
  const ddmm = parseDDMMYYYY(s);
  if (ddmm) return ddmm;
  // ISO
  const iso = /(\d{4}-\d{2}-\d{2})/.exec(s);
  if (iso) return iso[1];
  // Fallback to Date constructor (handles "February 22, 2026" etc.)
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toLocaleDateString('en-CA', { timeZone: TZ });
  return null;
}

/** Strip gym policy boilerplate that appears on every card */
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
        l !== 'WOD' &&                        // card type label
        !l.match(/^VOGUE FITNESS/)             // location header
      );
    })
    .join('\n')
    .trim();
}

async function fetchPage(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml',
    },
    next: { revalidate: 0 },
  });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
  return res.text();
}

async function scrapeWods(debug = false): Promise<{
  wods: { date: string; text: string }[];
  debugInfo?: any;
}> {
  const today = todayInTZ();
  const tomorrow = tomorrowInTZ();
  const targetDates = new Set([today, tomorrow]);

  // Try Saadiyat-filtered URL first, then bare URL
  const urlsToTry = [
    'https://vfuae.com/wod/?location=saadiyat',
    'https://vfuae.com/wod/?gym=saadiyat',
    'https://vfuae.com/wod/?location=saadiyat-island',
    WOD_URL,
  ];

  let html = '';
  let usedUrl = WOD_URL;

  for (const url of urlsToTry) {
    try {
      html = await fetchPage(url);
      usedUrl = url;
      break;
    } catch {
      continue;
    }
  }

  if (!html) throw new Error('Could not fetch any WOD URL');

  const root = parse(html);
  const results: { date: string; text: string }[] = [];

  // ── Strategy 1: Find any container that mentions "Saadiyat" ──────────────────
  //
  // Walk every block-level element. When we find one containing "saadiyat"
  // (case-insensitive), look for a DD/MM/YYYY date inside or nearby, then
  // grab the text content as the WOD.
  //
  const allBlocks = root.querySelectorAll(
    'article, .wod-card, .tribe_events_cat-wod, .post, .entry, .card, [class*="wod"], [class*="event"], [class*="post"]'
  );

  const debugBlocks: any[] = [];

  for (const block of allBlocks) {
    const text = block.innerText ?? '';
    if (!text.toLowerCase().includes('saadiyat')) continue;

    // Find date within this block
    const parsedDate = parseAnyDate(text);
    if (!parsedDate || !targetDates.has(parsedDate)) continue;

    const clean = stripBoilerplate(text);
    if (clean.length < 10) continue;

    if (debug) debugBlocks.push({ selector: block.tagName, classes: block.classNames, text: text.slice(0, 300) });

    // Avoid duplicates
    if (!results.find((r) => r.date === parsedDate)) {
      results.push({ date: parsedDate, text: clean });
    }
  }

  // ── Strategy 2: Scan all text nodes for DD/MM/YYYY near "Saadiyat" ───────────
  if (results.length === 0) {
    const allEls = root.querySelectorAll('div, section, li, p, td');

    for (const el of allEls) {
      const text = el.innerText ?? '';
      if (!text.toLowerCase().includes('saadiyat')) continue;

      const parsedDate = parseAnyDate(text);
      if (!parsedDate || !targetDates.has(parsedDate)) continue;

      const clean = stripBoilerplate(text);
      if (clean.length < 10) continue;
      if (!results.find((r) => r.date === parsedDate)) {
        results.push({ date: parsedDate, text: clean });
      }
    }
  }

  // ── Strategy 3: Find all DD/MM/YYYY dates on page, grab their sibling text ───
  if (results.length === 0) {
    const bodyText = root.querySelector('body')?.innerText ?? '';
    const dateRegex = /\b\d{1,2}\/\d{1,2}\/\d{4}\b/g;
    let match: RegExpExecArray | null;

    while ((match = dateRegex.exec(bodyText)) !== null) {
      const parsedDate = parseDDMMYYYY(match[0]);
      if (!parsedDate || !targetDates.has(parsedDate)) continue;

      // Grab ~500 chars after the date as WOD text
      const snippet = bodyText.slice(match.index, match.index + 500);
      const clean = stripBoilerplate(snippet);
      if (clean.length > 10 && !results.find((r) => r.date === parsedDate)) {
        results.push({ date: parsedDate, text: clean });
      }
    }
  }

  const debugInfo = debug
    ? {
        usedUrl,
        today,
        tomorrow,
        blocksWithSaadiyat: debugBlocks,
        htmlSnippet: html.slice(0, 3000),
      }
    : undefined;

  return { wods: results, debugInfo };
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
