//api
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

//視線予測設定
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
  //console.log(verticalDist);
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
  return avgDist > 0.01; // 姿勢変化のしきい値 もっと大きくてもいい
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
  console.log("Calibration complete:", baseLeft, baseRight, basePose);
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

  const diffLx = (left.x - baseLeft.x) - dYaw * yawScale;
  const diffLy = (left.y - baseLeft.y) - dPitch * pitchScale;
  const diffRx = (right.x - baseRight.x) - dYaw * yawScale;
  const diffRy = (right.y - baseRight.y) - dPitch * pitchScale;

  const distL = Math.sqrt(diffLx * diffLx + diffLy * diffLy);
  const distR = Math.sqrt(diffRx * diffRx + diffRy * diffRy);
  const diff = Math.max(distL, distR);
  const smoothDiff = smooth(diff);

  //const THRESHOLD_OK = 0.08;
  //const THRESHOLD_WARN = 0.12;

  return { smoothDiff, diffL: distL, diffR: distR, dYaw, dPitch };
}

const faceMesh = new FaceMesh({ locateFile: (f) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${f}` });
faceMesh.setOptions({ maxNumFaces: 1, refineLandmarks: true, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });

faceMesh.onResults((results) => {
  if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
    const landmarks = results.multiFaceLandmarks[0];

    const leftClosed = isEyeClosed(landmarks, true);
    const rightClosed = isEyeClosed(landmarks, false);
    if (leftClosed && rightClosed) {
      console.log("まばたき検出");
      blinkCooldown = 5; // クールダウン
      return;
    }

    if (blinkCooldown > 0) {
      blinkCooldown--;
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

    const { state, smoothDiff, diffL, diffR, dYaw, dPitch } = isLookingCenter(landmarks);
    //console.log(`[Gaze] state=${state} diff=${smoothDiff.toFixed(4)} L=${diffL.toFixed(4)} R=${diffR.toFixed(4)} dYaw=${(dYaw*57.3).toFixed(1)} dPitch=${(dPitch*57.3).toFixed(1)}`);

    gazePenaltyRaw += smoothDiff;

    const THRESHOLD_WARN = 0.12;
    const deviationRatio = Math.min(1, smoothDiff / THRESHOLD_WARN);
    const lightness = 50 * deviationRatio;
    document.body.style.backgroundColor = `hsl(0, 100%, ${lightness}%)`;
  }
});

const camera = new Camera(video, {
  onFrame: async () => {
    frameCounter++;
    if (frameCounter % 3 === 0) { // 3フレームに1回だけ実行
      await faceMesh.send({ image: video });
    }
  },
  width: 640, height: 360
});
camera.start();

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
//let swapCount;
let cupOrder = [];
let ballIndex = 0;
let difficulty = null;
let config = { swapCount: 5, cupOrder: [0, 1, 2] };
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
//start
function showDifficultyUI() {
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
      cups = createCups(3);
      config = { swapCount: 3, cupOrder: [0, 1, 2], cupPositions: positionsTriangleLike(rect, 120) };
    }
    if (level === "normal") {
      cups = createCups(3);
      config = { swapCount: 5, cupOrder: [0, 1, 2], cupPositions: positionsTriangleLike(rect, 180) };
    }
    if (level === "hard") {
      cups = createCups(4);
      config = { swapCount: 5, cupOrder: [0, 1, 2, 3], cupPositions: positionsRectangle(rect, 180) };
    }
    Object.assign(iframe.style, { pointerEvents: "none" });
    wrap.remove();
    playVideo();
    unMuteVideo();
    gamestart();
    startTimer();


  }
  btnEasy.addEventListener("click", () => { pick("easy"); });
  btnNormal.addEventListener("click", () => { pick("normal"); });
  btnHard.addEventListener("click", () => { pick("hard"); });

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

document.getElementById("restart_btn").addEventListener("click", () => {
  //document.getElementById("cups-container").style.position = "relative";
  gamestart()
});

window.addEventListener("load", () => {
  const container = document.getElementById("cups-container");
  container.style.position = "relative";
  const waitForCalibration = setInterval(() => {
    if (window.isCalibrationDone) {
      clearInterval(waitForCalibration);
    }
  }, 100);
});

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
    { top: rect.y - offset, left: rect.x + rect.w / 2 - 30 }, // 上中央
    { top: rect.y + rect.h / 2 - 30, left: rect.x - offset }, // 左中央
    { top: rect.y + rect.h / 2 - 30, left: rect.x + rect.w + offset - 60 } // 右中央
  ];
}

// 4個のとき
function positionsRectangle(rect, offset) {
  return [
    { top: rect.y - offset, left: rect.x - rect.w / 4 },      // 上
    { top: rect.y - offset, left: rect.x + (rect.w / 4) * 5 },// 上右
    { top: rect.y + rect.h + offset - 160, left: rect.x - rect.w / 4 },   // 下左
    { top: rect.y + rect.h + offset - 160, left: rect.x + (rect.w / 4) * 5 - 80 } // 下右
  ];
}

function gamestart() {
  ballIndex = Math.floor(Math.random() * cups.length);
  cupOrder = Array.from({ length: config.cupOrder.length }, (_, i) => i);

  cups.forEach((cup, i) => {
    cup.style.backgroundColor = "gray";
    const pos = config.cupPositions[i];
    cup.style.position = "absolute";
    cup.style.top = `${pos.top}px`;
    cup.style.left = `${pos.left}px`;

  });

  cups[ballIndex].style.backgroundColor = "red";

  setTimeout(() => {
    cups.forEach(cup => cup.style.backgroundColor = "gray");
    shuffleCups(config.swapCount);
  }, 3000);
  console.log("start");
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
