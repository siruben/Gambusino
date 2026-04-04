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
const BEAM_RADIUS           = 110;   // px — spotlight radius
const BEAM_DETECTION_FACTOR = 0.78;  // fraction of BEAM_RADIUS used for nugget hit detection
const NUGGETS_PER_LEVEL     = [8, 10, 12, 15, 18];
const EXCELLENT_SCORE       = 10;    // score threshold for "excellent" end message
const GOOD_SCORE            = 4;     // score threshold for "good" end message
const BEAM_SWEEP_PERIOD     = 3500;  // ms — duration of one full left-right-left sweep cycle
const BEAM_Y_FACTOR         = 0.45;  // fraction of screen height for fixed beam vertical position

// --- Beam position state ---
let beamX          = window.innerWidth  / 2;
let beamY          = window.innerHeight * BEAM_Y_FACTOR;
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

  // Reset hint animation
  gyroHint.style.animation = 'none';
  void gyroHint.offsetHeight;
  gyroHint.style.animation = 'fadeHint 4s ease forwards';

  sweepStartTime = null;

  clearNuggets();
  spawnNuggets(NUGGETS_PER_LEVEL[0]);
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
  setDarkness(-9999, -9999);

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
  const bY     = Math.round(H * BEAM_Y_FACTOR);
  const spread = Math.round(BEAM_RADIUS * BEAM_DETECTION_FACTOR * 0.75); // ~62px

  for (let i = 0; i < count; i++) {
    const n = document.createElement('div');
    n.className = 'nugget';
    n.style.left = (margin + Math.random() * (W - 2 * margin - 30)) + 'px';
    const minTop = Math.max(margin, bY - spread - 15);
    const maxTop = Math.min(H - margin - 30, bY + spread - 15);
    n.style.top  = (minTop + Math.random() * (maxTop - minTop)) + 'px';

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

// --- rAF animation loop ---
function rafLoop() {
  rafId = requestAnimationFrame(rafLoop);

  if (!gameActive) return;

  // Continuous horizontal sweep using a sine wave
  const now = performance.now();
  if (sweepStartTime === null) sweepStartTime = now;
  const t = ((now - sweepStartTime) % BEAM_SWEEP_PERIOD) / BEAM_SWEEP_PERIOD;
  beamX = (Math.sin(t * Math.PI * 2 - Math.PI / 2) * 0.5 + 0.5) * window.innerWidth;
  beamY = window.innerHeight * BEAM_Y_FACTOR;

  if (!torchOn) return;

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
    const lit = (dx * dx + dy * dy) < (BEAM_RADIUS * BEAM_DETECTION_FACTOR) * (BEAM_RADIUS * BEAM_DETECTION_FACTOR);
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
