'use strict';

// --- DOM refs ---
const beam        = document.getElementById('beam');
const darkness    = document.getElementById('darkness');
const torchBtn    = document.getElementById('torch-btn');
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
const NUGGET_SPAWN_AREA     = 0.50;  // fraction of screen height used for nugget spawning (upper half)
const NUGGETS_START_COUNT    = 3;    // gambusinos on level 1
const NUGGETS_LEVEL_STEP     = 2;    // extra gambusinos added per level
const EXCELLENT_SCORE       = 10;    // score threshold for "excellent" end message
const GOOD_SCORE            = 4;     // score threshold for "good" end message

// --- Beam angle state ---
let currentAngle   = 0;    // smoothly interpolated beam rotation angle (degrees)
let targetAngle    = 0;    // target angle (from gyro or auto-sweep)
let hasGyro        = false; // whether a gyroscope is providing data
let sweepStartTime = null;
let rafId          = null;

// --- Nuggets ---
let nuggets = [];

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
function spawnNuggets(count) {
  clearNuggets();
  const cave   = document.getElementById('cave');
  const margin = 60;
  const W = window.innerWidth;
  const H = window.innerHeight;

  for (let i = 0; i < count; i++) {
    const n = document.createElement('div');
    n.className = 'nugget';
    n.style.left = (margin + Math.random() * (W - 2 * margin - 45)) + 'px';
    // Spawn in upper 78% of screen (below that is close to the torch apex and unreachable)
    n.style.top  = (margin + Math.random() * (H * NUGGET_SPAWN_AREA - margin - 45)) + 'px';

    n.addEventListener('click', () => {
      if (!n.classList.contains('lit')) return;
      n.classList.add('caught');
      score++;
      scoreEl.textContent = score;
      setTimeout(() => n.remove(), 300);
      nuggets = nuggets.filter(x => x !== n);
      if (nuggets.length === 0) nextLevel();
    });

    cave.appendChild(n);
    nuggets.push(n);
  }
}

function clearNuggets() {
  nuggets.forEach(n => n.remove());
  nuggets = [];
}

function nextLevel() {
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

  if (!torchOn) return;

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
  const apexY     = window.innerHeight - 46;
  const halfW     = window.innerWidth  * BEAM_HALF_VW;
  const beamH     = window.innerHeight - 46;
  const halfAngle = Math.atan2(halfW, beamH) * (180 / Math.PI);

  nuggets.forEach(n => {
    const nx = n.offsetLeft + 22;
    const ny = n.offsetTop  + 22;
    const dx = nx - apexX;
    const dy = ny - apexY;

    // Nugget must be above the apex (beam only points upward)
    if (dy >= 0) { n.classList.toggle('lit', false); return; }

    // Angle from apex to nugget measured from "pointing straight up"
    const nuggetAngle = Math.atan2(dx, -dy) * (180 / Math.PI);
    n.classList.toggle('lit', Math.abs(nuggetAngle - currentAngle) <= halfAngle);
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
