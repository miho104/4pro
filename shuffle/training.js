const cupPositions = [
  { top: 0, left: -50 },
  { top: 400, left: -500 },
  { top: 400, left: 420 }
];

//youtube再生
const params = new URLSearchParams(window.location.search);
const videoId = params.get("videoId");
document.getElementById("video-frame").src = `https://www.youtube.com/embed/${videoId}?autoplay=1&controls=1`;



//カード設定
const cups = document.querySelectorAll(".cup");
const message = document.getElementById("message");
let swapCount = 5;
let cupOrder = [0, 1, 2];
let ballIndex = 0;



// 初期画面
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

//game
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

  // 赤いカップを表示
  //cups = document.querySelectorAll(".cup"); // クローンしたあとの新しいcupを再取得
  cups[ballIndex].style.backgroundColor = "red";
  message.textContent = "赤いカップを覚えてください... 3秒後に消えます";

  setTimeout(() => {
    cups.forEach(cup => cup.style.backgroundColor = "gray");
    message.textContent = "シャッフル中...中央に注視してください";
    shuffleCups(swapCount);
  }, 3000);
}

function shuffleCups(count) {
  if (count === 0) {
    message.textContent = "どのカップが赤だったかを選んでください";
    enableCupClick();
    return;
  }

  let [a, b] = getTwoDifferentIndexes();

  // 論理順序をスワップ
  [cupOrder[a], cupOrder[b]] = [cupOrder[b], cupOrder[a]];

  // 表示位置を更新
  cups.forEach((cup, i) => {
    const pos = cupPositions[cupOrder.indexOf(i)];
    cup.style.transition = "top 0.5s ease, left 0.5s ease";
    cup.style.top = `${pos.top}px`;
    cup.style.left = `${pos.left}px`;
  });

  // ballIndex も入れ替えに合わせて更新
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

document.getElementById("restart_btn").addEventListener("click",()=>{
  //document.getElementById("cups-container").style.position = "relative";
  gamestart()
});

/*document.getElementById("end_btn").addEventListener("click",()=>{
  flag=false;
  document.querySelectorAll(".training-target").forEach(el => el.remove());//残りのターゲットの消去
  alert(`トレーニング終了！`);
});*/