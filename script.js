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

const bgMusic     = document.getElementById('bg-music');

// --- Game state ---
let torchOn    = false;
let gameActive = false;
let score      = 0;
let level      = 1;
let timerHandle = null;
let timeLeft   = 0;

const LEVEL_DURATION        = 30000; // ms
const BEAM_SWEEP_PERIOD     = 3500;  // ms — duration of one full left-right-left sweep cycle (fallback)
const MAX_SWEEP_ANGLE       = 65;    // degrees — max auto-sweep angle (fallback, no gyro)
const MAX_GYRO_ANGLE        = 75;    // degrees — clamp range for gyroscope gamma input
const LERP_FACTOR           = 0.12;  // smoothing factor for angle interpolation
const BEAM_HALF_VW          = 0.25;  // half-width of beam as fraction of viewport width (matches CSS left:-25vw)
const NUGGET_SPAWN_AREA     = 0.67;  // fraction of screen height used for nugget spawning (upper two thirds)
const NUGGETS_START_COUNT    = 1;    // gambusinos on level 1
const NUGGETS_LEVEL_STEP     = 1;    // extra gambusinos added per level (level N → N gambusinos)
const NUGGET_SIZE            = 135;  // nugget element size in pixels
const NUGGET_MIN_DIST        = 150;  // minimum top-left to top-left distance between nuggets (px)
const NUGGET_MAX_ATTEMPTS    = 100;  // max retries to find a non-overlapping position
const EXCELLENT_SCORE       = 10;    // score threshold for "excellent" end message
const GOOD_SCORE            = 4;     // score threshold for "good" end message
const BULLET_SPEED          = 12;    // bullet travel speed in pixels per frame
const NUGGET_HALF           = Math.floor(NUGGET_SIZE / 2); // nugget center offset / collision radius (67px)
const BEAM_APEX_Y_OFFSET    = 46;    // px from bottom of viewport to beam apex / torch button centre
const MAX_LEVELS            = 30;    // total number of levels
const NUGGET_BASE_SPEED     = 0.6;   // downward speed at level 1 (px/frame)
const NUGGET_SPEED_STEP     = 0.07;  // extra downward speed per level
const NUGGET_ZIG_SPEED      = 1.5;   // horizontal zig-zag speed at level 1 (px/frame)
const NUGGET_ZIG_STEP       = 0.04;  // extra horizontal speed per level
const NUGGET_SPAWN_STAGGER  = 120;   // vertical offset between consecutively spawned gambusinos (px)

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
  score  = 0;
  level  = 1;
  gameActive = true;
  torchOn    = true;

  scoreEl.textContent = '0';
  levelEl.textContent = '1';

  startScreen.classList.add('hidden');
  endScreen.classList.add('hidden');

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
  spawnNuggets(NUGGETS_START_COUNT);
  startTimer();

  bgMusic.currentTime = 0;
  bgMusic.play().catch(() => {});

  if (!rafId) rafLoop();
}

function endGame() {
  gameActive = false;
  torchOn    = false;
  torchBtn.classList.remove('on');
  beam.classList.remove('active');

  sweepStartTime = null;
  clearNuggets();
  clearBullets();
  clearInterval(timerHandle);
  setDarkness();

  bgMusic.pause();
  bgMusic.currentTime = 0;

  const msg = score > EXCELLENT_SCORE ? 'Excelente trabalho!'
            : score > GOOD_SCORE      ? 'Bom esforço!'
            : 'A mina guarda os seus segredos…';

  endTitle.textContent = 'Fim da Jornada';
  endSub.textContent   = 'O tempo esgotou-se';
  endDesc.textContent  = `Apanhaste ${score} gambusino${score !== 1 ? 's' : ''} até ao nível ${level}. ${msg}`;

  endScreen.classList.remove('hidden');
}

// --- Timer ---
function startTimer() {
  timeLeft = LEVEL_DURATION;
  timerBar.style.width = '100%';
  clearInterval(timerHandle);

  const TICK = 100;
  timerHandle = setInterval(() => {
    if (!gameActive) { clearInterval(timerHandle); return; }
    if (!torchOn) return;
    timeLeft -= TICK;

    const pct = Math.max(0, timeLeft / LEVEL_DURATION);
    timerBar.style.width = (pct * 100) + '%';

    // Shift from gold → red as time runs out
    const r = Math.round(184 + (255 - 184) * (1 - pct));
    const g = Math.round(134 * pct);
    timerBar.style.background = `linear-gradient(to right, rgb(${r},${g},0), rgb(255,${Math.round(215 * pct)},0))`;

    if (timeLeft <= 0) {
      clearInterval(timerHandle);
      endGame();
    }
  }, TICK);
}

// --- Nuggets ---
function isTooClose(x, y, placed) {
  return placed.some(p => Math.hypot(x - p.x, y - p.y) < NUGGET_MIN_DIST);
}

function spawnNuggets(count) {
  clearNuggets();
  const cave   = document.getElementById('nuggets-container');
  const margin = 60;
  const W      = window.innerWidth;
  const speed    = NUGGET_BASE_SPEED + (level - 1) * NUGGET_SPEED_STEP;
  const zigSpeed = NUGGET_ZIG_SPEED  + (level - 1) * NUGGET_ZIG_STEP;

  for (let i = 0; i < count; i++) {
    // Stagger spawn positions vertically so gambusinos enter screen over time
    const x   = margin + Math.random() * (W - 2 * margin - NUGGET_SIZE);
    const y   = -NUGGET_SIZE - i * NUGGET_SPAWN_STAGGER;
    const dir = Math.random() > 0.5 ? 1 : -1;

    const el = document.createElement('div');
    el.className = 'nugget';
    el.style.left = x + 'px';
    el.style.top  = y + 'px';
    cave.appendChild(el);

    const nd = { el, x, y, vx: zigSpeed * dir, vy: speed };
    nuggets.push(nd);

    el.addEventListener('click', () => {
      if ((parseFloat(el.style.opacity) || 0) <= 0) return;
      catchNugget(nd);
    });
  }
}

function clearNuggets() {
  nuggets.forEach(nd => nd.el.remove());
  nuggets = [];
}

function catchNugget(nd) {
  nd.el.style.opacity = '';
  nd.el.style.transform = '';
  nd.el.style.filter = '';
  nd.el.classList.add('caught');
  score++;
  scoreEl.textContent = score;
  setTimeout(() => nd.el.remove(), 300);
  nuggets = nuggets.filter(x => x !== nd);
  if (nuggets.length === 0) nextLevel();
}

function clearBullets() {
  bullets.forEach(b => b.el.remove());
  bullets = [];
}

function updateNuggets() {
  if (!nuggets.length) return;
  const W = window.innerWidth;
  const H = window.innerHeight;
  const surviving = [];
  for (const nd of nuggets) {
    nd.x += nd.vx;
    nd.y += nd.vy;
    // Bounce off side walls for zig-zag
    if (nd.x < 0) { nd.x = 0; nd.vx = Math.abs(nd.vx); }
    else if (nd.x > W - NUGGET_SIZE) { nd.x = W - NUGGET_SIZE; nd.vx = -Math.abs(nd.vx); }
    nd.el.style.left = nd.x + 'px';
    nd.el.style.top  = nd.y + 'px';
    if (nd.y > H) {
      // Gambusino reached the bottom — disappears without scoring
      nd.el.remove();
    } else {
      surviving.push(nd);
    }
  }
  nuggets = surviving;
  if (gameActive && nuggets.length === 0) nextLevel();
}

function fireBullet() {
  if (!gameActive || !torchOn) return;
  const el = document.createElement('div');
  el.className = 'bullet';
  const apexX = window.innerWidth / 2;
  const apexY = window.innerHeight - BEAM_APEX_Y_OFFSET;
  el.style.left = apexX + 'px';
  el.style.top  = apexY + 'px';
  document.body.appendChild(el);
  const rad = currentAngle * Math.PI / 180;
  bullets.push({ x: apexX, y: apexY, vx: BULLET_SPEED * Math.sin(rad), vy: -BULLET_SPEED * Math.cos(rad), el });
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
    let hit = false;
    for (let i = 0; i < nuggets.length; i++) {
      const nd = nuggets[i];
      if (Math.hypot(b.x - (nd.x + NUGGET_HALF), b.y - (nd.y + NUGGET_HALF)) < NUGGET_HALF) {
        catchNugget(nd);
        hit = true;
        break;
      }
    }
    if (hit) {
      b.el.remove();
    } else {
      surviving.push(b);
    }
  }
  bullets = surviving;
}

function nextLevel() {
  if (level >= MAX_LEVELS) {
    showVictory();
    return;
  }
  level++;
  levelEl.textContent = level;
  timeLeft = LEVEL_DURATION;
  timerBar.style.width = '100%';
  const count = NUGGETS_START_COUNT + (level - 1) * NUGGETS_LEVEL_STEP;

  const levelMsg = document.getElementById('level-msg');
  levelMsg.textContent = `Nível ${level}`;
  levelMsg.classList.remove('hidden');
  levelMsg.style.animation = 'none';
  void levelMsg.offsetHeight;
  levelMsg.style.animation = 'levelMsgAnim 2s ease forwards';
  setTimeout(() => levelMsg.classList.add('hidden'), 2000);

  spawnNuggets(count);
}

function showVictory() {
  gameActive = false;
  torchOn    = false;
  torchBtn.classList.remove('on');
  beam.classList.remove('active');

  sweepStartTime = null;
  clearNuggets();
  clearBullets();
  clearInterval(timerHandle);
  setDarkness();

  bgMusic.pause();
  bgMusic.currentTime = 0;

  endTitle.textContent = '🏆 Vitória!';
  endSub.textContent   = 'Completaste todos os 30 níveis!';
  endDesc.textContent  = `Apanhaste ${score} gambusino${score !== 1 ? 's' : ''} ao longo da jornada. Parabéns, caçador lendário!`;

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
  beam.style.transform = `rotate(${currentAngle}deg)`;
}

function checkLight() {
  const apexX     = window.innerWidth  / 2;
  const apexY     = window.innerHeight - BEAM_APEX_Y_OFFSET;
  const halfW     = window.innerWidth  * BEAM_HALF_VW;
  const beamH     = window.innerHeight - BEAM_APEX_Y_OFFSET;
  const halfAngle = Math.atan2(halfW, beamH) * (180 / Math.PI);

  nuggets.forEach(nd => {
    const nx = nd.x + NUGGET_HALF;
    const ny = nd.y + NUGGET_HALF;
    const dx = nx - apexX;
    const dy = ny - apexY;

    // Nugget must be above the apex (beam only points upward)
    if (dy >= 0) {
      nd.el.style.opacity       = '0';
      nd.el.style.pointerEvents = 'none';
      nd.el.style.transform     = 'scale(0.7)';
      nd.el.style.filter        = '';
      return;
    }

    // Angle from apex to nugget measured from "pointing straight up"
    const nuggetAngle = Math.atan2(dx, -dy) * (180 / Math.PI);
    const angleDiff   = Math.abs(nuggetAngle - currentAngle);
    const intensity   = Math.max(0, Math.min(1, 1 - angleDiff / halfAngle));

    nd.el.style.opacity       = intensity;
    nd.el.style.pointerEvents = intensity > 0 ? 'auto' : 'none';
    nd.el.style.transform     = `scale(${(0.7 + 0.3 * intensity).toFixed(2)})`;

    if (intensity > 0) {
      const brightness = (1 + 1.2 * intensity).toFixed(2);
      const glow1      = Math.round(22 * intensity);
      const glow2      = Math.round(8  * intensity);
      const alpha      = intensity.toFixed(2);
      nd.el.style.filter = `brightness(${brightness}) drop-shadow(0 0 ${glow1}px rgba(255,215,0,${alpha})) drop-shadow(0 0 ${glow2}px rgba(255,255,255,${alpha}))`;
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

// Initialise darkness to full black before game starts
setDarkness();
