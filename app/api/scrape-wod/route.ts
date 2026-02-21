import { NextRequest, NextResponse } from 'next/server';
import { parse } from 'node-html-parser';
import { createServiceClient } from '../../../lib/supabase';

const WOD_URL = 'https://vfuae.com/wod/';
const TZ = process.env.APP_TIMEZONE ?? 'Asia/Dubai';

/** Current date string in TZ */
function todayInTZ(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ });
}
function tomorrowInTZ(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toLocaleDateString('en-CA', { timeZone: TZ });
}

/**
 * Parse WOD blocks from the vfuae.com/wod page.
 *
 * The page typically shows two "posts" — today and tomorrow.
 * Each post has a heading with a date and a body with the WOD text.
 *
 * Returns an array of { date: 'YYYY-MM-DD', text: string }.
 * Adjust selectors here if the site structure changes.
 */
async function scrapeWods(): Promise<{ date: string; text: string }[]> {
  const res = await fetch(WOD_URL, {
    headers: {
      'User-Agent': 'SaadiyatWOD-bot/1.0 (polite scraper; contact via gym)',
    },
    next: { revalidate: 0 },
  });

  if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);

  const html = await res.text();
  const root = parse(html);
  const results: { date: string; text: string }[] = [];

  const today = todayInTZ();
  const tomorrow = tomorrowInTZ();

  // Strategy 1: look for article / .post elements
  const articles = root.querySelectorAll('article, .post, .entry, .wp-block-group');

  for (const article of articles) {
    const rawText = article.innerText.trim();
    if (rawText.length < 20) continue;

    // Try to detect which date this article belongs to
    const titleEl = article.querySelector('h1, h2, h3, .entry-title, .post-title');
    const titleText = titleEl ? titleEl.innerText.trim() : '';

    // Remove the title from the body text
    let bodyText = rawText;
    if (titleText && bodyText.startsWith(titleText)) {
      bodyText = bodyText.slice(titleText.length).trim();
    }

    // Try to parse a date from the title or from a <time> element
    const timeEl = article.querySelector('time');
    const dateAttr = timeEl?.getAttribute('datetime') ?? '';
    const parsedDate = parseDateString(dateAttr) ?? parseDateString(titleText);

    if (parsedDate === today || parsedDate === tomorrow) {
      results.push({ date: parsedDate, text: bodyText });
    }
  }

  // Strategy 2: if articles didn't work, look for date headings in the page body
  if (results.length === 0) {
    const headings = root.querySelectorAll('h1, h2, h3, h4');
    for (const h of headings) {
      const headingText = h.innerText.trim();
      const parsedDate = parseDateString(headingText);
      if (parsedDate !== today && parsedDate !== tomorrow) continue;

      // Collect all text siblings/children until next heading
      let node = h.nextElementSibling;
      const parts: string[] = [];
      while (node && !['H1','H2','H3','H4'].includes(node.tagName ?? '')) {
        const t = node.innerText.trim();
        if (t) parts.push(t);
        node = node.nextElementSibling;
      }

      if (parts.length > 0) {
        results.push({ date: parsedDate, text: parts.join('\n') });
      }
    }
  }

  // Strategy 3: fallback — grab the full main content and label it as today
  if (results.length === 0) {
    const main = root.querySelector('main, #main, .site-content, .content-area, body');
    if (main) {
      const text = main.innerText.trim();
      if (text.length > 50) {
        results.push({ date: today, text: text.slice(0, 2000) }); // cap at 2k chars
      }
    }
  }

  return results;
}

/**
 * Attempt to parse a date from a string.  Handles formats like:
 *   "2025-01-15", "January 15 2025", "15 January 2025", "Jan 15, 2025", etc.
 * Returns YYYY-MM-DD or null.
 */
function parseDateString(s: string): string | null {
  if (!s) return null;

  // ISO format
  const iso = /(\d{4}-\d{2}-\d{2})/.exec(s);
  if (iso) return iso[1];

  // Try native Date parse (catches "January 15, 2025" etc.)
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    return d.toLocaleDateString('en-CA', { timeZone: TZ });
  }

  return null;
}

// ── Route handlers ────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  // Protect with CRON_SECRET so only Vercel cron (or admin) can call this
  const secret = process.env.CRON_SECRET;
  const authHeader = req.headers.get('authorization');
  if (secret && authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const wods = await scrapeWods();

    if (wods.length === 0) {
      return NextResponse.json({ message: 'No WODs found on page', saved: 0 });
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
