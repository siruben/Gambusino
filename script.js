'use strict';

// ============================================================
// DOM refs
// ============================================================
const beam        = document.getElementById('beam');
const darkness    = document.getElementById('darkness');
const torchBtn    = document.getElementById('torch-btn');
const shootBtn    = document.getElementById('shoot-btn');
const pauseBtn    = document.getElementById('pause-btn');
const scoreEl     = document.getElementById('score');
const levelEl     = document.getElementById('level-display');
const timerBar    = document.getElementById('timer-bar');
const gyroHint    = document.getElementById('gyro-hint');
const levelMsg    = document.getElementById('level-msg');
const startScreen = document.getElementById('start-screen');
const endScreen   = document.getElementById('end-screen');
const pauseScreen = document.getElementById('pause-screen');
const endTitle    = document.getElementById('end-title');
const endSub      = document.getElementById('end-sub');
const endDesc     = document.getElementById('end-desc');
const recordStartEl = document.getElementById('record-start');
const recordEndEl   = document.getElementById('record-end');

const bgMusic        = document.getElementById('bg-music');
const introMusic     = document.getElementById('intro-music');
const progressEl     = document.getElementById('progress-display');
const missedEl       = document.getElementById('escape-bar');
const comboDisplayEl = document.getElementById('combo-display');
const comboValueEl   = document.getElementById('combo-value');
const powerupIndEl   = document.getElementById('powerup-indicator');

// ============================================================
// GAMEPLAY TUNING — easy-to-adjust constants
// ============================================================
const FRAME_MS              = 1000 / 60; // reference frame: all "px/frame" values are tuned for 60 Hz
const MAX_DT                = 34;    // ms — longest frame we simulate (avoids tunnelling after a hiccup)

const BEAM_SWEEP_PERIOD     = 3500;  // ms — duration of one full left-right-left sweep cycle
const MAX_SWEEP_ANGLE       = 65;    // degrees — max auto-sweep angle (no gyro)
const MAX_GYRO_ANGLE        = 75;    // degrees — gyroscope gamma clamp
const LERP_FACTOR           = 0.12;  // beam angle smoothing (per 60 Hz frame)
const BEAM_HALF_VW          = 0.25;  // half-width of beam (matches CSS left:-25vw)
const NUGGET_SIZE           = 101;   // normal gambusino size (px)
const RARE_SIZE             = 120;   // rare gambusino size (px)
const BULLET_SPEED          = 12;    // px per 60 Hz frame
const BEAM_APEX_Y_OFFSET    = 46;    // px from bottom to torch centre
const MAX_LEVELS            = 30;    // total levels

// Tapping a lit gambusino kills it directly (no shot, no cooldown).
// Off by default so the shoot button, cooldown and power-ups actually matter.
const TAP_TO_KILL           = false;

// Movement base values (progressively increase per level)
const NUGGET_BASE_SPEED     = 0.6;   // px/frame at level 1
const NUGGET_SPEED_STEP     = 0.07;  // extra px/frame per level
const NUGGET_ZIG_SPEED      = 1.5;   // horizontal zig-zag px/frame at level 1
const NUGGET_ZIG_STEP       = 0.04;  // extra zig-zag speed per level

// Rare gambusino
const RARE_CHANCE    = 0.05;  // base probability of rare spawn (5%)
const RARE_HP        = 3;     // hits required to kill rare
const NORMAL_POINTS  = 10;    // base points for normal gambusino
const RARE_POINTS    = 50;    // base points for rare gambusino

// Shoot cooldown
const BASE_SHOOT_COOLDOWN = 400;  // ms at level 1
const MIN_SHOOT_COOLDOWN  = 250;  // ms floor at high levels

// Combo system
const COMBO_TIMEOUT = 3000;  // ms window between kills to maintain combo

// Power-ups
const POWERUP_DURATION        = 5000;   // ms each power-up lasts
const POWERUP_SPAWN_INTERVAL  = 25000;  // ms between power-up spawns
const POWERUP_PICKUP_LIFETIME = 8000;   // ms the pickup stays on screen if not collected

// Level 30 boss. The fastest regular level (28) falls at ~3.6 px/frame,
// so the boss (0.6 * 7 = 4.2) is genuinely the fastest thing in the game.
const BOSS_SPEED_MULTIPLIER   = 7;     // speed multiplier vs base
const BOSS_ZIG_MULTIPLIER     = 3.0;   // zig-zag multiplier vs base
const BOSS_TARGET             = 40;    // kills required to beat the boss level
const BOSS_SPAWN_INTERVAL     = 350;   // ms between spawns

// Game-over condition: gambusinos allowed to escape *within one level*.
// The counter resets at the start of every level.
const MAX_MISSED = 7;

// Level transition banner
const LEVEL_TRANSITION_MS = 2200;

// Jelly bounce constants
const BOUNCE_PERIOD_MS   = 190;   // ms per bounce oscillation cycle
const BOUNCE_Y_AMPLITUDE = 0.07;  // vertical stretch factor (squash-stretch)
const BOUNCE_X_AMPLITUDE = 0.04;  // horizontal squash factor

// Particle constants
const PARTICLE_GRAVITY   = 0.18;  // downward acceleration per 60 Hz frame
const TRAIL_INTERVAL_MS  = 32;    // ms between bullet trail dots

// Persistence
const RECORD_KEY = 'gambusino.record.v1';

// ============================================================
// Game state
// ============================================================
let torchOn    = false;
let gameActive = false;
let paused     = false;
let score      = 0;
let level      = 1;

let missed          = 0;     // gambusinos that escaped in the current level
let levelKills      = 0;     // kills in current level
let levelTarget     = 0;     // kills needed to complete current level
let levelTransitioning = false;
let transitionLeft  = 0;     // ms left of the "Nível N" banner
let combo           = 0;     // consecutive kills within COMBO_TIMEOUT
let comboMultiplier = 1;     // current score multiplier
let comboLeft       = 0;     // ms left before the combo resets
let lastShotTime    = 0;     // timestamp of last successful shot
let shootCooldown   = 400;   // ms between allowed shots (varies per level)
let activePowerUp   = null;  // { type, left } — currently active power-up
let pickup          = null;  // { el, type, left } — power-up waiting to be collected
let powerUpSpawnClock = POWERUP_SPAWN_INTERVAL;

let levelConfig     = null;  // config of the level being played
let spawnClock      = 0;     // ms until the next gambusino spawns
let spawnedCount    = 0;     // nuggets spawned this level
let levelSpawnTotal = 0;     // total nuggets to spawn this level (for stuck detection)

let particles = [];
let nuggets   = [];
let bullets   = [];

// --- Beam angle state ---
let currentAngle   = 0;    // smoothly interpolated beam rotation angle (degrees)
let targetAngle    = 0;    // target angle (from gyro or auto-sweep)
let hasGyro        = false; // whether a gyroscope is providing data
let sweepClock     = 0;    // ms into the auto-sweep cycle
let rafId          = null;
let lastFrame      = performance.now();

// All game clocks (spawns, combo, power-ups, banners) advance from the frame
// delta inside rafLoop, never from setTimeout/setInterval. That makes pausing,
// backgrounding the app and switching the torch off consistent: when the
// simulation does not run, nothing in the game advances.

function vibrate(pattern) {
  try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) { /* unsupported */ }
}

const hasPowerUp = (type) => activePowerUp !== null && activePowerUp.type === type;

// ============================================================
// Records (localStorage)
// ============================================================
function loadRecord() {
  try {
    const r = JSON.parse(localStorage.getItem(RECORD_KEY) || '{}');
    return { score: r.score | 0, level: r.level | 0 };
  } catch (e) {
    return { score: 0, level: 0 };
  }
}

// Saves the run if it beats the stored record. Returns true on a new score record.
function saveRecord() {
  const prev = loadRecord();
  const next = { score: Math.max(prev.score, score), level: Math.max(prev.level, level) };
  try { localStorage.setItem(RECORD_KEY, JSON.stringify(next)); } catch (e) { /* storage unavailable */ }
  return score > prev.score;
}

function recordLabel() {
  const r = loadRecord();
  return r.score > 0 ? `🏆 Recorde: ${r.score} pts · Nível ${Math.max(r.level, 1)}` : '';
}

function updateRecordTexts() {
  recordStartEl.textContent = recordLabel();
}

// ============================================================
// Screens and buttons
// ============================================================
document.getElementById('creator-continue-btn').addEventListener('click', () => {
  document.getElementById('creator-screen').classList.add('hidden');
  startScreen.classList.remove('hidden');
  introMusic.currentTime = 0;
  introMusic.play().catch(() => {});
});

torchBtn.addEventListener('click', () => {
  if (!gameActive || paused) return;
  torchOn = !torchOn;
  torchBtn.classList.toggle('on', torchOn);
  beam.classList.toggle('active', torchOn);
  if (torchOn) {
    bgMusic.play().catch(() => {});
    gyroHint.classList.add('hidden');
  } else {
    bgMusic.pause();
  }
});

shootBtn.addEventListener('click', () => fireBullet());
pauseBtn.addEventListener('click', () => pauseGame());
document.getElementById('resume-btn').addEventListener('click', () => resumeGame());
document.getElementById('quit-btn').addEventListener('click', () => quitToMenu());

document.getElementById('start-btn').addEventListener('click', async () => {
  await requestGyroPermission();
  startGame();
});
document.getElementById('restart-btn').addEventListener('click', async () => {
  await requestGyroPermission();
  startGame();
});

// ============================================================
// Pause / background handling
// ============================================================
function pauseGame() {
  if (!gameActive || paused) return;
  paused = true;
  pauseScreen.classList.remove('hidden');
  bgMusic.pause();
}

function resumeGame() {
  if (!paused) return;
  paused = false;
  pauseScreen.classList.add('hidden');
  lastFrame = performance.now();
  if (torchOn) bgMusic.play().catch(() => {});
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    introMusic.pause();
    pauseGame();
  } else if (!startScreen.classList.contains('hidden')) {
    introMusic.play().catch(() => {});
  }
});

function quitToMenu() {
  cleanupRun();
  pauseScreen.classList.add('hidden');
  endScreen.classList.add('hidden');
  updateRecordTexts();
  startScreen.classList.remove('hidden');
  introMusic.currentTime = 0;
  introMusic.play().catch(() => {});
}

// ============================================================
// Start / end
// ============================================================
function startGame() {
  score      = 0;
  level      = 1;
  combo      = 0;
  comboLeft  = 0;
  comboMultiplier    = 1;
  levelTransitioning = false;
  transitionLeft     = 0;
  activePowerUp      = null;
  lastShotTime       = 0;
  powerUpSpawnClock  = POWERUP_SPAWN_INTERVAL;
  gameActive = true;
  paused     = false;
  torchOn    = false;

  scoreEl.textContent = '0';
  levelEl.textContent = '1';
  missedEl.style.backgroundColor = '#39ff14';

  startScreen.classList.add('hidden');
  endScreen.classList.add('hidden');
  pauseScreen.classList.add('hidden');
  levelMsg.classList.add('hidden');
  comboDisplayEl.classList.add('hidden');
  powerupIndEl.classList.add('hidden');
  removePickup();

  torchBtn.classList.remove('on');
  beam.classList.remove('active');

  // Show the blinking hint until the torch is turned on
  gyroHint.classList.remove('hidden');
  gyroHint.style.animation = 'none';
  void gyroHint.offsetHeight;
  gyroHint.style.animation = 'blinkHint 1s ease-in-out infinite';

  sweepClock   = 0;
  currentAngle = 0;
  targetAngle  = 0;

  clearNuggets();
  clearBullets();
  clearParticles();

  beginLevel();

  introMusic.pause();
  introMusic.currentTime = 0;

  lastFrame = performance.now();
  if (!rafId) rafLoop();
}

// Stops everything that belongs to a run (shared by game over, victory and quit).
function cleanupRun() {
  gameActive = false;
  paused     = false;
  torchOn    = false;
  torchBtn.classList.remove('on');
  beam.classList.remove('active');

  clearNuggets();
  clearBullets();
  clearParticles();
  removePickup();
  activePowerUp = null;
  levelMsg.classList.add('hidden');
  comboDisplayEl.classList.add('hidden');
  powerupIndEl.classList.add('hidden');
  gyroHint.classList.add('hidden');
  setDarkness();

  bgMusic.pause();
  bgMusic.currentTime = 0;
}

function endGame(reason) {
  if (!gameActive) return; // guard against double-call
  cleanupRun();

  const isNewRecord = saveRecord();

  if (reason === 'miss') {
    endTitle.innerHTML = '👁️ Game Over!';
    endSub.textContent  = 'Os gambusinos escaparam!';
    endDesc.textContent =
      `${missed} gambusinos fugiram pela mina escura no nível ${level}…\nApanhaste ${score} pontos.`;
  } else {
    endTitle.innerHTML = '💀 Nível Falhado!';
    endSub.textContent  = 'Não apanhaste gambusinos suficientes!';
    endDesc.textContent =
      `Apanhaste ${levelKills} de ${levelTarget} gambusinos no nível ${level}.\nTotal: ${score} pontos.`;
  }
  endTitle.classList.add('creepy-shake');
  endTitle.classList.remove('creepy-glow');

  recordEndEl.textContent = isNewRecord ? '🏆 Novo recorde!' : recordLabel();
  endScreen.classList.remove('hidden');
}

function showVictory() {
  if (!gameActive) return;
  cleanupRun();

  const isNewRecord = saveRecord();

  endTitle.innerHTML = 'Apanhaste todos os gambusinos… 👁️';
  endTitle.classList.add('creepy-shake', 'creepy-glow');
  endSub.textContent  = 'ou será que não?';
  endDesc.innerHTML   =
    `<strong>${score}</strong> pontos capturados… por enquanto.<br>` +
    `<em style="font-size:0.85em;color:#888;display:block;margin-top:10px">` +
    `Apanhaste todos os gambusinos... ou será que não? 👁️<br>A mina nunca esquece.</em>`;

  recordEndEl.textContent = isNewRecord ? '🏆 Novo recorde!' : recordLabel();
  endScreen.classList.remove('hidden');
}

// ============================================================
// LEVEL CONFIGURATION — defines difficulty per level
// ============================================================
function getLevelConfig(lvl) {
  // Pattern cycles every 3 levels:
  //   mod 0 → slow + many  (endurance wave)
  //   mod 1 → fast + few   (sniper challenge)
  //   mod 2 → normal baseline
  const pattern = lvl % 3;

  let speed         = NUGGET_BASE_SPEED + (lvl - 1) * NUGGET_SPEED_STEP;
  let zigSpeed      = NUGGET_ZIG_SPEED  + (lvl - 1) * NUGGET_ZIG_STEP;
  let target        = 5 + Math.floor(lvl * 1.5);
  let spawnInterval = Math.max(600, 2500 - lvl * 55);

  if (pattern === 0) {
    speed         *= 0.65;
    zigSpeed      *= 0.8;
    target         = Math.floor(target * 1.4);
    spawnInterval  = Math.max(400, Math.floor(spawnInterval * 0.75));
  } else if (pattern === 1) {
    speed         *= 1.45;
    zigSpeed      *= 1.35;
    target         = Math.max(5, Math.ceil(target * 0.65));
    spawnInterval  = Math.round(spawnInterval * 1.4);
  }

  if (lvl === MAX_LEVELS) {
    speed         = NUGGET_BASE_SPEED * BOSS_SPEED_MULTIPLIER;
    zigSpeed      = NUGGET_ZIG_SPEED  * BOSS_ZIG_MULTIPLIER;
    target        = BOSS_TARGET;
    spawnInterval = BOSS_SPAWN_INTERVAL;
  }

  // Rare gambusinos start appearing from level 5, probability grows
  const rareChance = lvl >= 5
    ? Math.min(0.22, RARE_CHANCE + (lvl - 5) * 0.008)
    : 0;

  // Shoot cooldown decreases with level (faster shooting at higher levels)
  const cooldown = Math.max(MIN_SHOOT_COOLDOWN, BASE_SHOOT_COOLDOWN - (lvl - 1) * 5);

  return { speed, zigSpeed, target, spawnInterval, rareChance, cooldown };
}

// Sets up the current `level` (already assigned) and resets per-level counters.
function beginLevel() {
  levelEl.textContent = level;
  levelKills = 0;
  missed     = 0;
  updateMissedDisplay();

  levelConfig   = getLevelConfig(level);
  shootCooldown = levelConfig.cooldown;
  levelTarget   = levelConfig.target;
  updateProgress();

  startLevelSpawning(levelConfig);
}

// ============================================================
// SPAWN SYSTEM (driven by the frame clock, see tickClocks)
// ============================================================
function startLevelSpawning(config) {
  // Spawn 50% extra beyond the kill target so there are always targets
  // available and to account for gambusinos that escape
  levelSpawnTotal = config.target + Math.ceil(config.target * 0.5);

  // First gambusino appears immediately
  spawnOneNugget(config);
  spawnedCount = 1;
  spawnClock   = config.spawnInterval;
}

function spawnOneNugget(config) {
  const isRare  = Math.random() < config.rareChance;
  const size    = isRare ? RARE_SIZE : NUGGET_SIZE;
  const half    = Math.floor(size / 2);
  const W       = window.innerWidth;
  const margin  = 60;
  const x       = margin + Math.random() * Math.max(0, W - 2 * margin - size);
  const y       = -size;
  const dir     = Math.random() > 0.5 ? 1 : -1;

  const el = document.createElement('div');
  el.className = isRare ? 'nugget rare' : 'nugget';
  if (isRare) { el.style.width = el.style.height = size + 'px'; }
  el.style.left = x + 'px';
  el.style.top  = y + 'px';
  document.getElementById('nuggets-container').appendChild(el);

  const nd = {
    el, x, y,
    vx: config.zigSpeed * (isRare ? 1.5 : 1.0) * dir,
    vy: config.speed    * (isRare ? 1.3 : 1.0),
    bouncePhase: Math.random() * Math.PI * 2,
    isRare,
    hp:   isRare ? RARE_HP : 1,
    size, half,
  };
  nuggets.push(nd);

  if (TAP_TO_KILL) {
    el.addEventListener('click', () => {
      if (!gameActive || paused) return;
      if ((parseFloat(el.style.opacity) || 0) <= 0) return;
      hitNugget(nd);
    });
  }
}

// Advances spawns, combo, power-ups. Only runs while the world is running.
function tickClocks(dt) {
  if (spawnedCount < levelSpawnTotal) {
    spawnClock -= dt;
    if (spawnClock <= 0) {
      spawnOneNugget(levelConfig);
      spawnedCount++;
      spawnClock += levelConfig.spawnInterval;
    }
  }

  if (combo > 0) {
    comboLeft -= dt;
    if (comboLeft <= 0) resetCombo();
  }

  if (activePowerUp) {
    activePowerUp.left -= dt;
    if (activePowerUp.left <= 0) {
      activePowerUp = null;
      powerupIndEl.classList.add('hidden');
    }
  }

  if (pickup) {
    pickup.left -= dt;
    if (pickup.left <= 0) removePickup();
  }

  powerUpSpawnClock -= dt;
  if (powerUpSpawnClock <= 0) {
    powerUpSpawnClock += POWERUP_SPAWN_INTERVAL;
    spawnPowerUp();
  }
}

// ============================================================
// LEVEL TRANSITION
// ============================================================
function transitionToNextLevel() {
  if (levelTransitioning) return;
  levelTransitioning = true;
  clearNuggets();

  if (level >= MAX_LEVELS) {
    showVictory();
    return;
  }

  level++;
  levelEl.textContent = level;

  if (level === MAX_LEVELS) {
    levelMsg.innerHTML =
      '⚠️ NÍVEL FINAL ⚠️<br><span class="level-msg-sub">Que comecem os jogos…</span>';
  } else {
    levelMsg.textContent = 'Nível ' + level;
  }
  levelMsg.classList.remove('hidden');
  levelMsg.style.animation = 'none';
  void levelMsg.offsetHeight;
  levelMsg.style.animation = 'levelMsgAnim 2s ease forwards';

  transitionLeft = LEVEL_TRANSITION_MS;
}

function finishTransition() {
  levelMsg.classList.add('hidden');
  levelTransitioning = false;
  timerBar.style.width = '0%';
  beginLevel();
}

// ============================================================
// HIT / KILL LOGIC
// ============================================================
function hitNugget(nd) {
  nd.hp--;
  if (nd.hp <= 0) {
    killNugget(nd);
  } else {
    damageFeedback(nd);
  }
}

function killNugget(nd) {
  updateCombo();
  const basePoints   = nd.isRare ? RARE_POINTS : NORMAL_POINTS;
  const earnedPoints = basePoints * comboMultiplier;
  score += earnedPoints;
  scoreEl.textContent = score;

  levelKills++;
  updateProgress();
  vibrate(nd.isRare ? [20, 30, 30] : 15);

  if (nd.isRare) {
    createRareParticles(nd.x + nd.half, nd.y + nd.half);
  } else {
    createParticles(nd.x + nd.half, nd.y + nd.half);
  }

  // Death animation then remove
  nd.el.style.opacity   = '';
  nd.el.style.transform = '';
  nd.el.style.filter    = '';
  nd.el.classList.add('caught');
  setTimeout(() => nd.el.remove(), 450);
  nuggets = nuggets.filter(n => n !== nd);

  if (levelKills >= levelTarget && !levelTransitioning) {
    transitionToNextLevel();
  } else {
    checkLevelStuck();
  }
}

function damageFeedback(nd) {
  nd.el.classList.remove('hit-flash');
  void nd.el.offsetHeight;
  nd.el.classList.add('hit-flash');
  setTimeout(() => nd.el.classList.remove('hit-flash'), 220);
  // Rare gambusino accelerates when hit
  if (nd.isRare) {
    nd.vx *= 1.18;
    nd.vy *= 1.1;
  }
}

// ============================================================
// COMBO SYSTEM
// ============================================================
function updateCombo() {
  combo++;
  comboLeft = COMBO_TIMEOUT;
  // 1 kill = x1, 2 kills = x2, 4 kills = x3, 6 kills = x4, 8+ kills = x5
  comboMultiplier = Math.min(5, 1 + Math.floor(combo / 2));
  showComboDisplay();
}

function resetCombo() {
  combo           = 0;
  comboLeft       = 0;
  comboMultiplier = 1;
  comboDisplayEl.classList.add('hidden');
}

function showComboDisplay() {
  if (comboMultiplier < 2) return;
  comboValueEl.textContent = 'x' + comboMultiplier;
  comboDisplayEl.classList.remove('hidden');
  comboDisplayEl.style.animation = 'none';
  void comboDisplayEl.offsetHeight;
  comboDisplayEl.style.animation = 'comboPulse 0.3s ease';
}

// ============================================================
// HUD UPDATES
// ============================================================
function updateProgress() {
  progressEl.textContent = levelKills + '/' + levelTarget;
  const pct = levelTarget > 0 ? Math.min(1, levelKills / levelTarget) : 0;
  timerBar.style.width = (pct * 100) + '%';
}

function updateMissedDisplay() {
  const pct = (missed / MAX_MISSED) * 100;
  missedEl.style.width = pct + '%';
  missedEl.setAttribute('aria-valuenow', Math.round(pct));
  if (pct >= 70) {
    missedEl.style.backgroundColor = '#ff4444';
  } else if (pct >= 45) {
    missedEl.style.backgroundColor = '#FFD700';
  } else {
    missedEl.style.backgroundColor = '#39ff14';
  }
}

// ============================================================
// POWER-UP SYSTEM
// ============================================================
const POWERUP_LABELS = {
  multishot: '⚡ Multi-Tiro',
  slowmo:    '🐌 Câmara Lenta',
  supershot: '💥 Super Tiro',
};

function spawnPowerUp() {
  if (pickup) return; // one at a time
  const types = Object.keys(POWERUP_LABELS);
  const type  = types[Math.floor(Math.random() * types.length)];

  const el = document.createElement('div');
  el.className  = 'powerup-pickup';
  el.textContent = POWERUP_LABELS[type];
  el.dataset.type = type;

  const W = window.innerWidth;
  el.style.left = (60 + Math.random() * Math.max(0, W - 220)) + 'px';
  el.style.top  = (90 + Math.random() * (window.innerHeight * 0.45)) + 'px';
  document.body.appendChild(el);

  pickup = { el, type, left: POWERUP_PICKUP_LIFETIME };
  el.addEventListener('click', () => collectPowerUp(type));
}

function removePickup() {
  if (pickup && pickup.el.parentNode) pickup.el.remove();
  pickup = null;
  document.querySelectorAll('.powerup-pickup').forEach(el => el.remove());
}

function collectPowerUp(type) {
  if (!gameActive || paused) return;
  removePickup();
  activePowerUp = { type, left: POWERUP_DURATION };
  powerupIndEl.textContent = POWERUP_LABELS[type] + ' ativo!';
  powerupIndEl.classList.remove('hidden');
  vibrate(25);
}

// ============================================================
// STUCK DETECTION — all spawns exhausted, level not complete
// ============================================================
function checkLevelStuck() {
  if (!gameActive || levelTransitioning || levelKills >= levelTarget) return;
  if (nuggets.length === 0 && spawnedCount >= levelSpawnTotal) {
    endGame('level_failed');
  }
}

// ============================================================
// Particles, bullets and nuggets
// ============================================================
function clearNuggets() {
  nuggets.forEach(nd => nd.el.remove());
  nuggets = [];
}

// Spawn a burst of coloured goo/spark particles at (cx, cy)
function createParticles(cx, cy) {
  const count  = 10;
  const colors = ['#39ff14', '#bf5fff', '#ffff55', '#ffffff', '#00ffcc'];
  for (let i = 0; i < count; i++) {
    const angle       = (i / count) * Math.PI * 2 + Math.random() * 0.6;
    const radialSpeed = 2.5 + Math.random() * 3.5;
    const size  = 4 + Math.random() * 7;
    const color = colors[Math.floor(Math.random() * colors.length)];
    const el    = document.createElement('div');
    el.className = 'particle';
    el.style.cssText =
      `left:${cx}px;top:${cy}px;width:${size}px;height:${size}px;` +
      `background:${color};box-shadow:0 0 ${size}px 2px ${color};`;
    document.body.appendChild(el);
    particles.push({
      el,
      x: cx, y: cy,
      vx: Math.cos(angle) * radialSpeed,
      vy: Math.sin(angle) * radialSpeed,
      life: 1.0,
      decay: 0.028 + Math.random() * 0.018
    });
  }
}

// Bigger explosion burst for rare gambusino death
function createRareParticles(cx, cy) {
  const count  = 22;
  const colors = ['#ff003c', '#ff6600', '#ff0099', '#ffffff', '#ffaa00', '#ff4400'];
  for (let i = 0; i < count; i++) {
    const angle       = (i / count) * Math.PI * 2 + Math.random() * 0.4;
    const radialSpeed = 3.5 + Math.random() * 5.5;
    const size        = 6 + Math.random() * 11;
    const color       = colors[Math.floor(Math.random() * colors.length)];
    const el          = document.createElement('div');
    el.className = 'particle';
    el.style.cssText =
      `left:${cx}px;top:${cy}px;width:${size}px;height:${size}px;` +
      `background:${color};box-shadow:0 0 ${Math.round(size * 1.5)}px 3px ${color};`;
    document.body.appendChild(el);
    particles.push({
      el,
      x: cx, y: cy,
      vx: Math.cos(angle) * radialSpeed,
      vy: Math.sin(angle) * radialSpeed,
      life: 1.0,
      decay: 0.016 + Math.random() * 0.014
    });
  }
}

// f = elapsed time in 60 Hz frames (so behaviour is identical at 60/90/120 Hz)
function updateParticles(f) {
  if (!particles.length) return;
  const surviving = [];
  for (const p of particles) {
    p.life -= p.decay * f;
    if (p.life <= 0) { p.el.remove(); continue; }
    p.x  += p.vx * f;
    p.y  += p.vy * f;
    p.vy += PARTICLE_GRAVITY * f;
    p.el.style.left      = p.x + 'px';
    p.el.style.top       = p.y + 'px';
    p.el.style.opacity   = p.life.toFixed(2);
    p.el.style.transform = `translate(-50%,-50%) scale(${p.life.toFixed(2)})`;
    surviving.push(p);
  }
  particles = surviving;
}

function clearParticles() {
  particles.forEach(p => p.el.remove());
  particles = [];
}

function clearBullets() {
  bullets.forEach(b => b.el.remove());
  bullets = [];
  document.querySelectorAll('.bullet-trail').forEach(el => el.remove());
}

function updateNuggets(f) {
  if (!nuggets.length) return;
  const W = window.innerWidth;
  const H = window.innerHeight;
  const k = f * (hasPowerUp('slowmo') ? 0.4 : 1); // slow motion scales movement only
  const surviving = [];
  let anyEscaped = false;
  for (const nd of nuggets) {
    nd.x += nd.vx * k;
    nd.y += nd.vy * k;
    // Bounce off side walls for zig-zag
    if (nd.x < 0)                { nd.x = 0;             nd.vx =  Math.abs(nd.vx); }
    else if (nd.x > W - nd.size) { nd.x = W - nd.size;   nd.vx = -Math.abs(nd.vx); }
    nd.el.style.left = nd.x + 'px';
    nd.el.style.top  = nd.y + 'px';
    if (nd.y > H) {
      // Gambusino escaped
      nd.el.remove();
      anyEscaped = true;
      missed++;
      updateMissedDisplay();
      vibrate(40);
      if (missed >= MAX_MISSED) {
        endGame('miss');
        return;
      }
    } else {
      surviving.push(nd);
    }
  }
  nuggets = surviving;
  if (anyEscaped) checkLevelStuck();
}

function fireBullet() {
  if (!gameActive || paused || !torchOn) return;

  const now = performance.now();
  if (now - lastShotTime < shootCooldown) {
    // Cooldown not ready — shake the button as feedback
    shootBtn.classList.remove('cooldown-reject');
    void shootBtn.offsetHeight;
    shootBtn.classList.add('cooldown-reject');
    setTimeout(() => shootBtn.classList.remove('cooldown-reject'), 220);
    return;
  }
  lastShotTime = now;

  // Flash beam and button on fire
  shootBtn.classList.remove('shoot-flash');
  void shootBtn.offsetHeight;
  shootBtn.classList.add('shoot-flash');
  setTimeout(() => shootBtn.classList.remove('shoot-flash'), 150);
  beam.style.opacity = '1';
  setTimeout(() => { beam.style.opacity = ''; }, 100);

  const apexX = window.innerWidth  / 2;
  const apexY = window.innerHeight - BEAM_APEX_Y_OFFSET;
  const isSuperShot = hasPowerUp('supershot');

  // Multi-shot: 5 bullets at spread angles; otherwise single bullet
  const spreads = hasPowerUp('multishot') ? [-20, -10, 0, 10, 20] : [0];

  for (const spread of spreads) {
    const r  = (currentAngle + spread) * Math.PI / 180;
    const el = document.createElement('div');
    el.className = 'bullet';
    el.style.left = apexX + 'px';
    el.style.top  = apexY + 'px';
    document.body.appendChild(el);
    bullets.push({
      x: apexX, y: apexY,
      vx: BULLET_SPEED * Math.sin(r),
      vy: -BULLET_SPEED * Math.cos(r),
      trailClock: 0,
      el, isSuperShot
    });
  }
}

function updateBullets(f, dt) {
  if (!bullets.length) return;
  const W = window.innerWidth;
  const H = window.innerHeight;
  const surviving = [];
  for (const b of bullets) {
    b.x += b.vx * f;
    b.y += b.vy * f;
    if (b.x < 0 || b.x > W || b.y < 0 || b.y > H) {
      b.el.remove();
      continue;
    }
    b.el.style.left = b.x + 'px';
    b.el.style.top  = b.y + 'px';

    // Fading trail, emitted on a fixed time interval (not per frame)
    b.trailClock += dt;
    if (b.trailClock >= TRAIL_INTERVAL_MS) {
      b.trailClock -= TRAIL_INTERVAL_MS;
      const trail = document.createElement('div');
      trail.className = 'bullet-trail';
      const ts = 5 + Math.random() * 4;
      trail.style.cssText = `left:${b.x}px;top:${b.y}px;width:${ts}px;height:${ts}px;`;
      document.body.appendChild(trail);
      setTimeout(() => trail.remove(), 180);
    }

    let destroyBullet = false;
    // Iterate backwards: hitNugget() may remove from `nuggets` via killNugget()
    for (let i = nuggets.length - 1; i >= 0; i--) {
      const nd = nuggets[i];
      if (Math.hypot(b.x - (nd.x + nd.half), b.y - (nd.y + nd.half)) < nd.half) {
        hitNugget(nd);
        if (!b.isSuperShot) {
          // Normal bullet stops on first hit; super-shot continues through
          destroyBullet = true;
          break;
        }
      }
    }
    if (destroyBullet) {
      b.el.remove();
    } else {
      surviving.push(b);
    }
  }
  bullets = surviving;
}

// ============================================================
// Main loop
// ============================================================
function rafLoop() {
  rafId = requestAnimationFrame(rafLoop);

  const now = performance.now();
  const dt  = Math.min(now - lastFrame, MAX_DT);
  lastFrame = now;

  if (!gameActive || paused) return;

  const f = dt / FRAME_MS;

  if (hasGyro) {
    // Smooth interpolation toward gyroscope angle
    currentAngle += (targetAngle - currentAngle) * (1 - Math.pow(1 - LERP_FACTOR, f));
  } else {
    // Fallback: automatic horizontal sweep via sine wave
    sweepClock = (sweepClock + dt) % BEAM_SWEEP_PERIOD;
    const t = sweepClock / BEAM_SWEEP_PERIOD;
    const sweepAngle = Math.sin(t * Math.PI * 2 - Math.PI / 2) * MAX_SWEEP_ANGLE;
    currentAngle += (sweepAngle - currentAngle) * (1 - Math.pow(1 - LERP_FACTOR, f));
  }

  updateBullets(f, dt);
  updateParticles(f);

  if (levelTransitioning) {
    transitionLeft -= dt;
    if (transitionLeft <= 0) finishTransition();
    return;
  }

  // With the torch off the cave is frozen: nothing spawns, moves or expires.
  if (!torchOn) return;

  tickClocks(dt);
  updateNuggets(f);
  if (!gameActive) return; // updateNuggets may have ended the game
  updateBeamVisual();
  checkLight();
}

function setDarkness() {
  // The triangular beam provides all illumination; keep background fully dark
  darkness.style.background = 'rgba(0,0,0,0.96)';
}

function updateBeamVisual() {
  // Subtle random tremor adds tension to the torch beam
  const tremor = (Math.random() - 0.5) * 0.5;
  beam.style.transform = `rotate(${currentAngle + tremor}deg)`;
}

function checkLight() {
  const apexX     = window.innerWidth  / 2;
  const apexY     = window.innerHeight - BEAM_APEX_Y_OFFSET;
  const halfW     = window.innerWidth  * BEAM_HALF_VW;
  const beamH     = window.innerHeight - BEAM_APEX_Y_OFFSET;
  const halfAngle = Math.atan2(halfW, beamH) * (180 / Math.PI);

  // Current time used for per-nugget jelly bounce
  const now = performance.now();

  nuggets.forEach(nd => {
    // Use each nugget's own half-size for correct centring
    const nx = nd.x + nd.half;
    const ny = nd.y + nd.half;
    const dx = nx - apexX;
    const dy = ny - apexY;

    // Jelly squash-stretch: Y stretches while X squashes
    const bounceT = now / BOUNCE_PERIOD_MS + nd.bouncePhase;
    const bounceY = 1 + BOUNCE_Y_AMPLITUDE * Math.sin(bounceT);
    const bounceX = 1 - BOUNCE_X_AMPLITUDE * Math.sin(bounceT);

    // Nugget must be above the apex (beam only points upward)
    if (dy >= 0) {
      nd.el.style.opacity       = '0';
      nd.el.style.pointerEvents = 'none';
      nd.el.style.transform     = `scale(${(0.7 * bounceX).toFixed(3)}, ${(0.7 * bounceY).toFixed(3)})`;
      nd.el.style.filter        = '';
      return;
    }

    // Angle from apex to nugget measured from "pointing straight up"
    const nuggetAngle = Math.atan2(dx, -dy) * (180 / Math.PI);
    const angleDiff   = Math.abs(nuggetAngle - currentAngle);
    const intensity   = Math.max(0, Math.min(1, 1 - angleDiff / halfAngle));
    const baseScale   = 0.7 + 0.3 * intensity;

    nd.el.style.opacity       = intensity;
    nd.el.style.pointerEvents = (TAP_TO_KILL && intensity > 0) ? 'auto' : 'none';
    nd.el.style.transform     = `scale(${(baseScale * bounceX).toFixed(3)}, ${(baseScale * bounceY).toFixed(3)})`;

    if (intensity > 0) {
      const brightness = (1 + 1.5 * intensity).toFixed(2);
      const glow1      = Math.round(28 * intensity);
      const glow2      = Math.round(10 * intensity);
      const alpha      = intensity.toFixed(2);
      if (nd.isRare) {
        nd.el.style.filter = `brightness(${brightness}) drop-shadow(0 0 ${glow1}px rgba(255,50,0,${alpha})) drop-shadow(0 0 ${glow2}px rgba(255,100,200,${alpha}))`;
      } else {
        nd.el.style.filter = `brightness(${brightness}) drop-shadow(0 0 ${glow1}px rgba(255,215,0,${alpha})) drop-shadow(0 0 ${glow2}px rgba(160,255,100,${alpha}))`;
      }
    } else {
      nd.el.style.filter = '';
    }
  });
}

// ============================================================
// Gyroscope
// ============================================================
function onDeviceOrientation(e) {
  if (e.gamma === null) return;
  hasGyro = true;
  // gamma: left/right tilt (-90 to +90). Clamp to a playable range.
  targetAngle = Math.max(-MAX_GYRO_ANGLE, Math.min(MAX_GYRO_ANGLE, e.gamma));
}

async function requestGyroPermission() {
  if (typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function') {
    // iOS 13+ requires an explicit user-gesture permission request
    try {
      const perm = await DeviceOrientationEvent.requestPermission();
      if (perm === 'granted') {
        window.addEventListener('deviceorientation', onDeviceOrientation, { passive: true });
      }
    } catch (e) { /* silently ignore — will fall back to auto-sweep */ }
  }
}

// Non-iOS: attach gyro listener immediately
if (typeof DeviceOrientationEvent !== 'undefined' &&
    typeof DeviceOrientationEvent.requestPermission !== 'function') {
  window.addEventListener('deviceorientation', onDeviceOrientation, { passive: true });
}

// ============================================================
// Ambience: stars and fog
// ============================================================
function initStars(containerId, count) {
  const container = document.getElementById(containerId);
  if (!container) return;
  for (let i = 0; i < count; i++) {
    const s = document.createElement('div');
    const size = 1 + Math.random() * 2;
    s.style.cssText = [
      `position:absolute`,
      `left:${Math.random() * 100}%`,
      `top:${Math.random() * 100}%`,
      `width:${size}px`,
      `height:${size}px`,
      `background:#fff`,
      `border-radius:50%`,
      `animation:twinkle ${1.5 + Math.random() * 3}s ${Math.random() * 3}s infinite alternate`
    ].join(';');
    container.appendChild(s);
  }
}

initStars('stars',  60);
initStars('stars2', 80);
initStars('stars3', 60);

// Atmospheric fog wisps drifting across the cave
function initFog() {
  const cave = document.getElementById('cave');
  cave.querySelectorAll('.fog').forEach(el => el.remove());

  const configs = [
    { color: 'rgba(0,80,20,0.07)',   size: 320, topPct: 30, duration: 28, delay: 0    },
    { color: 'rgba(55,0,80,0.055)',  size: 260, topPct: 55, duration: 22, delay: -10  },
    { color: 'rgba(10,20,60,0.05)', size: 400, topPct: 20, duration: 34, delay: -18  }
  ];
  configs.forEach(cfg => {
    const fog = document.createElement('div');
    fog.className = 'fog';
    fog.style.cssText =
      `width:${cfg.size}px;height:${cfg.size * 0.38}px;` +
      `left:-${cfg.size}px;top:${cfg.topPct}%;` +
      `background:${cfg.color};` +
      `filter:blur(${38 + Math.random() * 16}px);` +
      `animation:fogDrift ${cfg.duration}s ${cfg.delay}s linear infinite;`;
    cave.appendChild(fog);
  });
}

initFog();

// Initialise darkness to full black and show the stored record before the game starts
setDarkness();
updateRecordTexts();
