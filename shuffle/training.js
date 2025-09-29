const cupPositions = [
  { top: 0, left: -50 },
  { top: 400, left: -500 },
  { top: 400, left: 420 }
];

//動画
const iframe = document.getElementById("video-frame");
const params = new URLSearchParams(window.location.search);
const videoId = params.get("videoId");
Object.assign(iframe.style, { pointerEvents: "none" });
//document.getElementById("video-frame").src = `https://www.youtube.com/embed/${videoId}?autoplay=1&controls=1`;

//設定
const cups = document.querySelectorAll(".cup");
const message = document.getElementById("message");
//let swapCount;
//let cupOrder = [0, 1, 2];
let ballIndex = 0;

let difficulty = null;
let config = { swapCount: 5, cupOrder:[0,1,2] };
const startArea = document.querySelector(".start");

function ytCommand(func, args = []) {
  iframe.contentWindow?.postMessage(
      JSON.stringify({ event: "command", func, args }),
      "*"
  );
}
function playVideo() { ytCommand("playVideo"); }
function pauseVideo() { ytCommand("pauseVideo"); }

//難易度UI
function showDifficultyUI() {
  if (!startArea) return;
  const wrap = document.createElement("div");
  wrap.id = "diff-wrap";
  wrap.style.display = "flex";
  wrap.style.gap = "8px";

  const btnEasy = document.createElement("button"); btnEasy.textContent = "かんたん"; btnEasy.className = "btn";
  const btnNormal = document.createElement("button"); btnNormal.textContent = "ふつう"; btnNormal.className = "btn";
  const btnHard = document.createElement("button"); btnHard.textContent = "むずかしい"; btnHard.className = "btn";

  wrap.appendChild(btnEasy); wrap.appendChild(btnNormal); wrap.appendChild(btnHard);
  startArea.appendChild(wrap);

  function pick(level) {
      difficulty = level;
      if (level === "easy") config = { swapCount: 3, cupOrder:[0,1,2] };
      if (level === "normal") config = { swapCount: 5, cupOrder:[0,1,2] };
      if (level === "hard") config = { swapCount: 5, cupOrder:[0,1,2,3] };
      wrap.remove();

  }
  btnEasy.addEventListener("click", () => pick("easy"));
  btnNormal.addEventListener("click", () => pick("normal"));
  btnHard.addEventListener("click", () => pick("hard"));

  iframe.src = `https://www.youtube.com/embed/${videoId}?enablejsapi=1&rel=0&autoplay=0&playsinline=1`;
  playVideo();
}

//ボタン
document.getElementById("btn-stop")?.addEventListener("click", (e) => {
  const btn = e.currentTarget;
  if (btn.dataset.state === "playing") {
      pauseVideo();
      //pauseTimer();
      btn.dataset.state = "paused";
  } else {
      playVideo();
      //startTimer();
      btn.dataset.state = "playing";
  }
});

document.getElementById("restart_btn").addEventListener("click",()=>{
  //document.getElementById("cups-container").style.position = "relative";
  gamestart()
});

window.addEventListener("load", () => {
const container = document.getElementById("cups-container");
  container.style.position = "relative";
  const waitForCalibration = setInterval(() => {
    if (window.isCalibrationDone) {
      clearInterval(waitForCalibration);
      gamestart();
    }
  }, 100);
});

function gamestart() {
  cupOrder = [0, 1, 2];
  ballIndex = Math.floor(Math.random() * cups.length);

  cups.forEach((cup, i) => {
    cup.style.backgroundColor = "gray";
    const pos = cupPositions[i];
    cup.style.position = "absolute";
    cup.style.top = `${pos.top}px`;
    cup.style.left = `${pos.left}px`;

  });

 //cups = document.querySelectorAll(".cup");
  cups[ballIndex].style.backgroundColor = "red";

  setTimeout(() => {
    cups.forEach(cup => cup.style.backgroundColor = "gray");
    shuffleCups(swapCount);
  }, 3000);
}

function shuffleCups(count) {
  if (count === 0) {
    enableCupClick();
    return;
  }

  let [a, b] = getTwoDifferentIndexes();

  [cupOrder[a], cupOrder[b]] = [cupOrder[b], cupOrder[a]];

  cups.forEach((cup, i) => {
    const pos = cupPositions[cupOrder.indexOf(i)];
    cup.style.transition = "top 0.5s ease, left 0.5s ease";
    cup.style.top = `${pos.top}px`;
    cup.style.left = `${pos.left}px`;
  });

  //ballIndex = cupOrder.indexOf(ballIndex);

  setTimeout(() => shuffleCups(count - 1), 700);
}

function getTwoDifferentIndexes() {
  let a = Math.floor(Math.random() * cups.length);
  let b;
  do {
    b = Math.floor(Math.random() * cups.length);
  } while (b === a);
  return [a, b];
}

function enableCupClick() {
  cups.forEach((cup, i) => {
    cup.addEventListener("click", () => {
      if (i === ballIndex) {
        cup.style.backgroundColor = "red";

      } else {
        cups[ballIndex].style.backgroundColor = "red";
      }
    }, { once: true });
  });
}


showDifficultyUI();

/*document.getElementById("end_btn").addEventListener("click",()=>{
  flag=false;
  document.querySelectorAll(".training-target").forEach(el => el.remove());//残りのターゲットの消去
  alert(`トレーニング終了！`);
});*/