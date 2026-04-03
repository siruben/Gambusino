let tiltAngle = 0;
let torchOn = false;
let nuggets = [];
let score = 0;
let gameActive = false;

const beam = document.getElementById('beam');
const torchBtn = document.getElementById('torch-btn');
const scoreEl = document.getElementById('score');

document.getElementById('start-btn').onclick = startGame;
document.getElementById('restart-btn').onclick = startGame;

function startGame(){
  score = 0;
  gameActive = true;
  document.getElementById('start-screen').classList.add('hidden');
  document.getElementById('end-screen').classList.add('hidden');
  spawnNuggets();
  requestGyro();
}

function spawnNuggets(){
  nuggets.forEach(n=>n.remove());
  nuggets=[];

  for(let i=0;i<10;i++){
    let n=document.createElement('div');
    n.className='nugget';
    n.style.left=Math.random()*window.innerWidth+'px';
    n.style.top=Math.random()*window.innerHeight+'px';

    n.onclick=()=>{
      if(n.classList.contains('lit')){
        n.remove();
        score++;
        scoreEl.textContent=score;
      }
    }

    document.body.appendChild(n);
    nuggets.push(n);
  }
}

function requestGyro(){
  if (typeof DeviceOrientationEvent.requestPermission === 'function') {
    DeviceOrientationEvent.requestPermission().then(p=>{
      if(p==='granted') window.addEventListener('deviceorientation', onGyro);
    });
  } else {
    window.addEventListener('deviceorientation', onGyro);
  }
}

function onGyro(e){
  let target = Math.max(-45, Math.min(45, e.gamma));
  tiltAngle += (target - tiltAngle) * 0.1;
  updateBeam();
}

function updateBeam(){
  beam.style.transform=`rotate(${tiltAngle}deg)`;
  checkLight();
}

function checkLight(){
  nuggets.forEach(n=>{
    let nx=n.offsetLeft;
    let center=window.innerWidth/2;
    let diff=Math.abs((nx-center)/10 - tiltAngle);

    if(diff<10){
      n.classList.add('lit');
    } else {
      n.classList.remove('lit');
    }
  });
}
