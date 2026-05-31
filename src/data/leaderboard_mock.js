/** Dummy leaderboard data for local UI testing when the API has no entries. */

function normalizeUser(handle) {
  return (handle || 'YOU').toUpperCase().replace(/\s*\(YOU\)\s*/i, '');
}

function mkRow(rank, handle, accuracy, score, scoreRaw, username, xp = 8000 - rank * 350) {
  const normalizedUser = normalizeUser(username);
  const isUser = handle.toUpperCase() === normalizedUser;
  return {
    rank,
    name: isUser ? `${normalizedUser} (YOU)` : handle,
    accuracy,
    score,
    score_raw: scoreRaw,
    isUser,
    xp,
    team: 'None',
  };
}

export function getMockWeeklyRows(username, periodKey) {
  void periodKey;
  return [
    mkRow(1, 'STRIKE_KING', '94.2%', '1,840', 1840, username, 14200),
    mkRow(2, 'ZONE_HAWK', '91.8%', '1,720', 1720, username, 12800),
    mkRow(3, 'CALL_MASTER', '90.1%', '1,680', 1680, username, 11900),
    mkRow(4, normalizeUser(username), '88.4%', '1,650', 1650, username, 9800),
    mkRow(5, 'PLATE_POLICE', '87.0%', '1,590', 1590, username, 9100),
    mkRow(6, 'RUBBER_SOUL', '85.6%', '1,520', 1520, username, 8400),
    mkRow(7, 'FRAME_FINDER', '84.2%', '1,480', 1480, username, 7900),
    mkRow(8, 'EDGE_RIDER', '82.9%', '1,410', 1410, username, 7200),
  ];
}

export function getMockWeeklyPeriods(currentWeekId) {
  return [
    {
      periodKey: currentWeekId || '2026-W22',
      winnerHandle: 'STRIKE_KING',
      winnerScore: '1,840',
      winnerAccuracy: '94.2%',
      entryCount: 38,
    },
    {
      periodKey: '2026-W21',
      winnerHandle: 'ZONE_HAWK',
      winnerScore: '1,910',
      winnerAccuracy: '93.5%',
      entryCount: 44,
    },
    {
      periodKey: '2026-W20',
      winnerHandle: 'CALL_MASTER',
      winnerScore: '1,770',
      winnerAccuracy: '92.1%',
      entryCount: 31,
    },
    {
      periodKey: '2026-W19',
      winnerHandle: 'PLATE_POLICE',
      winnerScore: '1,690',
      winnerAccuracy: '91.4%',
      entryCount: 29,
    },
  ];
}

export function getMockDailyRows(username) {
  return [
    mkRow(1, 'HOT_HAND', '100%', '24', 24, username, 6200),
    mkRow(2, 'BORDERLINE_BOB', '96%', '19', 19, username, 5800),
    mkRow(3, normalizeUser(username), '92%', '15', 15, username, 5400),
    mkRow(4, 'EDGE_RIDER', '88%', '12', 12, username, 5100),
    mkRow(5, 'FRAME_FINDER', '85%', '11', 11, username, 4800),
    mkRow(6, 'RUBBER_SOUL', '82%', '9', 9, username, 4500),
  ];
}

export function getMockAlltimeRows(username) {
  return [
    mkRow(1, 'LEGEND_UMPIRE', '89.2%', '47', 47, username, 22000),
    mkRow(2, 'STREAK_MACHINE', '87.5%', '42', 42, username, 19800),
    mkRow(3, 'HOT_HAND', '86.1%', '38', 38, username, 17600),
    mkRow(4, normalizeUser(username), '84.0%', '31', 31, username, 15200),
    mkRow(5, 'BORDERLINE_BOB', '83.4%', '29', 29, username, 14100),
    mkRow(6, 'ZONE_HAWK', '82.8%', '27', 27, username, 13500),
  ];
}

export function getMockCrewRows(metric, username) {
  if (metric === 'wins') {
    return [
      mkRow(1, 'VETERAN_BLUE', '91%', '12', 12, username, 18000),
      mkRow(2, 'STRIKE_KING', '89%', '10', 10, username, 14200),
      mkRow(3, normalizeUser(username), '88%', '8', 8, username, 9800),
      mkRow(4, 'ZONE_HAWK', '87%', '7', 7, username, 12800),
      mkRow(5, 'CALL_MASTER', '86%', '6', 6, username, 11900),
    ].map((r) => ({ ...r, accuracy: r.accuracy, score: String(r.score_raw) }));
  }
  if (metric === 'streak') {
    return [
      mkRow(1, 'LEGEND_UMPIRE', '89%', '47', 47, username, 22000),
      mkRow(2, 'STREAK_MACHINE', '87%', '42', 42, username, 19800),
      mkRow(3, 'HOT_HAND', '86%', '38', 38, username, 6200),
      mkRow(4, normalizeUser(username), '84%', '31', 31, username, 5400),
      mkRow(5, 'BORDERLINE_BOB', '83%', '29', 29, username, 5800),
    ].map((r) => ({ ...r, score: String(r.score_raw) }));
  }
  return [
    mkRow(1, 'LEGEND_UMPIRE', '12,400 XP', '13', 13400, username, 13400),
    mkRow(2, 'STRIKE_KING', '11,200 XP', '12', 12200, username, 12200),
    mkRow(3, 'ZONE_HAWK', '10,500 XP', '11', 11500, username, 11500),
    mkRow(4, normalizeUser(username), '9,800 XP', '10', 9800, username, 9800),
    mkRow(5, 'CALL_MASTER', '9,100 XP', '10', 9100, username, 9100),
    mkRow(6, 'PLATE_POLICE', '8,400 XP', '9', 8400, username, 8400),
  ].map((r) => ({
    ...r,
    score: String(Math.floor(r.xp / 1000) + 1),
    accuracy: `${r.xp.toLocaleString()} XP`,
  }));
}
