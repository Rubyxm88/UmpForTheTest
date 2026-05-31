/** Standings board registry — add new challenge boards here without rebuilding UI */

export const STANDINGS_BOARDS = [
  {
    id: 'weekly',
    label: 'Weekly Challenge',
    type: 'periodic',
    board: 'weekly',
    periodType: 'isoWeek',
    accent: 'emerald',
    columns: [
      { key: 'rank', label: 'Rank', hideMobile: false },
      { key: 'name', label: 'Crew Chief', hideMobile: false },
      { key: 'accuracy', label: 'Accuracy', hideMobile: false },
      { key: 'score', label: 'Score', hideMobile: false },
    ],
  },
  {
    id: 'daily',
    label: 'Streak Challenge',
    type: 'periodic',
    board: 'daily',
    periodType: 'date',
    accent: 'amber',
    columns: [
      { key: 'rank', label: 'Rank', hideMobile: false },
      { key: 'name', label: 'Crew Chief', hideMobile: false },
      { key: 'accuracy', label: 'Accuracy', hideMobile: false },
      { key: 'score', label: 'Streak', hideMobile: false },
    ],
  },
  {
    id: 'streak_alltime',
    label: 'Streak Challenge',
    type: 'alltime',
    board: 'alltime',
    accent: 'amber',
    columns: [
      { key: 'rank', label: 'Rank', hideMobile: false },
      { key: 'name', label: 'Crew Chief', hideMobile: false },
      { key: 'accuracy', label: 'Accuracy', hideMobile: false },
      { key: 'score', label: 'Best Streak', hideMobile: false },
    ],
  },
  {
    id: 'crew',
    label: 'Crew Chief',
    type: 'crew',
    accent: 'purple',
    subBoards: [
      {
        id: 'rank',
        label: 'Level',
        metric: 'rank',
        valueLabel: 'Level',
        columns: [
          { key: 'rank', label: 'Rank' },
          { key: 'name', label: 'Crew Chief' },
          { key: 'score', label: 'Level' },
          { key: 'accuracy', label: 'XP' },
        ],
      },
      {
        id: 'wins',
        label: 'Challenge Wins',
        metric: 'wins',
        valueLabel: 'Wins',
        columns: [
          { key: 'rank', label: 'Rank' },
          { key: 'name', label: 'Crew Chief' },
          { key: 'score', label: 'Wins' },
          { key: 'accuracy', label: 'Avg Acc' },
        ],
      },
      {
        id: 'streak',
        label: 'Best Streak',
        metric: 'streak',
        valueLabel: 'Best Streak',
        columns: [
          { key: 'rank', label: 'Rank' },
          { key: 'name', label: 'Crew Chief' },
          { key: 'score', label: 'Streak' },
          { key: 'accuracy', label: 'Avg Acc' },
        ],
      },
    ],
  },
];
