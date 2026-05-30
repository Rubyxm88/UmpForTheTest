import * as THREE from 'three';
import { getObfuscatedPitches } from '../data/pitches.js';
import { ORIOLES_GAME_DATA } from '../data/orioles_game.js';
import { WEEKLY_CHALLENGE_DATA } from '../data/weekly_challenge.js';
import { CLOSE_CHALLENGE_DATA } from '../data/close_challenge.js';
import { fetchTeamSchedule, fetchGameForDate, fetchGamePitches, fetchAllGamesForDate } from './mlb-api.js';
import { 
  hashPIN, 
  getProfile, 
  saveProfile, 
  getActiveSession, 
  saveActiveSession, 
  clearActiveSession, 
  getCachedGame, 
  saveCachedGame,
  migrateLegacyData
} from './db.js';
import {
  apiLogin,
  apiRegister,
  apiLogout,
  apiMe,
  apiSaveStats,
  apiFetchLeaderboard,
  apiSubmitLeaderboard,
  apiUpdatePin,
} from './api-client.js';
import { calculateTrajectoryPoints, isStrikeABS, getCrossingTime, getBallPositionAtTime } from './physics.js';
import { 
  initScene, 
  updateStrikeZone, 
  showStrikeZone,
  flashStrikeZonePreview,
  updateHolographicBatter,
  updateHolographicPitcher,
  animatePitcherWindup,
  animateBatterSwing,
  getPitcherHandWorldPosition,
  animateBallTo, 
  showBall, 
  setCameraAngle, 
  drawTrajectoryTrace, 
  drawCrossingMarker, 
  clearTrajectoryTrace, 
  setCatcherMittPosition,
  updateHolographicCatcher,
  setUmpireSlot,
  setUmpireHeight,
  showMannequins,
  getUmpireXOffset,
  getUmpireYOffset,
  setReviewingState,
  setCrossingMarkerVisible,
  updateNameplates,
  getDistanceToABSZone,
  render, 
  onResize,
  setMannequinOpacity,
  setBattersEyeColor,
  setZoomedIn,
  drawDimensionLine,
  clearDimensionLine,
  pickZoneDistanceLabelScreenPos,
  showSummaryPitchReview,
  highlightSummaryPitch,
  clearSummaryPitchReview,
  updateWelcomeCamera,
  getActiveCameraName,
  verifyAndForceUmpireCameraPosition,
} from './scene.js';
import {
  XP_PER_LEVEL,
  getLevelFromXp,
  getXpProgressInLevel,
  getLevelTier,
  isMilestoneLevel,
  applyLevelBadgeElement,
  formatLevelLabel,
  getAbXpBreakdown,
  setXpBarPercent,
} from './xp-levels.js';


// Game State Definitions
const STATES = {
  WELCOME: 'WELCOME',
  TEAM_SELECT: 'TEAM_SELECT',
  START: 'START',
  IDLE: 'IDLE',
  WINDUP: 'WINDUP',
  PITCHING: 'PITCHING',
  DECISION_PENDING: 'DECISION_PENDING',
  ABS_REVIEW: 'ABS_REVIEW',
  SCOREBOARD: 'SCOREBOARD'
};

let currentState = STATES.START;

// Welcome screen background demo pitching state
let demoPitchActive = false;
let demoPitchStartTime = 0;
let demoFlightStartTime = 0;
let demoPitchData = null;
let demoPitchTrajectory = null;
let demoPitchState = 'WINDUP';
let demoCooldownEnd = 0;

const demoPitches = [
  {
    pitch_type: 'Fastball',
    speed_mph: 97,
    release_pos_x: -1.6,
    release_pos_y: 50.0,
    release_pos_z: 5.9,
    vx0: 4.8,
    vy0: -142.0,
    vz0: -4.2,
    ax: -5.2,
    ay: 29.5,
    az: -31.0,
    sz_top: 3.4,
    sz_bot: 1.6,
    pitcher_hand: 'R',
    batter_hand: 'R'
  },
  {
    pitch_type: 'Slider',
    speed_mph: 86,
    release_pos_x: -1.8,
    release_pos_y: 50.0,
    release_pos_z: 5.7,
    vx0: 2.1,
    vy0: -126.0,
    vz0: -1.8,
    ax: 6.8,
    ay: 25.5,
    az: -33.5,
    sz_top: 3.3,
    sz_bot: 1.5,
    pitcher_hand: 'R',
    batter_hand: 'L'
  },
  {
    pitch_type: 'Curveball',
    speed_mph: 79,
    release_pos_x: -1.5,
    release_pos_y: 50.0,
    release_pos_z: 6.1,
    vx0: 3.5,
    vy0: -115.0,
    vz0: 2.2,
    ax: -8.0,
    ay: 23.0,
    az: -40.5,
    sz_top: 3.5,
    sz_bot: 1.7,
    pitcher_hand: 'R',
    batter_hand: 'R'
  }
];


// Game Modes: 'standard', 'orioles_full', 'weekly_challenge', 'daily_streak'
let gameMode = 'weekly_challenge';

// Count Tracking
let abBalls = 0;
let abStrikes = 0;
let inningOuts = 0;

// Session Statistics
let totalPitchesCount = 0;
let totalBattersFaced = 0;
let totalSessionK = 0;
let totalSessionBB = 0;
let totalSessionH = 0;
let totalSessionOuts = 0;

// Batter Stance/Swing Variables
let isBatterSwinging = false;
let swingOutcome = 'WHIFF'; 
let swingHitType = ''; 
let battedBallVel = new THREE.Vector3();
let wasSwingContact = false;
let releaseOffset = new THREE.Vector3();
const releaseBlendDuration = 0.15; 

let btnStartOriolesCritical, btnStartOriolesFull;
let outsIndicator;

// MVP Autoplay & Challenge state
let isGamePaused = false;
let autoPlayDelay = 2.0; // Seconds between actions
let autoPlayTimeout = null;
let reviewMinTimeElapsed = false; // Guard to prevent instant skip of preview
let activeGameIndex = 0; // Selected weekly game index (0-4)
let activeAbIndex = 0; // Current at-bat index in the active weekly game
let currentAbPitches = []; // Pitches sequence for the current at-bat
let activeAbPitchIndex = 0; // Current pitch index in the current at-bat
let completedABsCount = [0, 0, 0, 0, 0]; // Progress tracking for weekly games 1-5
let dnfDisconnectsCount = 0; // Tracks disconnect count
let isSessionOver = false;
let quickStartNextPitch = false;
let quickReviewStartTime = 0;
let quickReviewDelay = 0;
let quickReviewTimeLeft = 0;

// Sandbox/Tuning Settings Variables
let settingsTabGen, settingsTabSandbox, settingsContentGen, settingsContentSandbox, selectAutoplayDelay;
let selectReviewStyle, chkSzHelper, chkPitchClock, selectBattersEyeColor, rngMannequinOpacity, mannequinOpacityValue;
let quickPreviewControls, btnViewDetails, btnQuickContinue, quickContinueTimer, pitchDetailBug, pitchDetailType, pitchDetailSpeed, pitchDetailBreak, pitchDetailLoc, gameStatusBadge, gameStatusDot, gameStatusText;
let abStartOverlay, abStartPitcher, abStartPitcherHand, abStartBatter, abStartBatterHand, abStartTimerText, btnAbStartConfirm;
let abStartInning, abStartOuts, abStartScore, abStartBase1, abStartBase2, abStartBase3;
let abStartTimeout = null;
let abStartCountdownInterval = null;
let btnAbSummaryHome;
let abPitchCounter;
let btnStartWeeklyChallenge, weeklyChallengeProgressText, weeklyChallengeProgressBar;
let dailyMatchupTitle, dailyCompeteStatus, btnPlayDailyCompete, dailyHistoricList, dailyCompeteTeamSelect;
let activeDailyDate = "";

// Game Preview Modal Elements
let previewModalOverlay, previewModalTitle, previewModalDate;
let previewAwayLogo, previewAwayName, previewAwayScore;
let previewHomeLogo, previewHomeName, previewHomeScore;
let previewModalVenue, previewModalAbs, previewLoadingIndicator;
let btnPreviewModalStart, btnPreviewModalCancel;
let selectRateOfPlay;
let rateOfPlay = 'standard';
let recentGamesGrid, recentGamesDate, gameFinderDate, btnFindGames, gameFinderResults;
let detailModalInningsRow, detailModalAbGrid;


// Settings values
let reviewStyle = 'quick'; // 'quick' or 'full'
let showFlightSzHelper = false;
let enablePitchClock = true;

// Weekly Challenge Playlist Variables
let weeklyPlaylistABs = [];
let activeWeeklyAbIndex = 0;
let isTransitioningToSummary = false;
let cachedAbOutcomeText = "";
let summaryTimeout = null;

let lastAbOutcomeText = "";
let lastAbPitcher = "";
let lastAbBatter = "";
let lastAbBlurb = "";
let lastCompletedPitch = null;
let activeAbEnded = false;


// Timeout Bank Variables
let abOverviewSecondsUsed = 0;
let overviewTimerInterval = null;
let overviewSecondsLeft = 30;
let pauseStartTime = 0;

// Game Session Data
let pitchesList = [];
let currentPitchIndex = 0;
let currentPitch = null;
let pitchHistory = [];
let currentAbStartHistoryIndex = 0;

// Animation & Timing
const WINDUP_DURATION = 0.8; 
let windupStartTime = 0;
let pitchStartTime = 0;
let pitchTrajectory = null;
let timerInterval = null;
let timerSecondsLeft = 3;
let quickContinueInterval = null;
let pitchSpeedMultiplier = 1.0; 
let replayStartTime = 0;
const REPLAY_SPEED_MULTIPLIER = 0.18; 

let audioCtx = null;
let bgmInterval = null;
let bgmNextNoteTime = 0.0;
let bgmCurrentBeatIndex = 0;
let bgmMelodyNoteIndex = 0;
let bgmMelodyBeatRemaining = 0;
let bgmEnabled = false;
let audioFocusMuted = false;
let chkBgmEnabled = null;
let activeBgmTrack = 0;
let selBgmTrack = null;
let closeCallPill = null;
let closeCallDistText = null;
let btnAudioMute = null;
let svgAudioUnmuted = null;
let svgAudioMuted = null;

const BALLGAME_MELODY = [
  { note: 261.63, beats: 4 }, { note: 523.25, beats: 2 }, { note: 440.00, beats: 2 }, { note: 392.00, beats: 2 }, { note: 329.63, beats: 2 }, { note: 392.00, beats: 6 }, { note: 293.66, beats: 6 },
  { note: 261.63, beats: 4 }, { note: 523.25, beats: 2 }, { note: 440.00, beats: 2 }, { note: 392.00, beats: 2 }, { note: 329.63, beats: 2 }, { note: 392.00, beats: 12 },
  { note: 440.00, beats: 4 }, { note: 440.00, beats: 2 }, { note: 349.23, beats: 2 }, { note: 392.00, beats: 2 }, { note: 440.00, beats: 2 }, { note: 349.23, beats: 6 }, { note: 293.66, beats: 6 },
  { note: 440.00, beats: 4 }, { note: 440.00, beats: 2 }, { note: 440.00, beats: 2 }, { note: 493.88, beats: 2 }, { note: 523.25, beats: 2 }, { note: 587.33, beats: 4 }, { note: 493.88, beats: 2 }, { note: 392.00, beats: 6 },
  { note: 261.63, beats: 4 }, { note: 523.25, beats: 2 }, { note: 440.00, beats: 2 }, { note: 392.00, beats: 2 }, { note: 329.63, beats: 2 }, { note: 392.00, beats: 6 }, { note: 293.66, beats: 6 },
  { note: 261.63, beats: 4 }, { note: 293.66, beats: 2 }, { note: 311.13, beats: 2 }, { note: 329.63, beats: 2 }, { note: 349.23, beats: 2 }, { note: 392.00, beats: 4 }, { note: 440.00, beats: 2 }, { note: 493.88, beats: 6 },
  { note: 523.25, beats: 3 }, { note: 493.88, beats: 1 }, { note: 440.00, beats: 2 }, { note: 392.00, beats: 2 }, { note: 349.23, beats: 2 }, { note: 329.63, beats: 2 }, { note: 293.66, beats: 6 },
  { note: 293.66, beats: 3 }, { note: 329.63, beats: 1 }, { note: 349.23, beats: 2 }, { note: 392.00, beats: 4 }, { note: 493.88, beats: 2 }, { note: 523.25, beats: 6 }
];

const SUPER_UMPIRE_MELODY = [
  { note: 261.63, beats: 2 }, { note: 329.63, beats: 2 }, { note: 392.00, beats: 2 }, { note: 440.00, beats: 2 },
  { note: 466.16, beats: 2 }, { note: 440.00, beats: 2 }, { note: 392.00, beats: 2 }, { note: 329.63, beats: 2 },
  { note: 293.66, beats: 2 }, { note: 349.23, beats: 2 }, { note: 440.00, beats: 2 }, { note: 493.88, beats: 2 },
  { note: 523.25, beats: 4 }, { note: 392.00, beats: 4 },
  { note: 349.23, beats: 2 }, { note: 440.00, beats: 2 }, { note: 523.25, beats: 2 }, { note: 587.33, beats: 2 },
  { note: 659.25, beats: 2 }, { note: 587.33, beats: 2 }, { note: 523.25, beats: 2 }, { note: 440.00, beats: 2 },
  { note: 392.00, beats: 2 }, { note: 329.63, beats: 2 }, { note: 293.66, beats: 2 }, { note: 392.00, beats: 2 },
  { note: 261.63, beats: 4 }, { note: 0, beats: 4 }
];

const STADIUM_MEDLEY_MELODY = [
  { note: 392.00, beats: 3 }, { note: 523.25, beats: 3 }, { note: 659.25, beats: 3 }, { note: 783.99, beats: 6 },
  { note: 659.25, beats: 3 }, { note: 783.99, beats: 12 }, { note: 0, beats: 12 },
  { note: 392.00, beats: 2 }, { note: 392.00, beats: 2 }, { note: 440.00, beats: 2 }, { note: 392.00, beats: 2 },
  { note: 523.25, beats: 4 }, { note: 440.00, beats: 4 }, { note: 392.00, beats: 8 }, { note: 0, beats: 8 },
  { note: 440.00, beats: 2 }, { note: 440.00, beats: 2 }, { note: 493.88, beats: 2 }, { note: 440.00, beats: 2 },
  { note: 587.33, beats: 4 }, { note: 493.88, beats: 4 }, { note: 440.00, beats: 8 }, { note: 0, beats: 16 }
];

// Touch Swipe gesture variables
let touchStartX = 0;
let touchStartY = 0;
const SWIPE_THRESHOLD = 50; 

// DOM Elements cache
let startScreen, btnStartGame;
let hudHeader, pitchCounterText, ballsIndicator, strikesIndicator;
let scorebugBase1, scorebugBase2, scorebugBase3, scorebugInning, scorebugScore;
let userAbAccuracyText, umpAbAccuracyText, userWeeklyAccuracyText, btnShowUmpcard;
let umpcardOverlay, btnCloseUmpcard, btnCloseUmpcardBottom, umpcardStrikezoneCanvas;
let umpcardUserAcc, umpcardUmpAcc, umpcardTotalPitches, umpcardTotalCorrect;
let umpcardFavorTeam, umpcardFavorValue, umpcardRatingTitle, umpcardRatingDesc, activeMatchupText;
let btnMainMenu, selectInning, inningCard;
let toastMessage, cameraControlsPanel, camBtnUmp, camBtnSide, camBtnTop, btnSettingsToggle;
let decisionPrompt, timerProgressRing, timerCountdownText, btnBall, btnStrike;
let btnPlayPitch, absBroadcastOverlay, btnBroadcastContinue, hudKeyboardHelp;
let absTeamLogo, absTeamNameText, absRulingDot, absRulingText, absResultTitle, absResultValue;
let absStatType, absStatSpeed, absStatBreak, absStatHeight, absStatBlurb;
let scoreboardScreen, finalUserAccuracy, finalUserStats, finalUmpAccuracy, finalUmpStats;
let finalEvalRating, finalEvalDesc, scoreboardTableBody, btnRestartGame, btnScoreboardHome, btnScoreboardLeaderboard;

// Dashboard Tab elements
let tabBtnPlay, tabBtnLeaderboard, tabBtnStats;
let tabContentPlay, tabContentLeaderboard, tabContentStats;
let btnStartDailyStreak;

// New Overlays & Controls from Redesign
let welcomeScreen, btnWelcomeStart, teamSelectScreen, btnConfirmTeam, userFavoriteTeamBadge;
let teamGridContainer, dashboardGamesList, finalScorecardRe24;
let activeFavoriteTeam = null;
let activeDailyTeam = null;
let confirmModalOverlay, btnConfirmModalYes, btnConfirmModalNo;
let challengeDetailModalOverlay, challengeDetailTitle, challengeDetailSubtitle, challengeDetailDesc;
let challengeDetailGamesCount, challengeDetailBestStreak, challengeDetailCompleted;
let btnChallengeDetailClose, btnChallengeDetailPlay, challengeDetailLeaderboardBody;
let btnInfoWeeklyChallenge, btnInfoStreakChallenge;

// Overlays
let abSummaryOverlay, abSummaryTitle, abSummaryMatchup, abSummaryAccuracy, abSummaryPitches, abSummaryBlurb, abSummaryFilmLink, abSummaryScorecardLink, btnAbSummaryAdvance;
let pauseScreen, btnResumeGame;
let matchupCard, cardPitcherName, cardPitcherHand, cardBatterName, cardBatterHand, replayBadge;

// Player Card Modal variables
let playerCardModalOverlay, btnClosePlayerModal, playerModalImg, playerModalTeamLogo;
let playerModalRole, playerModalName, playerModalTeam, playerModalStatsGrid;
let playerModalHand, playerModalHeightWeight;

// UI Mode Switcher
let btnUiClassic, btnUiAdaptive, btnUiCinematic;
// Pause Screen Stats & Buttons
let pauseModeText, pauseInningOutsText, pauseScoreText, pauseAccText, btnPauseRestart, btnPauseHome, pauseProgressRow, pauseProgressText;
// Matchup Card Image/Logos/Stats
let cardPitcherImg, cardPitcherLogo, cardPitcherStats, cardBatterImg, cardBatterLogo, cardBatterStats, matchupGameTitle, matchupGameDate;
// At-Bat Summary Matrix SVG & Pitch Details
let abSummaryMatrixSvg, abSummarySvgPitches, abSummaryPitchDetails;
let activeUiMode = 'classic'; // 'classic' | 'adaptive' | 'cinematic'

// Arcade Login Form elements
let loginHandleInput, loginPinInput, loginErrorMsg, btnStatsLogout;
let loginConfirmBox, btnLoginConfirmCreate, btnLoginConfirmCancel;
let profileFavTeamSelect, profileFavTeamLogo, profileNewPin, profileNewPinConfirm, btnProfileSavePin, profilePinMsg, teamSearchInput, dailyAttemptStatus, btnHudLogout;

// Collapsible Matchup Card elements
let btnMatchupToggle;

// Settings elements
let btnCloseSettings, btnDashboardSettingsToggle;
let settingsUiClassic, settingsUiAdaptive, settingsUiCinematic;

// Split Summary card elements
let abSummaryPitcherImg, abSummaryPitcherLogo, abSummaryPitcherName, abSummaryPitcherHandBadge;
let abSummaryBatterImg, abSummaryBatterLogo, abSummaryBatterName, abSummaryBatterHandBadge;
let abSummaryPitchList, abSummaryCorrectCount;
let abSummaryWeeklyChallengeDetails, abSummaryWeeklyProgressText, abSummaryWeeklyProgressBar, abSummaryWeeklyAccuracyText;
let abSummaryWeeklyCount, abSummaryWeeklyTotal, abSummaryLeaderboardSnippet;
let btnAbSummaryToggleReview, abSummaryReviewSection, challengeTrackerHud;
let levelUpOverlay, levelUpBadge, levelUpTitle, levelUpSubtitle;
let abSummaryReviewExpanded = false;
let abSummarySelectedPitchIndex = null;

// Matchup Walkup card (ab-start-overlay) faceoff elements
let abStartPitcherImg, abStartPitcherLogo, abStartPitcherStats;
let abStartBatterImg, abStartBatterLogo, abStartBatterStats;
let abStartPitcherName, abStartBatterName, btnAbStartExit;

// Leaderboard Buttons & Table
let leaderBtnWeekly, leaderBtnDaily, leaderBtnAlltime, leaderboardTableBody, leaderboardDivisionTitle;

let selectSpeed;
let isSettingsOpen = false;

let activeInning = 1;
let activeIsTop = true;



/**
 * Initializes the procedural Audio Context
 */
function initAudio() {
  if (audioCtx) return;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (AudioContextClass) {
    audioCtx = new AudioContextClass();
  }
}

function isGameAudioAllowed() {
  return !audioFocusMuted && document.visibilityState === 'visible' && document.hasFocus();
}

/** True when a menu screen or blocking overlay is up — no pitch/glove SFX. */
function isOverlayUiBlockingAudio() {
  const visible = (el) =>
    el && el.classList.contains('opacity-100') && !el.classList.contains('hidden');
  return (
    isGamePaused ||
    visible(pauseScreen) ||
    visible(welcomeScreen) ||
    visible(teamSelectScreen) ||
    visible(startScreen) ||
    visible(scoreboardScreen) ||
    visible(abStartOverlay) ||
    visible(abSummaryOverlay)
  );
}

function isMenuGameState() {
  return (
    currentState === STATES.WELCOME ||
    currentState === STATES.TEAM_SELECT ||
    currentState === STATES.START ||
    currentState === STATES.SCOREBOARD
  );
}

/** Pitch-flight / glove / whoosh — only during live at-bat, not menus or overlays. */
function isGameplayAudioAllowed() {
  if (!isGameAudioAllowed()) return false;
  if (isMenuGameState()) return false;
  if (isOverlayUiBlockingAudio()) return false;
  return true;
}

function setGameAudioFocusMuted(muted) {
  audioFocusMuted = muted;
  if (bgmInterval) {
    clearInterval(bgmInterval);
    bgmInterval = null;
  }
  if (!audioCtx) return;
  if (muted) {
    audioCtx.suspend().catch(() => {});
  } else if (document.hasFocus() && document.visibilityState === 'visible') {
    audioCtx.resume().catch(() => {});
  }
}

function updateHudKeyboardHelpVisibility() {
  if (!hudKeyboardHelp) return;
  const isMobile = window.matchMedia('(max-width: 768px)').matches;
  if (isMobile) {
    hudKeyboardHelp.classList.add('hidden');
    return;
  }
  hudKeyboardHelp.classList.remove('hidden');
}

function setMarqueePlayerName(primaryEl, dupSelectorOrEl, name, options = {}) {
  if (!primaryEl) return;
  const raw = name || '--';
  const text = options.uppercase ? raw.toUpperCase() : raw;
  primaryEl.textContent = text;
  const wrap = primaryEl.closest('.name-marquee-wrap');
  let dupEl = null;
  if (typeof dupSelectorOrEl === 'string' && wrap) {
    dupEl = wrap.querySelector(dupSelectorOrEl);
  } else if (dupSelectorOrEl instanceof Element) {
    dupEl = dupSelectorOrEl;
  }
  if (dupEl) dupEl.textContent = text;
  if (!wrap) return;

  const measureMarquee = () => {
    wrap.classList.remove('name-marquee-wrap--scroll');
    if (wrap.clientWidth === 0) return;
    const textWidth = primaryEl.scrollWidth;
    const needsScroll = textWidth > wrap.clientWidth + 2;
    wrap.classList.toggle('name-marquee-wrap--scroll', needsScroll);
  };

  requestAnimationFrame(measureMarquee);
  requestAnimationFrame(() => requestAnimationFrame(measureMarquee));
}

function hideAbSummaryXpPopover() {
  const pop = document.getElementById('ab-summary-xp-popover');
  const btn = document.getElementById('ab-summary-xp-earned');
  if (pop) pop.classList.add('hidden');
  if (btn) btn.setAttribute('aria-expanded', 'false');
}

function toggleAbSummaryXpPopover() {
  const pop = document.getElementById('ab-summary-xp-popover');
  const btn = document.getElementById('ab-summary-xp-earned');
  if (!pop || !btn) return;
  const open = pop.classList.contains('hidden');
  if (open) {
    pop.classList.remove('hidden');
    btn.setAttribute('aria-expanded', 'true');
  } else {
    hideAbSummaryXpPopover();
  }
}

function renderAbSummaryXpPopover(xpBreakdown, correctCount, isPerfect) {
  const list = document.getElementById('ab-summary-xp-popover-list');
  const totalEl = document.getElementById('ab-summary-xp-popover-total');
  if (!list) return;

  list.innerHTML = '';
  const rows = [
    { label: `Correct calls (${correctCount})`, pts: `+${xpBreakdown.pitchXp}`, sub: '10 XP each' },
  ];
  if (xpBreakdown.bonusXp > 0) {
    rows.push({ label: 'Perfect at-bat bonus', pts: `+${xpBreakdown.bonusXp}`, sub: 'All calls correct' });
  }

  rows.forEach((row) => {
    const li = document.createElement('li');
    li.className = 'ab-summary-xp-popover-row';
    li.innerHTML = `
      <div class="ab-summary-xp-popover-row-label">
        <span>${row.label}</span>
        <span class="ab-summary-xp-popover-row-sub">${row.sub}</span>
      </div>
      <span class="ab-summary-xp-popover-row-pts">${row.pts}</span>
    `;
    list.appendChild(li);
  });

  if (totalEl) totalEl.textContent = `+${xpBreakdown.total}`;
  hideAbSummaryXpPopover();
}

let abSummaryXpPopoverBound = false;
function bindAbSummaryXpPopoverOnce() {
  if (abSummaryXpPopoverBound) return;
  abSummaryXpPopoverBound = true;
  const btn = document.getElementById('ab-summary-xp-earned');
  if (btn) {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleAbSummaryXpPopover();
    });
  }
  document.addEventListener('click', (e) => {
    const wrap = document.querySelector('.ab-summary-xp-earned-wrap');
    if (wrap && !wrap.contains(e.target)) hideAbSummaryXpPopover();
  });
}

function hideGameplayHudForSummary(hide) {
  document.body.classList.toggle('ab-summary-active', hide);
  const profileHud = document.getElementById('main-top-nav');
  if (profileHud) {
    const show = !hide && localStorage.getItem('ump_username') !== null;
    setOverlayVisible(profileHud, show);
  }
  if (matchupCard) {
    setOverlayVisible(matchupCard, !hide);
  }
  if (gameStatusBadge) {
    setOverlayVisible(gameStatusBadge, !hide);
  }
  if (closeCallPill && hide) {
    closeCallPill.classList.add('opacity-0', 'scale-95');
    closeCallPill.classList.remove('opacity-100', 'scale-100');
  }
  setChallengeTrackerHudVisible(!hide);
}

/**
 * Plays a procedurally synthesized catcher's leather glove "pop" sound
 */
function playGlovePopSound() {
  if (!audioCtx || !isGameplayAudioAllowed()) return;
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }

  const now = audioCtx.currentTime;
  
  // 1. Heavy low-frequency pocket thud
  const osc = audioCtx.createOscillator();
  const gainOsc = audioCtx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(160, now);
  osc.frequency.exponentialRampToValueAtTime(45, now + 0.09);
  gainOsc.gain.setValueAtTime(0.9, now);
  gainOsc.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
  
  osc.connect(gainOsc);
  gainOsc.connect(audioCtx.destination);
  osc.start(now);
  osc.stop(now + 0.09);

  // 2. Leather slap high-frequency pop (Q-filtered white noise)
  const bufferSize = audioCtx.sampleRate * 0.08; 
  const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  
  const noiseSource = audioCtx.createBufferSource();
  noiseSource.buffer = buffer;
  
  const filter = audioCtx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(1100, now);
  filter.Q.setValueAtTime(4.0, now);
  
  const gainNoise = audioCtx.createGain();
  gainNoise.gain.setValueAtTime(1.4, now);
  gainNoise.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
  
  noiseSource.connect(filter);
  filter.connect(gainNoise);
  gainNoise.connect(audioCtx.destination);
  
  noiseSource.start(now);
  noiseSource.stop(now + 0.08);
}

/**
 * Plays a click sound for the timer tick
 */
function playTimerTickSound() {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  
  osc.type = 'sine';
  osc.frequency.setValueAtTime(880, now);
  gain.gain.setValueAtTime(0.06, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
  
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(now);
  osc.stop(now + 0.04);
}

/**
 * Synthesizes a rapid correct-call success chime (C5 -> E5 -> G5 rapid sequence)
 */
function playSuccessChime() {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  const frequencies = [523.25, 659.25, 783.99]; // C5, E5, G5
  
  frequencies.forEach((freq, idx) => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, now + idx * 0.08);
    
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.2, now + idx * 0.08 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.08 + 0.25);
    
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(now + idx * 0.08);
    osc.stop(now + idx * 0.08 + 0.3);
  });
}

function playPauseSound() {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(220, now);
  osc.frequency.exponentialRampToValueAtTime(110, now + 0.3);
  
  gain.gain.setValueAtTime(0.2, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
  
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(now);
  osc.stop(now + 0.3);
}

function playResumeSound() {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  
  osc.type = 'sine';
  osc.frequency.setValueAtTime(147, now);
  osc.frequency.exponentialRampToValueAtTime(294, now + 0.2);
  
  gain.gain.setValueAtTime(0.15, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
  
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(now);
  osc.stop(now + 0.2);
}

/**
 * Synthesizes an incorrect-call error buzzer sound
 */
function playErrorBuzz() {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  
  const osc1 = audioCtx.createOscillator();
  const osc2 = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  
  osc1.type = 'sawtooth';
  osc1.frequency.setValueAtTime(130, now);
  osc1.frequency.exponentialRampToValueAtTime(95, now + 0.25);
  
  osc2.type = 'square';
  osc2.frequency.setValueAtTime(133, now);
  osc2.frequency.exponentialRampToValueAtTime(98, now + 0.25);
  
  const filter = audioCtx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(200, now);
  
  gain.gain.setValueAtTime(0.3, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
  
  osc1.connect(filter);
  osc2.connect(filter);
  filter.connect(gain);
  gain.connect(audioCtx.destination);
  
  osc1.start(now);
  osc2.start(now);
  osc1.stop(now + 0.25);
  osc2.stop(now + 0.25);
}

/**
 * Plays a fanfare when game is successfully completed
 */
function playFanfareSound() {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  const notes = [261.63, 329.63, 392.00, 523.25]; // C4, E4, G4, C5
  
  notes.forEach((freq, idx) => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, now + idx * 0.12);
    
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.15, now + idx * 0.12 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.12 + 0.5);
    
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(now + idx * 0.12);
    osc.stop(now + idx * 0.12 + 0.55);
  });
}

function playCoinSound() {
  return; // Removed — no login/start coin sound
  /* eslint-disable no-unreachable */
  if (!audioCtx) return;
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  const now = audioCtx.currentTime;
  const frequencies = [987.77, 1318.51]; // B5, E6
  frequencies.forEach((freq, idx) => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(freq, now + idx * 0.08);
    
    gain.gain.setValueAtTime(0.08, now + idx * 0.08);
    gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.08 + 0.25);
    
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(now + idx * 0.08);
    osc.stop(now + idx * 0.08 + 0.3);
  });
}

function getCurrentMelodyArray() {
  if (activeBgmTrack === 1) return SUPER_UMPIRE_MELODY;
  if (activeBgmTrack === 2) return STADIUM_MEDLEY_MELODY;
  return BALLGAME_MELODY;
}

function bgmScheduler() {
  if (!audioCtx) return;
  while (bgmNextNoteTime < audioCtx.currentTime + 0.1) {
    scheduleNextBgmStep(bgmNextNoteTime);
    advanceBgmStep();
  }
}

function advanceBgmStep() {
  const beatLen = 0.165; // eighth-note steps (approx 180 BPM for waltz, bouncy retro tempo)
  bgmNextNoteTime += beatLen;
  
  bgmMelodyBeatRemaining--;
  if (bgmMelodyBeatRemaining <= 0) {
    const melody = getCurrentMelodyArray();
    bgmMelodyNoteIndex++;
    if (bgmMelodyNoteIndex >= melody.length) {
      const oldTrack = activeBgmTrack;
      let nextTrack = Math.floor(Math.random() * 3);
      if (nextTrack === oldTrack) {
        nextTrack = (nextTrack + 1) % 3;
      }
      activeBgmTrack = nextTrack;
      if (selBgmTrack) selBgmTrack.value = activeBgmTrack;
      bgmMelodyNoteIndex = 0;
    }
    const nextMelody = getCurrentMelodyArray();
    bgmMelodyBeatRemaining = nextMelody[bgmMelodyNoteIndex].beats;
  }
  
  const activeLength = activeBgmTrack === 0 ? 6 : 8;
  bgmCurrentBeatIndex = (bgmCurrentBeatIndex + 1) % activeLength;
}

function getBassRootFreqForMelody(melodyFreq) {
  let freq = melodyFreq;
  if (freq >= 500) freq /= 2;
  if (freq < 260) freq *= 2;
  if (Math.abs(freq - 261.63) < 5) return 130.81; // C3
  if (Math.abs(freq - 293.66) < 5) return 146.83; // D3
  if (Math.abs(freq - 311.13) < 5) return 155.56; // D#3
  if (Math.abs(freq - 329.63) < 5) return 164.81; // E3
  if (Math.abs(freq - 349.23) < 5) return 174.61; // F3
  if (Math.abs(freq - 369.99) < 5) return 185.00; // F#3
  if (Math.abs(freq - 392.00) < 5) return 196.00; // G3
  if (Math.abs(freq - 440.00) < 5) return 220.00; // A3
  if (Math.abs(freq - 493.88) < 5) return 246.94; // B3
  return 130.81;
}

function scheduleNextBgmStep(time) {
  if (!bgmEnabled || !audioCtx) return;
  
  const melody = getCurrentMelodyArray();
  const currentMelody = melody[bgmMelodyNoteIndex];
  if (!currentMelody) return;
  
  if (bgmMelodyBeatRemaining === currentMelody.beats) {
    if (currentMelody.note > 0) {
      playSynthNote(currentMelody.note, currentMelody.beats * 0.165, 'square', 0.04, time);
    }
  }
  
  if (currentMelody.note > 0) {
    const rootFreq = getBassRootFreqForMelody(currentMelody.note);
    if (activeBgmTrack === 0) {
      // Waltz 3/4 (6 eighth-note steps)
      if (bgmCurrentBeatIndex === 0) {
        playSynthNote(rootFreq / 2, 0.3, 'triangle', 0.06, time);
      } else if (bgmCurrentBeatIndex === 2 || bgmCurrentBeatIndex === 4) {
        playSynthNote(rootFreq, 0.15, 'sine', 0.03, time);
        playSynthNote(rootFreq * 1.5, 0.15, 'sine', 0.02, time);
      }
    } else {
      // 4/4 (8 eighth-note steps)
      if (bgmCurrentBeatIndex === 0 || bgmCurrentBeatIndex === 4) {
        playSynthNote(rootFreq / 2, 0.3, 'triangle', 0.06, time);
      } else if (bgmCurrentBeatIndex === 2 || bgmCurrentBeatIndex === 6) {
        playSynthNote(rootFreq, 0.15, 'sine', 0.03, time);
        playSynthNote(rootFreq * 1.5, 0.15, 'sine', 0.02, time);
      }
    }
  }
}

function playSynthNote(freq, duration, type, gainValue, time) {
  if (!audioCtx || freq <= 0) return;
  
  const osc = audioCtx.createOscillator();
  const gainNode = audioCtx.createGain();
  
  osc.type = type;
  osc.frequency.setValueAtTime(freq, time);
  
  gainNode.gain.setValueAtTime(0, time);
  gainNode.gain.linearRampToValueAtTime(gainValue, time + 0.01);
  gainNode.gain.exponentialRampToValueAtTime(0.001, time + duration);
  
  osc.connect(gainNode);
  gainNode.connect(audioCtx.destination);
  
  osc.start(time);
  osc.stop(time + duration);
}

function updateMuteButtonUI() {
  if (!svgAudioUnmuted || !svgAudioMuted) return;
  if (bgmEnabled) {
    svgAudioUnmuted.classList.remove('hidden');
    svgAudioMuted.classList.add('hidden');
  } else {
    svgAudioUnmuted.classList.add('hidden');
    svgAudioMuted.classList.remove('hidden');
  }
}

function startBgm() {
  // Background music removed — keep stub so callers don't break
  bgmEnabled = false;
  if (bgmInterval) {
    clearInterval(bgmInterval);
    bgmInterval = null;
  }
}

function playBallWhooshSound(speedMph) {
  if (!audioCtx || !isGameplayAudioAllowed()) return;
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  const now = audioCtx.currentTime;
  const duration = Math.max(0.25, Math.min(0.8, 40 / (speedMph || 90)));
  const bufferSize = audioCtx.sampleRate * duration;
  const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  
  const noiseSource = audioCtx.createBufferSource();
  noiseSource.buffer = buffer;
  
  const filter = audioCtx.createBiquadFilter();
  filter.type = 'bandpass';
  
  const startFreq = 200 + (speedMph - 70) * 4;
  const endFreq = 900 + (speedMph - 70) * 12;
  
  filter.frequency.setValueAtTime(startFreq, now);
  filter.frequency.exponentialRampToValueAtTime(endFreq, now + duration);
  filter.Q.setValueAtTime(3.0, now);
  
  const gain = audioCtx.createGain();
  const volume = Math.max(0.1, Math.min(0.65, (speedMph - 50) / 60));
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(volume, now + duration * 0.7);
  gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
  
  noiseSource.connect(filter);
  filter.connect(gain);
  gain.connect(audioCtx.destination);
  
  noiseSource.start(now);
  noiseSource.stop(now + duration);
}

/**
 * Synthesizes a robotic 8-bit vowel/consonant syllable using parallel bandpass filters (F1/F2)
 */
function playVocalSyllable(options) {
  if (!audioCtx) return;
  const now = audioCtx.currentTime + (options.time || 0);
  const duration = options.duration || 0.25;
  const volume = (options.volume || 0.2) * (options.masterVolume || 1.0);
  
  // 1. Vocal Source: Sawtooth + Square oscillators for rich, detuned, buzzy 8-bit vocal chords
  let sourceNode = null;
  if (options.noiseMix === undefined || options.noiseMix < 1.0) {
    const osc1 = audioCtx.createOscillator();
    const osc2 = audioCtx.createOscillator();
    
    osc1.type = 'sawtooth';
    osc2.type = 'square';
    
    const baseFreq = options.pitch || 100;
    osc1.frequency.setValueAtTime(baseFreq, now);
    osc2.frequency.setValueAtTime(baseFreq * 1.015, now);
    
    if (options.pitchEnd) {
      osc1.frequency.exponentialRampToValueAtTime(options.pitchEnd, now + duration);
      osc2.frequency.exponentialRampToValueAtTime(options.pitchEnd * 1.015, now + duration);
    }
    
    const voiceGain = audioCtx.createGain();
    const voiceMix = 1.0 - (options.noiseMix || 0.0);
    voiceGain.gain.setValueAtTime(volume * voiceMix, now);
    voiceGain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    
    osc1.connect(voiceGain);
    osc2.connect(voiceGain);
    
    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + duration);
    osc2.stop(now + duration);
    
    sourceNode = voiceGain;
  }
  
  // 2. Fricative / Consonant Source: White Noise
  let noiseNode = null;
  if (options.noiseMix && options.noiseMix > 0.0) {
    const bufferSize = audioCtx.sampleRate * duration;
    const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    
    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    
    const noiseGain = audioCtx.createGain();
    noiseGain.gain.setValueAtTime(volume * options.noiseMix, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    
    source.connect(noiseGain);
    source.start(now);
    source.stop(now + duration);
    
    noiseNode = noiseGain;
  }
  
  // 3. Formant Bandpass Filters (F1 and F2 resonance peaks)
  const filter1 = audioCtx.createBiquadFilter();
  filter1.type = 'bandpass';
  filter1.frequency.setValueAtTime(options.f1Start || 600, now);
  if (options.f1End) {
    filter1.frequency.exponentialRampToValueAtTime(options.f1End, now + duration);
  }
  filter1.Q.setValueAtTime(options.q1 || 12, now);
  
  const filter2 = audioCtx.createBiquadFilter();
  filter2.type = 'bandpass';
  filter2.frequency.setValueAtTime(options.f2Start || 1200, now);
  if (options.f2End) {
    filter2.frequency.exponentialRampToValueAtTime(options.f2End, now + duration);
  }
  filter2.Q.setValueAtTime(options.q2 || 12, now);
  
  // Syllable Out Gain
  const outGain = audioCtx.createGain();
  outGain.gain.setValueAtTime(1.0, now);
  outGain.connect(audioCtx.destination);
  
  filter1.connect(outGain);
  filter2.connect(outGain);
  
  if (sourceNode) {
    sourceNode.connect(filter1);
    sourceNode.connect(filter2);
  }
  
  if (noiseNode) {
    if (options.noiseMix === 1.0) {
      // Pure sibilant ("S", "F", "Sh" - bypass formant filter for better sibilance)
      const noiseFilter = audioCtx.createBiquadFilter();
      noiseFilter.type = 'bandpass';
      noiseFilter.frequency.setValueAtTime(options.noiseFreq || 5000, now);
      noiseFilter.Q.setValueAtTime(3, now);
      noiseNode.connect(noiseFilter);
      noiseFilter.connect(outGain);
    } else {
      // Voiced consonant ("Z", "V")
      noiseNode.connect(filter1);
      noiseNode.connect(filter2);
    }
  }
}

/**
 * Procedural 8-bit speech synthesis voice callouts
 */
export function playUmpireVocalCall(callType) {
  if (!bgmEnabled) return;
  initAudio();
  if (!audioCtx) return;
  if (audioCtx.state === 'suspended') audioCtx.resume();
  
  const mVol = 1.25; // Vocal volume multiplier
  
  if (callType === 'STRIKE1' || callType === 'STRIKE2' || callType === 'STRIKE') {
    const pitch = callType === 'STRIKE2' ? 125 : 110;
    const pitchEnd = callType === 'STRIKE2' ? 95 : 85;
    
    // "S" sibilant
    playVocalSyllable({
      time: 0,
      duration: 0.08,
      noiseMix: 1.0,
      noiseFreq: 5500,
      volume: 0.12,
      masterVolume: mVol
    });
    // "Trai..." (Vowel blend Ah -> Ee)
    playVocalSyllable({
      time: 0.05,
      duration: 0.22,
      pitch: pitch,
      pitchEnd: pitchEnd,
      noiseMix: 0.15,
      f1Start: 750,
      f1End: 300,
      f2Start: 1200,
      f2End: 2100,
      volume: 0.25,
      masterVolume: mVol
    });
    // "K" pop
    playVocalSyllable({
      time: 0.24,
      duration: 0.04,
      noiseMix: 1.0,
      noiseFreq: 3500,
      volume: 0.08,
      masterVolume: mVol
    });
  }
  
  else if (callType === 'STRIKE3' || callType === 'STRIKE_THREE_OUT') {
    // "S-T-RAI-K" (high energy, intense)
    playVocalSyllable({
      time: 0,
      duration: 0.09,
      noiseMix: 1.0,
      noiseFreq: 6000,
      volume: 0.15,
      masterVolume: mVol
    });
    playVocalSyllable({
      time: 0.06,
      duration: 0.24,
      pitch: 135,
      pitchEnd: 90,
      noiseMix: 0.2,
      f1Start: 800, f1End: 320,
      f2Start: 1300, f2End: 2200,
      volume: 0.3,
      masterVolume: mVol
    });
    playVocalSyllable({
      time: 0.27,
      duration: 0.05,
      noiseMix: 1.0,
      noiseFreq: 3800,
      volume: 0.1,
      masterVolume: mVol
    });
    
    // "THREE"
    playVocalSyllable({
      time: 0.34,
      duration: 0.07,
      noiseMix: 1.0,
      noiseFreq: 4000,
      volume: 0.1,
      masterVolume: mVol
    });
    playVocalSyllable({
      time: 0.38,
      duration: 0.25,
      pitch: 110,
      pitchEnd: 130,
      f1Start: 280, f1End: 260,
      f2Start: 1800, f2End: 2300,
      volume: 0.24,
      masterVolume: mVol
    });
    
    // "OUT!"
    playVocalSyllable({
      time: 0.65,
      duration: 0.25,
      pitch: 130,
      pitchEnd: 85,
      noiseMix: 0.15,
      f1Start: 700, f1End: 350,
      f2Start: 1100, f2End: 800,
      volume: 0.32,
      masterVolume: mVol
    });
    playVocalSyllable({
      time: 0.88,
      duration: 0.05,
      noiseMix: 1.0,
      noiseFreq: 4500,
      volume: 0.12,
      masterVolume: mVol
    });
  }
  
  else if (callType === 'BALL') {
    // "B-AW-L"
    playVocalSyllable({
      time: 0,
      duration: 0.04,
      pitch: 80,
      pitchEnd: 95,
      f1Start: 250, f1End: 350,
      f2Start: 600, f2End: 800,
      volume: 0.18,
      masterVolume: mVol
    });
    playVocalSyllable({
      time: 0.03,
      duration: 0.24,
      pitch: 95,
      pitchEnd: 80,
      f1Start: 650, f1End: 400,
      f2Start: 850, f2End: 950,
      volume: 0.28,
      masterVolume: mVol
    });
  }
  
  else if (callType === 'WALK' || callType === 'BALL_FOUR_WALK') {
    // "BALL"
    playVocalSyllable({
      time: 0,
      duration: 0.04,
      pitch: 85,
      pitchEnd: 95,
      f1Start: 250, f1End: 350,
      f2Start: 600, f2End: 800,
      volume: 0.18,
      masterVolume: mVol
    });
    playVocalSyllable({
      time: 0.03,
      duration: 0.22,
      pitch: 95,
      pitchEnd: 85,
      f1Start: 650, f1End: 400,
      f2Start: 850, f2End: 950,
      volume: 0.24,
      masterVolume: mVol
    });
    
    // "FOUR"
    playVocalSyllable({
      time: 0.26,
      duration: 0.08,
      noiseMix: 1.0,
      noiseFreq: 4000,
      volume: 0.08,
      masterVolume: mVol
    });
    playVocalSyllable({
      time: 0.31,
      duration: 0.22,
      pitch: 90,
      pitchEnd: 75,
      f1Start: 500, f1End: 320,
      f2Start: 800, f2End: 700,
      volume: 0.26,
      masterVolume: mVol
    });
    
    // "WALK"
    playVocalSyllable({
      time: 0.56,
      duration: 0.22,
      pitch: 100,
      pitchEnd: 85,
      f1Start: 400, f1End: 600,
      f2Start: 700, f2End: 900,
      volume: 0.24,
      masterVolume: mVol
    });
    playVocalSyllable({
      time: 0.76,
      duration: 0.05,
      noiseMix: 1.0,
      noiseFreq: 3500,
      volume: 0.08,
      masterVolume: mVol
    });
  }
}

function playStrikeCallSound() {
  if (!bgmEnabled) return;
  
  // Vocal speech callout
  if (abStrikes === 2) {
    playUmpireVocalCall('STRIKE2');
  } else {
    playUmpireVocalCall('STRIKE1');
  }

  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  
  // 1. Sharp punchy noise burst (the transient breath of "STRIKE!")
  const bufferSize = audioCtx.sampleRate * 0.05;
  const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  const noise = audioCtx.createBufferSource();
  noise.buffer = buffer;
  const noiseFilter = audioCtx.createBiquadFilter();
  noiseFilter.type = 'bandpass';
  noiseFilter.frequency.setValueAtTime(1200, now);
  noiseFilter.Q.setValueAtTime(5.0, now);
  
  const noiseGain = audioCtx.createGain();
  noiseGain.gain.setValueAtTime(0.15, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
  
  noise.connect(noiseFilter);
  noiseFilter.connect(noiseGain);
  noiseGain.connect(audioCtx.destination);
  noise.start(now);
  noise.stop(now + 0.05);

  // 2. High-energy, soaring retro chord (resonant C5/E5/G5 with quick sweep)
  const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
  notes.forEach((freq, idx) => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = idx === 3 ? 'square' : 'triangle'; // C6 is square for retro sparkle
    osc.frequency.setValueAtTime(freq - 50, now);
    osc.frequency.exponentialRampToValueAtTime(freq, now + 0.08); // Quick upward flex
    
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.18, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    
    const filter = audioCtx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(freq * 1.5, now);
    filter.Q.setValueAtTime(3.0, now);
    
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(audioCtx.destination);
    
    osc.start(now);
    osc.stop(now + 0.25);
  });
}

function playBallCallSound() {
  if (!bgmEnabled) return;
  
  // Vocal speech callout
  if (abBalls === 4) {
    playUmpireVocalCall('WALK');
  } else {
    playUmpireVocalCall('BALL');
  }

  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  
  // A pleasant, round, organic sine wave bubble pop
  const osc1 = audioCtx.createOscillator();
  const osc2 = audioCtx.createOscillator();
  const gain1 = audioCtx.createGain();
  const gain2 = audioCtx.createGain();
  
  osc1.type = 'sine';
  osc1.frequency.setValueAtTime(261.63, now); // C4
  osc1.frequency.exponentialRampToValueAtTime(196.00, now + 0.15); // Descend to G3
  
  osc2.type = 'sine';
  osc2.frequency.setValueAtTime(329.63, now); // E4
  osc2.frequency.exponentialRampToValueAtTime(220.00, now + 0.15); // Descend to A3
  
  gain1.gain.setValueAtTime(0.2, now);
  gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
  
  gain2.gain.setValueAtTime(0.15, now);
  gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
  
  osc1.connect(gain1);
  gain1.connect(audioCtx.destination);
  
  osc2.connect(gain2);
  gain2.connect(audioCtx.destination);
  
  osc1.start(now);
  osc2.start(now);
  osc1.stop(now + 0.2);
  osc2.stop(now + 0.2);
}

function playStrikeoutSirenSound() {
  if (!bgmEnabled) return;
  
  // Vocal speech callout
  playUmpireVocalCall('STRIKE3');

  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  const duration = 1.0;
  const oscSiren = audioCtx.createOscillator();
  const gainSiren = audioCtx.createGain();
  oscSiren.type = 'sawtooth';
  oscSiren.frequency.setValueAtTime(440, now);
  
  for (let t = 0; t < duration; t += 0.1) {
    oscSiren.frequency.linearRampToValueAtTime(660, now + t + 0.05);
    oscSiren.frequency.linearRampToValueAtTime(330, now + t + 0.1);
  }
  
  const filter = audioCtx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(500, now);
  
  gainSiren.gain.setValueAtTime(0.12, now);
  gainSiren.gain.exponentialRampToValueAtTime(0.001, now + duration);
  
  oscSiren.connect(filter);
  filter.connect(gainSiren);
  gainSiren.connect(audioCtx.destination);
  oscSiren.start(now);
  oscSiren.stop(now + duration);
  
  const notes = [261.63, 311.13, 392.00, 523.25];
  notes.forEach((freq, idx) => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, now + idx * 0.1);
    
    gain.gain.setValueAtTime(0.15, now + idx * 0.1);
    gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.1 + 0.5);
    
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(now + idx * 0.1);
    osc.stop(now + idx * 0.1 + 0.55);
  });
}

function getNoiseBuffer() {
  if (!audioCtx) return null;
  const bufferSize = audioCtx.sampleRate * 1.0;
  const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

function playArcadeStartupSound() {
  if (!bgmEnabled) return;
  initAudio();
  if (!audioCtx) return;
  if (audioCtx.state === 'suspended') audioCtx.resume();
  
  const now = audioCtx.currentTime;
  const noiseBuffer = getNoiseBuffer();
  
  // --- "STRIKE!" ---
  // 1. "S" sibilant (noise bandpassed around 6000Hz)
  if (noiseBuffer) {
    const sNode = audioCtx.createBufferSource();
    sNode.buffer = noiseBuffer;
    const sFilter = audioCtx.createBiquadFilter();
    sFilter.type = 'bandpass';
    sFilter.frequency.setValueAtTime(6000, now);
    sFilter.Q.setValueAtTime(3, now);
    const sGain = audioCtx.createGain();
    sGain.gain.setValueAtTime(0.08, now);
    sGain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
    
    sNode.connect(sFilter);
    sFilter.connect(sGain);
    sGain.connect(audioCtx.destination);
    sNode.start(now);
    sNode.stop(now + 0.08);
  }
  
  // 2. "TR" sweep (low square wave)
  const trOsc = audioCtx.createOscillator();
  trOsc.type = 'square';
  trOsc.frequency.setValueAtTime(450, now + 0.04);
  trOsc.frequency.exponentialRampToValueAtTime(250, now + 0.12);
  const trGain = audioCtx.createGain();
  trGain.gain.setValueAtTime(0, now + 0.04);
  trGain.gain.linearRampToValueAtTime(0.06, now + 0.06);
  trGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
  trOsc.connect(trGain);
  trGain.connect(audioCtx.destination);
  trOsc.start(now + 0.04);
  trOsc.stop(now + 0.13);
  
  // 3. "IKE" sweep (rising sawtooth/square)
  const ikeOsc = audioCtx.createOscillator();
  ikeOsc.type = 'sawtooth';
  ikeOsc.frequency.setValueAtTime(300, now + 0.12);
  ikeOsc.frequency.linearRampToValueAtTime(800, now + 0.28);
  const ikeGain = audioCtx.createGain();
  ikeGain.gain.setValueAtTime(0, now + 0.12);
  ikeGain.gain.linearRampToValueAtTime(0.07, now + 0.14);
  ikeGain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
  ikeOsc.connect(ikeGain);
  ikeGain.connect(audioCtx.destination);
  ikeOsc.start(now + 0.12);
  ikeOsc.stop(now + 0.29);
  
  // --- "THREE!" ---
  // 4. "TH" sibilant (noise bandpassed around 4000Hz)
  if (noiseBuffer) {
    const thNode = audioCtx.createBufferSource();
    thNode.buffer = noiseBuffer;
    const thFilter = audioCtx.createBiquadFilter();
    thFilter.type = 'bandpass';
    thFilter.frequency.setValueAtTime(4000, now + 0.38);
    thFilter.Q.setValueAtTime(2, now + 0.38);
    const thGain = audioCtx.createGain();
    thGain.gain.setValueAtTime(0.04, now + 0.38);
    thGain.gain.exponentialRampToValueAtTime(0.001, now + 0.44);
    
    thNode.connect(thFilter);
    thFilter.connect(thGain);
    thGain.connect(audioCtx.destination);
    thNode.start(now + 0.38);
    thNode.stop(now + 0.44);
  }
  
  // 5. "REE!" (Detuned square wave trill)
  const osc1 = audioCtx.createOscillator();
  const osc2 = audioCtx.createOscillator();
  osc1.type = 'square';
  osc2.type = 'square';
  
  osc1.frequency.setValueAtTime(220, now + 0.42);
  osc2.frequency.setValueAtTime(223, now + 0.42);
  
  osc1.frequency.linearRampToValueAtTime(140, now + 0.55);
  osc2.frequency.linearRampToValueAtTime(142, now + 0.55);
  osc1.frequency.linearRampToValueAtTime(320, now + 0.95);
  osc2.frequency.linearRampToValueAtTime(323, now + 0.95);
  
  const lfo = audioCtx.createOscillator();
  const lfoGain = audioCtx.createGain();
  lfo.frequency.setValueAtTime(12, now + 0.42);
  lfoGain.gain.value = 15;
  lfo.connect(lfoGain);
  lfoGain.connect(osc1.frequency);
  lfoGain.connect(osc2.frequency);
  
  const reeGain = audioCtx.createGain();
  reeGain.gain.setValueAtTime(0, now + 0.42);
  reeGain.gain.linearRampToValueAtTime(0.09, now + 0.48);
  reeGain.gain.linearRampToValueAtTime(0.09, now + 0.75);
  reeGain.gain.exponentialRampToValueAtTime(0.001, now + 0.95);
  
  osc1.connect(reeGain);
  osc2.connect(reeGain);
  reeGain.connect(audioCtx.destination);
  
  lfo.start(now + 0.42);
  osc1.start(now + 0.42);
  osc2.start(now + 0.42);
  
  lfo.stop(now + 0.96);
  osc1.stop(now + 0.96);
  osc2.stop(now + 0.96);
}

function playCloseCallSound() {
  if (!bgmEnabled) return;
  initAudio();
  if (!audioCtx) return;
  if (audioCtx.state === 'suspended') audioCtx.resume();
  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(200, now);
  osc.frequency.linearRampToValueAtTime(600, now + 0.4);
  
  gain.gain.setValueAtTime(0.04, now);
  gain.gain.linearRampToValueAtTime(0.02, now + 0.2);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
  
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(now);
  osc.stop(now + 0.41);
}

function playMenuHoverSound() {
  if (!bgmEnabled) return;
  initAudio();
  if (!audioCtx) return;
  if (audioCtx.state === 'suspended') audioCtx.resume();
  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(600, now);
  osc.frequency.exponentialRampToValueAtTime(800, now + 0.05);
  
  gain.gain.setValueAtTime(0.015, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
  
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(now);
  osc.stop(now + 0.06);
}

function playMenuClickSound() {
  if (!bgmEnabled) return;
  initAudio();
  if (!audioCtx) return;
  if (audioCtx.state === 'suspended') audioCtx.resume();
  const now = audioCtx.currentTime;
  const osc1 = audioCtx.createOscillator();
  const gain1 = audioCtx.createGain();
  osc1.type = 'square';
  osc1.frequency.setValueAtTime(523.25, now);
  osc1.frequency.setValueAtTime(659.25, now + 0.06);
  
  gain1.gain.setValueAtTime(0.02, now);
  gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
  
  osc1.connect(gain1);
  gain1.connect(audioCtx.destination);
  osc1.start(now);
  osc1.stop(now + 0.16);
}

function playMenuTransitionSound() {
  if (!bgmEnabled) return;
  initAudio();
  if (!audioCtx) return;
  if (audioCtx.state === 'suspended') audioCtx.resume();
  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(300, now);
  osc.frequency.exponentialRampToValueAtTime(1200, now + 0.25);
  
  gain.gain.setValueAtTime(0.04, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
  
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(now);
  osc.stop(now + 0.26);
}

function bindRetroAudioToElements() {
  document.body.addEventListener('mouseenter', (e) => {
    const target = e.target.closest('button, a, select, input[type="checkbox"], input[type="radio"], .settings-tab');
    if (target) {
      playMenuHoverSound();
    }
  }, true);
  
  document.body.addEventListener('click', (e) => {
    const target = e.target.closest('button, a, select, input[type="checkbox"], input[type="radio"], .settings-tab');
    if (target) {
      if (target.disabled || target.classList.contains('pointer-events-none')) return;
      playMenuClickSound();
    }
  });
  
  document.body.addEventListener('change', (e) => {
    const target = e.target.closest('select, input[type="checkbox"], input[type="radio"]');
    if (target) {
      playMenuClickSound();
    }
  });
}


function normalizeHandle(handle) {
  return (handle || '').trim().toUpperCase();
}

function getStatsStorageKey(handle) {
  return `pitch_ump_stats_${normalizeHandle(handle)}`;
}

function requireLoggedInUser() {
  const username = normalizeHandle(localStorage.getItem('ump_username') || '');
  if (!username) {
    if (toastMessage) {
      toastMessage.innerHTML = '<span class="text-amber-300 font-bold font-mono-tech">LOG IN REQUIRED TO PLAY</span>';
      toastMessage.classList.remove('opacity-0', 'scale-95', '-translate-y-4');
      toastMessage.classList.add('opacity-100', 'scale-100', 'translate-y-0');
      setTimeout(() => {
        toastMessage.classList.add('opacity-0', 'scale-95', '-translate-y-4');
        toastMessage.classList.remove('opacity-100', 'scale-100', 'translate-y-0');
      }, 2800);
    }
    transitionToState(STATES.WELCOME);
    return null;
  }
  return username;
}

async function applyCloudSessionToLocal(handle, pinVal, cloud) {
  const normalized = normalizeHandle(handle);
  const stats = cloud.stats || {};
  const statsKey = getStatsStorageKey(normalized);
  localStorage.setItem(statsKey, JSON.stringify(stats));

  const pinHash = pinVal ? await hashPIN(pinVal) : (await getProfile(normalized))?.pinHash;
  await saveProfile({
    handle: normalized,
    pinHash: pinHash || '',
    favoriteTeam: cloud.favoriteTeam || stats.favoriteTeam || 'none',
    xp: stats.xp || 0,
    overallAccuracy: stats.overallAccuracy ?? null,
    maxStreak: stats.maxStreak || 0,
    completedWeekly: stats.completedWeekly || 0,
    dnfs: stats.dnfs || 0,
    history: stats.history || [],
  });

  if (cloud.favoriteTeam && cloud.favoriteTeam !== 'none') {
    activeFavoriteTeam = cloud.favoriteTeam;
    localStorage.setItem('pitch_ump_favorite_team', cloud.favoriteTeam);
  }
}

async function saveGlobalUser(handle, pin) {
  try {
    await apiUpdatePin(pin);
    const normalized = normalizeHandle(handle);
    const profile = await getProfile(normalized);
    if (profile) {
      profile.pinHash = await hashPIN(pin);
      delete profile.pin;
      await saveProfile(profile);
    }
  } catch (e) {
    console.warn('Error saving PIN to cloud:', e);
  }
}

async function getGlobalUserStats(handle) {
  const statsKey = getStatsStorageKey(handle);
  const fallback = JSON.parse(
    localStorage.getItem(statsKey) ||
      '{"overallAccuracy":null,"maxStreak":0,"completedWeekly":0,"dnfs":0,"history":[]}'
  );
  try {
    const me = await apiMe();
    if (me?.stats && normalizeHandle(me.handle) === normalizeHandle(handle)) {
      localStorage.setItem(statsKey, JSON.stringify(me.stats));
      return me.stats;
    }
  } catch (e) {
    console.warn(`Error fetching cloud stats for ${handle}:`, e);
  }
  return fallback;
}

async function saveGlobalUserStats(handle, stats) {
  const statsKey = getStatsStorageKey(handle);
  localStorage.setItem(statsKey, JSON.stringify(stats));
  try {
    await apiSaveStats(stats);
  } catch (e) {
    console.warn(`Error saving stats for ${handle} to cloud:`, e);
  }
}

function loginUserSession(handleVal) {
  const normalized = normalizeHandle(handleVal);
  localStorage.setItem('ump_username', normalized);
  localStorage.setItem('pitch_ump_last_handle', normalized);
  
  loadSavedSessionFromLocal();
  loadFavoriteTeam();
  updateProfileStatsUI();
  updateDailyStreakStatusUI();
  if (autoPlayTimeout) {
    clearTimeout(autoPlayTimeout);
    autoPlayTimeout = null;
  }
  pitchHistory = [];
  currentPitchIndex = 0;
  currentAbStartHistoryIndex = 0;
  abBalls = 0;
  abStrikes = 0;
  
  initProfileSettingsUI();
  
  if (activeFavoriteTeam) {
    transitionToState(STATES.START);
  } else {
    transitionToState(STATES.TEAM_SELECT);
  }
}

function initProfileSettingsUI() {
  if (!profileFavTeamSelect) return;
  
  profileFavTeamSelect.innerHTML = '<option value="none">SELECT FAVORITE TEAM</option>';
  TEAMS_LIST.forEach(team => {
    const opt = document.createElement('option');
    opt.value = team.name.toLowerCase();
    opt.textContent = team.name.toUpperCase();
    profileFavTeamSelect.appendChild(opt);
  });
  
  if (activeFavoriteTeam) {
    profileFavTeamSelect.value = activeFavoriteTeam.toLowerCase();
    if (profileFavTeamLogo) {
      profileFavTeamLogo.src = getTeamLogoUrl(activeFavoriteTeam);
    }
  } else {
    profileFavTeamSelect.value = "none";
    if (profileFavTeamLogo) {
      profileFavTeamLogo.src = "/generic.svg";
    }
  }
  
  profileFavTeamSelect.onchange = async function() {
    initAudio();
    const val = this.value;
    const currentHandle = localStorage.getItem('ump_username');
    if (val === 'none') {
      activeFavoriteTeam = null;
      localStorage.removeItem('pitch_ump_favorite_team');
      if (profileFavTeamLogo) profileFavTeamLogo.src = "/generic.svg";
      if (userFavoriteTeamBadge) userFavoriteTeamBadge.textContent = 'FAVORITE TEAM: NONE';
      
      if (currentHandle) {
        const stats = await getGlobalUserStats(currentHandle);
        stats.favoriteTeam = "none";
        await saveGlobalUserStats(currentHandle, stats);
      }
    } else {
      const team = TEAMS_LIST.find(t => t.name.toLowerCase() === val);
      if (team) {
        activeFavoriteTeam = team.name;
        localStorage.setItem('pitch_ump_favorite_team', team.name);
        if (profileFavTeamLogo) profileFavTeamLogo.src = getTeamLogoUrl(team.name);
        if (userFavoriteTeamBadge) userFavoriteTeamBadge.textContent = `FAVORITE TEAM: ${team.name.toUpperCase()}`;
        playCoinSound();
        
        if (currentHandle) {
          const stats = await getGlobalUserStats(currentHandle);
          stats.favoriteTeam = team.name;
          await saveGlobalUserStats(currentHandle, stats);
        }
      }
    }
  };
  
  if (btnProfileSavePin) {
    btnProfileSavePin.onclick = async function(e) {
      e.stopPropagation();
      initAudio();
      
      const newPinVal = profileNewPin ? profileNewPin.value.trim() : "";
      const confirmPinVal = profileNewPinConfirm ? profileNewPinConfirm.value.trim() : "";
      
      if (newPinVal !== confirmPinVal) {
        if (profilePinMsg) {
          profilePinMsg.textContent = "ERROR: NEW PIN AND CONFIRM PIN DO NOT MATCH!";
          profilePinMsg.className = "text-xs font-mono-tech text-red-400 mt-2 font-bold block";
        }
        return;
      }
      
      if (!/^\d{4,8}$/.test(newPinVal)) {
        if (profilePinMsg) {
          profilePinMsg.textContent = "ERROR: PIN MUST BE 4 TO 8 DIGITS";
          profilePinMsg.className = "text-xs font-mono-tech text-red-400 mt-2 font-bold block";
        }
        return;
      }
      
      const currentHandle = localStorage.getItem('ump_username');
      if (currentHandle) {
        if (profilePinMsg) {
          profilePinMsg.textContent = "UPDATING PIN PASSCODE...";
          profilePinMsg.classList.remove('hidden', 'text-red-400', 'text-emerald-400');
          profilePinMsg.classList.add('text-purple-400');
        }
        
        await saveGlobalUser(currentHandle, newPinVal);
        
        if (profilePinMsg) {
          profilePinMsg.textContent = "PIN SECURELY UPDATED!";
          profilePinMsg.classList.remove('text-purple-400');
          profilePinMsg.classList.add('text-emerald-400');
          if (profileNewPin) profileNewPin.value = "";
          if (profileNewPinConfirm) profileNewPinConfirm.value = "";
          setTimeout(() => {
            profilePinMsg.classList.add('hidden');
          }, 3000);
        }
        playCoinSound();
      }
    };
  }
}

/**
 * Initialize all DOM queries and attach event listeners
 */
export async function startGameSession() {
  if (WEEKLY_CHALLENGE_DATA.length < 6) {
    WEEKLY_CHALLENGE_DATA.push(CLOSE_CHALLENGE_DATA);
  }
  cacheDOM();
  document.addEventListener('click', () => {
    initAudio();
    playArcadeStartupSound();
    setTimeout(() => {
      startBgm();
    }, 1400);
  }, { once: true });
  
  // Migrate local storage users to IndexedDB
  await migrateLegacyData();
  
  const lastHandle = localStorage.getItem('pitch_ump_last_handle');
  if (lastHandle && loginHandleInput) {
    loginHandleInput.value = lastHandle;
  }
  attachEvents();
  initUiModeSwitcher();
  
  await loadSavedSessionFromLocal();
  loadFavoriteTeam();
  
  const storedUser = localStorage.getItem('ump_username');
  if (storedUser) {
    const handleNormalized = storedUser.toUpperCase();
    try {
      const me = await apiMe();
      if (me?.handle) {
        await applyCloudSessionToLocal(me.handle, null, me);
      }
    } catch (e) {
      console.warn('Could not refresh session from cloud:', e);
      const profile = await getProfile(handleNormalized);
      if (profile?.favoriteTeam && profile.favoriteTeam !== 'none') {
        activeFavoriteTeam = profile.favoriteTeam;
        localStorage.setItem('pitch_ump_favorite_team', profile.favoriteTeam);
        if (userFavoriteTeamBadge) {
          userFavoriteTeamBadge.textContent = `FAVORITE TEAM: ${profile.favoriteTeam.toUpperCase()}`;
        }
      }
    }
    await loadSavedSessionFromLocal();
    updateProfileStatsUI();
    initProfileSettingsUI();
    updateDailyStreakStatusUI();
  }
  
  initProfileSettingsUI();
  generateTeamSelectGrid();
  renderDashboardGamesList();
  updateDailyStreakStatusUI();
  
  const container = document.getElementById('canvas-container');
  const canvas = document.getElementById('three-canvas');
  
  initScene(container, canvas);
  
  window.addEventListener('resize', () => {
    onResize(container.clientWidth, container.clientHeight);
  });
  
  transitionToState(STATES.WELCOME);
  
  tick();
  
  // Fade out app launch loader after initialization
  setTimeout(() => {
    const loader = document.getElementById('app-launch-loader');
    if (loader) {
      loader.style.opacity = '0';
      loader.style.pointerEvents = 'none';
      setTimeout(() => {
        loader.style.display = 'none';
        
        // Trigger automated integration test if requested in URL
        if (window.location.search.includes('run_test=1')) {
          console.log("TEST: Initiating automated integration test...");
          setTimeout(() => {
            runAutomatedIntegrationTest();
          }, 1000);
        }
      }, 600);
    } else {
      if (window.location.search.includes('run_test=1')) {
        console.log("TEST: Initiating automated integration test (no loader)...");
        setTimeout(() => {
          runAutomatedIntegrationTest();
        }, 1000);
      }
    }
  }, 800);
}


function cacheDOM() {
  startScreen = document.getElementById('start-screen');
  btnStartGame = document.getElementById('btn-start-game');
  btnStartOriolesFull = document.getElementById('btn-start-orioles-full');
  
  hudHeader = document.getElementById('gameplay-nav-telemetry');
  pitchCounterText = document.getElementById('pitch-counter-text');
  ballsIndicator = document.getElementById('balls-indicator');
  strikesIndicator = document.getElementById('strikes-indicator');
  outsIndicator = document.getElementById('outs-indicator');
  userAbAccuracyText = document.getElementById('user-ab-accuracy-text');
  umpAbAccuracyText = document.getElementById('ump-ab-accuracy-text');
  userWeeklyAccuracyText = document.getElementById('user-weekly-accuracy-text');
  btnShowUmpcard = document.getElementById('btn-show-umpcard');

  umpcardOverlay = document.getElementById('umpcard-overlay');
  btnCloseUmpcard = document.getElementById('btn-close-umpcard');
  btnCloseUmpcardBottom = document.getElementById('btn-close-umpcard-bottom');
  umpcardStrikezoneCanvas = document.getElementById('umpcard-strikezone-canvas');
  umpcardUserAcc = document.getElementById('umpcard-user-acc');
  umpcardUmpAcc = document.getElementById('umpcard-ump-acc');
  umpcardTotalPitches = document.getElementById('umpcard-total-pitches');
  umpcardTotalCorrect = document.getElementById('umpcard-total-correct');
  umpcardFavorTeam = document.getElementById('umpcard-favor-team');
  umpcardFavorValue = document.getElementById('umpcard-favor-value');
  umpcardRatingTitle = document.getElementById('umpcard-rating-title');
  umpcardRatingDesc = document.getElementById('umpcard-rating-desc');
  activeMatchupText = document.getElementById('active-matchup-text');
  selectSpeed = document.getElementById('select-speed');
  selectAutoplayDelay = document.getElementById('select-autoplay-delay');
  if (selectAutoplayDelay) {
    autoPlayDelay = parseFloat(selectAutoplayDelay.value) || 2.0;
  }
  btnMainMenu = document.getElementById('btn-main-menu');
  selectInning = document.getElementById('select-inning');
  inningCard = document.getElementById('inning-card');
  
  toastMessage = document.getElementById('toast-message');
  cameraControlsPanel = document.getElementById('camera-controls-panel');
  btnSettingsToggle = document.getElementById('btn-global-settings-toggle');
  chkBgmEnabled = document.getElementById('chk-bgm-enabled');
  selBgmTrack = document.getElementById('sel-bgm-track');
  closeCallPill = document.getElementById('close-call-pill');
  closeCallDistText = document.getElementById('close-call-dist-text');
  btnAudioMute = document.getElementById('btn-global-audio-mute');
  svgAudioUnmuted = document.getElementById('svg-audio-unmuted');
  svgAudioMuted = document.getElementById('svg-audio-muted');
  scorebugBase1 = document.getElementById('scorebug-base1');
  scorebugBase2 = document.getElementById('scorebug-base2');
  scorebugBase3 = document.getElementById('scorebug-base3');
  scorebugInning = document.getElementById('scorebug-inning');
  scorebugScore = document.getElementById('scorebug-score');
  camBtnUmp = document.getElementById('cam-btn-ump');
  camBtnSide = document.getElementById('cam-btn-side');
  camBtnTop = document.getElementById('cam-btn-top');
  
  decisionPrompt = document.getElementById('decision-prompt');
  timerProgressRing = document.getElementById('countdown-timer-ring');
  timerCountdownText = document.getElementById('countdown-timer-text');
  btnBall = document.getElementById('btn-call-ball');
  btnStrike = document.getElementById('btn-call-strike');
  
  btnPlayPitch = document.getElementById('btn-play-pitch');
  
  absBroadcastOverlay = document.getElementById('abs-broadcast-overlay');
  btnBroadcastContinue = document.getElementById('btn-broadcast-continue');
  hudKeyboardHelp = document.getElementById('hud-keyboard-help');
  
  absTeamLogo = document.getElementById('abs-team-logo');
  absTeamNameText = document.getElementById('abs-team-name-text');
  absRulingDot = document.getElementById('abs-ruling-dot');
  absRulingText = document.getElementById('abs-ruling-text');
  absResultTitle = document.getElementById('abs-result-title');
  absResultValue = document.getElementById('abs-result-value');
  
  absStatType = document.getElementById('abs-stat-type');
  absStatSpeed = document.getElementById('abs-stat-speed');
  absStatBreak = document.getElementById('abs-stat-break');
  absStatHeight = document.getElementById('abs-stat-height');
  absStatBlurb = document.getElementById('abs-stat-blurb');

  scoreboardScreen = document.getElementById('scoreboard-screen');
  finalUserAccuracy = document.getElementById('final-user-accuracy');
  finalUserStats = document.getElementById('final-user-stats');
  finalUmpAccuracy = document.getElementById('final-ump-accuracy');
  finalUmpStats = document.getElementById('final-ump-stats');
  finalEvalRating = document.getElementById('final-eval-rating');
  finalEvalDesc = document.getElementById('final-eval-desc');
  scoreboardTableBody = document.getElementById('scoreboard-table-body');
  btnRestartGame = document.getElementById('btn-restart-game');
  btnScoreboardHome = document.getElementById('btn-scoreboard-home');
  btnScoreboardLeaderboard = document.getElementById('btn-scoreboard-leaderboard');

  // Tab elements
  tabBtnPlay = document.getElementById('tab-btn-play');
  tabBtnLeaderboard = document.getElementById('tab-btn-leaderboard');
  tabBtnStats = document.getElementById('tab-btn-stats');
  tabContentPlay = document.getElementById('tab-content-play');
  tabContentLeaderboard = document.getElementById('tab-content-leaderboard');
  tabContentStats = document.getElementById('tab-content-stats');
  btnStartDailyStreak = document.getElementById('btn-start-daily-streak');
  btnInfoWeeklyChallenge = document.getElementById('btn-info-weekly-challenge');
  btnInfoStreakChallenge = document.getElementById('btn-info-streak-challenge');

  challengeDetailModalOverlay = document.getElementById('challenge-detail-modal-overlay');
  challengeDetailTitle = document.getElementById('challenge-detail-title');
  challengeDetailSubtitle = document.getElementById('challenge-detail-subtitle');
  challengeDetailDesc = document.getElementById('challenge-detail-desc');
  challengeDetailGamesCount = document.getElementById('challenge-detail-games-count');
  challengeDetailBestStreak = document.getElementById('challenge-detail-best-streak');
  challengeDetailCompleted = document.getElementById('challenge-detail-completed');
  btnChallengeDetailClose = document.getElementById('btn-challenge-detail-close');
  btnChallengeDetailPlay = document.getElementById('btn-challenge-detail-play');
  challengeDetailLeaderboardBody = document.getElementById('challenge-detail-leaderboard-body');

  // Overlays
  abSummaryOverlay = document.getElementById('ab-summary-overlay');
  abSummaryTitle = document.getElementById('ab-summary-title');
  abSummaryMatchup = document.getElementById('ab-summary-matchup');
  abSummaryAccuracy = document.getElementById('ab-summary-accuracy');
  abSummaryPitches = document.getElementById('ab-summary-pitches');
  abSummaryBlurb = document.getElementById('ab-summary-blurb');
  abSummaryFilmLink = document.getElementById('ab-summary-film-link');
  abSummaryScorecardLink = document.getElementById('ab-summary-scorecard-link');
  btnAbSummaryAdvance = document.getElementById('btn-ab-summary-advance');

  pauseScreen = document.getElementById('pause-screen');
  btnResumeGame = document.getElementById('btn-resume-game');
  confirmModalOverlay = document.getElementById('confirm-modal-overlay');
  btnConfirmModalYes = document.getElementById('btn-confirm-modal-yes');
  btnConfirmModalNo = document.getElementById('btn-confirm-modal-no');

  // At-Bat Start Overlay
  abStartOverlay = document.getElementById('ab-start-overlay');
  abStartPitcher = document.getElementById('ab-start-pitcher');
  abStartPitcherHand = document.getElementById('ab-start-pitcher-hand');
  abStartBatter = document.getElementById('ab-start-batter');
  abStartBatterHand = document.getElementById('ab-start-batter-hand');
  abStartTimerText = document.getElementById('ab-start-timer-text');
  btnAbStartConfirm = document.getElementById('btn-ab-start-confirm');
  btnAbSummaryHome = document.getElementById('btn-ab-summary-home');
  abStartInning = document.getElementById('ab-start-inning');
  abStartOuts = document.getElementById('ab-start-outs');
  abStartScore = document.getElementById('ab-start-score');
  abStartBase1 = document.getElementById('base-1');
  abStartBase2 = document.getElementById('base-2');
  abStartBase3 = document.getElementById('base-3');

  // Sandbox Tab elements
  settingsTabGen = document.getElementById('settings-tab-gen');
  settingsTabSandbox = document.getElementById('settings-tab-sandbox');
  settingsContentGen = document.getElementById('settings-content-gen');
  settingsContentSandbox = document.getElementById('settings-content-sandbox');
  selectReviewStyle = document.getElementById('select-review-style');
  chkSzHelper = document.getElementById('chk-sz-helper');
  chkPitchClock = document.getElementById('chk-pitch-clock');
  selectBattersEyeColor = document.getElementById('select-batters-eye-color');
  rngMannequinOpacity = document.getElementById('rng-mannequin-opacity');
  mannequinOpacityValue = document.getElementById('mannequin-opacity-value');
  
  // Quick Preview Controls
  quickPreviewControls = document.getElementById('quick-preview-controls');
  btnViewDetails = document.getElementById('btn-view-details');
  btnQuickContinue = document.getElementById('btn-quick-continue');
  quickContinueTimer = document.getElementById('quick-continue-timer');
  
  // Pitch Detail Bug
  pitchDetailBug = document.getElementById('pitch-detail-bug');
  pitchDetailType = document.getElementById('pitch-detail-type');
  pitchDetailSpeed = document.getElementById('pitch-detail-speed');
  pitchDetailBreak = document.getElementById('pitch-detail-break');
  pitchDetailLoc = document.getElementById('pitch-detail-loc');
  
  // Game Status Bar
  gameStatusBadge = document.getElementById('game-status-badge');
  gameStatusDot = document.getElementById('game-status-dot');
  gameStatusText = document.getElementById('game-status-text');
  
  // AB Pitch Count HUD
  abPitchCounter = document.getElementById('ab-pitch-counter');
  
  // Weekly Challenge Buttons
  btnStartWeeklyChallenge = document.getElementById('btn-start-weekly-challenge');
  weeklyChallengeProgressText = document.getElementById('weekly-challenge-progress-text');
  weeklyChallengeProgressBar = document.getElementById('weekly-challenge-progress-bar');

  // Daily Compete Elements
  dailyMatchupTitle = document.getElementById('daily-matchup-title');
  dailyCompeteStatus = document.getElementById('daily-compete-status');
  btnPlayDailyCompete = document.getElementById('btn-play-daily-compete');
  dailyHistoricList = document.getElementById('daily-historic-list');
  dailyCompeteTeamSelect = document.getElementById('daily-compete-team-select');

  // Game Preview Modal Elements
  previewModalOverlay = document.getElementById('game-preview-modal-overlay');
  previewModalTitle = document.getElementById('preview-modal-title');
  previewModalDate = document.getElementById('preview-modal-date');
  previewAwayLogo = document.getElementById('preview-away-logo');
  previewAwayName = document.getElementById('preview-away-name');
  previewAwayScore = document.getElementById('preview-away-score');
  previewHomeLogo = document.getElementById('preview-home-logo');
  previewHomeName = document.getElementById('preview-home-name');
  previewHomeScore = document.getElementById('preview-home-score');
  previewModalVenue = document.getElementById('preview-modal-venue');
  previewModalAbs = document.getElementById('preview-modal-abs');
  previewLoadingIndicator = document.getElementById('preview-loading-indicator');
  btnPreviewModalStart = document.getElementById('btn-preview-modal-start');
  btnPreviewModalCancel = document.getElementById('btn-preview-modal-cancel');
  selectRateOfPlay = document.getElementById('select-rate-of-play');
  recentGamesGrid = document.getElementById('recent-games-grid');
  recentGamesDate = document.getElementById('recent-games-date');
  gameFinderDate = document.getElementById('game-finder-date');
  btnFindGames = document.getElementById('btn-find-games');
  gameFinderResults = document.getElementById('game-finder-results');
  detailModalInningsRow = document.getElementById('detail-modal-innings-row');
  detailModalAbGrid = document.getElementById('detail-modal-ab-grid');


  matchupCard = document.getElementById('gameplay-nav-telemetry');
  cardPitcherName = document.getElementById('card-pitcher-name');
  cardPitcherHand = document.getElementById('card-pitcher-hand');
  cardBatterName = document.getElementById('card-batter-name');
  cardBatterHand = document.getElementById('card-batter-hand');
  replayBadge = document.getElementById('replay-badge');

  // Redesign overlays & dynamic elements
  welcomeScreen = document.getElementById('welcome-screen');
  btnWelcomeStart = document.getElementById('btn-welcome-start');
  teamSelectScreen = document.getElementById('team-select-screen');
  btnConfirmTeam = document.getElementById('btn-confirm-team');
  userFavoriteTeamBadge = document.getElementById('user-favorite-team-badge');
  teamGridContainer = document.getElementById('team-grid-container');
  dashboardGamesList = document.getElementById('dashboard-games-list');
  finalScorecardRe24 = document.getElementById('final-scorecard-re24');

  // UI Switcher
  btnUiClassic = document.getElementById('btn-ui-classic');
  btnUiAdaptive = document.getElementById('btn-ui-adaptive');
  btnUiCinematic = document.getElementById('btn-ui-cinematic');

  // Pause Screen details & controls
  pauseModeText = document.getElementById('pause-mode-text');
  pauseInningOutsText = document.getElementById('pause-inning-outs-text');
  pauseScoreText = document.getElementById('pause-score-text');
  pauseAccText = document.getElementById('pause-acc-text');
  btnPauseRestart = document.getElementById('btn-pause-restart');
  btnPauseHome = document.getElementById('btn-pause-home');
  pauseProgressRow = document.getElementById('pause-progress-row');
  pauseProgressText = document.getElementById('pause-progress-text');

  // Matchup details
  cardPitcherImg = document.getElementById('card-pitcher-img');
  cardPitcherLogo = document.getElementById('card-pitcher-logo');
  cardPitcherStats = document.getElementById('card-pitcher-stats');
  cardBatterImg = document.getElementById('card-batter-img');
  cardBatterLogo = document.getElementById('card-batter-logo');
  cardBatterStats = document.getElementById('card-batter-stats');
  matchupGameTitle = document.getElementById('matchup-game-title');
  matchupGameDate = document.getElementById('matchup-game-date');

  // Summary Matrix
  abSummaryMatrixSvg = document.getElementById('ab-summary-matrix-svg');
  abSummarySvgPitches = document.getElementById('ab-summary-svg-pitches');
  abSummaryPitchDetails = document.getElementById('ab-summary-pitch-details');

  // Arcade Login Form elements
  loginHandleInput = document.getElementById('login-handle');
  loginPinInput = document.getElementById('login-pin');
  loginErrorMsg = document.getElementById('login-error-msg');
  btnStatsLogout = document.getElementById('btn-stats-logout');

  // Arcade Login confirmation & Profile Settings
  loginConfirmBox = document.getElementById('login-confirm-box');
  btnLoginConfirmCreate = document.getElementById('btn-login-confirm-create');
  btnLoginConfirmCancel = document.getElementById('btn-login-confirm-cancel');
  
  profileFavTeamSelect = document.getElementById('profile-fav-team-select');
  teamSearchInput = document.getElementById('team-search-input');
  profileFavTeamLogo = document.getElementById('profile-fav-team-logo');
  profileNewPin = document.getElementById('profile-new-pin');
  profileNewPinConfirm = document.getElementById('profile-new-pin-confirm');
  btnProfileSavePin = document.getElementById('btn-profile-save-pin');
  profilePinMsg = document.getElementById('profile-pin-msg');

  // Restored Streak & HUD elements
  btnStartDailyStreak = document.getElementById('btn-start-daily-streak');
  dailyAttemptStatus = document.getElementById('daily-attempt-status');
  btnHudLogout = document.getElementById('btn-adaptive-nav-action');

  // Collapsible Matchup Card elements
  btnMatchupToggle = document.getElementById('btn-matchup-toggle');

  // Settings elements
  btnCloseSettings = document.getElementById('btn-close-settings');
  btnDashboardSettingsToggle = document.getElementById('btn-global-settings-toggle');
  settingsUiClassic = document.getElementById('settings-ui-classic');
  settingsUiAdaptive = document.getElementById('settings-ui-adaptive');
  settingsUiCinematic = document.getElementById('settings-ui-cinematic');

  // Split Summary card elements
  abSummaryPitcherImg = document.getElementById('ab-summary-pitcher-img');
  abSummaryPitcherLogo = document.getElementById('ab-summary-pitcher-logo');
  abSummaryPitcherName = document.getElementById('ab-summary-pitcher-name');
  abSummaryPitcherHandBadge = document.getElementById('ab-summary-pitcher-hand-badge');
  abSummaryBatterImg = document.getElementById('ab-summary-batter-img');
  abSummaryBatterLogo = document.getElementById('ab-summary-batter-logo');
  abSummaryBatterName = document.getElementById('ab-summary-batter-name');
  abSummaryBatterHandBadge = document.getElementById('ab-summary-batter-hand-badge');
  abSummaryPitchList = document.getElementById('ab-summary-pitch-list');
  abSummaryCorrectCount = document.getElementById('ab-summary-correct-count');
  abSummaryWeeklyChallengeDetails = document.getElementById('ab-summary-weekly-challenge-details');
  abSummaryWeeklyProgressText = document.getElementById('ab-summary-weekly-progress-text');
  abSummaryWeeklyProgressBar = document.getElementById('ab-summary-weekly-progress-bar');
  abSummaryWeeklyAccuracyText = document.getElementById('ab-summary-weekly-accuracy-text');
  abSummaryWeeklyCount = document.getElementById('ab-summary-weekly-count');
  abSummaryWeeklyTotal = document.getElementById('ab-summary-weekly-total');
  abSummaryLeaderboardSnippet = document.getElementById('ab-summary-leaderboard-snippet');
  btnAbSummaryToggleReview = document.getElementById('btn-ab-summary-toggle-review');
  abSummaryReviewSection = document.getElementById('ab-summary-review');
  const abSummaryZoneFrame = document.getElementById('ab-summary-zone-frame');
  if (abSummaryZoneFrame) {
    abSummaryZoneFrame.addEventListener('click', (e) => {
      if (e.target === abSummaryZoneFrame || e.target.id === 'ab-summary-matrix-svg') {
        clearAbSummaryPitchSelection();
      }
    });
  }
  challengeTrackerHud = document.getElementById('challenge-tracker-hud');
  levelUpOverlay = document.getElementById('level-up-overlay');
  levelUpBadge = document.getElementById('level-up-badge');
  levelUpTitle = document.getElementById('level-up-title');
  levelUpSubtitle = document.getElementById('level-up-subtitle');

  if (btnAbSummaryToggleReview) {
    btnAbSummaryToggleReview.addEventListener('click', () => {
      setAbSummaryReviewExpanded(!abSummaryReviewExpanded);
    });
  }

  // Matchup Walkup card faceoff elements
  abStartPitcherImg = document.getElementById('ab-start-pitcher-img');
  abStartPitcherLogo = document.getElementById('ab-start-pitcher-logo');
  abStartPitcherStats = document.getElementById('ab-start-pitcher-stats');
  abStartBatterImg = document.getElementById('ab-start-batter-img');
  abStartBatterLogo = document.getElementById('ab-start-batter-logo');
  abStartBatterStats = document.getElementById('ab-start-batter-stats');
  abStartPitcherName = document.getElementById('ab-start-pitcher');
  abStartBatterName = document.getElementById('ab-start-batter');
  btnAbStartExit = document.getElementById('btn-ab-start-exit');

  // Leaderboard Buttons & Table
  leaderBtnWeekly = document.getElementById('leader-btn-weekly');
  leaderBtnDaily = document.getElementById('leader-btn-daily');
  leaderBtnAlltime = document.getElementById('leader-btn-alltime');
  leaderboardTableBody = document.getElementById('leaderboard-table-body');
  leaderboardDivisionTitle = document.getElementById('leaderboard-division-title');

  // Player Card Modal elements
  playerCardModalOverlay = document.getElementById('player-card-modal-overlay');
  btnClosePlayerModal = document.getElementById('btn-close-player-modal');
  playerModalImg = document.getElementById('player-modal-img');
  playerModalTeamLogo = document.getElementById('player-modal-team-logo');
  playerModalRole = document.getElementById('player-modal-role');
  playerModalName = document.getElementById('player-modal-name');
  playerModalTeam = document.getElementById('player-modal-team');
  playerModalStatsGrid = document.getElementById('player-modal-stats-grid');
  playerModalHand = document.getElementById('player-modal-hand');
  playerModalHeightWeight = document.getElementById('player-modal-height-weight');
}

async function submitLoginAction() {
  initAudio();
  
  const handleVal = loginHandleInput ? loginHandleInput.value.trim() : "";
  const pinVal = loginPinInput ? loginPinInput.value.trim() : "";
  
  if (handleVal.length < 3) {
    if (loginErrorMsg) {
      loginErrorMsg.textContent = "ERROR: HANDLE MUST BE AT LEAST 3 CHARACTERS";
      loginErrorMsg.classList.remove('hidden');
    }
    return;
  }
  
  if (!/^\d{4,8}$/.test(pinVal)) {
    if (loginErrorMsg) {
      loginErrorMsg.textContent = "ERROR: PIN MUST BE 4 TO 8 DIGITS";
      loginErrorMsg.classList.remove('hidden');
    }
    return;
  }
  
  const handleValNormalized = handleVal.toUpperCase();
  
  if (loginErrorMsg) {
    loginErrorMsg.textContent = "VERIFYING CREW CHIEF CREDENTIALS...";
    loginErrorMsg.classList.remove('hidden');
  }

  try {
    const cloud = await apiLogin(handleValNormalized, pinVal);
    if (loginErrorMsg) loginErrorMsg.classList.add('hidden');
    if (loginConfirmBox) {
      loginConfirmBox.classList.add('hidden');
      loginConfirmBox.classList.remove('flex');
    }
    await applyCloudSessionToLocal(handleValNormalized, pinVal, cloud);
    loginUserSession(handleValNormalized);
    return;
  } catch (err) {
    if (err.status === 404) {
      if (loginErrorMsg) loginErrorMsg.classList.add('hidden');
      if (loginConfirmBox) {
        loginConfirmBox.classList.remove('hidden');
        loginConfirmBox.classList.add('flex');
      }
      return;
    }
    if (err.status === 401) {
      if (loginErrorMsg) {
        loginErrorMsg.textContent = 'ERROR: INVALID PIN FOR THIS HANDLE';
        loginErrorMsg.classList.remove('hidden');
      }
      return;
    }
    console.warn('Cloud login unavailable, trying local profile:', err);
  }

  const profile = await getProfile(handleValNormalized);
  if (!profile) {
    if (loginErrorMsg) loginErrorMsg.classList.add('hidden');
    if (loginConfirmBox) {
      loginConfirmBox.classList.remove('hidden');
      loginConfirmBox.classList.add('flex');
    }
    return;
  }

  const enteredHash = await hashPIN(pinVal);
  const pinMatched = profile.pinHash === enteredHash || profile.pin === pinVal;
  if (!pinMatched) {
    if (loginErrorMsg) {
      loginErrorMsg.textContent = 'ERROR: INVALID PIN FOR THIS HANDLE';
      loginErrorMsg.classList.remove('hidden');
    }
    return;
  }

  if (profile.pin === pinVal && !profile.pinHash) {
    profile.pinHash = enteredHash;
    delete profile.pin;
    await saveProfile(profile);
  }

  if (loginErrorMsg) loginErrorMsg.classList.add('hidden');
  loginUserSession(handleValNormalized);
}

function attachEvents() {
  // Tab Switching Event Listeners
  if (tabBtnPlay) tabBtnPlay.addEventListener('click', () => switchTab('play'));
  if (tabBtnLeaderboard) tabBtnLeaderboard.addEventListener('click', () => switchTab('leaderboard'));
  if (tabBtnStats) tabBtnStats.addEventListener('click', () => switchTab('stats'));

  // Weekly game cards button listener delegation
  document.querySelectorAll('.btn-play-game-ab').forEach(btn => {
    btn.addEventListener('click', (e) => {
      initAudio();
      const gameIdx = parseInt(e.target.getAttribute('data-game-idx'));
      startWeeklyChallengeGame(gameIdx);
    });
  });

  if (btnStartDailyStreak) {
    btnStartDailyStreak.addEventListener('click', (e) => {
      e.stopPropagation();
      initAudio();
      startDailyStreakChallenge();
    });
  }

  const weeklyChallengeCard = document.getElementById('weekly-challenge-card');
  if (weeklyChallengeCard) {
    weeklyChallengeCard.addEventListener('click', (e) => {
      initAudio();
      openChallengeDetailModal('weekly');
    });
  }

  const streakChallengeCard = document.getElementById('streak-challenge-card');
  if (streakChallengeCard) {
    streakChallengeCard.addEventListener('click', (e) => {
      initAudio();
      openChallengeDetailModal('streak');
    });
  }

  if (btnInfoWeeklyChallenge) {
    btnInfoWeeklyChallenge.addEventListener('click', (e) => {
      e.stopPropagation();
      initAudio();
      openChallengeDetailModal('weekly');
    });
  }

  if (btnInfoStreakChallenge) {
    btnInfoStreakChallenge.addEventListener('click', (e) => {
      e.stopPropagation();
      initAudio();
      openChallengeDetailModal('streak');
    });
  }

  if (btnChallengeDetailClose) {
    btnChallengeDetailClose.addEventListener('click', (e) => {
      e.stopPropagation();
      hideChallengeDetailModal();
    });
  }

  if (btnStartGame) {
    btnStartGame.addEventListener('click', () => {
      initAudio();
      gameMode = 'standard';
      resetGameSession();
    });
  }

  if (btnStartOriolesFull) {
    btnStartOriolesFull.addEventListener('click', () => {
      initAudio();
      gameMode = 'orioles_full';
      resetGameSession();
    });
  }
  
  if (btnMainMenu) {
    btnMainMenu.addEventListener('click', async () => {
      if (gameMode === 'daily_streak' && !isSessionOver) {
        const confirmed = await showCustomConfirm("This will end your current attempt for the day! Are you sure you want to exit?");
        if (!confirmed) return;
      }
      goToMainMenu();
    });
  }

  if (selectInning) {
    selectInning.addEventListener('change', () => {
      const val = selectInning.value;
      const parts = val.split('_');
      const inn = parseInt(parts[0]);
      const isTop = parts[1] === 'true';
      
      loadHalfInning(inn, isTop);
      currentPitchIndex = 0;
      pitchHistory = [];
      currentAbStartHistoryIndex = 0;
      transitionToState(STATES.IDLE);
      showAtBatStartScreen(() => {
        if (currentState === STATES.IDLE && !isGamePaused) {
          autoPlayTimeout = setTimeout(() => {
            triggerPitchRelease();
          }, 600);
        }
      });
    });
  }

  if (btnPlayPitch) {
    btnPlayPitch.addEventListener('click', () => {
      triggerPitchRelease();
    });
  }

  if (btnBall) {
    btnBall.addEventListener('click', () => {
      submitUserDecision('B');
    });
  }

  if (btnStrike) {
    btnStrike.addEventListener('click', () => {
      submitUserDecision('S');
    });
  }

  if (btnBroadcastContinue) {
    btnBroadcastContinue.addEventListener('click', () => {
      advanceGameFlow();
    });
  }

  if (btnRestartGame) {
    btnRestartGame.addEventListener('click', () => {
      resetGameSession();
    });
  }

  if (btnScoreboardHome) {
    btnScoreboardHome.addEventListener('click', (e) => {
      e.stopPropagation();
      initAudio();
      goToMainMenu();
    });
  }

  if (btnScoreboardLeaderboard) {
    btnScoreboardLeaderboard.addEventListener('click', (e) => {
      e.stopPropagation();
      initAudio();
      goToMainMenu();
      switchTab('leaderboard');
    });
  }

  if (btnAbSummaryAdvance) {
    btnAbSummaryAdvance.addEventListener('click', () => {
      advanceNextAtBat();
    });
  }

  if (btnResumeGame) {
    btnResumeGame.addEventListener('click', () => {
      resumeGameFromPause();
    });
  }

  if (pauseScreen) {
    // Click anywhere on pause screen has been disabled to prevent auto-resume.
    // Explicit Resume button or ESC key must be used.
  }

  if (btnPauseRestart) {
    btnPauseRestart.addEventListener('click', (e) => {
      e.stopPropagation();
      initAudio();
      isGamePaused = false;
      if (pauseScreen) {
        pauseScreen.classList.add('opacity-0', 'pointer-events-none', 'scale-95');
        pauseScreen.classList.remove('opacity-100', 'pointer-events-auto', 'scale-100');
      }
      
      // Restart current game session
      if (gameMode === 'weekly_challenge') {
        startWeeklyChallengeGame(activeGameIndex);
      } else if (gameMode === 'daily_compete') {
        startDailyCompeteGame(activeDailyDate);
      } else if (gameMode === 'daily_streak') {
        startDailyStreakChallenge();
      } else if (gameMode === 'orioles_full') {
        gameMode = 'orioles_full';
        resetGameSession();
      } else {
        gameMode = 'standard';
        resetGameSession();
      }
    });
  }

  if (btnPauseHome) {
    btnPauseHome.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (gameMode === 'daily_streak' && !isSessionOver) {
        const confirmed = await showCustomConfirm("This will end your current attempt for the day! Are you sure you want to exit?");
        if (!confirmed) return;
      }
      initAudio();
      isGamePaused = false;
      if (pauseScreen) {
        pauseScreen.classList.add('opacity-0', 'pointer-events-none', 'scale-95');
        pauseScreen.classList.remove('opacity-100', 'pointer-events-auto', 'scale-100');
      }
      goToMainMenu();
    });
  }

  if (btnViewDetails) {
    btnViewDetails.addEventListener('click', (e) => {
      e.stopPropagation();
      initAudio();
      enterFullReviewFromQuick();
    });
  }

  if (btnQuickContinue) {
    btnQuickContinue.addEventListener('click', (e) => {
      e.stopPropagation();
      initAudio();
      if (reviewMinTimeElapsed) {
        hideQuickPreviewPanel();
        advanceGameFlow();
      }
    });
  }

  if (btnStartWeeklyChallenge) {
    btnStartWeeklyChallenge.addEventListener('click', (e) => {
      e.stopPropagation();
      initAudio();
      startWeeklyChallenge();
    });
  }

  if (btnPlayDailyCompete) {
    btnPlayDailyCompete.addEventListener('click', (e) => {
      e.stopPropagation();
      initAudio();
      const todayStr = new Date().toISOString().split('T')[0];
      startDailyCompeteGame(todayStr);
    });
  }

  if (btnFindGames) {
    btnFindGames.addEventListener('click', (e) => {
      e.stopPropagation();
      initAudio();
      handleFindGames();
    });
  }

  const btnClose = document.getElementById('btn-preview-modal-close');
  if (btnClose) {
    btnClose.addEventListener('click', (e) => {
      e.stopPropagation();
      hideGamePreviewModal();
    });
  }

  if (btnPreviewModalCancel) {
    btnPreviewModalCancel.addEventListener('click', (e) => {
      e.stopPropagation();
      initAudio();
      hideGamePreviewModal();
    });
  }

  if (btnPreviewModalStart) {
    btnPreviewModalStart.addEventListener('click', (e) => {
      e.stopPropagation();
      initAudio();
      if (window._onPreviewStartCallback) {
        window._onPreviewStartCallback();
        window._onPreviewStartCallback = null;
      }
      hideGamePreviewModal();
    });
  }



  // Focus and visibility loss event listeners — pause on blur/hidden, do NOT auto-resume
  window.addEventListener('blur', () => {
    setTimeout(() => {
      const activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === 'SELECT' || activeEl.tagName === 'INPUT' || activeEl.tagName === 'BUTTON')) {
        return;
      }
      if (!document.hasFocus()) {
        pauseGameOnFocusLoss();
      }
    }, 150);
  });
  // Do NOT auto-resume on focus — user must explicitly resume via pause overlay or ESC
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      setGameAudioFocusMuted(true);
      pauseGameOnFocusLoss();
    } else if (document.hasFocus()) {
      setGameAudioFocusMuted(false);
    }
  });

  window.addEventListener('focus', () => setGameAudioFocusMuted(false));
  window.addEventListener('blur', () => setGameAudioFocusMuted(true));

  updateHudKeyboardHelpVisibility();
  window.addEventListener('resize', updateHudKeyboardHelpVisibility);

  // At-Bat Start Overlay confirm button
  if (btnAbStartConfirm) {
    btnAbStartConfirm.addEventListener('click', () => {
      confirmAtBatStart();
    });
  }

  if (btnAbStartExit) {
    btnAbStartExit.addEventListener('click', async () => {
      if (gameMode === 'daily_streak' && !isSessionOver) {
        const confirmed = await showCustomConfirm("This will end your current attempt for the day! Are you sure you want to exit?");
        if (!confirmed) return;
      }
      initAudio();
      if (abStartOverlay) {
        abStartOverlay.classList.add('opacity-0', 'pointer-events-none');
        abStartOverlay.classList.remove('opacity-100', 'pointer-events-auto');
        const startPanel = abStartOverlay.querySelector('.ab-start-cabinet');
        if (startPanel) {
          startPanel.classList.add('scale-95');
          startPanel.classList.remove('scale-100');
        }
      }
      goToMainMenu();
    });
  }

  // At-Bat Summary Home button
  if (btnAbSummaryHome) {
    btnAbSummaryHome.addEventListener('click', () => {
      if (abSummaryOverlay) {
        abSummaryOverlay.classList.add('opacity-0', 'pointer-events-none');
        abSummaryOverlay.classList.remove('opacity-100', 'pointer-events-auto');
        const summaryPanel = abSummaryOverlay.querySelector('.ab-summary-panel');
        if (summaryPanel) {
          summaryPanel.classList.add('scale-95');
          summaryPanel.classList.remove('scale-100');
        }
      }
      if (overviewTimerInterval) {
        clearInterval(overviewTimerInterval);
        overviewTimerInterval = null;
      }
      hideGameplayHudForSummary(false);
      setAbSummaryReviewExpanded(false);
      clearSummaryPitchReview();
      setCameraAngle('umpire');
      returnToMainMenu();
    });
  }

  // Speed Selector change event
  if (selectSpeed) {
    selectSpeed.addEventListener('change', () => {
      pitchSpeedMultiplier = parseFloat(selectSpeed.value);
    });
  }

  if (selectAutoplayDelay) {
    selectAutoplayDelay.addEventListener('change', () => {
      autoPlayDelay = parseFloat(selectAutoplayDelay.value);
    });
  }

  // Camera angles
  if (camBtnUmp) {
    camBtnUmp.addEventListener('click', () => selectCameraView('umpire'));
  }
  if (camBtnSide) {
    camBtnSide.addEventListener('click', () => selectCameraView('side'));
  }
  if (camBtnTop) {
    camBtnTop.addEventListener('click', () => selectCameraView('top'));
  }

  // Settings toggle click events
  if (btnSettingsToggle) {
    btnSettingsToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      isSettingsOpen = !isSettingsOpen;
      updateSettingsVisibility();
      if (isSettingsOpen) {
        cancelAutoPlayPitch();
      } else {
        resumeAutoPlayPitch();
      }
    });
  }

  if (btnDashboardSettingsToggle && btnDashboardSettingsToggle !== btnSettingsToggle) {
    btnDashboardSettingsToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      isSettingsOpen = !isSettingsOpen;
      updateSettingsVisibility();
    });
  }

  document.addEventListener('click', () => {
    if (isSettingsOpen) {
      isSettingsOpen = false;
      updateSettingsVisibility();
      resumeAutoPlayPitch();
    }
  });

  if (cameraControlsPanel) {
    cameraControlsPanel.addEventListener('click', (e) => {
      e.stopPropagation();
    });
  }

  // Settings Tab Switching Event Listeners
  if (settingsTabGen && settingsTabSandbox) {
    settingsTabGen.addEventListener('click', (e) => {
      e.stopPropagation();
      settingsTabGen.classList.add('bg-purple-600', 'font-bold');
      settingsTabSandbox.classList.remove('bg-purple-600', 'font-bold');
      settingsContentGen.classList.remove('hidden');
      settingsContentSandbox.classList.add('hidden');
    });
    settingsTabSandbox.addEventListener('click', (e) => {
      e.stopPropagation();
      settingsTabSandbox.classList.add('bg-purple-600', 'font-bold');
      settingsTabGen.classList.remove('bg-purple-600', 'font-bold');
      settingsContentSandbox.classList.remove('hidden');
      settingsContentGen.classList.add('hidden');
    });
  }

  // Sandbox element change event listeners
  if (selectReviewStyle) {
    selectReviewStyle.addEventListener('change', function(e) {
      e.stopPropagation();
      reviewStyle = this.value;
    });
  }

  if (selectRateOfPlay) {
    selectRateOfPlay.addEventListener('change', function(e) {
      e.stopPropagation();
      rateOfPlay = this.value;
    });
  }
  if (chkBgmEnabled) {
    chkBgmEnabled.addEventListener('change', function(e) {
      e.stopPropagation();
      bgmEnabled = this.checked;
      localStorage.setItem('pitch_ump_bgm_enabled', bgmEnabled ? 'true' : 'false');
      updateMuteButtonUI();
    });
  }
  if (btnAudioMute) {
    btnAudioMute.addEventListener('click', function(e) {
      e.stopPropagation();
      bgmEnabled = !bgmEnabled;
      localStorage.setItem('pitch_ump_bgm_enabled', bgmEnabled ? 'true' : 'false');
      if (chkBgmEnabled) chkBgmEnabled.checked = bgmEnabled;
      updateMuteButtonUI();
    });
  }
  if (selBgmTrack) {
    selBgmTrack.addEventListener('change', function(e) {
      e.stopPropagation();
      activeBgmTrack = parseInt(this.value, 10);
      if (isNaN(activeBgmTrack)) activeBgmTrack = 0;
      localStorage.setItem('pitch_ump_bgm_track', activeBgmTrack);
      if (audioCtx) {
        bgmMelodyNoteIndex = 0;
        const melody = getCurrentMelodyArray();
        bgmMelodyBeatRemaining = melody.length > 0 ? melody[0].beats : 1;
        bgmCurrentBeatIndex = 0;
        bgmNextNoteTime = audioCtx.currentTime + 0.05;
      }
    });
  }

  if (chkSzHelper) {
    chkSzHelper.addEventListener('change', function(e) {
      e.stopPropagation();
      showFlightSzHelper = this.checked;
    });
  }

  if (chkPitchClock) {
    chkPitchClock.addEventListener('change', function(e) {
      e.stopPropagation();
      enablePitchClock = this.checked;
    });
  }

  if (selectBattersEyeColor) {
    selectBattersEyeColor.addEventListener('change', function(e) {
      e.stopPropagation();
      let hex = '#0B2512';
      if (this.value === 'black') hex = '#020202';
      else if (this.value === 'light-grey') hex = '#222222';
      setBattersEyeColor(hex);
    });
  }

  if (rngMannequinOpacity) {
    rngMannequinOpacity.addEventListener('input', function(e) {
      e.stopPropagation();
      if (mannequinOpacityValue) mannequinOpacityValue.textContent = `${this.value}%`;
      setMannequinOpacity(parseFloat(this.value) / 100);
    });
  }

  // Redesign Event Listeners
  if (btnWelcomeStart) {
    btnWelcomeStart.addEventListener('click', (e) => {
      e.stopPropagation();
      initAudio();
      
      const loggedIn = !!localStorage.getItem('ump_username');
      if (loggedIn) {
        // Play arcade resume sequence
        playCoinSound();
        playUmpireVocalCall('STRIKE');
        
        btnWelcomeStart.disabled = true;
        btnWelcomeStart.classList.add('animate-pulse');
        
        setTimeout(() => {
          btnWelcomeStart.disabled = false;
          btnWelcomeStart.classList.remove('animate-pulse');
          if (activeFavoriteTeam) {
            transitionToState(STATES.START);
          } else {
            transitionToState(STATES.TEAM_SELECT);
          }
        }, 800);
      } else {
        submitLoginAction();
      }
    });
  }

  const handleLoginEnter = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const loggedIn = !!localStorage.getItem('ump_username');
      if (loggedIn) {
        if (btnWelcomeStart) btnWelcomeStart.click();
      } else {
        if (loginConfirmBox && !loginConfirmBox.classList.contains('hidden')) {
          const btnCreate = document.getElementById('btn-login-confirm-create');
          if (btnCreate) btnCreate.click();
        } else {
          submitLoginAction();
        }
      }
    }
  };
  if (loginHandleInput) loginHandleInput.addEventListener('keydown', handleLoginEnter);
  if (loginPinInput) {
    loginPinInput.addEventListener('input', function(e) {
      this.value = this.value.replace(/[^0-9]/g, '');
    });
    loginPinInput.addEventListener('keydown', handleLoginEnter);
  }

  if (btnLoginConfirmCreate) {
    btnLoginConfirmCreate.addEventListener('click', async (e) => {
      e.stopPropagation();
      initAudio();
      
      const handleVal = loginHandleInput ? loginHandleInput.value.trim() : "";
      const pinVal = loginPinInput ? loginPinInput.value.trim() : "";
      const handleValNormalized = handleVal.toUpperCase();
      
      if (loginErrorMsg) {
        loginErrorMsg.textContent = "REGISTERING NEW CREW CHIEF...";
        loginErrorMsg.classList.remove('hidden');
      }

      let cloud;
      try {
        cloud = await apiRegister(handleValNormalized, pinVal);
      } catch (regErr) {
        if (regErr.status === 409) {
          if (loginErrorMsg) {
            loginErrorMsg.textContent = 'ERROR: HANDLE ALREADY TAKEN — LOG IN INSTEAD';
            loginErrorMsg.classList.remove('hidden');
          }
          return;
        }
        console.warn('Cloud registration unavailable, creating local profile:', regErr);
        cloud = { handle: handleValNormalized, stats: {} };
      }

      await applyCloudSessionToLocal(handleValNormalized, pinVal, cloud);
      
      if (loginConfirmBox) {
        loginConfirmBox.classList.add('hidden');
        loginConfirmBox.classList.remove('flex');
      }
      if (loginErrorMsg) loginErrorMsg.classList.add('hidden');
      
      loginUserSession(handleValNormalized);
    });
  }

  if (btnLoginConfirmCancel) {
    btnLoginConfirmCancel.addEventListener('click', (e) => {
      e.stopPropagation();
      initAudio();
      if (loginConfirmBox) {
        loginConfirmBox.classList.add('hidden');
        loginConfirmBox.classList.remove('flex');
      }
    });
  }

  const performLogout = (e) => {
    if (e && e.stopPropagation) {
      e.stopPropagation();
    }
    initAudio();
    apiLogout().catch(() => {});
    goToMainMenu();
    localStorage.removeItem('ump_username');
    loadSavedSessionFromLocal();
    activeFavoriteTeam = null;
    if (loginHandleInput) loginHandleInput.value = "";
    if (loginPinInput) loginPinInput.value = "";
    if (loginErrorMsg) loginErrorMsg.classList.add('hidden');
    if (loginConfirmBox) {
      loginConfirmBox.classList.add('hidden');
      loginConfirmBox.classList.remove('flex');
    }
    
    // Clear demo/active state
    if (autoPlayTimeout) {
      clearTimeout(autoPlayTimeout);
      autoPlayTimeout = null;
    }
    pitchHistory = [];
    currentPitchIndex = 0;
    currentAbStartHistoryIndex = 0;
    abBalls = 0;
    abStrikes = 0;
    
    transitionToState(STATES.WELCOME);
  };

  if (btnStatsLogout) {
    btnStatsLogout.addEventListener('click', performLogout);
  }
  const btnWelcomeLogout = document.getElementById('btn-welcome-logout');
  if (btnWelcomeLogout) {
    btnWelcomeLogout.addEventListener('click', performLogout);
  }

  if (btnHudLogout) {
    btnHudLogout.addEventListener('click', (e) => {
      const isPlaying = currentState !== STATES.START && currentState !== STATES.WELCOME && currentState !== STATES.TEAM_SELECT;
      if (isPlaying) {
        initAudio();
        returnToMainMenu();
      } else {
        performLogout(e);
      }
    });
  }

  if (btnCloseSettings) {
    btnCloseSettings.addEventListener('click', (e) => {
      e.stopPropagation();
      isSettingsOpen = false;
      updateSettingsVisibility();
      resumeAutoPlayPitch();
    });
  }

  if (btnMatchupToggle) {
    btnMatchupToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      initAudio();
      if (matchupCard) {
        matchupCard.classList.toggle('collapsed');
        const isCollapsed = matchupCard.classList.contains('collapsed');
        localStorage.setItem('pitch_ump_matchup_collapsed', isCollapsed ? 'true' : 'false');
      }
    });
  }

  if (leaderBtnWeekly) {
    leaderBtnWeekly.addEventListener('click', () => renderLeaderboard('weekly'));
  }
  if (leaderBtnDaily) {
    leaderBtnDaily.addEventListener('click', () => renderLeaderboard('daily'));
  }
  if (leaderBtnAlltime) {
    leaderBtnAlltime.addEventListener('click', () => renderLeaderboard('alltime'));
  }

  if (btnConfirmTeam) {
    btnConfirmTeam.addEventListener('click', (e) => {
      e.stopPropagation();
      initAudio();
      if (!selectedTeamId) {
        showABOutcomeToast("PLEASE SELECT A TEAM FIRST");
        return;
      }
      const team = TEAMS_LIST.find(t => t.id === selectedTeamId);
      if (team) {
        saveFavoriteTeam(team.name);
        transitionToState(STATES.START);
        renderDashboardGamesList();
      }
    });
  }

  if (userFavoriteTeamBadge) {
    userFavoriteTeamBadge.style.cursor = 'pointer';
    userFavoriteTeamBadge.addEventListener('click', (e) => {
      e.stopPropagation();
      initAudio();
      transitionToState(STATES.TEAM_SELECT);
    });
  }

  // Player Card Popout Click Triggers
  const abStartPitcherCard = document.getElementById('ab-start-pitcher-card');
  if (abStartPitcherCard) {
    abStartPitcherCard.style.cursor = 'pointer';
    abStartPitcherCard.addEventListener('click', (e) => {
      e.stopPropagation();
      initAudio();
      const nameEl = document.getElementById('ab-start-pitcher');
      const handEl = document.getElementById('ab-start-pitcher-hand');
      if (nameEl) {
        showPlayerStatsPopout(abStartPitcherCard, nameEl.textContent.trim(), 'PITCHER', handEl ? handEl.textContent.trim() : 'R');
      }
    });
  }

  const abStartBatterCard = document.getElementById('ab-start-batter-card');
  if (abStartBatterCard) {
    abStartBatterCard.style.cursor = 'pointer';
    abStartBatterCard.addEventListener('click', (e) => {
      e.stopPropagation();
      initAudio();
      const nameEl = document.getElementById('ab-start-batter');
      const handEl = document.getElementById('ab-start-batter-hand');
      if (nameEl) {
        showPlayerStatsPopout(abStartBatterCard, nameEl.textContent.trim(), 'BATTER', handEl ? handEl.textContent.trim() : 'R');
      }
    });
  }

  // Umpire Box Score (Summary overlay) Player Card clicks
  const abSummaryPitcherCardTrigger = document.getElementById('ab-summary-pitcher-card');
  if (abSummaryPitcherCardTrigger) {
    abSummaryPitcherCardTrigger.style.cursor = 'pointer';
    abSummaryPitcherCardTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      initAudio();
      const nameEl = document.getElementById('ab-summary-pitcher-name');
      const handEl = document.getElementById('ab-summary-pitcher-hand-badge');
      if (nameEl) {
        showPlayerStatsPopout(abSummaryPitcherCardTrigger, nameEl.textContent.trim(), 'PITCHER', handEl ? handEl.textContent.trim() : 'R');
      }
    });
  }

  const abSummaryBatterCardTrigger = document.getElementById('ab-summary-batter-card');
  if (abSummaryBatterCardTrigger) {
    abSummaryBatterCardTrigger.style.cursor = 'pointer';
    abSummaryBatterCardTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      initAudio();
      const nameEl = document.getElementById('ab-summary-batter-name');
      const handEl = document.getElementById('ab-summary-batter-hand-badge');
      if (nameEl) {
        showPlayerStatsPopout(abSummaryBatterCardTrigger, nameEl.textContent.trim(), 'BATTER', handEl ? handEl.textContent.trim() : 'R');
      }
    });
  }

  const gameplayPitcherCardTrigger = document.getElementById('gameplay-pitcher-card-trigger');
  if (gameplayPitcherCardTrigger) {
    gameplayPitcherCardTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      initAudio();
      const nameEl = document.getElementById('card-pitcher-name');
      const handEl = document.getElementById('card-pitcher-hand');
      if (nameEl) {
        showPlayerStatsPopout(gameplayPitcherCardTrigger, nameEl.textContent.trim(), 'PITCHER', handEl ? handEl.textContent.trim() : 'R');
      }
    });
  }

  const gameplayBatterCardTrigger = document.getElementById('gameplay-batter-card-trigger');
  if (gameplayBatterCardTrigger) {
    gameplayBatterCardTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      initAudio();
      const nameEl = document.getElementById('card-batter-name');
      const handEl = document.getElementById('card-batter-hand');
      if (nameEl) {
        showPlayerStatsPopout(gameplayBatterCardTrigger, nameEl.textContent.trim(), 'BATTER', handEl ? handEl.textContent.trim() : 'R');
      }
    });
  }



  // STOP TOUCH PROPAGATION ON BUTTONS
  const preventBubble = (e) => {
    e.stopPropagation();
  };
  
  [
    btnStartGame, btnStartOriolesFull, btnBall, btnStrike, btnBroadcastContinue, btnRestartGame,
    btnScoreboardHome, btnScoreboardLeaderboard,
    camBtnUmp, camBtnSide, camBtnTop, selectSpeed, btnSettingsToggle, btnDashboardSettingsToggle,
    btnMainMenu, selectInning, btnAbSummaryAdvance, btnResumeGame,
    settingsTabGen, settingsTabSandbox, rngMannequinOpacity, selectBattersEyeColor,
    btnViewDetails, btnQuickContinue, btnStartWeeklyChallenge, btnAbStartConfirm, btnAbStartExit, btnAbSummaryHome,
    btnWelcomeStart, btnConfirmTeam, btnLoginConfirmCreate, btnLoginConfirmCancel
  ].forEach(btn => {
    if (btn) {
      btn.addEventListener('touchstart', preventBubble, { passive: true });
      btn.addEventListener('touchend', preventBubble, { passive: true });
    }
  });

  // Keyboard Shortcuts
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (e.repeat) return; // Prevent rapid toggle on key hold
      e.preventDefault();
      // If player card popout is open, close it first
      const activePopout = document.querySelector('.player-card-popout');
      if (activePopout) {
        activePopout.remove();
        return;
      }
      // If ump scorecard is open, close it first
      if (umpcardOverlay && umpcardOverlay.classList.contains('opacity-100')) {
        hideUmpireScorecardModal();
        return;
      }
      if (isGamePaused) {
        resumeGameFromPause();
      } else {
        if (currentState !== STATES.START && currentState !== STATES.SCOREBOARD) {
          pauseGameOnFocusLoss();
        }
      }
      return;
    }
    if (isGamePaused) {
      // Only ESC resumes from pause — other keys are ignored while paused
      return;
    }

    // Check if AB summary is open FIRST!
    if (abSummaryOverlay && abSummaryOverlay.classList.contains('opacity-100')) {
      if (e.key === ' ') {
        e.preventDefault();
        advanceNextAtBat();
      }
      return;
    }

    // Space in at-bat start overlay confirms start
    if (abStartOverlay && abStartOverlay.classList.contains('opacity-100') && e.key === ' ') {
      e.preventDefault();
      confirmAtBatStart();
      return;
    }
    const key = e.key.toLowerCase();
    // Keyboard camera adjustments removed (free move disabled)
    
    if (currentState === STATES.IDLE && e.key === ' ') {
      e.preventDefault();
      triggerPitchRelease();
    } else if (currentState === STATES.DECISION_PENDING && decisionPrompt && decisionPrompt.classList.contains('opacity-100')) {
      if (e.key === 'ArrowLeft' || key === 'a') {
        e.preventDefault();
        submitUserDecision('B');
      } else if (e.key === 'ArrowRight' || key === 'd') {
        e.preventDefault();
        submitUserDecision('S');
      }
    } else if (currentState === STATES.ABS_REVIEW) {
      if (e.key === ' ') {
        e.preventDefault();
        if (reviewMinTimeElapsed) {
          if (isTransitioningToSummary) {
            // User pressed Space to skip the transition/delay
            if (summaryTimeout) {
              clearTimeout(summaryTimeout);
              summaryTimeout = null;
            }
            isTransitioningToSummary = false;
            advanceGameFlow(true);
          } else {
            hideQuickPreviewPanel();
            advanceGameFlow();
          }
        }
      } else if (key === 'v') {
        e.preventDefault();
        enterFullReviewFromQuick();
      }
    }
  });

  // Helper to postpone autoplay while user is adjusting camera
  function postponeAutoPlay() {
    if (currentState === STATES.IDLE && !isGamePaused) {
      if (autoPlayTimeout) {
        clearTimeout(autoPlayTimeout);
      }
      autoPlayTimeout = setTimeout(() => {
        triggerPitchRelease();
      }, 2500); // 2.5 seconds idle time after camera adjustment
    }
  }

  // Touch/Swipe and Tap Events on Canvas Container (free move disabled)
  const canvasContainer = document.getElementById('canvas-container');

  if (canvasContainer) {
    canvasContainer.addEventListener('touchstart', (e) => {
      initAudio();
      if (e.touches && e.touches[0]) {
        const touch = e.touches[0];
        touchStartX = touch.clientX;
        touchStartY = touch.clientY;
      }
    }, { passive: true });

    canvasContainer.addEventListener('touchend', (e) => {
      if (!e.changedTouches || !e.changedTouches[0]) return;
      
      const touchEndX = e.changedTouches[0].clientX;
      const touchEndY = e.changedTouches[0].clientY;
      
      const dx = touchEndX - touchStartX;
      const dy = touchEndY - touchStartY;
      
      // Swipe left/right for decision
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > SWIPE_THRESHOLD) {
        if (currentState === STATES.DECISION_PENDING && decisionPrompt && decisionPrompt.classList.contains('opacity-100')) {
          if (dx > 0) {
            submitUserDecision('S');
          } else {
            submitUserDecision('B');
          }
        }
      } else if (Math.abs(dx) < 20 && Math.abs(dy) < 20) {
        // Tap triggers
        if (currentState === STATES.IDLE) {
          triggerPitchRelease();
        } else if (currentState === STATES.ABS_REVIEW) {
          advanceGameFlow();
        }
      }
    }, { passive: true });
  }

  if (btnShowUmpcard) {
    btnShowUmpcard.addEventListener('click', (e) => {
      e.stopPropagation();
      initAudio();
      showUmpireScorecardModal();
    });
  }

  if (btnCloseUmpcard) {
    btnCloseUmpcard.addEventListener('click', (e) => {
      e.stopPropagation();
      hideUmpireScorecardModal();
    });
  }

  if (btnCloseUmpcardBottom) {
    btnCloseUmpcardBottom.addEventListener('click', (e) => {
      e.stopPropagation();
      hideUmpireScorecardModal();
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && umpcardOverlay && umpcardOverlay.classList.contains('opacity-100')) {
      hideUmpireScorecardModal();
    }
  });
  bindRetroAudioToElements();
}

function selectCameraView(viewName) {
  setCameraAngle(viewName);
  
  [camBtnUmp, camBtnSide, camBtnTop].forEach(btn => {
    if (btn) btn.classList.replace('bg-purple-600', 'bg-gray-800');
  });
  if (viewName === 'umpire' && camBtnUmp) camBtnUmp.classList.replace('bg-gray-800', 'bg-purple-600');
  if (viewName === 'side' && camBtnSide) camBtnSide.classList.replace('bg-gray-800', 'bg-purple-600');
  if (viewName === 'top' && camBtnTop) camBtnTop.classList.replace('bg-gray-800', 'bg-purple-600');
}


/**
 * Toggles the visibility, border highlighting, and animations of the ABS review panel sidebar.
 */
function showReviewPanel(visible) {
  if (!absBroadcastOverlay) return;
  if (visible) {
    absBroadcastOverlay.classList.add('active-broadcast-overlay');
  } else {
    absBroadcastOverlay.classList.remove('active-broadcast-overlay');
  }
}

/**
/**
 * Updates welcome screen depending on active session state (credentials login vs resume session)
 */
function updateWelcomeScreenState() {
  const storedUser = localStorage.getItem('ump_username');
  const loginFields = document.getElementById('welcome-login-fields');
  const resumeContainer = document.getElementById('welcome-resume-container');
  const resumeHandle = document.getElementById('welcome-resume-handle');
  const welcomeStartBtn = document.getElementById('btn-welcome-start');
  const insertCoinText = document.querySelector('.animate-flash-text');
  
  if (storedUser) {
    if (loginFields) loginFields.classList.add('hidden');
    if (resumeContainer) {
      resumeContainer.classList.remove('hidden');
      resumeContainer.classList.add('flex');
    }
    if (resumeHandle) resumeHandle.textContent = storedUser.toUpperCase();
    
    // Fetch and calculate User Stats for the Welcome screen
    const statsKey = getStatsStorageKey(storedUser);
    const userStats = JSON.parse(localStorage.getItem(statsKey) || '{"overallAccuracy":null,"maxStreak":0,"completedWeekly":0,"dnfs":0,"history":[]}');
    
    let xp = userStats.xp !== undefined ? userStats.xp : 0;
    if (userStats.xp === undefined) {
      const history = userStats.history || [];
      history.forEach(h => {
        const isWeekly = h.gameName && h.gameName.includes("Weekly");
        const isStreak = h.gameName && h.gameName.includes("Streak");
        const isDailyCompete = h.gameName && h.gameName.includes("Daily Compete");
        
        if (isWeekly) xp += (h.correctCalls || 0) * 10;
        else if (isStreak) xp += (h.correctCalls || 0) * 15;
        else if (isDailyCompete) xp += (h.correctCalls || 0) * 12;
        else xp += (h.correctCalls || 0) * 5;
      });
    }
    
    const xpProgress = getXpProgressInLevel(xp);
    
    // Populate Welcome screen telemetry UI elements
    const welcomeLevel = document.getElementById('welcome-resume-level');
    const welcomeXpText = document.getElementById('welcome-resume-xp-text');
    const welcomeXpBar = document.getElementById('welcome-resume-xp-bar');
    const welcomeAccuracy = document.getElementById('welcome-resume-accuracy');
    const welcomeStreak = document.getElementById('welcome-resume-streak');
    
    if (welcomeLevel) applyLevelBadgeElement(welcomeLevel, xpProgress.level);
    if (welcomeXpText) welcomeXpText.textContent = `${xpProgress.progress} / ${XP_PER_LEVEL} XP`;
    setXpBarPercent(welcomeXpBar, xpProgress.pct, true);
    if (welcomeAccuracy) {
      welcomeAccuracy.textContent = userStats.overallAccuracy !== null && userStats.overallAccuracy !== undefined 
        ? `${userStats.overallAccuracy}%` 
        : "--";
    }
    if (welcomeStreak) {
      welcomeStreak.textContent = `${userStats.maxStreak || 0} Pitches`;
    }

    // Handle Daily Login Bonus Claim
    const today = new Date().toLocaleDateString();
    const loginBonusKey = `daily_login_bonus_${storedUser}_${today}`;
    const isBonusClaimed = localStorage.getItem(loginBonusKey) === 'claimed';
    
    const bonusStatus = document.getElementById('welcome-login-bonus-status');
    const bonusCheck = document.getElementById('welcome-login-bonus-check');
    
    if (!isBonusClaimed) {
      localStorage.setItem(loginBonusKey, 'claimed');
      awardXP(100); // Award XP
      setTimeout(() => {
        playCoinSound();
        showFloatingXP(100, "DAILY LOGIN BONUS! +100 XP");
      }, 800);
      if (bonusStatus) bonusStatus.textContent = "NEW BONUS CLAIMED! (+100 XP)";
      if (bonusCheck) bonusCheck.textContent = "[ CLAIMED ]";
    } else {
      if (bonusStatus) bonusStatus.textContent = "CLAIMED (+100 XP TODAY)";
      if (bonusCheck) bonusCheck.textContent = "[ CLAIMED ]";
    }
    
    if (welcomeStartBtn) {
      welcomeStartBtn.textContent = "PRESS START [PLAY]";
      welcomeStartBtn.className = welcomeStartBtn.className
        .replace(/from-purple-700|via-pink-700|to-indigo-700/g, '')
        .trim();
      if (!welcomeStartBtn.className.includes('from-emerald-600')) {
        welcomeStartBtn.className += " bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 border-emerald-500/30 shadow-emerald-500/10";
      }
    }
    if (insertCoinText) {
      insertCoinText.textContent = "[ CREW CHIEF ACTIVE - PRESS PLAY ]";
      insertCoinText.classList.add('text-emerald-400');
      insertCoinText.classList.remove('text-yellow-400');
    }
  } else {
    if (loginFields) loginFields.classList.remove('hidden');
    if (resumeContainer) {
      resumeContainer.classList.add('hidden');
      resumeContainer.classList.remove('flex');
    }
    if (welcomeStartBtn) {
      welcomeStartBtn.textContent = "Log In to Play";
      welcomeStartBtn.className = welcomeStartBtn.className
        .replace(/from-emerald-600|via-teal-600|to-cyan-600/g, '')
        .trim();
      if (!welcomeStartBtn.className.includes('from-purple-700')) {
        welcomeStartBtn.className += " bg-gradient-to-r from-purple-700 via-pink-700 to-indigo-700 border-purple-500/30 shadow-purple-500/10";
      }
    }
    if (insertCoinText) {
      insertCoinText.textContent = "[ Log In to Play ]";
      insertCoinText.classList.add('text-yellow-400');
      insertCoinText.classList.remove('text-emerald-400');
    }
  }
}


let playCrackSoundTriggered = false;

function transitionToState(newState) {
  const oldState = currentState;
  currentState = newState;
  const loggedIn = !!localStorage.getItem('ump_username');
  
  if (newState === STATES.WELCOME) {
    updateWelcomeScreenState();
  } else {
    if (demoPitchActive) {
      demoPitchActive = false;
      showBall(false);
      animatePitcherWindup(0, demoPitchData ? demoPitchData.pitcher_hand : 'R');
    }
    // If we are transitioning out of WELCOME state, reset the camera angle immediately
    if (oldState === STATES.WELCOME) {
      setCameraAngle('umpire');
    }
  }

  
  if (newState !== STATES.ABS_REVIEW) {
    setZoomedIn(false);
    clearDimensionLine();
    if (closeCallPill) {
      closeCallPill.classList.add('opacity-0', 'scale-95');
      closeCallPill.classList.remove('opacity-100', 'scale-100', 'animate-pulse');
    }
  }

  // Disable auto-collapsing. Keep the matchup card expanded for all game states.
  if (matchupCard) {
    matchupCard.classList.remove('collapsed');
  }

  // Manage main menu screens visibility
  const showWelcome = newState === STATES.WELCOME || !localStorage.getItem('ump_username');
  if (showWelcome) {
    setOverlayVisible(welcomeScreen, true);
    setOverlayVisible(teamSelectScreen, false);
    setOverlayVisible(startScreen, false);
  } else if (newState === STATES.TEAM_SELECT) {
    setOverlayVisible(welcomeScreen, false);
    setOverlayVisible(teamSelectScreen, true);
    setOverlayVisible(startScreen, false);
    if (teamSearchInput) {
      teamSearchInput.value = "";
    }
    generateTeamSelectGrid();
    setCameraAngle('umpire'); // Explicitly reset camera from any panning drift
  } else if (newState === STATES.START) {
    setOverlayVisible(welcomeScreen, false);
    setOverlayVisible(teamSelectScreen, false);
    setOverlayVisible(startScreen, true);
    isSettingsOpen = false;
    updateSettingsVisibility();
    switchTab('play');
    setCameraAngle('umpire'); // Explicitly reset camera from any panning drift
  } else {
    setOverlayVisible(welcomeScreen, false);
    setOverlayVisible(teamSelectScreen, false);
    setOverlayVisible(startScreen, false);
  }

  // Update unified top nav bar context
  updateUnifiedTopNav(newState);
  
  if (btnHudLogout) {
    const logoutSpan = btnHudLogout.querySelector('span') || document.getElementById('adaptive-nav-action-text');
    const isPlaying = newState !== STATES.START && newState !== STATES.WELCOME && newState !== STATES.TEAM_SELECT;
    
    if (logoutSpan) {
      logoutSpan.textContent = isPlaying ? "GO HOME" : "LOGOUT";
    } else {
      btnHudLogout.textContent = isPlaying ? "GO HOME" : "LOGOUT";
    }
    
    if (isPlaying) {
      btnHudLogout.className = "px-2 py-1.5 md:px-3 md:py-1.5 text-[8px] md:text-[9px] font-mono-tech font-extrabold uppercase tracking-widest bg-gray-800/80 hover:bg-[var(--retro-gold-dark)]/30 rounded-sm border border-white/10 text-gray-300 hover:text-white transition-all cursor-pointer pointer-events-auto flex items-center justify-center gap-1";
    } else {
      btnHudLogout.className = "px-2 py-1.5 md:px-3 md:py-1.5 text-[8px] md:text-[9px] font-mono-tech font-extrabold uppercase tracking-widest bg-red-950/40 hover:bg-red-600 rounded-sm border border-red-500/20 text-red-400 hover:text-white transition-all cursor-pointer pointer-events-auto flex items-center justify-center gap-1";
    }
  }
  
  // Update floating broadcast status badge
  switch (newState) {
    case STATES.WELCOME:
      updateGameStatus("Cinematic Intro", "purple");
      break;
    case STATES.TEAM_SELECT:
      updateGameStatus("Team Selection", "blue");
      break;
    case STATES.START:
      updateGameStatus("Dashboard Menu", "green");
      break;
    case STATES.IDLE:
      updateGameStatus("Waiting for Pitch", "green");
      break;
    case STATES.WINDUP:
      updateGameStatus("Pitcher Windup", "orange");
      break;
    case STATES.PITCHING:
      updateGameStatus("Pitch in Flight", "orange");
      break;
    case STATES.DECISION_PENDING:
      updateGameStatus("ABS Decision Pending", "purple");
      break;
    case STATES.ABS_REVIEW:
      updateGameStatus("ABS Replay & Review", "cyan");
      break;
    case STATES.SCOREBOARD:
      updateGameStatus("Game Over", "red");
      break;
  }
  
  switch (newState) {
    case STATES.IDLE:
      if (autoPlayTimeout) {
        clearTimeout(autoPlayTimeout);
        autoPlayTimeout = null;
      }

      if (pitchesList.length === 0) {
        if (gameMode === 'standard') {
          pitchesList = getObfuscatedPitches();
          if (inningCard) inningCard.classList.add('hidden');
        } else if (gameMode === 'orioles_full') {
          if (inningCard) {
            inningCard.classList.remove('hidden');
            populateInningDropdown();
          }
          loadHalfInning(activeInning, activeIsTop);
        } else if (gameMode === 'weekly_challenge' || gameMode === 'daily_compete') {
          if (inningCard) inningCard.classList.add('hidden');
          if (weeklyPlaylistABs.length === 0) {
            if (gameMode === 'weekly_challenge') {
              const rawABs = extractAtBatsFromWeeklyData();
              weeklyPlaylistABs = [...rawABs];
            } else {
              const team = activeFavoriteTeam || "Orioles";
              const todayStr = new Date().toISOString().split('T')[0];
              weeklyPlaylistABs = generateDailyCondensedGame(team, todayStr);
            }
          }
          const abData = weeklyPlaylistABs[activeWeeklyAbIndex] || weeklyPlaylistABs[0];
          pitchesList = abData.pitches;
          currentPitchIndex = 0;
        } else if (gameMode === 'daily_streak') {
          if (inningCard) inningCard.classList.add('hidden');
          pitchesList = generateDailyStreakPitches();
          currentPitchIndex = 0;
        }
      }
      
      currentPitch = pitchesList[currentPitchIndex];
      updateStrikeZone(currentPitch.sz_bot, currentPitch.sz_top);
      flashStrikeZonePreview();
      
      updateHolographicBatter(currentPitch.batter_hand, currentPitch.sz_bot, currentPitch.sz_top);
      updateHolographicPitcher(currentPitch.pitcher_hand);
      updateHolographicCatcher();
      showMannequins(true);
      setReviewingState(false);
      animatePitcherWindup(0.0, currentPitch.pitcher_hand);
      animateBatterSwing(-1, currentPitch.batter_hand);
      
      pitchTrajectory = calculateTrajectoryPoints(currentPitch);
      setCatcherMittPosition(pitchTrajectory.points[pitchTrajectory.points.length - 1]);
      
      showStrikeZone(false);
      showBall(false);
      clearTrajectoryTrace();
      selectCameraView('umpire');
      
      if (gameMode === 'standard') {
        pitchCounterText.textContent = `PITCH ${currentPitchIndex + 1} OF 10`;
      } else if (gameMode === 'weekly_challenge' || gameMode === 'daily_compete') {
        const total = weeklyPlaylistABs.length || 16;
        const prefix = gameMode === 'weekly_challenge' ? 'WEEKLY CHALLENGE' : 'DAILY COMPETE';
        pitchCounterText.textContent = `${prefix} | AB ${activeWeeklyAbIndex + 1} OF ${total}`;
      } else if (gameMode === 'daily_streak') {
        pitchCounterText.textContent = `STREAK: ${pitchHistory.length} | PITCH ${currentPitchIndex + 1}`;
      } else {
        pitchCounterText.textContent = `PITCH ${totalPitchesCount + 1} | OUTS ${inningOuts}`;
      }
      
      // Update matchup data and 3D player nameplates
      if (currentPitch) {
        const matchup = getMatchupNames(currentPitch);
        const pH = currentPitch.pitcher_hand || "RHP";
        const bH = currentPitch.batter_hand || "RHB";
        
        const isMobile = window.innerWidth < 640;

        if (cardPitcherName) {
          const pParts = matchup.pitcher.trim().split(/\s+/);
          const pLastName = pParts[pParts.length - 1];
          const pDisplay = isMobile ? pLastName : matchup.pitcher;
          setMarqueePlayerName(cardPitcherName, '.card-pitcher-name-dup', pDisplay);
          cardPitcherName.setAttribute('data-lastname', pLastName.toUpperCase());
        }
        if (cardPitcherHand) {
          cardPitcherHand.textContent = pH;
          if (pH.includes("R")) {
            cardPitcherHand.className = "px-2 py-0.5 text-[9px] font-mono-tech font-bold uppercase rounded bg-orange-500/10 text-orange-400 border border-orange-500/25";
          } else {
            cardPitcherHand.className = "px-2 py-0.5 text-[9px] font-mono-tech font-bold uppercase rounded bg-purple-500/10 text-purple-400 border border-purple-500/25";
          }
        }
        if (cardBatterName) {
          const bParts = matchup.batter.trim().split(/\s+/);
          const bLastName = bParts[bParts.length - 1];
          const bDisplay = isMobile ? bLastName : matchup.batter;
          setMarqueePlayerName(cardBatterName, '.card-batter-name-dup', bDisplay);
          cardBatterName.setAttribute('data-lastname', bLastName.toUpperCase());
        }
        if (cardBatterHand) {
          cardBatterHand.textContent = bH;
          if (bH.includes("L")) {
            cardBatterHand.className = "px-2 py-0.5 text-[9px] font-mono-tech font-bold uppercase rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/25";
          } else {
            cardBatterHand.className = "px-2 py-0.5 text-[9px] font-mono-tech font-bold uppercase rounded bg-blue-500/10 text-blue-400 border border-blue-500/25";
          }
        }
        
        updateNameplates(matchup.pitcher, pH, matchup.batter, bH);
        updateMatchupCardImagesAndStats(currentPitch);
      }
      
      updateLiveScoreboard();
      
      startScreen.classList.add('opacity-0', 'pointer-events-none');
      if (loggedIn) {
        setOverlayVisible(hudHeader, true);
        setOverlayVisible(matchupCard, true);
      } else {
        setOverlayVisible(hudHeader, false);
        setOverlayVisible(matchupCard, false);
      }
      if (replayBadge) {
        replayBadge.classList.add('opacity-0', 'pointer-events-none');
        replayBadge.classList.remove('opacity-100');
      }
      updateHudKeyboardHelpVisibility();
      if (!window.matchMedia('(max-width: 768px)').matches) {
        hudKeyboardHelp.classList.remove('opacity-0');
        hudKeyboardHelp.innerHTML = '<span class="keyboard-hints">Autoplay on · <kbd class="kbd-hint">A</kbd> ball · <kbd class="kbd-hint">D</kbd> strike · <kbd class="kbd-hint">Space</kbd> continue</span>';
      }
      
      document.body.classList.remove('split-screen-active');
      const container = document.getElementById('canvas-container');
      onResize(container.clientWidth, container.clientHeight);

      isSettingsOpen = false;
      updateSettingsVisibility();

      setElementVisibility(btnPlayPitch, false); // Hide, since we throw automatically
      setElementVisibility(decisionPrompt, false);
      showReviewPanel(false);
      
      if (abPitchCounter) {
        abPitchCounter.textContent = currentPitchIndex + 1;
      }
      hideQuickPreviewPanel();
      
      // Set batter swing flags from dataset
      isBatterSwinging = false;
      if (currentPitch.is_swing !== undefined) {
        isBatterSwinging = currentPitch.is_swing;
        swingOutcome = currentPitch.swing_outcome || 'WHIFF';
        swingHitType = currentPitch.swing_hit_type || '';
      } else {
        // Fallback for standard random mode
        const isStrike = isStrikeABS(currentPitch, pitchTrajectory.crossPoint);
        const crossPos = pitchTrajectory.crossPoint;
        const xMin = -0.8283;
        const xMax = 0.8283;
        const yMin = currentPitch.sz_bot - 0.12;
        const yMax = currentPitch.sz_top + 0.12;
        const dx = Math.max(0, xMin - crossPos.x, crossPos.x - xMax);
        const dy = Math.max(0, yMin - crossPos.y, crossPos.y - yMax);
        const distanceToZoneInches = Math.sqrt(dx * dx + dy * dy) * 12.0;

        let swingChance = 0.0;
        const isTwoStrikes = abStrikes === 2;
        
        if (isStrike) {
          swingChance = isTwoStrikes ? 0.55 : 0.30;
        } else {
          if (distanceToZoneInches <= 2.5) {
            swingChance = isTwoStrikes ? 0.30 : 0.12;
          } else if (distanceToZoneInches <= 6.0) {
            swingChance = isTwoStrikes ? 0.10 : 0.03;
          } else {
            swingChance = 0.005;
          }
        }
        
        if (Math.random() < swingChance) {
          isBatterSwinging = true;
          const zCenterY = (currentPitch.sz_bot + currentPitch.sz_top) / 2;
          const distFromCenter = Math.sqrt(crossPos.x * crossPos.x + Math.pow(crossPos.y - zCenterY, 2));
          const rand = Math.random();
          if (distFromCenter < 0.6) {
            if (rand < 0.45) {
              swingOutcome = 'HIT';
              swingHitType = Math.random() < 0.12 ? 'HOMERUN' : (Math.random() < 0.30 ? 'DOUBLE' : 'SINGLE');
            } else if (rand < 0.85) {
              swingOutcome = 'FOUL';
            } else {
              swingOutcome = 'OUT';
              swingHitType = Math.random() < 0.5 ? 'FLYOUT' : 'GROUNDOUT';
            }
          } else {
            swingOutcome = 'WHIFF';
          }
        }
      }

      if (isBatterSwinging) {
        calculateBattedVelocity();
      }

      // Save game state to localStorage for disconnect resilience
      saveChallengeSessionToLocal();

      // Schedule Auto-throw (skip if overlays block play or AB is waiting on summary advance)
      const abStartVisible = abStartOverlay && abStartOverlay.classList.contains('opacity-100');
      const summaryVisible = abSummaryOverlay && abSummaryOverlay.classList.contains('opacity-100');
      if (!isGamePaused && !abStartVisible && !summaryVisible && !activeAbEnded) {
        const idleDelay = quickStartNextPitch ? 400 : 1800;
        quickStartNextPitch = false;
        autoPlayTimeout = setTimeout(() => {
          triggerPitchRelease();
        }, idleDelay);
      }
      break;

    case STATES.WINDUP:
      isSettingsOpen = false;
      updateSettingsVisibility();
      setElementVisibility(btnPlayPitch, false);
      showBall(true);
      showStrikeZone(false);
      windupStartTime = performance.now();
      break;

    case STATES.PITCHING:
      isSettingsOpen = false;
      updateSettingsVisibility();
      playCrackSoundTriggered = false;
      
      const releaseHandWorld = getPitcherHandWorldPosition(currentPitch.pitcher_hand);
      const statcastStart = getBallPositionAtTime(currentPitch, 0);
      
      releaseOffset.copy(releaseHandWorld).sub(statcastStart);
      animateBallTo(releaseHandWorld);
      
      pitchStartTime = performance.now();
      showStrikeZone(showFlightSzHelper); // Strike zone helper visual in flight
      if (currentPitch && currentPitch.speed_mph) {
        playBallWhooshSound(currentPitch.speed_mph);
      }
      break;

    case STATES.DECISION_PENDING:
      isSettingsOpen = false;
      updateSettingsVisibility();
      showBall(false);
      playGlovePopSound();
      showStrikeZone(false);
      updateHudKeyboardHelpVisibility();
      if (!window.matchMedia('(max-width: 768px)').matches) {
        hudKeyboardHelp.innerHTML = '<span class="keyboard-hints"><kbd class="kbd-hint">A</kbd> ball · <kbd class="kbd-hint">D</kbd> strike · swipe on mobile</span>';
      }
      
      // Initially hide the decision prompt to allow the pitch to finish and glove pop to settle
      setElementVisibility(decisionPrompt, false);
      
      if (!localStorage.getItem('ump_username')) {
        setTimeout(() => {
          if (!localStorage.getItem('ump_username') && currentState === STATES.DECISION_PENDING) {
            if (toastMessage) {
              toastMessage.innerHTML = '<span class="text-amber-300 font-bold font-mono-tech">LOG IN REQUIRED TO CALL PITCHES</span>';
              toastMessage.classList.remove('opacity-0', 'scale-95', '-translate-y-4');
              toastMessage.classList.add('opacity-100', 'scale-100', 'translate-y-0');
            }
            transitionToState(STATES.WELCOME);
          }
        }, 1200);
      } else {
        // Wait 600ms before showing the prompt buttons and starting the countdown timer
        setTimeout(() => {
          if (currentState === STATES.DECISION_PENDING) {
            setElementVisibility(decisionPrompt, true);
            startCountdownTimer();
          }
        }, 600);
      }
      break;

    case STATES.ABS_REVIEW:
      replayStartTime = performance.now();
      reviewMinTimeElapsed = true; // Always allow immediate skip
      isSettingsOpen = false;
      updateSettingsVisibility();
      clearInterval(timerInterval);
      setElementVisibility(decisionPrompt, false);
      
      if (replayBadge && loggedIn) {
        replayBadge.classList.remove('opacity-0', 'pointer-events-none');
        replayBadge.classList.add('opacity-100');
      }
      
      const userHistoryItem = pitchHistory[pitchHistory.length - 1];
      const isCorrect = userHistoryItem.userCorrect;
      
      // Close call check for taken pitch
      if (userHistoryItem && !userHistoryItem.isSwingPlay && pitchTrajectory && pitchTrajectory.crossPoint) {
        const cross = pitchTrajectory.crossPoint;
        const distFt = getDistanceToABSZone(cross.x, cross.y);
        const absDist = Math.abs(distFt);
        const isCloseCall = absDist <= 0.15;
        
        if (isCloseCall) {
          playCloseCallSound();
          setZoomedIn(true);
          drawDimensionLine(cross);
          if (closeCallPill && closeCallDistText) {
            const distInches = absDist * 12.0;
            closeCallDistText.textContent = `${distInches.toFixed(1)}″ ${distFt < 0 ? 'IN' : 'OUT'}`;
            positionCloseCallPill(cross);
            closeCallPill.classList.remove('opacity-0', 'scale-95');
            closeCallPill.classList.add('opacity-100', 'scale-100', 'animate-pulse');
          }
        } else {
          if (closeCallPill) {
            closeCallPill.classList.add('opacity-0', 'scale-95');
            closeCallPill.classList.remove('opacity-100', 'scale-100', 'animate-pulse');
          }
        }
      } else {
        if (closeCallPill) {
          closeCallPill.classList.add('opacity-0', 'scale-95');
          closeCallPill.classList.remove('opacity-100', 'scale-100', 'animate-pulse');
        }
      }
      
      // Update count and check if AB ended
      const abEnded = updateCountAndCheckABEnd(userHistoryItem);
      
      // Save game progress after each called pitch decision
      saveGameProgress();
      
      // Stop any existing overview timer
      if (overviewTimerInterval) {
        clearInterval(overviewTimerInterval);
        overviewTimerInterval = null;
      }
      
      // Calculate replay duration so we can ensure the user sees the full trajectory
      const replayDuration = pitchTrajectory ? (pitchTrajectory.t_end / REPLAY_SPEED_MULTIPLIER) * 1000 : 800;
      // Minimum preview time: at least the replay must finish + 2000ms buffer, but at least 1s
      const minPreviewMs = Math.max(1000, replayDuration + 2000);
      
      reviewMinTimeElapsed = true;
      
      if (userHistoryItem.isSwingPlay) {
        // Swing play: stay behind plate, rate of play fast, no details button
        selectCameraView('umpire');
        showReviewPanel(false);
        showStrikeZone(false);
        showBall(true);
        showMannequins(true);
        setReviewingState(false);
        setCrossingMarkerVisible(false);
        
        let playText = '';
        if (userHistoryItem.swingOutcome === 'WHIFF') {
          playText = 'SWING & MISS (STRIKE)';
        } else if (userHistoryItem.swingOutcome === 'FOUL') {
          playText = 'FOUL BALL';
        } else if (userHistoryItem.swingOutcome === 'HIT') {
          playText = `HIT! ${userHistoryItem.swingHitType}`;
          playSuccessChime();
        } else if (userHistoryItem.swingOutcome === 'OUT') {
          playText = `OUT! ${userHistoryItem.swingHitType}`;
        }
        showABOutcomeToast(playText);
        
        // Populate pitch detail bug
        populatePitchDetailBug();
        
        if (abEnded) {
          // If the at-bat ended, bypass the float bar and show summary immediately after a 1.2s delay
          hideQuickPreviewPanel();
          if (summaryTimeout) clearTimeout(summaryTimeout);
          isTransitioningToSummary = true;
          cachedAbOutcomeText = lastAbOutcomeText; // Cache the outcome text
          summaryTimeout = setTimeout(() => {
            finishAtBatAndShowSummary();
          }, 1200);
        } else {
          // If the at-bat did NOT end, show the quick preview controls panel floating at bottom
          if (quickPreviewControls) {
            quickPreviewControls.classList.remove('opacity-0', 'pointer-events-none', 'scale-90');
            quickPreviewControls.classList.add('opacity-100', 'pointer-events-auto', 'scale-100');
          }
          if (btnViewDetails) btnViewDetails.classList.add('hidden');
          
          startQuickReviewAutoAdvance(minPreviewMs);
        }
        
      } else {
        // Taken pitch: check if reviewStyle is quick or full
        if (reviewStyle === 'quick' || !loggedIn) {
          // QUICK PREVIEW: Stay behind the plate (Umpire view)
          selectCameraView('umpire');
          showReviewPanel(false);
          showStrikeZone(true);
          showBall(true);
          showMannequins(true); // Keep batters visible
          setReviewingState(false); // Do not dim character mannequins
          setCrossingMarkerVisible(false);
          
          // Draw the crossing marker and trace
          drawTrajectoryTrace(pitchTrajectory.points, currentPitch.release_pos_y || 54.0);
          const isStrikeABSVal = userHistoryItem.absCall === 'S';
          drawCrossingMarker(pitchTrajectory.crossPoint, isStrikeABSVal);
          
          if (rateOfPlay === 'updated' && !isCorrect) {
            // Draw 3D offset challenge visual immediately on missed calls
            if (pitchTrajectory && pitchTrajectory.crossPoint) {
              drawDimensionLine(pitchTrajectory.crossPoint);
            }
          }
          
          if (loggedIn) {
            if (btnViewDetails) btnViewDetails.classList.remove('hidden');
            populatePitchDetailBug();
            
            // Award correct-call XP
            if (isCorrect) {
              awardXP(10);
              showFloatingXP(10);
            }
            
            // Award perfect At-Bat XP
            if (abEnded) {
              const abPitches = pitchHistory.slice(currentAbStartHistoryIndex);
              const allCorrect = abPitches.length > 0 && abPitches.every(p => p.userCorrect);
              if (allCorrect) {
                awardXP(50);
                showFloatingXP(50, "PERFECT AT-BAT! +50 XP");
              }
            }
            
            if (rateOfPlay === 'updated') {
              if (isCorrect) {
                // Fast correct-call transition
                showDecisionToast(isCorrect, userHistoryItem.absCall);
                if (abEnded && abStrikes === 3) {
                  playStrikeoutSirenSound();
                } else {
                  if (userHistoryItem.absCall === 'S') {
                    playStrikeCallSound();
                  } else {
                    playBallCallSound();
                  }
                }
              } else {
                // Delayed popups on incorrect calls
                playErrorBuzz();
                if (quickPreviewControls) {
                  quickPreviewControls.classList.add('opacity-0', 'pointer-events-none', 'scale-90');
                  quickPreviewControls.classList.remove('opacity-100', 'pointer-events-auto', 'scale-100');
                }
                setTimeout(() => {
                  if (currentState !== STATES.ABS_REVIEW) return;
                  showDecisionToast(isCorrect, userHistoryItem.absCall);
                  if (quickPreviewControls && !abEnded) {
                    quickPreviewControls.classList.remove('opacity-0', 'pointer-events-none', 'scale-90');
                    quickPreviewControls.classList.add('opacity-100', 'pointer-events-auto', 'scale-100');
                  }
                }, 1000);
              }
            } else {
              // Standard behavior
              showDecisionToast(isCorrect, userHistoryItem.absCall);
              if (isCorrect) {
                if (abEnded && abStrikes === 3) {
                  playStrikeoutSirenSound();
                } else {
                  if (userHistoryItem.absCall === 'S') {
                    playStrikeCallSound();
                  } else {
                    playBallCallSound();
                  }
                }
              } else {
                playErrorBuzz();
              }
            }
          }
          
          // Adjust advance timings based on rate of play
          let effectiveMinPreviewMs = minPreviewMs;
          if (rateOfPlay === 'updated') {
            if (isCorrect) {
              effectiveMinPreviewMs = 1000; // Fast transition
            } else {
              effectiveMinPreviewMs = minPreviewMs + 1000; // Extra time to view 3D offset
            }
          }
          
          if (!loggedIn) {
            startQuickReviewAutoAdvance(2000);
          } else if (abEnded) {
            hideQuickPreviewPanel();
            if (summaryTimeout) clearTimeout(summaryTimeout);
            isTransitioningToSummary = true;
            cachedAbOutcomeText = lastAbOutcomeText;
            // Short fixed delay after last-pitch review — not full replay duration again
            const summaryRevealMs = (rateOfPlay === 'updated' && !isCorrect) ? 2000 : 1200;
            summaryTimeout = setTimeout(() => {
              finishAtBatAndShowSummary();
            }, summaryRevealMs);
          } else {
            if (rateOfPlay !== 'updated' || isCorrect) {
              if (quickPreviewControls) {
                quickPreviewControls.classList.remove('opacity-0', 'pointer-events-none', 'scale-90');
                quickPreviewControls.classList.add('opacity-100', 'pointer-events-auto', 'scale-100');
              }
            }
            startQuickReviewAutoAdvance(effectiveMinPreviewMs);
          }
          
        } else {
          // FULL CUT: Change camera angle to side and open review panel sidebar
          enterFullReviewPanel(userHistoryItem);
        }
      }
      break;

    case STATES.SCOREBOARD:
      isSettingsOpen = false;
      updateSettingsVisibility();
      {
        const username = localStorage.getItem('ump_username');
        if (username) {
          clearActiveSession(username);
          awardXP(100);
          showFloatingXP(100, "GAME COMPLETE! +100 XP");
        }
      }
      document.body.classList.remove('split-screen-active');
      const containerScoreboard = document.getElementById('canvas-container');
      onResize(containerScoreboard.clientWidth, containerScoreboard.clientHeight);

      setOverlayVisible(hudHeader, false);
      setOverlayVisible(matchupCard, false);
      if (replayBadge) {
        replayBadge.classList.add('opacity-0', 'pointer-events-none');
        replayBadge.classList.remove('opacity-100');
      }
      showReviewPanel(false);
      setReviewingState(false);
      hudKeyboardHelp.classList.add('opacity-0');
      
      playFanfareSound();
      renderScoreboardDashboard();
      
      scoreboardScreen.classList.remove('pointer-events-none', 'opacity-0');
      scoreboardScreen.classList.add('opacity-100');
      break;
  }
}

function setElementVisibility(el, visible) {
  if (!el) return;
  if (visible) {
    el.classList.remove('opacity-0', 'pointer-events-none', 'scale-95', 'translate-y-8');
    el.classList.add('opacity-100', 'scale-100', 'pointer-events-auto');
  } else {
    el.classList.add('opacity-0', 'pointer-events-none');
    el.classList.remove('opacity-100', 'pointer-events-auto');
  }
}

function updateSettingsVisibility() {
  if (isSettingsOpen && (currentState === STATES.IDLE || currentState === STATES.ABS_REVIEW || currentState === STATES.START)) {
    if (cameraControlsPanel) {
      let targetButton = null;
      if (currentState === STATES.START) {
        targetButton = btnDashboardSettingsToggle;
      } else {
        targetButton = btnSettingsToggle;
      }
      if (targetButton) {
        const rect = targetButton.getBoundingClientRect();
        cameraControlsPanel.style.top = `${rect.bottom}px`;
        cameraControlsPanel.style.right = `${window.innerWidth - rect.right}px`;
        cameraControlsPanel.style.left = 'auto';
      }
      cameraControlsPanel.classList.remove('opacity-0', 'scale-95', 'pointer-events-none');
      cameraControlsPanel.classList.add('opacity-100', 'scale-100', 'pointer-events-auto');
    }
    if (btnSettingsToggle) {
      btnSettingsToggle.classList.add('bg-white/10');
      btnSettingsToggle.classList.add('border-purple-500/40');
    }
    if (btnDashboardSettingsToggle) {
      btnDashboardSettingsToggle.classList.add('bg-purple-600');
      btnDashboardSettingsToggle.classList.remove('bg-gray-800');
    }
  } else {
    if (cameraControlsPanel) {
      cameraControlsPanel.classList.add('opacity-0', 'scale-95', 'pointer-events-none');
      cameraControlsPanel.classList.remove('opacity-100', 'scale-100', 'pointer-events-auto');
    }
    if (btnSettingsToggle) {
      btnSettingsToggle.classList.remove('bg-white/10');
      btnSettingsToggle.classList.remove('border-purple-500/40');
    }
    if (btnDashboardSettingsToggle) {
      btnDashboardSettingsToggle.classList.remove('bg-purple-600');
      btnDashboardSettingsToggle.classList.add('bg-gray-800');
    }
  }
}

function playBatCrackSound() {
  if (!audioCtx || !isGameplayAudioAllowed()) return;
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  const now = audioCtx.currentTime;
  
  // 1. Sharp wooden crack transient (high-frequency sweep)
  const osc1 = audioCtx.createOscillator();
  const gainOsc1 = audioCtx.createGain();
  osc1.type = 'triangle';
  osc1.frequency.setValueAtTime(2200, now);
  osc1.frequency.exponentialRampToValueAtTime(800, now + 0.03);
  gainOsc1.gain.setValueAtTime(0.65, now);
  gainOsc1.gain.exponentialRampToValueAtTime(0.001, now + 0.03);
  
  osc1.connect(gainOsc1);
  gainOsc1.connect(audioCtx.destination);
  osc1.start(now);
  osc1.stop(now + 0.03);
  
  // 2. High-Q bandpass-filtered noise representing wood contact snap
  const bufferSize = audioCtx.sampleRate * 0.07; 
  const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  const noise = audioCtx.createBufferSource();
  noise.buffer = buffer;
  
  const filter = audioCtx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(2800, now);
  filter.Q.setValueAtTime(6.0, now);
  
  const gainNoise = audioCtx.createGain();
  gainNoise.gain.setValueAtTime(1.1, now);
  gainNoise.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
  
  noise.connect(filter);
  filter.connect(gainNoise);
  gainNoise.connect(audioCtx.destination);
  noise.start(now);
  noise.stop(now + 0.07);
  
  // 3. Low-mid deep resonant thud (mass of the bat barrel)
  const osc2 = audioCtx.createOscillator();
  const gainOsc2 = audioCtx.createGain();
  osc2.type = 'sine';
  osc2.frequency.setValueAtTime(180, now);
  osc2.frequency.exponentialRampToValueAtTime(60, now + 0.12);
  gainOsc2.gain.setValueAtTime(0.55, now);
  gainOsc2.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
  
  osc2.connect(gainOsc2);
  gainOsc2.connect(audioCtx.destination);
  osc2.start(now);
  osc2.stop(now + 0.12);
}

function calculateBattedVelocity() {
  battedBallVel.set(0, 0, 0);
  wasSwingContact = swingOutcome === 'FOUL' || swingOutcome === 'HIT' || swingOutcome === 'OUT';
  
  if (!wasSwingContact) return;
  
  if (swingOutcome === 'FOUL') {
    if (Math.random() < 0.5) {
      battedBallVel.set(
        (Math.random() - 0.5) * 16,
        45 + Math.random() * 20,
        -(25 + Math.random() * 15) // backwards
      );
    } else {
      const side = Math.random() < 0.5 ? -1 : 1;
      battedBallVel.set(
        side * (40 + Math.random() * 15),
        6 + Math.random() * 8,
        15 + Math.random() * 15 // wide grounder
      );
    }
  } else if (swingOutcome === 'HIT') {
    if (swingHitType === 'HOMERUN') {
      battedBallVel.set(
        (Math.random() - 0.5) * 28,
        42 + Math.random() * 12,
        95 + Math.random() * 20
      );
    } else if (swingHitType === 'DOUBLE') {
      battedBallVel.set(
        (Math.random() - 0.5) * 38,
        22 + Math.random() * 10,
        78 + Math.random() * 12
      );
    } else {
      battedBallVel.set(
        (Math.random() - 0.5) * 44,
        10 + Math.random() * 10,
        64 + Math.random() * 18
      );
    }
  } else if (swingOutcome === 'OUT') {
    if (swingHitType === 'FLYOUT') {
      battedBallVel.set(
        (Math.random() - 0.5) * 34,
        34 + Math.random() * 12,
        64 + Math.random() * 12
      );
    } else {
      battedBallVel.set(
        (Math.random() - 0.5) * 40,
        2 + Math.random() * 5,
        48 + Math.random() * 18
      );
    }
  }
}

/**
 * Runs a background pitching demonstration loop on the welcome screen
 * with slow camera panning to level up design aesthetics.
 */
function updateDemoPitch() {
  const time = performance.now() / 3500;
  
  // Pan the camera behind home plate via scene.js utility
  setZoomedIn(false);
  updateWelcomeCamera(time);

  if (!demoPitchActive) {
    if (performance.now() > demoCooldownEnd) {
      // Pick a random pitch
      demoPitchData = Object.assign({}, demoPitches[Math.floor(Math.random() * demoPitches.length)]);
      
      // Randomize pitcher/batter hands for variety
      demoPitchData.pitcher_hand = Math.random() > 0.5 ? 'R' : 'L';
      demoPitchData.batter_hand = Math.random() > 0.5 ? 'R' : 'L';
      
      demoPitchActive = true;
      demoPitchStartTime = performance.now();
      demoPitchState = 'WINDUP';
      demoPitchTrajectory = calculateTrajectoryPoints(demoPitchData);
      showBall(true);
    }
    return;
  }

  const elapsed = (performance.now() - demoPitchStartTime) / 1000;
  if (demoPitchState === 'WINDUP') {
    const durationToRelease = WINDUP_DURATION * 0.75;
    const progress = Math.min(elapsed / durationToRelease, 1.0);
    animatePitcherWindup(progress * 0.75, demoPitchData.pitcher_hand);
    animateBatterSwing(-1, demoPitchData.batter_hand);
    
    const handWorld = getPitcherHandWorldPosition(demoPitchData.pitcher_hand);
    animateBallTo(handWorld);
    
    if (progress >= 1.0) {
      demoPitchState = 'PITCHING';
      demoFlightStartTime = performance.now();
    }
  } else if (demoPitchState === 'PITCHING') {
    const flightElapsed = (performance.now() - demoFlightStartTime) / 1000;
    const followThroughDuration = WINDUP_DURATION * 0.25;
    const followThroughProgress = Math.min(0.75 + (flightElapsed / followThroughDuration) * 0.25, 1.0);
    animatePitcherWindup(followThroughProgress, demoPitchData.pitcher_hand);
    animateBatterSwing(-1, demoPitchData.batter_hand);
    
    if (flightElapsed < demoPitchTrajectory.t_end) {
      const pos = getBallPositionAtTime(demoPitchData, flightElapsed);
      animateBallTo(pos);
    } else {
      // Glove pop!
      playGlovePopSound();
      demoPitchActive = false;
      demoCooldownEnd = performance.now() + 2500; // 2.5s cooldown before next demo pitch
      showBall(false);
      animatePitcherWindup(0, demoPitchData.pitcher_hand);
    }
  }
}

/**
 * Handles pitch flight and wind-up animation frames
 */
function tick() {
  requestAnimationFrame(tick);
  
  if (currentState === STATES.WELCOME) {
    updateDemoPitch();
    render();
    return;
  }

  if (isGamePaused) {
    render();
    return;
  }

  
  if (currentState === STATES.WINDUP) {
    const elapsed = ((performance.now() - windupStartTime) / 1000) * pitchSpeedMultiplier;
    const durationToRelease = WINDUP_DURATION * 0.75;
    const progress = Math.min((elapsed / durationToRelease) * 0.75, 0.75);
    
    animatePitcherWindup(progress, currentPitch.pitcher_hand);
    animateBatterSwing(-1, currentPitch.batter_hand);
    
    const handWorld = getPitcherHandWorldPosition(currentPitch.pitcher_hand);
    animateBallTo(handWorld);
    
    if (progress >= 0.75) {
      transitionToState(STATES.PITCHING);
    }
  } else if (currentState === STATES.PITCHING) {
    const elapsed = ((performance.now() - pitchStartTime) / 1000) * pitchSpeedMultiplier;
    
    const followThroughDuration = WINDUP_DURATION * 0.25;
    const followThroughProgress = Math.min(0.75 + (elapsed / followThroughDuration) * 0.25, 1.0);
    animatePitcherWindup(followThroughProgress, currentPitch.pitcher_hand);
    
    if (isBatterSwinging) {
      const swingDuration = 0.25;
      const swingStart = pitchTrajectory.t_cross - (swingDuration * 0.5); // Center contact at progress 0.5
      const swingElapsed = elapsed - swingStart;
      const swingProgress = Math.min(Math.max(swingElapsed / swingDuration, 0.0), 1.0);
      animateBatterSwing(swingProgress, currentPitch.batter_hand);
    } else {
      animateBatterSwing(-1, currentPitch.batter_hand);
    }
    
    if (isBatterSwinging && wasSwingContact && elapsed >= pitchTrajectory.t_cross) {
      const t_after = elapsed - pitchTrajectory.t_cross;
      const pos = new THREE.Vector3(
        pitchTrajectory.crossPoint.x + battedBallVel.x * t_after,
        pitchTrajectory.crossPoint.y + battedBallVel.y * t_after - 16.1 * t_after * t_after,
        pitchTrajectory.crossPoint.z + battedBallVel.z * t_after
      );
      animateBallTo(pos);
      
      if (!playCrackSoundTriggered) {
        playBatCrackSound();
        playCrackSoundTriggered = true;
      }
      
      if (t_after >= 1.2) {
        submitSwingDecision();
      }
    } else {
      if (elapsed < pitchTrajectory.t_end) {
        const pos = getBallPositionAtTime(currentPitch, elapsed);
        if (elapsed < releaseBlendDuration) {
          const blendFactor = 1.0 - (elapsed / releaseBlendDuration);
          pos.x += releaseOffset.x * blendFactor;
          pos.y += releaseOffset.y * blendFactor;
          pos.z += releaseOffset.z * blendFactor;
        }
        animateBallTo(pos);
      } else {
        if (isBatterSwinging) {
          submitSwingDecision();
        } else {
          transitionToState(STATES.DECISION_PENDING);
        }
      }
    }
  } else if (currentState === STATES.ABS_REVIEW) {
    const userHistoryItem = pitchHistory[pitchHistory.length - 1];
    const isSwingPlay = userHistoryItem && userHistoryItem.isSwingPlay;
    
    const speedMult = isSwingPlay ? REPLAY_SPEED_MULTIPLIER : 0.4;
    let elapsed = ((performance.now() - replayStartTime) / 1000) * speedMult;
    if (isSwingPlay) {
      // Skip slow-motion replay for swing plays: jump to end immediately
      const maxElapsed = wasSwingContact ? (pitchTrajectory.t_cross + 1.2) : pitchTrajectory.t_end;
      elapsed = maxElapsed;
    }
    
    const followThroughDuration = WINDUP_DURATION * 0.25;
    const followThroughProgress = Math.min(0.75 + (elapsed / followThroughDuration) * 0.25, 1.0);
    animatePitcherWindup(followThroughProgress, currentPitch.pitcher_hand);
    
    if (isBatterSwinging) {
      const swingDuration = 0.25;
      const swingStart = pitchTrajectory.t_cross - (swingDuration * 0.5); // Center contact at progress 0.5
      const swingElapsed = elapsed - swingStart;
      const swingProgress = Math.min(Math.max(swingElapsed / swingDuration, 0.0), 1.0);
      animateBatterSwing(swingProgress, currentPitch.batter_hand);
    } else {
      animateBatterSwing(-1, currentPitch.batter_hand);
    }

    if (isBatterSwinging && wasSwingContact && elapsed >= pitchTrajectory.t_cross) {
      const t_after = elapsed - pitchTrajectory.t_cross;
      const pos = new THREE.Vector3(
        pitchTrajectory.crossPoint.x + battedBallVel.x * t_after,
        pitchTrajectory.crossPoint.y + battedBallVel.y * t_after - 16.1 * t_after * t_after,
        pitchTrajectory.crossPoint.z + battedBallVel.z * t_after
      );
      animateBallTo(pos);
      setCrossingMarkerVisible(false);
    } else {
      if (elapsed < pitchTrajectory.t_end) {
        const pos = getBallPositionAtTime(currentPitch, elapsed);
        animateBallTo(pos);
        drawTrajectoryTrace(pitchTrajectory.points, pos.z);
        if (isSwingPlay) {
          setCrossingMarkerVisible(false);
        } else {
          setCrossingMarkerVisible(elapsed >= pitchTrajectory.t_cross);
        }
      } else {
        const finalPos = getBallPositionAtTime(currentPitch, pitchTrajectory.t_end);
        animateBallTo(finalPos);
        drawTrajectoryTrace(pitchTrajectory.points, finalPos.z);
        if (isSwingPlay) {
          setCrossingMarkerVisible(false);
        } else {
          setCrossingMarkerVisible(true);
        }
      }
    }
  }
  
  render();
}

/**
 * Commences pitching motion animation
 */
function triggerPitchRelease() {
  if (currentState !== STATES.IDLE) return;
  verifyAndForceUmpireCameraPosition();
  transitionToState(STATES.WINDUP);
}

function submitSwingDecision() {
  if (currentState !== STATES.PITCHING) return;
  
  const absStrike = isStrikeABS(currentPitch, pitchTrajectory.crossPoint);
  const absCall = absStrike ? 'S' : 'B';
  const realCall = currentPitch.real_ump_call || currentPitch.ump_call;
  
  const userCorrect = true;
  const realCorrect = realCall === absCall;
  
  // Save decisions and swing details directly to currentPitch to enable recovery
  currentPitch.userCall = swingOutcome;
  currentPitch.absCall = absCall;
  currentPitch.realCall = realCall;
  currentPitch.userCorrect = userCorrect;
  currentPitch.realCorrect = realCorrect;
  currentPitch.isSwingPlay = true;
  currentPitch.swingOutcome = swingOutcome;
  currentPitch.swingHitType = swingHitType;
  currentPitch.pitchTrajectory = pitchTrajectory;
  
  pitchHistory.push({
    pitchNum: currentPitchIndex + 1,
    pitchType: currentPitch.pitch_type,
    speedMph: currentPitch.speed_mph,
    userCall: swingOutcome,
    absCall,
    realCall,
    userCorrect,
    realCorrect,
    pitchData: currentPitch,
    trajectory: pitchTrajectory,
    isSwingPlay: true,
    swingOutcome,
    swingHitType
  });
  
  transitionToState(STATES.ABS_REVIEW);
}

/**
 * Starts 3-second countdown timer for decision making
 */
function startCountdownTimer() {
  timerSecondsLeft = 3;
  timerCountdownText.textContent = timerSecondsLeft;
  if (timerCountdownText) {
    timerCountdownText.classList.remove('countdown-timer-text--hurry');
  }
  
  timerProgressRing.classList.remove('animate-timer-ring');
  void timerProgressRing.offsetWidth;
  timerProgressRing.classList.add('animate-timer-ring');

  timerInterval = setInterval(() => {
    timerSecondsLeft--;
    
    if (timerSecondsLeft > 0) {
      timerCountdownText.textContent = timerSecondsLeft;
      if (timerCountdownText) {
        timerCountdownText.classList.toggle('countdown-timer-text--hurry', timerSecondsLeft === 1);
      }
      playTimerTickSound();
    } else {
      clearInterval(timerInterval);
      submitUserDecision('TIMEOUT');
    }
  }, 1000);
}

/**
 * Compiles user choice and compares with mathematical ABS ruling
 */
function submitUserDecision(userCall) {
  if (currentState !== STATES.DECISION_PENDING) return;
  if (!localStorage.getItem('ump_username')) {
    requireLoggedInUser();
    return;
  }
  
  clearInterval(timerInterval);
  
  const absStrike = isStrikeABS(currentPitch, pitchTrajectory.crossPoint);
  const absCall = absStrike ? 'S' : 'B';
  const realCall = currentPitch.real_ump_call || currentPitch.ump_call;
  
  const userCorrect = userCall === absCall;
  const realCorrect = realCall === absCall;
  
  // Save decisions directly to currentPitch to enable recovery
  currentPitch.userCall = userCall;
  currentPitch.absCall = absCall;
  currentPitch.realCall = realCall;
  currentPitch.userCorrect = userCorrect;
  currentPitch.realCorrect = realCorrect;
  currentPitch.isSwingPlay = false;
  currentPitch.pitchTrajectory = pitchTrajectory;
  
  pitchHistory.push({
    pitchNum: currentPitchIndex + 1,
    pitchType: currentPitch.pitch_type,
    speedMph: currentPitch.speed_mph,
    userCall,
    absCall,
    realCall,
    userCorrect,
    realCorrect,
    pitchData: currentPitch,
    trajectory: pitchTrajectory,
    isSwingPlay: false
  });
  
  transitionToState(STATES.ABS_REVIEW);
}

/**
 * Handles click navigation from review panel
 */
function updateCountAndCheckABEnd(historyItem) {
  // Advance balls and strikes count based on play outcome
  if (historyItem.isSwingPlay) {
    if (historyItem.swingOutcome === 'WHIFF') {
      abStrikes++;
    } else if (historyItem.swingOutcome === 'FOUL') {
      if (abStrikes < 2) {
        abStrikes++;
      }
    }
  } else {
    // Took pitch: count advances based on user decision (Simulates Umpire calling game)
    if (historyItem.userCall === 'S') {
      abStrikes++;
    } else if (historyItem.userCall === 'B') {
      abBalls++;
    } else if (historyItem.userCall === 'TIMEOUT') {
      abStrikes++;
    }
  }
  
  // Resolve At-Bat if ended
  let abEnded = false;
  let abOutcomeText = '';
  
  const matchup = getMatchupNames(currentPitch);
  const batterName = matchup.batter;
  
  if (historyItem.isSwingPlay && historyItem.swingOutcome === 'HIT') {
    abEnded = true;
    abOutcomeText = `${batterName.toUpperCase()} HITS A ${historyItem.swingHitType}!`;
    totalSessionH++;
  } else if (historyItem.isSwingPlay && historyItem.swingOutcome === 'OUT') {
    abEnded = true;
    abOutcomeText = `${batterName.toUpperCase()} OUT (${historyItem.swingHitType})`;
    inningOuts++;
    totalSessionOuts++;
  } else if (abStrikes === 3) {
    abEnded = true;
    abOutcomeText = `${batterName.toUpperCase()} STRIKEOUT!`;
    inningOuts++;
    totalSessionOuts++;
    totalSessionK++;
  } else if (abBalls === 4) {
    abEnded = true;
    abOutcomeText = `${batterName.toUpperCase()} WALKS!`;
    totalSessionBB++;
  } else if (currentPitchIndex === pitchesList.length - 1) {
    abEnded = true;
    abOutcomeText = "AT-BAT COMPLETE";
  }
  
  activeAbEnded = abEnded;
  
  if (abEnded) {
    // Cache the completed at-bat details for the summary screen
    const completedPitch = currentPitch;
    const completedMatchup = getMatchupNames(completedPitch);
    lastAbOutcomeText = abOutcomeText;
    lastAbPitcher = completedMatchup.pitcher;
    lastAbBatter = completedMatchup.batter;
    lastAbBlurb = completedPitch.historical_blurb || "No play-by-play description available.";
    lastCompletedPitch = completedPitch;
  }
  
  return abEnded;
}

/**
 * After the final pitch of an at-bat, show the post-AB summary overlay.
 * Does not require ABS_REVIEW state (safe for delayed timeouts).
 */
function finishAtBatAndShowSummary() {
  if (!activeAbEnded || gameMode === 'daily_streak') return;

  if (autoPlayTimeout) {
    clearTimeout(autoPlayTimeout);
    autoPlayTimeout = null;
  }
  if (summaryTimeout) {
    clearTimeout(summaryTimeout);
    summaryTimeout = null;
  }
  isTransitioningToSummary = false;

  hideQuickPreviewPanel();
  showReviewPanel(false);
  if (replayBadge) {
    replayBadge.classList.add('opacity-0', 'pointer-events-none');
    replayBadge.classList.remove('opacity-100');
  }

  const loggedIn = !!localStorage.getItem('ump_username');
  if (!loggedIn) {
    currentPitchIndex++;
    if (currentPitchIndex >= pitchesList.length) {
      currentPitchIndex = 0;
      pitchHistory = [];
    }
    abBalls = 0;
    abStrikes = 0;
    transitionToState(STATES.IDLE);
    return;
  }

  totalPitchesCount++;
  currentPitchIndex++;
  activeAbPitchIndex = currentPitchIndex;
  abBalls = 0;
  abStrikes = 0;
  saveGameProgress();

  showAtBatSummaryScreen(cachedAbOutcomeText || lastAbOutcomeText);
}

/**
 * Handles click navigation from review panel
 */
function advanceGameFlow(immediate = false) {
  if (currentState !== STATES.ABS_REVIEW && !(immediate && activeAbEnded)) return;
  if (isTransitioningToSummary && !immediate) return;
  
  if (autoPlayTimeout) {
    clearTimeout(autoPlayTimeout);
    autoPlayTimeout = null;
  }

  const loggedIn = !!localStorage.getItem('ump_username');
  if (!loggedIn) {
    currentPitchIndex++;
    if (currentPitchIndex >= pitchesList.length) {
      currentPitchIndex = 0;
      pitchHistory = [];
    }
    abBalls = 0;
    abStrikes = 0;
    transitionToState(STATES.IDLE);
    return;
  }

  const historyItem = pitchHistory[pitchHistory.length - 1];
  
  totalPitchesCount++;
  currentPitchIndex++;
  activeAbPitchIndex = currentPitchIndex;
  
  let isGameOver = false;
  
  if (gameMode === 'standard' && currentPitchIndex >= 10) {
    isGameOver = true;
  } else if (gameMode === 'weekly_challenge') {
    const isHalfInningEnd = (currentPitchIndex >= pitchesList.length);
    if (isHalfInningEnd && activeWeeklyAbIndex >= weeklyPlaylistABs.length - 1) {
      isGameOver = true;
    }
  } else if (gameMode === 'daily_streak') {
    // In Daily Streak, the game ends on the very first missed call!
    if (!historyItem.isSwingPlay && !historyItem.userCorrect) {
      isGameOver = true;
      activeAbEnded = true;
      showABOutcomeToast("STREAK ENDED! MISSED CALL");
      const username = localStorage.getItem('ump_username') || 'GUEST_UMPIRE';
      localStorage.setItem(`daily_streak_last_played_date_${username}`, new Date().toLocaleDateString());
      updateDailyStreakStatusUI();
    }
  } else if (gameMode === 'orioles_full') {
    const isHalfInningEnd = (inningOuts >= 3 || currentPitchIndex >= pitchesList.length);
    if (isHalfInningEnd) {
      if (activeIsTop) {
        activeIsTop = false;
        loadNextHalfInning();
      } else {
        if (activeInning < 9) {
          activeInning++;
          activeIsTop = true;
          loadNextHalfInning();
        } else {
          isGameOver = true;
        }
      }
    }
  }

  isSessionOver = isGameOver;
  
  if (activeAbEnded && gameMode !== 'daily_streak') {
    // Transition to summary overlay
    if (autoPlayTimeout) {
      clearTimeout(autoPlayTimeout);
      autoPlayTimeout = null;
    }
    hideQuickPreviewPanel();
    showReviewPanel(false);
    if (replayBadge) {
      replayBadge.classList.add('opacity-0', 'pointer-events-none');
      replayBadge.classList.remove('opacity-100');
    }
    
    // Clear counts for the next AB
    abBalls = 0;
    abStrikes = 0;
    saveGameProgress();
    
    if (immediate) {
      if (summaryTimeout) {
        clearTimeout(summaryTimeout);
        summaryTimeout = null;
      }
      isTransitioningToSummary = false;
      showAtBatSummaryScreen(lastAbOutcomeText);
    } else {
      isTransitioningToSummary = true;
      cachedAbOutcomeText = lastAbOutcomeText; // Cache the outcome text
      if (summaryTimeout) clearTimeout(summaryTimeout);
      summaryTimeout = setTimeout(() => {
        summaryTimeout = null;
        isTransitioningToSummary = false;
        showAtBatSummaryScreen(lastAbOutcomeText);
      }, 600);
    }
  } else {
    if (isGameOver) {
      transitionToState(STATES.SCOREBOARD);
    } else {
      transitionToState(STATES.IDLE);
    }
  }
}

function showABOutcomeToast(text) {
  if (gameStatusBadge) {
    gameStatusBadge.classList.add('opacity-0');
    gameStatusBadge.classList.remove('opacity-100');
  }
  toastMessage.innerHTML = `<span class="text-purple-300 font-bold font-mono-tech">${text}</span>`;
  toastMessage.className = 'absolute top-4 left-1/2 -translate-x-1/2 transform px-6 py-2 rounded-full font-black uppercase tracking-wider text-xs md:text-sm shadow-xl opacity-100 scale-100 transition-all duration-300 bg-purple-950/95 text-white border border-purple-500/40 shadow-purple-500/10 pointer-events-auto z-50 whitespace-nowrap';
  setTimeout(() => {
    toastMessage.classList.add('opacity-0', 'scale-95');
    toastMessage.classList.remove('opacity-100', 'scale-100');
    if (gameStatusBadge && currentState !== STATES.START && currentState !== STATES.SCOREBOARD && currentState !== STATES.WELCOME && currentState !== STATES.TEAM_SELECT) {
      gameStatusBadge.classList.remove('opacity-0');
      gameStatusBadge.classList.add('opacity-100');
    }
  }, 2200);
}

/**
 * Displays the At-Bat Start overlay with matchup info and a 3-second auto-start countdown
 */
function showAtBatStartScreen(onConfirmCallback, isResume = false) {
  if (!localStorage.getItem('ump_username')) {
    if (onConfirmCallback) onConfirmCallback();
    return;
  }
  if (!abStartOverlay) {
    if (onConfirmCallback) onConfirmCallback();
    return;
  }

  // Cancel any running auto-play
  if (autoPlayTimeout) {
    clearTimeout(autoPlayTimeout);
    autoPlayTimeout = null;
  }

  // Populate matchup info
  const pitch = pitchesList[currentPitchIndex] || currentPitch;
  if (pitch) {
    const matchup = getMatchupNames(pitch);
    setMarqueePlayerName(abStartPitcher, '.ab-start-pitcher-dup', matchup.pitcher);
    setMarqueePlayerName(abStartBatter, '.ab-start-batter-dup', matchup.batter);

    const pH = pitch.pitcher_hand || 'RHP';
    const bH = pitch.batter_hand || 'RHB';
    if (abStartPitcherHand) {
      abStartPitcherHand.textContent = pH;
      if (pH.includes("R")) {
        abStartPitcherHand.className = "text-[7px] font-mono-tech font-bold uppercase px-1 rounded bg-orange-500/10 text-orange-400 border border-orange-500/25";
      } else {
        abStartPitcherHand.className = "text-[7px] font-mono-tech font-bold uppercase px-1 rounded bg-purple-500/10 text-purple-400 border border-purple-500/25";
      }
    }
    if (abStartBatterHand) {
      abStartBatterHand.textContent = bH;
      if (bH.includes("L")) {
        abStartBatterHand.className = "text-[7px] font-mono-tech font-bold uppercase px-1 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/25";
      } else {
        abStartBatterHand.className = "text-[7px] font-mono-tech font-bold uppercase px-1 rounded bg-blue-500/10 text-blue-400 border border-blue-500/25";
      }
    }

    // Dynamic headshot lookup
    fetchPlayerMlbId(matchup.pitcher).then(pitcherId => {
      if (abStartPitcherImg) {
        abStartPitcherImg.src = pitcherId > 0 
          ? `https://midfield.mlbstatic.com/v1/people/${pitcherId}/spots/120` 
          : 'https://midfield.mlbstatic.com/v1/people/generic/spots/120';
      }
    });
    fetchPlayerMlbId(matchup.batter).then(batterId => {
      if (abStartBatterImg) {
        abStartBatterImg.src = batterId > 0 
          ? `https://midfield.mlbstatic.com/v1/people/${batterId}/spots/120` 
          : 'https://midfield.mlbstatic.com/v1/people/generic/spots/120';
      }
    });

    // Dynamic team logos
    let pitcherTeam = getPlayerTeam(matchup.pitcher);
    let batterTeam = getPlayerTeam(matchup.batter);
    if (!pitcherTeam || !batterTeam) {
      let titleText = "ACTIVE MATCHUP";
      if (gameMode === 'weekly_challenge') {
        const gameData = WEEKLY_CHALLENGE_DATA[activeGameIndex];
        if (gameData) titleText = gameData.title;
      }
      const parts = titleText.split(' vs. ');
      const awayTeam = parts[0] || "Orioles";
      const homeTeam = parts[1] || "Tigers";
      const pitchIsTop = pitch.is_top !== undefined ? pitch.is_top : activeIsTop;
      if (!pitcherTeam) pitcherTeam = pitchIsTop ? homeTeam : awayTeam;
      if (!batterTeam) batterTeam = pitchIsTop ? awayTeam : homeTeam;
    }
    if (abStartPitcherLogo) abStartPitcherLogo.src = getTeamLogoUrl(pitcherTeam);
    if (abStartBatterLogo) abStartBatterLogo.src = getTeamLogoUrl(batterTeam);

    // Dynamic stats
    if (abStartPitcherStats) {
      const isLHP = pH === "LHP";
      if (matchup.pitcher === "Corbin Burnes") abStartPitcherStats.textContent = "ERA: 2.94 | SO: 200 | WHIP: 1.07";
      else if (matchup.pitcher === "Tarik Skubal") abStartPitcherStats.textContent = "ERA: 2.58 | SO: 228 | WHIP: 0.95";
      else if (matchup.pitcher === "Gerrit Cole") abStartPitcherStats.textContent = "ERA: 3.12 | SO: 180 | WHIP: 1.10";
      else if (matchup.pitcher === "Zack Wheeler") abStartPitcherStats.textContent = "ERA: 2.70 | SO: 224 | WHIP: 0.96";
      else abStartPitcherStats.textContent = `ERA: 3.24 | SO: 165 | WHIP: 1.12 (${isLHP ? 'LHP' : 'RHP'})`;
    }
    if (abStartBatterStats) {
      if (matchup.batter === "Aaron Judge") abStartBatterStats.textContent = "AVG: .322 | HR: 58 | OPS: 1.159";
      else if (matchup.batter === "Juan Soto") abStartBatterStats.textContent = "AVG: .288 | HR: 41 | OPS: .989";
      else if (matchup.batter === "Gunnar Henderson") abStartBatterStats.textContent = "AVG: .281 | HR: 37 | OPS: .893";
      else if (matchup.batter === "Shohei Ohtani") abStartBatterStats.textContent = "AVG: .310 | HR: 54 | OPS: 1.036";
      else if (matchup.batter === "Francisco Lindor") abStartBatterStats.textContent = "AVG: .273 | HR: 33 | OPS: .844";
      else abStartBatterStats.textContent = `AVG: .268 | HR: 18 | OPS: .795 (${bH})`;
    }

    // Populate live game context
    if (abStartInning) {
      const half = pitch.is_top ? "Top" : "Bot";
      const inningNum = pitch.inning || 1;
      let suffix = "th";
      if (inningNum === 1) suffix = "st";
      else if (inningNum === 2) suffix = "nd";
      else if (inningNum === 3) suffix = "rd";
      abStartInning.textContent = `${half} ${inningNum}${suffix}`;
    }

    if (abStartOuts) {
      const outs = pitch.outs !== undefined ? pitch.outs : 0;
      abStartOuts.textContent = `${outs} Out${outs !== 1 ? 's' : ''}`;
    }

    if (abStartScore) {
      const scoreAway = pitch.score_away !== undefined ? pitch.score_away : 0;
      const scoreHome = pitch.score_home !== undefined ? pitch.score_home : 0;
      abStartScore.textContent = `${scoreAway} - ${scoreHome}`;
    }

    // Toggle active classes for base runner indicators
    const runners = pitch.runners || [0, 0, 0];
    const baseElements = [abStartBase1, abStartBase2, abStartBase3];
    baseElements.forEach((el, idx) => {
      if (el) {
        if (runners[idx]) {
          el.classList.remove('bg-slate-700', 'border-slate-600');
          el.classList.add('bg-orange-500', 'border-orange-400');
        } else {
          el.classList.remove('bg-orange-500', 'border-orange-400');
          el.classList.add('bg-slate-700', 'border-slate-600');
        }
      }
    });
  }

  const challengeBadge = document.getElementById('ab-start-challenge-badge');
  const startTitle = document.getElementById('ab-start-title');
  const startSubtitle = document.getElementById('ab-start-subtitle');
  if (challengeBadge) {
    if (gameMode === 'weekly_challenge') {
      challengeBadge.textContent = 'Weekly Challenge';
      challengeBadge.className = 'px-3 py-1 text-[10px] font-bold uppercase tracking-widest bg-gradient-to-r from-emerald-600 to-green-600 rounded-full shadow-lg shadow-green-500/25';
    } else if (gameMode === 'daily_streak') {
      challengeBadge.textContent = 'Daily Streak';
      challengeBadge.className = 'px-3 py-1 text-[10px] font-bold uppercase tracking-widest bg-gradient-to-r from-amber-600 to-orange-600 rounded-full shadow-lg';
    } else if (gameMode === 'daily_compete') {
      challengeBadge.textContent = 'Daily Compete';
      challengeBadge.className = 'px-3 py-1 text-[10px] font-bold uppercase tracking-widest bg-gradient-to-r from-cyan-600 to-blue-600 rounded-full shadow-lg';
    } else {
      challengeBadge.textContent = 'Standard Mode';
      challengeBadge.className = 'px-3 py-1 text-[10px] font-bold uppercase tracking-widest bg-gradient-to-r from-slate-600 to-slate-700 rounded-full';
    }
  }

  const startWeeklyDetails = document.getElementById('ab-start-weekly-challenge-details');
  if (gameMode === 'weekly_challenge' && weeklyPlaylistABs && weeklyPlaylistABs.length > 0) {
    if (startWeeklyDetails) {
      startWeeklyDetails.classList.remove('hidden');
      
      const totalCount = weeklyPlaylistABs.length || 200;
      const completedCount = weeklyPlaylistABs.filter(ab => ab.completed).length;
      
      const countEl = document.getElementById('ab-start-weekly-count');
      const totalEl = document.getElementById('ab-start-weekly-total');
      const pctEl = document.getElementById('ab-start-weekly-pct');
      const accuracyEl = document.getElementById('ab-start-weekly-accuracy-text');
      const leaderboardEl = document.getElementById('ab-start-leaderboard-snippet');
      const progressBarEl = document.getElementById('ab-start-weekly-progress-bar');
      
      if (countEl) countEl.textContent = String(completedCount);
      if (totalEl) totalEl.textContent = `/ ${totalCount}`;
      
      const percent = Math.round((completedCount / totalCount) * 100);
      if (pctEl) pctEl.textContent = `${percent}% Complete`;
      
      let overallCorrect = 0;
      let overallTotal = 0;
      weeklyPlaylistABs.forEach((ab) => {
        if (ab.completed) {
          overallCorrect += ab.userCorrectCount || 0;
          overallTotal += ab.userTotalCount || 0;
        }
      });
      const overallAccuracy = overallTotal > 0 ? Math.round((overallCorrect / overallTotal) * 100) : 100;
      if (accuracyEl) accuracyEl.textContent = `${overallAccuracy}%`;
      
      if (progressBarEl) {
        progressBarEl.style.width = `${percent}%`;
      }
      
      const username = localStorage.getItem('ump_username') || 'Player';
      updateAbStartLeaderboardSnippet(username);
    }
    if (startSubtitle) {
      startSubtitle.classList.add('hidden');
    }
  } else {
    if (startWeeklyDetails) {
      startWeeklyDetails.classList.add('hidden');
    }
    if (startSubtitle) {
      startSubtitle.classList.remove('hidden');
      if (gameMode === 'daily_compete') {
        const total = weeklyPlaylistABs.length || 200;
        startSubtitle.textContent = `At-bat ${activeWeeklyAbIndex + 1} of ${total}`;
      } else {
        startSubtitle.textContent = 'Make the call';
      }
    }
  }

  if (startTitle) {
    startTitle.textContent = gameMode === 'weekly_challenge' 
      ? (isResume ? 'Resume Weekly Challenge' : 'Next weekly at-bat')
      : (isResume ? 'At-bat in progress' : 'Upcoming at-bat');
  }

  // Show overlay with transition
  abStartOverlay.classList.remove('opacity-0', 'pointer-events-none');
  abStartOverlay.classList.add('opacity-100', 'pointer-events-auto');
  const startPanel = abStartOverlay.querySelector('.ab-start-cabinet');
  if (startPanel) {
    startPanel.classList.remove('scale-95');
    startPanel.classList.add('scale-100');
  }
  // Hide gameplay telemetry while overlay is up (updateUnifiedTopNav handles this check)
  updateUnifiedTopNav(currentState);

  if (abStartTimerText) {
    abStartTimerText.textContent = "Ready when you are.";
  }

  // Re-trigger marquee calculation once transition is complete and container width is active
  setTimeout(() => {
    if (pitch) {
      const matchup = getMatchupNames(pitch);
      setMarqueePlayerName(abStartPitcher, '.ab-start-pitcher-dup', matchup.pitcher);
      setMarqueePlayerName(abStartBatter, '.ab-start-batter-dup', matchup.batter);
    }
  }, 350);

  // Store callback for confirm
  window._abStartCallback = onConfirmCallback;
}

function animateMatchupToTopNav(callback) {
  if (matchupCard) {
    setOverlayVisible(matchupCard, true);
    matchupCard.style.opacity = '1';
  }
  if (callback) callback();
}

function confirmAtBatStart() {
  if (abStartCountdownInterval) {
    clearInterval(abStartCountdownInterval);
    abStartCountdownInterval = null;
  }
  if (abStartTimeout) {
    clearTimeout(abStartTimeout);
    abStartTimeout = null;
  }

  animateMatchupToTopNav(() => {
    if (abStartOverlay) {
      abStartOverlay.classList.add('opacity-0', 'pointer-events-none');
      abStartOverlay.classList.remove('opacity-100', 'pointer-events-auto');
      const startPanel = abStartOverlay.querySelector('.ab-start-cabinet');
      if (startPanel) {
        startPanel.classList.add('scale-95');
        startPanel.classList.remove('scale-100');
      }
    }
    updateUnifiedTopNav(currentState);

    if (window._abStartCallback) {
      window._abStartCallback();
      window._abStartCallback = null;
    } else {
      if (currentState === STATES.IDLE && !isGamePaused) {
        autoPlayTimeout = setTimeout(() => {
          triggerPitchRelease();
        }, 600);
      }
    }
  });
}

function returnToMainMenu() {
  // Clean up all timers and state
  if (autoPlayTimeout) {
    clearTimeout(autoPlayTimeout);
    autoPlayTimeout = null;
  }
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  if (overviewTimerInterval) {
    clearInterval(overviewTimerInterval);
    overviewTimerInterval = null;
  }
  if (summaryTimeout) {
    clearTimeout(summaryTimeout);
    summaryTimeout = null;
  }
  if (quickContinueInterval) {
    clearInterval(quickContinueInterval);
    quickContinueInterval = null;
  }
  if (abStartTimeout) {
    clearTimeout(abStartTimeout);
    abStartTimeout = null;
  }
  if (abStartCountdownInterval) {
    clearInterval(abStartCountdownInterval);
    abStartCountdownInterval = null;
  }

  isGamePaused = false;
  isTransitioningToSummary = false;
  isSessionOver = false;

  // Hide all overlays
  if (pauseScreen) {
    pauseScreen.classList.add('opacity-0', 'pointer-events-none');
    pauseScreen.classList.remove('opacity-100', 'pointer-events-auto');
  }
  if (abStartOverlay) {
    abStartOverlay.classList.add('opacity-0', 'pointer-events-none');
    abStartOverlay.classList.remove('opacity-100', 'pointer-events-auto');
    const startPanel = abStartOverlay.querySelector('.ab-start-cabinet');
    if (startPanel) {
      startPanel.classList.add('scale-95');
      startPanel.classList.remove('scale-100');
    }
  }

  hideQuickPreviewPanel();
  showReviewPanel(false);
  clearSummaryPitchReview();
  setCameraAngle('umpire');

  // Re-show the start/dashboard screen
  if (startScreen) {
    startScreen.classList.remove('opacity-0', 'pointer-events-none');
  }
  if (hudHeader) {
    hudHeader.classList.add('opacity-0');
  }
  if (scoreboardScreen) {
    scoreboardScreen.classList.add('opacity-0', 'pointer-events-none');
    scoreboardScreen.classList.remove('opacity-100');
  }

  // Reset pitch list so next game starts fresh  
  pitchesList = [];

  saveChallengeSessionToLocal();
  updateChallengeProgressUI();
  transitionToState(STATES.START);
}

/**
 * Dynamically updates counters on the active header HUD
 */
function updateLiveScoreboard() {
  const ballsCount = abBalls;
  const strikesCount = abStrikes;
  const outsCount = inningOuts;
  
  const ballsDots = ballsIndicator.children;
  for (let i = 0; i < ballsDots.length; i++) {
    if (i < ballsCount) {
      ballsDots[i].className = 'count-bulb count-bulb--ball active';
    } else {
      ballsDots[i].className = 'count-bulb count-bulb--ball';
    }
  }
  
  const strikesDots = strikesIndicator.children;
  for (let i = 0; i < strikesDots.length; i++) {
    if (i < strikesCount) {
      strikesDots[i].className = 'count-bulb count-bulb--strike active';
    } else {
      strikesDots[i].className = 'count-bulb count-bulb--strike';
    }
  }

  const outsDots = outsIndicator.children;
  for (let i = 0; i < outsDots.length; i++) {
    if (i < outsCount) {
      outsDots[i].className = 'count-bulb count-bulb--out active';
    } else {
      outsDots[i].className = 'count-bulb count-bulb--out';
    }
  }

  // Update TV Score Bug details
  const pitch = currentPitch || (pitchesList && pitchesList[currentPitchIndex]);
  if (pitch) {
    const inningNum = pitch.inning !== undefined ? pitch.inning : 1;
    const isTop = pitch.is_top !== undefined ? pitch.is_top : true;
    const halfSymbol = isTop ? '▲' : '▼';
    let suffix = "TH";
    if (inningNum === 1) suffix = "ST";
    else if (inningNum === 2) suffix = "ND";
    else if (inningNum === 3) suffix = "RD";
    
    if (scorebugInning) {
      scorebugInning.textContent = `${halfSymbol} ${inningNum}${suffix}`;
    }
    
    const scoreAway = pitch.score_away !== undefined ? pitch.score_away : 0;
    const scoreHome = pitch.score_home !== undefined ? pitch.score_home : 0;
    if (scorebugScore) {
      let awayCode = "AWY";
      let homeCode = "HOM";
      if (gameMode === 'orioles_full') {
        awayCode = "OPP";
        homeCode = "BAL";
      }
      scorebugScore.textContent = `${awayCode} ${scoreAway} - ${homeCode} ${scoreHome}`;
    }
    
    const runners = pitch.runners || [0, 0, 0];
    const scorebugBases = [scorebugBase1, scorebugBase2, scorebugBase3];
    scorebugBases.forEach((el, idx) => {
      if (el) {
        if (runners[idx]) {
          el.classList.add('active');
        } else {
          el.classList.remove('active');
        }
      }
    });
  }

  if (gameMode === 'standard') {
    pitchCounterText.textContent = `PITCH ${currentPitchIndex + 1} OF 10`;
  } else if (gameMode === 'weekly_challenge' || gameMode === 'daily_compete') {
    const total = weeklyPlaylistABs.length || 16;
    const prefix = gameMode === 'weekly_challenge' ? 'WEEKLY CHALLENGE' : 'DAILY COMPETE';
    pitchCounterText.textContent = `${prefix} | AB ${activeWeeklyAbIndex + 1} OF ${total}`;
  } else if (gameMode === 'daily_streak') {
    pitchCounterText.textContent = `STREAK: ${pitchHistory.length} | PITCH ${currentPitchIndex + 1}`;
  } else {
    pitchCounterText.textContent = `PITCH ${totalPitchesCount + 1} | OUTS ${inningOuts}`;
  }

  if (abPitchCounter) {
    abPitchCounter.textContent = currentPitchIndex + 1;
  }

  const currentAbCalledPitches = pitchHistory.slice(currentAbStartHistoryIndex).filter(x => !x.isSwingPlay);
  if (currentAbCalledPitches.length > 0) {
    const userCorrectCount = currentAbCalledPitches.filter(x => x.userCorrect).length;
    const userAcc = Math.round((userCorrectCount / currentAbCalledPitches.length) * 100);
    if (userAbAccuracyText) userAbAccuracyText.textContent = `${userAcc}%`;

    const umpCorrectCount = currentAbCalledPitches.filter(x => x.realCorrect).length;
    const umpAcc = Math.round((umpCorrectCount / currentAbCalledPitches.length) * 100);
    if (umpAbAccuracyText) umpAbAccuracyText.textContent = `${umpAcc}%`;
  } else {
    if (userAbAccuracyText) userAbAccuracyText.textContent = '100%';
    if (umpAbAccuracyText) umpAbAccuracyText.textContent = '100%';
  }

  const sessionCalledPitches = pitchHistory.filter(x => !x.isSwingPlay);
  if (sessionCalledPitches.length > 0) {
    const totalCorrectCount = sessionCalledPitches.filter(x => x.userCorrect).length;
    const sessionAcc = Math.round((totalCorrectCount / sessionCalledPitches.length) * 100);
    if (userWeeklyAccuracyText) userWeeklyAccuracyText.textContent = `${sessionAcc}%`;
  } else {
    if (userWeeklyAccuracyText) userWeeklyAccuracyText.textContent = '100%';
  }
}

/**
 * Helper to fetch MLB team name, logo, color and text styling for a pitch challenge
 */
function getChallengeTeamInfo(pitchId) {
  if (gameMode !== 'standard') {
    return { name: 'ORIOLES vs TIGERS', logo: 'BAL', color: '#df4601', text: '#ffffff' };
  }
  const teams = {
    1: { name: 'YANKEES CHALLENGE', logo: 'NY', color: '#0c2340', text: '#ffffff' },
    2: { name: 'DODGERS CHALLENGE', logo: 'LA', color: '#005a9c', text: '#ffffff' },
    3: { name: 'YANKEES CHALLENGE', logo: 'NY', color: '#0c2340', text: '#ffffff' },
    4: { name: 'DODGERS CHALLENGE', logo: 'LA', color: '#005a9c', text: '#ffffff' },
    5: { name: 'MARINERS CHALLENGE', logo: 'S', color: '#0c2c56', text: '#ffffff' },
    6: { name: 'ORIOLES CHALLENGE', logo: 'O', color: '#df4601', text: '#ffffff' },
    7: { name: 'ATHLETICS CHALLENGE', logo: 'A', color: '#003831', text: '#ffffff' },
    8: { name: 'TIGERS CHALLENGE', logo: 'D', color: '#0c2340', text: '#ffffff' },
    9: { name: 'ASTROS CHALLENGE', logo: 'H', color: '#eb6e1f', text: '#ffffff' },
    10: { name: 'BLUE JAYS CHALLENGE', logo: 'TOR', color: '#134a8e', text: '#ffffff' }
  };
  return teams[pitchId] || { name: 'ABS CHALLENGE', logo: 'ABS', color: '#4c1d95', text: '#ffffff' };
}

/**
 * Fills out the official broadcast-style ABS review overlay elements
 */
function populateBroadcastReviewData(historyItem) {
  const p = historyItem.pitchData;
  const cross = historyItem.trajectory.crossPoint;
  
  // 1. Team Challenge Pill
  const teamInfo = getChallengeTeamInfo(p.id);
  absTeamLogo.textContent = teamInfo.logo;
  absTeamLogo.style.backgroundColor = teamInfo.color;
  absTeamLogo.style.color = teamInfo.text;
  absTeamNameText.textContent = teamInfo.name;

  // 2. ABS Card Ruling Pill
  const isStrikeABSVal = historyItem.absCall === 'S';
  if (isStrikeABSVal) {
    absRulingText.textContent = 'STRIKE';
    absRulingDot.className = 'w-2 h-2 rounded-full bg-red-600 mr-2 shadow-sm animate-pulse';
  } else {
    absRulingText.textContent = 'BALL';
    absRulingDot.className = 'w-2 h-2 rounded-full bg-blue-600 mr-2 shadow-sm animate-pulse';
  }

  // 3. Call Result Pill (Confirmed vs Overturned vs Swing Play result)
  if (historyItem.isSwingPlay) {
    absResultTitle.textContent = 'PLAY RESULT';
    absResultTitle.className = 'text-xs font-bold text-gray-400 uppercase tracking-wider font-mono-tech';
    
    let colorClass = 'text-gray-400 bg-gray-950/50 border border-gray-500/30';
    if (historyItem.swingOutcome === 'HIT') colorClass = 'text-green-400 bg-green-950/50 border border-green-500/30 shadow-sm';
    if (historyItem.swingOutcome === 'OUT') colorClass = 'text-gray-400 bg-gray-950/50 border border-gray-500/30';
    if (historyItem.swingOutcome === 'FOUL') colorClass = 'text-amber-400 bg-amber-950/50 border border-amber-500/30 shadow-sm';
    if (historyItem.swingOutcome === 'WHIFF') colorClass = 'text-red-400 bg-red-950/50 border border-red-500/30 shadow-sm';
    
    absResultValue.textContent = historyItem.swingOutcome === 'HIT' ? historyItem.swingHitType : historyItem.swingOutcome;
    absResultValue.className = `text-sm font-black px-2.5 py-1 rounded-md uppercase ${colorClass}`;
  } else {
    const isCorrect = historyItem.userCorrect;
    if (isCorrect) {
      absResultTitle.textContent = 'CALL CONFIRMED';
      absResultTitle.className = 'text-xs font-bold text-gray-400 uppercase tracking-wider font-mono-tech';
      absResultValue.textContent = historyItem.absCall === 'S' ? 'STRIKE' : 'BALL';
      absResultValue.className = 'text-sm font-black px-2.5 py-1 rounded-md uppercase text-green-400 bg-green-950/50 border border-green-500/30 shadow-sm';
    } else {
      absResultTitle.textContent = 'CALL OVERTURNED';
      absResultTitle.className = 'text-xs font-bold text-red-400 uppercase tracking-wider font-mono-tech';
      absResultValue.textContent = historyItem.absCall === 'S' ? 'STRIKE' : 'BALL';
      absResultValue.className = 'text-sm font-black px-2.5 py-1 rounded-md uppercase text-red-400 bg-red-950/50 border border-red-500/30 shadow-sm animate-pulse';
    }
  }

  // 4. Telemetry Ticker Stats
  absStatType.textContent = p.pitch_type.toUpperCase();
  absStatSpeed.textContent = `${p.speed_mph} MPH`;
  
  const hBreakInches = Math.round(p.ax * 1.5);
  const vBreakInches = Math.round((p.az + 32.2) * 1.5);
  absStatBreak.textContent = `H: ${hBreakInches > 0 ? '+' : ''}${hBreakInches}in | V: ${vBreakInches > 0 ? '+' : ''}${vBreakInches}in`;
  
  // Calculate distance in inches to show in "Zone Dist" column
  const distFt = getDistanceToABSZone(cross.x, cross.y);
  const distInches = Math.abs(distFt) * 12.0;
  absStatHeight.textContent = distFt < 0 
    ? `${distInches.toFixed(1)} in (Strike)` 
    : `${distInches.toFixed(1)} in (Ball)`;
    
  absStatBlurb.textContent = p.historical_blurb;
}

/**
 * Renders large screen alerts with custom feedback messages
 */
function showDecisionToast(isCorrect, absCall) {
  if (gameStatusBadge) {
    gameStatusBadge.classList.add('opacity-0');
    gameStatusBadge.classList.remove('opacity-100');
  }

  const historyItem = pitchHistory[pitchHistory.length - 1];
  
  if (historyItem.isSwingPlay) {
    let text = '';
    if (historyItem.swingOutcome === 'WHIFF') {
      text = '<span class="text-red-400 font-black shadow-neon-strike-glow">SWING & MISS</span>';
    } else if (historyItem.swingOutcome === 'FOUL') {
      text = '<span class="text-amber-400 font-black shadow-neon-abs-glow">FOUL BALL</span>';
    } else if (historyItem.swingOutcome === 'HIT') {
      text = `<span class="text-green-400 font-black shadow-neon-green-glow">${historyItem.swingHitType}!</span>`;
    } else if (historyItem.swingOutcome === 'OUT') {
      text = `<span class="text-gray-400 font-black">${historyItem.swingHitType}</span>`;
    }
    toastMessage.innerHTML = `${text} &nbsp;|&nbsp; ABS: ${absCall === 'S' ? 'STRIKE' : 'BALL'}`;
    toastMessage.className = 'absolute top-4 left-1/2 -translate-x-1/2 transform px-6 py-2 rounded-full font-black uppercase tracking-wider text-xs md:text-sm shadow-xl opacity-100 scale-100 transition-all duration-300 bg-slate-900/95 text-white border border-amber-500/40 shadow-amber-500/10 pointer-events-auto z-50 whitespace-nowrap';
  } else {
    if (isCorrect) {
      toastMessage.innerHTML = `<span class="text-green-400 font-black shadow-neon-green-glow">CORRECT CALL</span> &nbsp;|&nbsp; ABS: ${absCall === 'S' ? 'STRIKE' : 'BALL'}`;
      toastMessage.className = 'absolute top-4 left-1/2 -translate-x-1/2 transform px-6 py-2 rounded-full font-black uppercase tracking-wider text-xs md:text-sm shadow-xl opacity-100 scale-100 transition-all duration-300 bg-green-950/95 text-white border border-green-500/40 shadow-green-500/10 pointer-events-auto z-50 whitespace-nowrap';
    } else {
      toastMessage.innerHTML = `<span class="text-red-400 font-black shadow-neon-strike-glow">MISSED CALL</span> &nbsp;|&nbsp; ABS: ${absCall === 'S' ? 'STRIKE' : 'BALL'}`;
      toastMessage.className = 'absolute top-4 left-1/2 -translate-x-1/2 transform px-6 py-2 rounded-full font-black uppercase tracking-wider text-xs md:text-sm shadow-xl opacity-100 scale-100 transition-all duration-300 bg-red-950/95 text-white border border-red-500/40 shadow-red-500/10 pointer-events-auto z-50 whitespace-nowrap';
    }
  }

  setTimeout(() => {
    toastMessage.classList.add('opacity-0', 'scale-95');
    toastMessage.classList.remove('opacity-100', 'scale-100');
    if (gameStatusBadge && currentState !== STATES.START && currentState !== STATES.SCOREBOARD && currentState !== STATES.WELCOME && currentState !== STATES.TEAM_SELECT) {
      gameStatusBadge.classList.remove('opacity-0');
      gameStatusBadge.classList.add('opacity-100');
    }
  }, 1800);
}

/**
 * Populates final dashboard metrics table
 */
function renderScoreboardDashboard() {
  const totalPitches = pitchHistory.length;
  
  // Calculate accuracy only on called pitches (takes)
  const calledPitches = pitchHistory.filter(x => !x.isSwingPlay);
  const userCorrectCount = calledPitches.filter(x => x.userCorrect).length;
  const userAcc = calledPitches.length > 0 ? Math.round((userCorrectCount / calledPitches.length) * 100) : 100;
  
  const umpCorrectCount = calledPitches.filter(x => x.realCorrect).length;
  const umpAcc = calledPitches.length > 0 ? Math.round((umpCorrectCount / calledPitches.length) * 100) : 100;

  let displayPitchesCount = calledPitches.length;
  let displayCorrectCount = userCorrectCount;
  let displayAcc = userAcc;

  if (gameMode === 'weekly_challenge' || gameMode === 'daily_compete') {
    let overallCorrect = 0;
    let overallTotal = 0;
    weeklyPlaylistABs.forEach(ab => {
      if (ab.completed) {
        overallCorrect += ab.userCorrectCount || 0;
        overallTotal += ab.userTotalCount || 0;
      }
    });
    displayPitchesCount = overallTotal;
    displayCorrectCount = overallCorrect;
    displayAcc = overallTotal > 0 ? Math.round((overallCorrect / overallTotal) * 100) : 100;
  }
  
  finalUserAccuracy.textContent = `${displayAcc}%`;
  finalUserStats.textContent = `${displayCorrectCount} OF ${displayPitchesCount} CORRECT`;
  
  finalUmpAccuracy.textContent = `${umpAcc}%`;
  finalUmpStats.textContent = `${umpCorrectCount} OF ${calledPitches.length} CORRECT`;

  // Save game result to persistent user profile stats database in localStorage
  const username = localStorage.getItem('ump_username');
  if (username) {
    const statsKey = getStatsStorageKey(username);
    let userStats = JSON.parse(localStorage.getItem(statsKey) || '{"overallAccuracy":null,"maxStreak":0,"completedWeekly":0,"dnfs":0,"history":[]}');
    
    if (gameMode === 'weekly_challenge') {
      userStats.completedWeekly = (userStats.completedWeekly || 0) + 1;
    } else if (gameMode === 'daily_compete') {
      if (!userStats.dailyHistory) userStats.dailyHistory = {};
      userStats.dailyHistory[activeDailyDate] = displayAcc;
      const key = `pitch_ump_daily_compete_mvp_${username.toUpperCase()}_${activeDailyDate}`;
      localStorage.removeItem(key);
    }
    userStats.dnfs = dnfDisconnectsCount;
    
    // Calculate new overall accuracy combining all history sessions
    let totalCallsSum = (gameMode === 'weekly_challenge' || gameMode === 'daily_compete') ? displayPitchesCount : calledPitches.length;
    let totalCorrectSum = (gameMode === 'weekly_challenge' || gameMode === 'daily_compete') ? displayCorrectCount : userCorrectCount;
    if (userStats.history) {
      userStats.history.forEach(h => {
        totalCallsSum += h.totalCalls;
        totalCorrectSum += h.correctCalls;
      });
    }
    userStats.overallAccuracy = totalCallsSum > 0 ? Math.round((totalCorrectSum / totalCallsSum) * 100) : 100;
    
    // Calculate max streak in this game and update overall max streak
    let currentStreak = 0;
    let maxGameStreak = 0;
    calledPitches.forEach(p => {
      if (p.userCorrect) {
        currentStreak++;
        if (currentStreak > maxGameStreak) maxGameStreak = currentStreak;
      } else {
        currentStreak = 0;
      }
    });
    if (maxGameStreak > (userStats.maxStreak || 0)) {
      userStats.maxStreak = maxGameStreak;
    }
    
    let gameName = "Practice Mode";
    let matchup = "N/A";
    if (gameMode === 'weekly_challenge') {
      const gameData = WEEKLY_CHALLENGE_DATA[activeGameIndex];
      gameName = gameData ? gameData.title : "Weekly Challenge";
    } else if (gameMode === 'daily_compete') {
      gameName = `Daily Compete (${activeDailyDate})`;
    } else if (gameMode === 'orioles_full') {
      gameName = "Orioles simulation";
    } else if (gameMode === 'daily_streak') {
      gameName = "Daily Streak";
    }
    
    if (calledPitches.length > 0 && calledPitches[0].pitchData) {
      const pData = calledPitches[0].pitchData;
      const matchupNames = getMatchupNames(pData);
      matchup = `${matchupNames.pitcher} vs ${matchupNames.batter}`;
    }
    
    if (!userStats.history) userStats.history = [];
    userStats.history.push({
      gameName,
      matchup,
      correctCalls: (gameMode === 'weekly_challenge' || gameMode === 'daily_compete') ? displayCorrectCount : userCorrectCount,
      totalCalls: (gameMode === 'weekly_challenge' || gameMode === 'daily_compete') ? displayPitchesCount : calledPitches.length,
      accuracy: (gameMode === 'weekly_challenge' || gameMode === 'daily_compete') ? displayAcc : userAcc,
      date: new Date().toLocaleDateString()
    });
    
    if (gameMode === 'daily_compete' && activeDailyTeam) {
      if (!userStats.dailyHistory) userStats.dailyHistory = {};
      userStats.dailyHistory[`${activeDailyTeam}_${activeDailyDate}`] = (gameMode === 'weekly_challenge' || gameMode === 'daily_compete') ? displayAcc : userAcc;
      
      if (!userStats.teamStats) userStats.teamStats = {};
      if (!userStats.teamStats[activeDailyTeam]) {
        userStats.teamStats[activeDailyTeam] = {
          completedCount: 0,
          correctCalls: 0,
          totalCalls: 0,
          accuracySum: 0
        };
      }
      const tStats = userStats.teamStats[activeDailyTeam];
      tStats.completedCount++;
      tStats.correctCalls += (gameMode === 'weekly_challenge' || gameMode === 'daily_compete') ? displayCorrectCount : userCorrectCount;
      tStats.totalCalls += (gameMode === 'weekly_challenge' || gameMode === 'daily_compete') ? displayPitchesCount : calledPitches.length;
      tStats.accuracySum += parseFloat((gameMode === 'weekly_challenge' || gameMode === 'daily_compete') ? displayAcc : userAcc);
    }

    localStorage.setItem(statsKey, JSON.stringify(userStats));
    saveGlobalUserStats(username, userStats);
    updateProfileStatsUI();

    // Submit global scores to KVDB
    if (gameMode === 'weekly_challenge') {
      const weeklyPoints = displayCorrectCount * 10;
      submitGlobalScore('weekly', username, activeFavoriteTeam || 'None', `${displayAcc}%`, `${weeklyPoints} pts`, weeklyPoints);
    } else if (gameMode === 'daily_streak') {
      submitGlobalScore('daily', username, activeFavoriteTeam || 'None', `${userAcc}%`, `${userCorrectCount} Streak`, userCorrectCount);
    }
    
    // Compile mastery stats and completed teams lists
    const completedTeamsList = Object.keys(userStats.teamStats || {});
    const teamString = completedTeamsList.length > 0 ? completedTeamsList.join(',') : 'None';
    
    let avgAcc = 0;
    if (completedTeamsList.length > 0) {
      let sumAcc = 0;
      completedTeamsList.forEach(t => {
        const ts = userStats.teamStats[t];
        sumAcc += ts.totalCalls > 0 ? (ts.correctCalls / ts.totalCalls) * 100 : 0;
      });
      avgAcc = Math.round(sumAcc / completedTeamsList.length);
    } else {
      avgAcc = userStats.overallAccuracy || 90;
    }
    
    const masteryScore = completedTeamsList.length * 1000 + avgAcc;
    submitGlobalScore('alltime', username, teamString, `${avgAcc}%`, `${completedTeamsList.length} Teams (${masteryScore} pts)`, masteryScore);
  }

  let rating = 'ROOKIE BALL';
  let desc = 'You struggled to see the zone. Hit the training facilities and try again!';
  
  if (gameMode === 'standard') {
    if (userAcc === 100) {
      rating = 'COOPERSTOWN HALL OF FAMER';
      desc = 'Flawless performance! You read the zone better than high-definition cameras. Absolute legend!';
    } else if (userAcc >= 90) {
      rating = 'MLB CREW CHIEF';
      desc = 'Masterful performance! You called pitches with elite precision, easily outperforming standard MLB umpires.';
    } else if (userAcc >= 80) {
      rating = 'MAJOR LEAGUE UMPIRE';
      desc = 'Excellent zone awareness. You called a solid game on par with major league standards.';
    } else if (userAcc >= 70) {
      rating = 'TRIPLE-A PROSPECT';
      desc = 'Decent eye, but some borderline pitches fooled you. Keep sharpening your focus.';
    } else if (userAcc >= 50) {
      rating = 'CLASS A MINORS';
      desc = 'You got the basics down, but struggles on breaking balls and cutters are holding you back.';
    }
  } else {
    // Scorecard challenge evaluation
    let matchupTitle = "Scorecard Matchup";
    if (gameMode === 'weekly_challenge') {
      const gameData = WEEKLY_CHALLENGE_DATA[activeGameIndex];
      matchupTitle = gameData ? gameData.title : "Weekly Challenge";
    } else if (gameMode === 'orioles_full') {
      matchupTitle = "Orioles Full Game";
    } else if (gameMode === 'daily_streak') {
      matchupTitle = "Daily Streak Challenge";
    } else {
      matchupTitle = "Standard Challenge";
    }
    
    rating = 'SCORECARD MATCHUP';
    desc = `
      <div class="flex flex-col items-center gap-2 mt-1">
        <span class="text-xs text-slate-300 font-sans">Matchup: <b>${matchupTitle}</b></span>
        <div class="grid grid-cols-5 gap-3 bg-white/5 border border-white/10 rounded-lg p-3 my-2 w-full text-center">
          <div>
            <span class="text-[9px] uppercase text-gray-400 font-mono-tech block">Pitches</span>
            <span class="text-sm font-bold text-white">${totalPitchesCount}</span>
          </div>
          <div>
            <span class="text-[9px] uppercase text-gray-400 font-mono-tech block">Batters</span>
            <span class="text-sm font-bold text-white">${totalBattersFaced + 1}</span>
          </div>
          <div>
            <span class="text-[9px] uppercase text-gray-400 font-mono-tech block">Hits</span>
            <span class="text-sm font-bold text-green-400">${totalSessionH}</span>
          </div>
          <div>
            <span class="text-[9px] uppercase text-gray-400 font-mono-tech block">Walks</span>
            <span class="text-sm font-bold text-blue-400">${totalSessionBB}</span>
          </div>
          <div>
            <span class="text-[9px] uppercase text-gray-400 font-mono-tech block">K's</span>
            <span class="text-sm font-bold text-red-400">${totalSessionK}</span>
          </div>
        </div>
        <span class="text-[11px] font-sans text-gray-300 text-center leading-relaxed max-w-lg">
          ${userAcc > umpAcc 
            ? `🔥 Outstanding! You called <b>${userCorrectCount}</b> of <b>${calledPitches.length}</b> critical takes correctly (<b>${userAcc}%</b>), out-umpiring the real MLB crew chief who posted <b>${umpCorrectCount}/${calledPitches.length}</b> (<b>${umpAcc}%</b>).` 
            : `The MLB crew chief called <b>${umpCorrectCount}/${calledPitches.length}</b> (<b>${umpAcc}%</b>) correctly on these critical takes, out-performing your <b>${userCorrectCount}/${calledPitches.length}</b> (<b>${userAcc}%</b>). Keep training!`}
        </span>
      </div>
    `;
  }
  
  finalEvalRating.textContent = rating;
  finalEvalDesc.innerHTML = desc;

  scoreboardTableBody.innerHTML = '';
  
  pitchHistory.forEach(item => {
    const row = document.createElement('tr');
    row.className = 'border-b border-white/5 hover:bg-white/2 bg-slate-900/50';
    
    const matchupInfo = (item.pitchData.pitcher && item.pitchData.batter)
      ? `<span class="text-[10px] font-semibold block"><span class="text-orange-300">${item.pitchData.pitcher}</span> vs <span class="text-purple-300">${item.pitchData.batter}</span></span>`
      : (item.pitchData.batter ? `<span class="text-[10px] text-purple-300 font-semibold block">${item.pitchData.batter}</span>` : '');
      
    const detailsCell = `
      <div class="flex flex-col">
        <span class="font-semibold text-white">${item.pitchType}</span>
        <span class="text-[10px] text-gray-400 font-mono-tech">${item.speedMph} MPH (${item.pitchData.pitcher_hand || 'RHP'})</span>
        ${matchupInfo}
      </div>
    `;

    const userBadge = makeBadgeHtml(item.userCall, item.isSwingPlay);
    const absBadge = makeBadgeHtml(item.absCall);
    const realBadge = makeBadgeHtml(item.realCall);
    
    const resultIcon = item.isSwingPlay
      ? '<span class="text-gray-500 font-mono-tech">-</span>'
      : (item.userCorrect 
          ? '<span class="text-green-500 text-lg">✓</span>' 
          : '<span class="text-red-500 text-lg">✗</span>');
      
    row.innerHTML = `
      <td class="p-3 font-mono-tech font-bold text-gray-400">#${item.pitchNum}</td>
      <td class="p-3">${detailsCell}</td>
      <td class="p-3 text-center">${userBadge}</td>
      <td class="p-3 text-center">${absBadge}</td>
      <td class="p-3 text-center">${realBadge}</td>
      <td class="p-3 text-center">${resultIcon}</td>
    `;
    
    scoreboardTableBody.appendChild(row);
  });
  
  // Calculate and draw scorecard RE24 favor and SVG matrix plot
  const re24 = calculateScorecardRE24();
  if (finalScorecardRe24) {
    if (re24.favoredTeam === "Neither") {
      finalScorecardRe24.textContent = "Favor: Neutral (0.00 Runs)";
    } else {
      finalScorecardRe24.textContent = `Favor: +${re24.netFavor.toFixed(2)} Runs to ${re24.favoredTeam}`;
    }
  }
  drawScorecardSVGMatrix();
}

function makeBadgeHtml(call, isSwingPlay = false) {
  if (isSwingPlay) {
    if (call === 'WHIFF') {
      return '<span class="px-2 py-0.5 text-[10px] font-bold text-red-400 bg-red-950/20 border border-red-500/20 rounded uppercase font-mono-tech">SWING & MISS</span>';
    } else if (call === 'FOUL') {
      return '<span class="px-2 py-0.5 text-[10px] font-bold text-amber-500 bg-amber-950/20 border border-amber-500/20 rounded uppercase font-mono-tech">SWING (FOUL)</span>';
    } else if (call === 'HIT') {
      return '<span class="px-2 py-0.5 text-[10px] font-bold text-green-400 bg-green-950/20 border border-green-500/20 rounded uppercase font-mono-tech">SWING (HIT)</span>';
    } else if (call === 'OUT') {
      return '<span class="px-2 py-0.5 text-[10px] font-bold text-gray-400 bg-gray-950/20 border border-gray-500/20 rounded uppercase font-mono-tech">SWING (OUT)</span>';
    }
  }
  if (call === 'S') {
    return '<span class="px-2 py-0.5 text-[10px] font-bold text-red-400 bg-red-950/50 border border-red-500/25 rounded uppercase">Strike</span>';
  } else if (call === 'B') {
    return '<span class="px-2 py-0.5 text-[10px] font-bold text-blue-400 bg-blue-950/50 border border-blue-500/25 rounded uppercase">Ball</span>';
  } else if (call === 'TIMEOUT') {
    return '<span class="px-2 py-0.5 text-[10px] font-bold text-yellow-500 bg-yellow-950/50 border border-yellow-500/25 rounded uppercase font-mono-tech">Time</span>';
  } else if (call === 'WHIFF') {
    return '<span class="px-2 py-0.5 text-[10px] font-bold text-red-400 bg-red-950/50 border border-red-500/25 rounded uppercase font-mono-tech">Swing</span>';
  } else if (call === 'FOUL') {
    return '<span class="px-2 py-0.5 text-[10px] font-bold text-amber-500 bg-amber-950/50 border border-amber-500/25 rounded uppercase font-mono-tech">Foul</span>';
  } else if (call === 'HIT') {
    return '<span class="px-2 py-0.5 text-[10px] font-bold text-green-400 bg-green-950/50 border border-green-500/25 rounded uppercase font-mono-tech">Hit</span>';
  } else if (call === 'OUT') {
    return '<span class="px-2 py-0.5 text-[10px] font-bold text-gray-400 bg-gray-950/50 border border-gray-500/25 rounded uppercase font-mono-tech">Out</span>';
  }
  return `<span class="px-2 py-0.5 text-[10px] font-bold text-gray-400 border border-gray-600 rounded uppercase font-mono-tech">${call}</span>`;
}

function resetGameSession() {
  isGamePaused = false;
  if (pauseScreen) {
    pauseScreen.classList.add('opacity-0', 'pointer-events-none');
    pauseScreen.classList.remove('opacity-100', 'pointer-events-auto');
  }
  pitchesList = [];
  currentPitchIndex = 0;
  pitchHistory = [];
  currentAbStartHistoryIndex = 0;
  
  // Reset counts
  abBalls = 0;
  abStrikes = 0;
  inningOuts = 0;
  
  // Reset stats
  totalPitchesCount = 0;
  totalBattersFaced = 0;
  totalSessionK = 0;
  totalSessionBB = 0;
  totalSessionH = 0;
  totalSessionOuts = 0;
  
  activeInning = 1;
  activeIsTop = true;
  
  isSessionOver = false;
  activeAbEnded = false; // Reset AB ended status
  isTransitioningToSummary = false;
  if (summaryTimeout) {
    clearTimeout(summaryTimeout);
    summaryTimeout = null;
  }
  scoreboardScreen.classList.remove('opacity-100');
  scoreboardScreen.classList.add('opacity-0', 'pointer-events-none');
  
  showReviewPanel(false);
  
  transitionToState(STATES.IDLE);
  showAtBatStartScreen(() => {
    if (currentState === STATES.IDLE && !isGamePaused) {
      autoPlayTimeout = setTimeout(() => {
        triggerPitchRelease();
      }, 600);
    }
  });
}

function loadHalfInning(inn, isTop) {
  activeInning = inn;
  activeIsTop = isTop;
  
  pitchesList = ORIOLES_GAME_DATA.filter(p => p.inning === activeInning && p.is_top === activeIsTop);
  
  abBalls = 0;
  abStrikes = 0;
  inningOuts = 0;
  
  if (selectInning) {
    selectInning.value = `${inn}_${isTop}`;
  }
}

function loadNextHalfInning() {
  pitchesList = ORIOLES_GAME_DATA.filter(p => p.inning === activeInning && p.is_top === activeIsTop);
  currentPitchIndex = 0;
  
  abBalls = 0;
  abStrikes = 0;
  inningOuts = 0;
  
  if (selectInning) {
    selectInning.value = `${activeInning}_${activeIsTop}`;
  }
  
  const halfText = activeIsTop ? 'Top' : 'Bottom';
  const inningText = getInningOrdinal(activeInning);
  
  setTimeout(() => {
    showABOutcomeToast(`STARTING ${halfText.toUpperCase()} OF THE ${inningText.toUpperCase()}`);
  }, 500);
}

function populateInningDropdown() {
  if (!selectInning) return;
  selectInning.innerHTML = '';
  
  for (let i = 1; i <= 9; i++) {
    const topOpt = document.createElement('option');
    topOpt.value = `${i}_true`;
    topOpt.textContent = `${getInningOrdinal(i)} Top`;
    selectInning.appendChild(topOpt);
    
    const botOpt = document.createElement('option');
    botOpt.value = `${i}_false`;
    botOpt.textContent = `${getInningOrdinal(i)} Bot`;
    selectInning.appendChild(botOpt);
  }
  
  selectInning.value = `${activeInning}_${activeIsTop}`;
}

function getInningOrdinal(inn) {
  if (inn === 1) return '1st';
  if (inn === 2) return '2nd';
  if (inn === 3) return '3rd';
  return `${inn}th`;
}

function goToMainMenu() {
  clearInterval(timerInterval);
  if (overviewTimerInterval) {
    clearInterval(overviewTimerInterval);
    overviewTimerInterval = null;
  }
  if (autoPlayTimeout) {
    clearTimeout(autoPlayTimeout);
    autoPlayTimeout = null;
  }
  
  // Hide active gameplay overlays
  if (quickPreviewControls) {
    quickPreviewControls.classList.add('opacity-0', 'pointer-events-none');
    quickPreviewControls.classList.remove('opacity-100', 'pointer-events-auto');
  }
  if (decisionPrompt) {
    setElementVisibility(decisionPrompt, false);
  }
  if (absBroadcastOverlay) {
    absBroadcastOverlay.classList.remove('active-broadcast-overlay');
  }
  if (gameStatusBadge) {
    gameStatusBadge.classList.add('opacity-0', 'pointer-events-none');
    gameStatusBadge.classList.remove('opacity-100', 'pointer-events-auto');
  }
  if (abStartOverlay) {
    abStartOverlay.classList.add('opacity-0', 'pointer-events-none');
    abStartOverlay.classList.remove('opacity-100', 'pointer-events-auto');
    const startPanel = abStartOverlay.querySelector('.ab-start-cabinet');
    if (startPanel) {
      startPanel.classList.add('scale-95');
      startPanel.classList.remove('scale-100');
    }
  }
  
  isGamePaused = false;
  if (pauseScreen) {
    pauseScreen.classList.add('opacity-0', 'pointer-events-none', 'scale-95');
    pauseScreen.classList.remove('opacity-100', 'pointer-events-auto', 'scale-100');
  }
  if (abSummaryOverlay) {
    abSummaryOverlay.classList.add('opacity-0', 'pointer-events-none');
    abSummaryOverlay.classList.remove('opacity-100', 'pointer-events-auto');
    const summaryPanel = abSummaryOverlay.querySelector('.ab-summary-panel');
    if (summaryPanel) {
      summaryPanel.classList.add('scale-95');
      summaryPanel.classList.remove('scale-100');
    }
  }

  setOverlayVisible(hudHeader, false);
  hudKeyboardHelp.classList.add('opacity-0');
  setOverlayVisible(matchupCard, false);
  if (replayBadge) {
    replayBadge.classList.add('opacity-0', 'pointer-events-none');
    replayBadge.classList.remove('opacity-100');
  }
  
  showReviewPanel(false);
  setReviewingState(false);
  scoreboardScreen.classList.remove('opacity-100');
  scoreboardScreen.classList.add('opacity-0', 'pointer-events-none');
  
  isSessionOver = false;
  updateDailyStreakStatusUI();
  
  if (inningCard) inningCard.classList.add('hidden');
  
  pitchesList = [];
  currentPitchIndex = 0;
  pitchHistory = [];
  currentAbStartHistoryIndex = 0;
  
  if (!activeFavoriteTeam) {
    transitionToState(STATES.WELCOME);
  } else {
    transitionToState(STATES.START);
  }
  
  // Refresh dashboard metrics
  updateChallengeProgressUI();
  updateProfileStatsUI();
}

function getMatchupNames(pitch) {
  if (pitch.pitcher && pitch.batter) {
    return { pitcher: pitch.pitcher, batter: pitch.batter };
  }
  
  let pitcher = "Pitcher";
  let batter = "Batter";
  
  if (pitch.historical_blurb) {
    const pMatch = pitch.historical_blurb.match(/thrown by ([\w\s\.\-]+?)(?:\s+\(|,|\s+for\b)/i);
    if (pMatch && pMatch[1]) {
      pitcher = pMatch[1].trim();
    }
  }
  return { pitcher, batter };
}

function getShortName(fullName) {
  if (!fullName) return '';
  const parts = fullName.split(' ');
  if (parts.length > 1) {
    return `${parts[0][0]}. ${parts[parts.length - 1]}`;
  }
  return fullName;
}

/**
 * Handles tab switching in the start screen dashboard
 */
function switchTab(tabName) {
  const tabs = ['play', 'leaderboard', 'stats'];
  tabs.forEach(t => {
    const btn = document.getElementById(`tab-btn-${t}`);
    const content = document.getElementById(`tab-content-${t}`);
    if (t === tabName) {
      btn.className = 'ump-tab ump-tab--active';
      btn.setAttribute('aria-selected', 'true');
      content.classList.remove('hidden');
      content.classList.add('flex');
    } else {
      btn.className = 'ump-tab';
      btn.setAttribute('aria-selected', 'false');
      content.classList.add('hidden');
      content.classList.remove('flex');
    }
  });

  if (tabName === 'stats') {
    updateProfileStatsUI();
  } else if (tabName === 'leaderboard') {
    renderLeaderboard('weekly');
  } else if (tabName === 'play') {
    renderDailyCompeteDashboard();
    loadPlayTabRecentGames();
  }
}

/**
 * Starts a weekly challenge game playlist
 */
function startWeeklyChallengeGame(gameIdx) {
  gameMode = 'weekly_challenge';
  activeGameIndex = gameIdx;
  isGamePaused = false;
  isSessionOver = false;
  if (pauseScreen) {
    pauseScreen.classList.add('opacity-0', 'pointer-events-none');
    pauseScreen.classList.remove('opacity-100', 'pointer-events-auto');
  }
  
  // Group only this game's pitches into at-bats!
  const gameData = WEEKLY_CHALLENGE_DATA[gameIdx];
  const gameABs = [];
  let currentPitches = [];
  let currentBatter = '';
  
  gameData.pitches.forEach(pitch => {
    if (pitch.batter !== currentBatter && currentPitches.length > 0) {
      gameABs.push({
        gameIndex: gameIdx,
        gameTitle: gameData.title,
        filmRoomUrl: gameData.film_room_url,
        umpScorecardUrl: gameData.ump_scorecard_url,
        pitches: currentPitches,
        batter: currentPitches[0].batter,
        pitcher: currentPitches[0].pitcher,
        completed: false,
        userCorrectCount: 0,
        userTotalCount: 0
      });
      currentPitches = [];
    }
    currentBatter = pitch.batter;
    currentPitches.push(pitch);
  });
  
  if (currentPitches.length > 0) {
    gameABs.push({
      gameIndex: gameIdx,
      gameTitle: gameData.title,
      filmRoomUrl: gameData.film_room_url,
      umpScorecardUrl: gameData.ump_scorecard_url,
      pitches: currentPitches,
      batter: currentPitches[0].batter,
      pitcher: currentPitches[0].pitcher,
      completed: false,
      userCorrectCount: 0,
      userTotalCount: 0
    });
  }
  
  weeklyPlaylistABs = gameABs;
  activeWeeklyAbIndex = 0;
  
  loadWeeklyAtBat(activeWeeklyAbIndex);
}

/**
 * Starts a Daily Streak challenge session
 */
function startDailyStreakChallenge(isResume = false) {
  if (!isResume && !requireLoggedInUser()) return;
  const username = localStorage.getItem('ump_username') || 'GUEST_UMPIRE';
  localStorage.setItem(`daily_streak_last_played_date_${username}`, new Date().toLocaleDateString());
  updateDailyStreakStatusUI();

  gameMode = 'daily_streak';
  isGamePaused = false;
  isSessionOver = false;
  if (pauseScreen) {
    pauseScreen.classList.add('opacity-0', 'pointer-events-none');
    pauseScreen.classList.remove('opacity-100', 'pointer-events-auto');
  }
  
  if (!isResume) {
    pitchesList = generateDailyStreakPitches();
    currentPitchIndex = 0;
    pitchHistory = [];
    currentAbStartHistoryIndex = 0;
    abBalls = 0;
    abStrikes = 0;
    inningOuts = 0;
    
    totalPitchesCount = 0;
    totalBattersFaced = 0;
    totalSessionK = 0;
    totalSessionBB = 0;
    totalSessionH = 0;
    totalSessionOuts = 0;
  } else {
    reconstructActiveAtBatState();
  }

  transitionToState(STATES.IDLE);
}

/**
 * Merges standard pitches with Orioles game pitches and shuffles them for Daily Streak mode
 */
function generateDailyStreakPitches() {
  const merged = [...getObfuscatedPitches(), ...ORIOLES_GAME_DATA];
  // Fisher-Yates shuffle
  for (let i = merged.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [merged[i], merged[j]] = [merged[j], merged[i]];
  }
  return merged;
}

function getRevisitedUrls(pitch, abData) {
  let filmRoomUrl = "https://www.mlb.com/video";
  let umpScorecardUrl = "https://www.umpscorecards.com";

  const rawUmpUrl = abData?.umpScorecardUrl || abData?.ump_scorecard_url || "";
  const rawFilmUrl = abData?.filmRoomUrl || abData?.film_room_url || "";
  
  let gameId = null;
  const gameIdMatch = rawUmpUrl.match(/game_id=(\d+)/) || rawFilmUrl.match(/\/game\/(\d+)/);
  if (gameIdMatch) {
    gameId = gameIdMatch[1];
  }

  if (rawUmpUrl) {
    umpScorecardUrl = rawUmpUrl;
  } else if (gameId) {
    umpScorecardUrl = `https://umpscorecards.com/single_game/?game_id=${gameId}`;
  } else {
    umpScorecardUrl = `https://umpscorecards.com/games/`;
  }

  if (rawFilmUrl) {
    filmRoomUrl = rawFilmUrl;
  } else if (pitch && pitch.pitcher && pitch.batter) {
    const queryStr = `${pitch.pitcher} vs ${pitch.batter}` + (pitch.inning ? ` Inning ${pitch.inning}` : '');
    filmRoomUrl = `https://www.mlb.com/video/search?q=${encodeURIComponent(queryStr)}`;
  }

  return { filmRoomUrl, umpScorecardUrl };
}

function setAbSummaryReviewExpanded(expanded) {
  abSummaryReviewExpanded = expanded;
  if (btnAbSummaryToggleReview) {
    btnAbSummaryToggleReview.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    btnAbSummaryToggleReview.textContent = expanded ? '▼ HIDE CHART' : '▶ PITCH CHART';
  }
  
  const callsBoard = document.getElementById('ab-summary-calls-board');
  const xpPanel = document.getElementById('ab-summary-xp-panel');
  if (callsBoard) {
    if (expanded) callsBoard.classList.add('hidden');
    else callsBoard.classList.remove('hidden');
  }
  if (xpPanel) {
    if (expanded) xpPanel.classList.add('hidden');
    else xpPanel.classList.remove('hidden');
  }

  if (!abSummaryReviewSection) return;
  const cabinet = document.querySelector('.arcade-cabinet');
  if (cabinet) cabinet.classList.toggle('arcade-cabinet--chart-open', expanded);
  if (expanded) {
    abSummaryReviewSection.hidden = false;
    abSummaryReviewSection.classList.remove('is-collapsed');
    abSummarySelectedPitchIndex = null;
    drawAbSummarySVGMatrix();
    clearAbSummaryPitchSelection();
    requestAnimationFrame(() => {
      setMarqueePlayerName(abSummaryPitcherName, '.ab-summary-pitcher-name-dup', abSummaryPitcherName?.textContent || '', { uppercase: true });
      setMarqueePlayerName(abSummaryBatterName, '.ab-summary-batter-name-dup', abSummaryBatterName?.textContent || '', { uppercase: true });
    });
  } else {
    abSummaryReviewSection.classList.add('is-collapsed');
    abSummaryReviewSection.hidden = true;
  }
}

function setChallengeTrackerHudVisible(visible) {
  if (!challengeTrackerHud) return;
  challengeTrackerHud.classList.toggle('hidden', !visible);
}

function positionCloseCallPill(cross) {
  if (!closeCallPill || !cross) return;
  const pos = pickZoneDistanceLabelScreenPos(cross.x, cross.y);
  if (!pos) {
    closeCallPill.style.left = '50%';
    closeCallPill.style.top = '8rem';
    closeCallPill.style.transform = 'translate(-50%, -100%)';
    return;
  }
  closeCallPill.style.left = `${pos.x}px`;
  closeCallPill.style.top = `${pos.y}px`;
  closeCallPill.style.transform = pos.transform;
}

async function updateAbSummaryLeaderboardSnippet(username) {
  if (!abSummaryLeaderboardSnippet || !username) return;
  abSummaryLeaderboardSnippet.textContent = '…';
  try {
    const { rows } = await getLeaderboardRows('weekly', username);
    const me = rows.find((r) => r.isUser);
    abSummaryLeaderboardSnippet.textContent = me
      ? `#${me.rank} · ${me.accuracy}`
      : 'Submit score to rank';
  } catch {
    abSummaryLeaderboardSnippet.textContent = '—';
  }
}

async function updateAbStartLeaderboardSnippet(username) {
  const startLeaderboardEl = document.getElementById('ab-start-leaderboard-snippet');
  if (!startLeaderboardEl || !username) return;
  startLeaderboardEl.textContent = '…';
  try {
    const { rows } = await getLeaderboardRows('weekly', username);
    const me = rows.find((r) => r.isUser);
    startLeaderboardEl.textContent = me
      ? `#${me.rank} · ${me.accuracy}`
      : 'No rank yet';
  } catch {
    startLeaderboardEl.textContent = '—';
  }
}

function showLevelUpCelebration(newLevel, oldLevel) {
  const tier = getLevelTier(newLevel);
  const milestone = isMilestoneLevel(newLevel) || getLevelTier(newLevel).min === newLevel;

  playLevelUpSound();
  showFloatingXP(null, milestone ? `★ ${tier.title.toUpperCase()} ★` : `LEVEL ${newLevel}`);

  if (levelUpOverlay && levelUpBadge && levelUpTitle) {
    applyLevelBadgeElement(levelUpBadge, newLevel);
    levelUpTitle.textContent = tier.title;
    if (levelUpSubtitle) {
      levelUpSubtitle.textContent = milestone
        ? `Milestone reached — Level ${oldLevel} → ${newLevel}`
        : `Level ${oldLevel} → ${newLevel}`;
    }
    levelUpOverlay.classList.remove('opacity-0');
    levelUpOverlay.classList.add('opacity-100', 'level-up-overlay--active');
    levelUpOverlay.setAttribute('aria-hidden', 'false');
    setTimeout(() => {
      levelUpOverlay.classList.remove('opacity-100', 'level-up-overlay--active');
      levelUpOverlay.classList.add('opacity-0');
      levelUpOverlay.setAttribute('aria-hidden', 'true');
    }, milestone ? 3200 : 2200);
  } else {
    showLevelUpToast(newLevel);
  }
}

/**
 * Displays the At-Bat Summary Overlay between weekly challenge at-bats
 */
async function showAtBatSummaryScreen(outcomeText) {
  if (!abSummaryOverlay) return;

  activeAbEnded = true;
  cancelAutoPlayPitch();
  abSummarySelectedPitchIndex = null;
  setAbSummaryReviewExpanded(false);
  hideGameplayHudForSummary(true);
  hideAbSummaryXpPopover();
  
  // Reset zoom and dimension line when showing summary (keep umpire camera — no summary angle rotation)
  setZoomedIn(false);
  clearDimensionLine();
  hideQuickPreviewPanel();
  showReviewPanel(false);
  if (replayBadge) {
    replayBadge.classList.add('opacity-0', 'pointer-events-none');
    replayBadge.classList.remove('opacity-100');
  }

  let pitcher = "Pitcher";
  let batter = "Batter";

  try {
  
  const displayOutcome = outcomeText || lastAbOutcomeText || "At-Bat Complete";
  abSummaryTitle.textContent = displayOutcome.toUpperCase();
  
  pitcher = lastAbPitcher || "Pitcher";
  batter = lastAbBatter || "Batter";
  abSummaryMatchup.textContent = `P: ${pitcher.toUpperCase()} vs B: ${batter.toUpperCase()}`;
  
  // Fetch headshot images and logos
  setMarqueePlayerName(abSummaryPitcherName, '.ab-summary-pitcher-name-dup', pitcher, { uppercase: true });
  setMarqueePlayerName(abSummaryBatterName, '.ab-summary-batter-name-dup', batter, { uppercase: true });
  
  const targetPitch = lastCompletedPitch || currentPitch;
  if (abSummaryPitcherHandBadge && targetPitch) {
    const pH = (targetPitch.pitcher_hand || "R").includes("L") ? "LHP" : "RHP";
    abSummaryPitcherHandBadge.textContent = pH;
    abSummaryPitcherHandBadge.className = pH === "RHP"
      ? "ab-summary-hand-badge ab-summary-hand-badge--rhp"
      : "ab-summary-hand-badge ab-summary-hand-badge--lhp";
  }
  if (abSummaryBatterHandBadge && targetPitch) {
    const bH = (targetPitch.batter_hand || "R").includes("L") ? "LHB" : "RHB";
    abSummaryBatterHandBadge.textContent = bH;
    abSummaryBatterHandBadge.className = bH === "LHB"
      ? "ab-summary-hand-badge ab-summary-hand-badge--lhb"
      : "ab-summary-hand-badge ab-summary-hand-badge--rhb";
  }

  fetchPlayerMlbId(pitcher).then(pitcherId => {
    if (abSummaryPitcherImg) {
      abSummaryPitcherImg.src = pitcherId > 0 
        ? `https://midfield.mlbstatic.com/v1/people/${pitcherId}/spots/120` 
        : 'https://midfield.mlbstatic.com/v1/people/generic/spots/120';
    }
  });

  fetchPlayerMlbId(batter).then(batterId => {
    if (abSummaryBatterImg) {
      abSummaryBatterImg.src = batterId > 0 
        ? `https://midfield.mlbstatic.com/v1/people/${batterId}/spots/120` 
        : 'https://midfield.mlbstatic.com/v1/people/generic/spots/120';
    }
  });

  const pitcherTeam = getPlayerTeam(pitcher);
  const batterTeam = getPlayerTeam(batter);

  if (abSummaryPitcherLogo) {
    abSummaryPitcherLogo.src = getTeamLogoUrl(pitcherTeam || "Orioles");
  }
  if (abSummaryBatterLogo) {
    abSummaryBatterLogo.src = getTeamLogoUrl(batterTeam || "Tigers");
  }
  
  // Calculate accuracy only on taken pitches in this game session
  const abPitches = pitchHistory.slice(currentAbStartHistoryIndex).filter(x => !x.isSwingPlay);
  showSummaryPitchReview(abPitches);
  const correctCount = abPitches.filter(x => x.userCorrect).length;
  const accuracy = abPitches.length > 0 ? Math.round((correctCount / abPitches.length) * 100) : 100;
  
  if (abSummaryAccuracy) abSummaryAccuracy.textContent = `${accuracy}%`;
  if (abSummaryPitches) abSummaryPitches.textContent = abPitches.length;
  if (abSummaryCorrectCount) {
    abSummaryCorrectCount.textContent = abPitches.length > 0 ? `${correctCount}/${abPitches.length}` : '—';
  }
  renderAbSummaryCallBoard(abPitches);
  abSummaryBlurb.textContent = lastAbBlurb || "No play-by-play description available.";

  requestAnimationFrame(() => {
    setMarqueePlayerName(abSummaryPitcherName, '.ab-summary-pitcher-name-dup', pitcher, { uppercase: true });
    setMarqueePlayerName(abSummaryBatterName, '.ab-summary-batter-name-dup', batter, { uppercase: true });
  });
  
  const isPerfect = (correctCount === abPitches.length) && (abPitches.length > 0);
  const xpBreakdown = getAbXpBreakdown(correctCount, isPerfect);
  const username = localStorage.getItem('ump_username');
  
  const xpEarnedEl = document.getElementById('ab-summary-xp-earned');
  const xpLevelEl = document.getElementById('ab-summary-xp-level');
  bindAbSummaryXpPopoverOnce();
  const xpProgressEl = document.getElementById('ab-summary-xp-progress');
  const xpTotalEl = document.getElementById('ab-summary-xp-total');
  const xpProgressBar = document.getElementById('ab-summary-xp-bar');

  if (username) {
    const statsKey = getStatsStorageKey(username);
    const localStats = JSON.parse(localStorage.getItem(statsKey) || '{"overallAccuracy":null,"maxStreak":0,"completedWeekly":0,"dnfs":0,"history":[]}');
    
    const updateStatsUI = (stats) => {
      const totalXp = stats.xp || 0;
      const previousXp = Math.max(0, totalXp - xpBreakdown.total);
      const prev = getXpProgressInLevel(previousXp);
      const next = getXpProgressInLevel(totalXp);

      renderAbSummaryXpPopover(xpBreakdown, correctCount, isPerfect);
      if (xpEarnedEl) {
        xpEarnedEl.disabled = false;
        xpEarnedEl.textContent = `+${xpBreakdown.total} XP`;
        xpEarnedEl.className = isPerfect ? 'ab-summary-xp-earned-btn ab-summary-xp-earned-btn--bonus' : 'ab-summary-xp-earned-btn';
        xpEarnedEl.title = 'Tap for XP breakdown';
      }
      applyLevelBadgeElement(xpLevelEl, next.level);
      if (xpTotalEl) xpTotalEl.textContent = `${totalXp.toLocaleString()} XP total`;
      if (xpProgressEl) xpProgressEl.textContent = `${prev.progress} → ${next.progress} / ${XP_PER_LEVEL} XP`;
      setXpBarPercent(xpProgressBar, prev.pct, false);
      setTimeout(() => {
        setXpBarPercent(xpProgressBar, next.pct, true);
        if (xpProgressEl) xpProgressEl.textContent = `${next.progress} / ${XP_PER_LEVEL} XP`;
        applyLevelBadgeElement(xpLevelEl, next.level);
        updateProfileStatsUI();
        if (next.level > prev.level) {
          showLevelUpCelebration(next.level, prev.level);
        }
      }, 200);
    };

    // Render with local stats first (instantly)
    updateStatsUI(localStats);

    // Fetch cloud stats asynchronously and update if they differ
    getGlobalUserStats(username).then(cloudStats => {
      if (cloudStats && cloudStats.xp !== localStats.xp) {
        updateStatsUI(cloudStats);
      }
    }).catch(err => {
      console.warn("Async cloud stats update failed:", err);
    });
  } else {
    hideAbSummaryXpPopover();
    if (xpEarnedEl) {
      xpEarnedEl.textContent = 'Log in for XP';
      xpEarnedEl.className = 'ab-summary-xp-earned-btn';
      xpEarnedEl.disabled = true;
    }
    if (xpLevelEl) {
      xpLevelEl.textContent = 'GUEST';
      xpLevelEl.className = 'ump-level-badge ump-level-badge--rookie';
    }
    if (xpProgressEl) xpProgressEl.textContent = '—';
    if (xpProgressBar) {
      xpProgressBar.style.transition = 'none';
      xpProgressBar.style.width = '0%';
    }
  }

  
  // Pitch selector chips (shown when chart is expanded)
  if (abSummaryPitchList) {
    abSummaryPitchList.innerHTML = '';

    abPitches.forEach((item, index) => {
      const isCorrect = item.userCorrect;
      const pitchLabel = item.pitchType || 'Pitch';

      const btn = document.createElement('button');
      btn.type = 'button';
      const mphVal = item.speedMph != null ? Math.round(item.speedMph) : '—';
      const typeShort = (pitchLabel.split(' ')[0] || pitchLabel).slice(0, 5);
      const youC = formatCallShort(item.userCall);
      const umpC = formatCallShort(item.realCall);
      btn.className = `ab-summary-pitch-row ${isCorrect ? 'is-correct' : 'is-wrong'} animate-fade-in-up`;
      btn.style.animationDelay = `${index * 60}ms`;
      btn.setAttribute('role', 'option');
      btn.setAttribute('aria-label', `Pitch ${index + 1}, ${pitchLabel}, ${mphVal} mph, you ${youC}, ump ${umpC}`);
      btn.innerHTML = `
        <span class="ab-summary-pitch-num">${index + 1}</span>
        <span class="ab-summary-pitch-brief" title="${pitchLabel}">${mphVal} ${typeShort}</span>
        <span class="ab-summary-pitch-calls-mini">${youC}/${umpC}</span>
        <span class="ab-summary-pitch-verdict ${isCorrect ? 'ab-summary-pitch-verdict--ok' : 'ab-summary-pitch-verdict--miss'}">${isCorrect ? 'OK' : 'X'}</span>
      `;

      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        initAudio();
        if (abSummarySelectedPitchIndex === index) {
          clearAbSummaryPitchSelection();
        } else {
          highlightPitchInSummary(index);
        }
      });

      abSummaryPitchList.appendChild(btn);
    });
  }

  // Weekly challenge dock (footer) — save stats + animate progress
  if (gameMode === 'weekly_challenge' || gameMode === 'daily_compete') {
    if (abSummaryWeeklyChallengeDetails) {
      abSummaryWeeklyChallengeDetails.classList.remove('hidden');
    }

    const completedCount = activeWeeklyAbIndex + 1;
    const totalCount = weeklyPlaylistABs.length || 200;
    const prevPercent = Math.round((activeWeeklyAbIndex / totalCount) * 100);
    const newPercent = Math.round((completedCount / totalCount) * 100);

    if (weeklyPlaylistABs[activeWeeklyAbIndex]) {
      weeklyPlaylistABs[activeWeeklyAbIndex].userCorrectCount = correctCount;
      weeklyPlaylistABs[activeWeeklyAbIndex].userTotalCount = abPitches.length;
      weeklyPlaylistABs[activeWeeklyAbIndex].completed = true;
      saveChallengeSessionToLocal();
    }

    let overallCorrect = 0;
    let overallTotal = 0;
    let prevCorrect = 0;
    let prevTotal = 0;
    weeklyPlaylistABs.forEach((ab, idx) => {
      if (ab.completed) {
        overallCorrect += ab.userCorrectCount || 0;
        overallTotal += ab.userTotalCount || 0;
        if (idx !== activeWeeklyAbIndex) {
          prevCorrect += ab.userCorrectCount || 0;
          prevTotal += ab.userTotalCount || 0;
        }
      }
    });
    const overallAccuracy = overallTotal > 0 ? Math.round((overallCorrect / overallTotal) * 100) : 100;
    const prevAccuracy = prevTotal > 0 ? Math.round((prevCorrect / prevTotal) * 100) : null;

    if (abSummaryWeeklyCount) abSummaryWeeklyCount.textContent = String(completedCount);
    if (abSummaryWeeklyTotal) abSummaryWeeklyTotal.textContent = `/ ${totalCount}`;
    if (abSummaryWeeklyAccuracyText) {
      if (prevAccuracy === null) {
        abSummaryWeeklyAccuracyText.innerHTML = `${overallAccuracy}% <span class="text-[9px] text-slate-400 font-bold font-mono-tech ml-1">(=)</span>`;
      } else {
        const diff = overallAccuracy - prevAccuracy;
        if (diff > 0) {
          abSummaryWeeklyAccuracyText.innerHTML = `${overallAccuracy}% <span class="text-[9px] text-emerald-400 font-bold font-mono-tech ml-1">▲+${diff}%</span>`;
        } else if (diff < 0) {
          abSummaryWeeklyAccuracyText.innerHTML = `${overallAccuracy}% <span class="text-[9px] text-rose-400 font-bold font-mono-tech ml-1">▼${diff}%</span>`;
        } else {
          abSummaryWeeklyAccuracyText.innerHTML = `${overallAccuracy}% <span class="text-[9px] text-slate-400 font-bold font-mono-tech ml-1">(=)</span>`;
        }
      }
    }
    const weeklyPctEl = document.getElementById('ab-summary-weekly-pct');
    if (weeklyPctEl) {
      weeklyPctEl.textContent = `${newPercent}% Complete`;
    }
    if (abSummaryWeeklyProgressText) {
      abSummaryWeeklyProgressText.textContent = `${completedCount} / ${totalCount} at-bats`;
    }

    if (abSummaryWeeklyProgressBar) {
      abSummaryWeeklyProgressBar.style.transition = 'none';
      abSummaryWeeklyProgressBar.style.width = `${prevPercent}%`;
      setTimeout(() => {
        if (abSummaryWeeklyProgressBar) {
          abSummaryWeeklyProgressBar.style.transition = 'width 1.2s cubic-bezier(0.34, 1.56, 0.64, 1)';
          abSummaryWeeklyProgressBar.style.width = `${newPercent}%`;
        }
      }, 150);
    }

    updateAbSummaryLeaderboardSnippet(username);
  } else if (abSummaryWeeklyChallengeDetails) {
    abSummaryWeeklyChallengeDetails.classList.add('hidden');
  }

  // Connect film room and umpire scorecard URLs specifically to this at-bat's game
  let urls;
  if ((gameMode === 'weekly_challenge' || gameMode === 'daily_compete') && weeklyPlaylistABs[activeWeeklyAbIndex]) {
    const abData = weeklyPlaylistABs[activeWeeklyAbIndex];
    urls = getRevisitedUrls(targetPitch, abData);
  } else {
    // Fallback for standard or Orioles game
    const gameData = WEEKLY_CHALLENGE_DATA[activeGameIndex] || WEEKLY_CHALLENGE_DATA[0];
    urls = getRevisitedUrls(targetPitch, gameData);
  }
  if (abSummaryFilmLink) abSummaryFilmLink.href = urls.filmRoomUrl;
  if (abSummaryScorecardLink) abSummaryScorecardLink.href = urls.umpScorecardUrl;

  } catch (err) {
    console.error('showAtBatSummaryScreen:', err);
  }
  
  // Always reveal overlay even if a stat/widget failed to populate
  abSummaryOverlay.classList.remove('opacity-0', 'pointer-events-none');
  abSummaryOverlay.classList.add('opacity-100', 'pointer-events-auto');
  const summaryPanel = abSummaryOverlay.querySelector('.ab-summary-panel');
  if (summaryPanel) {
    summaryPanel.classList.remove('scale-95');
    summaryPanel.classList.add('scale-100');
  }
  
  // Re-trigger marquee calculation once transition is complete and container width is active
  setTimeout(() => {
    setMarqueePlayerName(abSummaryPitcherName, '.ab-summary-pitcher-name-dup', pitcher, { uppercase: true });
    setMarqueePlayerName(abSummaryBatterName, '.ab-summary-batter-name-dup', batter, { uppercase: true });
  }, 350);

  startSummaryTimerCounter();
}

function advanceNextAtBat() {
  if (abSummaryOverlay) {
    abSummaryOverlay.classList.add('opacity-0', 'pointer-events-none');
    abSummaryOverlay.classList.remove('opacity-100', 'pointer-events-auto');
  }

  hideGameplayHudForSummary(false);
  setAbSummaryReviewExpanded(false);
  abSummarySelectedPitchIndex = null;
  
  clearSummaryPitchReview();
  setCameraAngle('umpire');
  
  if (overviewTimerInterval) {
    clearInterval(overviewTimerInterval);
    overviewTimerInterval = null;
  }
  if (btnAbSummaryAdvance) {
    btnAbSummaryAdvance.textContent = 'Next at-bat';
  }
  
  quickStartNextPitch = true;
  activeAbEnded = false; // Reset AB ended status for the next AB
  
  // Set start history index for the new AB
  currentAbStartHistoryIndex = pitchHistory.length;
  
  // Advance in weekly challenge playlist
  if (gameMode === 'weekly_challenge' || gameMode === 'daily_compete') {
    activeWeeklyAbIndex++;
    saveChallengeSessionToLocal();
    updateChallengeProgressUI();
    loadWeeklyAtBat(activeWeeklyAbIndex);
  } else {
    if (isSessionOver) {
      completedABsCount[activeGameIndex] = 1;
      saveChallengeSessionToLocal();
      updateChallengeProgressUI();
      transitionToState(STATES.SCOREBOARD);
    } else {
      transitionToState(STATES.IDLE);
    }
  }
}

function saveChallengeSessionToLocal() {
  const username = localStorage.getItem('ump_username');
  
  // Clean functions to prevent circular references in JSON serialization
  const sanitizePitch = (pitch) => {
    if (!pitch) return pitch;
    const clean = { ...pitch };
    delete clean.pitchTrajectory;
    delete clean.trajectory;
    return clean;
  };

  const sanitizeWeeklyPlaylist = (playlist) => {
    if (!playlist) return playlist;
    return playlist.map(ab => {
      const cleanAb = { ...ab };
      if (cleanAb.pitches) {
        cleanAb.pitches = cleanAb.pitches.map(sanitizePitch);
      }
      return cleanAb;
    });
  };

  const sanitizeHistory = (history) => {
    if (!history) return history;
    return history.map(item => {
      const cleanItem = { ...item };
      if (cleanItem.pitchData) {
        cleanItem.pitchData = sanitizePitch(cleanItem.pitchData);
      }
      delete cleanItem.trajectory;
      return cleanItem;
    });
  };

  const sanitizedPlaylist = sanitizeWeeklyPlaylist(weeklyPlaylistABs);
  const sanitizedHistory = sanitizeHistory(pitchHistory);

  const data = {
    completedABsCount,
    dnfDisconnectsCount,
    weeklyPlaylistABs: sanitizedPlaylist,
    activeWeeklyAbIndex,
    activeGameIndex,
    profileStats: {
      avgAccuracy: 92.5,
      maxStreak: 12
    }
  };
  
  if (currentState !== STATES.START && currentState !== STATES.SCOREBOARD && gameMode !== 'standard') {
    data.activeChallenge = {
      gameMode,
      activeWeeklyAbIndex,
      activeGameIndex,
      activeDailyDate,
      currentPitchIndex,
      abBalls,
      abStrikes,
      pitchHistory: sanitizedHistory,
      historyLength: pitchHistory.length
    };
  } else {
    data.activeChallenge = null;
  }
  
  let key = username ? `pitch_ump_challenge_mvp_${username.toUpperCase()}` : 'pitch_ump_challenge_mvp_guest';
  if (gameMode === 'daily_compete') {
    key = username ? `pitch_ump_daily_compete_mvp_${username.toUpperCase()}_${activeDailyDate}` : `pitch_ump_daily_compete_mvp_guest_${activeDailyDate}`;
  }
  
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (err) {
    console.error("Failed to save challenge session to localStorage:", err);
  }
  
  if (username) {
    getGlobalUserStats(username).then(stats => {
      try {
        if (gameMode === 'daily_compete') {
          if (!stats.dailyProgress) stats.dailyProgress = {};
          stats.dailyProgress[activeDailyDate] = data;
        } else {
          stats.challengeProgress = data;
        }
        saveGlobalUserStats(username, stats);
      } catch (err) {
        console.error("Failed to update global user stats with active challenge:", err);
      }
    }).catch(err => {
      console.error("Failed to fetch global user stats:", err);
    });
  }
}

function reconstructActiveAtBatState() {
  pitchHistory = [];
  abBalls = 0;
  abStrikes = 0;
  currentAbStartHistoryIndex = 0;
  let nextPitchIndex = 0;

  if (!pitchesList || pitchesList.length === 0) {
    currentPitchIndex = 0;
    return;
  }

  for (let i = 0; i < pitchesList.length; i++) {
    const pitch = pitchesList[i];
    if (pitch.userCall !== undefined) {
      // Reconstruct history item
      const historyItem = {
        pitchNum: i + 1,
        pitchType: pitch.pitch_type,
        speedMph: pitch.speed_mph,
        userCall: pitch.userCall,
        absCall: pitch.absCall,
        realCall: pitch.realCall,
        userCorrect: pitch.userCorrect === undefined ? true : pitch.userCorrect,
        realCorrect: pitch.realCorrect,
        pitchData: pitch,
        trajectory: pitch.pitchTrajectory || null,
        isSwingPlay: !!pitch.isSwingPlay,
        swingOutcome: pitch.swingOutcome,
        swingHitType: pitch.swingHitType
      };
      pitchHistory.push(historyItem);
      
      // Update balls/strikes counts
      if (historyItem.isSwingPlay) {
        if (historyItem.swingOutcome === 'WHIFF') {
          abStrikes++;
        } else if (historyItem.swingOutcome === 'FOUL') {
          if (abStrikes < 2) {
            abStrikes++;
          }
        }
      } else {
        if (historyItem.userCall === 'S' || historyItem.userCall === 'TIMEOUT') {
          abStrikes++;
        } else if (historyItem.userCall === 'B') {
          abBalls++;
        }
      }
      nextPitchIndex = i + 1;
    } else {
      nextPitchIndex = i;
      break;
    }
  }
  
  currentPitchIndex = nextPitchIndex;
  // Limit currentPitchIndex to the valid range
  if (currentPitchIndex >= pitchesList.length) {
    currentPitchIndex = pitchesList.length - 1;
  }
  
  console.log(`Reconstructed active At-Bat state: pitchIndex=${currentPitchIndex}, balls=${abBalls}, strikes=${abStrikes}, historyCount=${pitchHistory.length}`);
}

async function loadSavedSessionFromLocal() {
  const username = localStorage.getItem('ump_username');
  if (!username) {
    completedABsCount = [0, 0, 0, 0, 0];
    activeWeeklyAbIndex = 0;
    activeGameIndex = 0;
    weeklyPlaylistABs = extractAtBatsFromWeeklyData();
    updateChallengeProgressUI();
    return;
  }
  
  try {
    const session = await getActiveSession(username);
    if (session) {
      console.log("Restoring active session from IndexedDB...");
      gameMode = session.gameMode;
      activeWeeklyAbIndex = session.activeWeeklyAbIndex;
      currentPitchIndex = session.currentPitchIndex;
      abBalls = session.abBalls;
      abStrikes = session.abStrikes;
      pitchHistory = session.pitchHistory || [];
      weeklyPlaylistABs = session.weeklyPlaylistABs || [];
      activeDailyDate = session.activeDailyDate;
      activeDailyTeam = session.activeDailyTeam;
      
      if (session.pitchesList) {
        pitchesList = session.pitchesList;
      }
      if (session.totalPitchesCount !== undefined) totalPitchesCount = session.totalPitchesCount;
      if (session.totalBattersFaced !== undefined) totalBattersFaced = session.totalBattersFaced;
      if (session.totalSessionK !== undefined) totalSessionK = session.totalSessionK;
      if (session.totalSessionBB !== undefined) totalSessionBB = session.totalSessionBB;
      if (session.totalSessionH !== undefined) totalSessionH = session.totalSessionH;
      if (session.totalSessionOuts !== undefined) totalSessionOuts = session.totalSessionOuts;
    }
  } catch (e) {
    console.error("Failed to restore session from IndexedDB", e);
  }
  
  const weeklyKey = `pitch_ump_challenge_mvp_${username.toUpperCase()}`;
  const rawWeekly = localStorage.getItem(weeklyKey);
  if (rawWeekly) {
    try {
      const data = JSON.parse(rawWeekly);
      if (data.completedABsCount) completedABsCount = data.completedABsCount;
      if (data.dnfDisconnectsCount) dnfDisconnectsCount = data.dnfDisconnectsCount;
      if (data.activeWeeklyAbIndex !== undefined) activeWeeklyAbIndex = data.activeWeeklyAbIndex;
      if (data.activeGameIndex !== undefined) activeGameIndex = data.activeGameIndex;
      if (data.weeklyPlaylistABs && data.weeklyPlaylistABs.length > 0) {
        weeklyPlaylistABs = data.weeklyPlaylistABs;
      } else {
        weeklyPlaylistABs = extractAtBatsFromWeeklyData();
      }
    } catch (e) {
      console.error(e);
      weeklyPlaylistABs = extractAtBatsFromWeeklyData();
    }
  } else {
    completedABsCount = [0, 0, 0, 0, 0];
    activeWeeklyAbIndex = 0;
    activeGameIndex = 0;
    weeklyPlaylistABs = extractAtBatsFromWeeklyData();
  }
  
  updateDailyStreakStatusUI();
  updateChallengeProgressUI();
}

function pauseGameOnFocusLoss() {
  if (currentState === STATES.START || 
      currentState === STATES.SCOREBOARD || 
      currentState === STATES.PITCHING || 
      currentState === STATES.DECISION_PENDING || 
      isGamePaused) return;
  if (abSummaryOverlay && abSummaryOverlay.classList.contains('opacity-100')) return;
  if (abStartOverlay && abStartOverlay.classList.contains('opacity-100')) return;

  // Blur/visibility loss cancels pending timers — flush post-AB summary instead of losing it
  if (isTransitioningToSummary && activeAbEnded) {
    if (summaryTimeout) {
      clearTimeout(summaryTimeout);
      summaryTimeout = null;
    }
    finishAtBatAndShowSummary();
    return;
  }

  isGamePaused = true;
  pauseStartTime = performance.now();
  
  if (quickContinueInterval) {
    quickReviewTimeLeft = Math.max(0, quickReviewDelay - (performance.now() - quickReviewStartTime));
  } else {
    quickReviewTimeLeft = 0;
  }

  playPauseSound();

  if (autoPlayTimeout) {
    clearTimeout(autoPlayTimeout);
    autoPlayTimeout = null;
  }
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  if (overviewTimerInterval) {
    clearInterval(overviewTimerInterval);
    overviewTimerInterval = null;
  }
  if (summaryTimeout) {
    clearTimeout(summaryTimeout);
    summaryTimeout = null;
  }
  if (quickContinueInterval) {
    clearInterval(quickContinueInterval);
    quickContinueInterval = null;
  }
  
  // Show pause overlay, but suppress it if a menu overlay (settings/scorecard/player modal) is already visible
  const isMenuOverlayOpen = isSettingsOpen || 
                            (umpcardOverlay && umpcardOverlay.classList.contains('opacity-100')) ||
                            (playerCardModalOverlay && playerCardModalOverlay.classList.contains('opacity-100'));
  if (pauseScreen) {
    if (isMenuOverlayOpen) {
      pauseScreen.classList.add('opacity-0', 'pointer-events-none');
      pauseScreen.classList.remove('opacity-100', 'pointer-events-auto');
    } else {
      pauseScreen.classList.remove('opacity-0', 'pointer-events-none', 'scale-95');
      pauseScreen.classList.add('opacity-100', 'scale-100', 'pointer-events-auto');
    }
  }

  // Update Stats in Pause Screen
  if (pauseModeText) {
    let modeText = "Practice Sandbox";
    if (gameMode === 'weekly_challenge') modeText = "Weekly Challenge";
    else if (gameMode === 'daily_streak') modeText = "Daily Streak Challenge";
    else if (gameMode === 'orioles_full') modeText = "Orioles Full Game";
    pauseModeText.textContent = modeText;
  }
  
  if (pauseInningOutsText) {
    const inningText = activeIsTop ? `Top ${activeInning}` : `Bot ${activeInning}`;
    const outsText = `${inningOuts} ${inningOuts === 1 ? 'Out' : 'Outs'}`;
    pauseInningOutsText.textContent = `${inningText} | ${outsText}`;
  }
  
  if (pauseScoreText) {
    const pitch = currentPitch || pitchesList[currentPitchIndex];
    if (pitch) {
      const scoreAway = pitch.score_away !== undefined ? pitch.score_away : 0;
      const scoreHome = pitch.score_home !== undefined ? pitch.score_home : 0;
      pauseScoreText.textContent = `Away ${scoreAway} - ${scoreHome} Home`;
    } else {
      pauseScoreText.textContent = "0 - 0";
    }
  }
  
  if (pauseAccText) {
    const calledPitches = pitchHistory.filter(x => !x.isSwingPlay);
    const correctCalls = calledPitches.filter(x => x.userCorrect).length;
    const userAcc = calledPitches.length > 0 ? Math.round((correctCalls / calledPitches.length) * 100) : 100;
    pauseAccText.textContent = `${userAcc}% (${correctCalls}/${calledPitches.length} Correct)`;
  }

  // Update Challenge At-Bat progress if playing a weekly challenge
  if (pauseProgressRow && pauseProgressText) {
    if (gameMode === 'weekly_challenge' && weeklyPlaylistABs && weeklyPlaylistABs.length > 0) {
      pauseProgressRow.classList.remove('hidden');
      const currentAbNum = Math.min(weeklyPlaylistABs.length, activeWeeklyAbIndex + 1);
      pauseProgressText.textContent = `At-Bat ${currentAbNum} of ${weeklyPlaylistABs.length}`;
    } else {
      pauseProgressRow.classList.add('hidden');
    }
  }

  // Populate active timers info in pause screen
  const pauseTimersEl = document.getElementById('pause-timers');
  if (pauseTimersEl) {
    let timerTexts = [];
    if (currentState === STATES.DECISION_PENDING && timerSecondsLeft > 0) {
      timerTexts.push(`Decision Count: ${timerSecondsLeft}s left`);
    }
    if (abSummaryOverlay && abSummaryOverlay.classList.contains('opacity-100') && overviewSecondsLeft > 0) {
      timerTexts.push(`AB Summary: ${overviewSecondsLeft}s left`);
    }
    const lastHistory = pitchHistory[pitchHistory.length - 1];
    if (currentState === STATES.ABS_REVIEW && quickReviewTimeLeft > 0 && (reviewStyle === 'quick' || (lastHistory && lastHistory.isSwingPlay))) {
      timerTexts.push(`Autoplay Review: ${(quickReviewTimeLeft / 1000).toFixed(1)}s left`);
    }
    
    if (timerTexts.length > 0) {
      pauseTimersEl.innerHTML = timerTexts.join('<br>');
      pauseTimersEl.classList.remove('hidden');
    } else {
      pauseTimersEl.innerHTML = '';
      pauseTimersEl.classList.add('hidden');
    }
  }
}

function resumeGameFromPause() {
  if (!isGamePaused) return;
  
  const pauseDuration = performance.now() - pauseStartTime;
  windupStartTime += pauseDuration;
  pitchStartTime += pauseDuration;
  replayStartTime += pauseDuration;
  quickReviewStartTime += pauseDuration;
  
  isGamePaused = false;
  playResumeSound();

  if (pauseScreen) {
    pauseScreen.classList.add('opacity-0', 'pointer-events-none', 'scale-95');
    pauseScreen.classList.remove('opacity-100', 'pointer-events-auto', 'scale-100');
  }
  
  // Check if AB summary overlay is showing — if so, restart its timer, don't re-enter game flow
  if (abSummaryOverlay && abSummaryOverlay.classList.contains('opacity-100')) {
    startSummaryTimerCounter();
    return;
  }
  
  // Check if we were in the middle of transitioning to summary when paused
  if (isTransitioningToSummary) {
    if (summaryTimeout) clearTimeout(summaryTimeout);
    summaryTimeout = setTimeout(() => {
      finishAtBatAndShowSummary();
    }, 600);
    return;
  }
  
  if (currentState === STATES.IDLE) {
    autoPlayTimeout = setTimeout(() => {
      triggerPitchRelease();
    }, 1200);
  } else if (currentState === STATES.ABS_REVIEW) {
    // Restart the quick preview auto-advance with remaining time
    const lastHistory = pitchHistory[pitchHistory.length - 1];
    if (reviewStyle === 'quick' || (lastHistory && lastHistory.isSwingPlay)) {
      startQuickReviewAutoAdvance(Math.max(400, quickReviewTimeLeft));
    } else {
      startOverviewTimeBankCounter();
    }
  } else if (currentState === STATES.DECISION_PENDING) {
    startCountdownTimer();
  }
}

function updateChallengeProgressUI() {
  const total = weeklyPlaylistABs.length || extractAtBatsFromWeeklyData().length || 16;
  if (weeklyChallengeProgressText && weeklyChallengeProgressBar) {
    const completed = activeWeeklyAbIndex;
    weeklyChallengeProgressText.textContent = `${completed} / ${total} At-Bats`;
    
    const percentage = Math.min(100, Math.round((completed / total) * 100));
    weeklyChallengeProgressBar.style.width = `${percentage}%`;
  }
  
  const totalBadge = document.getElementById('weekly-challenge-total-badge');
  if (totalBadge) {
    totalBadge.textContent = `${total} TOTAL ABs`;
  }
  
  if (btnStartWeeklyChallenge) {
    const hasProgress = activeWeeklyAbIndex > 0 || currentPitchIndex > 0 || pitchHistory.length > 0;
    if (hasProgress && activeWeeklyAbIndex < total) {
      btnStartWeeklyChallenge.textContent = "Resume Challenge";
    } else {
      btnStartWeeklyChallenge.textContent = "Start Challenge";
    }
  }
}

function updateProfileStatsUI() {
  const avgAccEl = document.getElementById('stats-avg-accuracy');
  const maxStrEl = document.getElementById('stats-max-streak');
  const compWkEl = document.getElementById('stats-completed-weekly');
  const dnfEl = document.getElementById('stats-dnfs');
  const historyTableBody = document.getElementById('history-table-body');
  
  const username = localStorage.getItem('ump_username');
  
  // HUD Elements caching
  const hudTeamLogo = document.getElementById('hud-user-team-logo');
  const hudFavBadge = document.getElementById('hud-user-favorite-badge');
  const hudHandle = document.getElementById('hud-user-handle');
  const hudXpText = document.getElementById('hud-user-xp-text');
  const hudXpBar = document.getElementById('hud-user-xp-bar');
  
  if (!username) {
    if (avgAccEl) avgAccEl.textContent = "--";
    if (maxStrEl) maxStrEl.textContent = "--";
    if (compWkEl) compWkEl.textContent = "--";
    if (dnfEl) dnfEl.textContent = "0";
    if (historyTableBody) historyTableBody.innerHTML = '<tr><td colspan="4" class="p-3 text-center text-gray-500">Log in to view stats</td></tr>';
    
    // Reset Top-Bar HUD for Guest
    if (hudHandle) hudHandle.textContent = "GUEST_UMPIRE";
    if (hudFavBadge) {
      hudFavBadge.textContent = "NONE";
      hudFavBadge.className = "text-[8px] font-bold px-1.5 py-0.2 bg-purple-500/20 text-purple-400 border border-purple-500/30 rounded uppercase font-mono-tech";
    }
    if (hudTeamLogo) {
      hudTeamLogo.src = "/generic.svg";
      hudTeamLogo.classList.add('animate-pulse');
    }
    if (hudXpText) hudXpText.textContent = "0 XP (Log in to earn Crew XP)";
    if (hudXpBar) hudXpBar.style.width = "0%";
    return;
  }
  
  const normalized = normalizeHandle(username);
  const statsKey = getStatsStorageKey(normalized);
  const userStats = JSON.parse(localStorage.getItem(statsKey) || '{"overallAccuracy":null,"maxStreak":0,"completedWeekly":0,"dnfs":0,"history":[]}');
  
  // Set handle
  if (hudHandle) hudHandle.textContent = normalized;
  
  // Set favorite team & logo
  if (hudFavBadge) {
    hudFavBadge.classList.remove('hidden');
    if (activeFavoriteTeam && activeFavoriteTeam !== "none") {
      hudFavBadge.textContent = activeFavoriteTeam.slice(0, 3).toUpperCase();
      hudFavBadge.className = "text-[8px] font-bold px-1.5 py-0.2 bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded uppercase font-mono-tech";
    } else {
      hudFavBadge.textContent = "NONE";
      hudFavBadge.className = "text-[8px] font-bold px-1.5 py-0.2 bg-purple-500/20 text-purple-400 border border-purple-500/30 rounded uppercase font-mono-tech";
    }
  }
  
  if (hudTeamLogo) {
    if (activeFavoriteTeam && activeFavoriteTeam !== "none") {
      hudTeamLogo.src = getTeamLogoUrl(activeFavoriteTeam);
      hudTeamLogo.classList.remove('animate-pulse');
    } else {
      hudTeamLogo.src = "/generic.svg";
      hudTeamLogo.classList.add('animate-pulse');
    }
  }
  
  // Calculate XP (Experience Points) based on history correct calls or read from userStats.xp
  let xp = userStats.xp !== undefined ? userStats.xp : 0;
  if (userStats.xp === undefined) {
    const history = userStats.history || [];
    history.forEach(h => {
      const isWeekly = h.gameName && h.gameName.includes("Weekly");
      const isStreak = h.gameName && h.gameName.includes("Streak");
      const isDailyCompete = h.gameName && h.gameName.includes("Daily Compete");
      
      if (isWeekly) {
        xp += (h.correctCalls || 0) * 10;
      } else if (isStreak) {
        xp += (h.correctCalls || 0) * 15;
      } else if (isDailyCompete) {
        xp += (h.correctCalls || 0) * 12;
      } else {
        xp += (h.correctCalls || 0) * 5;
      }
    });
  }
  
  const xpProgress = getXpProgressInLevel(xp);
  const hudLevelBadge = document.getElementById('hud-user-level-badge');
  applyLevelBadgeElement(hudLevelBadge, xpProgress.level);
  
  if (hudXpText) {
    hudXpText.textContent = `${xpProgress.progress} / ${XP_PER_LEVEL} XP · ${xp.toLocaleString()} total`;
  }
  setXpBarPercent(hudXpBar, xpProgress.pct, false);
  
  if (avgAccEl) {
    avgAccEl.textContent = userStats.overallAccuracy !== null && userStats.overallAccuracy !== undefined ? `${userStats.overallAccuracy}%` : "--";
  }
  if (maxStrEl) {
    maxStrEl.textContent = userStats.maxStreak || "0";
  }
  if (compWkEl) {
    const total = weeklyPlaylistABs.length || (typeof extractAtBatsFromWeeklyData === 'function' ? extractAtBatsFromWeeklyData().length : 16) || 16;
    compWkEl.textContent = `${userStats.completedWeekly || 0} / ${total} Games`;
  }
  if (dnfEl) {
    dnfEl.textContent = userStats.dnfs !== undefined ? userStats.dnfs : dnfDisconnectsCount;
  }
  
  if (historyTableBody) {
    historyTableBody.innerHTML = '';
    if (!userStats.history || userStats.history.length === 0) {
      historyTableBody.innerHTML = '<tr><td colspan="4" class="p-3 text-center text-gray-500">No challenge history recorded yet.</td></tr>';
    } else {
      userStats.history.forEach(item => {
        const row = document.createElement('tr');
        row.className = 'border-b border-white/5 hover:bg-white/2 bg-slate-900/50';
        
        row.innerHTML = `
          <td class="p-3">
            <span class="text-xs font-mono-tech uppercase text-gray-300 font-bold block">${item.gameName}</span>
            <span class="text-[9px] text-gray-500 font-mono-tech uppercase block mt-0.5">${item.date}</span>
          </td>
          <td class="p-3 font-semibold text-gray-300 font-mono-tech text-[10px]">
            ${item.matchup}
          </td>
          <td class="p-3 text-center text-xs font-mono-tech text-gray-300 font-bold">
            ${item.correctCalls} / ${item.totalCalls}
          </td>
          <td class="p-3 text-center text-xs font-mono-tech font-black text-purple-400">
            ${item.accuracy}%
          </td>
        `;
        historyTableBody.appendChild(row);
      });
    }
  }
}

// Sandbox Tuning Helpers
function enterFullReviewPanel(userHistoryItem) {
  hideQuickPreviewPanel();
  
  showStrikeZone(true);
  showBall(true);
  showMannequins(false);
  setReviewingState(true);
  setCrossingMarkerVisible(true);
  
  drawTrajectoryTrace(pitchTrajectory.points);
  const isStrikeABSVal = userHistoryItem.absCall === 'S';
  drawCrossingMarker(pitchTrajectory.crossPoint, isStrikeABSVal);
  
  // Animate tight zoom and draw dimension line on detailed review
  setZoomedIn(true);
  if (pitchTrajectory && pitchTrajectory.crossPoint) {
    drawDimensionLine(pitchTrajectory.crossPoint);
  }
  
  selectCameraView('side');
  
  const isCorrect = userHistoryItem.userCorrect;
  showDecisionToast(isCorrect, userHistoryItem.absCall);
  if (isCorrect) {
    if (activeAbEnded && abStrikes === 3) {
      playStrikeoutSirenSound();
    } else {
      if (userHistoryItem.absCall === 'S') {
        playStrikeCallSound();
      } else {
        playBallCallSound();
      }
    }
  } else {
    playErrorBuzz();
  }
  
  populateBroadcastReviewData(userHistoryItem);
  showReviewPanel(true);
  
  startOverviewTimeBankCounter();
}

function enterFullReviewFromQuick() {
  if (currentState !== STATES.ABS_REVIEW) return;
  
  if (autoPlayTimeout) {
    clearTimeout(autoPlayTimeout);
    autoPlayTimeout = null;
  }
  if (summaryTimeout) {
    clearTimeout(summaryTimeout);
    summaryTimeout = null;
  }
  isTransitioningToSummary = false;
  
  const userHistoryItem = pitchHistory[pitchHistory.length - 1];
  enterFullReviewPanel(userHistoryItem);
}

function startQuickReviewAutoAdvance(delayMs) {
  if (quickContinueInterval) {
    clearInterval(quickContinueInterval);
    quickContinueInterval = null;
  }
  if (autoPlayTimeout) {
    clearTimeout(autoPlayTimeout);
    autoPlayTimeout = null;
  }

  quickReviewDelay = delayMs;
  quickReviewStartTime = performance.now();
  quickReviewTimeLeft = delayMs;

  if (quickContinueTimer) {
    quickContinueTimer.textContent = `(${Math.ceil(quickReviewTimeLeft / 1000)}s)`;
  }

  quickContinueInterval = setInterval(() => {
    if (isGamePaused) return;

    const elapsed = performance.now() - quickReviewStartTime;
    quickReviewTimeLeft = Math.max(0, quickReviewDelay - elapsed);

    if (quickContinueTimer) {
      quickContinueTimer.textContent = `(${Math.ceil(quickReviewTimeLeft / 1000)}s)`;
    }

    if (quickReviewTimeLeft <= 0) {
      clearInterval(quickContinueInterval);
      quickContinueInterval = null;
      if (quickContinueTimer) {
        quickContinueTimer.textContent = '';
      }
      hideQuickPreviewPanel();
      advanceGameFlow();
    }
  }, 100);
}

function hideQuickPreviewPanel() {
  if (quickPreviewControls) {
    quickPreviewControls.classList.add('opacity-0', 'pointer-events-none', 'scale-90');
    quickPreviewControls.classList.remove('opacity-100', 'pointer-events-auto', 'scale-100');
  }
  if (btnViewDetails) {
    btnViewDetails.classList.remove('hidden');
  }
  if (quickContinueInterval) {
    clearInterval(quickContinueInterval);
    quickContinueInterval = null;
  }
}

function populatePitchDetailBug() {
  if (!currentPitch || !pitchDetailBug) return;
  
  // 1. Pitch Type
  const typeMap = {
    'FF': 'Four-Seam Fastball',
    'SL': 'Slider',
    'CU': 'Curveball',
    'KC': 'Knuckle Curve',
    'CH': 'Changeup',
    'FC': 'Cutter',
    'SI': 'Sinker',
    'FS': 'Splitter',
    'ST': 'Sweeper',
    'SV': 'Slurve'
  };
  const rawType = currentPitch.pitch_type || 'Fastball';
  const fullType = typeMap[rawType] || rawType;
  if (pitchDetailType) {
    pitchDetailType.textContent = fullType.toUpperCase();
  }
  
  // 2. Speed
  if (pitchDetailSpeed) {
    pitchDetailSpeed.textContent = `${currentPitch.speed_mph.toFixed(1)} MPH`;
  }
  
  // 3. Break
  if (pitchDetailBreak) {
    const t_cross = pitchTrajectory ? pitchTrajectory.t_cross : 0.4;
    const hBreakVal = 0.5 * (currentPitch.ax || 0.0) * Math.pow(t_cross, 2) * 12;
    const vBreakVal = 0.5 * ((currentPitch.az || 0.0) + 32.17) * Math.pow(t_cross, 2) * 12;
    
    const hSign = hBreakVal >= 0 ? '+' : '';
    const vSign = vBreakVal >= 0 ? '+' : '';
    
    pitchDetailBreak.textContent = `H: ${hSign}${hBreakVal.toFixed(1)}"  V: ${vSign}${vBreakVal.toFixed(1)}"`;
  }
  
  // 4. Location
  if (pitchDetailLoc) {
    const crossX = pitchTrajectory ? pitchTrajectory.crossPoint.x : 0;
    const crossY = pitchTrajectory ? pitchTrajectory.crossPoint.y : 2.5;
    
    let horizontalLoc = "Middle";
    const isLeft = crossX < -0.3;
    const isRight = crossX > 0.3;
    if (currentPitch.batter_hand === 'LHB') {
      if (isLeft) horizontalLoc = "Inside";
      if (isRight) horizontalLoc = "Outside";
    } else {
      if (isLeft) horizontalLoc = "Outside";
      if (isRight) horizontalLoc = "Inside";
    }
    
    let verticalLoc = "Middle";
    const sz_top = currentPitch.sz_top || 3.4;
    const sz_bot = currentPitch.sz_bot || 1.6;
    const heightDiff = sz_top - sz_bot;
    if (crossY > sz_top - heightDiff * 0.25) {
      verticalLoc = "High";
    } else if (crossY < sz_bot + heightDiff * 0.25) {
      verticalLoc = "Low";
    }
    
    let locText = "";
    if (horizontalLoc === "Middle" && verticalLoc === "Middle") {
      locText = "Middle-Middle";
    } else if (horizontalLoc === "Middle") {
      locText = verticalLoc;
    } else if (verticalLoc === "Middle") {
      locText = horizontalLoc;
    } else {
      locText = `${horizontalLoc} ${verticalLoc}`;
    }
    
    // Check if it's way outside/wild
    const distToZone = getDistanceToABSZone(crossX, crossY);
    if (distToZone > 0.5) { // more than 6 inches outside
      locText = "Waste Pitch";
    }
    
    pitchDetailLoc.textContent = locText.toUpperCase();
    
    // Color style classes based on call
    const isStrike = isStrikeABS(currentPitch, pitchTrajectory ? pitchTrajectory.crossPoint : { x: 0, y: 2.5 });
    if (isStrike) {
      pitchDetailLoc.className = "text-green-400 font-bold bg-green-500/10 border border-green-500/20 px-2.5 py-1 rounded text-xs uppercase";
    } else {
      pitchDetailLoc.className = "text-red-400 font-bold bg-red-500/10 border border-red-500/20 px-2.5 py-1 rounded text-xs uppercase";
    }
  }
}

function updateGameStatus(statusText, dotColor = 'purple') {
  if (!gameStatusBadge || !gameStatusText || !gameStatusDot) return;
  
  gameStatusText.textContent = statusText.toUpperCase();
  
  // Set dot color and glowing effect
  let colorClass = 'bg-purple-500 shadow-[0_0_8px_#a855f7]';
  if (dotColor === 'green') {
    colorClass = 'bg-green-500 shadow-[0_0_8px_#22c55e]';
  } else if (dotColor === 'red') {
    colorClass = 'bg-red-500 shadow-[0_0_8px_#ef4444]';
  } else if (dotColor === 'cyan') {
    colorClass = 'bg-cyan-500 shadow-[0_0_8px_#06b6d4]';
  } else if (dotColor === 'orange') {
    colorClass = 'bg-orange-500 shadow-[0_0_8px_#f97316]';
  }
  
  gameStatusDot.className = `w-2.5 h-2.5 rounded-full animate-pulse ${colorClass}`;
  
  // Show badge if not in START state or SCOREBOARD state
  if (currentState !== STATES.START && currentState !== STATES.SCOREBOARD) {
    gameStatusBadge.classList.remove('opacity-0', 'pointer-events-none');
    gameStatusBadge.classList.add('opacity-100');
  } else {
    gameStatusBadge.classList.add('opacity-0', 'pointer-events-none');
    gameStatusBadge.classList.remove('opacity-100');
  }
}

function startOverviewTimeBankCounter() {
  if (overviewTimerInterval) {
    clearInterval(overviewTimerInterval);
    overviewTimerInterval = null;
  }
  if (btnBroadcastContinue) {
    btnBroadcastContinue.textContent = "CONTINUE";
  }
}

function updateOverviewTimerUI() {
  if (btnBroadcastContinue) {
    btnBroadcastContinue.textContent = "CONTINUE";
  }
}

function startSummaryTimerCounter() {
  if (overviewTimerInterval) {
    clearInterval(overviewTimerInterval);
    overviewTimerInterval = null;
  }
  if (btnAbSummaryAdvance) {
    const isEnd = (gameMode === 'weekly_challenge') ? (activeWeeklyAbIndex >= weeklyPlaylistABs.length - 1) : isSessionOver;
    btnAbSummaryAdvance.textContent = isEnd ? "VIEW FINAL SCOREBOARD" : "ADVANCE TO NEXT AB";
  }
}

function updateSummaryTimerUI() {
  if (btnAbSummaryAdvance) {
    const isEnd = (gameMode === 'weekly_challenge') ? (activeWeeklyAbIndex >= weeklyPlaylistABs.length - 1) : isSessionOver;
    btnAbSummaryAdvance.textContent = isEnd ? "VIEW FINAL SCOREBOARD" : "ADVANCE TO NEXT AB";
  }
}

function extractAtBatsFromWeeklyData() {
  const borderlineABs = [];
  const normalABs = [];
  
  WEEKLY_CHALLENGE_DATA.forEach((game, gameIdx) => {
    let currentPitches = [];
    let currentBatter = '';
    
    game.pitches.forEach(pitch => {
      if (pitch.batter !== currentBatter && currentPitches.length > 0) {
        const abObj = {
          gameIndex: gameIdx,
          gameTitle: game.title,
          filmRoomUrl: game.film_room_url,
          umpScorecardUrl: game.ump_scorecard_url,
          pitches: currentPitches,
          batter: currentPitches[0].batter,
          pitcher: currentPitches[0].pitcher
        };
        
        let hasBorderline = false;
        currentPitches.forEach(p => {
          const t_cross = getCrossingTime(p);
          const crossPoint = getBallPositionAtTime(p, t_cross);
          const xEdgeDist = Math.abs(Math.abs(crossPoint.x) - 0.8283);
          const yBotDist = Math.abs(crossPoint.y - (p.sz_bot - 0.12));
          const yTopDist = Math.abs(crossPoint.y - (p.sz_top + 0.12));
          const yEdgeDist = Math.min(yBotDist, yTopDist);
          if (xEdgeDist <= 0.15 || yEdgeDist <= 0.15) {
            hasBorderline = true;
          }
        });
        
        if (hasBorderline) {
          borderlineABs.push(abObj);
        } else {
          normalABs.push(abObj);
        }
        currentPitches = [];
      }
      currentBatter = pitch.batter;
      currentPitches.push(pitch);
    });
    
    if (currentPitches.length > 0) {
      const abObj = {
        gameIndex: gameIdx,
        gameTitle: game.title,
        filmRoomUrl: game.film_room_url,
        umpScorecardUrl: game.ump_scorecard_url,
        pitches: currentPitches,
        batter: currentPitches[0].batter,
        pitcher: currentPitches[0].pitcher
      };
      
      let hasBorderline = false;
      currentPitches.forEach(p => {
        const t_cross = getCrossingTime(p);
        const crossPoint = getBallPositionAtTime(p, t_cross);
        const xEdgeDist = Math.abs(Math.abs(crossPoint.x) - 0.8283);
        const yBotDist = Math.abs(crossPoint.y - (p.sz_bot - 0.12));
        const yTopDist = Math.abs(crossPoint.y - (p.sz_top + 0.12));
        const yEdgeDist = Math.min(yBotDist, yTopDist);
        if (xEdgeDist <= 0.15 || yEdgeDist <= 0.15) {
          hasBorderline = true;
        }
      });
      
      if (hasBorderline) {
        borderlineABs.push(abObj);
      } else {
        normalABs.push(abObj);
      }
    }
  });
  
  // Deterministic Mulberry32 generator
  const randGenerator = mulberry32(20260525);
  const deterministicShuffle = (arr) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(randGenerator() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };
  
  deterministicShuffle(borderlineABs);
  deterministicShuffle(normalABs);
  
  const targetBorderline = 100;
  const targetNormal = 100;
  
  let selectedBorderline = borderlineABs.slice(0, targetBorderline);
  let selectedNormal = normalABs.slice(0, targetNormal);
  
  if (selectedBorderline.length < targetBorderline) {
    const needed = targetBorderline - selectedBorderline.length;
    selectedNormal = selectedNormal.concat(normalABs.slice(targetNormal, targetNormal + needed));
  } else if (selectedNormal.length < targetNormal) {
    const needed = targetNormal - selectedNormal.length;
    selectedBorderline = selectedBorderline.concat(borderlineABs.slice(targetBorderline, targetBorderline + needed));
  }
  
  const finalPlaylist = selectedBorderline.concat(selectedNormal).slice(0, 200);
  return deterministicShuffle(finalPlaylist);
}

async function startWeeklyChallenge() {
  if (!requireLoggedInUser()) return;
  gameMode = 'weekly_challenge';
  cancelAutoPlayPitch();
  isTransitioningToSummary = false;
  if (summaryTimeout) {
    clearTimeout(summaryTimeout);
    summaryTimeout = null;
  }
  if (abSummaryOverlay) {
    abSummaryOverlay.classList.add('opacity-0', 'pointer-events-none');
    abSummaryOverlay.classList.remove('opacity-100', 'pointer-events-auto');
    const summaryPanel = abSummaryOverlay.querySelector('.ab-summary-panel');
    if (summaryPanel) {
      summaryPanel.classList.add('scale-95');
      summaryPanel.classList.remove('scale-100');
    }
  }
  isGamePaused = false;
  isSessionOver = false;
  if (pauseScreen) {
    pauseScreen.classList.add('opacity-0', 'pointer-events-none');
    pauseScreen.classList.remove('opacity-100', 'pointer-events-auto');
  }
  
  const rawABs = extractAtBatsFromWeeklyData();
  const username = localStorage.getItem('ump_username');
  let restored = false;
  
  if (username) {
    try {
      const session = await getActiveSession(username);
      if (session && session.gameMode === 'weekly_challenge' && session.weeklyPlaylistABs && session.weeklyPlaylistABs.length > 0) {
        console.log("Resuming weekly challenge from IndexedDB active session...");
        weeklyPlaylistABs = session.weeklyPlaylistABs;
        activeWeeklyAbIndex = session.activeWeeklyAbIndex;
        currentPitchIndex = session.currentPitchIndex;
        abBalls = session.abBalls;
        abStrikes = session.abStrikes;
        pitchHistory = session.pitchHistory || [];
        restored = true;
      }
    } catch (e) {
      console.error("Failed to check active weekly session in IndexedDB:", e);
    }
  }
  
  if (!restored) {
    const key = username ? `pitch_ump_challenge_mvp_${username.toUpperCase()}` : 'pitch_ump_challenge_mvp_guest';
    const rawSession = localStorage.getItem(key);
    let savedPlaylist = null;
    let savedAbIndex = 0;
    
    if (rawSession) {
      try {
        const savedData = JSON.parse(rawSession);
        if (savedData.weeklyPlaylistABs && savedData.weeklyPlaylistABs.length === rawABs.length) {
          const saved = savedData.weeklyPlaylistABs;
          
          // Validate playlist has no teammate matchups and pitch IDs match raw challenge data
          const hasTeammates = saved.some(ab => 
            ab.pitches && ab.pitches.some(p => {
              const teamP = getPlayerTeam(p.pitcher);
              const teamB = getPlayerTeam(p.batter);
              return teamP && teamB && teamP === teamB;
            })
          );
          const rawFirstId = rawABs[0]?.pitches[0]?.id;
          const savedFirstId = saved[0]?.pitches[0]?.id;
          const firstIdMatches = rawFirstId !== undefined && savedFirstId !== undefined && rawFirstId === savedFirstId;
          
          if (!hasTeammates && firstIdMatches) {
            savedPlaylist = saved;
            savedAbIndex = savedData.activeWeeklyAbIndex || 0;
            if (savedAbIndex >= savedPlaylist.length) {
              savedPlaylist = null;
              savedAbIndex = 0;
            }
          } else {
            console.log("Invalidating saved weekly playlist: teammate matchups or data version mismatch detected.");
            localStorage.removeItem(key);
          }
        }
      } catch (e) {
        console.error("Failed to restore weekly playlist", e);
      }
    }
    
    if (savedPlaylist) {
      weeklyPlaylistABs = savedPlaylist;
      activeWeeklyAbIndex = savedAbIndex;
    } else {
      weeklyPlaylistABs = [...rawABs];
      activeWeeklyAbIndex = 0;
    }
  }
  
  loadWeeklyAtBat(activeWeeklyAbIndex, restored);
}

function getPlayerTeam(name) {
  if (!name) return null;
  const phillies = ["Zack Wheeler", "Jose Alvarado", "Kyle Schwarber", "Trea Turner", "Bryce Harper", "Alec Bohm", "Bryson Stott", "Nick Castellanos", "J.T. Realmuto", "Brandon Marsh", "Johan Rojas"];
  const Mets = ["Kodai Senga", "Edwin Diaz", "Brandon Nimmo", "Francisco Lindor", "Pete Alonso", "J.D. Martinez", "Jeff McNeil", "Starling Marte", "Harrison Bader", "Francisco Alvarez", "Brett Baty"];
  const Orioles = ["Corbin Burnes", "Craig Kimbrel", "Gunnar Henderson", "Adley Rutschman", "Colton Cowser", "Anthony Santander", "Ryan Mountcastle", "Jordan Westburg", "Jackson Holliday", "Cedric Mullins", "Ramón Urías"];
  const Tigers = ["Tarik Skubal", "Jason Foley", "Zach McKinstry", "Riley Greene", "Kerry Carpenter", "Mark Canha", "Colt Keith", "Gio Urshela", "Wenceel Pérez", "Jake Rogers", "Andy Ibáñez"];
  const Dodgers = ["Yoshinobu Yamamoto", "Evan Phillips", "Shohei Ohtani", "Mookie Betts", "Freddie Freeman", "Teoscar Hernández", "Max Muncy", "Will Smith", "Gavin Lux", "Andy Pages", "Miguel Rojas"];
  const Giants = ["Logan Webb", "Camilo Doval", "Jung Hoo Lee", "LaMonte Wade Jr.", "Jorge Soler", "Matt Chapman", "Thairo Estrada", "Wilmer Flores", "Mike Yastrzemski", "Patrick Bailey", "Nick Ahmed"];
  const Yankees = ["Gerrit Cole", "Clay Holmes", "Anthony Volpe", "Juan Soto", "Aaron Judge", "Giancarlo Stanton", "Anthony Rizzo", "Gleyber Torres", "Alex Verdugo", "Jose Trevino", "Oswaldo Cabrera"];
  const RedSox = ["Nick Pivetta", "Kenley Jansen", "Jarren Duran", "Rafael Devers", "Tyler O'Neill", "Triston Casas", "Masataka Yoshida", "Wilyer Abreu", "Connor Wong", "Ceddanne Rafaela", "David Hamilton"];
  const Astros = ["Framber Valdez", "Josh Hader", "Jose Altuve", "Yordan Alvarez", "Alex Bregman", "Kyle Tucker", "Jeremy Peña", "Yainer Diaz", "Jon Singleton", "Jake Meyers", "Mauricio Dubón"];
  const Rangers = ["Nathan Eovaldi", "Kirby Yates", "Marcus Semien", "Corey Seager", "Adolis García", "Josh Jung", "Nathaniel Lowe", "Jonah Heim", "Wyatt Langford", "Leody Taveras", "Ezequiel Duran"];

  if (phillies.includes(name)) return "Phillies";
  if (Mets.includes(name)) return "Mets";
  if (Orioles.includes(name)) return "Orioles";
  if (Tigers.includes(name)) return "Tigers";
  if (Dodgers.includes(name)) return "Dodgers";
  if (Giants.includes(name)) return "Giants";
  if (Yankees.includes(name)) return "Yankees";
  if (RedSox.includes(name)) return "RedSox";
  if (Astros.includes(name)) return "Astros";
  if (Rangers.includes(name)) return "Rangers";
  return null;
}

function checkReconstructedAbCompleted() {
  if (abBalls >= 4 || abStrikes >= 3) return true;
  if (pitchHistory.length > 0) {
    const lastItem = pitchHistory[pitchHistory.length - 1];
    if (lastItem.isSwingPlay && (lastItem.swingOutcome === 'HIT' || lastItem.swingOutcome === 'OUT')) {
      return true;
    }
    if (pitchHistory.length === pitchesList.length) {
      return true;
    }
  }
  return false;
}

function determineAbOutcomeFromHistory() {
  if (!pitchesList || pitchesList.length === 0) return "AT-BAT COMPLETE";
  const matchup = getMatchupNames(pitchesList[0]);
  const batterName = matchup.batter.toUpperCase();
  if (abStrikes >= 3) return `${batterName} STRIKEOUT!`;
  if (abBalls >= 4) return `${batterName} WALKS!`;
  if (pitchHistory.length > 0) {
    const lastItem = pitchHistory[pitchHistory.length - 1];
    if (lastItem.isSwingPlay) {
      if (lastItem.swingOutcome === 'HIT') return `${batterName} HITS A ${lastItem.swingHitType.toUpperCase()}!`;
      if (lastItem.swingOutcome === 'OUT') return `${batterName} OUT (${lastItem.swingHitType.toUpperCase()})`;
    }
  }
  return "AT-BAT COMPLETE";
}

function loadWeeklyAtBat(abIdx, isResume = false) {
  if (abIdx >= weeklyPlaylistABs.length) {
    saveChallengeSessionToLocal();
    saveGameProgress();
    transitionToState(STATES.SCOREBOARD);
    return;
  }
  
  activeWeeklyAbIndex = abIdx;
  const abData = weeklyPlaylistABs[activeWeeklyAbIndex];
  
  pitchesList = abData.pitches;
  if (!isResume) {
    activeAbEnded = false;
    currentPitchIndex = 0;
    pitchHistory = [];
    currentAbStartHistoryIndex = 0;
    
    abBalls = 0;
    abStrikes = 0;
  } else {
    reconstructActiveAtBatState();
    
    // If At-Bat is completed, show summary overlay directly (do not auto-start next pitch)
    if (checkReconstructedAbCompleted()) {
      console.log("Resumed At-Bat is completed. Loading summary overlay directly.");
      cancelAutoPlayPitch();
      activeAbEnded = true;
      if (pitchesList.length > 0) {
        lastCompletedPitch = pitchesList[pitchesList.length - 1];
        const matchup = getMatchupNames(lastCompletedPitch);
        lastAbPitcher = matchup.pitcher;
        lastAbBatter = matchup.batter;
        lastAbBlurb = lastCompletedPitch.historical_blurb || "No play-by-play description available.";
        lastAbOutcomeText = determineAbOutcomeFromHistory();
        transitionToState(STATES.IDLE);
        showAtBatSummaryScreen(lastAbOutcomeText);
      }
      return;
    }
    activeAbEnded = false;
  }
  
  abOverviewSecondsUsed = 0;
  isGamePaused = false;
  if (pauseScreen) {
    pauseScreen.classList.add('opacity-0', 'pointer-events-none');
    pauseScreen.classList.remove('opacity-100', 'pointer-events-auto');
  }
  
  saveChallengeSessionToLocal();
  saveGameProgress();
  
  if (isResume) {
    transitionToState(STATES.IDLE);
    showAtBatStartScreen(() => {
      // After user confirms or timer expires, start auto-play
      if (currentState === STATES.IDLE && !isGamePaused) {
        autoPlayTimeout = setTimeout(() => {
          triggerPitchRelease();
        }, 600);
      }
    }, true);
  } else {
    // Show At-Bat Start Preview with matchup, then transition to IDLE
    transitionToState(STATES.IDLE);
    showAtBatStartScreen(() => {
      // After user confirms or timer expires, start auto-play
      if (currentState === STATES.IDLE && !isGamePaused) {
        autoPlayTimeout = setTimeout(() => {
          triggerPitchRelease();
        }, 600);
      }
    }, false);
  }
}

function showUmpireScorecardModal() {
  if (!umpcardOverlay || !umpcardStrikezoneCanvas) return;
  
  // Pause the game when opening the scorecard overlay
  pauseGameOnFocusLoss();
  cancelAutoPlayPitch();

  // Render stats
  const calledPitches = pitchHistory.filter(x => !x.isSwingPlay);
  const totalCalls = calledPitches.length;
  const correctCalls = calledPitches.filter(x => x.userCorrect).length;
  const userAcc = totalCalls > 0 ? Math.round((correctCalls / totalCalls) * 100) : 0;
  
  const umpCorrectCalls = calledPitches.filter(x => x.realCorrect).length;
  const umpAcc = totalCalls > 0 ? Math.round((umpCorrectCalls / totalCalls) * 100) : 0;

  if (umpcardUserAcc) umpcardUserAcc.textContent = `${userAcc}%`;
  if (umpcardUmpAcc) umpcardUmpAcc.textContent = `${umpAcc}%`;
  if (umpcardTotalPitches) umpcardTotalPitches.textContent = totalCalls;
  if (umpcardTotalCorrect) umpcardTotalCorrect.textContent = correctCalls;

  // Calculate run favor
  let netFavor = 0.0;
  calledPitches.forEach(pitch => {
    if (!pitch.userCorrect) {
      if (pitch.absCall === 'S' && pitch.userCall === 'B') {
        netFavor += 0.14;
      }
      else if (pitch.absCall === 'B' && pitch.userCall === 'S') {
        netFavor -= 0.14;
      }
    }
  });

  if (umpcardFavorTeam && umpcardFavorValue) {
    if (Math.abs(netFavor) < 0.01) {
      umpcardFavorTeam.textContent = "Neutral Matchup";
      umpcardFavorValue.textContent = "0.00 runs";
      umpcardFavorValue.className = "text-sm font-bold font-mono-tech text-white";
    } else if (netFavor > 0) {
      umpcardFavorTeam.textContent = "Favors Batters";
      umpcardFavorValue.textContent = `+${netFavor.toFixed(2)} runs`;
      umpcardFavorValue.className = "text-sm font-bold font-mono-tech text-green-400";
    } else {
      umpcardFavorTeam.textContent = "Favors Pitchers";
      umpcardFavorValue.textContent = `${netFavor.toFixed(2)} runs`;
      umpcardFavorValue.className = "text-sm font-bold font-mono-tech text-blue-400";
    }
  }

  // Calculate rating
  if (umpcardRatingTitle && umpcardRatingDesc) {
    if (totalCalls === 0) {
      umpcardRatingTitle.textContent = "NO CALLS EVALUATED";
      umpcardRatingDesc.textContent = "Call borderline pitches during the game challenge to evaluate your accuracy.";
    } else if (userAcc >= 96) {
      umpcardRatingTitle.textContent = "WORLD SERIES CREW CHIEF";
      umpcardRatingTitle.className = "text-sm font-bold uppercase text-green-400";
      umpcardRatingDesc.textContent = "Masterclass accuracy. The Automated Ball-Strike system has nothing on your eyes.";
    } else if (userAcc >= 92) {
      umpcardRatingTitle.textContent = "MLB CLASS-A UMPIRE";
      umpcardRatingTitle.className = "text-sm font-bold uppercase text-blue-400";
      umpcardRatingDesc.textContent = "Strong performance, matching top-tier Major League standard. Keep it up.";
    } else if (userAcc >= 85) {
      umpcardRatingTitle.textContent = "TRIPLE-A CALLER";
      umpcardRatingTitle.className = "text-sm font-bold uppercase text-yellow-500";
      umpcardRatingDesc.textContent = "Solid work but missed some borderline pitches. Practice in Sandbox Mode.";
    } else {
      umpcardRatingTitle.textContent = "ROOKIE LEAGUE BALL BOY";
      umpcardRatingTitle.className = "text-sm font-bold uppercase text-red-500";
      umpcardRatingDesc.textContent = "Difficulty distinguishing borderline zones. Check Sandbox strike zone helpers.";
    }
  }

  // Render 2D Canvas Strike Zone
  const canvas = umpcardStrikezoneCanvas;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 300, 360);
  
  ctx.fillStyle = 'rgba(12, 15, 18, 0.95)';
  ctx.fillRect(0, 0, 300, 360);

  function mapX(xVal) {
    return 150 + (xVal / 1.5) * 150;
  }
  function mapY(yVal) {
    return 360 - ((yVal - 1.0) / 3.0) * 360;
  }

  ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.beginPath();
  ctx.moveTo(mapX(-0.7083), mapY(1.1));
  ctx.lineTo(mapX(0.7083), mapY(1.1));
  ctx.lineTo(mapX(0.7083), mapY(1.0));
  ctx.lineTo(mapX(0), mapY(0.95));
  ctx.lineTo(mapX(-0.7083), mapY(1.0));
  ctx.closePath();
  ctx.fill();

  const sx = mapX(-0.7083);
  const sy = mapY(3.5);
  const sw = mapX(0.7083) - mapX(-0.7083);
  const sh = mapY(1.6) - mapY(3.5);

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
  ctx.lineWidth = 3;
  ctx.strokeRect(sx, sy, sw, sh);

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(sx + sw / 3, sy);
  ctx.lineTo(sx + sw / 3, sy + sh);
  ctx.moveTo(sx + 2 * sw / 3, sy);
  ctx.lineTo(sx + 2 * sw / 3, sy + sh);
  ctx.moveTo(sx, sy + sh / 3);
  ctx.lineTo(sx + sw, sy + sh / 3);
  ctx.moveTo(sx, sy + 2 * sh / 3);
  ctx.lineTo(sx + sw, sy + 2 * sh / 3);
  ctx.stroke();
  ctx.setLineDash([]);

  calledPitches.forEach((item, index) => {
    if (!item.trajectory || !item.trajectory.crossPoint) return;
    const px = item.trajectory.crossPoint.x;
    const py = item.trajectory.crossPoint.y;
    const cx = mapX(px);
    const cy = mapY(py);
    const correct = item.userCorrect;

    ctx.beginPath();
    ctx.arc(cx, cy, 7, 0, 2 * Math.PI);
    ctx.fillStyle = correct ? '#22c55e' : '#ef4444';
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 8px Share Tech Mono, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(index + 1, cx, cy);
  });

  umpcardOverlay.classList.remove('opacity-0', 'pointer-events-none', 'scale-95');
  umpcardOverlay.classList.add('opacity-100', 'scale-100', 'pointer-events-auto');
}

function hideUmpireScorecardModal() {
  if (!umpcardOverlay) return;
  umpcardOverlay.classList.add('opacity-0', 'pointer-events-none');
  umpcardOverlay.classList.remove('opacity-100', 'scale-100', 'pointer-events-auto');
  // Resume game from pause when closing scorecard
  resumeGameFromPause();
}

async function updateDailyStreakStatusUI() {
  const username = localStorage.getItem('ump_username') || 'GUEST_UMPIRE';
  const lastPlayed = localStorage.getItem(`daily_streak_last_played_date_${username}`);
  const today = new Date().toLocaleDateString();
  const btn = document.getElementById('btn-start-daily-streak');
  const status = document.getElementById('daily-attempt-status');
  const outcomeEl = document.getElementById('daily-streak-outcome');
  const historicalEl = document.getElementById('daily-streak-historical');
  const rankEl = document.getElementById('daily-streak-rank');
  
  const statsKey = `pitch_ump_stats_${username.toUpperCase()}`;
  const userStats = JSON.parse(localStorage.getItem(statsKey) || '{"overallAccuracy":null,"maxStreak":0,"completedWeekly":0,"dnfs":0,"history":[]}');
  
  if (historicalEl) {
    historicalEl.textContent = `${userStats.maxStreak || 0} Pitches`;
  }
  
  if (outcomeEl) {
    const todayAttempt = (userStats.history || []).find(h => h.gameName === "Daily Streak" && h.date === today);
    if (todayAttempt) {
      outcomeEl.textContent = `ENDED (Streak: ${todayAttempt.correctCalls})`;
      outcomeEl.className = "font-mono-tech text-xs font-black uppercase tracking-wider text-red-500";
    } else if (lastPlayed === today) {
      outcomeEl.textContent = "ATTEMPT FORFEITED";
      outcomeEl.className = "font-mono-tech text-xs font-black uppercase tracking-wider text-red-500";
    } else {
      outcomeEl.textContent = "NOT STARTED";
      outcomeEl.className = "font-mono-tech text-xs font-black uppercase tracking-wider text-amber-500";
    }
  }

  if (status) {
    status.textContent = "Available (Replayable)";
    status.className = "text-xs font-bold text-green-400 uppercase";
  }
  if (btn) {
    btn.removeAttribute('disabled');
    btn.className = "ump-btn bg-gradient-to-b from-amber-500 to-amber-700 hover:from-amber-400 hover:to-amber-600 border-amber-500/50 text-white ump-btn--sm pointer-events-auto";
    try {
      const session = await getActiveSession(username);
      if (session && session.gameMode === 'daily_streak' && session.pitchesList && session.pitchesList.length > 0) {
        btn.textContent = "Resume Streak";
      } else {
        btn.textContent = "Play Streak";
      }
    } catch (err) {
      btn.textContent = "Play Streak";
    }
  }
  if (rankEl && username !== 'GUEST_UMPIRE') {
    rankEl.textContent = "FETCHING...";
    try {
      const { rows } = await apiFetchLeaderboard('daily', username);
      const me = rows.find((r) => r.isUser);
      rankEl.textContent = me ? `#${me.rank} Global` : "UNRANKED";
    } catch (e) {
      rankEl.textContent = "OFFLINE";
    }
  } else if (rankEl) {
    rankEl.textContent = "UNRANKED";
  }
}

function cancelAutoPlayPitch() {
  if (autoPlayTimeout) {
    clearTimeout(autoPlayTimeout);
    autoPlayTimeout = null;
  }
}

function resumeAutoPlayPitch() {
  const isOverlayOpen = isSettingsOpen || 
                        (umpcardOverlay && umpcardOverlay.classList.contains('opacity-100')) ||
                        (playerCardModalOverlay && playerCardModalOverlay.classList.contains('opacity-100'));
  const summaryVisible = abSummaryOverlay && abSummaryOverlay.classList.contains('opacity-100');
  if (!isOverlayOpen && !summaryVisible && !activeAbEnded && !isGamePaused && currentState === STATES.IDLE && !autoPlayTimeout) {
    autoPlayTimeout = setTimeout(() => {
      triggerPitchRelease();
    }, 1800);
  }
}

// Local session load complete

function setOverlayVisible(el, visible) {
  if (!el) return;
  if (visible) {
    el.classList.remove('hidden');
    void el.offsetWidth; // Force reflow for css transitions
    el.classList.add('opacity-100', 'pointer-events-auto');
    el.classList.remove('opacity-0', 'pointer-events-none');
  } else {
    el.classList.add('opacity-0', 'pointer-events-none');
    el.classList.remove('opacity-100', 'pointer-events-auto');
    
    const onTransitionEnd = () => {
      if (el.classList.contains('opacity-0')) {
        el.classList.add('hidden');
      }
      el.removeEventListener('transitionend', onTransitionEnd);
    };
    el.addEventListener('transitionend', onTransitionEnd);
    
    // Safety fallback
    setTimeout(() => {
      if (el.classList.contains('opacity-0')) {
        el.classList.add('hidden');
      }
    }, 550);
  }
}

function showCustomConfirm(message) {
  return new Promise((resolve) => {
    if (!confirmModalOverlay || !btnConfirmModalYes || !btnConfirmModalNo) {
      resolve(confirm(message));
      return;
    }
    const txt = document.getElementById('confirm-modal-text');
    if (txt) txt.textContent = message;
    
    confirmModalOverlay.classList.remove('opacity-0', 'pointer-events-none', 'scale-95');
    confirmModalOverlay.classList.add('opacity-100', 'pointer-events-auto', 'scale-100');
    
    const handleYes = () => {
      cleanup();
      resolve(true);
    };
    
    const handleNo = () => {
      cleanup();
      resolve(false);
    };
    
    const cleanup = () => {
      btnConfirmModalYes.removeEventListener('click', handleYes);
      btnConfirmModalNo.removeEventListener('click', handleNo);
      confirmModalOverlay.classList.add('opacity-0', 'pointer-events-none', 'scale-95');
      confirmModalOverlay.classList.remove('opacity-100', 'pointer-events-auto', 'scale-100');
    };
    
    btnConfirmModalYes.addEventListener('click', handleYes);
    btnConfirmModalNo.addEventListener('click', handleNo);
  });
}

async function saveFavoriteTeam(teamName) {
  activeFavoriteTeam = teamName;
  const username = localStorage.getItem('ump_username');
  if (username) {
    localStorage.setItem(`pitch_ump_favorite_team_${username.toUpperCase()}`, teamName);
    
    // Save user stats globally
    try {
      const stats = await getGlobalUserStats(username);
      stats.favoriteTeam = teamName;
      await saveGlobalUserStats(username, stats);
    } catch (e) {
      console.warn("Failed to save favorite team globally:", e);
    }
  } else {
    localStorage.setItem('pitch_ump_favorite_team', teamName);
  }
  if (userFavoriteTeamBadge) {
    userFavoriteTeamBadge.textContent = teamName ? `FAVORITE TEAM: ${teamName.toUpperCase()}` : 'FAVORITE TEAM: NONE';
  }
}

function loadFavoriteTeam() {
  const username = localStorage.getItem('ump_username');
  let saved = null;
  if (username) {
    saved = localStorage.getItem(`pitch_ump_favorite_team_${username.toUpperCase()}`);
  }
  if (!saved) {
    saved = localStorage.getItem('pitch_ump_favorite_team');
  }
  
  if (saved && saved !== 'none') {
    activeFavoriteTeam = saved;
    if (userFavoriteTeamBadge) {
      userFavoriteTeamBadge.textContent = `FAVORITE TEAM: ${saved.toUpperCase()}`;
    }
  } else {
    activeFavoriteTeam = null;
    if (userFavoriteTeamBadge) {
      userFavoriteTeamBadge.textContent = 'FAVORITE TEAM: NONE';
    }
  }
}

const TEAMS_LIST = [
  { id: 'ARI', name: 'Dbacks', color: 'hsl(358, 86%, 42%)', symbol: 'A' },
  { id: 'ATL', name: 'Braves', color: 'hsl(210, 100%, 20%)', symbol: 'A' },
  { id: 'BAL', name: 'Orioles', color: 'hsl(18, 100%, 50%)', symbol: 'O' },
  { id: 'BOS', name: 'Red Sox', color: 'hsl(351, 100%, 40%)', symbol: 'B' },
  { id: 'CHC', name: 'Cubs', color: 'hsl(215, 100%, 40%)', symbol: 'C' },
  { id: 'CWS', name: 'White Sox', color: 'hsl(0, 0%, 15%)', symbol: 'S' },
  { id: 'CIN', name: 'Reds', color: 'hsl(354, 100%, 46%)', symbol: 'C' },
  { id: 'CLE', name: 'Guardians', color: 'hsl(210, 100%, 25%)', symbol: 'C' },
  { id: 'COL', name: 'Rockies', color: 'hsl(266, 25%, 35%)', symbol: 'R' },
  { id: 'DET', name: 'Tigers', color: 'hsl(212, 100%, 15%)', symbol: 'D' },
  { id: 'HOU', name: 'Astros', color: 'hsl(24, 100%, 50%)', symbol: 'H' },
  { id: 'KC', name: 'Royals', color: 'hsl(212, 100%, 35%)', symbol: 'K' },
  { id: 'LAA', name: 'Angels', color: 'hsl(354, 100%, 42%)', symbol: 'A' },
  { id: 'LAD', name: 'Dodgers', color: 'hsl(210, 100%, 45%)', symbol: 'LA' },
  { id: 'MIA', name: 'Marlins', color: 'hsl(189, 100%, 40%)', symbol: 'M' },
  { id: 'MIL', name: 'Brewers', color: 'hsl(46, 75%, 45%)', symbol: 'M' },
  { id: 'MIN', name: 'Twins', color: 'hsl(210, 100%, 22%)', symbol: 'M' },
  { id: 'NYM', name: 'Mets', color: 'hsl(18, 100%, 50%)', symbol: 'NY' },
  { id: 'NYY', name: 'Yankees', color: 'hsl(215, 100%, 15%)', symbol: 'NY' },
  { id: 'OAK', name: 'Athletics', color: 'hsl(145, 100%, 20%)', symbol: 'A' },
  { id: 'PHI', name: 'Phillies', color: 'hsl(356, 100%, 42%)', symbol: 'P' },
  { id: 'PIT', name: 'Pirates', color: 'hsl(48, 100%, 50%)', symbol: 'P' },
  { id: 'SD', name: 'Padres', color: 'hsl(38, 48%, 30%)', symbol: 'SD' },
  { id: 'SF', name: 'Giants', color: 'hsl(18, 100%, 50%)', symbol: 'SF' },
  { id: 'SEA', name: 'Mariners', color: 'hsl(185, 100%, 25%)', symbol: 'S' },
  { id: 'STL', name: 'Cardinals', color: 'hsl(352, 100%, 42%)', symbol: 'STL' },
  { id: 'TB', name: 'Rays', color: 'hsl(204, 100%, 30%)', symbol: 'TB' },
  { id: 'TEX', name: 'Rangers', color: 'hsl(215, 100%, 35%)', symbol: 'T' },
  { id: 'TOR', name: 'Blue Jays', color: 'hsl(212, 100%, 40%)', symbol: 'TB' },
  { id: 'WSH', name: 'Nationals', color: 'hsl(354, 100%, 42%)', symbol: 'W' }
];

let selectedTeamId = null;

function generateTeamSelectGrid() {
  if (!teamGridContainer) return;
  
  const renderGrid = (filterText = "") => {
    teamGridContainer.innerHTML = '';
    const filtered = TEAMS_LIST.filter(t => 
      t.name.toLowerCase().includes(filterText.toLowerCase())
    );
    
    filtered.forEach(team => {
      const btn = document.createElement('button');
      btn.className = 'flex flex-col items-center justify-center p-3 rounded-lg border border-white/10 bg-slate-900/60 hover:bg-slate-800/80 transition-all cursor-pointer select-none';
      btn.style.borderColor = 'rgba(255, 255, 255, 0.08)';
      
      if (selectedTeamId === team.id) {
        btn.classList.add('border-purple-500', 'bg-purple-950/20');
        btn.style.borderColor = 'var(--color-brand-purple)';
      }

      btn.innerHTML = `
        <div class="w-9 h-9 rounded-full flex items-center justify-center bg-slate-950 p-1.5 border border-white/10 shadow-inner mb-2 select-none">
          <img class="w-full h-full object-contain" src="${getTeamLogoUrl(team.name)}" alt="${team.name}" />
        </div>
        <span class="text-[10px] font-bold uppercase tracking-wider text-slate-300 font-mono-tech select-none">${team.name}</span>
      `;
      
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        initAudio();
        
        teamGridContainer.querySelectorAll('button').forEach(b => {
          b.classList.remove('border-purple-500', 'bg-purple-950/20');
          b.style.borderColor = 'rgba(255, 255, 255, 0.08)';
        });
        
        btn.classList.add('border-purple-500', 'bg-purple-950/20');
        btn.style.borderColor = 'var(--color-brand-purple)';
        selectedTeamId = team.id;
      });
      
      teamGridContainer.appendChild(btn);
    });
  };

  if (teamSearchInput) {
    teamSearchInput.value = "";
    teamSearchInput.oninput = (e) => {
      renderGrid(e.target.value);
    };
  }

  renderGrid();
}

function renderDashboardGamesList() {
  if (!dashboardGamesList) return;
  dashboardGamesList.innerHTML = '';

  const gameCounts = WEEKLY_CHALLENGE_DATA.map((_, idx) => ({ abs: 0, pitches: 0, completedAbs: 0 }));
  weeklyPlaylistABs.forEach((ab, playlistIdx) => {
    if (ab.gameIndex !== undefined && gameCounts[ab.gameIndex]) {
      gameCounts[ab.gameIndex].abs++;
      gameCounts[ab.gameIndex].pitches += ab.pitches.length;
      if (playlistIdx < activeWeeklyAbIndex) {
        gameCounts[ab.gameIndex].completedAbs++;
      }
    }
  });

  WEEKLY_CHALLENGE_DATA.forEach((game, idx) => {
    const counts = gameCounts[idx] || { abs: 0, pitches: 0, completedAbs: 0 };
    const card = document.createElement('div');
    card.className = 'glass-panel p-2.5 rounded-lg border border-white/5 flex flex-col justify-between transition-all select-none';
    
    let rivalBadgeHtml = '';
    if (activeFavoriteTeam) {
      const parts = game.title.split(' vs. ');
      const awayTeam = parts[0];
      const homeTeam = parts[1];
      if (awayTeam === activeFavoriteTeam || homeTeam === activeFavoriteTeam) {
        rivalBadgeHtml = `<span class="absolute top-1.5 right-1.5 text-[8px] font-mono-tech px-1 py-0.2 bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded font-bold">RIVAL</span>`;
      }
    }

    card.style.position = 'relative';
    card.innerHTML = `
      ${rivalBadgeHtml}
      <div class="flex flex-col h-full justify-between">
        <div>
          <div class="flex justify-between items-center mb-0.5">
            <span class="text-[8px] font-mono-tech text-purple-400 font-bold uppercase tracking-wider">MATCH #${idx + 1}</span>
            <span class="text-[8px] text-gray-500 font-mono-tech uppercase font-bold">${counts.pitches} PITCHES</span>
          </div>
          <span class="text-[11px] font-black text-white uppercase tracking-wide leading-tight block">${game.title}</span>
          <p class="text-[8px] text-gray-400 font-mono-tech uppercase leading-tight mt-0.5">${game.description || 'Live Match Details'}</p>
        </div>
        <div class="mt-2 pt-1 border-t border-white/5 flex justify-between items-center text-[8px] font-mono-tech text-gray-500">
          <span>${counts.completedAbs} / ${counts.abs} ABs</span>
          <span class="text-purple-400 font-bold">INGESTED</span>
        </div>
      </div>
    `;

    dashboardGamesList.appendChild(card);
  });
}

function calculateScorecardRE24() {
  let netFavor = 0; // positive favors home, negative favors away
  let homeTeamName = "Home";
  let awayTeamName = "Away";
  
  if (gameMode === 'weekly_challenge') {
    const gameData = WEEKLY_CHALLENGE_DATA[activeGameIndex];
    if (gameData) {
      const parts = gameData.title.split(' vs. ');
      awayTeamName = parts[0] || "Away";
      homeTeamName = parts[1] || "Home";
    }
  } else if (gameMode === 'orioles_full') {
    awayTeamName = "Orioles";
    homeTeamName = "Tigers";
  }

  pitchHistory.forEach(item => {
    if (item.isSwingPlay) return;
    if (item.userCorrect) return;

    const isStrike = item.absCall === 'S';
    const userCalledStrike = item.userCall === 'S';
    
    let favorOffense = false;
    if (isStrike && !userCalledStrike) {
      favorOffense = true;
    } else if (!isStrike && userCalledStrike) {
      favorOffense = false;
    } else {
      return;
    }

    const isTop = item.pitchData ? item.pitchData.is_top : true;
    let teamFavored = "";
    if (favorOffense) {
      teamFavored = isTop ? "away" : "home";
    } else {
      teamFavored = isTop ? "home" : "away";
    }

    if (teamFavored === "home") {
      netFavor += 0.14;
    } else {
      netFavor -= 0.14;
    }
  });

  return {
    netFavor: Math.abs(netFavor),
    favoredTeam: netFavor > 0 ? homeTeamName : (netFavor < 0 ? awayTeamName : "Neither"),
    netFavorSigned: netFavor
  };
}

function drawScorecardSVGMatrix() {
  const container = document.getElementById('svg-pitches-container');
  if (!container) return;
  container.innerHTML = '';
  
  pitchHistory.forEach((item) => {
    if (item.isSwingPlay) return;
    
    const cross = item.trajectory ? item.trajectory.crossPoint : null;
    if (!cross) return;
    
    const x = cross.x;
    const y = 4.0 - cross.y;
    
    const isCorrect = item.userCorrect;
    const isStrikeABSVal = item.absCall === 'S';
    
    const fillColor = isCorrect ? '#22c55e' : '#ef4444';
    const strokeColor = isCorrect ? '#4ade80' : '#f87171';
    
    let element = null;
    const radius = 0.09;
    
    if (isStrikeABSVal) {
      const p1 = `${x},${y - radius}`;
      const p2 = `${x + radius},${y}`;
      const p3 = `${x},${y + radius}`;
      const p4 = `${x - radius},${y}`;
      element = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
      element.setAttribute("points", `${p1} ${p2} ${p3} ${p4}`);
    } else {
      element = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      element.setAttribute("cx", x);
      element.setAttribute("cy", y);
      element.setAttribute("r", radius);
    }
    
    element.setAttribute("fill", fillColor);
    element.setAttribute("stroke", strokeColor);
    element.setAttribute("stroke-width", "0.02");
    
    const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
    title.textContent = `Pitch #${item.pitchNum}: ${item.pitchType} (${item.speedMph} MPH) - ABS: ${item.absCall === 'S' ? 'STRIKE' : 'BALL'}, User: ${item.userCall === 'S' ? 'STRIKE' : 'BALL'} (${isCorrect ? 'Correct' : 'Missed'})`;
    element.appendChild(title);
    
    container.appendChild(element);
  });
}

// ==========================================================================
// UI LAYOUT MODES & DYNAMIC LOADING SERVICES
// ==========================================================================

function initUiModeSwitcher() {
  setUiMode('classic');
}

function setUiMode(mode) {
  activeUiMode = 'classic';
  localStorage.setItem('pitch_ump_ui_mode', 'classic');

  // Apply to body
  document.body.classList.remove('ui-mode-classic', 'ui-mode-adaptive', 'ui-mode-cinematic');
  document.body.classList.add('ui-mode-classic');

  // Trigger window resize to recalculate canvas layouts
  setTimeout(() => {
    const container = document.getElementById('canvas-container');
    if (container) {
      onResize(container.clientWidth, container.clientHeight);
    }
  }, 100);
}

const mlbPlayerIdCache = {};

async function fetchPlayerMlbId(playerName) {
  if (mlbPlayerIdCache[playerName]) {
    return mlbPlayerIdCache[playerName];
  }

  const savedId = localStorage.getItem(`mlb_player_id_${playerName}`);
  if (savedId) {
    mlbPlayerIdCache[playerName] = savedId;
    return savedId;
  }

  try {
    const url = `https://statsapi.mlb.com/api/v1/people/search?names=${encodeURIComponent(playerName)}`;
    const response = await fetch(url);
    const data = await response.json();
    if (data && data.people && data.people.length > 0) {
      const id = data.people[0].id;
      localStorage.setItem(`mlb_player_id_${playerName}`, id);
      mlbPlayerIdCache[playerName] = id;
      return id;
    }
  } catch (err) {
    console.error(`Error searching player ID for ${playerName}:`, err);
  }

  return 0;
}

const TEAM_LOGO_IDS = {
  'dbacks': 109, 'braves': 144, 'orioles': 110, 'red sox': 111, 'cubs': 112,
  'white sox': 145, 'reds': 113, 'guardians': 114, 'rockies': 115, 'tigers': 116,
  'astros': 117, 'royals': 118, 'angels': 108, 'dodgers': 119, 'marlins': 146,
  'brewers': 158, 'twins': 142, 'mets': 121, 'yankees': 147, 'athletics': 133,
  'phillies': 143, 'pirates': 134, 'padres': 135, 'giants': 137, 'mariners': 136,
  'cardinals': 138, 'rays': 139, 'rangers': 140, 'blue jays': 141, 'nationals': 120
};

function getTeamLogoUrl(teamName) {
  const normName = teamName.toLowerCase().replace('.', '').trim();
  for (const [key, value] of Object.entries(TEAM_LOGO_IDS)) {
    if (normName.includes(key) || key.includes(normName)) {
      return `https://www.mlbstatic.com/team-logos/${value}.svg`;
    }
  }
  return '/generic.svg';
}

async function updateMatchupCardImagesAndStats(pitch) {
  if (!pitch) return;
  const matchup = getMatchupNames(pitch);
  
  let titleText = "ACTIVE MATCHUP";
  let dateText = "MAY 25, 2026";
  
  if (gameMode === 'weekly_challenge') {
    const gameData = WEEKLY_CHALLENGE_DATA[activeGameIndex];
    if (gameData) {
      titleText = gameData.title;
      const desc = gameData.description || "";
      const dateMatch = desc.match(/([a-zA-Z]+\s+\d+,\s+\d+)/);
      if (dateMatch) dateText = dateMatch[1].toUpperCase();
    }
  } else if (gameMode === 'orioles_full') {
    titleText = "Orioles vs. Tigers";
  } else if (gameMode === 'daily_streak') {
    titleText = "Daily Streak Showdown";
    dateText = new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase();
  }
  
  if (matchupGameTitle) matchupGameTitle.textContent = titleText.toUpperCase();
  if (matchupGameDate) matchupGameDate.textContent = dateText;

  const pitcherId = await fetchPlayerMlbId(matchup.pitcher);
  const batterId = await fetchPlayerMlbId(matchup.batter);

  if (cardPitcherImg) {
    cardPitcherImg.src = pitcherId > 0 
      ? `https://midfield.mlbstatic.com/v1/people/${pitcherId}/spots/120` 
      : 'https://midfield.mlbstatic.com/v1/people/generic/spots/120';
  }
  if (cardBatterImg) {
    cardBatterImg.src = batterId > 0 
      ? `https://midfield.mlbstatic.com/v1/people/${batterId}/spots/120` 
      : 'https://midfield.mlbstatic.com/v1/people/generic/spots/120';
  }

  // Dynamic team logo lookup based on player names
  let pitcherTeam = getPlayerTeam(matchup.pitcher);
  let batterTeam = getPlayerTeam(matchup.batter);

  if (!pitcherTeam || !batterTeam) {
    const parts = titleText.split(' vs. ');
    const awayTeam = parts[0] || "Orioles";
    const homeTeam = parts[1] || "Tigers";
    if (!pitcherTeam) pitcherTeam = activeIsTop ? homeTeam : awayTeam;
    if (!batterTeam) batterTeam = activeIsTop ? awayTeam : homeTeam;
  }

  if (cardPitcherLogo) cardPitcherLogo.src = getTeamLogoUrl(pitcherTeam);
  if (cardBatterLogo) cardBatterLogo.src = getTeamLogoUrl(batterTeam);

  if (cardPitcherStats) {
    const isLHP = (pitch.pitcher_hand || "RHP") === "LHP";
    if (pitch.pitcher === "Corbin Burnes") cardPitcherStats.textContent = "ERA: 2.94 | SO: 200 | WHIP: 1.07";
    else if (pitch.pitcher === "Tarik Skubal") cardPitcherStats.textContent = "ERA: 2.58 | SO: 228 | WHIP: 0.95";
    else if (pitch.pitcher === "Gerrit Cole") cardPitcherStats.textContent = "ERA: 3.12 | SO: 180 | WHIP: 1.10";
    else if (pitch.pitcher === "Zack Wheeler") cardPitcherStats.textContent = "ERA: 2.70 | SO: 224 | WHIP: 0.96";
    else cardPitcherStats.textContent = `ERA: 3.24 | SO: 165 | WHIP: 1.12 (${isLHP ? 'LHP' : 'RHP'})`;
  }

  if (cardBatterStats) {
    if (pitch.batter === "Aaron Judge") cardBatterStats.textContent = "AVG: .322 | HR: 58 | OPS: 1.159";
    else if (pitch.batter === "Juan Soto") cardBatterStats.textContent = "AVG: .288 | HR: 41 | OPS: .989";
    else if (pitch.batter === "Gunnar Henderson") cardBatterStats.textContent = "AVG: .281 | HR: 37 | OPS: .893";
    else if (pitch.batter === "Shohei Ohtani") cardBatterStats.textContent = "AVG: .310 | HR: 54 | OPS: 1.036";
    else if (pitch.batter === "Francisco Lindor") cardBatterStats.textContent = "AVG: .273 | HR: 33 | OPS: .844";
    else cardBatterStats.textContent = `AVG: .268 | HR: 18 | OPS: .795 (${pitch.batter_hand || 'LHB'})`;
  }
}

function getAbSummaryZoneViewBox(szTop, szBot) {
  const xMin = -0.7083;
  const xMax = 0.7083;
  const padX = 0.2;
  const padTop = 0.18;
  const padBottom = 0.42;
  const x = xMin - padX;
  const y = 4.0 - szTop - padTop;
  const w = (xMax - xMin) + padX * 2;
  const h = (szTop - szBot) + padTop + padBottom;
  return `${x} ${y} ${w} ${h}`;
}

function formatCallShort(call) {
  if (call === 'S') return 'K';
  if (call === 'B') return 'B';
  if (call === 'TIMEOUT') return 'T';
  return '—';
}

function getAbSummaryPitchesViewBox(abPitches, szTop, szBot) {
  const zoneXMin = -0.7083;
  const zoneXMax = 0.7083;
  const zoneYMin = szBot;
  const zoneYMax = szTop;

  let xMin = zoneXMin;
  let xMax = zoneXMax;
  let yMin = zoneYMin;
  let yMax = zoneYMax;

  abPitches.forEach((p) => {
    const cross = p?.trajectory?.crossPoint;
    if (!cross) return;
    xMin = Math.min(xMin, cross.x);
    xMax = Math.max(xMax, cross.x);
    yMin = Math.min(yMin, cross.y);
    yMax = Math.max(yMax, cross.y);
  });

  // pad and keep a little room for the plate + label pill
  const padX = 0.22;
  const padTop = 0.22;
  const padBottom = 0.6;
  const x = xMin - padX;
  const y = 4.0 - yMax - padTop;
  const w = (xMax - xMin) + padX * 2;
  const h = (yMax - yMin) + padTop + padBottom;
  return `${x} ${y} ${w} ${h}`;
}

function renderAbSummaryCallBoard(abPitches) {
  const youEl = document.getElementById('ab-summary-you-calls');
  const umpEl = document.getElementById('ab-summary-ump-calls');
  const youAccEl = document.getElementById('ab-summary-you-acc-mini');
  const umpAccEl = document.getElementById('ab-summary-ump-acc-mini');
  const umpAccuracyEl = document.getElementById('ab-summary-ump-accuracy');
  if (!youEl || !umpEl) return;

  const n = abPitches.length;
  const youCorrect = abPitches.filter((p) => p.userCorrect).length;
  const umpCorrect = abPitches.filter((p) => p.realCorrect).length;
  const youAcc = n > 0 ? Math.round((youCorrect / n) * 100) : 100;
  const umpAcc = n > 0 ? Math.round((umpCorrect / n) * 100) : 100;

  youEl.textContent = `${youCorrect}/${n}`;
  umpEl.textContent = `${umpCorrect}/${n}`;
  if (youAccEl) youAccEl.textContent = `${youAcc}%`;
  if (umpAccEl) umpAccEl.textContent = `${umpAcc}%`;
  if (umpAccuracyEl) umpAccuracyEl.textContent = n > 0 ? `${umpAcc}%` : '—';
}

function getAbSummaryPitchStats(item) {
  const pitch = item.pitchData || item;
  const traj = item.trajectory;
  const typeMap = {
    FF: 'Four-Seam', SL: 'Slider', CU: 'Curveball', KC: 'Knuckle Curve',
    CH: 'Changeup', FC: 'Cutter', SI: 'Sinker', FS: 'Splitter', ST: 'Sweeper', SV: 'Slurve',
  };
  const rawType = item.pitchType || pitch.pitch_type || 'Pitch';
  const pitchType = typeMap[rawType] || rawType;
  const mph = item.speedMph != null ? item.speedMph : pitch.speed_mph;
  const tCross = traj ? traj.t_cross : 0.4;
  const hBreakVal = 0.5 * (pitch.ax || 0) * Math.pow(tCross, 2) * 12;
  const vBreakVal = 0.5 * ((pitch.az || 0) + 32.17) * Math.pow(tCross, 2) * 12;
  const hSign = hBreakVal >= 0 ? '+' : '';
  const vSign = vBreakVal >= 0 ? '+' : '';
  let distanceText = '—';
  if (traj && traj.crossPoint) {
    const distFeet = getDistanceToABSZone(traj.crossPoint.x, traj.crossPoint.y);
    const distIn = distFeet * 12;
    const xMin = -0.7083;
    const xMax = 0.7083;
    const yMin = pitch.sz_bot ?? pitch.szBot ?? 1.6;
    const yMax = pitch.sz_top ?? pitch.szTop ?? 3.4;
    const inside = traj.crossPoint.x >= xMin && traj.crossPoint.x <= xMax
      && traj.crossPoint.y >= yMin && traj.crossPoint.y <= yMax;
    distanceText = `${distIn.toFixed(1)}" ${inside ? 'inside' : 'outside'}`;
  }
  return {
    pitchType,
    mph: mph != null ? `${Number(mph).toFixed(1)} mph` : '—',
    break: `H ${hSign}${hBreakVal.toFixed(1)}" · V ${vSign}${vBreakVal.toFixed(1)}"`,
    distanceText,
  };
}

const AB_SUMMARY_COLORS = {
  ok: '#5cdb95',
  okStroke: '#7ef0b0',
  miss: '#e05555',
  missStroke: '#f08080',
  zoneStroke: '#f4ecd8',
  zoneFill: 'rgba(244, 236, 216, 0.06)',
  distLine: '#e8c547',
};

function updateAbSummaryZoneDistance(item) {
  const el = document.getElementById('ab-summary-zone-distance');
  if (!el) return;
  if (!item) {
    el.classList.add('hidden');
    el.textContent = '';
    return;
  }
  const stats = getAbSummaryPitchStats(item);
  el.textContent = stats.distanceText.toUpperCase();
  el.classList.remove('hidden');
}

function clearAbSummaryPitchSelection() {
  abSummarySelectedPitchIndex = null;
  highlightSummaryPitch(-1);
  if (abSummaryPitchDetails) {
    abSummaryPitchDetails.innerHTML = '<p class="ab-summary-pitch-detail-placeholder">TAP A PITCH FOR DETAILS</p>';
  }
  if (abSummaryPitchList) {
    abSummaryPitchList.querySelectorAll('.ab-summary-pitch-row').forEach((row) => {
      row.classList.remove('is-selected', 'is-dimmed');
    });
  }
  syncAbSummarySvgPitchMarkers(null);
  const abSummarySvgIndicators = document.getElementById('ab-summary-svg-indicators');
  if (abSummarySvgIndicators) abSummarySvgIndicators.innerHTML = '';
  updateAbSummaryZoneDistance(null);
}

function syncAbSummarySvgPitchMarkers(selectedIndex) {
  if (!abSummarySvgPitches) return;
  const abPitches = pitchHistory.slice(currentAbStartHistoryIndex).filter((p) => !p.isSwingPlay);
  const markers = abSummarySvgPitches.querySelectorAll('.ab-summary-pitch-marker');
  markers.forEach((group) => {
    const idx = parseInt(group.getAttribute('data-pitch-index'), 10);
    const isSelected = selectedIndex != null && idx === selectedIndex;
    const hasSelection = selectedIndex != null;
    group.classList.toggle('is-selected', isSelected);
    group.classList.toggle('is-dimmed', hasSelection && !isSelected);
    group.removeAttribute('transform');
    const shape = group.querySelector('polygon, circle');
    if (shape) {
      const item = abPitches[idx];
      const strokeColor = item?.userCorrect ? AB_SUMMARY_COLORS.okStroke : AB_SUMMARY_COLORS.missStroke;
      const cx = parseFloat(group.getAttribute('data-cx') || '0');
      const cy = parseFloat(group.getAttribute('data-cy') || '0');
      const baseR = parseFloat(group.getAttribute('data-radius') || '0.085');
      const r = isSelected ? baseR * 1.2 : baseR;
      shape.setAttribute('stroke', isSelected ? AB_SUMMARY_COLORS.distLine : strokeColor);
      shape.setAttribute('stroke-width', isSelected ? '0.04' : '0.028');
      if (shape.tagName === 'circle') {
        shape.setAttribute('r', String(r));
      } else {
        const p1 = `${cx},${cy - r}`;
        const p2 = `${cx + r},${cy}`;
        const p3 = `${cx},${cy + r}`;
        const p4 = `${cx - r},${cy}`;
        shape.setAttribute('points', `${p1} ${p2} ${p3} ${p4}`);
      }
    }
  });
}

function drawAbSummaryPitchIndicators(item, szTop, szBot) {
  const abSummarySvgIndicators = document.getElementById('ab-summary-svg-indicators');
  if (!abSummarySvgIndicators || !item?.trajectory?.crossPoint) return;
  abSummarySvgIndicators.innerHTML = '';
  const cross = item.trajectory.crossPoint;
  const px = cross.x;
  const py = cross.y;
  const xMin = -0.7083;
  const xMax = 0.7083;
  const yMin = szBot;
  const yMax = szTop;
  const insideX = px >= xMin && px <= xMax;
  const insideY = py >= yMin && py <= yMax;
  const isIn = insideX && insideY;
  let cx = px;
  let cy = py;
  let distFeet = 0;
  if (isIn) {
    const dLeft = px - xMin;
    const dRight = xMax - px;
    const dBottom = py - yMin;
    const dTop = yMax - py;
    distFeet = Math.min(dLeft, dRight, dBottom, dTop);
    if (distFeet === dLeft) cx = xMin;
    else if (distFeet === dRight) cx = xMax;
    else if (distFeet === dBottom) cy = yMin;
    else cy = yMax;
  } else {
    cx = Math.max(xMin, Math.min(px, xMax));
    cy = Math.max(yMin, Math.min(py, yMax));
    distFeet = Math.hypot(px - cx, py - cy);
  }
  const distInches = distFeet * 12;

  // Only draw the "ruler" when OUTSIDE. When inside, the pill already tells you "inside"
  // and a line visually cuts through the zone (confusing).
  if (!isIn) {
    const pxSvg = px;
    const pySvg = 4.0 - py;
    const cxSvg = cx;
    const cySvg = 4.0 - cy;

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', cxSvg);
    line.setAttribute('y1', cySvg);
    line.setAttribute('x2', pxSvg);
    line.setAttribute('y2', pySvg);
    line.setAttribute('stroke', AB_SUMMARY_COLORS.distLine);
    line.setAttribute('stroke-width', '0.03');
    line.setAttribute('stroke-dasharray', '0.055,0.04');
    line.setAttribute('opacity', '0.95');
    abSummarySvgIndicators.appendChild(line);

    const edgeDot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    edgeDot.setAttribute('cx', cxSvg);
    edgeDot.setAttribute('cy', cySvg);
    edgeDot.setAttribute('r', '0.055');
    edgeDot.setAttribute('fill', 'rgba(232, 197, 71, 0.35)');
    edgeDot.setAttribute('stroke', AB_SUMMARY_COLORS.distLine);
    edgeDot.setAttribute('stroke-width', '0.02');
    abSummarySvgIndicators.appendChild(edgeDot);
  }
}

function renderAbSummaryPitchFocus(index, item) {
  if (!abSummaryPitchDetails || !item) return;

  const isCorrect = item.userCorrect;
  const youCall = formatCallShort(item.userCall);
  const absCall = formatCallShort(item.absCall);
  const umpCall = formatCallShort(item.realCall);
  const stats = getAbSummaryPitchStats(item);
  const verdictClass = isCorrect ? 'ab-summary-pitch-detail-verdict--ok' : 'ab-summary-pitch-detail-verdict--miss';
  const umpMatchAbs = item.realCall === item.absCall;

  abSummaryPitchDetails.innerHTML = `
    <div class="ab-summary-pitch-detail-inner">
      <span class="ab-summary-pitch-detail-pill">P${index + 1}</span>
      <span>${stats.pitchType} · ${stats.mph}</span>
      <span class="ab-summary-pitch-detail-calls">YOU <strong>${youCall}</strong> · ABS <strong>${absCall}</strong> · UMP <strong>${umpCall}</strong></span>
      <span class="ab-summary-pitch-detail-verdict ${verdictClass}">${isCorrect ? 'OK' : 'MISS'}</span>
      <span class="ab-summary-pitch-detail-ump ${umpMatchAbs ? 'ab-summary-pitch-detail-ump--match' : 'ab-summary-pitch-detail-ump--diff'}">UMP ${umpMatchAbs ? '= ABS' : '≠ ABS'}</span>
      <span class="ab-summary-pitch-detail-dist">${stats.distanceText}</span>
    </div>
  `;
}

function drawAbSummarySVGMatrix() {
  if (!abSummarySvgPitches) return;
  abSummarySvgPitches.innerHTML = '';

  const abSummarySvgZone = document.getElementById('ab-summary-svg-zone');
  const abSummarySvgIndicators = document.getElementById('ab-summary-svg-indicators');
  const abSummaryMatrixSvg = document.getElementById('ab-summary-matrix-svg');

  if (abSummarySvgZone) abSummarySvgZone.innerHTML = '';
  if (abSummarySvgIndicators) abSummarySvgIndicators.innerHTML = '';

  if (abSummaryPitchDetails) {
    abSummaryPitchDetails.innerHTML = '<p class="ab-summary-pitch-detail-placeholder">TAP A PITCH FOR DETAILS</p>';
  }
  updateAbSummaryZoneDistance(null);

  const abPitches = pitchHistory.slice(currentAbStartHistoryIndex).filter(p => !p.isSwingPlay);
  if (abPitches.length === 0) return;

  const firstPitch = abPitches[0];
  const pData = firstPitch.pitchData || firstPitch;
  const szTop = pData.sz_top !== undefined ? pData.sz_top : (pData.szTop !== undefined ? pData.szTop : 3.4);
  const szBot = pData.sz_bot !== undefined ? pData.sz_bot : (pData.szBot !== undefined ? pData.szBot : 1.6);

  if (abSummaryMatrixSvg) {
    // Auto-fit to all pitches in this AB so balls far outside remain visible/selectable.
    abSummaryMatrixSvg.setAttribute('viewBox', getAbSummaryPitchesViewBox(abPitches, szTop, szBot));
  }

  if (abSummarySvgZone) {
    const stdZone = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    stdZone.setAttribute('x', -0.7083);
    stdZone.setAttribute('y', 4.0 - szTop);
    stdZone.setAttribute('width', 1.4166);
    stdZone.setAttribute('height', szTop - szBot);
    stdZone.setAttribute('fill', AB_SUMMARY_COLORS.zoneFill);
    stdZone.setAttribute('stroke', AB_SUMMARY_COLORS.zoneStroke);
    stdZone.setAttribute('stroke-width', '0.024');
    stdZone.setAttribute('stroke-dasharray', '0.07,0.05');
    stdZone.setAttribute('class', 'ab-summary-zone-rulebook');
    abSummarySvgZone.appendChild(stdZone);

    const plate = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    const plateY = 4.0 - szBot + 0.55;
    plate.setAttribute('points', '-0.35,' + plateY + ' 0,' + (plateY + 0.18) + ' 0.35,' + plateY);
    plate.setAttribute('fill', 'rgba(244, 236, 216, 0.15)');
    plate.setAttribute('stroke', 'rgba(244, 236, 216, 0.45)');
    plate.setAttribute('stroke-width', '0.02');
    abSummarySvgZone.appendChild(plate);
  }

  abPitches.forEach((item, index) => {
    const cross = item.trajectory ? item.trajectory.crossPoint : null;
    if (!cross) return;
    
    const x = cross.x;
    const y = 4.0 - cross.y;
    
    const isCorrect = item.userCorrect;
    const isStrikeABSVal = item.absCall === 'S';
    
    const fillColor = isCorrect ? AB_SUMMARY_COLORS.ok : AB_SUMMARY_COLORS.miss;
    const strokeColor = isCorrect ? AB_SUMMARY_COLORS.okStroke : AB_SUMMARY_COLORS.missStroke;

    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    group.setAttribute('class', 'ab-summary-pitch-marker');
    group.setAttribute('data-pitch-index', String(index));
    group.setAttribute('data-cx', String(x));
    group.setAttribute('data-cy', String(y));
    group.setAttribute('data-radius', '0.085');
    group.style.pointerEvents = 'auto';

    const radius = 0.085;
    let shape = null;

    if (isStrikeABSVal) {
      const p1 = `${x},${y - radius}`;
      const p2 = `${x + radius},${y}`;
      const p3 = `${x},${y + radius}`;
      const p4 = `${x - radius},${y}`;
      shape = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      shape.setAttribute('points', `${p1} ${p2} ${p3} ${p4}`);
    } else {
      shape = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      shape.setAttribute('cx', x);
      shape.setAttribute('cy', y);
      shape.setAttribute('r', radius);
    }

    shape.setAttribute('fill', fillColor);
    shape.setAttribute('stroke', strokeColor);
    shape.setAttribute('stroke-width', '0.03');
    group.appendChild(shape);

    group.addEventListener('click', (e) => {
      e.stopPropagation();
      initAudio();
      if (abSummarySelectedPitchIndex === index) {
        clearAbSummaryPitchSelection();
      } else {
        highlightPitchInSummary(index);
      }
    });

    const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    title.textContent = `Pitch ${index + 1}: ${item.pitchType || 'Pitch'} (${item.speedMph != null ? Math.round(item.speedMph) : '—'} mph) — You: ${item.userCall === 'S' ? 'Strike' : 'Ball'}, ABS: ${item.absCall === 'S' ? 'Strike' : 'Ball'}`;
    group.appendChild(title);

    abSummarySvgPitches.appendChild(group);
  });
}

function highlightPitchInSummary(index) {
  const abPitches = pitchHistory.slice(currentAbStartHistoryIndex).filter(p => !p.isSwingPlay);
  const item = abPitches[index];
  if (!item) return;

  abSummarySelectedPitchIndex = index;
  highlightSummaryPitch(index);

  const pData = item.pitchData || item;
  const szTop = pData.sz_top !== undefined ? pData.sz_top : (pData.szTop !== undefined ? pData.szTop : 3.4);
  const szBot = pData.sz_bot !== undefined ? pData.sz_bot : (pData.szBot !== undefined ? pData.szBot : 1.6);

  renderAbSummaryPitchFocus(index, item);

  if (abSummaryPitchList) {
    const rows = abSummaryPitchList.querySelectorAll('.ab-summary-pitch-row');
    rows.forEach((row, rowIdx) => {
      const isSel = rowIdx === index;
      row.classList.toggle('is-selected', isSel);
      row.classList.toggle('is-dimmed', !isSel);
    });
    const selectedRow = rows[index];
    if (selectedRow) {
      selectedRow.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  syncAbSummarySvgPitchMarkers(index);
  drawAbSummaryPitchIndicators(item, szTop, szBot);
  updateAbSummaryZoneDistance(item);
}

async function submitGlobalScore(type, name, team, accuracy, scoreValue, rawScore) {
  if (!name || name.toUpperCase() === 'YOU' || name.toUpperCase() === 'GUEST' || name.trim() === '') return;
  const board = type === 'streak' ? 'daily' : type;
  try {
    await apiSubmitLeaderboard({
      board,
      team: team || 'None',
      accuracy,
      scoreText: scoreValue,
      scoreRaw: rawScore,
    });
  } catch (err) {
    console.warn('Failed to sync score to global leaderboard:', err);
  }
}

async function renderLeaderboard(type) {
  if (!leaderboardTableBody || !leaderboardDivisionTitle) return;
  
  const buttons = [
    { btn: leaderBtnWeekly, name: 'weekly' },
    { btn: leaderBtnDaily, name: 'daily' },
    { btn: leaderBtnAlltime, name: 'alltime' }
  ];
  
  buttons.forEach(b => {
    if (b.btn) {
      if (b.name === type) {
        b.btn.classList.replace('bg-gray-800', 'bg-purple-600');
        b.btn.classList.replace('text-gray-400', 'text-white');
      } else {
        b.btn.classList.replace('bg-purple-600', 'bg-gray-800');
        b.btn.classList.replace('text-white', 'text-gray-400');
        b.btn.classList.add('hover:text-white');
      }
    }
  });

  let divisionTitle = "Umpire Crew Standings";
  if (type === 'weekly') {
    divisionTitle = "Weekly Challenge Standings";
  } else if (type === 'daily') {
    divisionTitle = "Daily Streak Challenge Standings";
  } else if (type === 'alltime') {
    divisionTitle = "Team Mastery Standings (Daily Compete)";
  }
  leaderboardDivisionTitle.textContent = divisionTitle.toUpperCase();

  const activeHandle = localStorage.getItem('ump_username') || "YOU";

  // Rewrite table headers dynamically
  const table = leaderboardTableBody.closest('table');
  const thead = table ? table.querySelector('thead') : null;
  if (thead) {
    if (type === 'weekly') {
      thead.innerHTML = `
        <tr class="bg-white/5 border-b border-white/10 font-mono-tech text-[10px] text-gray-400 uppercase tracking-widest">
          <th class="p-3">Rank</th>
          <th class="p-3">Crew Chief</th>
          <th class="p-3 text-center">Accuracy</th>
          <th class="p-3 text-center">Score</th>
        </tr>
      `;
    } else if (type === 'daily') {
      thead.innerHTML = `
        <tr class="bg-white/5 border-b border-white/10 font-mono-tech text-[10px] text-gray-400 uppercase tracking-widest">
          <th class="p-3">Rank</th>
          <th class="p-3">Crew Chief</th>
          <th class="p-3 text-center">Accuracy</th>
          <th class="p-3 text-center">Best Streak</th>
        </tr>
      `;
    } else if (type === 'alltime') {
      thead.innerHTML = `
        <tr class="bg-white/5 border-b border-white/10 font-mono-tech text-[10px] text-gray-400 uppercase tracking-widest">
          <th class="p-3">Rank</th>
          <th class="p-3">Crew Chief</th>
          <th class="p-3">Teams Completed</th>
          <th class="p-3 text-center">Avg Accuracy</th>
          <th class="p-3 text-center">Mastery Score</th>
        </tr>
      `;
    }
  }

  // Display loading
  leaderboardTableBody.innerHTML = `
    <tr>
      <td colspan="${type === 'alltime' ? 5 : 4}" class="p-6 text-center text-purple-400 font-mono-tech text-[10px] animate-pulse">
        LOADING GLOBAL STANDINGS...
      </td>
    </tr>
  `;

  let rows = [];
  let source = 'empty';
  try {
    const result = await getLeaderboardRows(type, activeHandle);
    rows = result.rows;
    source = result.source;
  } catch (err) {
    console.warn("Error loading leaderboard:", err);
    source = 'offline';
  }

  leaderboardTableBody.innerHTML = '';
  rows.forEach(r => {
    const tr = document.createElement('tr');
    tr.className = `border-b border-white/5 font-mono-tech text-[11px] ${r.isUser ? 'bg-purple-950/20 text-purple-300 font-bold border-l-2 border-purple-500' : 'text-gray-300'}`;
    
    let rankHtml = `#${r.rank}`;
    if (r.rank === 1) rankHtml = `<span class="text-yellow-400 font-black">🥇 #1</span>`;
    else if (r.rank === 2) rankHtml = `<span class="text-gray-400 font-black">🥈 #2</span>`;
    else if (r.rank === 3) rankHtml = `<span class="text-amber-600 font-black">🥉 #3</span>`;

    let rowContent = "";
    if (type === 'weekly' || type === 'daily') {
      rowContent = `
        <td class="p-3">${rankHtml}</td>
        <td class="p-3 uppercase tracking-wider">${r.name}</td>
        <td class="p-3 text-center text-emerald-400">${r.accuracy}</td>
        <td class="p-3 text-center font-bold ${type === 'daily' ? 'text-amber-400' : ''}">${r.score}</td>
      `;
    } else {
      // type === 'alltime' (Mastery Standings)
      let teamsHtml = '<span class="text-gray-500 font-bold">NONE</span>';
      if (r.team && r.team !== 'None' && r.team !== 'none') {
        const teams = r.team.split(',').map(t => t.trim());
        teamsHtml = `<div class="flex flex-wrap gap-1">` + teams.map(t => {
          return `<span class="px-1.5 py-0.2 bg-purple-500/20 text-purple-400 border border-purple-500/30 rounded text-[9px] uppercase font-mono-tech font-bold">${t.slice(0, 3)}</span>`;
        }).join('') + `</div>`;
      }
      rowContent = `
        <td class="p-3">${rankHtml}</td>
        <td class="p-3 uppercase tracking-wider">${r.name}</td>
        <td class="p-3">${teamsHtml}</td>
        <td class="p-3 text-center text-emerald-400">${r.accuracy}</td>
        <td class="p-3 text-center font-bold text-purple-400">${r.score}</td>
      `;
    }

    tr.innerHTML = rowContent;
    leaderboardTableBody.appendChild(tr);
  });

  if (rows.length === 0) {
    const note = document.createElement('tr');
    const msg =
      source === 'offline'
        ? 'Could not load standings — check connection or deploy API routes'
        : 'No scores yet — complete a challenge to appear on the board';
    note.innerHTML = `
      <td colspan="${type === 'alltime' ? 5 : 4}" class="p-4 text-center text-[9px] font-mono-tech text-gray-500 uppercase tracking-wider">
        ${msg}
      </td>
    `;
    leaderboardTableBody.appendChild(note);
  }
}

function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function mulberry32(a) {
  return function() {
    let t = a += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}

function generateDailyCondensedGame(teamName, dateString) {
  const seed = hashString(teamName + dateString);
  const rand = mulberry32(seed);
  
  // Find opponent
  const oppTeams = TEAMS_LIST.filter(t => t.name !== teamName);
  const oppIdx = Math.floor(rand() * oppTeams.length);
  const opponent = oppTeams[oppIdx];
  
  // Choose home/away randomly
  const isHome = rand() < 0.5;
  const awayTeam = isHome ? opponent.name : teamName;
  const homeTeam = isHome ? teamName : opponent.name;
  
  const teamPlayers = {
    'Orioles': ["Gunnar Henderson", "Adley Rutschman", "Colton Cowser", "Anthony Santander", "Ryan Mountcastle", "Jordan Westburg"],
    'Tigers': ["Riley Greene", "Kerry Carpenter", "Mark Canha", "Colt Keith", "Gio Urshela", "Jake Rogers"],
    'Phillies': ["Bryce Harper", "Trea Turner", "Kyle Schwarber", "Alec Bohm", "Bryson Stott", "Nick Castellanos"],
    'Mets': ["Francisco Lindor", "Pete Alonso", "Brandon Nimmo", "Jeff McNeil", "Starling Marte", "Francisco Alvarez"],
    'Dodgers': ["Shohei Ohtani", "Mookie Betts", "Freddie Freeman", "Teoscar Hernández", "Max Muncy", "Will Smith"],
    'Yankees': ["Aaron Judge", "Juan Soto", "Giancarlo Stanton", "Anthony Volpe", "Anthony Rizzo", "Gleyber Torres"],
    'Red Sox': ["Rafael Devers", "Jarren Duran", "Tyler O'Neill", "Masataka Yoshida", "Connor Wong", "Ceddanne Rafaela"],
    'Astros': ["Jose Altuve", "Yordan Alvarez", "Alex Bregman", "Kyle Tucker", "Jeremy Peña", "Yainer Diaz"],
    'Rangers': ["Corey Seager", "Marcus Semien", "Adolis García", "Jonah Heim", "Wyatt Langford", "Josh Jung"],
    'Giants': ["Matt Chapman", "Jung Hoo Lee", "LaMonte Wade Jr.", "Jorge Soler", "Thairo Estrada", "Patrick Bailey"]
  };
  
  const getPlayersForTeam = (t) => {
    return teamPlayers[t] || [`Player A (${t})`, `Player B (${t})`, `Player C (${t})`, `Player D (${t})`, `Player E (${t})`, `Player F (${t})`];
  };
  
  const awayBatters = getPlayersForTeam(awayTeam);
  const homeBatters = getPlayersForTeam(homeTeam);
  
  const teamPitchers = {
    'Orioles': ["Corbin Burnes", "Grayson Rodriguez"],
    'Tigers': ["Tarik Skubal", "Jack Flaherty"],
    'Phillies': ["Zack Wheeler", "Aaron Nola"],
    'Mets': ["Kodai Senga", "Luis Severino"],
    'Dodgers': ["Yoshinobu Yamamoto", "Tyler Glasnow"],
    'Yankees': ["Gerrit Cole", "Marcus Stroman"],
    'Red Sox': ["Nick Pivetta", "Brayan Bello"],
    'Astros': ["Framber Valdez", "Justin Verlander"],
    'Rangers': ["Nathan Eovaldi", "Jon Gray"],
    'Giants': ["Logan Webb", "Kyle Harrison"]
  };
  
  const getPitcherForTeam = (t) => {
    const list = teamPitchers[t] || [`Pitcher X (${t})`, `Pitcher Y (${t})`];
    return list[Math.floor(rand() * list.length)];
  };
  
  const awayPitcher = getPitcherForTeam(awayTeam);
  const homePitcher = getPitcherForTeam(homeTeam);
  
  const abList = [];
  for (let abIdx = 0; abIdx < 15; abIdx++) {
    const inning = Math.floor(abIdx / 2) + 1;
    const isTop = abIdx % 2 === 0;
    const battingTeam = isTop ? awayTeam : homeTeam;
    const pitchingTeam = isTop ? homeTeam : awayTeam;
    
    const batterList = isTop ? awayBatters : homeBatters;
    const batterName = batterList[abIdx % batterList.length];
    const pitcherName = isTop ? homePitcher : awayPitcher;
    
    const pitches = [];
    const numPitches = Math.floor(rand() * 4) + 1;
    for (let pIdx = 0; pIdx < numPitches; pIdx++) {
      const pitchTypes = ["Fastball", "Slider", "Changeup", "Curveball", "Sinker", "Cutter"];
      const pitchType = pitchTypes[Math.floor(rand() * pitchTypes.length)];
      const speed = Math.floor(rand() * 20) + 80;
      
      const isBorderline = rand() < 0.5;
      let crossX = 0;
      let crossY = 2.5;
      const szTop = 3.4;
      const szBot = 1.6;
      
      if (isBorderline) {
        const borderType = Math.floor(rand() * 4);
        if (borderType === 0) {
          crossX = -0.8283 + (rand() * 0.2 - 0.1);
          crossY = szBot + (rand() * 1.5);
        } else if (borderType === 1) {
          crossX = 0.8283 + (rand() * 0.2 - 0.1);
          crossY = szBot + (rand() * 1.5);
        } else if (borderType === 2) {
          crossX = -0.8 + (rand() * 1.6);
          crossY = szBot - 0.12 + (rand() * 0.2 - 0.1);
        } else {
          crossX = -0.8 + (rand() * 1.6);
          crossY = szTop + 0.12 + (rand() * 0.2 - 0.1);
        }
      } else {
        const isStrike = rand() < 0.5;
        if (isStrike) {
          crossX = -0.6 + (rand() * 1.2);
          crossY = szBot + 0.2 + (rand() * 1.4);
        } else {
          crossX = rand() < 0.5 ? -1.3 - (rand() * 0.5) : 1.3 + (rand() * 0.5);
          crossY = rand() < 0.5 ? szBot - 0.5 - (rand() * 0.5) : szTop + 0.5 + (rand() * 0.5);
        }
      }
      
      const isStrikeAbs = Math.abs(crossX) <= 0.8283 && crossY >= (szBot - 0.12) && crossY <= (szTop + 0.12);
      const absCall = isStrikeAbs ? "S" : "B";
      const realCall = absCall;
      
      const isLastPitch = pIdx === numPitches - 1;
      let isSwing = false;
      let swingOutcome = null;
      let swingHitType = null;
      
      if (isLastPitch) {
        const outcomeRoll = rand();
        if (outcomeRoll < 0.3) {
          isSwing = true;
          swingOutcome = "HIT";
          swingHitType = rand() < 0.15 ? "HOMERUN" : (rand() < 0.3 ? "DOUBLE" : "SINGLE");
        } else if (outcomeRoll < 0.6) {
          isSwing = true;
          swingOutcome = "OUT";
          swingHitType = rand() < 0.5 ? "FLYOUT" : "GROUNDOUT";
        } else if (outcomeRoll < 0.8) {
          isSwing = true;
          swingOutcome = "WHIFF";
        }
      }
      
      const pitchObj = {
        id: 20000 + abIdx * 10 + pIdx,
        inning,
        is_top: isTop,
        pitcher: pitcherName,
        pitcher_hand: rand() < 0.75 ? "RHP" : "LHP",
        batter: batterName,
        batter_hand: rand() < 0.6 ? "RHB" : "LHB",
        pitch_type: pitchType,
        speed_mph: speed,
        release_pos_x: isTop ? 1.7 : -1.7,
        release_pos_y: 50.5,
        release_pos_z: 6.0,
        vx0: isTop ? -crossX * 0.1 : crossX * 0.1,
        vy0: -130.0,
        vz0: -5.0,
        ax: 2.0,
        ay: 25.0,
        az: -20.0,
        sz_top: szTop,
        sz_bot: szBot,
        real_ump_call: realCall,
        abs_call: absCall,
        is_critical: isBorderline,
        historical_blurb: `${pitcherName} throws a ${speed} MPH ${pitchType}. ${batterName} ${isSwing ? (swingOutcome === 'HIT' ? 'hits a line drive ' + swingHitType : (swingOutcome === 'WHIFF' ? 'swings and misses' : 'hits a routine ' + swingHitType)) : 'takes it for a called ' + (absCall === 'S' ? 'STRIKE' : 'BALL')}.`,
        is_swing: isSwing,
        swing_outcome: swingOutcome,
        swing_hit_type: swingHitType
      };
      
      pitches.push(pitchObj);
    }
    
    abList.push({
      gameIndex: abIdx,
      gameTitle: `${awayTeam.toUpperCase()} @ ${homeTeam.toUpperCase()}`,
      filmRoomUrl: "https://www.mlb.com",
      umpScorecardUrl: "https://umpscorecards.com",
      pitches,
      batter: batterName,
      pitcher: isTop ? homePitcher : awayPitcher
    });
  }
  
  return abList;
}

function renderDailyCompeteDashboard() {
  const username = localStorage.getItem('ump_username');
  if (!username) {
    if (dailyMatchupTitle) dailyMatchupTitle.textContent = "LOGIN TO PLAY";
    if (dailyCompeteStatus) {
      dailyCompeteStatus.textContent = "AUTHENTICATION REQUIRED";
      dailyCompeteStatus.className = "text-[9px] font-bold text-red-400 uppercase mt-0.5";
    }
    if (btnPlayDailyCompete) btnPlayDailyCompete.disabled = true;
    if (dailyHistoricList) dailyHistoricList.innerHTML = `<div class="text-[10px] text-gray-500 text-center py-4">PLEASE LOG IN TO VIEW ARCHIVES</div>`;
    return;
  }
  
  if (btnPlayDailyCompete) btnPlayDailyCompete.disabled = false;

  // Populate team dropdown if not already populated
  if (dailyCompeteTeamSelect && dailyCompeteTeamSelect.children.length === 0) {
    TEAMS_LIST.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.name;
      opt.textContent = t.name.toUpperCase();
      dailyCompeteTeamSelect.appendChild(opt);
    });
    if (activeFavoriteTeam) {
      dailyCompeteTeamSelect.value = activeFavoriteTeam;
    } else {
      dailyCompeteTeamSelect.value = "Orioles";
    }
    dailyCompeteTeamSelect.onchange = () => {
      renderDailyCompeteDashboard();
    };
  }
  
  const team = dailyCompeteTeamSelect ? dailyCompeteTeamSelect.value : (activeFavoriteTeam || "Orioles");
  const todayStr = new Date().toISOString().split('T')[0];
  
  if (dailyMatchupTitle) {
    dailyMatchupTitle.textContent = `${team.toUpperCase()} DAILY GAME`;
  }
  
  getGlobalUserStats(username).then(stats => {
    const dailyHistory = stats.dailyHistory || {};
    const todayResult = dailyHistory[`${team}_${todayStr}`];
    
    if (dailyCompeteStatus) {
      if (todayResult !== undefined) {
        dailyCompeteStatus.textContent = `COMPLETED - ${todayResult}% ACCURACY`;
        dailyCompeteStatus.className = "text-[9px] font-bold text-emerald-400 uppercase mt-0.5";
        if (btnPlayDailyCompete) btnPlayDailyCompete.textContent = "Replay Daily";
      } else {
        dailyCompeteStatus.textContent = "UNPLAYED (Available)";
        dailyCompeteStatus.className = "text-[9px] font-bold text-yellow-400 uppercase mt-0.5";
        if (btnPlayDailyCompete) btnPlayDailyCompete.textContent = "Play Now";
      }
    }
    
    if (dailyHistoricList) {
      dailyHistoricList.innerHTML = "";
      const startDate = new Date("2026-04-01T00:00:00");
      const endDate = new Date();
      
      const dates = [];
      for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
        dates.push(d.toISOString().split('T')[0]);
      }
      dates.reverse();
      
      dates.forEach(dStr => {
        const result = dailyHistory[`${team}_${dStr}`];
        const item = document.createElement('div');
        item.className = "flex items-center justify-between p-2 rounded-lg bg-slate-900/60 hover:bg-slate-800 border border-white/5 cursor-pointer transition-colors";
        
        let statusHtml = `<span class="text-[8px] font-mono-tech px-1.5 py-0.5 bg-yellow-500/10 text-yellow-500 rounded font-bold border border-yellow-500/20">UNPLAYED</span>`;
        if (result !== undefined) {
          statusHtml = `<span class="text-[8px] font-mono-tech px-1.5 py-0.5 bg-emerald-500/10 text-emerald-500 rounded font-bold border border-emerald-500/20">${result}% ACCURACY</span>`;
        }
        
        const dateObj = new Date(dStr + "T00:00:00");
        const formattedDate = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        
        item.innerHTML = `
          <div class="flex flex-col">
            <span class="text-[9px] font-mono-tech text-gray-500">${dStr}</span>
            <span class="text-[10px] font-black text-white mt-0.5">${formattedDate}</span>
          </div>
          ${statusHtml}
        `;
        
        item.addEventListener('click', () => {
          startDailyCompeteGame(dStr);
        });
        
        dailyHistoricList.appendChild(item);
      });
    }
  });
}

function getTeamAbbreviation(teamName) {
  if (!teamName) return 'UNK';
  const name = teamName.toLowerCase();
  if (name.includes('rays')) return 'TB';
  if (name.includes('orioles')) return 'BAL';
  if (name.includes('red sox')) return 'BOS';
  if (name.includes('yankees')) return 'NYY';
  if (name.includes('blue jays')) return 'TOR';
  if (name.includes('white sox')) return 'CWS';
  if (name.includes('guardians')) return 'CLE';
  if (name.includes('tigers')) return 'DET';
  if (name.includes('royals')) return 'KC';
  if (name.includes('twins')) return 'MIN';
  if (name.includes('astros')) return 'HOU';
  if (name.includes('angels')) return 'LAA';
  if (name.includes('athletics') || name.includes('athletics')) return 'OAK';
  if (name.includes('mariners')) return 'SEA';
  if (name.includes('rangers')) return 'TEX';
  if (name.includes('braves')) return 'ATL';
  if (name.includes('marlins')) return 'MIA';
  if (name.includes('mets')) return 'NYM';
  if (name.includes('phillies')) return 'PHI';
  if (name.includes('nationals')) return 'WSH';
  if (name.includes('cubs')) return 'CHC';
  if (name.includes('reds')) return 'CIN';
  if (name.includes('brewers')) return 'MIL';
  if (name.includes('pirates')) return 'PIT';
  if (name.includes('cardinals')) return 'STL';
  if (name.includes('diamondbacks') || name.includes('d-backs')) return 'AZ';
  if (name.includes('rockies')) return 'COL';
  if (name.includes('dodgers')) return 'LAD';
  if (name.includes('padres')) return 'SD';
  if (name.includes('giants')) return 'SF';
  
  const words = teamName.split(' ');
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return teamName.substring(0, 3).toUpperCase();
}

async function getLeaderboardRows(type, username) {
  const board = type === 'streak' ? 'daily' : type;
  const result = await apiFetchLeaderboard(board, username);
  return {
    rows: result.rows || [],
    source: result.source === 'live' ? 'live' : 'empty',
  };
}

async function fetchYesterdayGames() {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const dateStr = yesterday.toISOString().split('T')[0];
  
  const games = await fetchAllGamesForDate(dateStr);
  if (!games || games.length === 0) return [];

  // Sort: Favorite team first, then others
  if (activeFavoriteTeam && activeFavoriteTeam !== "none") {
    const favLower = activeFavoriteTeam.toLowerCase();
    games.forEach(g => {
      g.isFavorite = (g.awayTeam.toLowerCase().includes(favLower) || g.homeTeam.toLowerCase().includes(favLower));
    });
    games.sort((a, b) => (b.isFavorite ? 1 : 0) - (a.isFavorite ? 1 : 0));
  } else {
    games.forEach(g => { g.isFavorite = false; });
  }

  return games;
}

async function getGamePitchesWithCache(gamePk) {
  const cached = await getCachedGame(gamePk);
  if (cached) {
    console.log(`Loaded game ${gamePk} from IndexedDB cache`);
    return cached.data;
  }
  const gameData = await fetchGamePitches(gamePk);
  if (gameData) {
    await saveCachedGame(gamePk, gameData);
    console.log(`Fetched game ${gamePk} from MLB API and saved to IndexedDB cache`);
  }
  return gameData;
}

async function openGameDetailModal(game) {
  if (previewModalOverlay) {
    previewModalOverlay.classList.remove('opacity-0', 'pointer-events-none', 'scale-95');
    previewModalOverlay.classList.add('opacity-100', 'scale-100', 'pointer-events-auto');
  }
  
  if (previewModalTitle) previewModalTitle.textContent = "GAME DETAIL HUB";
  if (previewModalDate) previewModalDate.textContent = new Date(game.date).toLocaleDateString().toUpperCase();
  if (previewAwayName) previewAwayName.textContent = game.awayTeam.toUpperCase();
  if (previewHomeName) previewHomeName.textContent = game.homeTeam.toUpperCase();
  if (previewAwayScore) previewAwayScore.textContent = game.awayScore;
  if (previewHomeScore) previewHomeScore.textContent = game.homeScore;
  if (previewModalVenue) previewModalVenue.textContent = game.venue.toUpperCase();
  if (previewAwayLogo) previewAwayLogo.src = getTeamLogoUrl(game.awayTeam);
  if (previewHomeLogo) previewHomeLogo.src = getTeamLogoUrl(game.homeTeam);
  
  if (previewLoadingIndicator) previewLoadingIndicator.classList.remove('hidden');
  if (btnPreviewModalStart) btnPreviewModalStart.disabled = true;
  if (detailModalInningsRow) detailModalInningsRow.innerHTML = '';
  if (detailModalAbGrid) detailModalAbGrid.innerHTML = '';
  
  try {
    let allAtBats = await getGamePitchesWithCache(game.gamePk);
    if (!allAtBats || allAtBats.length === 0) {
      if (previewModalAbs) previewModalAbs.textContent = "0 AT-BATS";
      if (previewLoadingIndicator) previewLoadingIndicator.classList.add('hidden');
      return;
    }

    // Regroup if flat array from legacy cache formats
    if (allAtBats.length > 0 && !Array.isArray(allAtBats[0])) {
      const grouped = [];
      let current = [];
      let lastBat = null;
      allAtBats.forEach(p => {
        if (lastBat && p.batter !== lastBat && current.length > 0) {
          grouped.push(current);
          current = [];
        }
        current.push(p);
        lastBat = p.batter;
      });
      if (current.length > 0) grouped.push(current);
      allAtBats = grouped;
    }
    
    if (previewModalAbs) previewModalAbs.textContent = `${allAtBats.length} AT-BATS`;
    if (previewLoadingIndicator) previewLoadingIndicator.classList.add('hidden');
    if (btnPreviewModalStart) btnPreviewModalStart.disabled = false;
    
    if (detailModalInningsRow) {
      const innings = [...new Set(allAtBats.map(ab => ab && ab[0] ? ab[0].inning : null))].filter(Boolean).sort((a,b) => a - b);
      innings.forEach(inn => {
        const btn = document.createElement('button');
        btn.className = 'px-3 py-1.5 bg-slate-900 border border-white/10 rounded-lg text-[9px] font-mono-tech font-bold hover:bg-purple-600/30 hover:border-purple-500/50 transition-all text-white cursor-pointer pointer-events-auto shrink-0';
        btn.textContent = `INN ${inn}`;
        btn.addEventListener('click', () => {
          detailModalInningsRow.querySelectorAll('button').forEach(b => {
            b.classList.remove('bg-purple-600', 'border-purple-500');
            b.classList.add('bg-slate-900', 'border-white/10');
          });
          btn.classList.remove('bg-slate-900', 'border-white/10');
          btn.classList.add('bg-purple-600', 'border-purple-500');
          renderAtBatsForInning(inn, allAtBats, game);
        });
        detailModalInningsRow.appendChild(btn);
      });
      if (innings.length > 0) {
        detailModalInningsRow.children[0].click();
      }
    }
    
    btnPreviewModalStart.onclick = () => {
      hideGamePreviewModal();
      const condensedABs = selectCondensedAtBats(allAtBats, 15);
      launchGame(condensedABs, game.awayTeam, new Date(game.date).toISOString().split('T')[0]);
    };
  } catch (err) {
    console.error(err);
    if (previewLoadingIndicator) previewLoadingIndicator.classList.add('hidden');
  }
}

function renderAtBatsForInning(inning, allAtBats, game) {
  if (!detailModalAbGrid) return;
  detailModalAbGrid.innerHTML = '';
  
  const inningABs = allAtBats.filter(ab => ab[0]?.inning === inning);
  
  if (inningABs.length === 0) {
    detailModalAbGrid.innerHTML = '<span class="text-xs text-gray-500 font-mono-tech text-center py-8">No matchups in this inning</span>';
    return;
  }
  
  inningABs.forEach((ab, idx) => {
    const firstPitch = ab[0];
    if (!firstPitch) return;
    
    const abDiv = document.createElement('div');
    abDiv.className = 'flex justify-between items-center p-2.5 bg-slate-900/60 hover:bg-slate-900 border border-white/5 hover:border-blue-500/50 rounded-xl transition-all gap-2';
    
    const sideText = firstPitch.is_top ? 'TOP' : 'BOT';
    const pitchCountText = `${ab.length} Pitch${ab.length > 1 ? 'es' : ''}`;
    
    const pitcherName = firstPitch.pitcher || "Pitcher";
    const batterName = firstPitch.batter || "Batter";
    const pHand = firstPitch.pitcher_hand || "RHP";
    const bHand = firstPitch.batter_hand || "LHB";
    
    abDiv.innerHTML = `
      <div class="flex flex-col text-left">
        <span class="text-[8px] font-mono-tech text-blue-400 font-extrabold uppercase tracking-wider">${sideText} ${inning} • ${pitchCountText}</span>
        <span class="text-[10px] font-bold text-white uppercase">
          <span class="hover:underline cursor-pointer player-stats-link text-purple-400" data-name="${pitcherName}" data-role="PITCHER" data-hand="${pHand}">${pitcherName}</span>
          <span class="text-gray-500 mx-0.5 font-normal">vs</span>
          <span class="hover:underline cursor-pointer player-stats-link text-cyan-400" data-name="${batterName}" data-role="BATTER" data-hand="${bHand}">${batterName}</span>
        </span>
      </div>
      <button class="btn-play-ab px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded text-[8px] font-bold uppercase transition-all cursor-pointer pointer-events-auto">Play AB</button>
    `;
    
    abDiv.querySelector('.btn-play-ab').addEventListener('click', () => {
      hideGamePreviewModal();
      launchGame([ab], game.awayTeam, new Date().toISOString().split('T')[0]);
    });
    
    abDiv.querySelectorAll('.player-stats-link').forEach(link => {
      link.addEventListener('click', (e) => {
        e.stopPropagation();
        const name = link.getAttribute('data-name');
        const role = link.getAttribute('data-role');
        const hand = link.getAttribute('data-hand');
        showPlayerStatsPopout(link, name, role, hand);
      });
    });
    
    detailModalAbGrid.appendChild(abDiv);
  });
}

function selectCondensedAtBats(allAtBats, limit = 15) {
  const scored = allAtBats.map((ab, originalIndex) => {
    let score = 0;
    const firstPitch = ab[0];
    if (!firstPitch) return { ab, score: 0, originalIndex };

    const scoreDiff = Math.abs(firstPitch.score_away - firstPitch.score_home);
    score += Math.max(0, 8 - scoreDiff) * 3;

    if (firstPitch.inning >= 7) {
      score += 10;
    } else if (firstPitch.inning >= 4) {
      score += 5;
    }

    score += firstPitch.outs * 4;

    const calledPitchesCount = ab.filter(p => !p.is_swing).length;
    score += calledPitchesCount * 5;

    return { ab, score, originalIndex };
  });

  scored.sort((a, b) => b.score - a.score);
  
  const selected = scored.slice(0, limit);
  selected.sort((a, b) => a.originalIndex - b.originalIndex);
  
  return selected.map(s => s.ab);
}

async function findGamesForDate(dateStr) {
  const games = await fetchAllGamesForDate(dateStr);
  if (!games || games.length === 0) return [];

  // Sort: Favorite team first, then others
  if (activeFavoriteTeam && activeFavoriteTeam !== "none") {
    const favLower = activeFavoriteTeam.toLowerCase();
    games.forEach(g => {
      g.isFavorite = (g.awayTeam.toLowerCase().includes(favLower) || g.homeTeam.toLowerCase().includes(favLower));
    });
    games.sort((a, b) => (b.isFavorite ? 1 : 0) - (a.isFavorite ? 1 : 0));
  } else {
    games.forEach(g => { g.isFavorite = false; });
  }

  return games;
}

async function handleFindGames() {
  const dateVal = gameFinderDate ? gameFinderDate.value : "";
  if (!dateVal) {
    alert("Please select a date first!");
    return;
  }
  
  if (gameFinderResults) {
    gameFinderResults.classList.remove('hidden');
    gameFinderResults.innerHTML = '<div class="col-span-full text-center text-xs text-blue-400 py-4 animate-pulse">⚡ SEARCHING MLB SCHEDULE...</div>';
  }
  
  try {
    const games = await findGamesForDate(dateVal);
    if (!games || games.length === 0) {
      gameFinderResults.innerHTML = '<div class="col-span-full text-center text-xs text-gray-500 py-4">No games found for this date. Try another date.</div>';
      return;
    }
    
    gameFinderResults.innerHTML = '';
    games.forEach(g => {
      const card = document.createElement('div');
      card.className = g.isFavorite
        ? 'glass-panel p-2.5 rounded-lg border-2 border-amber-500/50 shadow-[0_0_10px_rgba(245,158,11,0.15)] flex items-center justify-between hover:border-amber-500/80 hover:scale-[1.01] transition-all select-none gap-2 text-left cursor-pointer'
        : 'glass-panel p-2.5 rounded-lg border border-white/5 flex items-center justify-between hover:border-blue-500/50 hover:scale-[1.01] transition-all select-none gap-2 text-left cursor-pointer';
      
      const awayLogo = getTeamLogoUrl(g.awayTeam);
      const homeLogo = getTeamLogoUrl(g.homeTeam);
      const awayAbbr = getTeamAbbreviation(g.awayTeam);
      const homeAbbr = getTeamAbbreviation(g.homeTeam);

      card.innerHTML = `
        <div class="flex items-center gap-1.5 flex-1">
          ${g.isFavorite ? '<span class="text-amber-400 text-xs">⭐</span>' : ''}
          <img src="${awayLogo}" class="w-5 h-5 object-contain bg-slate-950/40 rounded-full p-0.5" />
          <span class="text-xs font-black text-white">${awayAbbr}</span>
          <span class="text-xs font-mono-tech font-bold text-gray-300">${g.awayScore}</span>
        </div>
        <div class="flex flex-col items-center px-1">
          <span class="text-[9px] font-mono-tech font-bold text-gray-500">@</span>
          <span class="text-[9px] font-mono-tech text-emerald-400 font-bold uppercase whitespace-nowrap">${g.status.toUpperCase()}</span>
        </div>
        <div class="flex items-center gap-1.5 justify-end flex-1">
          <span class="text-xs font-mono-tech font-bold text-gray-300">${g.homeScore}</span>
          <span class="text-xs font-black text-white">${homeAbbr}</span>
          <img src="${homeLogo}" class="w-5 h-5 object-contain bg-slate-950/40 rounded-full p-0.5" />
        </div>
      `;
      
      card.addEventListener('click', async () => {
        await openGameDetailModal(g);
      });
      
      gameFinderResults.appendChild(card);
    });
  } catch (e) {
    console.error(e);
    gameFinderResults.innerHTML = '<div class="col-span-full text-center text-xs text-red-400 py-4">Failed to load games.</div>';
  }
}

async function loadPlayTabRecentGames() {
  if (recentGamesDate) {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    recentGamesDate.textContent = yesterday.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }).toUpperCase();
  }
  
  if (!recentGamesGrid) return;
  recentGamesGrid.innerHTML = '<div class="col-span-full text-center text-xs text-purple-400 py-4 animate-pulse">⚡ LOADING YESTERDAY\'S MLB GAMES...</div>';

  try {
    const games = await fetchYesterdayGames();
    if (!games || games.length === 0) {
      recentGamesGrid.innerHTML = '<div class="col-span-full text-center text-xs text-gray-500 py-4">No MLB games found for yesterday.</div>';
      return;
    }
    
    recentGamesGrid.innerHTML = '';
    games.forEach(g => {
      const card = document.createElement('div');
      card.className = g.isFavorite
        ? 'glass-panel p-3.5 rounded-xl border-2 border-amber-500/50 shadow-[0_0_15px_rgba(245,158,11,0.15)] flex items-center justify-between hover:border-amber-500/80 hover:scale-[1.01] transition-all select-none gap-3 cursor-pointer'
        : 'glass-panel p-3.5 rounded-xl border border-white/10 flex items-center justify-between hover:border-purple-500/50 hover:scale-[1.01] transition-all select-none gap-3 cursor-pointer';
      
      const awayLogo = getTeamLogoUrl(g.awayTeam);
      const homeLogo = getTeamLogoUrl(g.homeTeam);
      const awayAbbr = getTeamAbbreviation(g.awayTeam);
      const homeAbbr = getTeamAbbreviation(g.homeTeam);
      
      card.innerHTML = `
        <div class="flex items-center gap-2 flex-1">
          ${g.isFavorite ? '<span class="text-amber-400 text-xs">⭐</span>' : ''}
          <img src="${awayLogo}" class="w-6 h-6 object-contain bg-slate-950/40 rounded-full p-0.5" />
          <span class="text-xs md:text-sm font-black text-white uppercase">${awayAbbr}</span>
          <span class="text-xs md:text-sm font-mono-tech font-black text-gray-300">${g.awayScore}</span>
        </div>
        
        <div class="flex flex-col items-center px-2">
          <span class="text-[9px] font-mono-tech font-bold text-gray-500">@</span>
          <span class="text-[10px] font-mono-tech text-emerald-400 font-bold uppercase whitespace-nowrap">${g.status.toUpperCase()}</span>
        </div>

        <div class="flex items-center gap-2 justify-end flex-1">
          <span class="text-xs md:text-sm font-mono-tech font-black text-gray-300">${g.homeScore}</span>
          <span class="text-xs md:text-sm font-black text-white uppercase">${homeAbbr}</span>
          <img src="${homeLogo}" class="w-6 h-6 object-contain bg-slate-950/40 rounded-full p-0.5" />
        </div>
      `;
      
      card.addEventListener('click', async () => {
        await openGameDetailModal(g);
      });
      
      recentGamesGrid.appendChild(card);
    });
  } catch (e) {
    console.error(e);
    recentGamesGrid.innerHTML = '<div class="col-span-full text-center text-xs text-red-400 py-4">Failed to load recent MLB games.</div>';
  }
}

async function awardXP(amount) {
  const username = localStorage.getItem('ump_username');
  if (!username) return;

  const stats = await getGlobalUserStats(username);
  const oldXp = stats.xp || 0;
  const oldLevel = getLevelFromXp(oldXp);
  stats.xp = oldXp + amount;
  const newLevel = getLevelFromXp(stats.xp);
  stats.level = newLevel;

  await saveGlobalUserStats(username, stats);
  updateProfileStatsUI();

  if (newLevel > oldLevel) {
    showLevelUpCelebration(newLevel, oldLevel);
  }
}

function showFloatingXP(amount, customText) {
  const container = document.body;
  const el = document.createElement('div');
  el.textContent = customText || `+${amount} XP`;
  
  if (customText) {
    el.className = 'fixed text-yellow-300 font-mono-tech font-black text-2xl md:text-3xl z-[300] pointer-events-none transition-all duration-1000 transform -translate-x-1/2 text-center drop-shadow-[0_0_15px_rgba(234,179,8,0.9)]';
  } else {
    el.className = 'fixed text-emerald-400 font-mono-tech font-black text-xl md:text-2xl z-[300] pointer-events-none transition-all duration-1000 transform -translate-x-1/2 text-center drop-shadow-[0_0_12px_rgba(16,185,129,0.8)]';
  }
  
  el.style.left = '50%';
  el.style.top = '52%';
  el.style.opacity = '1';
  
  container.appendChild(el);
  
  // Force a browser reflow/repaint to guarantee CSS transition works
  el.offsetHeight;
  
  requestAnimationFrame(() => {
    el.style.top = '32%';
    el.style.opacity = '0';
  });
  
  setTimeout(() => {
    el.remove();
  }, 1000);
}

function showLevelUpToast(newLevel) {
  playLevelUpSound();
  const container = document.body;
  const toast = document.createElement('div');
  toast.className = 'fixed bottom-10 left-1/2 transform -translate-x-1/2 bg-gradient-to-r from-yellow-500 to-amber-600 text-slate-950 font-black px-6 py-3 rounded-full text-sm font-mono-tech z-[400] shadow-2xl border-2 border-yellow-300 uppercase tracking-widest animate-bounce';
  toast.innerHTML = `⭐ LEVEL UP! NOW LEVEL ${newLevel} ⭐`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 3000);
}

function playLevelUpSound() {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  const frequencies = [523.25, 659.25, 783.99, 1046.50, 1318.51, 1567.98, 2093.00]; // C5, E5, G5, C6, E6, G6, C7
  frequencies.forEach((freq, idx) => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, now + idx * 0.05);
    
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.2, now + idx * 0.05 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.05 + 0.4);
    
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(now + idx * 0.05);
    osc.stop(now + idx * 0.05 + 0.45);
  });
}

async function saveGameProgress() {
  const username = localStorage.getItem('ump_username');
  if (!username) return;

  const sanitizePitch = (pitch) => {
    if (!pitch) return pitch;
    const clean = { ...pitch };
    delete clean.pitchTrajectory;
    delete clean.trajectory;
    return clean;
  };

  const sanitizeWeeklyPlaylist = (playlist) => {
    if (!playlist) return playlist;
    return playlist.map(ab => {
      const cleanAb = { ...ab };
      if (cleanAb.pitches) {
        cleanAb.pitches = cleanAb.pitches.map(sanitizePitch);
      }
      return cleanAb;
    });
  };

  const sanitizedPlaylist = sanitizeWeeklyPlaylist(weeklyPlaylistABs);
  const sanitizedPitchesList = pitchesList ? pitchesList.map(sanitizePitch) : [];

  const sessionData = {
    gameMode,
    activeWeeklyAbIndex,
    currentPitchIndex,
    abBalls,
    abStrikes,
    pitchHistory: pitchHistory.map(h => ({
      pitchNum: h.pitchNum,
      pitchType: h.pitchType,
      speedMph: h.speedMph,
      userCall: h.userCall,
      absCall: h.absCall,
      realCall: h.realCall,
      userCorrect: h.userCorrect,
      realCorrect: h.realCorrect,
      isSwingPlay: h.isSwingPlay,
      swingOutcome: h.swingOutcome,
      swingHitType: h.swingHitType
    })),
    weeklyPlaylistABs: sanitizedPlaylist,
    activeDailyDate,
    activeDailyTeam,
    pitchesList: sanitizedPitchesList,
    totalPitchesCount,
    totalBattersFaced,
    totalSessionK,
    totalSessionBB,
    totalSessionH,
    totalSessionOuts
  };
  
  try {
    await saveActiveSession(username, sessionData);
    console.log("Game progress saved to IndexedDB session storage.");
  } catch (err) {
    console.error("Failed to save game progress to IndexedDB:", err);
  }
}

async function startDailyCompeteGame(dateString) {
  const username = localStorage.getItem('ump_username');
  if (!username) return;

  const team = dailyCompeteTeamSelect ? dailyCompeteTeamSelect.value : (activeFavoriteTeam || "Orioles");
  
  // Show preview modal in loading state
  if (previewModalOverlay) {
    previewModalOverlay.classList.remove('opacity-0', 'pointer-events-none', 'scale-95');
    previewModalOverlay.classList.add('opacity-100', 'scale-100', 'pointer-events-auto');
  }
  if (previewModalTitle) previewModalTitle.textContent = `${team.toUpperCase()} DAILY GAME`;
  if (previewModalDate) previewModalDate.textContent = dateString.toUpperCase();
  if (previewAwayName) previewAwayName.textContent = "LOADING...";
  if (previewHomeName) previewHomeName.textContent = "LOADING...";
  if (previewAwayScore) previewAwayScore.textContent = "-";
  if (previewHomeScore) previewHomeScore.textContent = "-";
  if (previewModalVenue) previewModalVenue.textContent = "LOADING...";
  if (previewModalAbs) previewModalAbs.textContent = "";
  if (previewLoadingIndicator) previewLoadingIndicator.classList.remove('hidden');
  if (btnPreviewModalStart) btnPreviewModalStart.disabled = true;

  try {
    // 1. Fetch team schedule from MLB Stats API
    console.log(`MLB API: Fetching schedule for ${team} on ${dateString}`);
    const games = await fetchTeamSchedule(team, dateString, dateString);
    let gameData = null;
    let playlistABs = null;

    if (games && games.length > 0) {
      gameData = games[0];
      console.log(`MLB API: Found gamePk ${gameData.gamePk} - ${gameData.awayTeam} @ ${gameData.homeTeam}`);
      
      // Update UI with real game data
      if (previewAwayName) previewAwayName.textContent = gameData.awayTeam.toUpperCase();
      if (previewHomeName) previewHomeName.textContent = gameData.homeTeam.toUpperCase();
      if (previewAwayScore) previewAwayScore.textContent = gameData.awayScore;
      if (previewHomeScore) previewHomeScore.textContent = gameData.homeScore;
      if (previewModalVenue) previewModalVenue.textContent = gameData.venue.toUpperCase();
      if (previewAwayLogo) previewAwayLogo.src = getTeamLogoUrl(gameData.awayTeam);
      if (previewHomeLogo) previewHomeLogo.src = getTeamLogoUrl(gameData.homeTeam);

      // Fetch pitch data
      console.log(`MLB API: Fetching play-by-play for gamePk ${gameData.gamePk}`);
      playlistABs = await fetchGamePitches(gameData.gamePk);
    }

    // If no real game data, or fetch failed, fall back to procedural generation
    if (!gameData || !playlistABs || playlistABs.length === 0) {
      console.log("MLB API: No game found or failed to parse. Falling back to procedurally generated game.");
      
      // Procedural fallback details
      const seed = hashString(team + dateString);
      const rand = mulberry32(seed);
      const oppTeams = TEAMS_LIST.filter(t => t.name !== team);
      const oppIdx = Math.floor(rand() * oppTeams.length);
      const opponent = oppTeams[oppIdx];
      const isHome = rand() < 0.5;
      const awayName = isHome ? opponent.name : team;
      const homeName = isHome ? team : opponent.name;
      const awayScore = Math.floor(rand() * 8);
      const homeScore = Math.floor(rand() * 8);

      if (previewAwayName) previewAwayName.textContent = awayName.toUpperCase();
      if (previewHomeName) previewHomeName.textContent = homeName.toUpperCase();
      if (previewAwayScore) previewAwayScore.textContent = awayScore;
      if (previewHomeScore) previewHomeScore.textContent = homeScore;
      if (previewModalVenue) previewModalVenue.textContent = (isHome ? `${team} STADIUM` : `${opponent.name} STADIUM`).toUpperCase();
      if (previewAwayLogo) previewAwayLogo.src = getTeamLogoUrl(awayName);
      if (previewHomeLogo) previewHomeLogo.src = getTeamLogoUrl(homeName);

      playlistABs = generateDailyCondensedGame(team, dateString);
    }

    if (previewModalAbs) previewModalAbs.textContent = `${playlistABs.length} MATCHUPS`;
    if (previewLoadingIndicator) previewLoadingIndicator.classList.add('hidden');
    if (btnPreviewModalStart) btnPreviewModalStart.disabled = false;

    // Define the launch function when they confirm
    window._onPreviewStartCallback = () => {
      launchGame(playlistABs, team, dateString);
    };

  } catch (err) {
    console.error("Error setting up daily compete game preview:", err);
    // Secure fallback
    const playlistABs = generateDailyCondensedGame(team, dateString);
    if (previewLoadingIndicator) previewLoadingIndicator.classList.add('hidden');
    if (btnPreviewModalStart) btnPreviewModalStart.disabled = false;
    window._onPreviewStartCallback = () => {
      launchGame(playlistABs, team, dateString);
    };
  }
}

function launchGame(rawABs, team, dateString) {
  const username = localStorage.getItem('ump_username');
  if (!username) return;

  gameMode = 'daily_compete';
  activeDailyDate = dateString;
  activeDailyTeam = team;
  isGamePaused = false;

  if (pauseScreen) {
    pauseScreen.classList.add('opacity-0', 'pointer-events-none');
    pauseScreen.classList.remove('opacity-100', 'pointer-events-auto');
  }

  const key = `pitch_ump_daily_compete_mvp_${username.toUpperCase()}_${dateString}`;
  const rawSession = localStorage.getItem(key);
  let savedPlaylist = null;
  let savedAbIndex = 0;

  if (rawSession) {
    try {
      const savedData = JSON.parse(rawSession);
      if (savedData.weeklyPlaylistABs && savedData.weeklyPlaylistABs.length === rawABs.length) {
        savedPlaylist = savedData.weeklyPlaylistABs;
        savedAbIndex = savedData.activeWeeklyAbIndex || 0;
        if (savedAbIndex >= savedPlaylist.length) {
          savedPlaylist = null;
          savedAbIndex = 0;
        }
      }
    } catch (e) {
      console.error("Failed to restore daily compete playlist", e);
    }
  }

  if (savedPlaylist) {
    weeklyPlaylistABs = savedPlaylist;
    activeWeeklyAbIndex = savedAbIndex;
    
    const raw = localStorage.getItem(key);
    if (raw) {
      try {
        const data = JSON.parse(raw);
        if (data.activeChallenge) {
          currentPitchIndex = data.activeChallenge.currentPitchIndex || 0;
          abBalls = data.activeChallenge.abBalls || 0;
          abStrikes = data.activeChallenge.abStrikes || 0;
          pitchHistory = data.activeChallenge.pitchHistory || [];
        } else {
          currentPitchIndex = 0;
          abBalls = 0;
          abStrikes = 0;
          pitchHistory = [];
        }
      } catch (e) {
        console.error(e);
      }
    }
  } else {
    weeklyPlaylistABs = [...rawABs];
    activeWeeklyAbIndex = 0;
    currentPitchIndex = 0;
    abBalls = 0;
    abStrikes = 0;
    pitchHistory = [];
  }

  loadWeeklyAtBat(activeWeeklyAbIndex);
}

function hideGamePreviewModal() {
  if (previewModalOverlay) {
    previewModalOverlay.classList.add('opacity-0', 'pointer-events-none', 'scale-95');
    previewModalOverlay.classList.remove('opacity-100', 'scale-100', 'pointer-events-auto');
  }
}

async function openChallengeDetailModal(type) {
  if (challengeDetailModalOverlay) {
    challengeDetailModalOverlay.classList.remove('opacity-0', 'pointer-events-none', 'scale-95');
    challengeDetailModalOverlay.classList.add('opacity-100', 'scale-100', 'pointer-events-auto');
  }

  const username = localStorage.getItem('ump_username') || 'GUEST_UMPIRE';
  const profile = await getProfile(username);
  
  if (type === 'weekly') {
    if (challengeDetailTitle) challengeDetailTitle.textContent = "WEEKLY CHALLENGE INFO";
    if (challengeDetailSubtitle) challengeDetailSubtitle.textContent = "MLB CURATED MATCHUPS";
    if (challengeDetailDesc) challengeDetailDesc.textContent = "Analyze pitch-by-pitch datasets sourced directly from controversial called strikes and balls. Complete all matchups to log your score globally.";
    
    if (challengeDetailGamesCount) challengeDetailGamesCount.textContent = "5 Featured Games";
    if (challengeDetailBestStreak) challengeDetailBestStreak.textContent = "N/A (Score Based)";
    if (challengeDetailCompleted) challengeDetailCompleted.textContent = profile ? `${profile.completedWeekly || 0} Runs` : "0 Runs";
    
    if (btnChallengeDetailPlay) {
      btnChallengeDetailPlay.onclick = (e) => {
        e.stopPropagation();
        hideChallengeDetailModal();
        if (btnStartWeeklyChallenge) btnStartWeeklyChallenge.click();
      };
    }

    if (challengeDetailLeaderboardBody) {
      const rows = (await getLeaderboardRows('weekly', username)).rows;
      challengeDetailLeaderboardBody.innerHTML = rows.map(r => {
        let rankHtml = `#${r.rank}`;
        if (r.rank === 1) rankHtml = `<span class="text-yellow-400 font-black">🥇</span>`;
        else if (r.rank === 2) rankHtml = `<span class="text-gray-400 font-black">🥈</span>`;
        else if (r.rank === 3) rankHtml = `<span class="text-amber-600 font-black">🥉</span>`;
        
        return `
          <tr class="border-b border-white/5 font-mono-tech text-[11px] ${r.isUser ? 'bg-purple-950/20 text-purple-300 font-bold border-l-2 border-purple-500' : 'text-gray-300'}">
            <td class="p-3">${rankHtml}</td>
            <td class="p-3 uppercase tracking-wider ${r.isUser ? 'text-purple-400 font-bold' : ''}">${r.name}</td>
            <td class="p-3 text-center text-emerald-400">${r.accuracy}</td>
            <td class="p-3 text-center font-bold">${r.score}</td>
          </tr>
        `;
      }).join('');
    }
  } else {
    if (challengeDetailTitle) challengeDetailTitle.textContent = "STREAK CHALLENGE INFO";
    if (challengeDetailSubtitle) challengeDetailSubtitle.textContent = "BORDERLINE PITCH BLITZ";
    if (challengeDetailDesc) challengeDetailDesc.textContent = "Test your focus against consecutive borderline pitches. Make one incorrect call and the run is over. Playable infinitely!";
    
    if (challengeDetailGamesCount) challengeDetailGamesCount.textContent = "Controversial Curation";
    if (challengeDetailBestStreak) challengeDetailBestStreak.textContent = profile ? `${profile.maxStreak || 0} Pitches` : "0 Pitches";
    if (challengeDetailCompleted) challengeDetailCompleted.textContent = "Infinite Retries";
    
    if (btnChallengeDetailPlay) {
      btnChallengeDetailPlay.onclick = (e) => {
        e.stopPropagation();
        hideChallengeDetailModal();
        if (btnStartDailyStreak) btnStartDailyStreak.click();
      };
    }

    if (challengeDetailLeaderboardBody) {
      const rows = (await getLeaderboardRows('daily', username)).rows;
      challengeDetailLeaderboardBody.innerHTML = rows.map(r => {
        let rankHtml = `#${r.rank}`;
        if (r.rank === 1) rankHtml = `<span class="text-yellow-400 font-black">🥇</span>`;
        else if (r.rank === 2) rankHtml = `<span class="text-gray-400 font-black">🥈</span>`;
        else if (r.rank === 3) rankHtml = `<span class="text-amber-600 font-black">🥉</span>`;
        
        return `
          <tr class="border-b border-white/5 font-mono-tech text-[11px] ${r.isUser ? 'bg-purple-950/20 text-purple-300 font-bold border-l-2 border-purple-500' : 'text-gray-300'}">
            <td class="p-3">${rankHtml}</td>
            <td class="p-3 uppercase tracking-wider ${r.isUser ? 'text-purple-400 font-bold' : ''}">${r.name}</td>
            <td class="p-3 text-center text-emerald-400">${r.accuracy}</td>
            <td class="p-3 text-center font-bold text-amber-400">${r.score}</td>
          </tr>
        `;
      }).join('');
    }
  }
}

function hideChallengeDetailModal() {
  if (challengeDetailModalOverlay) {
    challengeDetailModalOverlay.classList.add('opacity-0', 'pointer-events-none', 'scale-95');
    challengeDetailModalOverlay.classList.remove('opacity-100', 'scale-100', 'pointer-events-auto');
  }
}

async function runAutomatedIntegrationTest() {
  console.log("TEST: Starting integration test runner.");
  
  // Step 1: Handle Login if needed
  const loggedIn = !!localStorage.getItem('ump_username');
  if (!loggedIn) {
    console.log("TEST: User not logged in. Attempting auto-login.");
    if (loginHandleInput && loginPinInput && btnWelcomeStart) {
      loginHandleInput.value = "TEST_UMP";
      loginPinInput.value = "1234";
      btnWelcomeStart.click();
      console.log("TEST: Welcome start clicked.");
      
      // Wait for login confirm box if handle is new
      await new Promise(r => setTimeout(r, 600));
      if (loginConfirmBox && !loginConfirmBox.classList.contains('hidden')) {
        const btnCreate = document.getElementById('btn-login-confirm-create');
        if (btnCreate) {
          btnCreate.click();
          console.log("TEST: Confirm profile creation clicked.");
        }
      }
    } else {
      console.log("TEST: ERROR - Login fields not found.");
      return;
    }
  } else {
    console.log("TEST: User already logged in as: " + localStorage.getItem('ump_username'));
    if (btnWelcomeStart) {
      btnWelcomeStart.click();
      console.log("TEST: Welcome start clicked (resume).");
    }
  }

  // Step 2: Wait for state change to STATES.START
  console.log("TEST: Waiting for transition to STATES.START...");
  let maxWait = 30; // 3 seconds
  while (currentState !== STATES.START && maxWait > 0) {
    await new Promise(r => setTimeout(r, 100));
    maxWait--;
  }
  
  if (currentState !== STATES.START) {
    // If favorite team select is showing
    if (currentState === STATES.TEAM_SELECT) {
      console.log("TEST: In TEAM_SELECT state. Selecting favorite team.");
      selectedTeamId = 'BAL'; // Select Orioles
      if (btnConfirmTeam) {
        btnConfirmTeam.click();
        console.log("TEST: Confirm team clicked.");
      }
      
      maxWait = 30;
      while (currentState !== STATES.START && maxWait > 0) {
        await new Promise(r => setTimeout(r, 100));
        maxWait--;
      }
    }
  }
  
  if (currentState !== STATES.START) {
    console.log("TEST: ERROR - Failed to transition to STATES.START. CurrentState: " + currentState);
    return;
  }
  console.log("TEST: Reached STATES.START successfully.");
  
  // Verify camera was reset to umpire
  if (getActiveCameraName() !== 'umpire') {
    console.log("TEST: ERROR - Camera is not umpire on dashboard! Active: " + getActiveCameraName());
    return;
  }
  console.log("TEST: Camera is correctly set to umpire on dashboard.");

  // Step 3: Start Weekly Challenge
  if (btnStartWeeklyChallenge) {
    btnStartWeeklyChallenge.click();
    console.log("TEST: Weekly Challenge button clicked.");
  } else {
    console.log("TEST: ERROR - Weekly challenge button not found.");
    return;
  }

  // Wait for loading weekly challenge (transitions to STATES.IDLE)
  console.log("TEST: Waiting for transition to STATES.IDLE (At-Bat preview)...");
  maxWait = 30;
  while (currentState !== STATES.IDLE && maxWait > 0) {
    await new Promise(r => setTimeout(r, 100));
    maxWait--;
  }
  
  if (currentState !== STATES.IDLE) {
    console.log("TEST: ERROR - Failed to reach STATES.IDLE. CurrentState: " + currentState);
    return;
  }
  console.log("TEST: Reached STATES.IDLE (matchup preview) successfully.");

  // Step 4: Confirm At-Bat Start (spacebar or btnAbStartConfirm click)
  await new Promise(r => setTimeout(r, 500));
  if (btnAbStartConfirm) {
    btnAbStartConfirm.click();
    console.log("TEST: At-Bat Start Confirm button clicked.");
  } else {
    console.log("TEST: ERROR - btnAbStartConfirm button not found.");
    return;
  }

  // Step 5: Wait for Pitch Flight and DECISION_PENDING
  console.log("TEST: Waiting for pitch flight to complete (STATES.DECISION_PENDING)...");
  maxWait = 60; // 6 seconds
  while (currentState !== STATES.DECISION_PENDING && maxWait > 0) {
    await new Promise(r => setTimeout(r, 100));
    maxWait--;
  }

  if (currentState !== STATES.DECISION_PENDING) {
    console.log("TEST: ERROR - Failed to reach DECISION_PENDING. CurrentState: " + currentState);
    return;
  }
  console.log("TEST: Reached DECISION_PENDING successfully.");

  // Step 6: Submit User Decision
  submitUserDecision('S');
  console.log("TEST: Submitted Strike decision.");

  // Step 7: Wait for ABS Replay (STATES.ABS_REVIEW)
  console.log("TEST: Waiting for transition to STATES.ABS_REVIEW...");
  maxWait = 20;
  while (currentState !== STATES.ABS_REVIEW && maxWait > 0) {
    await new Promise(r => setTimeout(r, 100));
    maxWait--;
  }

  if (currentState !== STATES.ABS_REVIEW) {
    console.log("TEST: ERROR - Failed to reach STATES.ABS_REVIEW. CurrentState: " + currentState);
    return;
  }
  console.log("TEST: Reached STATES.ABS_REVIEW successfully.");

  // Step 8: Play through the At-Bat until complete
  console.log("TEST: Playing remaining pitches until AB completes...");
  let safetyLoop = 0;
  while (!activeAbEnded && safetyLoop < 12) {
    safetyLoop++;
    // If we are in ABS_REVIEW, advance it
    if (currentState === STATES.ABS_REVIEW) {
      if (btnQuickContinue && btnQuickContinue.classList.contains('opacity-100')) {
        await new Promise(r => setTimeout(r, 1000));
        btnQuickContinue.click();
        console.log("TEST: Clicked quick review continue.");
      } else {
        await new Promise(r => setTimeout(r, 500));
        advanceGameFlow();
        console.log("TEST: Called advanceGameFlow manually.");
      }
    }
    
    // Wait for state to change to IDLE
    maxWait = 30;
    while (currentState === STATES.ABS_REVIEW && maxWait > 0) {
      await new Promise(r => setTimeout(r, 100));
      maxWait--;
    }
    
    if (activeAbEnded) break;

    // If IDLE, confirm start of pitch/preview
    if (currentState === STATES.IDLE) {
      await new Promise(r => setTimeout(r, 500));
      if (abStartOverlay && abStartOverlay.classList.contains('opacity-100')) {
        btnAbStartConfirm.click();
        console.log("TEST: Confirmed next pitch start overlay.");
      }
      
      // Wait for decision pending
      console.log("TEST: Waiting for decision pending...");
      maxWait = 60;
      while (currentState !== STATES.DECISION_PENDING && !activeAbEnded && maxWait > 0) {
        await new Promise(r => setTimeout(r, 100));
        maxWait--;
      }
      
      if (activeAbEnded) break;
      
      if (currentState === STATES.DECISION_PENDING) {
        submitUserDecision('S');
        console.log("TEST: Submitted Strike decision on next pitch.");
      }
    }
  }

  // Step 9: Verify At-Bat complete and Post-AB summary overlay shows up
  console.log("TEST: At-Bat ended. Waiting for summary overlay...");
  maxWait = 40; // 4 seconds
  while ((!abSummaryOverlay || !abSummaryOverlay.classList.contains('opacity-100')) && maxWait > 0) {
    await new Promise(r => setTimeout(r, 100));
    maxWait--;
  }

  if (!abSummaryOverlay || !abSummaryOverlay.classList.contains('opacity-100')) {
    console.log("TEST: ERROR - Post-AB summary overlay failed to appear!");
    return;
  }
  console.log("TEST: SUCCESS - Post-AB summary overlay is visible.");

  // Camera should stay on umpire view during summary (no end-of-AB rotation)
  if (getActiveCameraName() !== 'umpire') {
    console.log("TEST: ERROR - Camera is not umpire during summary! Active: " + getActiveCameraName());
    return;
  }
  console.log("TEST: Camera correctly remains umpire during summary.");

  // Step 10: Advance to next At-Bat
  if (btnAbSummaryAdvance) {
    btnAbSummaryAdvance.click();
    console.log("TEST: Clicked Advance to Next AB.");
  } else {
    console.log("TEST: ERROR - btnAbSummaryAdvance not found.");
    return;
  }

  // Wait for transition back to IDLE
  await new Promise(r => setTimeout(r, 1000));
  if (abSummaryOverlay.classList.contains('opacity-100')) {
    console.log("TEST: ERROR - Summary overlay is still visible after clicking advance!");
    return;
  }
  
  if (currentState !== STATES.IDLE) {
    console.log("TEST: ERROR - Current state is not STATES.IDLE after advancing. CurrentState: " + currentState);
    return;
  }

  console.log("TEST: SUCCESS - All automated integration tests passed!");
}

/* ==========================================================================
   UNIFIED NAVBAR & INTERACTIVE PLAYER STATS MODAL IMPLEMENTATION
   ========================================================================== */

function updateUnifiedTopNav(state) {
  const unifiedNav = document.getElementById('main-top-nav');
  if (!unifiedNav) return;

  // Clear previous morphing capsule classes
  unifiedNav.classList.remove(
    'capsule-welcome',
    'capsule-team-select',
    'capsule-dashboard',
    'capsule-gameplay',
    'capsule-scoreboard'
  );

  const showWelcome = state === STATES.WELCOME || !localStorage.getItem('ump_username');
  if (showWelcome) {
    unifiedNav.classList.add('capsule-welcome');
    setOverlayVisible(unifiedNav, false);
    return;
  }

  setOverlayVisible(unifiedNav, true);

  const dashboardTabs = document.getElementById('dashboard-nav-tabs');
  const gameplayTelemetry = document.getElementById('gameplay-nav-telemetry');
  const contextRow = document.getElementById('nav-context-row');

  const isDashboard = state === STATES.START;
  const isGameplay = [STATES.IDLE, STATES.WINDUP, STATES.PITCHING, STATES.DECISION_PENDING, STATES.ABS_REVIEW].includes(state);
  const isTeamSelect = state === STATES.TEAM_SELECT;
  const isScoreboard = state === STATES.SCOREBOARD;

  if (isTeamSelect) {
    unifiedNav.classList.add('capsule-team-select');
  } else if (isDashboard) {
    unifiedNav.classList.add('capsule-dashboard');
  } else if (isGameplay) {
    unifiedNav.classList.add('capsule-gameplay');
  } else if (isScoreboard) {
    unifiedNav.classList.add('capsule-scoreboard');
  }

  // Check if the at-bat start overlay is currently visible — if so, suppress telemetry row
  const abStartVisible = abStartOverlay && abStartOverlay.classList.contains('opacity-100');

  if (contextRow) {
    if (isDashboard) {
      setOverlayVisible(contextRow, true);
      if (dashboardTabs) setOverlayVisible(dashboardTabs, true);
      if (gameplayTelemetry) setOverlayVisible(gameplayTelemetry, false);
    } else if (isGameplay) {
      setOverlayVisible(contextRow, true);
      if (dashboardTabs) setOverlayVisible(dashboardTabs, false);
      // Hide the matchup/scorebug row while the Next At-Bat overlay is showing
      if (gameplayTelemetry) setOverlayVisible(gameplayTelemetry, !abStartVisible);
    } else {
      setOverlayVisible(contextRow, false);
    }
  }
}

const PLAYER_STATS_DB = {
  "Corbin Burnes": {
    role: "PITCHER",
    hand: "RHP",
    team: "Baltimore Orioles",
    height: "6' 3\"",
    weight: "224 lbs",
    stats: { "ERA": "2.94", "WHIP": "1.07", "SO": "200", "IP": "194.1", "W-L": "15-9", "WAR": "4.8" }
  },
  "Tarik Skubal": {
    role: "PITCHER",
    hand: "LHP",
    team: "Detroit Tigers",
    height: "6' 3\"",
    weight: "240 lbs",
    stats: { "ERA": "2.58", "WHIP": "0.95", "SO": "228", "IP": "192.0", "W-L": "18-4", "WAR": "6.3" }
  },
  "Gerrit Cole": {
    role: "PITCHER",
    hand: "RHP",
    team: "New York Yankees",
    height: "6' 4\"",
    weight: "220 lbs",
    stats: { "ERA": "3.12", "WHIP": "1.10", "SO": "180", "IP": "178.2", "W-L": "14-8", "WAR": "3.9" }
  },
  "Zack Wheeler": {
    role: "PITCHER",
    hand: "RHP",
    team: "Philadelphia Phillies",
    height: "6' 4\"",
    weight: "195 lbs",
    stats: { "ERA": "2.70", "WHIP": "0.96", "SO": "224", "IP": "200.0", "W-L": "16-7", "WAR": "6.1" }
  },
  "Aaron Judge": {
    role: "BATTER",
    hand: "R / R",
    team: "New York Yankees",
    height: "6' 7\"",
    weight: "282 lbs",
    stats: { "AVG": ".322", "HR": "58", "RBI": "144", "OPS": "1.159", "OBP": ".458", "SLG": ".701" }
  },
  "Juan Soto": {
    role: "BATTER",
    hand: "L / R",
    team: "New York Yankees",
    height: "6' 2\"",
    weight: "224 lbs",
    stats: { "AVG": ".288", "HR": "41", "RBI": "109", "OPS": ".989", "OBP": ".419", "SLG": ".569" }
  },
  "Gunnar Henderson": {
    role: "BATTER",
    hand: "L / R",
    team: "Baltimore Orioles",
    height: "6' 3\"",
    weight: "220 lbs",
    stats: { "AVG": ".281", "HR": "37", "RBI": "92", "OPS": ".893", "OBP": ".365", "SLG": ".529" }
  },
  "Shohei Ohtani": {
    role: "BATTER",
    hand: "L / R",
    team: "Los Angeles Dodgers",
    height: "6' 4\"",
    weight: "210 lbs",
    stats: { "AVG": ".310", "HR": "54", "RBI": "130", "OPS": "1.036", "OBP": ".390", "SLG": ".646" }
  },
  "Francisco Lindor": {
    role: "BATTER",
    hand: "S / R",
    team: "New York Mets",
    height: "5' 11\"",
    weight: "190 lbs",
    stats: { "AVG": ".273", "HR": "33", "RBI": "91", "OPS": ".844", "OBP": ".344", "SLG": ".500" }
  }
};

function getPlayerDetails(name, role, hand = 'R') {
  if (PLAYER_STATS_DB[name]) {
    return PLAYER_STATS_DB[name];
  }
  
  const isPitcher = role.toUpperCase() === 'PITCHER';
  const displayHand = isPitcher ? `${hand}HP` : `${hand} / R`;
  const team = getPlayerTeam(name) || "Generic Team";
  
  if (isPitcher) {
    const era = (3.0 + Math.random() * 1.5).toFixed(2);
    const whip = (1.0 + Math.random() * 0.3).toFixed(2);
    const so = Math.round(140 + Math.random() * 80).toString();
    const ip = Math.round(150 + Math.random() * 40).toString() + ".0";
    const wins = Math.round(10 + Math.random() * 6);
    const losses = Math.round(5 + Math.random() * 6);
    
    return {
      role: "PITCHER",
      hand: displayHand,
      team: team,
      height: "6' 2\"",
      weight: "205 lbs",
      stats: { "ERA": era, "WHIP": whip, "SO": so, "IP": ip, "W-L": `${wins}-${losses}`, "WAR": (2.5 + Math.random() * 3).toFixed(1) }
    };
  } else {
    const avg = "." + Math.round(240 + Math.random() * 60).toString();
    const hr = Math.round(10 + Math.random() * 30).toString();
    const rbi = Math.round(40 + Math.random() * 60).toString();
    const obp = "." + Math.round(310 + Math.random() * 60).toString();
    const slg = "." + Math.round(380 + Math.random() * 150).toString();
    const ops = (parseFloat(obp) + parseFloat(slg)).toFixed(3);
    
    return {
      role: "BATTER",
      hand: displayHand,
      team: team,
      height: "6' 1\"",
      weight: "195 lbs",
      stats: { "AVG": avg, "HR": hr, "RBI": rbi, "OPS": ops, "OBP": obp, "SLG": slg }
    };
  }
}

function showPlayerStatsPopout(element, name, role, hand) {
  if (!element || !name || name === '--') return;

  // If there's already an active popout in this card, toggle it off
  const existing = element.querySelector('.player-card-popout');
  if (existing) {
    existing.remove();
    return;
  }

  // Remove any other active player card popouts on the page
  document.querySelectorAll('.player-card-popout').forEach(p => p.remove());

  // Ensure parent has relative positioning
  element.classList.add('relative');

  const details = getPlayerDetails(name, role, hand);
  const popout = document.createElement('div');
  popout.className = 'player-card-popout absolute top-0 left-0 w-full min-h-full h-fit bg-[#0f172a] border border-slate-700/60 rounded-xl p-2 z-[99] flex flex-col shadow-2xl transition-all duration-200 pointer-events-auto text-left select-none';

  const colorClass = details.role === 'PITCHER' ? 'text-purple-400' : 'text-cyan-400';
  
  let statsHtml = `
    <div class="flex justify-between items-center mb-1 text-[8px] font-mono-tech border-b border-white/10 pb-0.5">
      <span class="text-white uppercase font-bold truncate pr-1">${name}</span>
      <span class="btn-close-popout text-slate-400 hover:text-white cursor-pointer select-none font-bold text-[10px] px-1 font-mono">✕</span>
    </div>
    <div class="flex flex-col gap-0.5 font-mono-tech text-[9px]">
      <div class="flex justify-between items-center py-0.5 border-b border-white/5">
        <span class="text-slate-400 uppercase font-bold">Role</span>
        <span class="font-bold uppercase ${colorClass}">${details.role}</span>
      </div>
      <div class="flex justify-between items-center py-0.5 border-b border-white/5">
        <span class="text-slate-400 uppercase font-bold">Thr/Bat</span>
        <span class="font-bold text-white uppercase">${details.hand}</span>
      </div>
      <div class="flex justify-between items-center py-0.5 border-b border-white/5">
        <span class="text-slate-400 uppercase font-bold">Ht/Wt</span>
        <span class="font-bold text-white uppercase">${details.height} / ${details.weight}</span>
      </div>
  `;

  for (const [key, val] of Object.entries(details.stats)) {
    statsHtml += `
      <div class="flex justify-between items-center py-0.5 border-b border-white/5 last:border-b-0">
        <span class="text-slate-400 uppercase font-bold">${key}</span>
        <span class="font-bold text-amber-400">${val}</span>
      </div>
    `;
  }
  statsHtml += `</div>`;

  popout.innerHTML = statsHtml;
  element.appendChild(popout);

  // Setup click listener for the close button
  const closeBtn = popout.querySelector('.btn-close-popout');
  if (closeBtn) {
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      popout.remove();
    });
  }

  // Prevent parent click event from re-triggering when clicking inside the popout
  popout.addEventListener('click', (e) => {
    e.stopPropagation();
  });

  // Setup document-wide click listener to hide popout when clicking off
  const onDocumentClick = (e) => {
    if (!popout.contains(e.target) && !element.contains(e.target)) {
      popout.remove();
      document.removeEventListener('click', onDocumentClick);
    }
  };
  // Wait a tick to prevent the current click event from firing the document handler instantly
  setTimeout(() => {
    document.addEventListener('click', onDocumentClick);
  }, 10);
}

