const iframe = document.getElementById("video-frame");
const params = new URLSearchParams(window.location.search);
const videoId = params.get("v") || params.get("videoId") || "dQw4w9WgXcQ";
iframe.src = `https://www.youtube.com/embed/${videoId}?enablejsapi=1&rel=0&playsinline=1`;

window.onYouTubeIframeAPIReady = function () {
  console.log("[API Ready] onYouTubeIframeAPIReady called");
  player = new YT.Player('video-frame', {
    videoId: videoId,
    playerVars: {
      rel: 0,
      autoplay: 0,
      playsinline: 1,
      controls: 0,
    },
    events: {
      onReady: () => {
        console.log("Player ready");
        player.mute();
        playerReady = true;
      }
    },
    onError: (e) => {
      console.error("[Player Error]", e.data);
    }
  });
};

const tag = document.createElement('script');
tag.src = "https://www.youtube.com/iframe_api";
document.head.appendChild(tag);

//================視線予測=============
let gazePenaltyRaw = 0;
let calibratingNow = false;
let calibrated = false;
let baseLeft = null, baseRight = null, basePose = null;
let yawScale = 0.2, pitchScale = 0.2;
let gazeHistory = [];
let blinkCooldown = 0;
let frameCounter = 0;

const FACE_OUTLINE_IDX = [1, 6, 10, 67, 151, 168, 197, 297];
let prevOutline = null;
let faceMoving = false;
let moveCooldown = 0;

const video = document.createElement("video");
video.autoplay = true;
video.muted = true;
video.playsInline = true;
video.style.display = "none";
document.body.appendChild(video);

const canvas = document.createElement("canvas");
canvas.width = 640;
canvas.height = 360;
canvas.style.display = "none";
document.body.appendChild(canvas);

const ctx = canvas.getContext("2d");

function avg(points) {
  return {
    x: points.map(p => p.x).reduce((a, b) => a + b, 0) / points.length,
    y: points.map(p => p.y).reduce((a, b) => a + b, 0) / points.length
  };
}

function isEyeClosed(landmarks, isLeft = true) {
  let top, bottom;
  if (isLeft) {
    top = landmarks[159]; bottom = landmarks[145];
  } else {
    top = landmarks[386]; bottom = landmarks[374];
  }
  const verticalDist = Math.abs(bottom.y - top.y);
  return verticalDist < 0.02;
}

function detectFaceOutlineMovement(landmarks) {
  const outline = FACE_OUTLINE_IDX.map(i => landmarks[i]);
  if (!prevOutline) {
    prevOutline = outline.map(p => ({ ...p }));
    return false;
  }

  let totalDist = 0;
  for (let i = 0; i < outline.length; i++) {
    const dx = outline[i].x - prevOutline[i].x;
    const dy = outline[i].y - prevOutline[i].y;
    const dz = outline[i].z - prevOutline[i].z;
    totalDist += Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  const avgDist = totalDist / outline.length;
  prevOutline = outline.map(p => ({ ...p }));
  //console.log(avgDist);
  return avgDist > 0.015; // 姿勢変化のしきい値 もっと大きくてもいい
}

function getNormalizedEyePos(landmarks, isLeft = true) {
  if (isLeft) {
    const inner = landmarks[133], outer = landmarks[33];
    const top = landmarks[159], bottom = landmarks[145];
    const iris = avg(landmarks.slice(468, 473));
    return {
      x: (iris.x - inner.x) / (outer.x - inner.x),
      y: (iris.y - top.y) / (bottom.y - top.y),
      iris
    };
  } else {
    const inner = landmarks[362], outer = landmarks[263];
    const top = landmarks[386], bottom = landmarks[374];
    const iris = avg(landmarks.slice(473, 478));
    return {
      x: (iris.x - inner.x) / (outer.x - inner.x),
      y: (iris.y - top.y) / (bottom.y - top.y),
      iris
    };
  }
}

function getHeadPose(landmarks) {
  const leftEye = landmarks[33];
  const rightEye = landmarks[263];
  const noseRoot = landmarks[168];
  const noseTip = landmarks[1];
  const roll = Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x);
  const pitch = Math.atan2(noseTip.y - noseRoot.y, noseTip.z - noseRoot.z);
  const yaw = Math.atan2(rightEye.x - leftEye.x, rightEye.z - leftEye.z);
  return { roll, pitch, yaw };
}

function smooth(value) {
  gazeHistory.push(value);
  if (gazeHistory.length > 5) gazeHistory.shift();
  return gazeHistory.reduce((a, b) => a + b, 0) / gazeHistory.length;
}

function calibrate(landmarks) {
  const left = getNormalizedEyePos(landmarks, true);
  const right = getNormalizedEyePos(landmarks, false);
  const pose = getHeadPose(landmarks);

  baseLeft = { x: left.x, y: left.y };
  baseRight = { x: right.x, y: right.y };
  basePose = { ...pose };

  yawScale = 0.2;
  pitchScale = 0.2;

  calibrated = true;
}

function isLookingCenter(landmarks) {
  const left = getNormalizedEyePos(landmarks, true);
  const right = getNormalizedEyePos(landmarks, false);

  if (!calibrated) {
    return { smoothDiff: 0, diffL: 0, diffR: 0, dYaw: 0, dPitch: 0 };
  }

  const pose = getHeadPose(landmarks);
  const dYaw = pose.yaw - basePose.yaw;
  const dPitch = pose.pitch - basePose.pitch;

  let diffLx = (left.x - baseLeft.x) - dYaw * yawScale;
  let diffLy = (left.y - baseLeft.y) - dPitch * pitchScale;
  let diffRx = (right.x - baseRight.x) - dYaw * yawScale;
  let diffRy = (right.y - baseRight.y) - dPitch * pitchScale;

  const deadzone = 0.03;
  const verticalExponent = 2.0;
  const horizontalExponent = 1.5;

  const applyResponseCurve = (value, exponent) => {
    const absValue = Math.abs(value);
    if (absValue < deadzone) {
      return 0;
    }
    const effectiveValue = absValue - deadzone;
    return Math.sign(value) * (effectiveValue ** exponent);
  };

  diffLx = applyResponseCurve(diffLx, horizontalExponent);
  diffLy = applyResponseCurve(diffLy, verticalExponent);
  diffRx = applyResponseCurve(diffRx, horizontalExponent);
  diffRy = applyResponseCurve(diffRy, verticalExponent);

  const verticalSensitivity = 2.0;
  diffLy *= verticalSensitivity;
  diffRy *= verticalSensitivity;

  const distL = Math.sqrt(diffLx * diffLx + diffLy * diffLy);
  const distR = Math.sqrt(diffRx * diffRx + diffRy * diffRy);
  const diff = Math.max(distL, distR);
  const smoothDiff = smooth(diff);

  return { smoothDiff, diffL: distL, diffR: distR, dYaw, dPitch, rawDiffs: { lx: diffLx, ly: diffLy, rx: diffRx, ry: diffRy } };
}
// ================== 視線予測・最適化版 ==================

let lastBgLightness = 0;
let targetBgLightness = 0;
let lastUpdate = performance.now();

const faceMesh = new FaceMesh({
  locateFile: (f) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${f}`,
});
faceMesh.setOptions({
  maxNumFaces: 1,
  refineLandmarks: true,
  minDetectionConfidence: 0.6,
  minTrackingConfidence: 0.6,
});

faceMesh.onResults((results) => {
  if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
    const landmarks = results.multiFaceLandmarks[0];

    if (gameActive) { // gameActive は shuffle.js の変数名に合わせる
      totalGameFrames++;
    }

    const leftClosed = isEyeClosed(landmarks, true);
    const rightClosed = isEyeClosed(landmarks, false);
    if (leftClosed && rightClosed) {
      console.log("まばたき検出");
      return;
    }

    const isMoving = detectFaceOutlineMovement(landmarks);
    if (isMoving) {
      faceMoving = true;
      moveCooldown = 10;
      console.log("視線判定ストップ");
      return;
    }
    if (moveCooldown > 0) {
      moveCooldown--;
      if (moveCooldown === 0) {
        console.log("自動再キャリブ");
        calibrate(landmarks);
        faceMoving = false;
      }
      return;
    }
    if (!calibrated) {
      calibrate(landmarks);
      console.log("初回キャリブレーション完了");
    }
    if (calibratingNow) {
      calibrate(landmarks);
      calibratingNow = false;
      console.log("再キャリブレーション完了");
    }

    const { smoothDiff } = isLookingCenter(landmarks);
    console.log(`smoothDiff: ${smoothDiff.toFixed(4)}`); // デバッグ用

    gazePenaltyRaw += smoothDiff;

    const THRESHOLD_WARN = 0.009;
    if (gameActive && smoothDiff > THRESHOLD_WARN) { // gameActive は shuffle.js の変数名に合わせる
      deviatedFrames++;
    }

    let deviationRatio = Math.min(1, smoothDiff / THRESHOLD_WARN);
    deviationRatio = deviationRatio ** 2;
    const saturation = 95 * deviationRatio;
    const lightness = 26 * deviationRatio;
    document.body.style.backgroundColor = `hsl(0, ${saturation}%, ${lightness}%)`;//背景色
  }
});

const camera = new Camera(video, {
  onFrame: async () => {
    frameCounter++;

    if (frameCounter % 3 === 0) {
      await faceMesh.send({ image: video });
    }
  },
  width: 640,
  height: 360,
});


//============ゲーム本体=============
function createCups(n) {
  const container = document.getElementById("cups-container");
  for (let i = 0; i < n; i++) {
    const div = document.createElement("div");
    div.className = "cup";
    container.appendChild(div);
  }
  return document.querySelectorAll(".cup");
}


let cups = document.querySelectorAll(".cup");
const message = document.getElementById("message");
let cupOrder = [];
let ballIndex = 0;
let difficulty = null;
let config = { swapCount: 5, cupOrder: [0, 1, 2] };

let score = 0;
let corrects = 0;
let misses = 0;

// データ記録用変数
let gameLog = [];
let roundData = {};
let deviatedFrames = 0;
let totalGameFrames = 0;
let player;
let playerReady = false;
let intervalSeconds = 0;
let nextIntervalTime = 0;
let currentRoundStartMs = 0;
let duration = 0;
let ahaTargetElement = null;
let gameActive = false;

let rounds = 0;
let timerId = null;
let startTime = null;
let pausedAt = 0;
let running = false;

const startArea = document.querySelector(".start");

//apiコマンド
function playVideo() {
  if (playerReady) {
    player.playVideo();
  } else {
    console.warn('player not ready yet');
  }
}
function pauseVideo() { player.pauseVideo(); }
function unMuteVideo() {
  if (playerReady) {
    player.unMute();
  } else {
    console.warn('player not ready yet');
  }
}

//タイマー
function startTimer() {
  if (running) return;
  startTime = performance.now() - pausedAt;
  running = true;
  timerId = requestAnimationFrame(tick);
  nextIntervalTime = intervalSeconds;
}

function pauseTimer() {
  if (!running) return;
  pausedAt = performance.now() - startTime;
  running = false;
  cancelAnimationFrame(timerId);
}

function tick() {
  if (!running) return;
  const elapsed = (performance.now() - startTime) / 1000; // 秒

  if (elapsed >= nextIntervalTime) {
    console.log("指定間隔到達:", nextIntervalTime, "秒");
    startMiniGame();
    nextIntervalTime += intervalSeconds;
  }

  if (elapsed < duration || duration === 0) {
    timerId = requestAnimationFrame(tick);
  } else {
    console.log("動画終了");
    running = false;
  }
}

window.addEventListener("DOMContentLoaded", () => {
  console.log("DOM Ready, set_btn =", document.getElementById("set_btn"));

  const setBtn = document.getElementById("set_btn");
  const durationInput = document.getElementById("durationInput");


  setBtn.addEventListener("click", () => {
    console.log("btnConfirm");
    const totalVideoMinutes = parseFloat(durationInput.value);

    const MINI_GAME_DURATION_MINUTES = 1;
    const MIN_INTERVAL_MINUTES = 1;

    const totalMiniGameTime = MINI_GAME_DURATION_MINUTES * 4;
    const intervalCount = 3;


    const minRequiredVideoTime = totalMiniGameTime + (MIN_INTERVAL_MINUTES * intervalCount);

    if (isNaN(totalVideoMinutes) || totalVideoMinutes < minRequiredVideoTime) {
      alert(`動画時間が短すぎます。最低でも${minRequiredVideoTime}分以上の動画時間を指定してください。`);
      return;
    }

    const totalIntervalTime = totalVideoMinutes - totalMiniGameTime;
    intervalSeconds = (totalIntervalTime / intervalCount) * 60;

    console.log(`動画全体: ${totalVideoMinutes}分 / ミニゲーム回数: 4回（固定）`);
    console.log(`総インターバル時間: ${totalIntervalTime.toFixed(2)}分 / インターバル回数: 3回`);
    console.log(`1回あたりのインターバル: ${intervalSeconds.toFixed(2)}秒`);

    startArea.innerHTML = "";
    showDifficultyUI();
  });
});

//難易度UI
function showDifficultyUI() {
  camera.start();
  const rect = getVideoRect();
  if (!startArea) return;
  const wrap = document.createElement("div");
  wrap.id = "diff-wrap";
  wrap.style.display = "flex";
  wrap.style.gap = "8px";

  const btnEasy = document.createElement("button"); btnEasy.textContent = "かんたん"; btnEasy.className = "btn";
  const btnNormal = document.createElement("button"); btnNormal.textContent = "ふつう"; btnNormal.className = "btn";
  const btnHard = document.createElement("button"); btnHard.textContent = "むずかしい"; btnHard.className = "btn";

  wrap.appendChild(btnEasy);
  wrap.appendChild(btnNormal);
  wrap.appendChild(btnHard);

  startArea.appendChild(wrap);

  function pick(level) {
    difficulty = level;
    if (level === "easy") {
      config = { cupCount: 3, swapCount: 3, cupOrder: [0, 1, 2], cupPositions: positionsTriangleLike(rect, 180), rounds: 5 };
    } if (level === "normal") {
      config = { cupCount: 3, swapCount: 5, cupOrder: [0, 1, 2], cupPositions: positionsTriangleLike(rect, 180), rounds: 5 };
    }
    if (level === "hard") {
      config = { cupCount: 4, swapCount: 5, cupOrder: [0, 1, 2, 3], cupPositions: positionsRectangle(rect, 180), rounds: 5 };
    }
    wrap.remove();

    const startPlayback = () => {
      Object.assign(iframe.style, { pointerEvents: "none" });
      playVideo();
      unMuteVideo();
      startMiniGame();
      document.getElementById('target-overlay')?.remove();
    };
    if (playerReady) {
      startPlayback();
    } else {
      const checkInterval = setInterval(() => {
        if (playerReady) {
          clearInterval(checkInterval);
          startPlayback();
        }
      }, 100);
    }
  }
  btnEasy.addEventListener("click", () => { pick("easy"); });
  btnNormal.addEventListener("click", () => { pick("normal"); });
  btnHard.addEventListener("click", () => { pick("hard"); });

}
//ミニゲーム進行
function startMiniGame() {
  pauseTimer();
  if (gameActive) return;
  gameActive = true;
  rounds = 0;
  document.getElementById('hourglass-container').style.display = 'none';//砂時計を非表示
  runRound();
}

function runRound() {
  if (rounds >= config.rounds) {
    endMiniGame();
    return;
  }
  rounds++;
  currentRoundStartMs = performance.now();
  gamestart();
}

function endMiniGame() {
  clearBoard();
  document.getElementById('hourglass-container').style.display = 'block';
  gameActive = false;
  //pausedAt = 0;
  startTimer();
  console.log("ミニゲーム終了");
}

function nextRound() {
  rounds++;
  if (rounds >= config.rounds) {
    endMiniGame();
  } else {
    gamestart();
  }
}

function clearBoard() {
  const container = document.getElementById("cups-container");
  if (container) container.innerHTML = "";
  cups = [];
}

//ボタン
document.getElementById("btn-stop")?.addEventListener("click", (e) => {
  const btn = e.currentTarget;
  if (btn.dataset.state === "playing") {
    pauseVideo();
    pauseTimer();
    btn.dataset.state = "paused";
  } else {
    playVideo();
    startTimer();
    btn.dataset.state = "playing";
  }
});

document.getElementById("btn-recalib")?.addEventListener("click", () => {
  calibratingNow = true;
  console.log("[視線] Recalibration requested.");
});

document.getElementById("btn-end")?.addEventListener("click", () => {
  endGame();
});

function endGame() {
  const totalPicks = corrects + misses;
  const accuracy = totalPicks > 0 ? (corrects / totalPicks * 100) : 0;
  const deviationPercentage = totalGameFrames > 0 ? (deviatedFrames / totalGameFrames * 100) : 0;
  const now = new Date();
  const month = now.getMonth() + 1;
  const day = now.getDate();

  const finalData = {
    kind: "shuffle",
    month: month,
    day: day,
    difficulty: difficulty,
    score: score,
    corrects: corrects,
    misses: misses,
    accuracy: accuracy.toFixed(1) + '%',
    totalRounds: gameLog.length,
    gazeDeviationPercentage: deviationPercentage.toFixed(2) + '%',
    rounds: gameLog,
  };
  //JSONファイル
  const jsonString = JSON.stringify(finalData, null, 2);
  const blob = new Blob([jsonString], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `game_result_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  alert([
    `終了！`,
    `正解: ${corrects} / ミス: ${misses}（正解率 ${accuracy.toFixed(1)}%）`,
    `総合スコア: ${score.toLocaleString()}`,
    `データファイルが出力されました。`
  ].join('\n'));
  setTimeout(clearBoard, 500);

};

function getVideoRect() {
  const rect = iframe.getBoundingClientRect();
  return {
    x: rect.left,
    y: rect.top,
    w: rect.width,
    h: rect.height
  };
}

// 3個のとき
function positionsTriangleLike(rect, offset = 120) {
  return [
    { top: rect.y - offset, left: rect.x + rect.w / 2 - 30 }, // 上
    { top: rect.y + rect.h / 2 - 30, left: rect.x - offset }, // 左
    { top: rect.y + rect.h / 2 - 30, left: rect.x + rect.w + offset - 60 } // 右
  ];
}

// 4個のとき
function positionsRectangle(rect, offset = 80) {
  return [
    { top: rect.y - offset, left: rect.x - rect.w / 4 },//左上
    { top: rect.y - offset, left: rect.x + (rect.w / 4) * 5 - 80 },//右上
    { top: rect.y + rect.h + offset - 120, left: rect.x - rect.w / 4 },//左下
    { top: rect.y + rect.h + offset - 120, left: rect.x + (rect.w / 4) * 5 - 80 }//右下
  ];
}

function gamestart() {
  clearBoard();
  cups = createCups(config.cupCount);
  gazePenaltyRaw = 0;
  roundData = {};
  ballIndex = Math.floor(Math.random() * cups.length);
  cupOrder = Array.from({ length: config.cupOrder.length }, (_, i) => i);

  cups.forEach((cup, i) => {
    cup.style.backgroundColor = "silver";
    const pos = config.cupPositions[i];
    cup.style.position = "absolute";
    cup.style.top = `${pos.top}px`;
    cup.style.left = `${pos.left}px`;

  });

  cups[ballIndex].style.backgroundColor = "aquamarine";

  setTimeout(() => {
    cups.forEach(cup => cup.style.backgroundColor = "silver");
    shuffleCups(config.swapCount);
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
    const pos = config.cupPositions[cupOrder.indexOf(i)];
    cup.style.transition = "top 0.5s ease, left 0.5s ease";
    cup.style.top = `${pos.top}px`;
    cup.style.left = `${pos.left}px`;
  });
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
      ///スコア計算
      let roundScore = 0;
      const baseScore = 3000;// 基本点
      const penalty = Math.floor(Math.round((gazePenaltyRaw * 100) ** 2 * 0.005) / 100) * 100; //gazePenaltyRawのmaxは約1.2 max7200ぐらい

      const correct = i === ballIndex;
      if (correct) {
        corrects++;
        roundScore = baseScore - penalty;
        cup.style.backgroundColor = "aquamarine";
      } else {
        misses++;
        roundScore = -penalty;
        cups[ballIndex].style.backgroundColor = "aquamarine";
      }
      score += Math.max(0, roundScore);

      const reactionTime = performance.now() - currentRoundStartMs;
      roundData = {
        roundNumber: rounds,
        correct: correct,
        reactionTime: reactionTime,
        gazePenalty: gazePenaltyRaw,
        cupCount: config.cupCount,
        swapCount: config.swapCount
      };
      gameLog.push(roundData);

      cups.forEach(c => c.style.pointerEvents = 'none');

      setTimeout(() => {
        cups.forEach(c => c.style.pointerEvents = 'auto');
        nextRound();
      }, 1500);

    }, { once: true });
  });
}
