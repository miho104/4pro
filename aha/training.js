const iframe = document.getElementById("video-frame");
const params = new URLSearchParams(window.location.search);
const videoId = params.get("v") || params.get("videoId") || "dQw4w9WgXcQ";
iframe.src = `https://www.youtube.com/embed/${videoId}?enablejsapi=1&rel=0&playsinline=1`;

//api導入
window.onYouTubeIframeAPIReady = function() {
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
                playerReady=true;
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

//==============視線予測================
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
        prevOutline = outline.map(p => ({...p}));
        return false;
    }

    let totalDist = 0;
    for (let i = 0; i < outline.length; i++) {
        const dx = outline[i].x - prevOutline[i].x;
        const dy = outline[i].y - prevOutline[i].y;
        const dz = outline[i].z - prevOutline[i].z;
        totalDist += Math.sqrt(dx*dx + dy*dy + dz*dz);
    }
    const avgDist = totalDist / outline.length;
    prevOutline = outline.map(p => ({...p}));
    //console.log(avgDist);
    return avgDist > 0.015; // 姿勢変化のしきい値 もっと大きくてもいい
}

function getNormalizedEyePos(landmarks, isLeft = true) {
    const [innerIdx, outerIdx, topIdx, bottomIdx, irisStart, irisEnd] = isLeft
        ? [133, 33, 159, 145, 468, 473]  // 左目
        : [362, 263, 386, 374, 473, 478]; // 右目

    const inner = landmarks[innerIdx];
    const outer = landmarks[outerIdx];
    const top = landmarks[topIdx];
    const bottom = landmarks[bottomIdx];
    const iris = avg(landmarks.slice(irisStart, irisEnd));

    const eyeWidth = outer.x - inner.x;
    const eyeCenterX = (inner.x + outer.x) / 2;
    const eyeCenterY = (top.y + bottom.y) / 2;

    return {
        x: (iris.x - eyeCenterX) / eyeWidth,
        y: (iris.y - eyeCenterY) / eyeWidth,
        iris
    };
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

function smooth(value){
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
        return {smoothDiff: 0, diffL: 0, diffR: 0, dYaw: 0, dPitch: 0 };
    }

    const pose = getHeadPose(landmarks);
    const dYaw = pose.yaw - basePose.yaw;
    const dPitch = pose.pitch - basePose.pitch;

    const verticalSensitivity = 5.0;

    const diffLx = (left.x - baseLeft.x) - dYaw * yawScale;
    const diffLy = ((left.y - baseLeft.y) - dPitch * pitchScale) * verticalSensitivity;
    const diffRx = (right.x - baseRight.x) - dYaw * yawScale;
    const diffRy = ((right.y - baseRight.y) - dPitch * pitchScale) * verticalSensitivity;

    const distL = Math.sqrt(diffLx * diffLx + diffLy * diffLy);
    const distR = Math.sqrt(diffRx * diffRx + diffRy * diffRy);
    const diff = Math.max(distL, distR);
    const smoothDiff = smooth(diff);

    //const THRESHOLD_OK = 0.08;
    //const THRESHOLD_WARN = 0.12;

    return {smoothDiff, diffL: distL, diffR: distR, dYaw, dPitch };
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
            blinkCooldown =5;//クールダウン
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

        const { smoothDiff } = isLookingCenter(landmarks);
        //console.log(`[Gaze] state=${state} diff=${smoothDiff.toFixed(4)} L=${diffL.toFixed(4)} R=${diffR.toFixed(4)} dYaw=${(dYaw*57.3).toFixed(1)} dPitch=${(dPitch*57.3).toFixed(1)}`);

        gazePenaltyRaw += smoothDiff;

        const THRESHOLD_WARN = 0.12;
        let deviationRatio = Math.min(1, smoothDiff / THRESHOLD_WARN);
        deviationRatio = deviationRatio ** 2;
        const saturation = 95 * deviationRatio;
        const lightness = 26 * deviationRatio;
        document.body.style.backgroundColor = `hsl(0, ${saturation}%, ${lightness}%)`;
    }
});

const camera = new Camera(video, {
    onFrame: async () => {
        frameCounter++;
        if (frameCounter % 3 === 0) {//3フレームに1回実行
            await faceMesh.send({ image: video });
        }
        //await faceMesh.send({ image: video });
    },
    width: 640, height: 360
});


// =================== ゲーム本体 ===================
const SHAPES = ["circle", "triangle", "square", "star", "pentagon"];
const COLORS = ["#f87171", "#60a5fa", "#34d399", "#fbbf24", "#a78bfa", "#f472b6"];
const SIZES  = [60, 80, 100];

const AVOID_PAD = 16;
const CELL_INSET = 10;
const MIN_CELL_WH = 30;
const TARGET_TOTAL_CELLS = 22;

let score = 0;
let All_Penalty = 0;
let corrects = 0;
let misses = 0;

let difficulty=null;
let config = {};
let player;
let playerReady = false;

const startArea = document.querySelector(".start");
let intervalSeconds = 0;
let nextIntervalTime = 0;

let currentRoundStartMs = 0;
let duration = 0;

let ahaTargetElement = null;

let rounds = 0;
let maxShapes =7;
let startTime = null;
let pausedAt = 0;
let running = null;

// ラウンド状態
let ahaActive = false;
let ahaRounds = 0;
let ahaCorrectDir = null;// "up" | "down" | "left" | "right"
let ahaCleanup = null;
let ahaKeydownBound = null;//ハンドラ退避
let preselectedDir = null;//2段階選択用の方向

const AHA = {
    morphMs:5000,// 色変化にかける時間
    popinMs: 7000,// 新規出現のフェード時間
    afterAnswerFreezeMs: 1500,// 回答演出時間
    roundCount: 3,// 1ミニゲーム内のラウンド数
    chooseMode: () => (Math.random() < 0.5 ? "popin" : "colormorph"),
};

function clearSelectionHighlights() {
    zoneSvgs.forEach(z => {
        z.svg.style.backgroundColor = "transparent";
    });
}

function highlightSelection(dir) {
    clearSelectionHighlights();
    if (!dir) return;

    zoneSvgs.forEach(z => {
        const center = zoneCenter(z.rect);
        if (mainDirectionFromPoint(center) === dir) {
            z.svg.style.backgroundColor = "rgba(255, 255, 0, 0.2)";
        }
    });
}

//apiコマンド
function playVideo() { if (playerReady) {
    player.playVideo();
} else {
    console.warn('player not ready yet');
}}
function pauseVideo() { player.pauseVideo(); }
function unMuteVideo() { if (playerReady) {
    player.unMute();
} else {
    console.warn('player not ready yet');
} }

//タイマー
function startTimer() {
    if (running) return;
    startTime = performance.now() - pausedAt;//再開時はpauseした位置から
    running = true;
    timerId = requestAnimationFrame(tick);
    nextIntervalTime = intervalSeconds;//目標時間
    console.log("timer start"+nextIntervalTime)//デバック用
}

function pauseTimer() {
    if (!running) return;
    pausedAt = performance.now() - startTime;
    running = false;
    console.log("timer stop")//デバック用
    cancelAnimationFrame(timerId);
}

function tick() {
    if (!running) return;
    const elapsed = (performance.now() - startTime) / 1000;//秒

    if (elapsed >= nextIntervalTime) {
        console.log("指定間隔到達:", nextIntervalTime, "秒");
        startMiniGame();//2回目以降のミニゲーム
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
        const minutes = parseFloat(durationInput.value);
                    if (!isNaN(minutes) && minutes > 0) {
                        intervalSeconds = minutes * 60;
                        console.log("ミニゲーム間隔:", intervalSeconds, "秒");            startArea.innerHTML = "";

            showDifficultyUI();
        } else {
            alert("正しい数値を入力してください");
        }
    });
});

// 難易度 UI
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
        if (level === "easy") config = { rounds: 3, maxShapes: 7 };
        if (level === "normal") config = { rounds: 5, maxShapes: 10 };
        if (level === "hard") config = { rounds: 5, maxShapes: 12 };
        wrap.remove();
        showConfirmUI();
    }
    btnEasy.addEventListener("click", () => pick("easy"));
    btnNormal.addEventListener("click", () => pick("normal"));
    btnHard.addEventListener("click", () => pick("hard"));
}

//再生
function showConfirmUI() {
    const btnConfirm = document.createElement('button');
    btnConfirm.id = 'btn-confirm';
    btnConfirm.textContent = 'WASD or 矢印キーで回答';
    btnConfirm.className = 'btn';
    startArea.appendChild(btnConfirm);

    btnConfirm.addEventListener('click', () => {
        console.log("clicked");
        btnConfirm.remove(); // 先にボタンを削除
        document.getElementById('target-overlay')?.remove();

        const startPlayback = () => {
            Object.assign(iframe.style, { pointerEvents: "none" });
            camera.start();
            playVideo();
            unMuteVideo();
            startMiniGame();
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
    });
}

//ボタン
document.getElementById("btn-stop")?.addEventListener("click", (e) => {
    console.log("stopbtn clicked")
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
    //calibratingNow = true;
    console.log("[視線] Recalibration requested.");
});

document.getElementById("btn-end")?.addEventListener("click", () => {
    const totalPicks = corrects + misses;
    alert([
        `終了！`,
        `正解: ${corrects} / ミス: ${misses}（正解率 ${(totalPicks ? (corrects / totalPicks * 100) : 0).toFixed(1)}%）`,
        `総合スコア: ${score.toLocaleString()}`,
        `総ペナルティ: ${All_Penalty}`
    ].join('\n'));
    setTimeout(clearBoard, 500);
});

//＝＝＝＝＝＝＝ゲーム内部＝＝＝＝＝＝＝＝＝
function screenCenter() {
    return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
}

function mainDirectionFromPoint(pt) {
    const v = getVideoRect();
    const left = v.x;
    const right = v.x + v.w;
    const top = v.y;
    const bottom = v.y + v.h;
    const cx = v.x + v.w / 2;
    const cy = v.y + v.h / 2;

    if (pt.x >= left && pt.x <= right) {
        if (pt.y < top) return "up";
        if (pt.y > bottom) return "down";
    }

    if (pt.x < left) return "left";
    if (pt.x > right) return "right";

    return Math.abs(pt.x - cx) > Math.abs(pt.y - cy)
        ? (pt.x > cx ? "right" : "left")
        : (pt.y > cy ? "down" : "up");
}

function zoneCenter(z) {
    return { x: z.x + z.w / 2, y: z.y + z.h / 2 };
}

function lerpColor(c1, c2, t) {
    const a = c1.match(/\w\w/g).map(h => parseInt(h, 16));
    const b = c2.match(/\w\w/g).map(h => parseInt(h, 16));
    const m = a.map((v, i) => Math.round(v + (b[i] - v) * t));
    return `#${m.map(v => v.toString(16).padStart(2, '0')).join('')}`;
}
function getFillOfGroup(g) {
    const child = g.firstElementChild;
    return child?.getAttribute("fill") ?? "#888888";
}
function setFillOfGroup(g, color) {
    const child = g.firstElementChild;
    if (child) child.setAttribute("fill", color);
}

function spawnPopIn(zoneIndex, type) {
    const z = zoneSvgs[zoneIndex];
    if (!z) return null;

    const size = randItem(SIZES);

    // ゾーンの中心に配置
    const x = z.rect.w / 2;
    const y = z.rect.h / 2;

    const g = svg("g", { class: "shape" });
    g.dataset.type = type;
    g.setAttribute("transform", `rotate(${randInt(0, 359)}, ${x}, ${y})`);
    drawShape(g, type, x, y, size, randItem(COLORS));
    g.style.opacity = "0";
    z.svg.appendChild(g);
    const t0 = performance.now();
    const anim = () => {
        const t = (performance.now() - t0) / AHA.popinMs;
        if (t >= 1) { g.style.opacity = "1"; return; }
        g.style.opacity = String(Math.max(0, Math.min(1, t)));
        requestAnimationFrame(anim);
    };
    requestAnimationFrame(anim);
    return g;
}

function startColorMorph(zoneIndex) {
    const z = zoneSvgs[zoneIndex];
    if (!z) return null;

    const shapes = Array.from(z.svg.querySelectorAll("g.shape"));
    if (!shapes.length) return null;

    const g = shapes[(Math.random() * shapes.length) | 0];
    const from = getFillOfGroup(g);
    let to = randItem(COLORS);
    let safety = 10;
    while (to.toLowerCase() === from.toLowerCase() && safety-- > 0) to = randItem(COLORS);

    const t0 = performance.now();
    let killed = false;
    const step = () => {
        if (killed) return;
        const t = (performance.now() - t0) / AHA.morphMs;
        const clamped = Math.max(0, Math.min(1, t));
        setFillOfGroup(g, lerpColor(from.replace('#', ''), to.replace('#', ''), clamped));
        if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);

    return {
        group: g,
        stop: () => { killed = true; },
    };
}

function startAhaRound() {
    ahaActive = true;
    gazePenaltyRaw = 0;
    makeBoard();

    const categorizedZones = { up: [], down: [], left: [], right: [] };
    for (const z of zoneSvgs) {
        const dir = mainDirectionFromPoint(zoneCenter(z.rect));
        if (categorizedZones[dir]) {
            categorizedZones[dir].push(z);
        }
    }

    for (const dir in categorizedZones) {
        categorizedZones[dir].sort(() => 0.5 - Math.random());
    }

    const totalShapes = Math.min(zoneSvgs.length, config.maxShapes);
    const shapesPerCategory = Math.floor(totalShapes / 4);
    let remainder = totalShapes % 4;
    const dirs = ["up", "down", "left", "right"];
    const zonesToFill = [];

    for (const dir of dirs) {
        let count = shapesPerCategory;
        if (remainder > 0) {
            count++;
            remainder--;
        }
        const selected = categorizedZones[dir].slice(0, count);
        zonesToFill.push(...selected);
    }

    zonesToFill.forEach(z => {
        const type = randItem(SHAPES);
        const color = randItem(COLORS);
        const size = randItem(SIZES);

        const x = z.rect.w / 2;
        const y = z.rect.h / 2;

        const g = svg("g", { class: "shape" });

        g.dataset.type = type;
        g.setAttribute("transform", `rotate(${randInt(0, 359)}, ${x}, ${y})`);
        drawShape(g, type, x, y, size, color);
        z.svg.appendChild(g);
        z.busy = true;
    });

    let mode = AHA.chooseMode();
    let morphCtrl = null;
    let zoneIndex = -1;

    if (mode === "popin") {
        const availableZones = zoneSvgs.filter(z => !z.busy);
        if (availableZones.length > 0) {
            const targetZone = randItem(availableZones);
            zoneIndex = zoneSvgs.indexOf(targetZone);
        } else {
            console.log("No available zones for pop-in, switching to color morph.");
            mode = "colormorph";
        }
    }

    if (mode === "colormorph") {
        const busyZones = zoneSvgs.filter(z => z.busy);
        if (busyZones.length > 0) {
            const targetZone = randItem(busyZones);
            zoneIndex = zoneSvgs.indexOf(targetZone);
        } else {
            // colormorphもpopinもできない場合
            console.warn("No zones available for any mode. Skipping round.");
            setTimeout(nextAhaStep, 100);
            return;
        }
    }
    
    if (zoneIndex === -1) {
        console.error("Could not determine a valid zone for the round. Ending game.");
        endAhaGame();
        return;
    }

    const center = zoneCenter(zoneSvgs[zoneIndex].rect);
    ahaCorrectDir = mainDirectionFromPoint(center);

    if (mode === "popin") {
        const type = randItem(SHAPES);
        ahaTargetElement = spawnPopIn(zoneIndex, type);
        if (ahaTargetElement) {
            zoneSvgs[zoneIndex].busy = true;
        } else {
            console.warn(`Pop-in failed for zone ${zoneIndex}. Skipping round.`);
            setTimeout(nextAhaStep, 100);
            return;
        }
    } else {
        morphCtrl = startColorMorph(zoneIndex);
        if (morphCtrl) {
            ahaTargetElement = morphCtrl.group;
        } else {
            console.warn(`Color morph failed for zone ${zoneIndex}. Skipping round.`);
            setTimeout(nextAhaStep, 100);
            return;
        }
    }

    ahaCleanup = () => {
        morphCtrl?.stop?.();
    };

    if (!ahaKeydownBound) {
        ahaKeydownBound = onAhaKeyDown;
        window.addEventListener("keydown", ahaKeydownBound, { passive: true });
    }
}

// 回答処理
function onAhaKeyDown(ev) {
    if (!ahaActive) return;
    const key = ev.key.toLowerCase();
    let dir = null;
    if (key === "arrowup" || key === "w") dir = "up";
    else if (key === "arrowdown" || key === "s") dir = "down";
    else if (key === "arrowleft" || key === "a") dir = "left";
    else if (key === "arrowright" || key === "d") dir = "right";
    if (!dir) return;

    if (dir === preselectedDir) {
        const correct = (dir === ahaCorrectDir);
        clearSelectionHighlights();

        // スコア計算
        const clearMs = performance.now() - currentRoundStartMs;
        const speedComponent = Math.max(500, Math.round(10000 - clearMs));
        const penalty = Math.round((gazePenaltyRaw * 100) ** 2 * 0.05);
        const baseScore = 3000;//基本点

        if (correct) {
            corrects++;
            score += Math.max(0, baseScore + speedComponent - penalty);
            All_Penalty += penalty;
            highlightElement(ahaTargetElement, true);
        } else {
            misses++;
            score += Math.max(0, -penalty);
            smallShake();
            setTimeout(() => {
                highlightElement(ahaTargetElement, true);
            }, 400);
        }
        // ラウンド終了処理
        ahaCleanup?.();
        nextAhaStep();
    }
    //選択し直し
    else {
        preselectedDir = dir;
        highlightSelection(dir);
    }
}

//正解不正解ハイライト
function highlightElement(el, shouldScale = false) {
    if (!el || !el.firstElementChild) return;
    const child = el.firstElementChild;
    const originalStroke = child.getAttribute("stroke");
    const originalStrokeWidth = child.getAttribute("stroke-width");
    const originalTransform = el.getAttribute("transform") || "";

    child.setAttribute("stroke", "#ffffff");
    child.setAttribute("stroke-width", "5");

    if (shouldScale) {
        const rotateMatch = originalTransform.match(/rotate\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/);
        const angle = rotateMatch ? rotateMatch[1] : 0;
        const cx = rotateMatch ? rotateMatch[2] : 0;
        const cy = rotateMatch ? rotateMatch[3] : 0;
        
        const scale = 1.2;
        const newTransform = `translate(${cx}, ${cy}) scale(${scale}) translate(${-cx}, ${-cy}) ${originalTransform}`;
        
        el.setAttribute("transform", newTransform);
        el.style.transition = "transform 0.2s ease-out";

        setTimeout(() => {
            if (originalStroke) {
                child.setAttribute("stroke", originalStroke);
            } else {
                child.removeAttribute("stroke");
            }
            if (originalStrokeWidth) {
                child.setAttribute("stroke-width", originalStrokeWidth);
            }
            el.setAttribute("transform", originalTransform);
            el.style.transition = "";
        }, AHA.afterAnswerFreezeMs);
    }
}

function smallShake() {
    document.body.animate(
        [
            { transform: "translate(0,0)" },
            { transform: "translate(-15px,0)" },
            { transform: "translate(15px,0)" },
            { transform: "translate(0,0)" },
        ],
        { duration: 120, iterations:3 }
    );
}

//ミニゲーム進行管理
function nextAhaStep() {
    ahaRounds++;
    preselectedDir = null;
    clearSelectionHighlights();
    ahaActive = false;

    const delay = AHA.afterAnswerFreezeMs + 200;

    if (ahaRounds >= config.rounds) {
        setTimeout(() => {
            endAhaGame();
        }, delay);
    } else {
        // 次のラウンドへ
        setTimeout(() => {
            ahaActive = true;
            currentRoundStartMs = performance.now();
            startAhaRound();
        }, delay);
    }
}

function endAhaGame() {
    clearBoard();
    document.getElementById('hourglass-container').style.display = 'block'; //後で砂時計を表示
    pausedAt = 0;
    startTimer();
    ahaActive = false;
    preselectedDir = null;
    clearSelectionHighlights();

    if (ahaKeydownBound) {
        window.removeEventListener("keydown", ahaKeydownBound);
        ahaKeydownBound = null;
    }
}

function startMiniGame() {
    pauseTimer();
    ahaActive = true;
    ahaRounds = 0;
    currentRoundStartMs = performance.now();
    document.getElementById('hourglass-container').style.display = 'none';//砂時計を非表示
    startAhaRound();
}

function clearBoard() {
    for (const z of zoneSvgs) {
        while (z.svg.firstChild) z.svg.firstChild.remove();
    }
}

function drawShape(group, type, x, y, s, fill) {
    switch (type) {
        case "circle":
            group.appendChild(svg("circle", { cx: x, cy: y, r: s / 2, fill })); break;
        case "square": {
            const half = s / 2;
            group.appendChild(svg("rect", { x: x - half, y: y - half, width: s, height: s, fill })); break;
        }
        case "triangle": {
            const h = s * Math.sqrt(3) / 2;
            const pts = [
                [x, y - (2 / 3) * h],
                [x - s / 2, y + (1 / 3) * h],
                [x + s / 2, y + (1 / 3) * h]
            ].map(p => p.join(",")).join(" ");
            group.appendChild(svg("polygon", { points: pts, fill })); break;
        }
        case "star": {
            const outer = s / 2, inner = s / 4, pts = [];
            for (let i = 0; i < 10; i++) {
                const r = (i % 2 === 0) ? outer : inner;
                const a = -Math.PI / 2 + i * (Math.PI / 5);
                pts.push([x + r * Math.cos(a), y + r * Math.sin(a)]);
            }
            group.appendChild(svg("polygon", { points: pts.map(p => p.join(",")).join(" "), fill })); break;
        }
        case "pentagon": {
            const rr = s / 2, pts = [];
            for (let i = 0; i < 5; i++) {
                const a = -Math.PI / 2 + i * (2 * Math.PI / 5);
                pts.push([x + rr * Math.cos(a), y + rr * Math.sin(a)]);
            }
            group.appendChild(svg("polygon", { points: pts.map(p => p.join(",")).join(" "), fill })); break;
        }
    }
}

let zoneSvgs = [];
const randItem = (arr) => arr[(Math.random() * arr.length) | 0];
const randInt = (min, max) => (Math.random() * (max - min + 1) + min) | 0;
const svgNS = "http://www.w3.org/2000/svg";

function svg(tag, attrs) {
    const el = document.createElementNS(svgNS, tag);
    for (const k in attrs) el.setAttribute(k, String(attrs[k]));
    return el;
}
const rect = (x, y, w, h) => ({ x, y, w, h });
const intersects = (a, b) => !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
const inflate = (r, p) => ({ x: r.x - p, y: r.y - p, w: r.w + p * 2, h: r.h + p * 2 });

function getVideoRect() {
    const r = iframe.getBoundingClientRect();
    return rect(r.left, r.top, r.width, r.height);
}
function getControlsRect() {
    return { x: 0, y: 16, w: 210, h: 40 };
}

function rebuildZoneSvgs(zones) {
    for (const z of zoneSvgs) z.svg.remove();
    zoneSvgs = [];
    for (const z of zones) {
        const s = document.createElementNS(svgNS, "svg");
        s.setAttribute("viewBox", `0 0 ${z.w} ${z.h}`);
        s.setAttribute("width", z.w);
        s.setAttribute("height", z.h);
        Object.assign(s.style, {
            position: 'fixed',
            left: `${z.x}px`, top: `${z.y}px`,
            width: `${z.w}px`, height: `${z.h}px`,
            zIndex: '1001',
            pointerEvents: 'none',
            //outline: "1px dashed rgba(0,255,0,.35)" // デバッグ線
        });
        document.body.appendChild(s);
        zoneSvgs.push({ svg: s, rect: z, busy: false });
    }
}
//ゾーン生成
function buildZonesByGuides() {
    const W = window.innerWidth, H = window.innerHeight;
    const v = getVideoRect();
    const c = getControlsRect();

    const xs = new Set([0, W, W / 2]);
    const ys = new Set([0, H, H / 2]);

    [v].forEach(r => {
        xs.add(Math.max(0, Math.round(r.x - AVOID_PAD)));
        xs.add(Math.min(W, Math.round(r.x + r.w + AVOID_PAD)));
        ys.add(Math.max(0, Math.round(r.y - AVOID_PAD)));
        ys.add(Math.min(H, Math.round(r.y + r.h + AVOID_PAD)));
    });

    const xArr = Array.from(xs).sort((a, b) => a - b);
    const yArr = Array.from(ys).sort((a, b) => a - b);

    const avoidVideo = inflate(v, 6);
    let cells = [];

    for (let xi = 0; xi < xArr.length - 1; xi++) {
        const x0 = xArr[xi], x1 = xArr[xi + 1];
        const w = x1 - x0; if (w <= 0) continue;
        for (let yi = 0; yi < yArr.length - 1; yi++) {
            const y0 = yArr[yi], y1 = yArr[yi + 1];
            const h = y1 - y0; if (h <= 0) continue;
            const cell = { x: x0, y: y0, w, h };
            if (intersects(cell, avoidVideo)) continue;
            const inset = {
                x: cell.x + CELL_INSET,
                y: cell.y + CELL_INSET,
                w: Math.max(0, cell.w - 2 * CELL_INSET),
                h: Math.max(0, cell.h - 2 * CELL_INSET),
            };
            if (inset.w >= MIN_CELL_WH && inset.h >= MIN_CELL_WH) cells.push(inset);
        }
    }

    // ボタン領域くり抜き
    const cut = inflate(c, AVOID_PAD);
    if (cut.w > 0 && cut.h > 0) {
        const next = [];
        for (const cell of cells) next.push(...cutOutCellByObstacle(cell, cut));
        cells = next;
    }

    const finalCells = [];
    for (const cell of cells) {
        if (cell.w > cell.h * 1.8 && cell.w > MIN_CELL_WH * 2.5) {
            const halfW = cell.w / 2;
            const newCell1 = { x: cell.x, y: cell.y, w: halfW, h: cell.h };
            const newCell2 = { x: cell.x + halfW, y: cell.y, w: halfW, h: cell.h };
            if (newCell1.w >= MIN_CELL_WH) finalCells.push(newCell1);
            if (newCell2.w >= MIN_CELL_WH) finalCells.push(newCell2);
        } else {
            finalCells.push(cell);
        }
    }

    return finalCells
    .filter(c => c.w >= 80 && c.h >= 80)
    .slice(0, TARGET_TOTAL_CELLS);
}

function cutOutCellByObstacle(cell, obstacle) {
    const ov = rectOverlap(cell, obstacle);
    if (ov.w <= 0 || ov.h <= 0) return [cell];
    const out = [];
    if (ov.y - cell.y >= MIN_CELL_WH) out.push({ x: cell.x, y: cell.y, w: cell.w, h: ov.y - cell.y });
    if (cell.y + cell.h - (ov.y + ov.h) >= MIN_CELL_WH) out.push({ x: cell.x, y: ov.y + ov.h, w: cell.w, h: cell.y + cell.h - (ov.y + ov.h) });
    if (ov.x - cell.x >= MIN_CELL_WH) out.push({ x: cell.x, y: ov.y, w: ov.x - cell.x, h: ov.h });
    if (cell.x + cell.w - (ov.x + ov.w) >= MIN_CELL_WH) out.push({ x: ov.x + ov.w, y: ov.y, w: cell.x + cell.w - (ov.x + ov.w), h: ov.h });
    return out.map(r => ({
        x: r.x + CELL_INSET,
        y: r.y + CELL_INSET,
        w: Math.max(0, r.w - 2 * CELL_INSET),
        h: Math.max(0, r.h - 2 * CELL_INSET),
    })).filter(r => r.w >= MIN_CELL_WH && r.h >= MIN_CELL_WH);
}

function cutOutCellByObstacle(cell, obstacle) {
    const ov = rectOverlap(cell, obstacle);
    if (ov.w <= 0 || ov.h <= 0) return [cell];
    const out = [];
    if (ov.y - cell.y >= MIN_CELL_WH) out.push({ x: cell.x, y: cell.y, w: cell.w, h: ov.y - cell.y });
    if (cell.y + cell.h - (ov.y + ov.h) >= MIN_CELL_WH) out.push({ x: cell.x, y: ov.y + ov.h, w: cell.w, h: cell.y + cell.h - (ov.y + ov.h) });
    if (ov.x - cell.x >= MIN_CELL_WH) out.push({ x: cell.x, y: ov.y, w: ov.x - cell.x, h: ov.h });
    if (cell.x + cell.w - (ov.x + ov.w) >= MIN_CELL_WH) out.push({ x: ov.x + ov.w, y: ov.y, w: cell.x + cell.w - (ov.x + ov.w), h: ov.h });
    return out.map(r => ({
        x: r.x + CELL_INSET,
        y: r.y + CELL_INSET,
        w: Math.max(0, r.w - 2 * CELL_INSET),
        h: Math.max(0, r.h - 2 * CELL_INSET),
    })).filter(r => r.w >= MIN_CELL_WH && r.h >= MIN_CELL_WH);
}

function rectOverlap(a, b) {
    const x0 = Math.max(a.x, b.x);
    const y0 = Math.max(a.y, b.y);
    const x1 = Math.min(a.x + a.w, b.x + b.w);
    const y1 = Math.min(a.y + a.h, b.y + b.h);
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function makeBoard() {
    for (const z of zoneSvgs) z.svg.remove();
    zoneSvgs = [];

    const zones = buildZonesByGuides();
    if (!zones.length) return;
    rebuildZoneSvgs(zones);
}