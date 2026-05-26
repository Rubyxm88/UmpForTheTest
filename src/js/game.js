import * as THREE from 'three';
import { getObfuscatedPitches } from '../data/pitches.js';
import { ORIOLES_GAME_DATA } from '../data/orioles_game.js';
import { WEEKLY_CHALLENGE_DATA } from '../data/weekly_challenge.js';
import { CLOSE_CHALLENGE_DATA } from '../data/close_challenge.js';
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
  clearDimensionLine
} from './scene.js';

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

// Web Audio API Context
let audioCtx = null;

// Touch Swipe gesture variables
let touchStartX = 0;
let touchStartY = 0;
const SWIPE_THRESHOLD = 50; 

// DOM Elements cache
let startScreen, btnStartGame;
let hudHeader, pitchCounterText, ballsIndicator, strikesIndicator;
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

// Overlays
let abSummaryOverlay, abSummaryTitle, abSummaryMatchup, abSummaryAccuracy, abSummaryPitches, abSummaryBlurb, abSummaryFilmLink, abSummaryScorecardLink, btnAbSummaryAdvance;
let pauseScreen, btnResumeGame;
let matchupCard, cardPitcherName, cardPitcherHand, cardBatterName, cardBatterHand, replayBadge;

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
let profileFavTeamSelect, profileFavTeamLogo, profileNewPin, btnProfileSavePin, profilePinMsg;

// Collapsible Matchup Card elements
let btnMatchupToggle;

// Settings elements
let btnCloseSettings, btnDashboardSettingsToggle;
let settingsUiClassic, settingsUiAdaptive, settingsUiCinematic;

// Split Summary card elements
let abSummaryPitcherImg, abSummaryPitcherLogo, abSummaryPitcherName, abSummaryPitcherHandBadge;
let abSummaryBatterImg, abSummaryBatterLogo, abSummaryBatterName, abSummaryBatterHandBadge;
let abSummaryPitchList;

// Matchup Walkup card (ab-start-overlay) faceoff elements
let abStartPitcherImg, abStartPitcherLogo, abStartPitcherStats;
let abStartBatterImg, abStartBatterLogo, abStartBatterStats;
let abStartPitcherName, abStartBatterName;

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

/**
 * Plays a procedurally synthesized catcher's leather glove "pop" sound
 */
function playGlovePopSound() {
  if (!audioCtx) return;
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

function playBallWhooshSound(speedMph) {
  if (!audioCtx) return;
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

function playStrikeCallSound() {
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

function loginUserSession(handleVal) {
  localStorage.setItem('ump_username', handleVal);
  localStorage.setItem('pitch_ump_last_handle', handleVal);
  updateProfileStatsUI();
  playCoinSound();
  
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
      profileFavTeamLogo.src = "https://www.mlbstatic.com/team-logos/generic.svg";
    }
  }
  
  profileFavTeamSelect.onchange = function() {
    initAudio();
    const val = this.value;
    if (val === 'none') {
      activeFavoriteTeam = null;
      localStorage.removeItem('pitch_ump_favorite_team');
      if (profileFavTeamLogo) profileFavTeamLogo.src = "https://www.mlbstatic.com/team-logos/generic.svg";
      if (userFavoriteTeamBadge) userFavoriteTeamBadge.textContent = 'FAVORITE TEAM: NONE';
    } else {
      const team = TEAMS_LIST.find(t => t.name.toLowerCase() === val);
      if (team) {
        activeFavoriteTeam = team.name;
        localStorage.setItem('pitch_ump_favorite_team', team.name);
        if (profileFavTeamLogo) profileFavTeamLogo.src = getTeamLogoUrl(team.name);
        if (userFavoriteTeamBadge) userFavoriteTeamBadge.textContent = `FAVORITE TEAM: ${team.name.toUpperCase()}`;
        playCoinSound();
      }
    }
  };
  
  if (btnProfileSavePin) {
    btnProfileSavePin.onclick = function(e) {
      e.stopPropagation();
      initAudio();
      
      const newPinVal = profileNewPin ? profileNewPin.value.trim() : "";
      if (!/^\d{4,8}$/.test(newPinVal)) {
        alert("ERROR: PIN MUST BE 4 TO 8 DIGITS");
        return;
      }
      
      const currentHandle = localStorage.getItem('ump_username');
      if (currentHandle) {
        let users = JSON.parse(localStorage.getItem('pitch_ump_users') || '{}');
        users[currentHandle] = newPinVal;
        localStorage.setItem('pitch_ump_users', JSON.stringify(users));
        
        if (profilePinMsg) {
          profilePinMsg.classList.remove('hidden');
          setTimeout(() => {
            profilePinMsg.classList.add('hidden');
          }, 3000);
        }
        if (profileNewPin) profileNewPin.value = "";
        
        playCoinSound();
      }
    };
  }
}

/**
 * Initialize all DOM queries and attach event listeners
 */
export function startGameSession() {
  if (WEEKLY_CHALLENGE_DATA.length < 6) {
    WEEKLY_CHALLENGE_DATA.push(CLOSE_CHALLENGE_DATA);
  }
  cacheDOM();
  const lastHandle = localStorage.getItem('pitch_ump_last_handle');
  if (lastHandle && loginHandleInput) {
    loginHandleInput.value = lastHandle;
  }
  attachEvents();
  initUiModeSwitcher();
  
  loadSavedSessionFromLocal();
  loadFavoriteTeam();
  initProfileSettingsUI();
  generateTeamSelectGrid();
  renderDashboardGamesList();
  updateDailyStreakStatusUI();
  
  const container = document.getElementById('canvas-container');
  const canvas = document.getElementById('three-canvas');
  
  initScene(container, canvas);
  
  window.addEventListener('resize', () => {
    onResize(container.clientWidth, container.clientHeight);
    if (window.innerWidth < 640 && matchupCard) {
      matchupCard.classList.add('collapsed');
    }
  });
  
  if (!localStorage.getItem('ump_username')) {
    transitionToState(STATES.IDLE);
  } else if (activeFavoriteTeam) {
    transitionToState(STATES.START);
  } else {
    transitionToState(STATES.TEAM_SELECT);
  }
  
  tick();
}

function cacheDOM() {
  startScreen = document.getElementById('start-screen');
  btnStartGame = document.getElementById('btn-start-game');
  btnStartOriolesFull = document.getElementById('btn-start-orioles-full');
  
  hudHeader = document.getElementById('hud-header');
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
  btnSettingsToggle = document.getElementById('btn-settings-toggle');
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

  matchupCard = document.getElementById('matchup-card');
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
  profileFavTeamLogo = document.getElementById('profile-fav-team-logo');
  profileNewPin = document.getElementById('profile-new-pin');
  btnProfileSavePin = document.getElementById('btn-profile-save-pin');
  profilePinMsg = document.getElementById('profile-pin-msg');

  // Collapsible Matchup Card elements
  btnMatchupToggle = document.getElementById('btn-matchup-toggle');

  // Settings elements
  btnCloseSettings = document.getElementById('btn-close-settings');
  btnDashboardSettingsToggle = document.getElementById('btn-dashboard-settings-toggle');
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

  // Matchup Walkup card faceoff elements
  abStartPitcherImg = document.getElementById('ab-start-pitcher-img');
  abStartPitcherLogo = document.getElementById('ab-start-pitcher-logo');
  abStartPitcherStats = document.getElementById('ab-start-pitcher-stats');
  abStartBatterImg = document.getElementById('ab-start-batter-img');
  abStartBatterLogo = document.getElementById('ab-start-batter-logo');
  abStartBatterStats = document.getElementById('ab-start-batter-stats');
  abStartPitcherName = document.getElementById('ab-start-pitcher');
  abStartBatterName = document.getElementById('ab-start-batter');

  // Leaderboard Buttons & Table
  leaderBtnWeekly = document.getElementById('leader-btn-weekly');
  leaderBtnDaily = document.getElementById('leader-btn-daily');
  leaderBtnAlltime = document.getElementById('leader-btn-alltime');
  leaderboardTableBody = document.getElementById('leaderboard-table-body');
  leaderboardDivisionTitle = document.getElementById('leaderboard-division-title');
}

function submitLoginAction() {
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
  let users = JSON.parse(localStorage.getItem('pitch_ump_users') || '{}');
  
  if (users[handleValNormalized] === undefined) {
    // User does not exist, show confirm registration overlay
    if (loginErrorMsg) loginErrorMsg.classList.add('hidden');
    if (loginConfirmBox) {
      loginConfirmBox.classList.remove('hidden');
      loginConfirmBox.classList.add('flex');
    }
  } else {
    // User exists, verify PIN
    if (users[handleValNormalized] === pinVal) {
      if (loginErrorMsg) loginErrorMsg.classList.add('hidden');
      if (loginConfirmBox) {
        loginConfirmBox.classList.add('hidden');
        loginConfirmBox.classList.remove('flex');
      }
      loginUserSession(handleValNormalized);
    } else {
      if (loginErrorMsg) {
        loginErrorMsg.textContent = "ERROR: INVALID PIN FOR THIS HANDLE";
        loginErrorMsg.classList.remove('hidden');
      }
      if (loginConfirmBox) {
        loginConfirmBox.classList.add('hidden');
        loginConfirmBox.classList.remove('flex');
      }
    }
  }
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
    btnStartDailyStreak.addEventListener('click', () => {
      initAudio();
      startDailyStreakChallenge();
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
    btnMainMenu.addEventListener('click', () => {
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
    btnPauseHome.addEventListener('click', (e) => {
      e.stopPropagation();
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
      pauseGameOnFocusLoss();
    }
    // Do NOT auto-resume when tab becomes visible — user must use pause screen
  });

  // At-Bat Start Overlay confirm button
  if (btnAbStartConfirm) {
    btnAbStartConfirm.addEventListener('click', () => {
      confirmAtBatStart();
    });
  }

  // At-Bat Summary Home button
  if (btnAbSummaryHome) {
    btnAbSummaryHome.addEventListener('click', () => {
      if (abSummaryOverlay) {
        abSummaryOverlay.classList.add('opacity-0', 'pointer-events-none');
        abSummaryOverlay.classList.remove('opacity-100', 'pointer-events-auto');
      }
      if (overviewTimerInterval) {
        clearInterval(overviewTimerInterval);
        overviewTimerInterval = null;
      }
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

  if (btnDashboardSettingsToggle) {
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
      submitLoginAction();
    });
  }

  const handleLoginEnter = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitLoginAction();
    }
  };
  if (loginHandleInput) loginHandleInput.addEventListener('keydown', handleLoginEnter);
  if (loginPinInput) loginPinInput.addEventListener('keydown', handleLoginEnter);

  if (btnLoginConfirmCreate) {
    btnLoginConfirmCreate.addEventListener('click', (e) => {
      e.stopPropagation();
      initAudio();
      
      const handleVal = loginHandleInput ? loginHandleInput.value.trim() : "";
      const pinVal = loginPinInput ? loginPinInput.value.trim() : "";
      const handleValNormalized = handleVal.toUpperCase();
      
      let users = JSON.parse(localStorage.getItem('pitch_ump_users') || '{}');
      users[handleValNormalized] = pinVal;
      localStorage.setItem('pitch_ump_users', JSON.stringify(users));
      
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

  if (btnStatsLogout) {
    btnStatsLogout.addEventListener('click', (e) => {
      e.stopPropagation();
      initAudio();
      localStorage.removeItem('ump_username');
      localStorage.removeItem('pitch_ump_challenge_mvp');
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
      
      transitionToState(STATES.IDLE);
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
    btnViewDetails, btnQuickContinue, btnStartWeeklyChallenge, btnAbStartConfirm, btnAbSummaryHome,
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
    
    // Keyboard camera nudge adjustments
    const moveStepX = 0.05;
    const moveStepY = 0.04;
    const ALLOWED_CAMERA_DRAG_STATES = [STATES.START, STATES.IDLE, STATES.DECISION_PENDING, STATES.ABS_REVIEW];
    
    if (ALLOWED_CAMERA_DRAG_STATES.includes(currentState)) {
      // W / ArrowUp -> stand up/increase height
      if (e.key === 'ArrowUp' || key === 'w') {
        e.preventDefault();
        postponeAutoPlay();
        setUmpireHeight(getUmpireYOffset() + moveStepY);
      }
      // S / ArrowDown -> crouch/decrease height
      else if (e.key === 'ArrowDown' || key === 's') {
        e.preventDefault();
        postponeAutoPlay();
        setUmpireHeight(getUmpireYOffset() - moveStepY);
      }
      
      // Left/Right movements only when NOT in DECISION_PENDING (since ArrowLeft/A and ArrowRight/D make calls there)
      if (currentState !== STATES.DECISION_PENDING) {
        if (e.key === 'ArrowLeft' || key === 'a') {
          e.preventDefault();
          postponeAutoPlay();
          setUmpireSlot(getUmpireXOffset() - moveStepX);
        } else if (e.key === 'ArrowRight' || key === 'd') {
          e.preventDefault();
          postponeAutoPlay();
          setUmpireSlot(getUmpireXOffset() + moveStepX);
        }
      }
    }
    
    if (currentState === STATES.IDLE && e.key === ' ') {
      e.preventDefault();
      triggerPitchRelease();
    } else if (currentState === STATES.DECISION_PENDING) {
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

  // Touch/Drag and Swipe Events on Canvas Container
  const canvasContainer = document.getElementById('canvas-container');
  let isDragging = false;
  let startX = 0;
  let startY = 0;
  let startUmpireX = 0;
  let startUmpireY = 0;
  const ALLOWED_CAMERA_DRAG_STATES = [STATES.START, STATES.IDLE, STATES.DECISION_PENDING, STATES.ABS_REVIEW];

  const onDragStart = (clientX, clientY) => {
    if (!ALLOWED_CAMERA_DRAG_STATES.includes(currentState)) return;
    initAudio();
    isDragging = true;
    startX = clientX;
    startY = clientY;
    startUmpireX = getUmpireXOffset();
    startUmpireY = getUmpireYOffset();
  };

  const onDragMove = (clientX, clientY) => {
    if (!isDragging || !ALLOWED_CAMERA_DRAG_STATES.includes(currentState)) return;
    postponeAutoPlay();
    const dx = clientX - startX;
    const dy = clientY - startY;

    // Map delta pixels to 3D offsets in feet
    const xSensitivity = 0.005;
    const ySensitivity = 0.004;

    const newX = startUmpireX + dx * xSensitivity;
    const newY = startUmpireY - dy * ySensitivity; // Drag up -> increase height

    setUmpireSlot(newX);
    setUmpireHeight(newY);
  };

  const onDragEnd = () => {
    isDragging = false;
  };

  // Mouse event listeners for camera dragging
  if (canvasContainer) {
    canvasContainer.addEventListener('mousedown', (e) => {
      onDragStart(e.clientX, e.clientY);
    });
  }

  window.addEventListener('mousemove', (e) => {
    onDragMove(e.clientX, e.clientY);
  });

  window.addEventListener('mouseup', () => {
    onDragEnd();
  });

  // Touch event listeners for mobile swipe-to-call and touch-dragging
  if (canvasContainer) {
    canvasContainer.addEventListener('touchstart', (e) => {
      initAudio();
      if (e.touches && e.touches[0]) {
        const touch = e.touches[0];
        touchStartX = touch.clientX;
        touchStartY = touch.clientY;
        onDragStart(touch.clientX, touch.clientY);
      }
    }, { passive: true });

    canvasContainer.addEventListener('touchmove', (e) => {
      if (isDragging && e.touches && e.touches[0]) {
        onDragMove(e.touches[0].clientX, e.touches[0].clientY);
      }
    }, { passive: true });

    canvasContainer.addEventListener('touchend', (e) => {
      if (isDragging) {
        onDragEnd();
      }
      
      if (!e.changedTouches || !e.changedTouches[0]) return;
      
      const touchEndX = e.changedTouches[0].clientX;
      const touchEndY = e.changedTouches[0].clientY;
      
      const dx = touchEndX - touchStartX;
      const dy = touchEndY - touchStartY;
      
      // Swipe left/right for decision
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > SWIPE_THRESHOLD) {
        if (currentState === STATES.DECISION_PENDING) {
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
 * Handles application state transitions and updates UI components accordingly
 */
let playCrackSoundTriggered = false;

function transitionToState(newState) {
  currentState = newState;
  const loggedIn = !!localStorage.getItem('ump_username');
  
  if (newState !== STATES.ABS_REVIEW) {
    setZoomedIn(false);
    clearDimensionLine();
  }

  // Auto-collapse matchup card during pitching, windup, or decision pending states
  if (matchupCard) {
    if (newState === STATES.WINDUP || newState === STATES.PITCHING || newState === STATES.DECISION_PENDING || newState === STATES.ABS_REVIEW) {
      matchupCard.classList.add('collapsed');
    } else if (newState === STATES.IDLE) {
      const userCollapsed = localStorage.getItem('pitch_ump_matchup_collapsed') === 'true';
      if (window.innerWidth >= 640 && !userCollapsed) {
        matchupCard.classList.remove('collapsed');
      } else {
        matchupCard.classList.add('collapsed');
      }
    }
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
  } else if (newState === STATES.START) {
    setOverlayVisible(welcomeScreen, false);
    setOverlayVisible(teamSelectScreen, false);
    setOverlayVisible(startScreen, true);
    isSettingsOpen = false;
    updateSettingsVisibility();
  } else {
    setOverlayVisible(welcomeScreen, false);
    setOverlayVisible(teamSelectScreen, false);
    setOverlayVisible(startScreen, false);
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
        } else if (gameMode === 'weekly_challenge') {
          if (inningCard) inningCard.classList.add('hidden');
          if (weeklyPlaylistABs.length === 0) {
            const rawABs = extractAtBatsFromWeeklyData();
            weeklyPlaylistABs = [...rawABs];
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
      } else if (gameMode === 'weekly_challenge') {
        const total = weeklyPlaylistABs.length || extractAtBatsFromWeeklyData().length || 16;
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
        
        if (cardPitcherName) cardPitcherName.textContent = matchup.pitcher;
        if (cardPitcherHand) {
          cardPitcherHand.textContent = pH;
          if (pH.includes("R")) {
            cardPitcherHand.className = "px-2 py-0.5 text-[9px] font-mono-tech font-bold uppercase rounded bg-orange-500/10 text-orange-400 border border-orange-500/25";
          } else {
            cardPitcherHand.className = "px-2 py-0.5 text-[9px] font-mono-tech font-bold uppercase rounded bg-purple-500/10 text-purple-400 border border-purple-500/25";
          }
        }
        if (cardBatterName) cardBatterName.textContent = matchup.batter;
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
        hudHeader.classList.remove('opacity-0');
        if (matchupCard) {
          matchupCard.classList.remove('opacity-0', 'pointer-events-none');
          matchupCard.classList.add('opacity-100', 'pointer-events-auto');
        }
      } else {
        hudHeader.classList.add('opacity-0');
        if (matchupCard) {
          matchupCard.classList.add('opacity-0', 'pointer-events-none');
          matchupCard.classList.remove('opacity-100', 'pointer-events-auto');
        }
      }
      if (replayBadge) {
        replayBadge.classList.add('opacity-0', 'pointer-events-none');
        replayBadge.classList.remove('opacity-100');
      }
      hudKeyboardHelp.classList.remove('opacity-0');
      hudKeyboardHelp.innerHTML = 'REAL-TIME AUTOPLAY ACTIVE | CALLED PITCHES PAUSE FOR DECISION';
      
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

      // Schedule Auto-throw (skip if the AB Start overlay is visible — its own callback handles this)
      const abStartVisible = abStartOverlay && abStartOverlay.classList.contains('opacity-100');
      if (!isGamePaused && !abStartVisible) {
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
      hudKeyboardHelp.innerHTML = 'SHORTCUTS: [← / A] BALL &nbsp;|&nbsp; [→ / D] STRIKE &nbsp;|&nbsp; MOBILE: SWIPE LEFT/RIGHT';
      
      if (!localStorage.getItem('ump_username')) {
        setElementVisibility(decisionPrompt, false);
        setTimeout(() => {
          if (!localStorage.getItem('ump_username') && currentState === STATES.DECISION_PENDING) {
            swingOutcome = Math.random() < 0.5 ? 'S' : 'B';
            submitSwingDecision();
          }
        }, 1200);
      } else {
        setElementVisibility(decisionPrompt, true);
        startCountdownTimer();
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
      
      // Update count and check if AB ended
      const abEnded = updateCountAndCheckABEnd(userHistoryItem);
      
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
          summaryTimeout = setTimeout(() => {
            summaryTimeout = null;
            isTransitioningToSummary = false;
            advanceGameFlow();
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
          
          if (loggedIn) {
            if (btnViewDetails) btnViewDetails.classList.remove('hidden');
            populatePitchDetailBug();
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
          
          // Draw the crossing marker and trace
          drawTrajectoryTrace(pitchTrajectory.points, currentPitch.release_pos_y || 54.0);
          const isStrikeABSVal = userHistoryItem.absCall === 'S';
          drawCrossingMarker(pitchTrajectory.crossPoint, isStrikeABSVal);
          
          if (!loggedIn) {
            startQuickReviewAutoAdvance(2000);
          } else if (abEnded) {
            hideQuickPreviewPanel();
            if (summaryTimeout) clearTimeout(summaryTimeout);
            isTransitioningToSummary = true;
            summaryTimeout = setTimeout(() => {
              summaryTimeout = null;
              isTransitioningToSummary = false;
              advanceGameFlow();
            }, minPreviewMs);
          } else {
            if (quickPreviewControls) {
              quickPreviewControls.classList.remove('opacity-0', 'pointer-events-none', 'scale-90');
              quickPreviewControls.classList.add('opacity-100', 'pointer-events-auto', 'scale-100');
            }
            startQuickReviewAutoAdvance(minPreviewMs);
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
      document.body.classList.remove('split-screen-active');
      const containerScoreboard = document.getElementById('canvas-container');
      onResize(containerScoreboard.clientWidth, containerScoreboard.clientHeight);

      hudHeader.classList.add('opacity-0');
      if (matchupCard) {
        matchupCard.classList.add('opacity-0', 'pointer-events-none');
        matchupCard.classList.remove('opacity-100', 'pointer-events-auto');
      }
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
  if (!audioCtx) return;
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
 * Handles pitch flight and wind-up animation frames
 */
function tick() {
  requestAnimationFrame(tick);
  
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
  transitionToState(STATES.WINDUP);
}

function submitSwingDecision() {
  if (currentState !== STATES.PITCHING) return;
  
  const absStrike = isStrikeABS(currentPitch, pitchTrajectory.crossPoint);
  const absCall = absStrike ? 'S' : 'B';
  const realCall = currentPitch.real_ump_call || currentPitch.ump_call;
  
  const userCorrect = true;
  const realCorrect = realCall === absCall;
  
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
  
  timerProgressRing.classList.remove('animate-timer-ring');
  void timerProgressRing.offsetWidth;
  timerProgressRing.classList.add('animate-timer-ring');

  timerInterval = setInterval(() => {
    timerSecondsLeft--;
    
    if (timerSecondsLeft > 0) {
      timerCountdownText.textContent = timerSecondsLeft;
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
  
  clearInterval(timerInterval);
  
  const absStrike = isStrikeABS(currentPitch, pitchTrajectory.crossPoint);
  const absCall = absStrike ? 'S' : 'B';
  const realCall = currentPitch.real_ump_call || currentPitch.ump_call;
  
  const userCorrect = userCall === absCall;
  const realCorrect = realCall === absCall;
  
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
 * Handles click navigation from review panel
 */
function advanceGameFlow(immediate = false) {
  if (currentState !== STATES.ABS_REVIEW) return;
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
    if (isHalfInningEnd) {
      isGameOver = true;
    }
  } else if (gameMode === 'daily_streak') {
    // In Daily Streak, the game ends on the very first missed call!
    if (!historyItem.isSwingPlay && !historyItem.userCorrect) {
      isGameOver = true;
      activeAbEnded = true;
      showABOutcomeToast("STREAK ENDED! MISSED CALL");
      localStorage.setItem('daily_streak_last_played_date', new Date().toLocaleDateString());
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
    
    if (immediate) {
      if (summaryTimeout) {
        clearTimeout(summaryTimeout);
        summaryTimeout = null;
      }
      isTransitioningToSummary = false;
      showAtBatSummaryScreen(lastAbOutcomeText);
    } else {
      isTransitioningToSummary = true;
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
  toastMessage.innerHTML = `<span class="text-purple-300 font-bold font-mono-tech">${text}</span>`;
  toastMessage.className = 'absolute top-28 left-1/2 -translate-x-1/2 px-8 py-4 rounded-2xl font-black uppercase tracking-wider text-xl md:text-3xl shadow-2xl opacity-100 scale-100 transition-all duration-300 bg-purple-950/95 text-white border-2 border-purple-500/40 shadow-purple-500/10 pointer-events-auto z-30 whitespace-nowrap';
  setTimeout(() => {
    toastMessage.classList.add('opacity-0', 'scale-90');
    toastMessage.classList.remove('opacity-100', 'scale-100');
  }, 2200);
}

/**
 * Displays the At-Bat Start overlay with matchup info and a 3-second auto-start countdown
 */
function showAtBatStartScreen(onConfirmCallback) {
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
    if (abStartPitcher) abStartPitcher.textContent = matchup.pitcher;
    if (abStartBatter) abStartBatter.textContent = matchup.batter;
    if (abStartPitcherHand) abStartPitcherHand.textContent = pitch.pitcher_hand || 'RHP';
    if (abStartBatterHand) abStartBatterHand.textContent = pitch.batter_hand || 'RHB';

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

  // Show overlay with transition
  abStartOverlay.classList.remove('opacity-0', 'pointer-events-none', 'scale-95');
  abStartOverlay.classList.add('opacity-100', 'scale-100', 'pointer-events-auto');

  // No countdown! Just show static text
  if (abStartTimerText) {
    abStartTimerText.textContent = "Ready to start the next matchup.";
  }

  // Store callback for confirm
  window._abStartCallback = onConfirmCallback;
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

  // Hide the overlay
  if (abStartOverlay) {
    abStartOverlay.classList.add('opacity-0', 'pointer-events-none', 'scale-95');
    abStartOverlay.classList.remove('opacity-100', 'scale-100', 'pointer-events-auto');
  }

  // Execute the stored callback
  if (window._abStartCallback) {
    window._abStartCallback();
    window._abStartCallback = null;
  } else {
    // Default: start auto-play
    if (currentState === STATES.IDLE && !isGamePaused) {
      autoPlayTimeout = setTimeout(() => {
        triggerPitchRelease();
      }, 600);
    }
  }
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
  }

  hideQuickPreviewPanel();
  showReviewPanel(false);

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
      ballsDots[i].className = 'w-3.5 h-3.5 rounded-full bg-green-500 shadow-lg shadow-green-500/50';
    } else {
      ballsDots[i].className = 'w-3.5 h-3.5 rounded-full border border-gray-600 bg-transparent';
    }
  }
  
  const strikesDots = strikesIndicator.children;
  for (let i = 0; i < strikesDots.length; i++) {
    if (i < strikesCount) {
      strikesDots[i].className = 'w-3.5 h-3.5 rounded-full bg-red-500 shadow-lg shadow-red-500/50';
    } else {
      strikesDots[i].className = 'w-3.5 h-3.5 rounded-full border border-gray-600 bg-transparent';
    }
  }

  const outsDots = outsIndicator.children;
  for (let i = 0; i < outsDots.length; i++) {
    if (i < outsCount) {
      outsDots[i].className = 'w-3.5 h-3.5 rounded-full bg-amber-500 shadow-lg shadow-amber-500/50';
    } else {
      outsDots[i].className = 'w-3.5 h-3.5 rounded-full border border-gray-600 bg-transparent';
    }
  }

  if (gameMode === 'standard') {
    pitchCounterText.textContent = `PITCH ${currentPitchIndex + 1} OF 10`;
  } else if (gameMode === 'weekly_challenge') {
    const total = weeklyPlaylistABs.length || extractAtBatsFromWeeklyData().length || 16;
    pitchCounterText.textContent = `WEEKLY CHALLENGE | AB ${activeWeeklyAbIndex + 1} OF ${total}`;
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
    toastMessage.className = 'absolute top-28 left-1/2 -translate-x-1/2 px-8 py-4 rounded-2xl font-black uppercase tracking-wider text-xl md:text-3xl shadow-2xl opacity-100 scale-100 transition-all duration-300 bg-slate-900/95 text-white border-2 border-amber-500/40 shadow-amber-500/10 pointer-events-auto z-30 whitespace-nowrap';
  } else {
    if (isCorrect) {
      toastMessage.innerHTML = `<span class="text-green-400 font-black shadow-neon-green-glow">SAFE CALL</span> &nbsp;|&nbsp; ABS: ${absCall === 'S' ? 'STRIKE' : 'BALL'}`;
      toastMessage.className = 'absolute top-28 left-1/2 -translate-x-1/2 px-8 py-4 rounded-2xl font-black uppercase tracking-wider text-xl md:text-3xl shadow-2xl opacity-100 scale-100 transition-all duration-300 bg-green-950/95 text-white border-2 border-green-500/40 shadow-green-500/10 pointer-events-auto z-30 whitespace-nowrap';
    } else {
      toastMessage.innerHTML = `<span class="text-red-400 font-black shadow-neon-strike-glow">MISSED CALL</span> &nbsp;|&nbsp; ABS: ${absCall === 'S' ? 'STRIKE' : 'BALL'}`;
      toastMessage.className = 'absolute top-28 left-1/2 -translate-x-1/2 px-8 py-4 rounded-2xl font-black uppercase tracking-wider text-xl md:text-3xl shadow-2xl opacity-100 scale-100 transition-all duration-300 bg-red-950/95 text-white border-2 border-red-500/40 shadow-red-500/10 pointer-events-auto z-30 whitespace-nowrap';
    }
  }

  setTimeout(() => {
    toastMessage.classList.add('opacity-0', 'scale-90');
    toastMessage.classList.remove('opacity-100', 'scale-100');
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
  
  finalUserAccuracy.textContent = `${userAcc}%`;
  finalUserStats.textContent = `${userCorrectCount} OF ${calledPitches.length} CORRECT`;
  
  finalUmpAccuracy.textContent = `${umpAcc}%`;
  finalUmpStats.textContent = `${umpCorrectCount} OF ${calledPitches.length} CORRECT`;

  // Save game result to persistent user profile stats database in localStorage
  const username = localStorage.getItem('ump_username');
  if (username) {
    const statsKey = `pitch_ump_stats_${username}`;
    let userStats = JSON.parse(localStorage.getItem(statsKey) || '{"overallAccuracy":null,"maxStreak":0,"completedWeekly":0,"dnfs":0,"history":[]}');
    
    if (gameMode === 'weekly_challenge') {
      userStats.completedWeekly = (userStats.completedWeekly || 0) + 1;
    }
    userStats.dnfs = dnfDisconnectsCount;
    
    // Calculate new overall accuracy combining all history sessions
    let totalCallsSum = calledPitches.length;
    let totalCorrectSum = userCorrectCount;
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
      correctCalls: userCorrectCount,
      totalCalls: calledPitches.length,
      accuracy: userAcc,
      date: new Date().toLocaleDateString()
    });
    
    localStorage.setItem(statsKey, JSON.stringify(userStats));
    updateProfileStatsUI();
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
  if (autoPlayTimeout) {
    clearTimeout(autoPlayTimeout);
    autoPlayTimeout = null;
  }
  
  isGamePaused = false;
  if (pauseScreen) {
    pauseScreen.classList.add('opacity-0', 'pointer-events-none', 'scale-95');
    pauseScreen.classList.remove('opacity-100', 'pointer-events-auto', 'scale-100');
  }
  if (abSummaryOverlay) {
    abSummaryOverlay.classList.add('opacity-0', 'pointer-events-none', 'scale-95');
    abSummaryOverlay.classList.remove('opacity-100', 'pointer-events-auto', 'scale-100');
  }

  hudHeader.classList.add('opacity-0');
  hudKeyboardHelp.classList.add('opacity-0');
  if (matchupCard) {
    matchupCard.classList.add('opacity-0', 'pointer-events-none');
    matchupCard.classList.remove('opacity-100', 'pointer-events-auto');
  }
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
      btn.className = "flex-1 py-4 text-center text-xs font-bold uppercase tracking-widest tab-btn-active transition-all cursor-pointer";
      content.classList.remove('hidden');
      content.classList.add('flex');
    } else {
      btn.className = "flex-1 py-4 text-center text-xs font-bold uppercase tracking-widest text-gray-400 hover:text-white hover:bg-white/2 transition-all cursor-pointer";
      content.classList.add('hidden');
      content.classList.remove('flex');
    }
  });

  if (tabName === 'stats') {
    updateProfileStatsUI();
  } else if (tabName === 'leaderboard') {
    renderLeaderboard('weekly');
  }
}

/**
 * Starts a weekly challenge game playlist
 */
function startWeeklyChallengeGame(gameIdx) {
  gameMode = 'weekly_challenge';
  activeGameIndex = gameIdx;
  isGamePaused = false;
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
        pitcher: currentPitches[0].pitcher
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
      pitcher: currentPitches[0].pitcher
    });
  }
  
  weeklyPlaylistABs = gameABs;
  activeWeeklyAbIndex = 0;
  
  loadWeeklyAtBat(activeWeeklyAbIndex);
}

/**
 * Starts a Daily Streak challenge session
 */
function startDailyStreakChallenge() {
  localStorage.setItem('daily_streak_last_played_date', new Date().toLocaleDateString());
  updateDailyStreakStatusUI();

  gameMode = 'daily_streak';
  isGamePaused = false;
  if (pauseScreen) {
    pauseScreen.classList.add('opacity-0', 'pointer-events-none');
    pauseScreen.classList.remove('opacity-100', 'pointer-events-auto');
  }
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

/**
 * Displays the At-Bat Summary Overlay between weekly challenge at-bats
 */
async function showAtBatSummaryScreen(outcomeText) {
  if (!abSummaryOverlay) return;
  
  // Reset zoom and dimension line when showing summary
  setZoomedIn(false);
  clearDimensionLine();
  
  const displayOutcome = outcomeText || lastAbOutcomeText || "At-Bat Complete";
  abSummaryTitle.textContent = displayOutcome.toUpperCase();
  
  const pitcher = lastAbPitcher || "Pitcher";
  const batter = lastAbBatter || "Batter";
  abSummaryMatchup.textContent = `P: ${pitcher.toUpperCase()} vs B: ${batter.toUpperCase()}`;
  
  // Fetch headshot images and logos
  if (abSummaryPitcherName) abSummaryPitcherName.textContent = pitcher.toUpperCase();
  if (abSummaryBatterName) abSummaryBatterName.textContent = batter.toUpperCase();
  
  const targetPitch = lastCompletedPitch || currentPitch;
  if (abSummaryPitcherHandBadge && targetPitch) {
    abSummaryPitcherHandBadge.textContent = (targetPitch.pitcher_hand || "R") === "L" ? "LHP" : "RHP";
  }
  if (abSummaryBatterHandBadge && targetPitch) {
    abSummaryBatterHandBadge.textContent = (targetPitch.batter_hand || "R") === "L" ? "LHB" : "RHB";
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
  const correctCount = abPitches.filter(x => x.userCorrect).length;
  const accuracy = abPitches.length > 0 ? Math.round((correctCount / abPitches.length) * 100) : 100;
  
  abSummaryAccuracy.textContent = `${accuracy}%`;
  abSummaryPitches.textContent = abPitches.length;
  abSummaryBlurb.textContent = lastAbBlurb || "No play-by-play description available.";
  
  // Populate Left 30% Panel: Pitch List
  if (abSummaryPitchList) {
    abSummaryPitchList.innerHTML = '';
    
    abPitches.forEach((item, index) => {
      const isCorrect = item.userCorrect;
      const callText = item.userCall === 'S' ? "STRIKE" : "BALL";
      const absText = item.absCall === 'S' ? "STRIKE" : "BALL";
      
      const btn = document.createElement('button');
      btn.className = `w-full text-left p-2 rounded-lg border text-[9px] font-mono-tech transition-all flex items-center justify-between cursor-pointer select-none ${
        isCorrect 
          ? 'bg-green-500/10 border-green-500/30 text-green-400 hover:bg-green-500/20' 
          : 'bg-red-500/10 border-red-500/30 text-red-400 hover:bg-red-500/20'
      }`;
      btn.innerHTML = `
        <div class="flex flex-col min-w-0">
          <span class="text-white font-bold text-[10px]">#${index + 1}: ${item.pitchType}</span>
          <span class="text-gray-400">${item.speedMph} MPH | ${callText} (ABS: ${absText})</span>
        </div>
        <span class="font-extrabold ${isCorrect ? 'text-green-400' : 'text-red-400'}">${isCorrect ? '✓' : '✗'}</span>
      `;
      
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        initAudio();
        highlightPitchInSummary(index);
      });
      
      abSummaryPitchList.appendChild(btn);
    });
  }

  // Draw At-Bat SVG Pitch Matrix
  drawAbSummarySVGMatrix();
  
  // Highlight the last pitch automatically if available
  if (abPitches.length > 0) {
    highlightPitchInSummary(abPitches.length - 1);
  }
  
  // Connect film room and umpire scorecard URLs specifically to this at-bat's game
  let urls;
  if (gameMode === 'weekly_challenge' && weeklyPlaylistABs[activeWeeklyAbIndex]) {
    const abData = weeklyPlaylistABs[activeWeeklyAbIndex];
    urls = getRevisitedUrls(targetPitch, abData);
  } else {
    // Fallback for standard or Orioles game
    const gameData = WEEKLY_CHALLENGE_DATA[activeGameIndex] || WEEKLY_CHALLENGE_DATA[0];
    urls = getRevisitedUrls(targetPitch, gameData);
  }
  if (abSummaryFilmLink) abSummaryFilmLink.href = urls.filmRoomUrl;
  if (abSummaryScorecardLink) abSummaryScorecardLink.href = urls.umpScorecardUrl;
  
  // Make visible
  abSummaryOverlay.classList.remove('opacity-0', 'pointer-events-none', 'scale-95');
  abSummaryOverlay.classList.add('opacity-100', 'scale-100', 'pointer-events-auto');
  
  // Start countdown timer for summary overlay
  startSummaryTimerCounter();
}

function advanceNextAtBat() {
  if (abSummaryOverlay) {
    abSummaryOverlay.classList.add('opacity-0', 'pointer-events-none');
    abSummaryOverlay.classList.remove('opacity-100', 'pointer-events-auto');
  }
  
  if (overviewTimerInterval) {
    clearInterval(overviewTimerInterval);
    overviewTimerInterval = null;
  }
  if (btnAbSummaryAdvance) {
    btnAbSummaryAdvance.textContent = 'ADVANCE TO NEXT AB';
  }
  
  quickStartNextPitch = true;
  activeAbEnded = false; // Reset AB ended status for the next AB
  
  // Set start history index for the new AB
  currentAbStartHistoryIndex = pitchHistory.length;
  
  // Advance in weekly challenge playlist
  if (gameMode === 'weekly_challenge') {
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
  const data = {
    completedABsCount,
    dnfDisconnectsCount,
    weeklyPlaylistABs,
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
      currentPitchIndex,
      historyLength: pitchHistory.length
    };
  } else {
    data.activeChallenge = null;
  }
  
  localStorage.setItem('pitch_ump_challenge_mvp', JSON.stringify(data));
}

function loadSavedSessionFromLocal() {
  const raw = localStorage.getItem('pitch_ump_challenge_mvp');
  if (!raw) return;
  
  try {
    const data = JSON.parse(raw);
    if (data.completedABsCount) completedABsCount = data.completedABsCount;
    if (data.dnfDisconnectsCount) dnfDisconnectsCount = data.dnfDisconnectsCount;
    if (data.weeklyPlaylistABs) weeklyPlaylistABs = data.weeklyPlaylistABs;
    if (data.activeWeeklyAbIndex !== undefined) activeWeeklyAbIndex = data.activeWeeklyAbIndex;
    if (data.activeGameIndex !== undefined) activeGameIndex = data.activeGameIndex;
    
    // Check if the user had an active game running and closed it (tracks DNF disconnects)
    if (data.activeChallenge) {
      dnfDisconnectsCount++;
      saveChallengeSessionToLocal(); // Save immediately
      showABOutcomeToast("DISCONNECT RESTORED: DNF LOGGED");
    }
    
    updateChallengeProgressUI();
    updateProfileStatsUI();
  } catch (e) {
    console.error("Failed to load local challenge session", e);
  }
}

function pauseGameOnFocusLoss() {
  if (currentState === STATES.START || 
      currentState === STATES.SCOREBOARD || 
      currentState === STATES.PITCHING || 
      currentState === STATES.DECISION_PENDING || 
      isGamePaused) return;
  if (abSummaryOverlay && abSummaryOverlay.classList.contains('opacity-100')) return;
  if (abStartOverlay && abStartOverlay.classList.contains('opacity-100')) return;

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
  
  // Show pause overlay, but suppress it if a menu overlay (settings/scorecard) is already visible
  const isMenuOverlayOpen = isSettingsOpen || (umpcardOverlay && umpcardOverlay.classList.contains('opacity-100'));
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
      summaryTimeout = null;
      isTransitioningToSummary = false;
      showAtBatSummaryScreen(cachedAbOutcomeText);
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
    if (activeWeeklyAbIndex > 0 && activeWeeklyAbIndex < total) {
      btnStartWeeklyChallenge.textContent = "Resume Weekly Challenge";
    } else {
      btnStartWeeklyChallenge.textContent = "Start Weekly Challenge";
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
  if (!username) {
    if (avgAccEl) avgAccEl.textContent = "--";
    if (maxStrEl) maxStrEl.textContent = "--";
    if (compWkEl) compWkEl.textContent = "--";
    if (dnfEl) dnfEl.textContent = "0";
    if (historyTableBody) historyTableBody.innerHTML = '<tr><td colspan="4" class="p-3 text-center text-gray-500">Log in to view stats</td></tr>';
    return;
  }
  
  const statsKey = `pitch_ump_stats_${username}`;
  const userStats = JSON.parse(localStorage.getItem(statsKey) || '{"overallAccuracy":null,"maxStreak":0,"completedWeekly":0,"dnfs":0,"history":[]}');
  
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
  if (quickContinueTimer) {
    quickContinueTimer.textContent = '';
  }
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
    const isEnd = (gameMode === 'weekly_challenge' && activeWeeklyAbIndex >= weeklyPlaylistABs.length - 1) || isSessionOver;
    btnAbSummaryAdvance.textContent = isEnd ? "VIEW FINAL SCOREBOARD" : "ADVANCE TO NEXT AB";
  }
}

function updateSummaryTimerUI() {
  if (btnAbSummaryAdvance) {
    const isEnd = (gameMode === 'weekly_challenge' && activeWeeklyAbIndex >= weeklyPlaylistABs.length - 1) || isSessionOver;
    btnAbSummaryAdvance.textContent = isEnd ? "VIEW FINAL SCOREBOARD" : "ADVANCE TO NEXT AB";
  }
}

function extractAtBatsFromWeeklyData() {
  const list = [];
  WEEKLY_CHALLENGE_DATA.forEach((game, gameIdx) => {
    let currentPitches = [];
    let currentBatter = '';
    
    game.pitches.forEach(pitch => {
      if (pitch.batter !== currentBatter && currentPitches.length > 0) {
        list.push({
          gameIndex: gameIdx,
          gameTitle: game.title,
          filmRoomUrl: game.film_room_url,
          umpScorecardUrl: game.ump_scorecard_url,
          pitches: currentPitches,
          batter: currentPitches[0].batter,
          pitcher: currentPitches[0].pitcher
        });
        currentPitches = [];
      }
      currentBatter = pitch.batter;
      currentPitches.push(pitch);
    });
    
    if (currentPitches.length > 0) {
      list.push({
        gameIndex: gameIdx,
        gameTitle: game.title,
        filmRoomUrl: game.film_room_url,
        umpScorecardUrl: game.ump_scorecard_url,
        pitches: currentPitches,
        batter: currentPitches[0].batter,
        pitcher: currentPitches[0].pitcher
      });
    }
  });
  return list;
}

function startWeeklyChallenge() {
  gameMode = 'weekly_challenge';
  isGamePaused = false;
  if (pauseScreen) {
    pauseScreen.classList.add('opacity-0', 'pointer-events-none');
    pauseScreen.classList.remove('opacity-100', 'pointer-events-auto');
  }
  
  const rawABs = extractAtBatsFromWeeklyData();
  const rawSession = localStorage.getItem('pitch_ump_challenge_mvp');
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
          localStorage.removeItem('pitch_ump_challenge_mvp');
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
    for (let i = weeklyPlaylistABs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [weeklyPlaylistABs[i], weeklyPlaylistABs[j]] = [weeklyPlaylistABs[j], weeklyPlaylistABs[i]];
    }
    activeWeeklyAbIndex = 0;
  }
  
  loadWeeklyAtBat(activeWeeklyAbIndex);
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

function loadWeeklyAtBat(abIdx) {
  if (abIdx >= weeklyPlaylistABs.length) {
    saveChallengeSessionToLocal();
    transitionToState(STATES.SCOREBOARD);
    return;
  }
  
  activeAbEnded = false; // Reset AB ended status
  activeWeeklyAbIndex = abIdx;
  const abData = weeklyPlaylistABs[activeWeeklyAbIndex];
  
  pitchesList = abData.pitches;
  currentPitchIndex = 0;
  pitchHistory = [];
  currentAbStartHistoryIndex = 0;
  
  abBalls = 0;
  abStrikes = 0;
  abOverviewSecondsUsed = 0;
  isGamePaused = false;
  if (pauseScreen) {
    pauseScreen.classList.add('opacity-0', 'pointer-events-none');
    pauseScreen.classList.remove('opacity-100', 'pointer-events-auto');
  }
  
  saveChallengeSessionToLocal();
  
  // Show At-Bat Start Preview with matchup, then transition to IDLE
  transitionToState(STATES.IDLE);
  showAtBatStartScreen(() => {
    // After user confirms or timer expires, start auto-play
    if (currentState === STATES.IDLE && !isGamePaused) {
      autoPlayTimeout = setTimeout(() => {
        triggerPitchRelease();
      }, 600);
    }
  });
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

function updateDailyStreakStatusUI() {
  const lastPlayed = localStorage.getItem('daily_streak_last_played_date');
  const today = new Date().toLocaleDateString();
  const btn = document.getElementById('btn-start-daily-streak');
  const status = document.getElementById('daily-attempt-status');
  
  if (lastPlayed === today) {
    if (status) {
      status.textContent = "COMPLETED TODAY";
      status.className = "text-xs font-bold text-red-400 uppercase animate-pulse";
    }
    if (btn) {
      btn.setAttribute('disabled', 'true');
      btn.className = "px-5 py-2 bg-gray-800 text-gray-500 border border-gray-700/30 rounded-lg text-xs font-bold uppercase tracking-wider cursor-not-allowed opacity-50";
    }
  } else {
    if (status) {
      status.textContent = "Available (Free)";
      status.className = "text-xs font-bold text-green-400 uppercase";
    }
    if (btn) {
      btn.removeAttribute('disabled');
      btn.className = "px-5 py-2 bg-blue-600 hover:bg-blue-500 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer text-white";
    }
  }
}

function cancelAutoPlayPitch() {
  if (autoPlayTimeout) {
    clearTimeout(autoPlayTimeout);
    autoPlayTimeout = null;
  }
}

function resumeAutoPlayPitch() {
  const isOverlayOpen = isSettingsOpen || (umpcardOverlay && umpcardOverlay.classList.contains('opacity-100'));
  if (!isOverlayOpen && !isGamePaused && currentState === STATES.IDLE && !autoPlayTimeout) {
    autoPlayTimeout = setTimeout(() => {
      triggerPitchRelease();
    }, 1800);
  }
}

// Local session load complete

function setOverlayVisible(el, visible) {
  if (!el) return;
  if (visible) {
    el.classList.add('opacity-100', 'pointer-events-auto');
    el.classList.remove('opacity-0', 'pointer-events-none');
  } else {
    el.classList.add('opacity-0', 'pointer-events-none');
    el.classList.remove('opacity-100', 'pointer-events-auto');
  }
}

function saveFavoriteTeam(teamName) {
  activeFavoriteTeam = teamName;
  localStorage.setItem('pitch_ump_favorite_team', teamName);
  if (userFavoriteTeamBadge) {
    userFavoriteTeamBadge.textContent = teamName ? `FAVORITE TEAM: ${teamName.toUpperCase()}` : 'FAVORITE TEAM: NONE';
  }
}

function loadFavoriteTeam() {
  const saved = localStorage.getItem('pitch_ump_favorite_team');
  if (saved) {
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
  teamGridContainer.innerHTML = '';
  
  TEAMS_LIST.forEach(team => {
    const btn = document.createElement('button');
    btn.className = 'flex flex-col items-center justify-center p-3 rounded-lg border border-white/10 bg-slate-900/60 hover:bg-slate-800/80 transition-all cursor-pointer select-none';
    btn.style.borderColor = 'rgba(255, 255, 255, 0.08)';
    
    btn.innerHTML = `
      <div class="w-9 h-9 rounded-full flex items-center justify-center text-xs font-black text-white shadow-inner mb-2 select-none" style="background-color: ${team.color}">
        ${team.symbol}
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
}

function renderDashboardGamesList() {
  if (!dashboardGamesList) return;
  dashboardGamesList.innerHTML = '';

  WEEKLY_CHALLENGE_DATA.forEach((game, idx) => {
    const gameABs = [];
    let currentBatter = '';
    game.pitches.forEach(p => {
      if (p.batter !== currentBatter) {
        gameABs.push(p);
        currentBatter = p.batter;
      }
    });
    const totalABs = gameABs.length || 3;
    
    const card = document.createElement('div');
    card.className = 'glass-panel p-3.5 rounded-xl border border-white/5 hover:border-purple-500/40 flex flex-col justify-between transition-all select-none hover:scale-[1.01]';
    
    let rivalBadgeHtml = '';
    if (activeFavoriteTeam) {
      const parts = game.title.split(' vs. ');
      const awayTeam = parts[0];
      const homeTeam = parts[1];
      if (awayTeam === activeFavoriteTeam || homeTeam === activeFavoriteTeam) {
        rivalBadgeHtml = `<span class="absolute top-2 right-2 text-[8px] font-mono-tech px-1.5 py-0.5 bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded font-bold">RIVALRY</span>`;
      }
    }

    card.style.position = 'relative';
    card.innerHTML = `
      ${rivalBadgeHtml}
      <div class="flex flex-col">
        <span class="text-[9px] font-mono-tech text-purple-400 font-bold uppercase tracking-wider">GAME #${idx + 1}</span>
        <span class="text-xs font-black text-white mt-1 uppercase tracking-wide leading-tight">${game.title}</span>
        <span class="text-[9px] text-gray-400 mt-1 font-mono-tech uppercase">${totalABs} AT-BATS</span>
      </div>
      <button class="btn-play-game-ab w-full mt-3 py-1.5 bg-purple-600/20 hover:bg-purple-600 border border-purple-500/30 rounded text-[9px] font-extrabold uppercase tracking-widest text-white transition-colors cursor-pointer" data-game-idx="${idx}">
        Select Game
      </button>
    `;
    
    const playBtn = card.querySelector('.btn-play-game-ab');
    playBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      initAudio();
      startWeeklyChallengeGame(idx);
    });

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
  const savedMode = localStorage.getItem('pitch_ump_ui_mode') || 'classic';
  setUiMode(savedMode);

  const bindBtn = (btn, mode) => {
    if (btn) {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        initAudio();
        setUiMode(mode);
      });
    }
  };

  bindBtn(btnUiClassic, 'classic');
  bindBtn(btnUiAdaptive, 'adaptive');
  bindBtn(btnUiCinematic, 'cinematic');
  bindBtn(settingsUiClassic, 'classic');
  bindBtn(settingsUiAdaptive, 'adaptive');
  bindBtn(settingsUiCinematic, 'cinematic');
}

function setUiMode(mode) {
  activeUiMode = mode;
  localStorage.setItem('pitch_ump_ui_mode', mode);

  // Apply to body
  document.body.classList.remove('ui-mode-classic', 'ui-mode-adaptive', 'ui-mode-cinematic');
  document.body.classList.add(`ui-mode-${mode}`);

  // Update switcher button highlights (HUD)
  [btnUiClassic, btnUiAdaptive, btnUiCinematic].forEach(btn => {
    if (btn) {
      btn.classList.remove('ui-mode-btn-active');
      btn.classList.add('text-white/50');
    }
  });

  const activeBtn = mode === 'classic' ? btnUiClassic : (mode === 'adaptive' ? btnUiAdaptive : btnUiCinematic);
  if (activeBtn) {
    activeBtn.classList.add('ui-mode-btn-active');
    activeBtn.classList.remove('text-white/50');
  }

  // Update switcher button highlights (Settings Panel)
  [settingsUiClassic, settingsUiAdaptive, settingsUiCinematic].forEach(btn => {
    if (btn) {
      btn.classList.remove('bg-purple-600');
      btn.classList.add('bg-gray-800');
      btn.classList.remove('text-white');
      btn.classList.add('text-white/60');
    }
  });

  const activeSettingsBtn = mode === 'classic' ? settingsUiClassic : (mode === 'adaptive' ? settingsUiAdaptive : settingsUiCinematic);
  if (activeSettingsBtn) {
    activeSettingsBtn.classList.add('bg-purple-600');
    activeSettingsBtn.classList.remove('bg-gray-800');
    activeSettingsBtn.classList.add('text-white');
    activeSettingsBtn.classList.remove('text-white/60');
  }

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
  return 'https://www.mlbstatic.com/team-logos/generic.svg';
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

function drawAbSummarySVGMatrix() {
  if (!abSummarySvgPitches) return;
  abSummarySvgPitches.innerHTML = '';
  if (abSummaryPitchDetails) {
    abSummaryPitchDetails.textContent = "Click a pitch above to review telemetry";
  }

  const abPitches = pitchHistory.slice(currentAbStartHistoryIndex).filter(p => !p.isSwingPlay);
  if (abPitches.length === 0) return;

  abPitches.forEach((item, index) => {
    const cross = item.trajectory ? item.trajectory.crossPoint : null;
    if (!cross) return;
    
    const x = cross.x;
    const y = 4.0 - cross.y;
    
    const isCorrect = item.userCorrect;
    const isStrikeABSVal = item.absCall === 'S';
    
    const fillColor = isCorrect ? '#22c55e' : '#ef4444';
    const strokeColor = isCorrect ? '#4ade80' : '#f87171';
    
    let element = null;
    const radius = 0.12;
    
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
    element.setAttribute("stroke-width", "0.03");
    element.setAttribute("class", "cursor-pointer transition-all duration-150 hover:scale-110");
    element.style.pointerEvents = 'auto';
    
    element.addEventListener('click', (e) => {
      e.stopPropagation();
      initAudio();
      highlightPitchInSummary(index);
    });
    
    const title = document.createElementNS("http://www.w3.org/2000/svg", "title");
    title.textContent = `Pitch #${index + 1}: ${item.pitchType} (${item.speedMph} MPH) - ABS: ${item.absCall === 'S' ? 'STRIKE' : 'BALL'}, User: ${item.userCall === 'S' ? 'STRIKE' : 'BALL'}`;
    element.appendChild(title);
    
    abSummarySvgPitches.appendChild(element);
  });
}

function highlightPitchInSummary(index) {
  const abPitches = pitchHistory.slice(currentAbStartHistoryIndex).filter(p => !p.isSwingPlay);
  const item = abPitches[index];
  if (!item) return;

  if (abSummaryPitchDetails) {
    const isCorrect = item.userCorrect;
    const resultText = isCorrect ? "CORRECT CALL" : "MISSED CALL";
    const resultColorClass = isCorrect ? "text-green-400" : "text-red-400";
    const callText = item.userCall === 'S' ? "STRIKE" : "BALL";
    const absText = item.absCall === 'S' ? "STRIKE" : "BALL";
    
    abSummaryPitchDetails.innerHTML = `
      <span class="font-extrabold ${resultColorClass}">${resultText}</span><br>
      Pitch #${index + 1}: <b class="text-white">${item.pitchType}</b> @ <b class="text-purple-400">${item.speedMph} MPH</b><br>
      Your Call: <span class="text-white font-bold">${callText}</span> | ABS: <span class="text-white font-bold">${absText}</span>
    `;
  }

  // Highlight button in the list
  if (abSummaryPitchList) {
    const buttons = abSummaryPitchList.querySelectorAll('button');
    buttons.forEach((btn, btnIdx) => {
      if (btnIdx === index) {
        btn.classList.add('ring-2', 'ring-purple-500', 'border-purple-500/50');
      } else {
        btn.classList.remove('ring-2', 'ring-purple-500', 'border-purple-500/50');
      }
    });
  }

  // Highlight dot/shape in the SVG and dim others
  if (abSummarySvgPitches) {
    const elements = abSummarySvgPitches.children;
    for (let i = 0; i < elements.length; i++) {
      const el = elements[i];
      if (i === index) {
        el.style.opacity = '1.0';
        el.setAttribute('stroke-width', '0.07');
        el.setAttribute('stroke', '#ffffff');
        if (el.tagName === 'circle') {
          el.setAttribute('r', '0.16');
        }
      } else {
        el.style.opacity = '0.25';
        el.setAttribute('stroke-width', '0.03');
        const isCorrect = abPitches[i].userCorrect;
        const originalStrokeColor = isCorrect ? '#4ade80' : '#f87171';
        el.setAttribute('stroke', originalStrokeColor);
        if (el.tagName === 'circle') {
          el.setAttribute('r', '0.12');
        }
      }
    }
  }
}

function renderLeaderboard(type) {
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
    divisionTitle = "Streak Leaderboard (Consecutive Correct)";
  } else if (type === 'alltime') {
    divisionTitle = "All-Time Hall of Fame";
  }
  leaderboardDivisionTitle.textContent = divisionTitle.toUpperCase();

  const activeHandle = localStorage.getItem('ump_username') || "YOU";

  let rows = [];
  if (type === 'weekly') {
    rows = [
      { rank: 1, name: "Pat Hoberg", team: "Orioles", accuracy: "98.8%", score: "990 pts" },
      { rank: 2, name: "Miller_Crew", team: "Dodgers", accuracy: "97.2%", score: "972 pts" },
      { rank: 3, name: "West_Coast_Ump", team: "Giants", accuracy: "95.5%", score: "955 pts" },
      { rank: 4, name: activeHandle, team: activeFavoriteTeam || "Phillies", accuracy: "94.8%", score: "948 pts", isUser: true },
      { rank: 5, name: "Angel_H", team: "Astros", accuracy: "81.2%", score: "812 pts" },
    ];
  } else if (type === 'daily') {
    rows = [
      { rank: 1, name: "PerfectCall_99", team: "Yankees", accuracy: "98.5%", score: "24 Streak" },
      { rank: 2, name: "LaserEye", team: "Rangers", accuracy: "96.4%", score: "19 Streak" },
      { rank: 3, name: activeHandle, team: activeFavoriteTeam || "Phillies", accuracy: "93.3%", score: "15 Streak", isUser: true },
      { rank: 4, name: "BlueLover", team: "Mets", accuracy: "92.0%", score: "12 Streak" },
      { rank: 5, name: "RoboUmpWho", team: "RedSox", accuracy: "91.5%", score: "10 Streak" },
    ];
  } else if (type === 'alltime') {
    rows = [
      { rank: 1, name: "Pat Hoberg", team: "Orioles", accuracy: "99.4%", score: "2,450 pts" },
      { rank: 2, name: "PerfectCall_99", team: "Yankees", accuracy: "97.8%", score: "2,120 pts" },
      { rank: 3, name: "West_Coast_Ump", team: "Giants", accuracy: "96.9%", score: "1,980 pts" },
      { rank: 4, name: "Miller_Crew", team: "Dodgers", accuracy: "96.2%", score: "1,890 pts" },
      { rank: 5, name: activeHandle, team: activeFavoriteTeam || "Phillies", accuracy: "93.5%", score: "1,750 pts", isUser: true },
    ];
  }

  leaderboardTableBody.innerHTML = '';
  rows.forEach(r => {
    const tr = document.createElement('tr');
    tr.className = `border-b border-white/5 font-mono-tech text-[11px] ${r.isUser ? 'bg-purple-950/20 text-purple-300 font-bold border-l-2 border-purple-500' : 'text-gray-300'}`;
    
    let rankHtml = `#${r.rank}`;
    if (r.rank === 1) rankHtml = `<span class="text-yellow-400 font-black">🥇 #1</span>`;
    else if (r.rank === 2) rankHtml = `<span class="text-gray-400 font-black">🥈 #2</span>`;
    else if (r.rank === 3) rankHtml = `<span class="text-amber-600 font-black">🥉 #3</span>`;

    tr.innerHTML = `
      <td class="p-3">${rankHtml}</td>
      <td class="p-3 uppercase tracking-wider">${r.name}</td>
      <td class="p-3 uppercase tracking-wider text-gray-400">${r.team}</td>
      <td class="p-3 text-center text-emerald-400">${r.accuracy}</td>
      <td class="p-3 text-center font-bold">${r.score}</td>
    `;
    leaderboardTableBody.appendChild(tr);
  });
}

