import { NextRequest, NextResponse } from 'next/server';
import { parse } from 'node-html-parser';
import { createServiceClient } from '../../../lib/supabase';

const TZ = process.env.APP_TIMEZONE ?? 'Asia/Dubai';
const WOD_URL = 'https://vfuae.com/wod/';

function todayInTZ(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ });
}
function tomorrowInTZ(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toLocaleDateString('en-CA', { timeZone: TZ });
}

/** Convert DD/MM/YYYY → YYYY-MM-DD */
function parseDDMMYYYY(s: string): string | null {
  const m = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/.exec(s.trim());
  if (!m) return null;
  const [, d, mo, y] = m;
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

/** Convert HTML content to clean plain text with preserved line breaks */
function htmlToText(html: string): string {
  return html
    // Paragraph/line breaks → newline
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<p[^>]*>/gi, '')
    .replace(/<\/p>/gi, '\n')
    // Strip remaining tags
    .replace(/<[^>]+>/g, '')
    // Decode entities
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#8211;/g, '–')
    .replace(/&#8217;/g, "'")
    .replace(/&#8220;/g, '"')
    .replace(/&#8221;/g, '"')
    // Tidy up whitespace
    .replace(/[ \t]+/g, ' ')          // collapse horizontal whitespace
    .replace(/\n[ \t]+/g, '\n')       // trim leading space on each line
    .replace(/[ \t]+\n/g, '\n')       // trim trailing space on each line
    .replace(/\n{3,}/g, '\n\n')       // max two consecutive blank lines
    .trim();
}

/** Strip gym policy boilerplate — truncate at first boilerplate phrase */
function stripBoilerplate(text: string): string {
  // Everything from "NO RESERVATION" onwards is gym policy — cut it
  const cutPatterns = [
    /NO RESERVATION/i,
    /MORE THAN \d+ MIN/i,
    /BOOK YOUR CLASS/i,
  ];
  let cut = text.length;
  for (const p of cutPatterns) {
    const idx = text.search(p);
    if (idx > 0 && idx < cut) cut = idx;
  }
  return text
    .slice(0, cut)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => {
      if (!l) return false;
      const u = l.toUpperCase();
      return !u.match(/^VOGUE FITNESS/) && u !== 'WOD';
    })
    .join('\n')
    .trim();
}

/** Fetch the WOD page HTML with browser-like headers */
async function fetchWodPage(): Promise<string | null> {
  try {
    const res = await fetch(WOD_URL, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
      },
      next: { revalidate: 0 },
    });
    if (!res.ok) return null;
    return res.text();
  } catch {
    return null;
  }
}

interface WodEntry {
  date: string;
  text: string;
}

/** Parse GravityView WOD entries from the page HTML */
function parseWods(html: string, targetDates: string[], debug: boolean): {
  wods: WodEntry[];
  debugInfo?: any;
} {
  const root = parse(html);

  // Each WOD is a div.gv-list-view
  const cards = root.querySelectorAll('div.gv-list-view');

  const debugCards: any[] = [];
  const wods: WodEntry[] = [];

  for (const card of cards) {
    // Field 30-5 = date (DD/MM/YYYY)
    const dateRaw = card.querySelector('.gv-field-30-5')?.text?.trim() ?? '';
    // Field 30-2 = location
    const location = card.querySelector('.gv-field-30-2')?.text?.trim() ?? '';
    // Field 30-4 = WOD content — use innerHTML to preserve <p> line breaks
    const contentEl = card.querySelector('.gv-field-30-4');
    const content = htmlToText(contentEl?.innerHTML ?? '');

    const isoDate = parseDDMMYYYY(dateRaw);

    if (debug) {
      debugCards.push({ dateRaw, isoDate, location, contentPreview: content.slice(0, 80) });
    }

    // Must be Saadiyat location
    if (!location.toLowerCase().includes('saadiyat')) continue;

    // Must be today or tomorrow
    if (!isoDate || !targetDates.includes(isoDate)) continue;

    const clean = stripBoilerplate(content);
    if (clean.length > 10 && !wods.find((w) => w.date === isoDate)) {
      wods.push({ date: isoDate, text: clean });
    }
  }

  return {
    wods,
    debugInfo: debug
      ? {
          totalCards: cards.length,
          htmlLength: html.length,
          firstChars: html.slice(0, 200),
          cards: debugCards,
        }
      : undefined,
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
  const today = todayInTZ();
  const tomorrow = tomorrowInTZ();

  try {
    const html = await fetchWodPage();

    if (!html) {
      return NextResponse.json({ error: 'Failed to fetch vfuae.com/wod/' }, { status: 502 });
    }

    const { wods, debugInfo } = parseWods(html, [today, tomorrow], debugMode);

    if (debugMode) {
      return NextResponse.json({ wods, today, tomorrow, debug: debugInfo });
    }

    if (wods.length === 0) {
      return NextResponse.json({
        message: 'No Saadiyat WODs found for today/tomorrow — try ?debug=1',
        saved: 0,
      });
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
