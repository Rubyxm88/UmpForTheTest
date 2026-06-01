/**
 * Audit MLB feed hands vs playlist vs 3D scene expectations for sample ABs.
 * Usage: node scripts/audit-handedness.js
 */
import * as THREE from 'three';
import {
  fetchGamePitches,
  atBatsToPlaylist,
  fetchMlbPlayerProfile,
  resolveMlbBatSide,
  resolveMlbPitchHand,
} from '../src/js/mlb-api.js';
import { normalizeRoleHand, isLeftHandCode } from '../src/js/hand-utils.js';

/** Sample ABs from May 28–30, 2026 (verified via MLB Stats API). */
const AUDIT_CASES = [
  {
    label: 'McGonigle vs Kay (Top 1)',
    gamePk: 824593,
    date: '2026-05-30',
    match: (ab) => ab[0]?.batter?.includes('McGonigle') && ab[0]?.inning === 1 && ab[0]?.is_top,
    expect: { batter: 'LHB', pitcher: 'LHP' },
  },
  {
    label: 'Dingler vs Kay (Top 1)',
    gamePk: 824593,
    date: '2026-05-30',
    match: (ab) => ab[0]?.batter?.includes('Dingler') && ab[0]?.inning === 1 && ab[0]?.is_top,
    expect: { batter: 'RHB', pitcher: 'LHP' },
  },
  {
    label: 'Tatis vs Griffin (Top 1)',
    gamePk: 822731,
    date: '2026-05-30',
    match: (ab) => ab[0]?.batter?.includes('Tatis') && ab[0]?.inning === 1 && ab[0]?.is_top,
    expect: { batter: 'RHB', pitcher: 'LHP' },
  },
  {
    label: 'Merrill vs Lord (Top 6)',
    gamePk: 822731,
    date: '2026-05-30',
    match: (ab) =>
      ab[0]?.batter?.includes('Merrill') &&
      ab[0]?.pitcher?.includes('Lord') &&
      ab[0]?.inning === 6,
    expect: { batter: 'LHB', pitcher: 'RHP' },
  },
];

/** Replicate scene.js pitcher/batter world-X rules (rotation.y = PI on mound). */
function sceneExpectations(pitcherHand, batterHand) {
  const pSide = normalizeRoleHand(pitcherHand, 'pitcher');
  const bSide = normalizeRoleHand(batterHand, 'batter');
  const pitcherGroup = new THREE.Group();
  pitcherGroup.rotation.y = Math.PI;
  pitcherGroup.position.set(0, 0.25, 60.5);
  const throwingArm = new THREE.Object3D();
  throwingArm.position.x = pSide === 'RHP' ? -0.55 : 0.55;
  throwingArm.position.y = 3.9;
  pitcherGroup.add(throwingArm);
  pitcherGroup.updateMatrixWorld(true);
  const hand = new THREE.Vector3(0, -0.75, 0);
  throwingArm.localToWorld(hand);

  const batterWorldX = bSide === 'LHB' ? -2.2 : 2.2;
  const batterScaleX = 1;

  return {
    pitcherSide: pSide,
    batterSide: bSide,
    throwingArmWorldX: hand.x,
    throwOnFirstBaseSide: hand.x > 0,
    batterWorldX,
    batterScaleX,
    batterOnFirstBaseSide: batterWorldX < 0,
  };
}

function handsFromAb(ab) {
  const first = ab[0] || {};
  return {
    batter: normalizeRoleHand(first.batter_hand, 'batter'),
    pitcher: normalizeRoleHand(first.pitcher_hand, 'pitcher'),
    pitchCount: ab.length,
    batterName: first.batter,
    pitcherName: first.pitcher,
    inning: first.inning,
    isTop: first.is_top,
    lastEvent: ab[ab.length - 1]?.ab_event || ab[ab.length - 1]?.call || '',
  };
}

async function auditCase(testCase) {
  const raw = await fetchGamePitches(testCase.gamePk);
  if (!raw?.length) {
    return { ...testCase, ok: false, error: 'No pitches returned from feed' };
  }
  const ab = raw.find(testCase.match);
  if (!ab) {
    return { ...testCase, ok: false, error: 'AB not found in feed' };
  }

  const feedHands = handsFromAb(ab);
  const playlist = atBatsToPlaylist([ab], {
    gamePk: testCase.gamePk,
    awayTeam: 'AWY',
    homeTeam: 'HOM',
    date: testCase.date,
  });
  const pl = playlist[0] || {};
  const playlistHands = {
    batter: normalizeRoleHand(pl.batter_hand, 'batter'),
    pitcher: normalizeRoleHand(pl.pitcher_hand, 'pitcher'),
  };

  const [batterProfile, pitcherProfile] = await Promise.all([
    fetchMlbPlayerProfile(feedHands.batterName, 'batter'),
    fetchMlbPlayerProfile(feedHands.pitcherName, 'pitcher'),
  ]);

  const profileHands = {
    batter: batterProfile?.hand ? normalizeRoleHand(batterProfile.hand, 'batter') : null,
    pitcher: pitcherProfile?.hand ? normalizeRoleHand(pitcherProfile.hand, 'pitcher') : null,
  };

  const scene = sceneExpectations(feedHands.pitcher, feedHands.batter);

  const feedOk =
    feedHands.batter === testCase.expect.batter &&
    feedHands.pitcher === testCase.expect.pitcher;
  const playlistOk =
    playlistHands.batter === testCase.expect.batter &&
    playlistHands.pitcher === testCase.expect.pitcher;
  const sceneOk =
    scene.batterWorldX === (testCase.expect.batter === 'LHB' ? -2.2 : 2.2) &&
    scene.throwOnFirstBaseSide === (testCase.expect.pitcher === 'RHP');

  return {
    label: testCase.label,
    gamePk: testCase.gamePk,
    ok: feedOk && playlistOk && sceneOk,
    feedHands,
    playlistHands,
    profileHands,
    expected: testCase.expect,
    scene,
    checks: { feedOk, playlistOk, sceneOk },
  };
}

async function main() {
  console.log('=== Handedness audit (MLB feed → playlist → 3D expectations) ===\n');
  let pass = 0;
  let fail = 0;

  for (const testCase of AUDIT_CASES) {
    const result = await auditCase(testCase);
    const icon = result.ok ? 'PASS' : 'FAIL';
    if (result.ok) pass += 1;
    else fail += 1;

    console.log(`[${icon}] ${result.label} (game ${result.gamePk})`);
    if (result.error) {
      console.log(`  ERROR: ${result.error}\n`);
      continue;
    }
    const h = result.feedHands;
    console.log(
      `  AB: ${h.batterName} (${h.batter}) vs ${h.pitcherName} (${h.pitcher}) — ${h.pitchCount} pitches, inn ${h.isTop ? 'Top' : 'Bot'} ${h.inning}, last: ${h.lastEvent}`
    );
    console.log(`  Expected: batter ${result.expected.batter}, pitcher ${result.expected.pitcher}`);
    console.log(`  Feed:     batter ${result.feedHands.batter}, pitcher ${result.feedHands.pitcher} ${result.checks.feedOk ? '✓' : '✗'}`);
    console.log(`  Playlist: batter ${result.playlistHands.batter}, pitcher ${result.playlistHands.pitcher} ${result.checks.playlistOk ? '✓' : '✗'}`);
    if (result.profileHands.batter || result.profileHands.pitcher) {
      console.log(
        `  Profile:  batter ${result.profileHands.batter ?? 'n/a'}, pitcher ${result.profileHands.pitcher ?? 'n/a'}`
      );
    }
    console.log(
      `  Scene:    batter box x=${result.scene.batterWorldX} (1B side=${result.scene.batterOnFirstBaseSide}), throw arm world x=${result.scene.throwingArmWorldX.toFixed(2)} (1B side=${result.scene.throwOnFirstBaseSide}) ${result.checks.sceneOk ? '✓' : '✗'}`
    );
    console.log('');
  }

  console.log(`Summary: ${pass} passed, ${fail} failed, ${AUDIT_CASES.length} total`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
