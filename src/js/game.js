import * as THREE from 'three';
import { getObfuscatedPitches } from '../data/pitches.js';
import { ORIOLES_GAME_DATA } from '../data/orioles_game.js';
import { WEEKLY_CHALLENGE_DATA, WEEKLY_CHALLENGE_META } from '../data/weekly_challenge.js';
import { STANDINGS_BOARDS } from '../data/challenge_registry.js';
import {
  resolveWeeklyChallengeMeta,
  getPreviousIsoWeekKey,
  formatWeekLabel,
} from './challenge-utils.js';
import { DAILY_CHALLENGE_DATA } from '../data/daily_challenge.js';
import { CLOSE_CHALLENGE_DATA } from '../data/close_challenge.js';
import { fetchGamePitches, fetchAllGamesForDate } from './mlb-api.js';
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
  apiFetchLeaderboardPeriods,
  apiFetchCrewLeaderboard,
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
  LEVEL_TIERS,
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
let activeDailyDate = "";
let activeMlbGamePk = null;

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

// Rebuilt Streak Challenge Playlist Variables
let streakPlaylistABs = [];
let activeStreakAbIndex = 0;
let streakPitchHistory = [];
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
let challengeDetailModalOverlay, challengeDetailModalPanel, challengeDetailTitle, challengeDetailSubtitle, challengeDetailDesc;
let challengeDetailGamesCount, challengeDetailAbCount, challengeDetailCompleted, challengeDetailReset;
let challengeDetailGamesList;
let btnChallengeDetailClose, btnChallengeDetailPlay, btnChallengeDetailStandings, btnChallengeDetailLastWeek;
let btnInfoWeeklyChallenge, btnInfoStreakChallenge;

// Overlays
let abSummaryOverlay, abSummaryTitle, abSummarySubtitle, abSummaryMatchup, abSummaryAccuracy, abSummaryPitches, abSummaryBlurb, abSummaryFilmLink, abSummaryScorecardLink, btnAbSummaryAdvance;
let pauseScreen, btnResumeGame;
let matchupCard, cardPitcherName, cardPitcherHand, cardBatterName, cardBatterHand, replayBadge;

// Streak Summary Overlay variables
let streakSummaryOverlay, streakSummaryTitle, streakSummarySubtitle;
let streakSummaryPitcherImg, streakSummaryPitcherLogo, streakSummaryPitcherHandBadge, streakSummaryPitcherName;
let streakSummaryBatterImg, streakSummaryBatterLogo, streakSummaryBatterHandBadge, streakSummaryBatterName;
let streakSummaryFinalStreak, streakSummaryAccuracy, streakSummaryFraction;
let streakSummaryXpLevel, streakSummaryXpEarned, streakSummaryXpProgress, streakSummaryXpTotal, streakSummaryXpBar;
let btnStreakSummaryToggleReview, streakSummaryReview, streakSummaryPitchList, streakSummaryPitchDetails;
let streakSummaryZoneFrame, streakSummaryZoneDistance, streakSummaryMatrixSvg;
let streakSummarySvgZone, streakSummarySvgPitches, streakSummarySvgIndicators;
let streakSummaryBlurb, streakSummaryBestStreak, streakSummaryLeaderboardSnippet;
let btnStreakSummaryAdvance, streakSummaryFilmLink, streakSummaryScorecardLink, btnStreakSummaryHome;
let streakSummaryReviewExpanded = false;
let streakSummarySelectedPitchIndex = null;

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
let leaderBtnWeekly, leaderBtnDaily, leaderBtnCrew, leaderboardList;
let btnStandingsBack, btnStandingsHistory, standingsContextLabel, standingsCrewSeg;
let activeStandingsBoard = 'weekly';
let activeCrewMetric = 'rank';
let activeWeeklyPeriodKey = null;
let standingsViewMode = 'ranks';
let cachedWeeklyPeriods = null;
let weeklyChallengeMeta = null;
let challengeDetailModalOpen = false;

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

/** Normalize R/L/RHP/LHP/RHB/LHB into display label + badge class. */
function formatHandBadge(hand, role) {
  const isPitcher = role === 'pitcher';
  const isLeft = String(hand || '').toUpperCase().includes('L');
  const label = isPitcher ? (isLeft ? 'LHP' : 'RHP') : (isLeft ? 'LHB' : 'RHB');
  const modifier = isPitcher ? (isLeft ? 'lhp' : 'rhp') : (isLeft ? 'lhb' : 'rhb');
  return {
    label,
    className: `ab-summary-hand-badge ab-summary-hand-badge--${modifier}`
  };
}

function applyHandBadge(el, hand, role) {
  if (!el) return;
  const { label, className } = formatHandBadge(hand, role);
  el.textContent = label;
  el.className = className;
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
  if (challengeTrackerHud) {
    setOverlayVisible(challengeTrackerHud, !hide);
  }
}

function setAbStartOverlayActive(active) {
  document.body.classList.toggle('ab-start-active', active);
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


function updateHudHandleText(el, text) {
  if (!el) return;
  el.textContent = text;
  
  const len = text.length;
  if (len > 10) {
    el.style.fontSize = 'clamp(11px, 3.8vw, 18px)';
  } else if (len > 8) {
    el.style.fontSize = 'clamp(14px, 4.4vw, 22px)';
  } else {
    el.style.fontSize = ''; // use stylesheet default
  }
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
    history: stats.history || [],
  });

  if (cloud.favoriteTeam && cloud.favoriteTeam !== 'none') {
    activeFavoriteTeam = cloud.favoriteTeam;
    localStorage.setItem('pitch_ump_favorite_team', cloud.favoriteTeam);
    updateXpBarColors();
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
      '{"overallAccuracy":null,"maxStreak":0,"completedWeekly":0,"history":[]}'
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

  // If welcome screen is active, do a smooth transition-in of the resume panel and daily claim
  const welcomeScreenActive = currentState === STATES.WELCOME || (welcomeScreen && !welcomeScreen.classList.contains('hidden') && welcomeScreen.style.display !== 'none');
  const loginFields = document.getElementById('welcome-login-fields');
  const resumeContainer = document.getElementById('welcome-resume-container');
  const welcomeStartBtn = document.getElementById('btn-welcome-start');
  const insertCoinText = document.querySelector('.animate-flash-text');
  
  if (welcomeScreenActive && loginFields && resumeContainer) {
    // Fade out login fields
    loginFields.style.opacity = '0';
    loginFields.style.transition = 'opacity 0.3s ease';
    
    setTimeout(() => {
      loginFields.classList.add('hidden');
      
      const resumeHandle = document.getElementById('welcome-resume-handle');
      if (resumeHandle) resumeHandle.textContent = normalized.toUpperCase();
      
      const statsKey = getStatsStorageKey(normalized);
      const userStats = JSON.parse(localStorage.getItem(statsKey) || '{"overallAccuracy":null,"maxStreak":0,"completedWeekly":0,"history":[]}');
      
      let xp = userStats.xp !== undefined ? userStats.xp : 0;
      
      const today = new Date().toLocaleDateString();
      const loginBonusKey = `daily_login_bonus_${normalized}_${today}`;
      const isBonusClaimed = localStorage.getItem(loginBonusKey) === 'claimed';
      
      const xpProgress = getXpProgressInLevel(xp);
      
      const welcomeLevel = document.getElementById('welcome-resume-level');
      const welcomeXpText = document.getElementById('welcome-resume-xp-text');
      const welcomeXpBar = document.getElementById('welcome-resume-xp-bar');
      const welcomeAccuracy = document.getElementById('welcome-resume-accuracy');
      const welcomeStreak = document.getElementById('welcome-resume-streak');
      
      if (welcomeLevel) applyLevelBadgeElement(welcomeLevel, xpProgress.level);
      if (welcomeXpText) welcomeXpText.textContent = `${xpProgress.progress} / ${XP_PER_LEVEL} XP`;
      setXpBarPercent(welcomeXpBar, xpProgress.pct, false); // display initial width without transition
      if (welcomeAccuracy) {
        welcomeAccuracy.textContent = userStats.overallAccuracy !== null && userStats.overallAccuracy !== undefined 
          ? `${userStats.overallAccuracy}%` 
          : "--";
      }
      if (welcomeStreak) {
        welcomeStreak.textContent = `${userStats.maxStreak || 0} Pitches`;
      }
      
      const bonusStatus = document.getElementById('welcome-login-bonus-status');
      const bonusCheck = document.getElementById('welcome-login-bonus-check');
      
      if (!isBonusClaimed) {
        if (bonusStatus) bonusStatus.textContent = "READY TO CLAIM (+100 XP)";
        if (bonusCheck) {
          bonusCheck.textContent = "CLAIM NOW";
          bonusCheck.className = "px-2.5 py-1 text-[9px] sm:text-[10px] font-mono-tech font-extrabold uppercase tracking-widest rounded border transition-all pointer-events-auto shrink-0 ml-2 select-none min-h-[30px] flex items-center justify-center bonus-btn-unclaimed";
          bonusCheck.removeAttribute('disabled');
          bonusCheck.style.pointerEvents = 'auto';
        }
      } else {
        if (bonusStatus) bonusStatus.textContent = "CLAIMED (+100 XP)";
        if (bonusCheck) {
          bonusCheck.textContent = "CLAIMED";
          bonusCheck.className = "px-2.5 py-1 text-[9px] sm:text-[10px] font-mono-tech font-extrabold uppercase tracking-widest rounded border transition-all pointer-events-auto shrink-0 ml-2 select-none min-h-[30px] flex items-center justify-center bonus-btn-claimed";
          bonusCheck.setAttribute('disabled', 'true');
          bonusCheck.style.pointerEvents = 'none';
        }
      }
      
      resumeContainer.classList.remove('hidden');
      resumeContainer.style.opacity = '0';
      resumeContainer.style.transition = 'opacity 0.3s ease';
      resumeContainer.classList.add('flex');
      resumeContainer.offsetHeight; // force reflow
      resumeContainer.style.opacity = '1';
      
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
      refreshWelcomeStatsFromCloud();
    }, 300);
  } else {
    if (activeFavoriteTeam) {
      transitionToState(STATES.START);
    } else {
      transitionToState(STATES.TEAM_SELECT);
    }
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
    updateXpBarColors();
    updateProfileStatsUI();
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
  weeklyChallengeMeta = resolveWeeklyChallengeMeta(WEEKLY_CHALLENGE_DATA, WEEKLY_CHALLENGE_META);
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
        updateXpBarColors();
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

  hideAppLaunchLoader();

  if (window.location.search.includes('run_test=1')) {
    console.log("TEST: Initiating automated integration test...");
    setTimeout(() => runAutomatedIntegrationTest(), 1000);
  }
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
  challengeDetailModalPanel = document.getElementById('challenge-detail-modal-panel');
  challengeDetailTitle = document.getElementById('challenge-detail-title');
  challengeDetailSubtitle = document.getElementById('challenge-detail-subtitle');
  challengeDetailDesc = document.getElementById('challenge-detail-desc');
  challengeDetailGamesCount = document.getElementById('challenge-detail-games-count');
  challengeDetailAbCount = document.getElementById('challenge-detail-ab-count');
  challengeDetailCompleted = document.getElementById('challenge-detail-completed');
  challengeDetailReset = document.getElementById('challenge-detail-reset');
  challengeDetailGamesList = document.getElementById('challenge-detail-games-list');
  btnChallengeDetailClose = document.getElementById('btn-challenge-detail-close');
  btnChallengeDetailPlay = document.getElementById('btn-challenge-detail-play');
  btnChallengeDetailStandings = document.getElementById('btn-challenge-detail-standings');
  btnChallengeDetailLastWeek = document.getElementById('btn-challenge-detail-last-week');

  // Overlays
  abSummaryOverlay = document.getElementById('ab-summary-overlay');
  abSummaryTitle = document.getElementById('ab-summary-title');
  abSummarySubtitle = document.getElementById('ab-summary-subtitle');
  abSummaryMatchup = document.getElementById('ab-summary-matchup');
  abSummaryAccuracy = document.getElementById('ab-summary-accuracy');
  abSummaryPitches = document.getElementById('ab-summary-pitches');
  abSummaryBlurb = document.getElementById('ab-summary-blurb');
  abSummaryFilmLink = document.getElementById('ab-summary-film-link');
  abSummaryScorecardLink = document.getElementById('ab-summary-scorecard-link');
  btnAbSummaryAdvance = document.getElementById('btn-ab-summary-advance');

  // Streak Summary Overlay elements
  streakSummaryOverlay = document.getElementById('streak-summary-overlay');
  streakSummaryTitle = document.getElementById('streak-summary-title');
  streakSummarySubtitle = document.getElementById('streak-summary-subtitle');
  streakSummaryPitcherImg = document.getElementById('streak-summary-pitcher-img');
  streakSummaryPitcherLogo = document.getElementById('streak-summary-pitcher-logo');
  streakSummaryPitcherName = document.getElementById('streak-summary-pitcher-name');
  streakSummaryPitcherHandBadge = document.getElementById('streak-summary-pitcher-hand-badge');
  streakSummaryBatterImg = document.getElementById('streak-summary-batter-img');
  streakSummaryBatterLogo = document.getElementById('streak-summary-batter-logo');
  streakSummaryBatterName = document.getElementById('streak-summary-batter-name');
  streakSummaryBatterHandBadge = document.getElementById('streak-summary-batter-hand-badge');
  streakSummaryFinalStreak = document.getElementById('streak-summary-final-streak');
  streakSummaryAccuracy = document.getElementById('streak-summary-accuracy');
  streakSummaryFraction = document.getElementById('streak-summary-fraction');
  streakSummaryXpLevel = document.getElementById('streak-summary-xp-level');
  streakSummaryXpEarned = document.getElementById('streak-summary-xp-earned');
  streakSummaryXpProgress = document.getElementById('streak-summary-xp-progress');
  streakSummaryXpTotal = document.getElementById('streak-summary-xp-total');
  streakSummaryXpBar = document.getElementById('streak-summary-xp-bar');
  btnStreakSummaryToggleReview = document.getElementById('btn-streak-summary-toggle-review');
  streakSummaryReview = document.getElementById('streak-summary-review');
  streakSummaryPitchList = document.getElementById('streak-summary-pitch-list');
  streakSummaryPitchDetails = document.getElementById('streak-summary-pitch-details');
  streakSummaryZoneDistance = document.getElementById('streak-summary-zone-distance');
  streakSummaryMatrixSvg = document.getElementById('streak-summary-matrix-svg');
  streakSummarySvgZone = document.getElementById('streak-summary-svg-zone');
  streakSummarySvgPitches = document.getElementById('streak-summary-svg-pitches');
  streakSummarySvgIndicators = document.getElementById('streak-summary-svg-indicators');
  streakSummaryBlurb = document.getElementById('streak-summary-blurb');
  streakSummaryBestStreak = document.getElementById('streak-summary-best-streak');
  streakSummaryLeaderboardSnippet = document.getElementById('streak-summary-leaderboard-snippet');
  btnStreakSummaryAdvance = document.getElementById('btn-streak-summary-advance');
  streakSummaryFilmLink = document.getElementById('streak-summary-film-link');
  streakSummaryScorecardLink = document.getElementById('streak-summary-scorecard-link');
  btnStreakSummaryHome = document.getElementById('btn-streak-summary-home');
  streakSummaryZoneFrame = document.getElementById('streak-summary-zone-frame');

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

  if (btnStreakSummaryToggleReview) {
    btnStreakSummaryToggleReview.addEventListener('click', () => {
      setStreakSummaryReviewExpanded(!streakSummaryReviewExpanded);
    });
  }

  if (streakSummaryZoneFrame) {
    streakSummaryZoneFrame.addEventListener('click', (e) => {
      if (e.target === streakSummaryZoneFrame || e.target.id === 'streak-summary-matrix-svg') {
        clearStreakSummaryPitchSelection();
      }
    });
  }

  if (btnStreakSummaryAdvance) {
    btnStreakSummaryAdvance.addEventListener('click', () => {
      initAudio();
      hideStreakSummaryScreen();
      startDailyStreakChallenge();
    });
  }

  if (btnStreakSummaryHome) {
    btnStreakSummaryHome.addEventListener('click', () => {
      initAudio();
      hideStreakSummaryScreen();
      goToMainMenu();
    });
  }

  const streakSummaryPitcherCard = document.getElementById('streak-summary-pitcher-card');
  if (streakSummaryPitcherCard) {
    streakSummaryPitcherCard.style.cursor = 'pointer';
    streakSummaryPitcherCard.addEventListener('click', (e) => {
      e.stopPropagation();
      initAudio();
      const nameEl = document.getElementById('streak-summary-pitcher-name');
      const handEl = document.getElementById('streak-summary-pitcher-hand-badge');
      if (nameEl) {
        showPlayerStatsPopout(streakSummaryPitcherCard, nameEl.textContent.trim(), 'PITCHER', handEl ? handEl.textContent.trim() : 'R');
      }
    });
  }

  const streakSummaryBatterCard = document.getElementById('streak-summary-batter-card');
  if (streakSummaryBatterCard) {
    streakSummaryBatterCard.style.cursor = 'pointer';
    streakSummaryBatterCard.addEventListener('click', (e) => {
      e.stopPropagation();
      initAudio();
      const nameEl = document.getElementById('streak-summary-batter-name');
      const handEl = document.getElementById('streak-summary-batter-hand-badge');
      if (nameEl) {
        showPlayerStatsPopout(streakSummaryBatterCard, nameEl.textContent.trim(), 'BATTER', handEl ? handEl.textContent.trim() : 'R');
      }
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
  leaderBtnCrew = document.getElementById('leader-btn-crew');
  btnStandingsBack = document.getElementById('btn-standings-back');
  btnStandingsHistory = document.getElementById('btn-standings-history');
  standingsContextLabel = document.getElementById('standings-context-label');
  standingsCrewSeg = document.getElementById('standings-crew-seg');
  leaderboardList = document.getElementById('leaderboard-list');

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
  
  if (handleVal.length > 12) {
    if (loginErrorMsg) {
      loginErrorMsg.textContent = "ERROR: HANDLE CANNOT EXCEED 12 CHARACTERS";
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
  // Profile & XP Widget click to toggle detailed popover
  const profileXpWidget = document.getElementById('hud-profile-xp-widget');
  if (profileXpWidget) {
    profileXpWidget.addEventListener('click', (e) => {
      e.stopPropagation();
      initAudio();
      toggleXpDetailsPopover();
    });
  }

  const btnCloseXpDetails = document.getElementById('btn-close-xp-details');
  if (btnCloseXpDetails) {
    btnCloseXpDetails.addEventListener('click', (e) => {
      e.stopPropagation();
      initAudio();
      toggleXpDetailsPopover(false);
    });
  }

  // Tab Switching Event Listeners
  if (tabBtnPlay) tabBtnPlay.addEventListener('click', () => { console.log('DEBUG: Clicked Play tab button'); switchTab('play'); });
  if (tabBtnLeaderboard) tabBtnLeaderboard.addEventListener('click', () => { console.log('DEBUG: Clicked Standings tab button'); switchTab('leaderboard'); });
  if (tabBtnStats) tabBtnStats.addEventListener('click', () => { console.log('DEBUG: Clicked Profile tab button'); switchTab('stats'); });

  // Weekly game cards button listener delegation
  document.querySelectorAll('.btn-play-game-ab').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      initAudio();
      const gameIdx = parseInt(e.target.getAttribute('data-game-idx'));
      startWeeklyChallengeGame(gameIdx);
    });
  });

  if (btnStartDailyStreak) {
    btnStartDailyStreak.addEventListener('click', async (e) => {
      e.stopPropagation();
      initAudio();
      await startDailyStreakChallenge();
    });
  }

  const streakChallengeCard = document.getElementById('streak-challenge-card');
  if (streakChallengeCard) {
    streakChallengeCard.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
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

  if (challengeDetailModalOverlay) {
    challengeDetailModalOverlay.addEventListener('click', (e) => {
      if (e.target === challengeDetailModalOverlay) {
        hideChallengeDetailModal();
      }
    });
  }
  if (challengeDetailModalPanel) {
    challengeDetailModalPanel.addEventListener('click', (e) => e.stopPropagation());
  }
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (challengeDetailModalOpen) hideChallengeDetailModal();
    hideStandingsXpPopover();
  });

  const standingsXpPopoverClose = document.getElementById('standings-xp-popover-close');
  if (standingsXpPopoverClose) {
    standingsXpPopoverClose.addEventListener('click', (e) => {
      e.stopPropagation();
      hideStandingsXpPopover();
    });
  }
  document.addEventListener('click', (e) => {
    const pop = document.getElementById('standings-xp-popover');
    if (!pop || pop.classList.contains('hidden')) return;
    if (pop.contains(e.target) || e.target.closest('.standings-row__level')) return;
    hideStandingsXpPopover();
  });

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
        const confirmed = await showCustomConfirm("This will end your current streak run! Are you sure you want to exit?");
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

      if (gameMode === 'weekly_challenge') {
        startWeeklyChallengeGame(activeGameIndex);
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
        const confirmed = await showCustomConfirm("This will end your current streak run! Are you sure you want to exit?");
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
    btnStartWeeklyChallenge.addEventListener('click', async (e) => {
      e.stopPropagation();
      initAudio();
      await startWeeklyChallenge();
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
    btnPreviewModalStart.addEventListener('click', async (e) => {
      e.stopPropagation();
      initAudio();
      const callback = window._onPreviewStartCallback;
      window._onPreviewStartCallback = null;
      hideGamePreviewModal();
      if (callback) {
        await callback();
      }
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
        const confirmed = await showCustomConfirm("This will end your current streak run! Are you sure you want to exit?");
        if (!confirmed) return;
      }
      initAudio();
      setAbStartOverlayActive(false);
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
    btnWelcomeStart.addEventListener('click', async (e) => {
      e.stopPropagation();
      initAudio();
      
      const loggedIn = !!localStorage.getItem('ump_username');
      if (loggedIn) {
        const username = localStorage.getItem('ump_username');
        const today = new Date().toLocaleDateString();
        const loginBonusKey = `daily_login_bonus_${username}_${today}`;
        const isBonusClaimed = localStorage.getItem(loginBonusKey) === 'claimed';
        
        // Play arcade resume sequence
        playCoinSound();
        playUmpireVocalCall('STRIKE');
        playMenuTransitionSound();

        if (!isBonusClaimed) {
          await performDailyClaimAndTransition(username);
        }

        if (activeFavoriteTeam) {
          transitionToState(STATES.START);
        } else {
          transitionToState(STATES.TEAM_SELECT);
        }
      } else {
        submitLoginAction();
      }
    });
  }

  const welcomeLoginBonusCheck = document.getElementById('welcome-login-bonus-check');
  if (welcomeLoginBonusCheck) {
    welcomeLoginBonusCheck.addEventListener('click', async (e) => {
      e.stopPropagation();
      initAudio();
      const username = localStorage.getItem('ump_username');
      if (username) {
        const today = new Date().toLocaleDateString();
        const loginBonusKey = `daily_login_bonus_${username}_${today}`;
        const isBonusClaimed = localStorage.getItem(loginBonusKey) === 'claimed';
        if (!isBonusClaimed) {
          await performDailyClaimAndTransition(username);
        }
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
    updateXpBarColors();
    updateProfileStatsUI();
    initProfileSettingsUI();
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
    leaderBtnWeekly.addEventListener('click', () => {
      activeStandingsBoard = 'weekly';
      standingsViewMode = 'ranks';
      const meta = weeklyChallengeMeta || resolveWeeklyChallengeMeta(WEEKLY_CHALLENGE_DATA, WEEKLY_CHALLENGE_META);
      activeWeeklyPeriodKey = meta.challengeWeekId;
      renderLeaderboard('weekly');
    });
  }
  if (leaderBtnDaily) {
    leaderBtnDaily.addEventListener('click', () => {
      activeStandingsBoard = 'daily';
      standingsViewMode = 'ranks';
      renderLeaderboard('daily');
    });
  }
  if (leaderBtnCrew) {
    leaderBtnCrew.addEventListener('click', () => {
      activeStandingsBoard = 'crew';
      standingsViewMode = 'ranks';
      renderLeaderboard('crew');
    });
  }
  if (btnStandingsBack) {
    btnStandingsBack.addEventListener('click', () => {
      if (standingsViewMode === 'history' || standingsViewMode === 'alltime') {
        standingsViewMode = 'ranks';
        activeWeeklyPeriodKey = getCurrentChallengeWeekId();
        renderLeaderboard(activeStandingsBoard);
        return;
      }
      if (activeStandingsBoard === 'weekly' && activeWeeklyPeriodKey !== getCurrentChallengeWeekId()) {
        standingsViewMode = 'history';
        renderLeaderboard('weekly');
      }
    });
  }
  if (btnStandingsHistory) {
    btnStandingsHistory.addEventListener('click', () => {
      if (activeStandingsBoard === 'weekly') {
        standingsViewMode = 'history';
        renderLeaderboard('weekly');
      } else if (activeStandingsBoard === 'daily') {
        standingsViewMode = 'alltime';
        renderLeaderboard('daily');
      }
    });
  }
  if (standingsCrewSeg) {
    standingsCrewSeg.querySelectorAll('[data-crew-metric]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (activeStandingsBoard !== 'crew') return;
        activeCrewMetric = btn.getAttribute('data-crew-metric') || 'rank';
        standingsCrewSeg.querySelectorAll('[data-crew-metric]').forEach((b) => {
          b.classList.toggle('standings-seg__btn--active', b === btn);
        });
        renderLeaderboard('crew');
      });
    });
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
        renderDashboardGamesList();
        transitionToState(STATES.START);
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

    // Check if Streak summary is open!
    if (streakSummaryOverlay && streakSummaryOverlay.classList.contains('opacity-100')) {
      if (e.key === ' ') {
        e.preventDefault();
        initAudio();
        hideStreakSummaryScreen();
        startDailyStreakChallenge();
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
      
      // Ignore inputs when paused or menu is open
      const isStartScreenVisible = startScreen && !startScreen.classList.contains('opacity-0') && !startScreen.classList.contains('hidden');
      if (isGamePaused || isStartScreenVisible) {
        return;
      }
      
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

  const startScreenEl = document.getElementById('start-screen');
  if (startScreenEl) {
    startScreenEl.addEventListener('click', (e) => {
      if (currentState !== STATES.START && currentState !== STATES.WELCOME && currentState !== STATES.TEAM_SELECT) return;
      e.stopPropagation();
    });
    startScreenEl.addEventListener('touchend', (e) => {
      if (currentState !== STATES.START && currentState !== STATES.WELCOME && currentState !== STATES.TEAM_SELECT) return;
      e.stopPropagation();
    });
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
 * Asynchronously performs daily login claim animation, awards XP, and transitions to the main dashboard/team select.
 */
async function performDailyClaimAndTransition(username) {
  const bonusStatus = document.getElementById('welcome-login-bonus-status');
  const bonusCheck = document.getElementById('welcome-login-bonus-check');
  const welcomeXpBar = document.getElementById('welcome-resume-xp-bar');
  const welcomeXpText = document.getElementById('welcome-resume-xp-text');
  const welcomeLevel = document.getElementById('welcome-resume-level');
  const bonusContainer = document.getElementById('welcome-login-bonus-container');

  const statsKey = getStatsStorageKey(username);
  const userStats = JSON.parse(localStorage.getItem(statsKey) || '{"overallAccuracy":null,"maxStreak":0,"completedWeekly":0,"history":[]}');
  const oldXp = userStats.xp || 0;
  const oldProgress = getXpProgressInLevel(oldXp);

  const today = new Date().toLocaleDateString();
  const loginBonusKey = `daily_login_bonus_${username}_${today}`;

  if (bonusContainer) bonusContainer.classList.add('animate-claim-success');
  if (bonusStatus) bonusStatus.textContent = 'CLAIMING...';
  if (bonusCheck) {
    bonusCheck.textContent = 'CLAIMING...';
    bonusCheck.className = 'px-2.5 py-1 text-[9px] sm:text-[10px] font-mono-tech font-extrabold uppercase tracking-widest rounded border transition-all pointer-events-auto shrink-0 ml-2 select-none min-h-[30px] flex items-center justify-center bonus-btn-claiming';
    bonusCheck.setAttribute('disabled', 'true');
    bonusCheck.style.pointerEvents = 'none';
  }

  playCoinSound();
  await new Promise((resolve) => setTimeout(resolve, 200));

  try {
    localStorage.setItem(loginBonusKey, 'claimed');
    await awardXP(100);
    showFloatingXP(100, 'DAILY LOGIN BONUS! +100 XP');
  } catch (err) {
    console.error('Daily login bonus claim failed:', err);
    localStorage.removeItem(loginBonusKey);
    if (bonusStatus) bonusStatus.textContent = 'CLAIM FAILED — TAP TO RETRY';
    if (bonusCheck) {
      bonusCheck.textContent = 'CLAIM NOW';
      bonusCheck.className = 'px-2.5 py-1 text-[9px] sm:text-[10px] font-mono-tech font-extrabold uppercase tracking-widest rounded border transition-all pointer-events-auto shrink-0 ml-2 select-none min-h-[30px] flex items-center justify-center bonus-btn-unclaimed';
      bonusCheck.removeAttribute('disabled');
      bonusCheck.style.pointerEvents = 'auto';
    }
    if (toastMessage) {
      toastMessage.innerHTML = '<span class="text-red-300 font-bold font-mono-tech">BONUS CLAIM FAILED — TRY AGAIN</span>';
      toastMessage.classList.remove('opacity-0', 'scale-95', '-translate-y-4');
      toastMessage.classList.add('opacity-100', 'scale-100', 'translate-y-0');
      setTimeout(() => {
        toastMessage.classList.add('opacity-0', 'scale-95', '-translate-y-4');
        toastMessage.classList.remove('opacity-100', 'scale-100', 'translate-y-0');
      }, 2800);
    }
    return;
  }

  const newStats = JSON.parse(localStorage.getItem(statsKey) || '{"overallAccuracy":null,"maxStreak":0,"completedWeekly":0,"history":[]}');
  const newXp = newStats.xp || 0;
  const newProgress = getXpProgressInLevel(newXp);

  if (bonusStatus) bonusStatus.textContent = 'CLAIMED (+100 XP)';
  if (bonusCheck) {
    bonusCheck.textContent = 'CLAIMED';
    bonusCheck.className = 'px-2.5 py-1 text-[9px] sm:text-[10px] font-mono-tech font-extrabold uppercase tracking-widest rounded border transition-all pointer-events-auto shrink-0 ml-2 select-none min-h-[30px] flex items-center justify-center bonus-btn-claimed';
    bonusCheck.setAttribute('disabled', 'true');
    bonusCheck.style.pointerEvents = 'none';
  }

  if (newProgress.level > oldProgress.level) {
    setXpBarPercent(welcomeXpBar, 100, true);
    if (welcomeXpText) welcomeXpText.textContent = `${XP_PER_LEVEL} / ${XP_PER_LEVEL} XP`;
    await new Promise((resolve) => setTimeout(resolve, 1100));
    if (welcomeXpBar) {
      welcomeXpBar.style.transition = 'none';
      welcomeXpBar.style.width = '0%';
    }
    if (welcomeLevel) applyLevelBadgeElement(welcomeLevel, newProgress.level);
    if (welcomeXpText) welcomeXpText.textContent = `0 / ${XP_PER_LEVEL} XP`;
    await new Promise((resolve) => setTimeout(resolve, 50));
    setXpBarPercent(welcomeXpBar, newProgress.pct, true);
    if (welcomeXpText) welcomeXpText.textContent = `${newProgress.progress} / ${XP_PER_LEVEL} XP`;
  } else {
    setXpBarPercent(welcomeXpBar, newProgress.pct, true);
    if (welcomeXpText) welcomeXpText.textContent = `${newProgress.progress} / ${XP_PER_LEVEL} XP`;
  }

  setTimeout(() => {
    if (bonusContainer) bonusContainer.classList.remove('animate-claim-success');
  }, 1200);
}

/**
 * Updates welcome screen depending on active session state (credentials login vs resume session)
 */
async function refreshWelcomeStatsFromCloud() {
  const storedUser = localStorage.getItem('ump_username');
  if (!storedUser) return;

  try {
    const stats = await getGlobalUserStats(storedUser);
    const xp = stats.xp !== undefined ? stats.xp : 0;
    const xpProgress = getXpProgressInLevel(xp);

    const welcomeLevel = document.getElementById('welcome-resume-level');
    const welcomeXpText = document.getElementById('welcome-resume-xp-text');
    const welcomeXpBar = document.getElementById('welcome-resume-xp-bar');
    const welcomeAccuracy = document.getElementById('welcome-resume-accuracy');
    const welcomeStreak = document.getElementById('welcome-resume-streak');

    if (welcomeLevel) applyLevelBadgeElement(welcomeLevel, xpProgress.level);
    if (welcomeXpText) welcomeXpText.textContent = `${xpProgress.progress} / ${XP_PER_LEVEL} XP`;
    setXpBarPercent(welcomeXpBar, xpProgress.pct, false);
    if (welcomeAccuracy) {
      welcomeAccuracy.textContent =
        stats.overallAccuracy !== null && stats.overallAccuracy !== undefined
          ? `${stats.overallAccuracy}%`
          : '--';
    }
    if (welcomeStreak) welcomeStreak.textContent = `${stats.maxStreak || 0} Pitches`;
  } catch (e) {
    console.warn('Could not refresh welcome stats from cloud:', e);
  }
}

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
    const userStats = JSON.parse(localStorage.getItem(statsKey) || '{"overallAccuracy":null,"maxStreak":0,"completedWeekly":0,"history":[]}');
    
    let xp = userStats.xp !== undefined ? userStats.xp : 0;
    if (userStats.xp === undefined) {
      const history = userStats.history || [];
      history.forEach(h => {
        const isWeekly = h.gameName && h.gameName.includes("Weekly");
        const isStreak = h.gameName && h.gameName.includes("Streak");
        
        if (isWeekly) xp += (h.correctCalls || 0) * 10;
        else if (isStreak) xp += (h.correctCalls || 0) * 15;
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

    // Handle Daily Login Bonus Claim Display (Do NOT auto-claim)
    const today = new Date().toLocaleDateString();
    const loginBonusKey = `daily_login_bonus_${storedUser}_${today}`;
    const isBonusClaimed = localStorage.getItem(loginBonusKey) === 'claimed';
    
    const bonusStatus = document.getElementById('welcome-login-bonus-status');
    const bonusCheck = document.getElementById('welcome-login-bonus-check');
    
    if (!isBonusClaimed) {
      if (bonusStatus) bonusStatus.textContent = "READY TO CLAIM (+100 XP)";
      if (bonusCheck) {
        bonusCheck.textContent = "CLAIM NOW";
        bonusCheck.className = "px-2.5 py-1 text-[9px] sm:text-[10px] font-mono-tech font-extrabold uppercase tracking-widest rounded border transition-all pointer-events-auto shrink-0 ml-2 select-none min-h-[30px] flex items-center justify-center bonus-btn-unclaimed";
        bonusCheck.removeAttribute('disabled');
        bonusCheck.style.pointerEvents = 'auto';
      }
    } else {
      if (bonusStatus) bonusStatus.textContent = "CLAIMED (+100 XP)";
      if (bonusCheck) {
        bonusCheck.textContent = "CLAIMED";
        bonusCheck.className = "px-2.5 py-1 text-[9px] sm:text-[10px] font-mono-tech font-extrabold uppercase tracking-widest rounded border transition-all pointer-events-auto shrink-0 ml-2 select-none min-h-[30px] flex items-center justify-center bonus-btn-claimed";
        bonusCheck.setAttribute('disabled', 'true');
        bonusCheck.style.pointerEvents = 'none';
      }
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
    refreshWelcomeStatsFromCloud();
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

function transitionToState(newState, options = {}) {
  const { deferNavUpdate = false } = options;
  const oldState = currentState;
  currentState = newState;
  console.log('DEBUG TRANSITION:', oldState, '->', newState, 'activeFavoriteTeam:', activeFavoriteTeam);
  console.log('DEBUG TRANSITION STACK:\n', new Error().stack);
  const loggedIn = !!localStorage.getItem('ump_username');
  
  if (newState === STATES.WELCOME) {
    updateWelcomeScreenState();
  } else {
    if (demoPitchActive) {
      demoPitchActive = false;
      showBall(false);
      animatePitcherWindup(0, demoPitchData ? demoPitchData.pitcher_hand : 'R');
    }
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
    setCameraAngle('umpire');
  } else if (newState === STATES.START) {
    setOverlayVisible(welcomeScreen, false);
    setOverlayVisible(teamSelectScreen, false);
    setOverlayVisible(startScreen, true);
    isSettingsOpen = false;
    updateSettingsVisibility();
    switchTab('play');
    setCameraAngle('umpire');
  } else {
    setOverlayVisible(welcomeScreen, false);
    setOverlayVisible(teamSelectScreen, false);
    setOverlayVisible(startScreen, false);
  }

  // Update unified top nav bar context
  if (!deferNavUpdate) {
    updateUnifiedTopNav(newState);
  }
  
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
        } else if (gameMode === 'weekly_challenge' || gameMode === 'mlb_game') {
          if (inningCard) inningCard.classList.add('hidden');
          if (weeklyPlaylistABs.length === 0) {
            if (gameMode === 'weekly_challenge') {
              const rawABs = extractAtBatsFromWeeklyData();
              weeklyPlaylistABs = [...rawABs];
            }
          }
          const abData = weeklyPlaylistABs[activeWeeklyAbIndex] || weeklyPlaylistABs[0];
          pitchesList = getAbPitches(abData);
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
      } else if (gameMode === 'weekly_challenge') {
        const total = weeklyPlaylistABs.length || 16;
        pitchCounterText.textContent = `WEEKLY CHALLENGE | AB ${activeWeeklyAbIndex + 1} OF ${total}`;
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
        
        if (cardPitcherName) {
          const pParts = matchup.pitcher.trim().split(/\s+/);
          const pLastName = pParts[pParts.length - 1];
          setMarqueePlayerName(cardPitcherName, '.card-pitcher-name-dup', matchup.pitcher, { uppercase: true });
          cardPitcherName.setAttribute('data-lastname', pLastName.toUpperCase());
        }
        if (cardPitcherHand) {
          const formattedPh = pH.includes("L") ? "LHP" : "RHP";
          cardPitcherHand.textContent = formattedPh;
          cardPitcherHand.className = formattedPh === "RHP"
            ? "ab-summary-hand-badge ab-summary-hand-badge--rhp"
            : "ab-summary-hand-badge ab-summary-hand-badge--lhp";
        }
        if (cardBatterName) {
          const bParts = matchup.batter.trim().split(/\s+/);
          const bLastName = bParts[bParts.length - 1];
          setMarqueePlayerName(cardBatterName, '.card-batter-name-dup', matchup.batter, { uppercase: true });
          cardBatterName.setAttribute('data-lastname', bLastName.toUpperCase());
        }
        if (cardBatterHand) {
          const formattedBh = bH.includes("L") ? "LHB" : "RHB";
          cardBatterHand.textContent = formattedBh;
          cardBatterHand.className = formattedBh === "LHB"
            ? "ab-summary-hand-badge ab-summary-hand-badge--lhb"
            : "ab-summary-hand-badge ab-summary-hand-badge--rhb";
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
            
            // Calculate and award XP
            let xpGained = 0;
            let customFloatText = null;
            if (isCorrect) {
              xpGained += 10;
            }
            if (abEnded) {
              const abPitches = pitchHistory.slice(currentAbStartHistoryIndex);
              const allCorrect = abPitches.length > 0 && abPitches.every(p => p.userCorrect);
              if (allCorrect) {
                xpGained += 50;
                customFloatText = `PERFECT AT-BAT! +${xpGained} XP`;
              }
            }
            if (xpGained > 0) {
              awardXP(xpGained);
              showFloatingXP(xpGained, customFloatText);
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
  
  if (gameMode === 'daily_streak') {
    const lastItem = pitchHistory[pitchHistory.length - 1];
    if (lastItem) streakPitchHistory.push(lastItem);
  }
  
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
  
  // Live stats updating for real-time UmpCard plotting and metrics
  const username = localStorage.getItem('ump_username');
  if (username) {
    const statsKey = getStatsStorageKey(username);
    let userStats = JSON.parse(localStorage.getItem(statsKey) || '{"overallAccuracy":null,"maxStreak":0,"completedWeekly":0,"history":[]}');
    
    if (!userStats.recentPitches) userStats.recentPitches = [];
    
    let pitchClass = 'Fastball';
    const rawType = currentPitch.pitch_type || '';
    if (rawType.includes('Slider') || rawType.includes('Curve') || rawType.includes('Sweeper') || rawType.includes('Slurve') || rawType.includes('SL') || rawType.includes('CU') || rawType.includes('KC') || rawType.includes('ST') || rawType.includes('SV')) {
      pitchClass = 'Breaking';
    } else if (rawType.includes('Change') || rawType.includes('Split') || rawType.includes('Fork') || rawType.includes('CH') || rawType.includes('FS')) {
      pitchClass = 'Offspeed';
    }
    
    const distFt = getDistanceToABSZone(pitchTrajectory.crossPoint.x, pitchTrajectory.crossPoint.y);
    const isBorderline = Math.abs(distFt) <= 0.15;
    
    let isSqueeze = (absCall === 'S' && userCall === 'B');
    let isExpansion = (absCall === 'B' && userCall === 'S');
    const todayStr = new Date().toISOString().slice(0, 10);

    userStats.recentPitches.push({
      x: pitchTrajectory.crossPoint.x,
      y: pitchTrajectory.crossPoint.y,
      userCorrect,
      absCall,
      userCall,
      pitchClass,
      isBorderline,
      isSqueeze,
      isExpansion,
      date: todayStr
    });
    
    if (userStats.recentPitches.length > 100) {
      userStats.recentPitches = userStats.recentPitches.slice(-100);
    }
    
    // Calculate live accuracy combining history, completed weekly ABs, & current active session
    let totalCallsSum = 0;
    let totalCorrectSum = 0;
    
    // Add current session's active AB calls
    const currentSessionCalled = pitchHistory.filter(x => !x.isSwingPlay);
    totalCallsSum += currentSessionCalled.length;
    totalCorrectSum += currentSessionCalled.filter(x => x.userCorrect).length;
    
    // Add previously completed weekly ABs in this match (not yet in history)
    if (gameMode === 'weekly_challenge' && weeklyPlaylistABs) {
      weeklyPlaylistABs.forEach((ab, idx) => {
        if (ab.completed && idx !== activeWeeklyAbIndex) {
          totalCallsSum += ab.userTotalCount || 0;
          totalCorrectSum += ab.userCorrectCount || 0;
        }
      });
    }
    
    // Add all previously completed game sessions from history
    if (userStats.history) {
      userStats.history.forEach(h => {
        totalCallsSum += h.totalCalls;
        totalCorrectSum += h.correctCalls;
      });
    }
    userStats.overallAccuracy = totalCallsSum > 0 ? Math.round((totalCorrectSum / totalCallsSum) * 100) : 100;
    
    // Calculate live max streak across current session + all history
    let currentStreak = 0;
    let maxSessionStreak = 0;
    currentSessionCalled.forEach(p => {
      if (p.userCorrect) {
        currentStreak++;
        if (currentStreak > maxSessionStreak) maxSessionStreak = currentStreak;
      } else {
        currentStreak = 0;
      }
    });
    if (maxSessionStreak > (userStats.maxStreak || 0)) {
      userStats.maxStreak = maxSessionStreak;
    }
    
    localStorage.setItem(statsKey, JSON.stringify(userStats));
  }
  
  if (gameMode === 'daily_streak') {
    const lastItem = pitchHistory[pitchHistory.length - 1];
    if (lastItem) streakPitchHistory.push(lastItem);
  }
  
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
  if (!activeAbEnded) return;

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

  if (gameMode === 'daily_streak' && isSessionOver) {
    showStreakSummaryScreen();
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
  
  if (activeAbEnded) {
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
      if (gameMode === 'daily_streak' && isSessionOver) {
        showStreakSummaryScreen();
      } else {
        showAtBatSummaryScreen(lastAbOutcomeText);
      }
    } else {
      isTransitioningToSummary = true;
      cachedAbOutcomeText = lastAbOutcomeText; // Cache the outcome text
      if (summaryTimeout) clearTimeout(summaryTimeout);
      summaryTimeout = setTimeout(() => {
        summaryTimeout = null;
        isTransitioningToSummary = false;
        if (gameMode === 'daily_streak' && isSessionOver) {
          showStreakSummaryScreen();
        } else {
          showAtBatSummaryScreen(lastAbOutcomeText);
        }
      }, 600);
    }
  } else {
    if (isGameOver) {
      if (gameMode === 'daily_streak') {
        showStreakSummaryScreen();
      } else {
        transitionToState(STATES.SCOREBOARD);
      }
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
    applyHandBadge(abStartPitcherHand, pH, 'pitcher');
    applyHandBadge(abStartBatterHand, bH, 'batter');

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
      const { label: pitcherHandLabel } = formatHandBadge(pH, 'pitcher');
      const isLHP = pitcherHandLabel === 'LHP';
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
    } else if (gameMode === 'mlb_game') {
      challengeBadge.textContent = 'Play Any Game';
      challengeBadge.className = 'px-3 py-1 text-[10px] font-bold uppercase tracking-widest bg-gradient-to-r from-purple-600 to-indigo-600 rounded-full shadow-lg';
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
      if (gameMode === 'daily_streak') {
        const called = streakPitchHistory.filter(x => !x.isSwingPlay);
        const correct = called.filter(x => x.userCorrect).length;
        startSubtitle.textContent = `Current Streak: ${correct} Pitch${correct !== 1 ? 'es' : ''}`;
      } else {
        startSubtitle.textContent = 'Make the call';
      }
    }
  }

  if (startTitle) {
    if (gameMode === 'weekly_challenge') {
      const total = weeklyPlaylistABs.length || 200;
      startTitle.textContent = isResume 
        ? `RESUME: AT-BAT ${activeWeeklyAbIndex + 1} OF ${total}` 
        : `NEXT: AT-BAT ${activeWeeklyAbIndex + 1} OF ${total}`;
    } else if (gameMode === 'daily_streak') {
      startTitle.textContent = isResume 
        ? `RESUME: AT-BAT ${activeStreakAbIndex + 1}` 
        : `NEXT: AT-BAT ${activeStreakAbIndex + 1}`;
    } else {
      startTitle.textContent = isResume ? 'At-bat in progress' : 'Upcoming at-bat';
    }
  }

  // Show overlay with transition
  setAbStartOverlayActive(true);
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
    setAbStartOverlayActive(false);
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
    setAbStartOverlayActive(false);
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
  } else if (gameMode === 'weekly_challenge') {
    const total = weeklyPlaylistABs.length || 16;
    const prefix = 'WEEKLY CHALLENGE';
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
  if (absTeamLogo) {
    absTeamLogo.textContent = teamInfo.logo;
    absTeamLogo.style.backgroundColor = teamInfo.color;
    absTeamLogo.style.color = teamInfo.text;
  }
  if (absTeamNameText) {
    absTeamNameText.textContent = teamInfo.name;
  }

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

  if (gameMode === 'weekly_challenge' || gameMode === 'mlb_game') {
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
    let userStats = JSON.parse(localStorage.getItem(statsKey) || '{"overallAccuracy":null,"maxStreak":0,"completedWeekly":0,"history":[]}');
    
    if (gameMode === 'weekly_challenge') {
      userStats.completedWeekly = (userStats.completedWeekly || 0) + 1;
    }
    
    const usesPlaylistTotals = gameMode === 'weekly_challenge' || gameMode === 'mlb_game';
    let totalCallsSum = usesPlaylistTotals ? displayPitchesCount : calledPitches.length;
    let totalCorrectSum = usesPlaylistTotals ? displayCorrectCount : userCorrectCount;
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

    // Track Daily Streaks by date for partitioned leaderboards
    const todayStr = new Date().toISOString().slice(0, 10);
    if (!userStats.streakHistory) userStats.streakHistory = {};
    if (gameMode === 'daily_streak') {
      userStats.streakHistory[todayStr] = Math.max(userStats.streakHistory[todayStr] || 0, userCorrectCount);
    }
    
    // Rolling recent pitches are updated live in submitUserDecision. Capping is also done live.
    
    let gameName = "Practice Mode";
    let matchup = "N/A";
    if (gameMode === 'weekly_challenge') {
      const gameData = WEEKLY_CHALLENGE_DATA[activeGameIndex];
      gameName = gameData ? gameData.title : "Weekly Challenge";
    } else if (gameMode === 'mlb_game') {
      gameName = "Play Any Game";
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
      correctCalls: usesPlaylistTotals ? displayCorrectCount : userCorrectCount,
      totalCalls: usesPlaylistTotals ? displayPitchesCount : calledPitches.length,
      accuracy: usesPlaylistTotals ? displayAcc : userAcc,
      date: new Date().toLocaleDateString()
    });

    localStorage.setItem(statsKey, JSON.stringify(userStats));
    saveGlobalUserStats(username, userStats);
    updateProfileStatsUI();

    // Leaderboard submit — weekly and streak only (Play Any Game updates profile accuracy only)
    if (gameMode === 'weekly_challenge') {
      const weeklyPoints = displayCorrectCount * 10;
      submitGlobalScore('weekly', username, activeFavoriteTeam || 'None', `${displayAcc}%`, `${weeklyPoints} pts`, weeklyPoints);
    } else if (gameMode === 'daily_streak') {
      submitGlobalScore('daily', username, activeFavoriteTeam || 'None', `${userAcc}%`, `${userCorrectCount} Streak`, userCorrectCount);
    }

    const completedTeamsList = Object.keys(userStats.teamStats || {});
    if (completedTeamsList.length > 0) {
      const teamString = completedTeamsList.join(',');
      let sumAcc = 0;
      completedTeamsList.forEach(t => {
        const ts = userStats.teamStats[t];
        sumAcc += ts.totalCalls > 0 ? (ts.correctCalls / ts.totalCalls) * 100 : 0;
      });
      const avgAcc = Math.round(sumAcc / completedTeamsList.length);
      const masteryScore = completedTeamsList.length * 1000 + avgAcc;
      submitGlobalScore('alltime', username, teamString, `${avgAcc}%`, `${completedTeamsList.length} Teams (${masteryScore} pts)`, masteryScore);
    }
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
    
    let umpireName = "The real MLB crew chief";
    let umpireNameObj = "the real MLB crew chief";
    if (gameMode === 'weekly_challenge') {
      const gameData = WEEKLY_CHALLENGE_DATA[activeGameIndex];
      if (gameData && gameData.umpire_name) {
        umpireName = gameData.umpire_name;
        umpireNameObj = gameData.umpire_name;
      }
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
            ? `🔥 Outstanding! You called <b>${userCorrectCount}</b> of <b>${calledPitches.length}</b> critical takes correctly (<b>${userAcc}%</b>), out-umpiring <b>${umpireNameObj}</b> who posted <b>${umpCorrectCount}/${calledPitches.length}</b> (<b>${umpAcc}%</b>).` 
            : `<b>${umpireName}</b> called <b>${umpCorrectCount}/${calledPitches.length}</b> (<b>${umpAcc}%</b>) correctly on these critical takes, out-performing your <b>${userCorrectCount}/${calledPitches.length}</b> (<b>${userAcc}%</b>). Keep training!`}
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

async function goToMainMenu() {
  playMenuTransitionSound();
  if (abStartOverlay && isOverlayShowing(abStartOverlay)) {
    setAbStartOverlayActive(false);
    await fadeOverlayOut(abStartOverlay);
  }
  if (abSummaryOverlay && isOverlayShowing(abSummaryOverlay)) {
    await fadeOverlayOut(abSummaryOverlay);
  }
  if (scoreboardScreen && isOverlayShowing(scoreboardScreen)) {
    await fadeOverlayOut(scoreboardScreen);
  }

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
      setAbStartOverlayActive(false);
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
    if (streakSummaryOverlay) {
      streakSummaryOverlay.classList.add('opacity-0', 'pointer-events-none');
      streakSummaryOverlay.classList.remove('opacity-100', 'pointer-events-auto');
      const streakPanel = streakSummaryOverlay.querySelector('.streak-summary-panel');
      if (streakPanel) {
        streakPanel.classList.add('scale-95');
        streakPanel.classList.remove('scale-100');
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

    if (gameMode === 'weekly_challenge' || gameMode === 'daily_streak' || gameMode === 'mlb_game') {
      saveChallengeSessionToLocal();
      await saveGameProgress();
    }
    
    pitchesList = [];
    currentPitchIndex = 0;
    pitchHistory = [];
    currentAbStartHistoryIndex = 0;
    
  if (!activeFavoriteTeam) {
    transitionToState(STATES.WELCOME);
  } else {
    transitionToState(STATES.START);
  }

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

function switchTab(tabName, options = {}) {
  console.log('DEBUG: switchTab called with:', tabName);
  try {
    const tabs = ['play', 'leaderboard', 'stats'];
  tabs.forEach(t => {
    const btn = document.getElementById(`tab-btn-${t}`);
    const content = document.getElementById(`tab-content-${t}`);
    if (t === tabName) {
      btn.classList.add('ump-tab--active');
      btn.setAttribute('aria-selected', 'true');
      content.classList.remove('hidden');
      content.classList.add('flex');
    } else {
      btn.classList.remove('ump-tab--active');
      btn.setAttribute('aria-selected', 'false');
      content.classList.add('hidden');
      content.classList.remove('flex');
    }
  });

  if (tabName === 'stats') {
    updateProfileStatsUI();
  } else if (tabName === 'leaderboard') {
    applyStandingsTabOptions(options);
    renderLeaderboard(activeStandingsBoard);
  } else if (tabName === 'play') {
    loadPlayTabRecentGames();
    updateChallengeProgressUI();
  }
  } catch (err) {
    console.error('DEBUG ERROR: Error switching tab:', err);
  }
}

function openStandingsTab(options = {}) {
  switchTab('leaderboard', options);
}

function applyStandingsTabOptions(options = {}) {
  const meta = weeklyChallengeMeta || resolveWeeklyChallengeMeta(WEEKLY_CHALLENGE_DATA, WEEKLY_CHALLENGE_META);
  if (options.board) activeStandingsBoard = options.board;
  if (options.crewMetric) activeCrewMetric = options.crewMetric;
  if (options.view === 'history') {
    standingsViewMode = 'history';
  } else if (options.view === 'alltime') {
    standingsViewMode = 'alltime';
  } else if (options.view === 'ranks') {
    standingsViewMode = 'ranks';
  }
  if (options.periodKey) {
    activeWeeklyPeriodKey = options.periodKey;
    standingsViewMode = 'ranks';
  } else if (standingsViewMode !== 'history' && (options.period === 'current' || !activeWeeklyPeriodKey)) {
    activeWeeklyPeriodKey = meta.challengeWeekId;
  }
}

/**
 * Starts a weekly challenge game playlist
 */
function startWeeklyChallengeGame(gameIdx) {
  if (!requireLoggedInUser()) return;
  try {
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

  if (!weeklyPlaylistABs.length) {
    throw new Error('Selected game has no at-bats');
  }
  loadWeeklyAtBat(activeWeeklyAbIndex);
  } catch (err) {
    console.error('Failed to start weekly game:', err);
    if (toastMessage) {
      toastMessage.innerHTML = '<span class="text-red-300 font-bold font-mono-tech">WEEKLY GAME FAILED TO START</span>';
      toastMessage.classList.remove('opacity-0', 'scale-95', '-translate-y-4');
      toastMessage.classList.add('opacity-100', 'scale-100', 'translate-y-0');
      setTimeout(() => {
        toastMessage.classList.add('opacity-0', 'scale-95', '-translate-y-4');
        toastMessage.classList.remove('opacity-100', 'scale-100', 'translate-y-0');
      }, 3200);
    }
  }
}

let allStreakAtBatsPool = [];

function groupPitchesIntoAtBats(pitches) {
  if (!pitches || pitches.length === 0) return [];
  const abs = [];
  let currentAbPitches = [];
  let currentKey = null;

  pitches.forEach(pitch => {
    const isTopVal = pitch.is_top !== undefined ? pitch.is_top : (pitch.isTop !== undefined ? pitch.isTop : true);
    const key = `${pitch.pitcher}_${pitch.batter}_${pitch.inning}_${isTopVal}`;
    if (currentKey === null) {
      currentKey = key;
      currentAbPitches.push(pitch);
    } else if (currentKey === key) {
      currentAbPitches.push(pitch);
    } else {
      abs.push({
        pitches: currentAbPitches,
        pitcher: currentAbPitches[0].pitcher,
        batter: currentAbPitches[0].batter,
        inning: currentAbPitches[0].inning,
        is_top: currentAbPitches[0].is_top !== undefined ? currentAbPitches[0].is_top : (currentAbPitches[0].isTop !== undefined ? currentAbPitches[0].isTop : true),
        pitcher_hand: currentAbPitches[0].pitcher_hand || 'RHP',
        batter_hand: currentAbPitches[0].batter_hand || 'RHB'
      });
      currentKey = key;
      currentAbPitches = [pitch];
    }
  });

  if (currentAbPitches.length > 0) {
    abs.push({
      pitches: currentAbPitches,
      pitcher: currentAbPitches[0].pitcher,
      batter: currentAbPitches[0].batter,
      inning: currentAbPitches[0].inning,
      is_top: currentAbPitches[0].is_top !== undefined ? currentAbPitches[0].is_top : (currentAbPitches[0].isTop !== undefined ? currentAbPitches[0].isTop : true),
      pitcher_hand: currentAbPitches[0].pitcher_hand || 'RHP',
      batter_hand: currentAbPitches[0].batter_hand || 'RHB'
    });
  }

  return abs;
}

function extractAllAtBatsForStreak() {
  allStreakAtBatsPool = [];

  // Group weekly challenge pitches
  if (typeof WEEKLY_CHALLENGE_DATA !== 'undefined' && Array.isArray(WEEKLY_CHALLENGE_DATA)) {
    WEEKLY_CHALLENGE_DATA.forEach(game => {
      if (game && Array.isArray(game.pitches)) {
        allStreakAtBatsPool.push(...groupPitchesIntoAtBats(game.pitches));
      }
    });
  }

  // Group daily challenge pitches
  if (typeof DAILY_CHALLENGE_DATA !== 'undefined') {
    const dailyPitches = DAILY_CHALLENGE_DATA.pitches || (Array.isArray(DAILY_CHALLENGE_DATA) ? DAILY_CHALLENGE_DATA : []);
    if (Array.isArray(dailyPitches)) {
      allStreakAtBatsPool.push(...groupPitchesIntoAtBats(dailyPitches));
    }
  }

  // Group Orioles game pitches
  if (typeof ORIOLES_GAME_DATA !== 'undefined' && Array.isArray(ORIOLES_GAME_DATA)) {
    allStreakAtBatsPool.push(...groupPitchesIntoAtBats(ORIOLES_GAME_DATA));
  }

  console.log(`Extracted ${allStreakAtBatsPool.length} At-Bats for Streak pool.`);
}

/**
 * Starts a Daily Streak challenge session
 */
async function startDailyStreakChallenge(isResume = false) {
  if (!isResume && !requireLoggedInUser()) return;
  try {
  const username = localStorage.getItem('ump_username') || 'GUEST_UMPIRE';
  updateDailyStreakStatusUI();
  hideChallengeDetailModal();

  gameMode = 'daily_streak';
  isGamePaused = false;
  isSessionOver = false;
  if (pauseScreen) {
    pauseScreen.classList.add('opacity-0', 'pointer-events-none');
    pauseScreen.classList.remove('opacity-100', 'pointer-events-auto');
  }
  
  let restored = false;

  if (!isResume && username && username !== 'GUEST_UMPIRE') {
    try {
      const session = await getActiveSession(username);
      if (session?.gameMode === 'daily_streak' && session.streakPlaylistABs?.length) {
        streakPlaylistABs = session.streakPlaylistABs;
        activeStreakAbIndex = session.activeStreakAbIndex || 0;
        streakPitchHistory = session.streakPitchHistory || [];
        restoreChallengePitchState(session);
        restored = true;
      }
    } catch (e) {
      console.error('Failed to restore streak session from IndexedDB:', e);
    }

    if (!restored) {
      const savedData = readSavedChallengeData(username);
      const active = savedData?.activeChallenge;
      if (active?.gameMode === 'daily_streak' && savedData.streakPlaylistABs?.length) {
        streakPlaylistABs = savedData.streakPlaylistABs;
        activeStreakAbIndex = savedData.activeStreakAbIndex || active.activeStreakAbIndex || 0;
        streakPitchHistory = active.streakPitchHistory || [];
        restoreChallengePitchState(active);
        restored = true;
      }
    }
  }

  if (!isResume && !restored) {
    if (allStreakAtBatsPool.length === 0) {
      extractAllAtBatsForStreak();
    }
    if (allStreakAtBatsPool.length === 0) {
      throw new Error('No at-bats available for streak challenge');
    }

    // Fisher-Yates shuffle
    const shuffledABs = [...allStreakAtBatsPool];
    for (let i = shuffledABs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffledABs[i], shuffledABs[j]] = [shuffledABs[j], shuffledABs[i]];
    }
    
    streakPlaylistABs = shuffledABs;
    activeStreakAbIndex = 0;
    streakPitchHistory = [];

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
  } else if (isResume) {
    reconstructActiveAtBatState();
    transitionToState(STATES.IDLE);
    return;
  }

  loadStreakAtBat(activeStreakAbIndex, restored);
  } catch (err) {
    console.error('Failed to start streak challenge:', err);
    if (toastMessage) {
      toastMessage.innerHTML = '<span class="text-red-300 font-bold font-mono-tech">STREAK CHALLENGE FAILED TO START</span>';
      toastMessage.classList.remove('opacity-0', 'scale-95', '-translate-y-4');
      toastMessage.classList.add('opacity-100', 'scale-100', 'translate-y-0');
      setTimeout(() => {
        toastMessage.classList.add('opacity-0', 'scale-95', '-translate-y-4');
        toastMessage.classList.remove('opacity-100', 'scale-100', 'translate-y-0');
      }, 3200);
    }
  }
}

function loadStreakAtBat(abIdx, isResume = false) {
  if (abIdx >= streakPlaylistABs.length) {
    // Recycle/reshuffle if we run out of compiled at-bats
    const shuffledABs = [...allStreakAtBatsPool];
    for (let i = shuffledABs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffledABs[i], shuffledABs[j]] = [shuffledABs[j], shuffledABs[i]];
    }
    streakPlaylistABs = streakPlaylistABs.concat(shuffledABs);
  }

  activeStreakAbIndex = abIdx;
  const abData = streakPlaylistABs[activeStreakAbIndex];
  pitchesList = abData?.pitches || [];
  if (!abData || pitchesList.length === 0) {
    throw new Error('Streak challenge at-bat has no pitch data');
  }

  if (!isResume) {
    activeAbEnded = false;
    currentPitchIndex = 0;
    pitchHistory = [];
    currentAbStartHistoryIndex = 0;
    abBalls = 0;
    abStrikes = 0;
  } else {
    if (pitchHistory.length > 0) {
      applyPitchHistoryToPitchesList();
    } else {
      reconstructActiveAtBatState();
    }
    
    // If At-Bat is completed, show summary overlay directly (do not auto-start next pitch)
    if (checkReconstructedAbCompleted()) {
      console.log("Resumed Streak At-Bat is completed. Loading intermission/summary directly.");
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

  saveGameProgress();

  transitionToState(STATES.IDLE);
  showAtBatStartScreen(() => {
    if (currentState === STATES.IDLE && !isGamePaused) {
      autoPlayTimeout = setTimeout(() => {
        triggerPitchRelease();
      }, 600);
    }
  }, isResume);
}

function getAbPitches(abEntry) {
  if (!abEntry) return [];
  if (Array.isArray(abEntry)) return abEntry;
  return abEntry.pitches || [];
}

function buildFilmRoomUrl(gamePk) {
  return gamePk ? `https://www.mlb.com/video/game/${gamePk}` : "";
}

function buildUmpScorecardUrl(gamePk) {
  return gamePk ? `https://umpscorecards.com/single_game/?game_id=${gamePk}` : "";
}

function isGenericExternalUrl(url, kind) {
  if (!url) return true;
  const normalized = url.replace(/\/+$/, "");
  const genericFilm = new Set([
    "https://www.mlb.com",
    "https://www.mlb.com/video"
  ]);
  const genericUmp = new Set([
    "https://umpscorecards.com",
    "https://www.umpscorecards.com",
    "https://umpscorecards.com/games"
  ]);
  return kind === "film" ? genericFilm.has(normalized) : genericUmp.has(normalized);
}

function normalizePlaylistAbs(rawABs, meta = {}) {
  const defaultFilm = meta.filmRoomUrl || buildFilmRoomUrl(meta.gamePk);
  const defaultUmp = meta.umpScorecardUrl || buildUmpScorecardUrl(meta.gamePk);

  return rawABs.map((entry) => {
    const pitches = getAbPitches(entry);
    const firstPitch = pitches[0] || {};
    const existing = Array.isArray(entry) ? {} : entry;
    return {
      ...existing,
      gameIndex: existing.gameIndex ?? meta.gameIndex,
      gamePk: existing.gamePk ?? meta.gamePk,
      gameTitle: existing.gameTitle ?? meta.gameTitle,
      filmRoomUrl: existing.filmRoomUrl || existing.film_room_url || defaultFilm,
      umpScorecardUrl: existing.umpScorecardUrl || existing.ump_scorecard_url || defaultUmp,
      pitcher: existing.pitcher || firstPitch.pitcher,
      batter: existing.batter || firstPitch.batter,
      pitches,
      completed: existing.completed || false,
      userCorrectCount: existing.userCorrectCount || 0,
      userTotalCount: existing.userTotalCount || 0
    };
  });
}

function getRevisitedUrls(pitch, abData) {
  let filmRoomUrl = "https://www.mlb.com/video";
  let umpScorecardUrl = "https://www.umpscorecards.com";

  let rawUmpUrl = abData?.umpScorecardUrl || abData?.ump_scorecard_url || "";
  let rawFilmUrl = abData?.filmRoomUrl || abData?.film_room_url || "";

  if (
    abData?.gameIndex != null &&
    WEEKLY_CHALLENGE_DATA[abData.gameIndex] &&
    (isGenericExternalUrl(rawFilmUrl, "film") || isGenericExternalUrl(rawUmpUrl, "ump") || !rawFilmUrl || !rawUmpUrl)
  ) {
    const catalogGame = WEEKLY_CHALLENGE_DATA[abData.gameIndex];
    if (!rawFilmUrl || isGenericExternalUrl(rawFilmUrl, "film")) {
      rawFilmUrl = catalogGame.film_room_url || rawFilmUrl;
    }
    if (!rawUmpUrl || isGenericExternalUrl(rawUmpUrl, "ump")) {
      rawUmpUrl = catalogGame.ump_scorecard_url || rawUmpUrl;
    }
  }

  if (abData?.gamePk) {
    if (!rawFilmUrl || isGenericExternalUrl(rawFilmUrl, "film")) {
      rawFilmUrl = buildFilmRoomUrl(abData.gamePk);
    }
    if (!rawUmpUrl || isGenericExternalUrl(rawUmpUrl, "ump")) {
      rawUmpUrl = buildUmpScorecardUrl(abData.gamePk);
    }
  }

  let gameId = abData?.gamePk || null;
  const gameIdMatch = rawUmpUrl.match(/game_id=(\d+)/) || rawFilmUrl.match(/\/game\/(\d+)/);
  if (gameIdMatch) {
    gameId = gameIdMatch[1];
  }

  if (rawUmpUrl && !isGenericExternalUrl(rawUmpUrl, "ump")) {
    umpScorecardUrl = rawUmpUrl;
  } else if (gameId) {
    umpScorecardUrl = `https://umpscorecards.com/single_game/?game_id=${gameId}`;
  } else {
    umpScorecardUrl = `https://umpscorecards.com/games/`;
  }

  if (rawFilmUrl && !isGenericExternalUrl(rawFilmUrl, "film")) {
    filmRoomUrl = rawFilmUrl;
  } else if (pitch && pitch.pitcher && pitch.batter) {
    const queryStr = `${pitch.pitcher} vs ${pitch.batter}` + (pitch.inning ? ` Inning ${pitch.inning}` : "");
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
    if (expanded) {
      xpPanel.classList.add('hidden');
    } else {
      const bar = xpPanel.querySelector('.ump-xp-bar-fill');
      if (bar) {
        bar.style.transition = 'none';
        bar.classList.remove('xp-gained');
        xpPanel.classList.remove('hidden');
        bar.offsetHeight; // force reflow
        requestAnimationFrame(() => {
          bar.style.transition = 'width 1s cubic-bezier(0.34, 1.56, 0.64, 1)';
        });
      } else {
        xpPanel.classList.remove('hidden');
      }
    }
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

function setStreakSummaryReviewExpanded(expanded) {
  streakSummaryReviewExpanded = expanded;
  if (btnStreakSummaryToggleReview) {
    btnStreakSummaryToggleReview.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    btnStreakSummaryToggleReview.textContent = expanded ? '▼ HIDE CHART' : '▶ PITCH CHART';
  }
  
  const callsBoard = document.getElementById('streak-summary-calls-board');
  const xpPanel = document.getElementById('streak-summary-xp-panel');
  if (callsBoard) {
    if (expanded) callsBoard.classList.add('hidden');
    else callsBoard.classList.remove('hidden');
  }
  if (xpPanel) {
    if (expanded) {
      xpPanel.classList.add('hidden');
    } else {
      const bar = xpPanel.querySelector('.ump-xp-bar-fill');
      if (bar) {
        bar.style.transition = 'none';
        bar.classList.remove('xp-gained');
        xpPanel.classList.remove('hidden');
        bar.offsetHeight; // force reflow
        requestAnimationFrame(() => {
          bar.style.transition = 'width 1s cubic-bezier(0.34, 1.56, 0.64, 1)';
        });
      } else {
        xpPanel.classList.remove('hidden');
      }
    }
  }

  if (!streakSummaryReview) return;
  const cabinet = document.querySelector('#streak-summary-overlay .arcade-cabinet');
  if (cabinet) cabinet.classList.toggle('arcade-cabinet--chart-open', expanded);
  if (expanded) {
    streakSummaryReview.hidden = false;
    streakSummaryReview.classList.remove('is-collapsed');
    streakSummarySelectedPitchIndex = null;
    drawStreakSummarySVGMatrix();
    clearStreakSummaryPitchSelection();
    requestAnimationFrame(() => {
      setMarqueePlayerName(streakSummaryPitcherName, '.streak-summary-pitcher-name-dup', streakSummaryPitcherName?.textContent || '', { uppercase: true });
      setMarqueePlayerName(streakSummaryBatterName, '.streak-summary-batter-name-dup', streakSummaryBatterName?.textContent || '', { uppercase: true });
    });
  } else {
    streakSummaryReview.classList.add('is-collapsed');
    streakSummaryReview.hidden = true;
  }
}

function drawStreakSummarySVGMatrix() {
  if (!streakSummarySvgPitches) return;
  streakSummarySvgPitches.innerHTML = '';
  if (streakSummarySvgZone) streakSummarySvgZone.innerHTML = '';
  if (streakSummarySvgIndicators) streakSummarySvgIndicators.innerHTML = '';
  if (streakSummaryPitchDetails) {
    streakSummaryPitchDetails.innerHTML = '<p class="ab-summary-pitch-detail-placeholder">TAP A PITCH FOR DETAILS</p>';
  }
  updateStreakSummaryZoneDistance(null);

  const abPitches = streakPitchHistory.filter(p => !p.isSwingPlay);
  if (abPitches.length === 0) return;

  const firstPitch = abPitches[0];
  const pData = firstPitch.pitchData || firstPitch;
  const szTop = pData.sz_top !== undefined ? pData.sz_top : (pData.szTop !== undefined ? pData.szTop : 3.4);
  const szBot = pData.sz_bot !== undefined ? pData.sz_bot : (pData.szBot !== undefined ? pData.szBot : 1.6);

  if (streakSummaryMatrixSvg) {
    streakSummaryMatrixSvg.setAttribute('viewBox', getAbSummaryPitchesViewBox(abPitches, szTop, szBot));
  }

  if (streakSummarySvgZone) {
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
    streakSummarySvgZone.appendChild(stdZone);

    const plate = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    const plateY = 4.0 - szBot + 0.55;
    plate.setAttribute('points', '-0.35,' + plateY + ' 0,' + (plateY + 0.18) + ' 0.35,' + plateY);
    plate.setAttribute('fill', 'rgba(244, 236, 216, 0.15)');
    plate.setAttribute('stroke', 'rgba(244, 236, 216, 0.45)');
    plate.setAttribute('stroke-width', '0.02');
    streakSummarySvgZone.appendChild(plate);
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
      if (streakSummarySelectedPitchIndex === index) {
        clearStreakSummaryPitchSelection();
      } else {
        highlightPitchInStreakSummary(index);
      }
    });

    const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    title.textContent = `Pitch ${index + 1}: ${item.pitchType || 'Pitch'} (${item.speedMph != null ? Math.round(item.speedMph) : '—'} mph) — You: ${item.userCall === 'S' ? 'Strike' : 'Ball'}, ABS: ${item.absCall === 'S' ? 'Strike' : 'Ball'}`;
    group.appendChild(title);

    streakSummarySvgPitches.appendChild(group);
  });

  if (streakSummaryPitchList) {
    streakSummaryPitchList.innerHTML = '';

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
        if (streakSummarySelectedPitchIndex === index) {
          clearStreakSummaryPitchSelection();
        } else {
          highlightPitchInStreakSummary(index);
        }
      });

      streakSummaryPitchList.appendChild(btn);
    });
  }
}

function clearStreakSummaryPitchSelection() {
  streakSummarySelectedPitchIndex = null;
  highlightSummaryPitch(-1);
  if (streakSummaryPitchDetails) {
    streakSummaryPitchDetails.innerHTML = '<p class="ab-summary-pitch-detail-placeholder">TAP A PITCH FOR DETAILS</p>';
  }
  if (streakSummaryPitchList) {
    streakSummaryPitchList.querySelectorAll('.ab-summary-pitch-row').forEach((row) => {
      row.classList.remove('is-selected', 'is-dimmed');
    });
  }
  syncStreakSummarySvgPitchMarkers(null);
  const streakSummarySvgIndicators = document.getElementById('streak-summary-svg-indicators');
  if (streakSummarySvgIndicators) streakSummarySvgIndicators.innerHTML = '';
  updateStreakSummaryZoneDistance(null);
}

function highlightPitchInStreakSummary(index) {
  const abPitches = streakPitchHistory.filter(p => !p.isSwingPlay);
  const item = abPitches[index];
  if (!item) return;

  streakSummarySelectedPitchIndex = index;
  highlightSummaryPitch(index);

  const pData = item.pitchData || item;
  const szTop = pData.sz_top !== undefined ? pData.sz_top : (pData.szTop !== undefined ? pData.szTop : 3.4);
  const szBot = pData.sz_bot !== undefined ? pData.sz_bot : (pData.szBot !== undefined ? pData.szBot : 1.6);

  renderStreakSummaryPitchFocus(index, item);

  if (streakSummaryPitchList) {
    const rows = streakSummaryPitchList.querySelectorAll('.ab-summary-pitch-row');
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

  syncStreakSummarySvgPitchMarkers(index);
  drawStreakSummaryPitchIndicators(item, szTop, szBot);
  updateStreakSummaryZoneDistance(item);
}

function syncStreakSummarySvgPitchMarkers(selectedIndex) {
  if (!streakSummarySvgPitches) return;
  const abPitches = streakPitchHistory.filter((p) => !p.isSwingPlay);
  const markers = streakSummarySvgPitches.querySelectorAll('.ab-summary-pitch-marker');
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

function drawStreakSummaryPitchIndicators(item, szTop, szBot) {
  const streakSummarySvgIndicators = document.getElementById('streak-summary-svg-indicators');
  if (!streakSummarySvgIndicators || !item?.trajectory?.crossPoint) return;
  streakSummarySvgIndicators.innerHTML = '';
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
    streakSummarySvgIndicators.appendChild(line);

    const edgeDot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    edgeDot.setAttribute('cx', cxSvg);
    edgeDot.setAttribute('cy', cySvg);
    edgeDot.setAttribute('r', '0.055');
    edgeDot.setAttribute('fill', 'rgba(232, 197, 71, 0.35)');
    edgeDot.setAttribute('stroke', AB_SUMMARY_COLORS.distLine);
    edgeDot.setAttribute('stroke-width', '0.02');
    streakSummarySvgIndicators.appendChild(edgeDot);
  }
}

function updateStreakSummaryZoneDistance(item) {
  const el = document.getElementById('streak-summary-zone-distance');
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

function renderStreakSummaryPitchFocus(index, item) {
  if (!streakSummaryPitchDetails || !item) return;

  const isCorrect = item.userCorrect;
  const youCall = formatCallShort(item.userCall);
  const absCall = formatCallShort(item.absCall);
  const umpCall = formatCallShort(item.realCall);
  const stats = getAbSummaryPitchStats(item);
  const verdictClass = isCorrect ? 'ab-summary-pitch-detail-verdict--ok' : 'ab-summary-pitch-detail-verdict--miss';
  const umpMatchAbs = item.realCall === item.absCall;

  streakSummaryPitchDetails.innerHTML = `
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

async function showStreakSummaryScreen() {
  if (!streakSummaryOverlay) return;

  activeAbEnded = true;
  cancelAutoPlayPitch();
  streakSummarySelectedPitchIndex = null;
  setStreakSummaryReviewExpanded(false);
  hideGameplayHudForSummary(true);
  hideAbSummaryXpPopover();
  
  setZoomedIn(false);
  clearDimensionLine();
  hideQuickPreviewPanel();
  showReviewPanel(false);
  if (replayBadge) {
    replayBadge.classList.add('opacity-0', 'pointer-events-none');
    replayBadge.classList.remove('opacity-100');
  }

  const abPitches = streakPitchHistory.filter(p => !p.isSwingPlay);
  const correctCount = abPitches.filter(x => x.userCorrect).length;
  const accuracy = abPitches.length > 0 ? Math.round((correctCount / abPitches.length) * 100) : 100;

  const finalPitchItem = abPitches.length > 0 ? abPitches[abPitches.length - 1] : null;
  const targetPitch = finalPitchItem?.pitchData || finalPitchItem || lastCompletedPitch || currentPitch;

  let pitcher = "Pitcher";
  let batter = "Batter";
  if (targetPitch) {
    const matchup = getMatchupNames(targetPitch);
    pitcher = matchup.pitcher;
    batter = matchup.batter;
  }

  if (streakSummaryTitle) {
    streakSummaryTitle.textContent = "STREAK ENDED";
  }
  if (streakSummarySubtitle) {
    streakSummarySubtitle.textContent = `STREAK: ${correctCount} PITCH${correctCount !== 1 ? 'ES' : 'E'}`;
  }

  if (streakSummaryFinalStreak) streakSummaryFinalStreak.textContent = correctCount;
  if (streakSummaryAccuracy) streakSummaryAccuracy.textContent = `${accuracy}%`;
  if (streakSummaryFraction) streakSummaryFraction.textContent = `${correctCount}/${abPitches.length} Correct`;

  if (streakSummaryPitcherHandBadge && targetPitch) {
    const pH = (targetPitch.pitcher_hand || "R").includes("L") ? "LHP" : "RHP";
    streakSummaryPitcherHandBadge.textContent = pH;
    streakSummaryPitcherHandBadge.className = pH === "RHP"
      ? "ab-summary-hand-badge ab-summary-hand-badge--rhp"
      : "ab-summary-hand-badge ab-summary-hand-badge--lhp";
  }
  if (streakSummaryBatterHandBadge && targetPitch) {
    const bH = (targetPitch.batter_hand || "R").includes("L") ? "LHB" : "RHB";
    streakSummaryBatterHandBadge.textContent = bH;
    streakSummaryBatterHandBadge.className = bH === "LHB"
      ? "ab-summary-hand-badge ab-summary-hand-badge--lhb"
      : "ab-summary-hand-badge ab-summary-hand-badge--rhb";
  }

  fetchPlayerMlbId(pitcher).then(pitcherId => {
    if (streakSummaryPitcherImg) {
      streakSummaryPitcherImg.src = pitcherId > 0 
        ? `https://midfield.mlbstatic.com/v1/people/${pitcherId}/spots/120` 
        : 'https://midfield.mlbstatic.com/v1/people/generic/spots/120';
    }
  });

  fetchPlayerMlbId(batter).then(batterId => {
    if (streakSummaryBatterImg) {
      streakSummaryBatterImg.src = batterId > 0 
        ? `https://midfield.mlbstatic.com/v1/people/${batterId}/spots/120` 
        : 'https://midfield.mlbstatic.com/v1/people/generic/spots/120';
    }
  });

  const pitcherTeam = getPlayerTeam(pitcher);
  const batterTeam = getPlayerTeam(batter);

  if (streakSummaryPitcherLogo) {
    streakSummaryPitcherLogo.src = getTeamLogoUrl(pitcherTeam || "Orioles");
  }
  if (streakSummaryBatterLogo) {
    streakSummaryBatterLogo.src = getTeamLogoUrl(batterTeam || "Tigers");
  }

  showSummaryPitchReview(abPitches);
  drawStreakSummarySVGMatrix();

  if (streakSummaryBlurb) {
    streakSummaryBlurb.textContent = finalPitchItem?.pitchData?.historical_blurb || targetPitch?.historical_blurb || "No play-by-play description available.";
  }

  setMarqueePlayerName(streakSummaryPitcherName, '.streak-summary-pitcher-name-dup', pitcher, { uppercase: true });
  setMarqueePlayerName(streakSummaryBatterName, '.streak-summary-batter-name-dup', batter, { uppercase: true });

  const username = localStorage.getItem('ump_username');
  const favoriteTeam = localStorage.getItem('favorite_team') || 'None';
  const xpEarned = (correctCount * 10) + (activeStreakAbIndex * 50);

  if (username) {
    const statsKey = getStatsStorageKey(username);
    const localStats = JSON.parse(localStorage.getItem(statsKey) || '{"overallAccuracy":null,"maxStreak":0,"completedWeekly":0,"history":[]}');
    
    const todayStr = new Date().toISOString().split('T')[0];
    if (!localStats.streakHistory) localStats.streakHistory = {};
    localStats.streakHistory[todayStr] = Math.max(localStats.streakHistory[todayStr] || 0, correctCount);
    localStats.maxStreak = Math.max(localStats.maxStreak || 0, correctCount);
    localStorage.setItem(statsKey, JSON.stringify(localStats));

    getGlobalUserStats(username).then(async (globalStats) => {
      if (!globalStats.streakHistory) globalStats.streakHistory = {};
      globalStats.streakHistory[todayStr] = Math.max(globalStats.streakHistory[todayStr] || 0, correctCount);
      globalStats.maxStreak = Math.max(globalStats.maxStreak || 0, correctCount);
      await saveGlobalUserStats(username, globalStats);
      updateDailyStreakStatusUI();
    }).catch(err => console.warn(err));

    submitGlobalScore('daily', username, favoriteTeam, `${accuracy}%`, `${correctCount} Streak`, correctCount);

    try {
      await clearActiveSession(username);
      const saved = readSavedChallengeData(username);
      if (saved?.activeChallenge?.gameMode === 'daily_streak') {
        saved.activeChallenge = null;
        localStorage.setItem(getChallengeStorageKey(username), JSON.stringify(saved));
      }
    } catch (err) {
      console.warn('Failed to clear completed streak session:', err);
    }

    if (streakSummaryBestStreak) {
      streakSummaryBestStreak.textContent = `${Math.max(localStats.maxStreak || 0, correctCount)} Pitches`;
    }
    updateStreakSummaryLeaderboardSnippet(username);

    getGlobalUserStats(username).then(stats => {
      const totalXp = stats.xp || 0;
      const previousXp = Math.max(0, totalXp - xpEarned);
      const prev = getXpProgressInLevel(previousXp);
      const next = getXpProgressInLevel(totalXp);

      if (streakSummaryXpEarned) {
        streakSummaryXpEarned.textContent = `+${xpEarned} XP`;
      }
      if (streakSummaryXpLevel) {
        applyLevelBadgeElement(streakSummaryXpLevel, next.level);
      }
      if (streakSummaryXpTotal) {
        streakSummaryXpTotal.textContent = `${totalXp.toLocaleString()} XP total`;
      }
      if (streakSummaryXpProgress) {
        streakSummaryXpProgress.textContent = `${prev.progress} → ${next.progress} / ${XP_PER_LEVEL} XP`;
      }
      if (streakSummaryXpBar) {
        setXpBarPercent(streakSummaryXpBar, prev.pct, false);
        setTimeout(() => {
          setXpBarPercent(streakSummaryXpBar, next.pct, true);
          if (streakSummaryXpProgress) {
            streakSummaryXpProgress.textContent = `${next.progress} / ${XP_PER_LEVEL} XP`;
          }
          if (streakSummaryXpLevel) {
            applyLevelBadgeElement(streakSummaryXpLevel, next.level);
          }
        }, 200);
      }
    });
  } else {
    if (streakSummaryBestStreak) {
      streakSummaryBestStreak.textContent = `${correctCount} Pitches`;
    }
    if (streakSummaryLeaderboardSnippet) {
      streakSummaryLeaderboardSnippet.textContent = '—';
    }
    if (streakSummaryXpEarned) streakSummaryXpEarned.textContent = 'Log in for XP';
    if (streakSummaryXpLevel) {
      streakSummaryXpLevel.textContent = 'GUEST';
      streakSummaryXpLevel.className = 'ump-level-badge ump-level-badge--rookie';
    }
    if (streakSummaryXpProgress) streakSummaryXpProgress.textContent = '—';
    if (streakSummaryXpBar) {
      streakSummaryXpBar.style.transition = 'none';
      streakSummaryXpBar.style.width = '0%';
    }
  }

  let urls = getRevisitedUrls(targetPitch, streakPlaylistABs[activeStreakAbIndex]);
  if (streakSummaryFilmLink) streakSummaryFilmLink.href = urls.filmRoomUrl;
  if (streakSummaryScorecardLink) streakSummaryScorecardLink.href = urls.umpScorecardUrl;

  streakSummaryOverlay.classList.remove('opacity-0', 'pointer-events-none');
  streakSummaryOverlay.classList.add('opacity-100', 'pointer-events-auto');
  const panel = streakSummaryOverlay.querySelector('.streak-summary-panel');
  if (panel) {
    panel.classList.remove('scale-95');
    panel.classList.add('scale-100');
  }

  setTimeout(() => {
    setMarqueePlayerName(streakSummaryPitcherName, '.streak-summary-pitcher-name-dup', pitcher, { uppercase: true });
    setMarqueePlayerName(streakSummaryBatterName, '.streak-summary-batter-name-dup', batter, { uppercase: true });
  }, 350);
}

async function updateStreakSummaryLeaderboardSnippet(username) {
  if (!streakSummaryLeaderboardSnippet || !username) return;
  streakSummaryLeaderboardSnippet.textContent = '…';
  try {
    const { rows } = await getLeaderboardRows('daily', username);
    const me = rows.find((r) => r.isUser);
    streakSummaryLeaderboardSnippet.textContent = me
      ? `#${me.rank}`
      : 'Submit';
  } catch {
    streakSummaryLeaderboardSnippet.textContent = '—';
  }
}

function hideStreakSummaryScreen() {
  if (streakSummaryOverlay) {
    streakSummaryOverlay.classList.add('opacity-0', 'pointer-events-none');
    streakSummaryOverlay.classList.remove('opacity-100', 'pointer-events-auto');
    const panel = streakSummaryOverlay.querySelector('.streak-summary-panel');
    if (panel) {
      panel.classList.add('scale-95');
      panel.classList.remove('scale-100');
    }
  }
  hideGameplayHudForSummary(false);
  setStreakSummaryReviewExpanded(false);
  streakSummarySelectedPitchIndex = null;
  clearSummaryPitchReview();
  setCameraAngle('umpire');
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
    const meta = weeklyChallengeMeta || resolveWeeklyChallengeMeta(WEEKLY_CHALLENGE_DATA, WEEKLY_CHALLENGE_META);
    const { rows } = await getLeaderboardRows('weekly', username, meta.challengeWeekId);
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
    const meta = weeklyChallengeMeta || resolveWeeklyChallengeMeta(WEEKLY_CHALLENGE_DATA, WEEKLY_CHALLENGE_META);
    const { rows } = await getLeaderboardRows('weekly', username, meta.challengeWeekId);
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
  
  // Flash central progress bar fill white
  const centralBar = document.getElementById('hud-user-xp-bar');
  if (centralBar) {
    centralBar.style.transition = 'none';
    centralBar.style.backgroundColor = '#ffffff';
    centralBar.style.backgroundImage = 'none';
    centralBar.offsetHeight; // force reflow
    setTimeout(() => {
      centralBar.style.transition = 'background 0.5s ease';
      centralBar.style.backgroundColor = '';
      centralBar.style.backgroundImage = '';
    }, 500);
  }

  showFloatingXP(null, milestone ? `★ ${tier.title.toUpperCase()} ★` : `LEVEL ${newLevel}`);

  // Trigger screen shake on promotion card
  const card = levelUpOverlay ? levelUpOverlay.querySelector('.level-up-card') : null;
  if (card) {
    card.classList.remove('animate-shake');
    card.offsetHeight; // force reflow
    card.classList.add('animate-shake');
  }

  const loader = document.getElementById('app-launch-loader');
  const subtext = document.getElementById('loader-subtext');
  if (loader) {
    if (subtext) subtext.textContent = "SYSTEM PROMOTION PENDING...";
    loader.style.display = 'flex';
    loader.style.pointerEvents = 'none';
    loader.style.opacity = '0.85';
  }

  const dismissPromotionLoader = () => hideAppLaunchLoader();

  if (levelUpOverlay && levelUpBadge && levelUpTitle) {
    // Replace standard level badge with our rotating large rank badge SVG
    levelUpBadge.innerHTML = getLargeRankBadgeSvg(newLevel);
    levelUpBadge.className = "my-4";
    
    levelUpTitle.textContent = `RANK PROMOTION!`;
    if (levelUpSubtitle) {
      levelUpSubtitle.innerHTML = `<span style="color: var(--retro-gold); font-weight: bold; font-size: 1.1rem;" class="block mt-1">${tier.title.toUpperCase()}</span>` + 
        (milestone
          ? `<span class="text-[9px] text-gray-400 block mt-2">Milestone Reached · Level ${oldLevel} → ${newLevel}</span>`
          : `<span class="text-[9px] text-gray-400 block mt-2">Level ${oldLevel} → ${newLevel}</span>`);
    }

    levelUpOverlay.style.zIndex = '10005';
    levelUpOverlay.classList.remove('opacity-0');
    levelUpOverlay.classList.add('opacity-100', 'level-up-overlay--active');
    levelUpOverlay.setAttribute('aria-hidden', 'false');

    // Trigger confetti rain
    triggerConfettiCelebration();

    setTimeout(() => {
      levelUpOverlay.classList.remove('opacity-100', 'level-up-overlay--active');
      levelUpOverlay.classList.add('opacity-0');
      levelUpOverlay.setAttribute('aria-hidden', 'true');
      
      dismissPromotionLoader();
    }, milestone ? 4000 : 3000);
  } else {
    showLevelUpToast(newLevel);
    dismissPromotionLoader();
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
  
  if (abSummarySubtitle) {
    if (gameMode === 'weekly_challenge' || gameMode === 'mlb_game') {
      const total = weeklyPlaylistABs.length || 200;
      abSummarySubtitle.textContent = `Finished At-Bat ${activeWeeklyAbIndex + 1} of ${total}`;
      abSummarySubtitle.classList.remove('hidden');
    } else if (gameMode === 'daily_streak') {
      abSummarySubtitle.textContent = `Completed At-Bat ${activeStreakAbIndex + 1}`;
      abSummarySubtitle.classList.remove('hidden');
    } else {
      abSummarySubtitle.classList.add('hidden');
    }
  }
  
  pitcher = lastAbPitcher || "Pitcher";
  batter = lastAbBatter || "Batter";
  abSummaryMatchup.textContent = `P: ${pitcher.toUpperCase()} vs B: ${batter.toUpperCase()}`;
  
  // Fetch headshot images and logos
  setMarqueePlayerName(abSummaryPitcherName, '.ab-summary-pitcher-name-dup', pitcher, { uppercase: true });
  setMarqueePlayerName(abSummaryBatterName, '.ab-summary-batter-name-dup', batter, { uppercase: true });
  
  const targetPitch = lastCompletedPitch || currentPitch;
  if (abSummaryPitcherHandBadge && targetPitch) {
    applyHandBadge(abSummaryPitcherHandBadge, targetPitch.pitcher_hand, 'pitcher');
  }
  if (abSummaryBatterHandBadge && targetPitch) {
    applyHandBadge(abSummaryBatterHandBadge, targetPitch.batter_hand, 'batter');
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
    const localStats = JSON.parse(localStorage.getItem(statsKey) || '{"overallAccuracy":null,"maxStreak":0,"completedWeekly":0,"history":[]}');
    
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
  if (gameMode === 'weekly_challenge') {
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

  // Connect film room and umpire scorecard URLs to the completed at-bat's source game
  const abEntry = weeklyPlaylistABs[activeWeeklyAbIndex] || null;
  const urls = getRevisitedUrls(targetPitch, abEntry);
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
  if (gameMode === 'weekly_challenge' || gameMode === 'mlb_game') {
    activeWeeklyAbIndex++;
    saveChallengeSessionToLocal();
    if (gameMode === 'weekly_challenge') {
      updateChallengeProgressUI();
    }
    loadWeeklyAtBat(activeWeeklyAbIndex);
  } else if (gameMode === 'daily_streak') {
    activeStreakAbIndex++;
    loadStreakAtBat(activeStreakAbIndex);
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
    weeklyPlaylistABs: sanitizedPlaylist,
    streakPlaylistABs: streakPlaylistABs?.length ? streakPlaylistABs.map((ab) => {
      const cleanAb = { ...ab };
      if (cleanAb.pitches) cleanAb.pitches = cleanAb.pitches.map(sanitizePitch);
      return cleanAb;
    }) : [],
    activeWeeklyAbIndex,
    activeStreakAbIndex,
    activeGameIndex,
    gamePk: activeMlbGamePk,
    profileStats: {
      avgAccuracy: 92.5,
      maxStreak: 12
    }
  };
  
  if (currentState !== STATES.START && currentState !== STATES.SCOREBOARD && gameMode !== 'standard') {
    data.activeChallenge = {
      gameMode,
      activeWeeklyAbIndex,
      activeStreakAbIndex,
      activeGameIndex,
      activeDailyDate,
      currentPitchIndex,
      abBalls,
      abStrikes,
      pitchHistory: sanitizedHistory,
      streakPitchHistory: sanitizeHistory(streakPitchHistory),
      historyLength: pitchHistory.length
    };
  } else {
    data.activeChallenge = null;
  }
  
  let key = getChallengeStorageKey(username);
  if (gameMode === 'mlb_game' && activeMlbGamePk) {
    key = username
      ? `pitch_ump_mlb_game_mvp_${username.toUpperCase()}_mlb_${activeMlbGamePk}`
      : `pitch_ump_mlb_game_mvp_guest_mlb_${activeMlbGamePk}`;
  }
  
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch (err) {
    console.error("Failed to save challenge session to localStorage:", err);
  }
  
  if (username) {
    getGlobalUserStats(username).then(stats => {
      try {
        stats.challengeProgress = data;
        saveGlobalUserStats(username, stats);
      } catch (err) {
        console.error("Failed to update global user stats with active challenge:", err);
      }
    }).catch(err => {
      console.error("Failed to fetch global user stats:", err);
    });
  }
}

function getChallengeStorageKey(username = localStorage.getItem('ump_username')) {
  return username
    ? `pitch_ump_challenge_mvp_${username.toUpperCase()}`
    : 'pitch_ump_challenge_mvp_guest';
}

function readSavedChallengeData(username = localStorage.getItem('ump_username')) {
  const raw = localStorage.getItem(getChallengeStorageKey(username));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function readSavedActiveChallenge(expectedGameMode) {
  const data = readSavedChallengeData();
  const active = data?.activeChallenge;
  if (!active || active.gameMode !== expectedGameMode) return null;
  return active;
}

function applyPitchHistoryToPitchesList() {
  if (!pitchesList?.length || !pitchHistory?.length) return;
  pitchHistory.forEach((item, idx) => {
    const pitch = pitchesList[idx];
    if (!pitch) return;
    pitch.userCall = item.userCall;
    pitch.absCall = item.absCall;
    pitch.realCall = item.realCall;
    pitch.userCorrect = item.userCorrect;
    pitch.realCorrect = item.realCorrect;
    pitch.isSwingPlay = !!item.isSwingPlay;
    if (item.swingOutcome) pitch.swingOutcome = item.swingOutcome;
    if (item.swingHitType) pitch.swingHitType = item.swingHitType;
    if (item.pitchData) pitch.pitchTrajectory = item.pitchData.pitchTrajectory || pitch.pitchTrajectory;
  });
}

function restoreChallengePitchState(activeChallenge) {
  if (!activeChallenge) return;
  currentPitchIndex = activeChallenge.currentPitchIndex || 0;
  abBalls = activeChallenge.abBalls || 0;
  abStrikes = activeChallenge.abStrikes || 0;
  pitchHistory = activeChallenge.pitchHistory || [];
  applyPitchHistoryToPitchesList();
}

function hasWeeklyChallengeResumeProgress() {
  if (weeklyPlaylistABs.some((ab) => ab.completed)) return true;
  if (activeWeeklyAbIndex > 0) return true;
  const active = readSavedActiveChallenge('weekly_challenge');
  if (active && (active.currentPitchIndex > 0 || (active.pitchHistory?.length || 0) > 0)) {
    return true;
  }
  return gameMode === 'weekly_challenge' && (currentPitchIndex > 0 || pitchHistory.length > 0);
}

function hasStreakChallengeResumeProgress() {
  const active = readSavedActiveChallenge('daily_streak');
  if (active && (active.currentPitchIndex > 0 || (active.pitchHistory?.length || 0) > 0 || (active.streakPitchHistory?.length || 0) > 0)) {
    return true;
  }
  return gameMode === 'daily_streak' && !isSessionOver && (currentPitchIndex > 0 || pitchHistory.length > 0 || streakPitchHistory.length > 0);
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

function getMondayDateString(d = new Date()) {
  const day = d.getDay();
  // Adjust so Sunday (0) becomes 6, Monday (1) becomes 0, etc.
  const diff = d.getDate() - (day === 0 ? 6 : day - 1);
  const monday = new Date(d.setDate(diff));
  return monday.toISOString().slice(0, 10);
}

async function loadSavedSessionFromLocal() {
  const username = localStorage.getItem('ump_username');
  weeklyChallengeMeta = resolveWeeklyChallengeMeta(WEEKLY_CHALLENGE_DATA, WEEKLY_CHALLENGE_META);
  const currentWeekId = weeklyChallengeMeta.challengeWeekId;
  const storedWeek = localStorage.getItem('ump_weekly_challenge_week');
  if (storedWeek !== currentWeekId) {
    console.log('Weekly challenge week changed! Stored:', storedWeek, 'Current:', currentWeekId, 'Resetting weekly challenge progress.');
    const userSuffix = username ? username.toUpperCase() : 'GUEST';
    localStorage.removeItem(`pitch_ump_challenge_mvp_${userSuffix}`);
    localStorage.removeItem('pitch_ump_challenge_mvp_guest');
    
    if (username) {
      try {
        await clearActiveSession(username);
      } catch (e) {
        console.error("Failed to clear active weekly session on week change:", e);
      }
    }
    completedABsCount = [0, 0, 0, 0, 0];
    activeWeeklyAbIndex = 0;
    activeGameIndex = 0;
    weeklyPlaylistABs = extractAtBatsFromWeeklyData();
    localStorage.setItem('ump_weekly_challenge_week', currentWeekId);
  }

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
      if (session.weeklyPlaylistABs?.length) {
        weeklyPlaylistABs = session.weeklyPlaylistABs;
        if (session.gameMode === 'weekly_challenge') {
          activeWeeklyAbIndex = session.activeWeeklyAbIndex ?? activeWeeklyAbIndex;
        }
      }
      if (session.streakPlaylistABs?.length) {
        streakPlaylistABs = session.streakPlaylistABs;
        if (session.gameMode === 'daily_streak') {
          activeStreakAbIndex = session.activeStreakAbIndex ?? activeStreakAbIndex;
          streakPitchHistory = session.streakPitchHistory || streakPitchHistory;
        }
      }
      if (session.gameMode === 'weekly_challenge' || session.gameMode === 'daily_streak' || session.gameMode === 'mlb_game') {
        gameMode = session.gameMode;
        currentPitchIndex = session.currentPitchIndex ?? 0;
        abBalls = session.abBalls ?? 0;
        abStrikes = session.abStrikes ?? 0;
        pitchHistory = session.pitchHistory || [];
        if (session.pitchesList) pitchesList = session.pitchesList;
      }
      activeDailyDate = session.activeDailyDate;
      activeDailyTeam = session.activeDailyTeam;
      
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
  
  const weeklyKey = getChallengeStorageKey(username);
  const rawWeekly = localStorage.getItem(weeklyKey);
  if (rawWeekly) {
    try {
      const data = JSON.parse(rawWeekly);
      if (data.completedABsCount) completedABsCount = data.completedABsCount;
      if (data.activeGameIndex !== undefined) activeGameIndex = data.activeGameIndex;
      if (data.weeklyPlaylistABs && data.weeklyPlaylistABs.length > 0) {
        weeklyPlaylistABs = data.weeklyPlaylistABs;
      } else if (!weeklyPlaylistABs.length) {
        weeklyPlaylistABs = extractAtBatsFromWeeklyData();
      }
      if (data.streakPlaylistABs?.length) {
        streakPlaylistABs = data.streakPlaylistABs;
      }
      if (data.activeWeeklyAbIndex !== undefined) activeWeeklyAbIndex = data.activeWeeklyAbIndex;
      if (data.activeStreakAbIndex !== undefined) activeStreakAbIndex = data.activeStreakAbIndex;
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
    const hasProgress = hasWeeklyChallengeResumeProgress();
    if (hasProgress && activeWeeklyAbIndex < total) {
      btnStartWeeklyChallenge.textContent = "Resume Challenge";
    } else {
      btnStartWeeklyChallenge.textContent = "Start Challenge";
    }
  }

  updateWeeklyChallengeRankSnippet();
}

function updateProfileStatsUI(animateXp = false) {
  const avgAccEl = document.getElementById('stats-avg-accuracy');
  const maxStrEl = document.getElementById('stats-max-streak');
  const compWkEl = document.getElementById('stats-completed-weekly');
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
    const statsLifetimeChallenges = document.getElementById('stats-lifetime-challenges');
    if (statsLifetimeChallenges) statsLifetimeChallenges.textContent = "--";
    if (historyTableBody) historyTableBody.innerHTML = '<tr><td colspan="4" class="p-3 text-center text-gray-500 font-mono-tech text-[10px]">Log in to view stats</td></tr>';
    
    // Reset Top-Bar HUD for Guest
    updateHudHandleText(hudHandle, "GUEST_UMPIRE");
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
    
    // Reset Profile Hero elements for Guest
    const profileRankBadge = document.getElementById('profile-rank-badge');
    if (profileRankBadge) profileRankBadge.innerHTML = getLargeRankBadgeSvg(1);
    
    const profileLevelTag = document.getElementById('profile-level-tag');
    if (profileLevelTag) profileLevelTag.textContent = "LVL 1";
    
    const profileUserHandle = document.getElementById('profile-user-handle');
    if (profileUserHandle) profileUserHandle.textContent = "GUEST_UMPIRE";
    
    const profileTierTitle = document.getElementById('profile-tier-title');
    if (profileTierTitle) profileTierTitle.textContent = "Rookie Umpire";
    
    const profileXpText = document.getElementById('profile-xp-text');
    if (profileXpText) profileXpText.textContent = "0 / 1,000 XP";
    
    const profileXpBar = document.getElementById('profile-xp-bar');
    if (profileXpBar) profileXpBar.style.width = "0%";
    
    const profileXpRemaining = document.getElementById('profile-xp-remaining');
    if (profileXpRemaining) profileXpRemaining.textContent = "1,000 XP needed to next rank";
    
    const profileXpPct = document.getElementById('profile-xp-pct');
    if (profileXpPct) profileXpPct.textContent = "0% Progress";
    
    const profileTotalXp = document.getElementById('profile-total-xp');
    if (profileTotalXp) profileTotalXp.textContent = "0 XP";
    
    const profileFavTeamDisplay = document.getElementById('profile-fav-team-display');
    if (profileFavTeamDisplay) profileFavTeamDisplay.textContent = "NONE";
    
    const profileFavTeamLogo = document.getElementById('profile-fav-team-logo');
    if (profileFavTeamLogo) profileFavTeamLogo.src = "/generic.svg";
    
    // Reset Analytics & SVG
    const dotGroup = document.getElementById('profile-umpcard-dots');
    if (dotGroup) dotGroup.innerHTML = '';
    
    const personaTag = document.getElementById('profile-persona-tag');
    if (personaTag) {
      personaTag.textContent = "PENDING DATA...";
      personaTag.className = "px-2 py-0.5 text-[9px] font-mono-tech uppercase font-black text-black bg-purple-400 rounded";
    }
    
    const borderlineAcc = document.getElementById('profile-borderline-acc');
    if (borderlineAcc) borderlineAcc.textContent = "-- Borderline Acc";
    
    const biasMarker = document.getElementById('profile-bias-marker');
    if (biasMarker) biasMarker.style.left = "50%";
    
    const biasText = document.getElementById('profile-bias-text');
    if (biasText) biasText.textContent = "Balanced strike zone";
    
    const fVal = document.getElementById('profile-split-fastball-val');
    const fBar = document.getElementById('profile-split-fastball-bar');
    if (fVal) fVal.textContent = "--";
    if (fBar) fBar.style.width = "0%";
    
    const bVal = document.getElementById('profile-split-breaking-val');
    const bBar = document.getElementById('profile-split-breaking-bar');
    if (bVal) bVal.textContent = "--";
    if (bBar) bBar.style.width = "0%";
    
    const oVal = document.getElementById('profile-split-offspeed-val');
    const oBar = document.getElementById('profile-split-offspeed-bar');
    if (oVal) oVal.textContent = "--";
    if (oBar) oBar.style.width = "0%";
    
    return;
  }
  
  const normalized = normalizeHandle(username);
  const statsKey = getStatsStorageKey(normalized);
  const userStats = JSON.parse(localStorage.getItem(statsKey) || '{"overallAccuracy":null,"maxStreak":0,"completedWeekly":0,"history":[]}');
  
  // Set handle
  updateHudHandleText(hudHandle, normalized);
  
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
      
      if (isWeekly) {
        xp += (h.correctCalls || 0) * 10;
      } else if (isStreak) {
        xp += (h.correctCalls || 0) * 15;
      } else {
        xp += (h.correctCalls || 0) * 5;
      }
    });
  }
  
  const xpProgress = getXpProgressInLevel(xp);
  const tier = getLevelTier(xpProgress.level);
  
  const hudUserLevelTier = document.getElementById('hud-user-level-tier');
  if (hudUserLevelTier) {
    hudUserLevelTier.textContent = tier.title.toUpperCase();
  }
  
  const hudUserLevelIcon = document.getElementById('hud-user-level-icon');
  if (hudUserLevelIcon) {
    hudUserLevelIcon.innerHTML = getRankIconHtml(xpProgress.level);
  }
  
  const hudXpIconLeft = document.getElementById('hud-user-xp-icon-left');
  if (hudXpIconLeft) {
    hudXpIconLeft.innerHTML = getRankIconHtml(xpProgress.level);
  }
  
  const hudXpIconRight = document.getElementById('hud-user-xp-icon-right');
  if (hudXpIconRight) {
    hudXpIconRight.innerHTML = getRankIconHtml(xpProgress.level + 1);
  }
  
  const hudCentralXpPct = document.getElementById('hud-central-xp-pct');
  if (hudCentralXpPct) {
    hudCentralXpPct.textContent = `${xpProgress.pct}% Progress`;
  }

  const hudLevelBadge = document.getElementById('hud-user-level-badge');
  applyLevelBadgeElement(hudLevelBadge, xpProgress.level);
  
  if (hudXpText) {
    hudXpText.textContent = `${xpProgress.progress.toLocaleString()} / ${XP_PER_LEVEL.toLocaleString()} XP`;
  }
  setXpBarPercent(hudXpBar, xpProgress.pct, animateXp);
  
  const popover = document.getElementById('hud-xp-details-popover');
  if (popover && !popover.classList.contains('opacity-0')) {
    populateXpPopoverData();
  }
  
  // Profile Hero Layout Elements
  const profileRankBadge = document.getElementById('profile-rank-badge');
  if (profileRankBadge) profileRankBadge.innerHTML = getLargeRankBadgeSvg(xpProgress.level);
  
  const profileLevelTag = document.getElementById('profile-level-tag');
  if (profileLevelTag) profileLevelTag.textContent = `LVL ${xpProgress.level}`;
  
  const profileUserHandle = document.getElementById('profile-user-handle');
  if (profileUserHandle) profileUserHandle.textContent = normalized;
  
  const profileTierTitle = document.getElementById('profile-tier-title');
  if (profileTierTitle) profileTierTitle.textContent = tier.title;
  
  const profileXpText = document.getElementById('profile-xp-text');
  if (profileXpText) {
    profileXpText.textContent = `${xpProgress.progress.toLocaleString()} / ${XP_PER_LEVEL.toLocaleString()} XP`;
  }
  
  const profileXpBar = document.getElementById('profile-xp-bar');
  if (profileXpBar) {
    profileXpBar.style.width = `${xpProgress.pct}%`;
  }
  
  const profileXpRemaining = document.getElementById('profile-xp-remaining');
  if (profileXpRemaining) {
    const remaining = XP_PER_LEVEL - xpProgress.progress;
    profileXpRemaining.textContent = `${remaining.toLocaleString()} XP needed to next rank`;
  }
  
  const profileXpPct = document.getElementById('profile-xp-pct');
  if (profileXpPct) {
    profileXpPct.textContent = `${xpProgress.pct}% Progress`;
  }
  
  const profileTotalXp = document.getElementById('profile-total-xp');
  if (profileTotalXp) {
    profileTotalXp.textContent = `${xp.toLocaleString()} XP`;
  }
  
  const profileFavTeamDisplay = document.getElementById('profile-fav-team-display');
  if (profileFavTeamDisplay) {
    profileFavTeamDisplay.textContent = (activeFavoriteTeam && activeFavoriteTeam !== "none") ? activeFavoriteTeam.toUpperCase() : "NONE";
  }
  
  const profileFavTeamLogo = document.getElementById('profile-fav-team-logo');
  if (profileFavTeamLogo) {
    profileFavTeamLogo.src = (activeFavoriteTeam && activeFavoriteTeam !== "none") ? getTeamLogoUrl(activeFavoriteTeam) : "/generic.svg";
  }
  
  // Telemetry Cards
  if (avgAccEl) {
    avgAccEl.textContent = userStats.overallAccuracy !== null && userStats.overallAccuracy !== undefined ? `${userStats.overallAccuracy}%` : "--";
  }
  if (maxStrEl) {
    maxStrEl.textContent = userStats.maxStreak || "0";
  }
  if (compWkEl) {
    const activeWeekGamesCompleted = (completedABsCount && Array.isArray(completedABsCount)) ? completedABsCount.filter(c => c === 1).length : 0;
    compWkEl.textContent = `${activeWeekGamesCompleted} / 5 Games`;
  }
  const statsLifetimeChallenges = document.getElementById('stats-lifetime-challenges');
  if (statsLifetimeChallenges) {
    statsLifetimeChallenges.textContent = `${userStats.completedWeekly || 0} Games`;
  }
  // SVG UmpCard Dots Plotting
  const dotGroup = document.getElementById('profile-umpcard-dots');
  const recentPitches = userStats.recentPitches || [];
  
  if (dotGroup) {
    dotGroup.innerHTML = '';
    recentPitches.forEach(p => {
      // Map coordinates:
      // x_svg = 100 + x_feet * 50
      // y_svg = 75 + (3.4 - y_feet) * 55.5555
      const cx = 100 + p.x * 50;
      const cy = 75 + (3.4 - p.y) * 55.5555;
      
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', cx.toFixed(2));
      circle.setAttribute('cy', cy.toFixed(2));
      circle.setAttribute('r', '3');
      circle.setAttribute('fill', p.userCorrect ? 'var(--retro-ok)' : 'var(--retro-miss)');
      circle.setAttribute('stroke', '#000000');
      circle.setAttribute('stroke-width', '0.5');
      dotGroup.appendChild(circle);
    });
  }

  // Calculate advanced metrics
  const personaTag = document.getElementById('profile-persona-tag');
  const borderlineAcc = document.getElementById('profile-borderline-acc');
  const biasMarker = document.getElementById('profile-bias-marker');
  const biasText = document.getElementById('profile-bias-text');
  
  const fVal = document.getElementById('profile-split-fastball-val');
  const fBar = document.getElementById('profile-split-fastball-bar');
  const bVal = document.getElementById('profile-split-breaking-val');
  const bBar = document.getElementById('profile-split-breaking-bar');
  const oVal = document.getElementById('profile-split-offspeed-val');
  const oBar = document.getElementById('profile-split-offspeed-bar');

  if (recentPitches.length === 0) {
    if (personaTag) {
      personaTag.textContent = "PENDING DATA...";
      personaTag.className = "px-2 py-0.5 text-[9px] font-mono-tech uppercase font-black text-black bg-purple-400 rounded";
    }
    if (borderlineAcc) borderlineAcc.textContent = "-- Borderline Acc";
    if (biasMarker) biasMarker.style.left = "50%";
    if (biasText) biasText.textContent = "Balanced strike zone";
    
    if (fVal) fVal.textContent = "--";
    if (fBar) fBar.style.width = "0%";
    if (bVal) bVal.textContent = "--";
    if (bBar) bBar.style.width = "0%";
    if (oVal) oVal.textContent = "--";
    if (oBar) oBar.style.width = "0%";
  } else {
    // 1. Borderline Accuracy
    const borderlinePitches = recentPitches.filter(p => p.isBorderline);
    if (borderlinePitches.length === 0) {
      if (borderlineAcc) borderlineAcc.textContent = "-- Borderline Acc";
    } else {
      const correctBorderline = borderlinePitches.filter(p => p.userCorrect).length;
      const borderlineAccPct = Math.round((correctBorderline / borderlinePitches.length) * 100);
      if (borderlineAcc) borderlineAcc.textContent = `${borderlineAccPct}% Borderline Acc`;
    }
    
    // 2. Squeeze vs Expand Bias
    const squeezes = recentPitches.filter(p => p.isSqueeze).length;
    const expansions = recentPitches.filter(p => p.isExpansion).length;
    
    let biasPct = 50;
    if (squeezes + expansions > 0) {
      biasPct = (expansions / (squeezes + expansions)) * 100;
    }
    
    if (biasMarker) {
      biasMarker.style.left = `${biasPct}%`;
    }
    
    if (biasText) {
      if (biasPct >= 45 && biasPct <= 55) {
        biasText.textContent = "Balanced strike zone";
      } else if (biasPct < 45) {
        biasText.textContent = biasPct < 30 ? "Heavy squeeze bias (Tight zone)" : "Slight squeeze bias (Tight zone)";
      } else {
        biasText.textContent = biasPct > 70 ? "Heavy expansion bias (Generous zone)" : "Slight expansion bias (Generous zone)";
      }
    }
    
    // 3. Umpire Persona Archetype
    if (personaTag) {
      const correctPitches = recentPitches.filter(p => p.userCorrect).length;
      const overallRecentAcc = (correctPitches / recentPitches.length) * 100;
      
      let archetype = "ABS Oracle";
      let bgClass = "bg-[var(--retro-gold)] text-black";
      
      if (overallRecentAcc >= 94 || (squeezes + expansions === 0)) {
        archetype = "ABS Oracle";
        bgClass = "bg-[var(--retro-gold)] text-black";
      } else if (biasPct < 45) {
        archetype = "Tight Zone Squeezer";
        bgClass = "bg-[var(--retro-ball)] text-black";
      } else if (biasPct > 55) {
        archetype = "Generous Zone Expander";
        bgClass = "bg-[var(--retro-strike)] text-black";
      } else {
        archetype = "ABS Oracle";
        bgClass = "bg-[var(--retro-gold)] text-black";
      }
      
      personaTag.textContent = archetype;
      personaTag.className = `px-2 py-0.5 text-[9px] font-mono-tech uppercase font-black rounded ${bgClass}`;
    }
    
    // 4. Splits
    const fastballs = recentPitches.filter(p => p.pitchClass === 'Fastball');
    if (fastballs.length === 0) {
      if (fVal) fVal.textContent = "--";
      if (fBar) fBar.style.width = "0%";
    } else {
      const correctF = fastballs.filter(p => p.userCorrect).length;
      const accF = Math.round((correctF / fastballs.length) * 100);
      if (fVal) fVal.textContent = `${accF}%`;
      if (fBar) fBar.style.width = `${accF}%`;
    }
    
    const breakings = recentPitches.filter(p => p.pitchClass === 'Breaking');
    if (breakings.length === 0) {
      if (bVal) bVal.textContent = "--";
      if (bBar) bBar.style.width = "0%";
    } else {
      const correctB = breakings.filter(p => p.userCorrect).length;
      const accB = Math.round((correctB / breakings.length) * 100);
      if (bVal) bVal.textContent = `${accB}%`;
      if (bBar) bBar.style.width = `${accB}%`;
    }
    
    const offspeeds = recentPitches.filter(p => p.pitchClass === 'Offspeed');
    if (offspeeds.length === 0) {
      if (oVal) oVal.textContent = "--";
      if (oBar) oBar.style.width = "0%";
    } else {
      const correctO = offspeeds.filter(p => p.userCorrect).length;
      const accO = Math.round((correctO / offspeeds.length) * 100);
      if (oVal) oVal.textContent = `${accO}%`;
      if (oBar) oBar.style.width = `${accO}%`;
    }
  }
  
  if (historyTableBody) {
    historyTableBody.innerHTML = '';
    if (!userStats.history || userStats.history.length === 0) {
      historyTableBody.innerHTML = '<tr><td colspan="4" class="p-3 text-center text-gray-500 font-mono-tech text-[10px]">No challenge history recorded yet.</td></tr>';
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
          <td class="p-3 text-center text-xs font-mono-tech font-black text-[var(--retro-gold)]">
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
  const meta = weeklyChallengeMeta || resolveWeeklyChallengeMeta(WEEKLY_CHALLENGE_DATA, WEEKLY_CHALLENGE_META);
  const randGenerator = mulberry32(meta.shuffleSeed);
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
  try {
  hideChallengeDetailModal();
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
        restoreChallengePitchState(session);
        restored = true;
      }
    } catch (e) {
      console.error("Failed to check active weekly session in IndexedDB:", e);
    }
  }
  
  if (!restored) {
    const key = getChallengeStorageKey(username);
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

        if (savedPlaylist && savedData.activeChallenge?.gameMode === 'weekly_challenge') {
          restoreChallengePitchState(savedData.activeChallenge);
          restored = true;
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
  
  if (!weeklyPlaylistABs.length) {
    throw new Error('Weekly challenge playlist is empty');
  }
  loadWeeklyAtBat(activeWeeklyAbIndex, restored);
  } catch (err) {
    console.error('Failed to start weekly challenge:', err);
    if (toastMessage) {
      toastMessage.innerHTML = '<span class="text-red-300 font-bold font-mono-tech">WEEKLY CHALLENGE FAILED TO START</span>';
      toastMessage.classList.remove('opacity-0', 'scale-95', '-translate-y-4');
      toastMessage.classList.add('opacity-100', 'scale-100', 'translate-y-0');
      setTimeout(() => {
        toastMessage.classList.add('opacity-0', 'scale-95', '-translate-y-4');
        toastMessage.classList.remove('opacity-100', 'scale-100', 'translate-y-0');
      }, 3200);
    }
  }
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
    completedABsCount[activeGameIndex] = 1;
    saveChallengeSessionToLocal();
    saveGameProgress();
    transitionToState(STATES.SCOREBOARD);
    return;
  }
  
  activeWeeklyAbIndex = abIdx;
  const abData = weeklyPlaylistABs[activeWeeklyAbIndex];
  pitchesList = getAbPitches(abData);
  if (!abData || pitchesList.length === 0) {
    throw new Error('Weekly challenge at-bat has no pitch data');
  }
  if (!isResume) {
    activeAbEnded = false;
    currentPitchIndex = 0;
    pitchHistory = [];
    currentAbStartHistoryIndex = 0;
    
    abBalls = 0;
    abStrikes = 0;
  } else {
    if (pitchHistory.length > 0) {
      applyPitchHistoryToPitchesList();
    } else {
      reconstructActiveAtBatState();
    }
    
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
  
  const enterGameplay = () => {
    showAtBatStartScreen(() => {
      if (currentState === STATES.IDLE && !isGamePaused) {
        autoPlayTimeout = setTimeout(() => {
          triggerPitchRelease();
        }, 600);
      }
    }, isResume);
  };

  transitionToState(STATES.IDLE, { deferNavUpdate: true });
  enterGameplay();
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
  const btn = document.getElementById('btn-start-daily-streak');
  const status = document.getElementById('daily-attempt-status');
  const outcomeEl = document.getElementById('daily-streak-outcome');
  const historicalEl = document.getElementById('daily-streak-historical');
  const rankEl = document.getElementById('daily-streak-rank');
  
  const statsKey = `pitch_ump_stats_${username.toUpperCase()}`;
  const userStats = JSON.parse(localStorage.getItem(statsKey) || '{"overallAccuracy":null,"maxStreak":0,"completedWeekly":0,"history":[]}');
  
  if (historicalEl) {
    historicalEl.textContent = `${userStats.maxStreak || 0} Pitches`;
  }
  
  if (outcomeEl) {
    const todayStr = new Date().toISOString().slice(0, 10);
    const todayBest = (userStats.streakHistory && userStats.streakHistory[todayStr]) || 0;
    outcomeEl.textContent = `${todayBest} PITCHES`;
    outcomeEl.className = "text-white font-black";
  }

  if (status) {
    status.textContent = "Available (Unlimited Play)";
    status.className = "text-xs font-bold text-green-400 uppercase";
  }
  if (btn) {
    btn.removeAttribute('disabled');
    btn.className = "ump-btn bg-gradient-to-b from-amber-500 to-amber-700 hover:from-amber-400 hover:to-amber-600 border-amber-500/50 text-white ump-btn--sm pointer-events-auto";
    btn.textContent = hasStreakChallengeResumeProgress() ? "Resume Streak" : "Play Streak";
  }
  if (rankEl && username !== 'GUEST_UMPIRE') {
    rankEl.textContent = "FETCHING...";
    try {
      const { rows } = await getLeaderboardRows('daily', username);
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

const MENU_CROSSFADE_MS = 320;

function isOverlayShowing(el) {
  return el && el.classList.contains('opacity-100') && !el.classList.contains('hidden');
}

function fadeOverlayOut(el, durationMs = MENU_CROSSFADE_MS) {
  if (!el || !isOverlayShowing(el)) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      el.classList.add('hidden');
      resolve();
    };
    const onEnd = (e) => {
      if (e.target !== el || e.propertyName !== 'opacity') return;
      el.removeEventListener('transitionend', onEnd);
      done();
    };
    el.addEventListener('transitionend', onEnd);
    setTimeout(done, durationMs + 80);
    el.classList.add('opacity-0', 'pointer-events-none');
    el.classList.remove('opacity-100', 'pointer-events-auto');
  });
}

function fadeOverlayIn(el) {
  if (!el) return;
  el.classList.remove('hidden', 'scale-95');
  el.classList.add('opacity-0', 'pointer-events-none', 'scale-100');
  el.classList.remove('opacity-100', 'pointer-events-auto');
  void el.offsetWidth;
  requestAnimationFrame(() => {
    el.classList.remove('opacity-0', 'pointer-events-none');
    el.classList.add('opacity-100', 'pointer-events-auto');
  });
}

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
  updateXpBarColors();
  updateProfileStatsUI();
  initProfileSettingsUI();
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
  updateXpBarColors();
  updateProfileStatsUI();
  initProfileSettingsUI();
}

function updateXpBarColors() {
  if (activeFavoriteTeam && activeFavoriteTeam !== 'none') {
    const team = TEAMS_LIST.find(t => t.name.toLowerCase() === activeFavoriteTeam.toLowerCase());
    if (team && team.color) {
      const match = team.color.match(/hsl\((\d+),\s*(\d+)%,\s*(\d+)%\)/);
      if (match) {
        const h = parseInt(match[1]);
        const s = parseInt(match[2]);
        const l = parseInt(match[3]);
        const startColor = `hsl(${h}, ${s}%, ${Math.max(10, l - 12)}%)`;
        const midColor = `hsl(${h}, ${s}%, ${l}%)`;
        const endColor = `hsl(${h}, ${s}%, ${Math.min(95, l + 15)}%)`;
        const gradient = `linear-gradient(90deg, ${startColor} 0%, ${midColor} 50%, ${endColor} 100%)`;
        document.documentElement.style.setProperty('--ump-xp-bar-bg-gradient', gradient);
        return;
      }
    }
  }
  document.documentElement.style.removeProperty('--ump-xp-bar-bg-gradient');
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

async function getLeaderboardRows(board, username, period) {
  return apiFetchLeaderboard(board, username, period);
}

async function getCrewLeaderboardRows(metric, username) {
  return apiFetchCrewLeaderboard(metric, username);
}

async function getLeaderboardPeriods(board) {
  return apiFetchLeaderboardPeriods(board);
}

function getCurrentChallengeWeekId() {
  const meta = weeklyChallengeMeta || resolveWeeklyChallengeMeta(WEEKLY_CHALLENGE_DATA, WEEKLY_CHALLENGE_META);
  return meta.challengeWeekId;
}

function getActiveWeeklyPeriodKey() {
  return activeWeeklyPeriodKey || getCurrentChallengeWeekId();
}

function syncStandingsBoardTabs(type) {
  const tabs = [
    { btn: leaderBtnWeekly, id: 'weekly' },
    { btn: leaderBtnDaily, id: 'daily' },
    { btn: leaderBtnCrew, id: 'crew' },
  ];
  tabs.forEach(({ btn, id }) => {
    if (!btn) return;
    const active = id === type;
    btn.classList.toggle('ump-tab--active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });
}

function syncStandingsContextBar(type) {
  const currentWeek = getCurrentChallengeWeekId();
  const periodKey = getActiveWeeklyPeriodKey();
  const isWeekly = type === 'weekly';
  const isStreak = type === 'daily';
  const isHistory = isWeekly && standingsViewMode === 'history';
  const isAlltime = isStreak && standingsViewMode === 'alltime';
  const isPastWeek = isWeekly && !isHistory && periodKey !== currentWeek;

  if (standingsCrewSeg) {
    standingsCrewSeg.classList.toggle('hidden', type !== 'crew');
  }
  const contextBar = document.getElementById('standings-context-bar');
  if (contextBar) {
    contextBar.classList.toggle('hidden', type === 'crew');
  }
  if (btnStandingsBack) {
    btnStandingsBack.classList.toggle(
      'hidden',
      type === 'crew' || (!isHistory && !isAlltime && !isPastWeek)
    );
  }
  if (btnStandingsHistory) {
    const showSecondary = (isWeekly && !isHistory && !isPastWeek) || (isStreak && !isAlltime);
    btnStandingsHistory.classList.toggle('hidden', !showSecondary);
    if (showSecondary) {
      btnStandingsHistory.textContent = isWeekly ? 'History' : 'All-time';
    }
  }
  if (standingsContextLabel) {
    if (isHistory) {
      standingsContextLabel.textContent = 'Past weekly challenges';
    } else if (isAlltime) {
      standingsContextLabel.textContent = 'All-time streak leaders';
    } else if (type === 'weekly') {
      standingsContextLabel.textContent =
        periodKey === currentWeek ? `${formatWeekLabel(currentWeek)} · this week` : `${formatWeekLabel(periodKey)} · archived`;
    } else if (type === 'daily') {
      standingsContextLabel.textContent = "Today's streak board";
    } else if (type === 'crew') {
      const crewLabels = {
        rank: 'Crew Chief · sorted by level (XP)',
        wins: 'Crew Chief · sorted by weekly wins',
        streak: 'Crew Chief · sorted by best streak',
      };
      standingsContextLabel.textContent = crewLabels[activeCrewMetric] || 'Crew Chief standings';
    }
  }
}

function getStandingsHandleLabel(name) {
  return (name || '').replace(/\s*\(YOU\)\s*/i, '').trim() || 'Umpire';
}

function getStandingsRowLevel(row) {
  if (row.xp !== undefined && row.xp !== null && Number.isFinite(Number(row.xp))) {
    return getLevelFromXp(Number(row.xp));
  }
  if (activeStandingsBoard === 'crew' && activeCrewMetric === 'rank' && row.score_raw) {
    return Math.max(1, Number(row.score_raw) || 1);
  }
  return Math.max(1, Math.min(100, Math.round(50 - row.rank * 1.5 + (row.score_raw || 0) / 100)));
}

function getStandingsRowXp(row, level) {
  if (row.xp !== undefined && row.xp !== null && Number.isFinite(Number(row.xp))) {
    return Number(row.xp);
  }
  if (activeStandingsBoard === 'crew' && activeCrewMetric === 'rank' && row.score_raw) {
    return Math.max(0, (level - 1) * XP_PER_LEVEL + Math.floor(XP_PER_LEVEL * 0.4));
  }
  return Math.max(0, (level - 1) * XP_PER_LEVEL + 250);
}

let standingsXpPopoverAnchor = null;

function hideStandingsXpPopover() {
  const pop = document.getElementById('standings-xp-popover');
  if (!pop) return;
  pop.classList.add('hidden');
  pop.setAttribute('aria-hidden', 'true');
  standingsXpPopoverAnchor = null;
}

function showStandingsXpPopover(anchor, { handle, xp }) {
  const pop = document.getElementById('standings-xp-popover');
  if (!pop || !anchor) return;

  const safeXp = Number.isFinite(xp) ? xp : 0;
  const progress = getXpProgressInLevel(safeXp);
  const tier = getLevelTier(progress.level);

  const badgeEl = document.getElementById('standings-xp-popover-badge');
  const handleEl = document.getElementById('standings-xp-popover-handle');
  const tierEl = document.getElementById('standings-xp-popover-tier');
  const levelEl = document.getElementById('standings-xp-popover-level');
  const xpEl = document.getElementById('standings-xp-popover-xp');

  if (badgeEl) badgeEl.innerHTML = getRankIconHtml(progress.level);
  if (handleEl) handleEl.textContent = handle;
  if (tierEl) tierEl.textContent = tier.title;
  if (levelEl) levelEl.textContent = `Level ${progress.level}`;
  if (xpEl) xpEl.textContent = `${safeXp.toLocaleString()} XP`;

  pop.classList.remove('hidden');
  pop.setAttribute('aria-hidden', 'false');
  standingsXpPopoverAnchor = anchor;

  const rect = anchor.getBoundingClientRect();
  const popWidth = pop.offsetWidth || 224;
  const popHeight = pop.offsetHeight || 160;
  let top = rect.bottom + 8;
  let left = rect.left + rect.width / 2 - popWidth / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - popWidth - 8));
  if (top + popHeight > window.innerHeight - 8) {
    top = Math.max(8, rect.top - popHeight - 8);
  }
  pop.style.top = `${top}px`;
  pop.style.left = `${left}px`;
}

function bindStandingsLevelButtons() {
  if (!leaderboardList) return;
  leaderboardList.querySelectorAll('.standings-row__level').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const handle = btn.getAttribute('data-handle') || 'Umpire';
      const xp = Number(btn.getAttribute('data-xp')) || 0;
      const pop = document.getElementById('standings-xp-popover');
      if (standingsXpPopoverAnchor === btn && pop && !pop.classList.contains('hidden')) {
        hideStandingsXpPopover();
        return;
      }
      showStandingsXpPopover(btn, { handle, xp });
    });
  });
}

const STANDINGS_MEDAL_STYLES = {
  1: {
    from: '#fff8dc',
    mid: '#e8c547',
    to: '#9a7a1e',
    stroke: '#e8c547',
    text: '#2a1800',
    glow: 'drop-shadow(0 0 6px rgba(232, 197, 71, 0.55))',
  },
  2: {
    from: '#f8fafc',
    mid: '#94a3b8',
    to: '#64748b',
    stroke: '#cbd5e1',
    text: '#1e293b',
    glow: '',
  },
  3: {
    from: '#f0c896',
    mid: '#cd7f32',
    to: '#8b5a2b',
    stroke: '#cd7f32',
    text: '#f4ecd8',
    textStroke: '#2a1800',
    glow: '',
  },
};

function getStandingsMedalHtml(rank) {
  if (rank < 1 || rank > 3) return `#${rank}`;

  const info = STANDINGS_MEDAL_STYLES[rank];
  const gradId = `standings-medal-${rank}-${Math.floor(Math.random() * 100000)}`;
  const fontSize = rank === 1 ? '10px' : '9px';
  const filterAttr = info.glow ? ` style="filter:${info.glow}"` : '';
  const stitchAccent =
    rank === 1
      ? '<line x1="16" y1="2" x2="16" y2="6" stroke="#c41e3a" stroke-width="1.5" stroke-linecap="round"/>'
      : '';
  const textStroke = info.textStroke
    ? ` stroke="${info.textStroke}" stroke-width="0.85" paint-order="stroke fill"`
    : '';

  return `
    <svg class="standings-row__medal standings-row__medal--${rank}" viewBox="0 0 32 32"${filterAttr} aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="${gradId}" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${info.from}" />
          <stop offset="55%" stop-color="${info.mid}" />
          <stop offset="100%" stop-color="${info.to}" />
        </linearGradient>
      </defs>
      <polygon points="16,2 30,9 30,23 16,30 2,23 2,9" fill="url(#${gradId})" stroke="${info.stroke}" stroke-width="1.2"/>
      <polygon points="16,4 27,10 27,22 16,28 5,22 5,10" fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="0.75"/>
      ${stitchAccent}
      <text x="16" y="20" font-family="'Press Start 2P', monospace" font-size="${fontSize}" fill="${info.text}" text-anchor="middle"${textStroke}>${rank}</text>
    </svg>`;
}

function formatLeaderboardRank(rank) {
  if (rank >= 1 && rank <= 3) {
    return getStandingsMedalHtml(rank);
  }
  return `#${rank}`;
}

function getStandingsScoreClass(type) {
  if (type === 'daily') return 'standings-row__stat--amber';
  if (type === 'crew') return 'standings-row__stat--purple';
  return '';
}

function renderStandingsList(rows, type, columns) {
  if (!leaderboardList) return;

  hideStandingsXpPopover();
  leaderboardList.classList.remove('standings-list--history');
  const isCrewRank = type === 'crew' && activeCrewMetric === 'rank';
  leaderboardList.classList.toggle('standings-list--crew-rank', isCrewRank);

  const scoreClass = getStandingsScoreClass(type);
  const scoreLabel = columns.find((c) => c.key === 'score')?.label || 'Score';

  const header = `
    <div class="standings-list-header">
      <span>#</span>
      <span>Lvl</span>
      <span>Name</span>
      ${isCrewRank ? '' : `<span class="text-center">${scoreLabel}</span>`}
    </div>
  `;

  const body = rows
    .map((r) => {
      const pLevel = getStandingsRowLevel(r);
      const xp = getStandingsRowXp(r, pLevel);
      const handle = getStandingsHandleLabel(r.name);
      const metaLine = isCrewRank ? '' : `<div class="standings-row__meta">${r.accuracy}</div>`;
      const scoreCell = isCrewRank
        ? ''
        : `<div class="standings-row__stat ${scoreClass}"><strong>${r.score}</strong></div>`;

      return `
        <div class="standings-row ${r.isUser ? 'standings-row--you' : ''}" role="listitem">
          <div class="standings-row__rank">${formatLeaderboardRank(r.rank)}</div>
          <button type="button" class="standings-row__level" data-handle="${handle}" data-xp="${xp}" data-level="${pLevel}" aria-label="View ${handle} level and XP">
            ${getRankIconHtml(pLevel)}
          </button>
          <div class="standings-row__main">
            <span class="standings-row__name-text">${handle}${r.isUser ? ' <span class="text-[var(--retro-grass)]">(you)</span>' : ''}</span>
            ${metaLine}
          </div>
          ${scoreCell}
        </div>
      `;
    })
    .join('');

  leaderboardList.innerHTML = header + body;
  bindStandingsLevelButtons();
}

function renderWeeklyHistoryList(periods) {
  if (!leaderboardList) return;

  hideStandingsXpPopover();
  leaderboardList.classList.add('standings-list--history');
  leaderboardList.classList.remove('standings-list--crew-rank');

  const currentWeek = getCurrentChallengeWeekId();
  const header = `
    <div class="standings-list-header">
      <span>Week</span>
      <span>Winner</span>
      <span class="text-center">Score</span>
    </div>
  `;

  if (!periods.length) {
    leaderboardList.innerHTML = `${header}<div class="standings-empty">No completed weekly challenges yet</div>`;
    return;
  }

  const body = periods
    .map((p) => {
      const isCurrent = p.periodKey === currentWeek;
      const winner = p.winnerHandle || '—';
      return `
        <button type="button" class="standings-row standings-row--clickable w-full text-left" data-period-key="${p.periodKey}" role="listitem">
          <div class="standings-row__rank">${isCurrent ? 'Now' : p.periodKey.replace(/^\d+-W/, 'W')}</div>
          <div class="standings-row__main">
            <span class="standings-row__name-text">${winner}</span>
            <div class="standings-row__meta">${p.winnerAccuracy || '—'} · ${p.entryCount} umpire${p.entryCount === 1 ? '' : 's'}</div>
          </div>
          <div class="standings-row__stat"><strong>${p.winnerScore || '—'}</strong></div>
        </button>
      `;
    })
    .join('');

  leaderboardList.innerHTML = header + body;
  leaderboardList.querySelectorAll('[data-period-key]').forEach((el) => {
    el.addEventListener('click', () => {
      activeWeeklyPeriodKey = el.getAttribute('data-period-key');
      standingsViewMode = 'ranks';
      renderLeaderboard('weekly');
    });
  });
}

function renderStandingsEmpty(source, message) {
  const msg =
    message ||
    (source === 'offline'
      ? 'Could not load standings — use npm run dev:api locally'
      : 'No scores for this period yet');
  if (leaderboardList) {
    leaderboardList.innerHTML = `<div class="standings-empty">${msg}</div>`;
  }
}

function renderStandingsLoading() {
  if (leaderboardList) {
    hideStandingsXpPopover();
    leaderboardList.classList.remove('standings-list--crew-rank', 'standings-list--history');
    leaderboardList.innerHTML = '<div class="standings-loading">Loading…</div>';
  }
}

async function renderLeaderboard(type) {
  if (!leaderboardList) return;

  activeStandingsBoard = type;
  syncStandingsBoardTabs(type);
  syncStandingsContextBar(type);
  renderStandingsLoading();

  if (type === 'weekly' && standingsViewMode === 'history') {
    try {
      const result = await getLeaderboardPeriods('weekly');
      cachedWeeklyPeriods = result.periods || [];
      renderWeeklyHistoryList(cachedWeeklyPeriods);
    } catch (err) {
      console.warn('Error loading weekly history:', err);
      renderStandingsEmpty('offline', 'Could not load weekly history');
    }
    return;
  }

  let boardConfig =
    type === 'daily' && standingsViewMode === 'alltime'
      ? STANDINGS_BOARDS.find((b) => b.id === 'streak_alltime')
      : STANDINGS_BOARDS.find((b) => b.id === type);
  boardConfig = boardConfig || STANDINGS_BOARDS[0];
  let columns = boardConfig.columns || [];
  if (type === 'crew') {
    const sub = boardConfig.subBoards?.find((s) => s.metric === activeCrewMetric) || boardConfig.subBoards?.[0];
    columns = sub?.columns || columns;
  }

  const activeHandle = localStorage.getItem('ump_username') || 'YOU';
  let rows = [];
  let source = 'empty';

  try {
    if (type === 'crew') {
      const result = await getCrewLeaderboardRows(activeCrewMetric, activeHandle);
      rows = result.rows;
      source = result.source;
    } else if (type === 'weekly') {
      const period = getActiveWeeklyPeriodKey();
      const result = await getLeaderboardRows('weekly', activeHandle, period);
      rows = result.rows;
      source = result.source;
    } else if (standingsViewMode === 'alltime') {
      const result = await getLeaderboardRows('alltime', activeHandle);
      rows = result.rows;
      source = result.source;
    } else {
      const result = await getLeaderboardRows('daily', activeHandle);
      rows = result.rows;
      source = result.source;
    }
  } catch (err) {
    console.warn('Error loading leaderboard:', err);
    renderStandingsEmpty('offline');
    return;
  }

  if (rows.length === 0) {
    renderStandingsEmpty(source);
    return;
  }

  renderStandingsList(rows, type, columns);
}

async function updateWeeklyChallengeRankSnippet() {
  const snippetEl = document.getElementById('weekly-challenge-rank-snippet');
  if (!snippetEl) return;
  const username = localStorage.getItem('ump_username');
  if (!username) {
    snippetEl.classList.add('hidden');
    return;
  }
  snippetEl.classList.remove('hidden');
  snippetEl.textContent = 'Loading rank…';
  try {
    const meta = weeklyChallengeMeta || resolveWeeklyChallengeMeta(WEEKLY_CHALLENGE_DATA, WEEKLY_CHALLENGE_META);
    const { rows } = await getLeaderboardRows('weekly', username, meta.challengeWeekId);
    const me = rows.find((r) => r.isUser);
    snippetEl.textContent = me ? `Your rank: #${me.rank} · ${me.accuracy}` : 'Complete the challenge to rank';
  } catch {
    snippetEl.textContent = 'Rank unavailable offline';
  }
}

async function submitGlobalScore(type, name, team, accuracy, scoreValue, rawScore) {
  if (!name || name.toUpperCase() === 'YOU' || name.toUpperCase() === 'GUEST' || name.trim() === '') return;
  const board = type === 'streak' ? 'daily' : type;
  const meta = weeklyChallengeMeta || resolveWeeklyChallengeMeta(WEEKLY_CHALLENGE_DATA, WEEKLY_CHALLENGE_META);
  try {
    await apiSubmitLeaderboard({
      board,
      periodKey: board === 'weekly' ? meta.challengeWeekId : undefined,
      team: team || 'None',
      accuracy,
      scoreText: scoreValue,
      scoreRaw: rawScore,
    });
  } catch (err) {
    console.warn('Failed to sync score to global leaderboard:', err);
  }
}

function mulberry32(a) {
  return function() {
    let t = a += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}

function launchGame(rawABs, gameMeta) {
  const username = localStorage.getItem('ump_username');
  if (!username) return;

  const meta = typeof gameMeta === "string"
    ? { dateString: gameMeta, awayTeam: null, homeTeam: null, gamePk: null, title: null }
    : (gameMeta || {});

  gameMode = 'mlb_game';
  activeDailyDate = meta.dateString || null;
  activeDailyTeam = meta.awayTeam || null;
  activeMlbGamePk = meta.gamePk || null;
  activeGameIndex = meta.gameIndex ?? activeGameIndex;
  isGamePaused = false;

  if (pauseScreen) {
    pauseScreen.classList.add('opacity-0', 'pointer-events-none');
    pauseScreen.classList.remove('opacity-100', 'pointer-events-auto');
  }

  const normalizedABs = normalizePlaylistAbs(rawABs, meta);
  const sessionKeySuffix = meta.gamePk
    ? `mlb_${meta.gamePk}`
    : (meta.dateString || "session");
  const key = `pitch_ump_mlb_game_mvp_${username.toUpperCase()}_${sessionKeySuffix}`;
  const rawSession = localStorage.getItem(key);
  let savedPlaylist = null;
  let savedAbIndex = 0;

  if (rawSession) {
    try {
      const savedData = JSON.parse(rawSession);
      const savedPk = savedData.gamePk;
      const sameGame = !meta.gamePk || savedPk === meta.gamePk;
      if (sameGame && savedData.weeklyPlaylistABs && savedData.weeklyPlaylistABs.length === normalizedABs.length) {
        savedPlaylist = savedData.weeklyPlaylistABs;
        savedAbIndex = savedData.activeWeeklyAbIndex || 0;
        if (savedAbIndex >= savedPlaylist.length) {
          savedPlaylist = null;
          savedAbIndex = 0;
        }
      }
    } catch (e) {
      console.error("Failed to restore MLB game playlist", e);
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
    weeklyPlaylistABs = normalizedABs;
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
  challengeDetailModalOpen = true;
  if (challengeDetailModalOverlay) {
    challengeDetailModalOverlay.classList.remove('opacity-0', 'pointer-events-none');
    challengeDetailModalOverlay.classList.add('opacity-100', 'pointer-events-auto');
  }

  const username = localStorage.getItem('ump_username') || 'GUEST_UMPIRE';
  const meta = weeklyChallengeMeta || resolveWeeklyChallengeMeta(WEEKLY_CHALLENGE_DATA, WEEKLY_CHALLENGE_META);
  const totalAbs = weeklyPlaylistABs.length || extractAtBatsFromWeeklyData().length || meta.targetAtBats;
  const completedAbs = activeWeeklyAbIndex;
  const gamesWrap = document.getElementById('challenge-detail-games-wrap');
  const statsGrid = document.getElementById('challenge-detail-stats');

  if (type === 'weekly') {
    if (challengeDetailModalPanel) {
      challengeDetailModalPanel.classList.remove('border-amber-500/35');
      challengeDetailModalPanel.classList.add('border-emerald-500/35');
    }
    if (challengeDetailTitle) challengeDetailTitle.textContent = 'Weekly Challenge';
    if (challengeDetailSubtitle) challengeDetailSubtitle.textContent = formatWeekLabel(meta.challengeWeekId);
    if (challengeDetailDesc) {
      challengeDetailDesc.textContent =
        'Curated critical called pitches from real MLB matchups. Earn 10 points per correct call.';
    }
    if (challengeDetailGamesCount) challengeDetailGamesCount.textContent = String(meta.gameCount);
    if (challengeDetailAbCount) challengeDetailAbCount.textContent = String(totalAbs);
    if (challengeDetailCompleted) challengeDetailCompleted.textContent = `${completedAbs} / ${totalAbs}`;
    if (challengeDetailReset) challengeDetailReset.textContent = 'Monday';
    if (statsGrid) {
      statsGrid.classList.remove('hidden');
      const labels = statsGrid.querySelectorAll('.challenge-detail-stats__item span');
      if (labels[0]) labels[0].textContent = 'Games';
      if (labels[1]) labels[1].textContent = 'At-bats';
      if (labels[2]) labels[2].textContent = 'Progress';
      if (labels[3]) labels[3].textContent = 'Resets';
    }
    if (gamesWrap) gamesWrap.classList.remove('hidden');

    if (challengeDetailGamesList) {
      challengeDetailGamesList.innerHTML = WEEKLY_CHALLENGE_DATA.slice(0, meta.gameCount).map((game, idx) => {
        const pk = game.gamePk || (meta.gamePks && meta.gamePks[idx]) || '';
        return `
          <div class="challenge-detail-game-row">
            <div>
              <div class="challenge-detail-game-row__title">${game.title}</div>
              <div class="challenge-detail-game-row__desc">${game.description || ''}</div>
            </div>
            ${pk ? `<span class="challenge-detail-game-row__pk">#${pk}</span>` : ''}
          </div>
        `;
      }).join('');
    }

    if (btnChallengeDetailPlay) {
      btnChallengeDetailPlay.textContent = hasWeeklyChallengeResumeProgress()
        ? 'Resume Challenge'
        : 'Start Challenge';
      btnChallengeDetailPlay.onclick = (e) => {
        e.stopPropagation();
        hideChallengeDetailModal();
        if (btnStartWeeklyChallenge) btnStartWeeklyChallenge.click();
      };
    }
    if (btnChallengeDetailStandings) {
      btnChallengeDetailStandings.classList.remove('hidden');
      btnChallengeDetailStandings.textContent = 'Standings';
      btnChallengeDetailStandings.onclick = (e) => {
        e.stopPropagation();
        hideChallengeDetailModal();
        openStandingsTab({ board: 'weekly', view: 'ranks', periodKey: meta.challengeWeekId });
      };
    }
    if (btnChallengeDetailLastWeek) {
      btnChallengeDetailLastWeek.classList.remove('hidden');
      btnChallengeDetailLastWeek.textContent = 'History';
      btnChallengeDetailLastWeek.onclick = (e) => {
        e.stopPropagation();
        hideChallengeDetailModal();
        openStandingsTab({ board: 'weekly', view: 'history' });
      };
    }
  } else {
    const profile = await getProfile(username);
    if (challengeDetailModalPanel) {
      challengeDetailModalPanel.classList.remove('border-emerald-500/35');
      challengeDetailModalPanel.classList.add('border-amber-500/35');
    }
    if (challengeDetailTitle) challengeDetailTitle.textContent = 'Streak Challenge';
    if (challengeDetailSubtitle) challengeDetailSubtitle.textContent = "Today's borderline pitch run";
    if (challengeDetailDesc) {
      challengeDetailDesc.textContent =
        'Call consecutive borderline pitches correctly. One miss ends the run — replay as often as you like.';
    }
    if (challengeDetailGamesCount) challengeDetailGamesCount.textContent = 'Borderline';
    if (challengeDetailAbCount) challengeDetailAbCount.textContent = profile ? `${profile.maxStreak || 0}` : '0';
    if (challengeDetailCompleted) challengeDetailCompleted.textContent = document.getElementById('daily-streak-outcome')?.textContent?.replace(/\s*PITCHES/i, '') || '0';
    if (challengeDetailReset) challengeDetailReset.textContent = 'Daily';
    if (statsGrid) {
      statsGrid.classList.remove('hidden');
      const labels = statsGrid.querySelectorAll('.challenge-detail-stats__item span');
      if (labels[0]) labels[0].textContent = 'Mode';
      if (labels[1]) labels[1].textContent = 'All-time best';
      if (labels[2]) labels[2].textContent = 'Today';
      if (labels[3]) labels[3].textContent = 'Resets';
    }
    if (gamesWrap) gamesWrap.classList.add('hidden');

    if (btnChallengeDetailPlay) {
      btnChallengeDetailPlay.textContent = hasStreakChallengeResumeProgress() ? 'Resume Streak' : 'Play Streak';
      btnChallengeDetailPlay.onclick = (e) => {
        e.stopPropagation();
        hideChallengeDetailModal();
        if (btnStartDailyStreak) btnStartDailyStreak.click();
      };
    }
    if (btnChallengeDetailStandings) {
      btnChallengeDetailStandings.classList.remove('hidden');
      btnChallengeDetailStandings.textContent = 'Today';
      btnChallengeDetailStandings.onclick = (e) => {
        e.stopPropagation();
        hideChallengeDetailModal();
        openStandingsTab({ board: 'daily', view: 'ranks' });
      };
    }
    if (btnChallengeDetailLastWeek) {
      btnChallengeDetailLastWeek.classList.remove('hidden');
      btnChallengeDetailLastWeek.textContent = 'All-time';
      btnChallengeDetailLastWeek.onclick = (e) => {
        e.stopPropagation();
        hideChallengeDetailModal();
        openStandingsTab({ board: 'daily', view: 'alltime' });
      };
    }
  }
}

function hideChallengeDetailModal() {
  challengeDetailModalOpen = false;
  if (challengeDetailModalOverlay) {
    challengeDetailModalOverlay.classList.add('opacity-0', 'pointer-events-none');
    challengeDetailModalOverlay.classList.remove('opacity-100', 'pointer-events-auto');
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
          // Wait for transition to PRESS START state and click start
          await new Promise(r => setTimeout(r, 600));
          if (btnWelcomeStart) {
            btnWelcomeStart.click();
            console.log("TEST: Welcome start clicked after profile creation.");
          }
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

  // Test Tab Switching: Click Standings, then click Play
  if (tabBtnLeaderboard && tabBtnPlay) {
    console.log("TEST: Clicking Standings tab...");
    tabBtnLeaderboard.click();
    await new Promise(r => setTimeout(r, 600));
    console.log("TEST: Clicking Play tab...");
    tabBtnPlay.click();
    await new Promise(r => setTimeout(r, 600));
  }

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

  const showWelcome = state === STATES.WELCOME || !localStorage.getItem('ump_username');
  if (showWelcome) {
    setOverlayVisible(unifiedNav, false);
    return;
  }

  setOverlayVisible(unifiedNav, true);

  const gameplayTelemetry = document.getElementById('gameplay-nav-telemetry');
  const contextRow = document.getElementById('nav-context-row');

  const isDashboard = state === STATES.START;
  const isGameplay = [STATES.IDLE, STATES.WINDUP, STATES.PITCHING, STATES.DECISION_PENDING, STATES.ABS_REVIEW].includes(state);

  // Check if the at-bat start overlay is currently visible — if so, suppress telemetry row
  const abStartVisible = abStartOverlay && abStartOverlay.classList.contains('opacity-100');

  if (contextRow) {
    if (isDashboard) {
      contextRow.classList.add('hidden', 'opacity-0', 'pointer-events-none');
      contextRow.classList.remove('opacity-100', 'pointer-events-auto');
      if (gameplayTelemetry) {
        gameplayTelemetry.classList.add('hidden', 'opacity-0', 'pointer-events-none');
        gameplayTelemetry.classList.remove('opacity-100', 'pointer-events-auto');
      }
    } else if (isGameplay) {
      const showGameplay = !abStartVisible;
      setOverlayVisible(contextRow, showGameplay);
      if (gameplayTelemetry) setOverlayVisible(gameplayTelemetry, showGameplay);
    } else {
      contextRow.classList.add('hidden', 'opacity-0', 'pointer-events-none');
      contextRow.classList.remove('opacity-100', 'pointer-events-auto');
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
function getScrollParent(node) {
  if (!node || node === document.body || node === document.documentElement) {
    return document.body;
  }
  const overflowY = window.getComputedStyle(node).overflowY;
  if (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'hidden') {
    return node;
  }
  return getScrollParent(node.parentNode);
}

function getPopoutClipBounds(element) {
  const parent = getScrollParent(element) || document.body;
  const margin = 12;
  if (parent === document.body) {
    return {
      top: margin,
      bottom: window.innerHeight - margin,
      left: margin,
      right: window.innerWidth - margin,
    };
  }
  const rect = parent.getBoundingClientRect();
  return {
    top: rect.top + margin,
    bottom: rect.bottom - margin,
    left: rect.left + margin,
    right: rect.right - margin,
  };
}

function adjustPlayerStatsPopoutPosition(popout, element) {
  const bounds = getPopoutClipBounds(element);
  const elementRect = element.getBoundingClientRect();

  popout.style.maxHeight = '';
  popout.style.overflowY = '';
  popout.style.transform = '';
  popout.style.marginTop = '';

  let rect = popout.getBoundingClientRect();

  if (rect.bottom > bounds.bottom) {
    popout.style.top = 'auto';
    popout.style.bottom = '0';
    rect = popout.getBoundingClientRect();
  }

  if (rect.top < bounds.top) {
    popout.style.bottom = 'auto';
    popout.style.top = '100%';
    popout.style.marginTop = '4px';
    rect = popout.getBoundingClientRect();
  }

  if (rect.bottom > bounds.bottom) {
    const available = bounds.bottom - Math.max(bounds.top, rect.top);
    if (available > 0) {
      popout.style.maxHeight = `${available}px`;
      popout.style.overflowY = 'auto';
    }
    rect = popout.getBoundingClientRect();
  }

  if (rect.top < bounds.top) {
    popout.style.bottom = 'auto';
    popout.style.marginTop = '';
    popout.style.top = `${bounds.top - elementRect.top}px`;
    const available = bounds.bottom - bounds.top;
    popout.style.maxHeight = `${available}px`;
    popout.style.overflowY = 'auto';
    rect = popout.getBoundingClientRect();
  }

  let translateX = 0;
  if (rect.left < bounds.left) {
    translateX = bounds.left - rect.left;
  } else if (rect.right > bounds.right) {
    translateX = bounds.right - rect.right;
  }
  if (translateX !== 0) {
    popout.style.transform = `translateX(${translateX}px)`;
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
  const isBatter = element.id === 'gameplay-batter-card-trigger' || element.classList.contains('ab-summary-player--batter') || element.classList.contains('ump-player-card--batter');
  popout.className = `player-card-popout absolute top-0 ${isBatter ? 'right-0 left-auto' : 'left-0 right-auto'} w-[220px] bg-[#0f172a] border border-slate-700/60 rounded-xl p-2.5 z-[99] flex flex-col shadow-2xl transition-all duration-200 pointer-events-auto text-left select-none`;

  const colorClass = details.role === 'PITCHER' ? 'text-purple-400' : 'text-cyan-400';
  
  let statsHtml = `
    <div class="flex justify-between items-center mb-1 text-[11px] font-mono-tech border-b border-white/10 pb-0.5">
      <span class="text-white uppercase font-bold truncate pr-1">${name}</span>
      <span class="btn-close-popout text-slate-400 hover:text-white cursor-pointer select-none font-bold text-[13px] px-1 font-mono">✕</span>
    </div>
    <div class="flex flex-col gap-1 font-mono-tech text-[12px]">
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

  adjustPlayerStatsPopoutPosition(popout, element);

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

function getUserXpStats() {
  const username = localStorage.getItem('ump_username');
  if (!username) {
    return {
      xp: 0,
      xpProgress: { level: 1, progress: 0, pct: 0, base: 0, nextAt: 1000 }
    };
  }
  const normalized = normalizeHandle(username);
  const statsKey = getStatsStorageKey(normalized);
  const userStats = JSON.parse(localStorage.getItem(statsKey) || '{"overallAccuracy":null,"maxStreak":0,"completedWeekly":0,"history":[]}');
  
  let xp = userStats.xp !== undefined ? userStats.xp : 0;
  if (userStats.xp === undefined) {
    const history = userStats.history || [];
    history.forEach(h => {
      const isWeekly = h.gameName && h.gameName.includes("Weekly");
      const isStreak = h.gameName && h.gameName.includes("Streak");
      
      if (isWeekly) {
        xp += (h.correctCalls || 0) * 10;
      } else if (isStreak) {
        xp += (h.correctCalls || 0) * 15;
      } else {
        xp += (h.correctCalls || 0) * 5;
      }
    });
  }
  return {
    xp,
    xpProgress: getXpProgressInLevel(xp)
  };
}

function populateXpPopoverData() {
  const { xp, xpProgress } = getUserXpStats();
  const username = localStorage.getItem('ump_username') || 'GUEST_UMPIRE';
  const tier = getLevelTier(xpProgress.level);
  
  const popoverHandle = document.getElementById('xp-popover-handle');
  const popoverTierTitle = document.getElementById('xp-popover-tier-title');
  const popoverLevelBadge = document.getElementById('xp-popover-level-badge');
  const popoverNums = document.getElementById('xp-popover-nums');
  const popoverBar = document.getElementById('xp-popover-bar');
  const popoverRemaining = document.getElementById('xp-popover-remaining');
  const popoverTotal = document.getElementById('xp-popover-total');
  const popoverCurrentLevel = document.getElementById('xp-popover-current-level');
  const popoverTeamLogo = document.getElementById('xp-popover-team-logo');
  const popoverLadder = document.getElementById('xp-popover-ladder');
  
  if (popoverHandle) popoverHandle.textContent = username;
  if (popoverTierTitle) popoverTierTitle.textContent = tier.title;
  if (popoverLevelBadge) {
    popoverLevelBadge.innerHTML = getRankIconHtml(xpProgress.level);
  }
  if (popoverNums) popoverNums.textContent = `${xpProgress.progress.toLocaleString()} / ${XP_PER_LEVEL.toLocaleString()} XP`;
  if (popoverBar) {
    setXpBarPercent(popoverBar, xpProgress.pct, false);
  }
  if (popoverRemaining) {
    const remaining = XP_PER_LEVEL - xpProgress.progress;
    popoverRemaining.textContent = `${remaining.toLocaleString()} XP to Next Level`;
  }
  if (popoverTotal) popoverTotal.textContent = `${xp.toLocaleString()} XP`;
  if (popoverCurrentLevel) popoverCurrentLevel.textContent = `LVL ${xpProgress.level}`;
  
  if (popoverTeamLogo) {
    if (activeFavoriteTeam && activeFavoriteTeam !== "none") {
      popoverTeamLogo.src = getTeamLogoUrl(activeFavoriteTeam);
    } else {
      popoverTeamLogo.src = "/generic.svg";
    }
  }
  
  if (popoverLadder) {
    popoverLadder.innerHTML = LEVEL_TIERS.map(t => {
      const isCurrentTier = xpProgress.level >= t.min && xpProgress.level <= t.max;
      const rangeText = t.max === Infinity ? `LV ${t.min}+` : `LV ${t.min}-${t.max}`;
      return `
        <div class="flex justify-between items-center py-1 px-1.5 rounded ${isCurrentTier ? 'bg-[var(--retro-grass)]/20 border border-[var(--retro-grass)]/40 font-bold text-[var(--retro-gold)]' : 'text-gray-400 border border-transparent'}">
          <div class="flex items-center gap-1.5">
            <span class="w-1.5 h-1.5 rounded-full ${isCurrentTier ? 'bg-[var(--retro-gold)] animate-pulse' : 'bg-gray-600'}"></span>
            <span>${t.title}</span>
          </div>
          <span class="text-[8px] font-mono-tech">${rangeText}</span>
        </div>
      `;
    }).join('');
  }
}

function toggleXpDetailsPopover(show) {
  const popover = document.getElementById('hud-xp-details-popover');
  if (!popover) return;
  
  if (show === undefined) {
    show = popover.classList.contains('opacity-0');
  }
  
  if (show) {
    populateXpPopoverData();
    
    const widget = document.getElementById('hud-profile-xp-widget');
    if (widget) {
      const rect = widget.getBoundingClientRect();
      const layer = document.getElementById('hud-layer');
      const layerRect = layer ? layer.getBoundingClientRect() : { top: 0, right: window.innerWidth };
      
      if (window.innerWidth < 768) {
        popover.style.left = '50%';
        popover.style.right = 'auto';
        popover.style.transform = 'translate(-50%, 0) scale(1)';
        popover.style.top = `${rect.bottom - layerRect.top + 8}px`;
      } else {
        popover.style.left = 'auto';
        popover.style.right = `${layerRect.right - rect.right}px`;
        popover.style.transform = 'scale(1)';
        popover.style.top = `${rect.bottom - layerRect.top + 8}px`;
      }
    }
    
    popover.classList.remove('opacity-0', 'pointer-events-none', 'scale-95');
    popover.classList.add('opacity-100', 'pointer-events-auto', 'scale-100');
    
    setTimeout(() => {
      document.addEventListener('click', closeXpPopoverOnOutsideClick);
    }, 10);
  } else {
    popover.style.transform = '';
    popover.classList.add('opacity-0', 'pointer-events-none', 'scale-95');
    popover.classList.remove('opacity-100', 'pointer-events-auto', 'scale-100');
    document.removeEventListener('click', closeXpPopoverOnOutsideClick);
  }
}

function closeXpPopoverOnOutsideClick(e) {
  const popover = document.getElementById('hud-xp-details-popover');
  const widget = document.getElementById('hud-profile-xp-widget');
  if (popover && !popover.contains(e.target) && widget && !widget.contains(e.target)) {
    toggleXpDetailsPopover(false);
  }
}

const tierGradients = {
  rookie: { from: '#57534e', to: '#292524', stroke: '#78716c', text: '#e7e5e4' },
  line: { from: '#94a3b8', to: '#475569', stroke: '#cbd5e1', text: '#f8fafc' },
  regular: { from: '#fbbf24', to: '#b45309', stroke: '#fcd34d', text: '#1c1917' },
  veteran: { from: '#a78bfa', to: '#6d28d9', stroke: '#c4b5fd', text: '#faf5ff' },
  chief: { from: '#38bdf8', to: '#0369a1', stroke: '#7dd3fc', text: '#f0f9ff' },
  division: { from: '#34d399', to: '#047857', stroke: '#6ee7b7', text: '#ecfdf5' },
  league: { from: '#818cf8', to: '#4338ca', stroke: '#a5b4fc', text: '#eef2ff' },
  worldseries: { from: '#f472b6', to: '#be185d', stroke: '#f9a8d4', text: '#fff1f2' },
  elite: { from: '#22d3ee', to: '#0e7490', stroke: '#67e8f9', text: '#ecfeff' },
  master: { from: '#f97316', to: '#9a3412', stroke: '#fdba74', text: '#fff7ed' },
  hof: { from: '#fbbf24', to: '#db2777', stroke: '#fef08a', text: '#ffffff', glow: true }
};

function getRankIconHtml(level) {
  const tier = getLevelTier(level);
  const info = tierGradients[tier.tier] || tierGradients.rookie;
  const isMilestone = isMilestoneLevel(level);
  
  // Unique gradient ID to prevent clashing
  const gradId = `tg-${tier.tier}-${level}-${Math.floor(Math.random() * 1000)}`;
  
  const glowStyle = info.glow ? 'filter: drop-shadow(0 0 4px rgba(251, 191, 36, 0.85))' : '';
  const milestoneStroke = isMilestone ? 'stroke="#e8c547" stroke-width="2"' : `stroke="${info.stroke}" stroke-width="1"`;
  
  let fontSize = "9px";
  if (level >= 100) fontSize = "7px";
  else if (level >= 10) fontSize = "8px";
  
  return `
    <svg class="w-5 h-5 md:w-6 h-6 inline-block select-none align-middle" viewBox="0 0 32 32" style="${glowStyle}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="${gradId}" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${info.from}" />
          <stop offset="100%" stop-color="${info.to}" />
        </linearGradient>
      </defs>
      <!-- Outer Hexagon -->
      <polygon points="16,2 30,9 30,23 16,30 2,23 2,9" fill="url(#${gradId})" ${milestoneStroke} />
      <!-- Inner Hexagon for detail -->
      <polygon points="16,4 27,10 27,22 16,28 5,22 5,10" fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="1" />
      <!-- Level Number -->
      <text x="16" y="20" font-family="'Press Start 2P', monospace" font-size="${fontSize}" fill="${info.text}" font-weight="900" text-anchor="middle">${level}</text>
    </svg>
  `;
}

function getLargeRankBadgeSvg(level) {
  const tier = getLevelTier(level);
  const info = tierGradients[tier.tier] || tierGradients.rookie;
  const gradId = `tg-large-${tier.tier}-${level}`;
  
  return `
    <svg class="w-32 h-32 mx-auto select-none drop-shadow-[0_0_20px_rgba(251,191,36,0.4)]" viewBox="0 0 96 96" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="${gradId}" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${info.from}" />
          <stop offset="100%" stop-color="${info.to}" />
        </linearGradient>
      </defs>
      
      <!-- Outer Rotating Orbital Paths -->
      <circle cx="48" cy="48" r="44" fill="none" stroke="rgba(251, 191, 36, 0.25)" stroke-width="1.5" stroke-dasharray="6 8" class="animate-spin-orbit" />
      <circle cx="48" cy="48" r="38" fill="none" stroke="rgba(255, 255, 255, 0.15)" stroke-width="1" stroke-dasharray="3 4" class="animate-spin-orbit-reverse" />
      
      <!-- Thick Outer Hexagonal Border -->
      <polygon points="48,10 82,27 82,69 48,86 14,69 14,27" fill="url(#${gradId})" stroke="${info.stroke}" stroke-width="3" />
      
      <!-- Inner Detailing Hexagon -->
      <polygon points="48,15 77,30 77,66 48,81 19,66 19,30" fill="none" stroke="rgba(255, 255, 255, 0.25)" stroke-width="1.5" />
      
      <!-- Glowing center element -->
      <circle cx="48" cy="48" r="16" fill="rgba(0,0,0,0.3)" stroke="rgba(255,255,255,0.1)" stroke-width="1" />
      
      <!-- Level Text -->
      <text x="48" y="55" font-family="'Press Start 2P', monospace" font-size="14" fill="${info.text}" font-weight="900" text-anchor="middle">${level}</text>
    </svg>
  `;
}

function triggerConfettiCelebration() {
  const colors = ['#f43f5e', '#ec4899', '#d946ef', '#a855f7', '#8b5cf6', '#6366f1', '#3b82f6', '#0ea5e9', '#06b6d4', '#14b8a6', '#10b981', '#22c55e', '#84cc16', '#eab308', '#f97316', '#ef4444'];
  const count = 120;
  
  for (let i = 0; i < count; i++) {
    const el = document.createElement('div');
    el.className = 'celebration-confetti';
    
    el.style.left = `${Math.random() * 100}vw`;
    el.style.top = `${-10 - Math.random() * 30}px`;
    
    const size = 5 + Math.random() * 10;
    el.style.width = `${size}px`;
    el.style.height = `${size}px`;
    el.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
    
    el.style.animationDelay = `${Math.random() * 1.5}s`;
    el.style.animationDuration = `${2 + Math.random() * 2.5}s`;
    
    document.body.appendChild(el);
    
    setTimeout(() => {
      el.remove();
    }, 5000);
  }
}

let appLaunchLoaderSession = 0;

function hideAppLaunchLoader() {
  const loader = document.getElementById('app-launch-loader');
  if (!loader) return;
  loader.style.opacity = '0';
  loader.style.pointerEvents = 'none';
  loader.style.display = 'none';
}

function showTemporaryLoadingScreen(label, minDurationMs = 850, callback = null) {
  const loader = document.getElementById('app-launch-loader');
  const subtext = document.getElementById('loader-subtext');
  const minVisibleMs = Math.max(minDurationMs, 400);
  const session = ++appLaunchLoaderSession;
  const startedAt = performance.now();

  if (loader) {
    if (subtext) {
      subtext.textContent = label || "Loading Simulation...";
    }
    loader.style.display = 'flex';
    loader.style.pointerEvents = 'auto';
    loader.style.opacity = '1';
  }

  const maxVisibleMs = Math.max(minVisibleMs + 8000, 10000);

  (async () => {
    try {
      if (callback) await callback();
    } catch (e) {
      console.error('Loading transition failed:', e);
    } finally {
      const elapsed = performance.now() - startedAt;
      const remaining = Math.max(0, minVisibleMs - elapsed);
      await new Promise((r) => setTimeout(r, remaining));
      if (session === appLaunchLoaderSession) {
        hideAppLaunchLoader();
      }
    }
  })();

  setTimeout(() => {
    if (session === appLaunchLoaderSession) {
      hideAppLaunchLoader();
    }
  }, maxVisibleMs);
}

async function saveGameProgress() {
  const username = localStorage.getItem('ump_username');
  if (!username) return;

  const sessionData = {
    gameMode,
    activeWeeklyAbIndex,
    activeStreakAbIndex,
    currentPitchIndex,
    abBalls,
    abStrikes,
    pitchHistory: pitchHistory.map((h) => ({
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
      swingHitType: h.swingHitType,
    })),
    streakPitchHistory: streakPitchHistory.map((h) => ({
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
      swingHitType: h.swingHitType,
    })),
    weeklyPlaylistABs,
    streakPlaylistABs,
    activeDailyDate,
    activeDailyTeam,
    pitchesList,
    totalPitchesCount,
    totalBattersFaced,
    totalSessionK,
    totalSessionBB,
    totalSessionH,
    totalSessionOuts,
  };

  await saveActiveSession(username, sessionData);
}

function generateDailyStreakPitches() {
  const merged = [...getObfuscatedPitches(), ...ORIOLES_GAME_DATA];
  for (let i = merged.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [merged[i], merged[j]] = [merged[j], merged[i]];
  }
  return merged;
}

async function awardXP(amount) {
  const username = localStorage.getItem('ump_username');
  if (!username || !amount) return;

  const stats = await getGlobalUserStats(username);
  const oldXp = stats.xp || 0;
  const oldLevel = getLevelFromXp(oldXp);
  stats.xp = oldXp + amount;
  const newLevel = getLevelFromXp(stats.xp);
  stats.level = newLevel;

  await saveGlobalUserStats(username, stats);
  updateProfileStatsUI();
  triggerXpSurgeAnimation(amount);

  if (newLevel > oldLevel) {
    showLevelUpCelebration(newLevel, oldLevel);
  }
}

function showFloatingXP(amount, customText) {
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
  document.body.appendChild(el);
  el.offsetHeight;

  requestAnimationFrame(() => {
    el.style.top = '32%';
    el.style.opacity = '0';
  });

  setTimeout(() => {
    el.remove();
  }, 1000);
}

function triggerXpSurgeAnimation(amount) {
  if (!amount || amount <= 0) return;
  
  const xpBar = document.getElementById('hud-user-xp-bar');
  if (xpBar) {
    const parent = xpBar.parentElement;
    if (parent) {
      parent.classList.remove('xp-surge-active');
      parent.offsetHeight; // force reflow
      parent.classList.add('xp-surge-active');
      setTimeout(() => {
        parent.classList.remove('xp-surge-active');
      }, 850);
    }
  }
  
  const centralContainer = document.getElementById('hud-central-xp-container') || document.getElementById('hud-profile-xp-widget');
  if (centralContainer) {
    const rect = centralContainer.getBoundingClientRect();
    const floating = document.createElement('div');
    floating.className = 'floating-xp-indicator font-mono-tech';
    floating.textContent = `+${amount} XP`;
    
    floating.style.left = `${rect.left + rect.width / 2}px`;
    floating.style.top = `${rect.top}px`;
    
    document.body.appendChild(floating);
    
    setTimeout(() => {
      floating.remove();
    }, 1250);
  }
}


