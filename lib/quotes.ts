export const QUOTES: { text: string; source: string }[] = [
  { text: 'I immediately regret this decision.', source: 'Anchorman' },
  { text: 'That escalated quickly.', source: 'Anchorman' },
  { text: "60% of the time, it works every time.", source: 'Anchorman' },
  { text: "If you ain't first, you're last.", source: 'Talladega Nights' },
  { text: 'Shake and bake!', source: 'Talladega Nights' },
  { text: 'I wake up in the morning and I piss excellence.', source: 'Talladega Nights' },
  { text: 'If he dies, he dies.', source: 'Rocky IV' },
  { text: "You're my boy, Blue!", source: 'Old School' },
  {
    text: "That's a bold strategy, Cotton. Let's see if it pays off for him.",
    source: 'Dodgeball',
  },
  { text: 'Did we just become best friends?', source: 'Step Brothers' },
];

export function randomQuote(): { text: string; source: string } {
  return QUOTES[Math.floor(Math.random() * QUOTES.length)];
}
