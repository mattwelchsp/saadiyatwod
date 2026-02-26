export type WorkoutType = 'TIME' | 'AMRAP' | 'CALORIES' | 'NO_SCORE' | 'UNKNOWN';

/**
 * Detect workout type from raw WOD text.
 * Admin override (stored on the wod record) takes precedence over this.
 * Default: TIME (per spec).
 */
export function detectWorkoutTypeFromWodText(
  rawText: string | null | undefined
): WorkoutType {
  const text = (rawText ?? '').trim();
  if (!text) return 'UNKNOWN';
  const t = text.toLowerCase();

  // NO_SCORE indicators — check first
  if (
    /\bemom\b/.test(t) ||
    /\be[2-9]mom\b/.test(t) ||
    /every\s+minute\s+on\s+the\s+minute/.test(t) ||
    /every\s+\d+\s+minute/.test(t) ||
    /for\s+quality/.test(t) ||
    /not\s+for\s+time/.test(t) ||
    /\bskill\b/.test(t) ||
    /\bstrength\b/.test(t)
  ) {
    return 'NO_SCORE';
  }

  // CALORIES (check before AMRAP/TIME — only if not already NO_SCORE)
  if (
    /\bmax\s+(cal|calories)\b/.test(t) ||
    /\bfor\s+(cal|calories)\b/.test(t) ||
    /\bcalorie\s+challenge\b/.test(t)
  ) {
    return 'CALORIES';
  }

  // AMRAP
  if (
    /\bamrap\b/.test(t) ||
    /as\s+many\s+rounds\s+as\s+possible/.test(t) ||
    /as\s+many\s+reps\s+as\s+possible/.test(t) ||
    /max\s+(rounds|reps)/.test(t) ||
    /score\s*[:\-]\s*(rounds|reps)/.test(t)
  ) {
    return 'AMRAP';
  }

  // TIME
  if (
    /for\s+time/.test(t) ||
    /\btime\s*cap\b/.test(t) ||
    /\btcap\b/.test(t) ||
    /complete\s+.*for\s+time/.test(t)
  ) {
    return 'TIME';
  }

  // Default to TIME per spec
  return 'TIME';
}

/**
 * Detect if a WOD is a team workout from its text.
 * Looks for patterns like "teams of 2", "teams of 3", "with a partner", etc.
 */
export function detectTeamFromWodText(rawText: string | null | undefined): { isTeam: boolean; teamSize: number } {
  const text = (rawText ?? '').toLowerCase();
  if (!text) return { isTeam: false, teamSize: 2 };

  // "teams of N" or "in teams of N"
  const teamsOf = /\bteams?\s+of\s+(\d+)/.exec(text);
  if (teamsOf) return { isTeam: true, teamSize: parseInt(teamsOf[1], 10) };

  // "partner" based patterns
  if (/\bpartner\s+wod\b/.test(text) || /\bwith\s+a\s+partner\b/.test(text) || /\bpartner\s+workout\b/.test(text)) {
    return { isTeam: true, teamSize: 2 };
  }

  return { isTeam: false, teamSize: 2 };
}

/** Parse "mm:ss" into total seconds. Returns null on bad input. */
export function parseTimeInput(raw: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const mins = parseInt(m[1], 10);
  const secs = parseInt(m[2], 10);
  if (secs >= 60) return null;
  return mins * 60 + secs;
}

/** Format seconds back to "mm:ss". */
export function formatSeconds(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Parse "5+12" into { rounds, reps }. Returns null on bad input. */
export function parseAmrapInput(raw: string): { rounds: number; reps: number } | null {
  const s = raw.trim();
  const plus = /^(\d+)\s*\+\s*(\d+)$/.exec(s);
  if (plus) return { rounds: parseInt(plus[1], 10), reps: parseInt(plus[2], 10) };
  const num = parseInt(s, 10);
  if (!Number.isNaN(num) && String(num) === s) return { rounds: 0, reps: num };
  return null;
}
