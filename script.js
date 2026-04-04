'use strict';

// --- DOM refs ---
const beam        = document.getElementById('beam');
const darkness    = document.getElementById('darkness');
const torchBtn    = document.getElementById('torch-btn');
const shootBtn    = document.getElementById('shoot-btn');
const scoreEl     = document.getElementById('score');
const levelEl     = document.getElementById('level-display');
const timerBar    = document.getElementById('timer-bar');
const gyroHint    = document.getElementById('gyro-hint');
const startScreen = document.getElementById('start-screen');
const endScreen   = document.getElementById('end-screen');
const endTitle    = document.getElementById('end-title');
const endSub      = document.getElementById('end-sub');
const endDesc     = document.getElementById('end-desc');

const bgMusic        = document.getElementById('bg-music');
// New HUD refs
const progressEl     = document.getElementById('progress-display');
const missedEl       = document.getElementById('missed-display');
const comboDisplayEl = document.getElementById('combo-display');
const comboValueEl   = document.getElementById('combo-value');
const powerupIndEl   = document.getElementById('powerup-indicator');

// --- Game state ---
let torchOn    = false;
let gameActive = false;
let score      = 0;
let level      = 1;
let timerHandle = null; // kept for legacy clearInterval safety
let timeLeft   = 0;     // unused — level progression is now kill-count based

// --- New gameplay state ---
let missed          = 0;     // gambusinos that escaped this run
let levelKills      = 0;     // kills in current level
let levelTarget     = 0;     // kills needed to complete current level
let levelTransitioning = false;
let combo           = 0;     // consecutive kills within COMBO_TIMEOUT
let comboMultiplier = 1;     // current score multiplier
let comboTimerId    = null;  // timeout handle for combo reset
let lastShotTime    = 0;     // timestamp of last successful shot
let shootCooldown   = 400;   // ms between allowed shots (varies per level)
let activePowerUp   = null;  // { type, endTime } — currently active power-up
let spawnTimer      = null;  // interval handle for continuous nugget spawning
let spawnedCount    = 0;     // nuggets spawned this level
let powerUpTimerId    = null;
let powerUpSpawnTimer = null;

// --- Particles state (hit effects) ---
let particles = [];

// ============================================================
// GAMEPLAY TUNING — easy-to-adjust constants
// ============================================================
const LEVEL_DURATION        = 30000; // ms (legacy, kept for safety)
const BEAM_SWEEP_PERIOD     = 3500;  // ms — duration of one full left-right-left sweep cycle
const MAX_SWEEP_ANGLE       = 65;    // degrees — max auto-sweep angle (no gyro)
const MAX_GYRO_ANGLE        = 75;    // degrees — gyroscope gamma clamp
const LERP_FACTOR           = 0.12;  // beam angle smoothing
const BEAM_HALF_VW          = 0.25;  // half-width of beam (matches CSS left:-25vw)
const NUGGET_SIZE            = 135;  // normal gambusino size (px)
const RARE_SIZE              = 160;  // rare gambusino size (px)
const NUGGET_HALF            = Math.floor(NUGGET_SIZE / 2);
const NUGGET_MIN_DIST        = 150;  // min spawn distance between nuggets
const NUGGET_MAX_ATTEMPTS    = 100;  // max placement retries
const EXCELLENT_SCORE       = 200;   // score for "excelente" message
const GOOD_SCORE            = 80;    // score for "bom" message
const BULLET_SPEED          = 12;    // px per frame
const BEAM_APEX_Y_OFFSET    = 46;    // px from bottom to torch centre
const MAX_LEVELS            = 30;    // total levels

// Movement base values (progressively increase per level)
const NUGGET_BASE_SPEED     = 0.6;   // px/frame at level 1
const NUGGET_SPEED_STEP     = 0.07;  // extra px/frame per level
const NUGGET_ZIG_SPEED      = 1.5;   // horizontal zig-zag px/frame at level 1
const NUGGET_ZIG_STEP       = 0.04;  // extra zig-zag speed per level
const NUGGET_SPAWN_STAGGER  = 120;   // legacy (unused in new spawn system)

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
// Power-up pickup lifetime: auto-removed if player doesn't collect it in time
// Intentionally shorter than POWERUP_SPAWN_INTERVAL so the screen stays uncluttered
const POWERUP_PICKUP_LIFETIME = 8000;   // ms

// Level 30 boss: everything maxed out
const BOSS_SPEED_MULTIPLIER   = 3.5;   // speed multiplier vs base
const BOSS_ZIG_MULTIPLIER     = 3.0;   // zig-zag multiplier vs base
const BOSS_TARGET             = 40;    // kills required to beat the boss level
const BOSS_SPAWN_INTERVAL     = 350;   // ms between spawns

// Game-over condition
const MAX_MISSED = 7;  // escaped gambusinos allowed before game over

// [CREEPY] Jelly bounce constants
const BOUNCE_PERIOD_MS   = 190;   // ms per bounce oscillation cycle
const BOUNCE_Y_AMPLITUDE = 0.07;  // vertical stretch factor (squash-stretch)
const BOUNCE_X_AMPLITUDE = 0.04;  // horizontal squash factor

// [CREEPY] Particle constants
const PARTICLE_GRAVITY   = 0.18;  // downward acceleration per frame for hit particles

// --- Beam angle state ---
let currentAngle   = 0;    // smoothly interpolated beam rotation angle (degrees)
let targetAngle    = 0;    // target angle (from gyro or auto-sweep)
let hasGyro        = false; // whether a gyroscope is providing data
let sweepStartTime = null;
let rafId          = null;

// --- Nuggets ---
let nuggets = [];

// --- Bullets ---
let bullets = [];

// --- Torch toggle ---
torchBtn.addEventListener('click', () => {
  if (!gameActive) return;
  torchOn = !torchOn;
  torchBtn.classList.toggle('on', torchOn);
  beam.classList.toggle('active', torchOn);
  if (torchOn) {
    bgMusic.play().catch(() => {});
  } else {
    bgMusic.pause();
  }
});

// --- Shoot button ---
shootBtn.addEventListener('click', () => fireBullet());

// --- Start / Restart ---
document.getElementById('start-btn').addEventListener('click', async () => {
  await requestGyroPermission();
  startGame();
});
document.getElementById('restart-btn').addEventListener('click', async () => {
  await requestGyroPermission();
  startGame();
});

function startGame() {
  // Reset core state
  score      = 0;
  level      = 1;
  missed     = 0;
  levelKills = 0;
  combo      = 0;
  comboMultiplier   = 1;
  levelTransitioning = false;
  activePowerUp     = null;
  lastShotTime      = 0;
  gameActive = true;
  torchOn    = true;

  scoreEl.textContent = '0';
  levelEl.textContent = '1';
  missedEl.textContent = '❌ 0/' + MAX_MISSED;

  startScreen.classList.add('hidden');
  endScreen.classList.add('hidden');
  comboDisplayEl.classList.add('hidden');
  powerupIndEl.classList.add('hidden');
  document.querySelectorAll('.powerup-pickup').forEach(el => el.remove());

  torchBtn.classList.add('on');
  beam.classList.add('active');

  // Reset hint animation
  gyroHint.style.animation = 'none';
  void gyroHint.offsetHeight;
  gyroHint.style.animation = 'fadeHint 4s ease forwards';

  sweepStartTime = null;
  currentAngle   = 0;
  targetAngle    = 0;

  clearNuggets();
  clearBullets();
  clearParticles();
  clearTimeout(comboTimerId);
  clearTimeout(powerUpTimerId);
  clearInterval(spawnTimer);
  clearInterval(powerUpSpawnTimer);

  // Initialise first level
  const config = getLevelConfig(1);
  shootCooldown = config.cooldown;
  levelTarget   = config.target;
  updateProgress();
  timerBar.style.background = 'linear-gradient(to right, #39ff14, #FFD700)';
  timerBar.style.width = '0%';

  startLevelSpawning(config);
  startPowerUpSpawning();

  bgMusic.currentTime = 0;
  bgMusic.play().catch(() => {});

  if (!rafId) rafLoop();
}

function endGame(reason) {
  if (!gameActive) return; // guard against double-call
  gameActive = false;
  torchOn    = false;
  torchBtn.classList.remove('on');
  beam.classList.remove('active');

  clearInterval(spawnTimer);
  clearInterval(powerUpSpawnTimer);
  clearInterval(timerHandle); // legacy safety
  clearTimeout(powerUpTimerId);
  clearTimeout(comboTimerId);
  clearNuggets();
  clearBullets();
  clearParticles();
  setDarkness();
  document.querySelectorAll('.powerup-pickup').forEach(el => el.remove());
  comboDisplayEl.classList.add('hidden');
  powerupIndEl.classList.add('hidden');

  bgMusic.pause();
  bgMusic.currentTime = 0;

  if (reason === 'miss') {
    // Game over — too many escaped
    endTitle.innerHTML = '👁️ Game Over!';
    endTitle.classList.add('creepy-shake');
    endTitle.classList.remove('creepy-glow');
    endSub.textContent  = 'Os gambusinos escaparam!';
    endDesc.textContent =
      `${missed} gambusinos fugiram pela mina escura…\nApanhaste ${score} pontos até ao nível ${level}.`;
  } else {
    // Generic end (shouldn't normally be reached in kill-count mode)
    const msg = score > EXCELLENT_SCORE ? 'Excelente trabalho!'
              : score > GOOD_SCORE      ? 'Bom esforço!'
              : 'A mina guarda os seus segredos…';
    endTitle.textContent = 'Fim da Jornada';
    endTitle.classList.remove('creepy-shake', 'creepy-glow');
    endSub.textContent   = 'Até ao próximo confronto';
    endDesc.textContent  =
      `Apanhaste ${score} pontos até ao nível ${level}. ${msg}`;
  }

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

  let speed        = NUGGET_BASE_SPEED + (lvl - 1) * NUGGET_SPEED_STEP;
  let zigSpeed     = NUGGET_ZIG_SPEED  + (lvl - 1) * NUGGET_ZIG_STEP;
  let target       = 5 + Math.floor(lvl * 1.5);
  let spawnInterval = Math.max(600, 2500 - lvl * 55);

  if (pattern === 0) {
    // Slow + many: more targets, faster spawning, gentler movement
    speed         *= 0.65;
    zigSpeed      *= 0.8;
    target         = Math.floor(target * 1.4);
    spawnInterval  = Math.max(400, Math.floor(spawnInterval * 0.75));
  } else if (pattern === 1) {
    // Fast + few: fewer but very aggressive
    speed         *= 1.45;
    zigSpeed      *= 1.35;
    target         = Math.max(5, Math.ceil(target * 0.65));
    spawnInterval  = Math.round(spawnInterval * 1.4);
  }

  // Level 30 boss: everything maxed out
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

// ============================================================
// CONTINUOUS SPAWN SYSTEM
// ============================================================
function startLevelSpawning(config) {
  clearInterval(spawnTimer);
  spawnedCount = 0;
  // Spawn 50% extra beyond the kill target so there are always targets available
  // and to account for gambusinos that escape without being killed
  const totalToSpawn = config.target + Math.ceil(config.target * 0.5);

  // First gambusino appears immediately
  spawnOneNugget(config);
  spawnedCount++;

  spawnTimer = setInterval(() => {
    if (!gameActive || levelTransitioning) return;
    if (spawnedCount >= totalToSpawn) { clearInterval(spawnTimer); return; }
    spawnOneNugget(config);
    spawnedCount++;
  }, config.spawnInterval);
}

function spawnOneNugget(config) {
  const isRare  = Math.random() < config.rareChance;
  const size    = isRare ? RARE_SIZE : NUGGET_SIZE;
  const half    = Math.floor(size / 2);
  const W       = window.innerWidth;
  const margin  = 60;
  const x       = margin + Math.random() * (W - 2 * margin - size);
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

  el.addEventListener('click', () => {
    if ((parseFloat(el.style.opacity) || 0) <= 0) return;
    hitNugget(nd);
  });
}

// ============================================================
// LEVEL TRANSITION
// ============================================================
function transitionToNextLevel() {
  if (levelTransitioning) return;
  levelTransitioning = true;
  clearInterval(spawnTimer);
  clearNuggets();

  if (level >= MAX_LEVELS) {
    showVictory();
    return;
  }

  level++;
  levelEl.textContent = level;

  const levelMsg = document.getElementById('level-msg');
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
  setTimeout(() => levelMsg.classList.add('hidden'), 2000);

  setTimeout(() => {
    if (!gameActive) return;
    levelKills         = 0;
    levelTransitioning = false;
    const config = getLevelConfig(level);
    shootCooldown = config.cooldown;
    levelTarget   = config.target;
    updateProgress();
    timerBar.style.width = '0%';
    startLevelSpawning(config);
  }, 2200);
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
  // Update combo and calculate points
  updateCombo();
  const basePoints   = nd.isRare ? RARE_POINTS : NORMAL_POINTS;
  const earnedPoints = basePoints * comboMultiplier;
  score += earnedPoints;
  scoreEl.textContent = score;

  // Level progress
  levelKills++;
  updateProgress();

  // Particles
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

  // Level complete?
  if (levelKills >= levelTarget && !levelTransitioning) {
    transitionToNextLevel();
  }
}

function damageFeedback(nd) {
  // Visual flash
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
  clearTimeout(comboTimerId);
  combo++;
  // Combo multiplier progression: every 2 consecutive kills adds +1x (capped at x5)
  // 1 kill = x1, 2 kills = x2, 4 kills = x3, 6 kills = x4, 8+ kills = x5
  comboMultiplier = Math.min(5, 1 + Math.floor(combo / 2));
  showComboDisplay();
  comboTimerId = setTimeout(resetCombo, COMBO_TIMEOUT);
}

function resetCombo() {
  combo           = 0;
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
  missedEl.textContent = '❌ ' + missed + '/' + MAX_MISSED;
  // Flash red when approaching limit
  if (missed >= MAX_MISSED - 2) {
    missedEl.style.color = '#ff1111';
  }
}

// ============================================================
// POWER-UP SYSTEM
// ============================================================
function startPowerUpSpawning() {
  clearInterval(powerUpSpawnTimer);
  powerUpSpawnTimer = setInterval(() => {
    if (gameActive && !levelTransitioning) spawnPowerUp();
  }, POWERUP_SPAWN_INTERVAL);
}

function spawnPowerUp() {
  if (document.querySelector('.powerup-pickup')) return; // one at a time
  const types  = ['multishot', 'slowmo', 'supershot'];
  const labels = { multishot: '⚡ Multi-Tiro', slowmo: '🐌 Câmara Lenta', supershot: '💥 Super Tiro' };
  const type   = types[Math.floor(Math.random() * types.length)];

  const el = document.createElement('div');
  el.className  = 'powerup-pickup';
  el.textContent = labels[type];
  el.dataset.type = type;

  const W = window.innerWidth;
  el.style.left = (60 + Math.random() * (W - 220)) + 'px';
  el.style.top  = (90 + Math.random() * (window.innerHeight * 0.45)) + 'px';
  document.body.appendChild(el);

  el.addEventListener('click', () => collectPowerUp(type, el));
  // Auto-remove after POWERUP_PICKUP_LIFETIME if the player doesn't collect it
  setTimeout(() => { if (el.parentNode) el.remove(); }, POWERUP_PICKUP_LIFETIME);
}

function collectPowerUp(type, el) {
  if (el.parentNode) el.remove();
  activePowerUp = { type, endTime: performance.now() + POWERUP_DURATION };
  const labels = { multishot: '⚡ Multi-Tiro ativo!', slowmo: '🐌 Câmara Lenta ativa!', supershot: '💥 Super Tiro ativo!' };
  powerupIndEl.textContent = labels[type];
  powerupIndEl.classList.remove('hidden');
  clearTimeout(powerUpTimerId);
  powerUpTimerId = setTimeout(() => {
    activePowerUp = null;
    powerupIndEl.classList.add('hidden');
  }, POWERUP_DURATION);
}

// ============================================================
// GAME OVER (too many escaped)
// ============================================================
function gameOverByMiss() {
  endGame('miss');
}

// ============================================================
// NUGGET UTILITIES
// ============================================================
function isTooClose(x, y, placed) {
  return placed.some(p => Math.hypot(x - p.x, y - p.y) < NUGGET_MIN_DIST);
}

function clearNuggets() {
  nuggets.forEach(nd => nd.el.remove());
  nuggets = [];
}

// [CREEPY] Spawn a burst of coloured goo/spark particles at (cx, cy)
function createParticles(cx, cy) {
  const count  = 10;
  const colors = ['#39ff14', '#bf5fff', '#ffff55', '#ffffff', '#00ffcc'];
  for (let i = 0; i < count; i++) {
    const angle      = (i / count) * Math.PI * 2 + Math.random() * 0.6;
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

// [CREEPY] Bigger explosion burst for rare gambusino death
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

// [CREEPY] Update particle positions and fade — called each rAF frame
function updateParticles() {
  if (!particles.length) return;
  const surviving = [];
  for (const p of particles) {
    p.life -= p.decay;
    if (p.life <= 0) { p.el.remove(); continue; }
    p.x  += p.vx;
    p.y  += p.vy;
    p.vy += PARTICLE_GRAVITY; // apply gravity to particles
    p.el.style.left      = p.x + 'px';
    p.el.style.top       = p.y + 'px';
    p.el.style.opacity   = p.life.toFixed(2);
    p.el.style.transform = `translate(-50%,-50%) scale(${p.life.toFixed(2)})`;
    surviving.push(p);
  }
  particles = surviving;
}

// [CREEPY] Clear any in-flight particles (call on game end / restart)
function clearParticles() {
  particles.forEach(p => p.el.remove());
  particles = [];
}

function clearBullets() {
  bullets.forEach(b => b.el.remove());
  bullets = [];
  // [CREEPY] Remove any lingering trail elements
  document.querySelectorAll('.bullet-trail').forEach(el => el.remove());
}

function updateNuggets() {
  if (!nuggets.length) return;
  const W = window.innerWidth;
  const H = window.innerHeight;
  // Slow motion power-up: multiply velocity by 0.4 while active
  const slowFactor = (activePowerUp && activePowerUp.type === 'slowmo'
                      && performance.now() < activePowerUp.endTime) ? 0.4 : 1;
  const surviving = [];
  for (const nd of nuggets) {
    nd.x += nd.vx * slowFactor;
    nd.y += nd.vy * slowFactor;
    // Bounce off side walls for zig-zag
    if (nd.x < 0)              { nd.x = 0;           nd.vx =  Math.abs(nd.vx); }
    else if (nd.x > W - nd.size) { nd.x = W - nd.size; nd.vx = -Math.abs(nd.vx); }
    nd.el.style.left = nd.x + 'px';
    nd.el.style.top  = nd.y + 'px';
    if (nd.y > H) {
      // Gambusino escaped — count as failure (not during level transition)
      nd.el.remove();
      if (!levelTransitioning) {
        missed++;
        updateMissedDisplay();
        if (missed >= MAX_MISSED) {
          gameOverByMiss();
          return;
        }
      }
    } else {
      surviving.push(nd);
    }
  }
  nuggets = surviving;
}

function fireBullet() {
  if (!gameActive || !torchOn) return;

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
  const isSuperShot = activePowerUp && activePowerUp.type === 'supershot'
                      && now < activePowerUp.endTime;

  // Multi-shot: 5 bullets at spread angles; otherwise single bullet
  const spreads = (activePowerUp && activePowerUp.type === 'multishot'
                   && now < activePowerUp.endTime)
    ? [-20, -10, 0, 10, 20]
    : [0];

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
      el, isSuperShot
    });
  }
}

function updateBullets() {
  if (!bullets.length) return;
  const W = window.innerWidth;
  const H = window.innerHeight;
  const surviving = [];
  for (const b of bullets) {
    b.x += b.vx;
    b.y += b.vy;
    if (b.x < 0 || b.x > W || b.y < 0 || b.y > H) {
      b.el.remove();
      continue;
    }
    b.el.style.left = b.x + 'px';
    b.el.style.top  = b.y + 'px';

    // [CREEPY] Emit a fading trail element every 2 frames
    b.trailFrame = (b.trailFrame || 0) + 1;
    if (b.trailFrame % 2 === 0) {
      const trail = document.createElement('div');
      trail.className = 'bullet-trail';
      const ts = 5 + Math.random() * 4;
      trail.style.cssText = `left:${b.x}px;top:${b.y}px;width:${ts}px;height:${ts}px;`;
      document.body.appendChild(trail);
      setTimeout(() => trail.remove(), 180);
    }

    let destroyBullet = false;
    // Iterate backwards: hitNugget() may splice from the nuggets array via killNugget(),
    // so reverse iteration avoids index skipping after removal
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

function showVictory() {
  if (!gameActive) return;
  gameActive = false;
  torchOn    = false;
  torchBtn.classList.remove('on');
  beam.classList.remove('active');

  sweepStartTime = null;
  clearInterval(spawnTimer);
  clearInterval(powerUpSpawnTimer);
  clearTimeout(powerUpTimerId);
  clearTimeout(comboTimerId);
  clearNuggets();
  clearBullets();
  clearParticles();
  clearInterval(timerHandle);
  setDarkness();
  document.querySelectorAll('.powerup-pickup').forEach(el => el.remove());
  comboDisplayEl.classList.add('hidden');
  powerupIndEl.classList.add('hidden');

  bgMusic.pause();
  bgMusic.currentTime = 0;

  // [CREEPY] Level 30 victory — unsettling message
  endTitle.innerHTML = 'Apanhaste todos os gambusinos… 👁️';
  endTitle.classList.add('creepy-shake', 'creepy-glow');
  endSub.textContent  = 'ou será que não?';
  endDesc.innerHTML   =
    `<strong>${score}</strong> pontos capturados… por enquanto.<br>` +
    `<em style="font-size:0.85em;color:#888;display:block;margin-top:10px">` +
    `Apanhaste todos os gambusinos... ou será que não? 👁️<br>A mina nunca esquece.</em>`;

  endScreen.classList.remove('hidden');
}

// --- rAF animation loop ---
function rafLoop() {
  rafId = requestAnimationFrame(rafLoop);

  if (!gameActive) return;

  const now = performance.now();

  if (hasGyro) {
    // Smooth interpolation toward gyroscope angle
    currentAngle += (targetAngle - currentAngle) * LERP_FACTOR;
  } else {
    // Fallback: automatic horizontal sweep via sine wave
    if (sweepStartTime === null) sweepStartTime = now;
    const t = ((now - sweepStartTime) % BEAM_SWEEP_PERIOD) / BEAM_SWEEP_PERIOD;
    const sweepAngle = Math.sin(t * Math.PI * 2 - Math.PI / 2) * MAX_SWEEP_ANGLE;
    currentAngle += (sweepAngle - currentAngle) * LERP_FACTOR;
  }

  updateBullets();
  updateParticles(); // [CREEPY] update hit particles — runs even when torch is off

  if (!torchOn) return;

  updateNuggets();
  updateBeamVisual();
  checkLight();
}

function setDarkness() {
  // The triangular beam provides all illumination; keep background fully dark
  darkness.style.background = 'rgba(0,0,0,0.96)';
}

function updateBeamVisual() {
  // [CREEPY] Subtle random tremor adds tension to the torch beam
  const tremor = (Math.random() - 0.5) * 0.5;
  beam.style.transform = `rotate(${currentAngle + tremor}deg)`;
}

function checkLight() {
  const apexX     = window.innerWidth  / 2;
  const apexY     = window.innerHeight - BEAM_APEX_Y_OFFSET;
  const halfW     = window.innerWidth  * BEAM_HALF_VW;
  const beamH     = window.innerHeight - BEAM_APEX_Y_OFFSET;
  const halfAngle = Math.atan2(halfW, beamH) * (180 / Math.PI);

  // [CREEPY] Current time used for per-nugget jelly bounce
  const now = performance.now();

  nuggets.forEach(nd => {
    // Use each nugget's own half-size for correct centring
    const nx = nd.x + nd.half;
    const ny = nd.y + nd.half;
    const dx = nx - apexX;
    const dy = ny - apexY;

    // [CREEPY] Jelly squash-stretch: Y stretches while X squashes
    const bounceT = now / BOUNCE_PERIOD_MS + nd.bouncePhase;
    const bounceY = 1 + BOUNCE_Y_AMPLITUDE * Math.sin(bounceT);
    const bounceX = 1 - BOUNCE_X_AMPLITUDE * Math.sin(bounceT);

    // Nugget must be above the apex (beam only points upward)
    if (dy >= 0) {
      nd.el.style.opacity       = '0';
      nd.el.style.pointerEvents = 'none';
      // [CREEPY] Keep animating bounce even in darkness for smooth beam entry
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
    nd.el.style.pointerEvents = intensity > 0 ? 'auto' : 'none';
    // [CREEPY] Bounce baked into the beam-driven scale
    nd.el.style.transform     = `scale(${(baseScale * bounceX).toFixed(3)}, ${(baseScale * bounceY).toFixed(3)})`;

    if (intensity > 0) {
      const brightness = (1 + 1.5 * intensity).toFixed(2);
      const glow1      = Math.round(28 * intensity);
      const glow2      = Math.round(10 * intensity);
      const alpha      = intensity.toFixed(2);
      // [CREEPY] Hint of eerie green in the glow when lit; red tint for rare
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

// --- Gyroscope ---
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

// --- Stars ---
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

// [CREEPY] Atmospheric fog wisps drifting across the cave
function initFog() {
  const cave = document.getElementById('cave');
  // Remove any fog from a previous game start
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

// Initialise darkness to full black before game starts
setDarkness();
