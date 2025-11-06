const iframe = document.getElementById("video-frame");
const params = new URLSearchParams(window.location.search);
const videoId = params.get("v") || params.get("videoId") || "dQw4w9WgXcQ";
iframe.src = `https://www.youtube.com/embed/${videoId}?enablejsapi=1&rel=0&playsinline=1`;

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

//視線予測
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
            blinkCooldown =5; // クールダウン
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
        const saturation = 95 * deviationRatio;
        const lightness = 26 * deviationRatio;
        document.body.style.backgroundColor = `hsl(0, ${saturation}%, ${lightness}%)`;
    }
});

const camera = new Camera(video, {
    onFrame: async () => {
        frameCounter++;
        if (frameCounter % 3 === 0) { // 3フレームに1回だけ実行
            await faceMesh.send({ image: video });
        }
        //await faceMesh.send({ image: video });
    },
    width: 640, height: 360
});


// =================== ゲーム本体 ===================
const SHAPES = ["circle", "triangle", "square", "star", "pentagon"];
const COLORS = ["#f87171", "#60a5fa", "#34d399", "#fbbf24", "#a78bfa", "#f472b6"];
const SIZES = [80, 100, 120];
const MIN_SHAPE_SIZE = 80;

const AVOID_PAD = 16;
const CELL_INSET = 10;
const MIN_CELL_WH = 44;
const TARGET_TOTAL_CELLS = 12;

let score = 0;
let targetShape = null;
let hits = 0;
let misses = 0;
let remainingTarget = 0;


let currentRoundStartMs = 0;
let currentRoundTargetSizes = [];

let duration = 0;
let gameActive = false;
let rounds = 0;
let timerId = null;
let startTime = null;
let pausedAt = 0;
let running = false;

let difficulty = null;
let config = { rounds: 3, targetRatio: 0.4 };

let intervalSeconds = 0;
let nextIntervalTime = 0;
const startArea = document.querySelector(".start");

let player;
let playerReady = false;


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
    startTime = performance.now() - pausedAt;
    running = true;
    timerId = requestAnimationFrame(tick);
    nextIntervalTime = intervalSeconds; // 最初の目標時間
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
        nextIntervalTime += intervalSeconds; // 次の目標時間を更新
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
            console.log("ミニゲーム間隔:", intervalSeconds, "秒");
            startArea.innerHTML = "";

            showDifficultyUI();
        } else {
            alert("正しい数値を入力してください");
        }
    });
});

// 難易度 UI
//start
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
        if (level === "easy") config = { rounds: 3, targetRatio: 0.5 };
        if (level === "normal") config = { rounds: 3, targetRatio: 0.4 };
        if (level === "hard") config = { rounds: 3, targetRatio: 0.3 };
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
    btnConfirm.textContent = '覚えたらクリック';
    btnConfirm.className = 'btn';
    startArea.appendChild(btnConfirm);

    if (!targetShape) targetShape = randItem(SHAPES);
    if (!targetShape) targetShape = randItem(SHAPES);

    //お手本図形
    const r = iframe.getBoundingClientRect();
    const ov = document.createElement("div");
    ov.id = "target-overlay";
    Object.assign(ov.style, {
        position: "absolute",
        left: `${r.x}px`,
        top: `${r.y}px`,
        width: `${r.width}px`,
        height: `${r.height}px`,
        display: "grid",
        placeItems: "center",
        zIndex: 1800,
        pointerEvents: "none",
    });
    const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const px = Math.min(r.width, r.height) * 0.28;
    s.setAttribute("viewBox", `0 0 ${px} ${px}`);
    s.setAttribute("width", px);
    s.setAttribute("height", px);
    const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    drawShape(g, targetShape ?? randItem(SHAPES), px / 2, px / 2, px * 0.9, "#10d1cf");
    s.appendChild(g);
    ov.appendChild(s);
    document.body.appendChild(ov);

    btnConfirm.addEventListener('click', () => {
        camera.start();
        const startPlayback = () => {
            Object.assign(iframe.style, { pointerEvents: "none" });
            playVideo();
            unMuteVideo();
            startTimer();
            startMiniGame();
            btnConfirm.remove();
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
    });
}
// ミニゲーム進行
function startMiniGame() {
    pauseTimer();
    if (gameActive) return;
    gameActive = true;
    rounds = 0;
    document.getElementById('hourglass-container').style.display = 'none';//砂時計を非表示
    if (!targetShape) targetShape = randItem(SHAPES);
    runRound();
}

function runRound() {
    if (rounds >= config.rounds) {
        endMiniGame();
        return;
    }
    rounds++;
    currentRoundTargetSizes = [];
    currentRoundStartMs = performance.now();
    document.getElementById('hourglass-container').style.display = 'none';//砂時計を非表示
    makeBoard();
}

function endMiniGame() {
    clearBoard();
    document.getElementById('hourglass-container').style.display = 'block';
    gameActive = false;
    pausedAt = 0;
    startTimer();
    console.log("ミニゲーム終了");
}

function clearBoard() {
    for (const z of zoneSvgs) z.svg.remove();
    zoneSvgs = [];
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
    calibratingNow = true;
    console.log("[視線] Recalibration requested.");
});

document.getElementById("btn-end")?.addEventListener("click", () => {
    const totalPicks = hits + misses;
    alert([
        `終了！`,
        `正解: ${hits} / ミス: ${misses}（正解率 ${(totalPicks ? (hits / totalPicks * 100) : 0).toFixed(1)}%）`,
        `総合スコア: ${score.toLocaleString()}`
    ].join('\n'));
    clearBoard();
});

//図形＆ゾーン
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
            //outline: "1px dashed rgba(0,255,0,.35)"//デバック用
        });
        document.body.appendChild(s);
        zoneSvgs.push({ svg: s, rect: z, busy: false });
    }
}

function spawnInZone(zoneIndex, type, color, size) {
    const z = zoneSvgs[zoneIndex];
    if (!z || z.busy) return false;
    const pad = size / 2 + 6;
    if (z.rect.w < 2 * pad || z.rect.h < 2 * pad) return false;
    const x = randInt(pad, z.rect.w - pad);
    const y = randInt(pad, z.rect.h - pad);
    const g = svg("g", { class: "shape" });
    g.dataset.type = type;
    g.setAttribute("transform", `rotate(${randInt(0, 359)}, ${x}, ${y})`);
    drawShape(g, type, x, y, size, color ?? randItem(COLORS));
    g.style.pointerEvents = 'auto';
    g.addEventListener("click", onPick);
    z.svg.appendChild(g);
    z.busy = true;
    return true;
}

function onPick() {
    const picked = this.dataset.type;
    if (picked === targetShape) {
        hits++;
        remainingTarget = Math.max(0, remainingTarget - 1);
        this.remove();

        if (remainingTarget === 0) {
            // スコア計算
            const clearMs = performance.now() - currentRoundStartMs;
            const avgSize = currentRoundTargetSizes.length
                ? currentRoundTargetSizes.reduce((a, b) => a + b, 0) / currentRoundTargetSizes.length
                : 100;

            //図形サイズ加点
            const sizeFactor = MIN_SHAPE_SIZE / Math.max(MIN_SHAPE_SIZE, avgSize);
            const sizeComponent = Math.floor(Math.round(10000 * sizeFactor) / 100) * 100;

            //クリア速度加点
            const speedComponent =Math.floor(Math.max(500, Math.round(12000 - clearMs))/ 100) * 100;//7秒以上かけたら最低保証

            // 視線ズレ減点
            const penalty = Math.floor(Math.round((gazePenaltyRaw * 100) ** 2 * 0.005) / 100) * 100;//max 7200

            //図形ミス減点
            const misspenalty = misses * 500;//1ミス-500

            const roundScore = Math.max(0, sizeComponent + speedComponent - penalty -misspenalty);
            score += roundScore;

            console.log("size加点:"+sizeComponent+" 速さ加点:"+speedComponent+" 視線減点:"+penalty+"ミス:"+misspenalty);
            setTimeout(runRound, 400);
        }
    } else {//ミスアニメーション
        misses++;
        this.animate(
            [
                { transform: "translate(0,0)" },
                { transform: "translate(-12px,0)" },
                { transform: "translate(12px,0)" },
                { transform: "translate(0,0)" },
            ], { duration: 300, iterations: 2 }
        );
    }
}

// ゾーン生成
function buildZonesByGuides() {
    const W = window.innerWidth, H = window.innerHeight;
    const v = getVideoRect();
    const c = getControlsRect();

    const xs = new Set([0, W]);
    const ys = new Set([0, H]);

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
    // 上限まで
    return cells.slice(0, TARGET_TOTAL_CELLS);
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

    remainingTarget = 0;

    // ゾーン順シャッフル
    const order = [...zones.keys()];
    for (let i = order.length - 1; i > 0; i--) {
        const j = (Math.random() * (i + 1)) | 0;[order[i], order[j]] = [order[j], order[i]];
    }

    const total = order.length;
    const wantTarget = Math.max(2, Math.round(total * config.targetRatio));
    const others = SHAPES.filter(s => s !== targetShape);
    const shuffledOthers = [...others];
    for (let i = shuffledOthers.length - 1; i > 0; i--) {
        const j = (Math.random() * (i + 1)) | 0;[shuffledOthers[i], shuffledOthers[j]] = [shuffledOthers[j], shuffledOthers[i]];
    }
    const pickedOthers = shuffledOthers.slice(0, randInt(1, 3));

    const types = [];
    types.push(...Array(Math.min(wantTarget, total)).fill(targetShape));
    const remain = Math.max(0, total - types.length);
    for (let i = 0; i < remain; i++) types.push(pickedOthers[i % pickedOthers.length]);
    for (let i = types.length - 1; i > 0; i--) {
        const j = (Math.random() * (i + 1)) | 0;[types[i], types[j]] = [types[j], types[i]];
    }

    const palette = [...COLORS];
    for (let i = palette.length - 1; i > 0; i--) {
        const j = (Math.random() * (i + 1)) | 0;[palette[i], palette[j]] = [palette[j], palette[i]];
    }
    let ci = 0; const nextColor = () => palette[(ci++) % palette.length];

    let zi = 0;
    for (const t of types) {
        let tries = 0;
        while (tries < order.length && zoneSvgs[order[zi % order.length]].busy) { zi++; tries++; }
        if (tries >= order.length) break;

        const size = randItem(SIZES);
        const placed = spawnInZone(order[zi % order.length], t, nextColor(), size);
        zi++;

        if (placed && t === targetShape) {
            remainingTarget++;
            currentRoundTargetSizes.push(size); // スコア用
        }
    }
}