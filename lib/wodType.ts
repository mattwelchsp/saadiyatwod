export type WorkoutType = "TIME" | "AMRAP" | "NO_SCORE" | "UNKNOWN";

export function detectWorkoutTypeFromWodText(rawText: string | null | undefined): WorkoutType {
  const text = (rawText ?? "").trim();
  if (!text) return "UNKNOWN";

  const t = text.toLowerCase();

  if (
    /\bemom\b/.test(t) ||
    /every\s+minute\s+on\s+the\s+minute/.test(t) ||
    /for\s+quality/.test(t) ||
    /not\s+for\s+time/.test(t) ||
    /\bskill\b/.test(t) ||
    /\bstrength\b/.test(t)
  ) {
    return "NO_SCORE";
  }

  if (
    /\bamrap\b/.test(t) ||
    /as\s+many\s+rounds\s+as\s+possible/.test(t) ||
    /as\s+many\s+reps\s+as\s+possible/.test(t) ||
    /max\s+(rounds|reps)/.test(t) ||
    /score\s*[:\-]\s*(rounds|reps)/.test(t)
  ) {
    return "AMRAP";
  }

  if (
    /for\s+time/.test(t) ||
    /\btime\s*cap\b/.test(t) ||
    /\btcap\b/.test(t) ||
    /complete\s+.*for\s+time/.test(t)
  ) {
    return "TIME";
  }

  return "UNKNOWN";
}
