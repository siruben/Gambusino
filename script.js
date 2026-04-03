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

// --- Game state ---
let torchOn    = false;
let gameActive = false;
let score      = 0;
let level      = 1;
let timerHandle = null;
let timeLeft   = 0;
let gyroEnabled = false;

const LEVEL_DURATION  = 30000; // ms
const BEAM_RADIUS     = 110;   // px — spotlight radius
const NUGGETS_PER_LEVEL = [8, 10, 12, 15, 18];

// --- Beam position state ---
let beamX       = window.innerWidth  / 2;
let beamY       = window.innerHeight / 2;
let targetBeamX = window.innerWidth  / 2;
let targetBeamY = window.innerHeight / 2;
let rafId       = null;

// --- Nuggets ---
let nuggets = [];

// --- Torch toggle ---
torchBtn.addEventListener('click', () => {
  if (!gameActive) return;
  torchOn = !torchOn;
  torchBtn.classList.toggle('on', torchOn);
  beam.classList.toggle('active', torchOn);
  if (torchOn && !gyroEnabled) requestGyro();
});

// --- Start / Restart ---
document.getElementById('start-btn').addEventListener('click', startGame);
document.getElementById('restart-btn').addEventListener('click', startGame);

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

  // Reset gyro hint animation
  gyroHint.style.animation = 'none';
  void gyroHint.offsetHeight;
  gyroHint.style.animation = 'fadeHint 4s ease forwards';

  clearNuggets();
  spawnNuggets(NUGGETS_PER_LEVEL[0]);
  startTimer();
  requestGyro();

  if (!rafId) rafLoop();
}

function endGame() {
  gameActive = false;
  torchOn    = false;
  torchBtn.classList.remove('on');
  beam.classList.remove('active');

  clearNuggets();
  clearInterval(timerHandle);
  setDarkness(-9999, -9999);

  const msg = score > 10 ? 'Excelente trabalho!'
            : score > 4  ? 'Bom esforço!'
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
    n.style.left = (margin + Math.random() * (W - 2 * margin - 30)) + 'px';
    n.style.top  = (margin + Math.random() * (H - 2 * margin - 120)) + 'px';

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
  const count = NUGGETS_PER_LEVEL[Math.min(level - 1, NUGGETS_PER_LEVEL.length - 1)];
  spawnNuggets(count);
}

// --- Gyroscope ---
function requestGyro() {
  if (typeof DeviceOrientationEvent === 'undefined') return;

  if (typeof DeviceOrientationEvent.requestPermission === 'function') {
    // iOS 13+ requires explicit user permission
    DeviceOrientationEvent.requestPermission()
      .then(permission => {
        if (permission === 'granted') {
          window.addEventListener('deviceorientation', onGyro, true);
          gyroEnabled = true;
        }
      })
      .catch(() => {});
  } else {
    window.addEventListener('deviceorientation', onGyro, true);
    gyroEnabled = true;
  }
}

function onGyro(e) {
  if (!gameActive || !torchOn) return;
  if (e.gamma == null || e.beta == null) return;

  // gamma: -90..90  → left/right tilt → X position
  const gamma = Math.max(-45, Math.min(45, e.gamma));
  // beta: 0..90 when phone upright → forward/back tilt → Y position
  const beta  = Math.max(10, Math.min(80, e.beta));

  targetBeamX = ((gamma + 45) / 90)  * window.innerWidth;
  targetBeamY = (1 - (beta - 10) / 70) * (window.innerHeight * 0.85);
}

// --- Touch / Mouse fallback (used when no gyro or on desktop) ---
function onPointerMove(e) {
  if (!gameActive || !torchOn || gyroEnabled) return;
  const pt = e.touches ? e.touches[0] : e;
  targetBeamX = pt.clientX;
  targetBeamY = pt.clientY;
}

document.addEventListener('mousemove', onPointerMove);
document.addEventListener('touchmove', e => {
  onPointerMove(e);
}, { passive: true });

// --- rAF animation loop ---
function rafLoop() {
  rafId = requestAnimationFrame(rafLoop);

  if (!torchOn || !gameActive) return;

  // Smooth interpolation (lerp)
  beamX += (targetBeamX - beamX) * 0.12;
  beamY += (targetBeamY - beamY) * 0.12;

  setDarkness(beamX, beamY);
  updateBeamVisual(beamX, beamY);
  checkLight();
}

function setDarkness(x, y) {
  darkness.style.background = [
    `radial-gradient(circle ${BEAM_RADIUS}px at ${x}px ${y}px,`,
    `  rgba(255,220,100,0.04) 0%,`,
    `  transparent 38%,`,
    `  rgba(0,0,0,0.88) 62%,`,
    `  rgba(0,0,0,0.98) 100%)`
  ].join('\n');
}

function updateBeamVisual(x, y) {
  // Rotate the beam cone from torch (bottom center) toward spotlight
  const torchX = window.innerWidth  / 2;
  const torchY = window.innerHeight - 46;
  const dx = x - torchX;
  const dy = y - torchY;
  const angleDeg = Math.atan2(dx, -dy) * (180 / Math.PI);
  beam.style.transform = `rotate(${angleDeg}deg)`;
}

function checkLight() {
  nuggets.forEach(n => {
    const nx = n.offsetLeft + 15;
    const ny = n.offsetTop  + 15;
    const dx = nx - beamX;
    const dy = ny - beamY;
    const lit = (dx * dx + dy * dy) < (BEAM_RADIUS * 0.78) * (BEAM_RADIUS * 0.78);
    n.classList.toggle('lit', lit);
  });
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
setDarkness(-9999, -9999);
