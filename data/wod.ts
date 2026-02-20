export type WorkoutBlock = {
  title: string;
  duration: string;
  details: string[];
};

export type DailyWod = {
  day: string;
  focus: string;
  coachNote: string;
  blocks: WorkoutBlock[];
};

export const todaysWod: DailyWod = {
  day: 'Thursday',
  focus: 'Engine + Gymnastics Control',
  coachNote:
    'Move with intent. Keep breathing smooth through transitions and protect quality in every rep.',
  blocks: [
    {
      title: 'Primer',
      duration: '12 min',
      details: [
        '2 rounds: 400m easy run',
        '10 PVC pass-throughs + 10 inchworms',
        '20s hollow hold + 20s arch hold'
      ]
    },
    {
      title: 'Skill',
      duration: '15 min',
      details: [
        'EMOM x 15 (5 rounds)',
        'Min 1: 8-12 strict pull-ups',
        'Min 2: 14 alternating dumbbell snatches (22.5/15 kg)',
        'Min 3: 40s handstand hold / pike hold'
      ]
    },
    {
      title: 'Conditioning',
      duration: '18 min cap',
      details: [
        '3 rounds for time:',
        '600m run',
        '30 wall balls (9/6 kg)',
        '20 burpees over line'
      ]
    }
  ]
};
