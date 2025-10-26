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

// =================== ゲーム本体 ===================
const SHAPES = ["circle", "triangle", "square", "star", "pentagon"];
const COLORS = ["#f87171", "#60a5fa", "#34d399", "#fbbf24", "#a78bfa", "#f472b6"];
const SIZES  = [80, 100, 120];

const AVOID_PAD = 16;
const CELL_INSET = 10;
const MIN_CELL_WH = 44;
const TARGET_TOTAL_CELLS = 12;

let score = 0;
let corrects = 0;
let misses = 0;

let difficulty=null;
let player;
let playerReady = false;
let gazePenaltyRaw = 0; // 視線ペナルティ（未実装のため0）

const startArea = document.querySelector(".start");

let currentRoundStartMs = 0;
let duration = 0;

let ahaTargetElement = null;

let rounds = 0;
let timerId = null;
let startTime = null;
let pausedAt = 0;
let running = false;

// ラウンド状態
let ahaActive = false;
let ahaRounds = 0;
let ahaCorrectDir = null;   // "up" | "down" | "left" | "right"
let ahaCleanup = null;      // 後始末クロージャ
let ahaKeydownBound = null; // ハンドラ退避

const AHA = {
    morphMs: 2400,             // 色変化にかける時間
    popinMs: 600,              // 新規出現のフェード時間
    afterAnswerFreezeMs: 400,  // 回答後のフラッシュ演出時間
    roundCount: 3,             // 1ミニゲーム内のラウンド数
    chooseMode: () => (Math.random() < 0.5 ? "popin" : "colormorph"),
};

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
    startTime = performance.now() - pausedAt; // 再開時はpauseした位置から
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
        if (level === "easy") config = { rounds: 3};
        if (level === "normal") config = { rounds: 3};
        if (level === "hard") config = { rounds: 5};
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
        console.log("clicked")
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
    const totalPicks = correct + misses;
    alert([
        `終了！`,
        `正解: ${corrects} / ミス: ${misses}（正解率 ${(totalPicks ? (corrects / totalPicks * 100) : 0).toFixed(1)}%）`,
        `総合スコア: ${score.toLocaleString()}`
    ].join('\n'));
    clearBoard();
});


//ゲーム内部
function screenCenter() {
    return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
}

function mainDirectionFromPoint(pt) {
    const c = screenCenter();
    const dx = pt.x - c.x;
    const dy = pt.y - c.y;
    if (Math.abs(dx) > Math.abs(dy)) {
        return dx >= 0 ? "right" : "left";
    } else {
        return dy >= 0 ? "down" : "up";
    }
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

function spawnPopIn(zoneIndex, type, size) {
    const z = zoneSvgs[zoneIndex];
    if (!z) return null;
    const pad = size / 2 + 6;
    if (z.rect.w < 2 * pad || z.rect.h < 2 * pad) return null;
    const x = randInt(pad, z.rect.w - pad);
    const y = randInt(pad, z.rect.h - pad);
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
    // なるべく違う色へ
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
    if (!zoneSvgs.length) {
        const zones = buildZonesByGuides();
        if (!zones.length) return;
        rebuildZoneSvgs(zones);
    }

    let mode = AHA.chooseMode();
    let morphCtrl = null;
    let zoneIndex = -1;

    //空きゾーンを探す
    if (mode === "popin") {
        const availableZones = zoneSvgs.map((z, i) => z.busy ? -1 : i).filter(i => i !== -1);
        if (availableZones.length > 0) {
            zoneIndex = randItem(availableZones);
        } else {
            // colormorphに強制変更
            console.log("No available zones for pop-in, switching to color morph.");
            mode = "colormorph";
        }
    }

    if (mode === "colormorph") {
        const busyZones = zoneSvgs.map((z, i) => z.busy ? i : -1).filter(i => i !== -1);
        if (busyZones.length > 0) {
            zoneIndex = randItem(busyZones);
        } else {
            console.warn("No busy zones to apply color morph. Skipping round.");
            setTimeout(nextAhaStep, 100);
            return;
        }
    }
    
    // ゾーンが確定できなかった場合はエラー
    if (zoneIndex === -1) {
        console.error("Could not determine a valid zone for the round. Ending game.");
        endAhaGame();
        return;
    }

    // 正解の方向をセット
    const center = zoneCenter(zoneSvgs[zoneIndex].rect);
    ahaCorrectDir = mainDirectionFromPoint(center);

    // 変化を実行
    if (mode === "popin") {
        const type = randItem(SHAPES);
        const size = randItem(SIZES);
        ahaTargetElement = spawnPopIn(zoneIndex, type, size);
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

    const correct = (dir === ahaCorrectDir);
    highlightElement(ahaTargetElement, correct);

    if (correct) {
        corrects++;
    } else {
        misses++;
        smallShake();
    }

    // スコア：速度/視線ズレ込み
    const clearMs = performance.now() - currentRoundStartMs;
    const speedComponent = Math.max(500, Math.round(9000 - clearMs));
    const penalty = Math.round((gazePenaltyRaw * 100) ** 2 * 0.05);
    score += Math.max(0, speedComponent - penalty);

    // ラウンド終了処理
    ahaCleanup?.();
    nextAhaStep();
}

function highlightElement(el, isCorrect) {
    if (!el || !el.firstElementChild) return;
    const child = el.firstElementChild;
    const originalStroke = child.getAttribute("stroke");
    const originalStrokeWidth = child.getAttribute("stroke-width");

    child.setAttribute("stroke", isCorrect ? "#10d1cf" : "#ff4040");
    child.setAttribute("stroke-width", "5");

    setTimeout(() => {
        if (originalStroke) {
            child.setAttribute("stroke", originalStroke);
        } else {
            child.removeAttribute("stroke");
        }
        if (originalStrokeWidth) {
            child.setAttribute("stroke-width", originalStrokeWidth);
        } else {
            child.removeAttribute("stroke-width");
        }
    }, AHA.afterAnswerFreezeMs + 200);
}

function flashScreen(color) {
    const f = document.createElement("div");
    Object.assign(f.style, {
        position: "fixed", inset: "0", background: color, zIndex: 3000, pointerEvents: "none"
    });
    document.body.appendChild(f);
    setTimeout(() => f.remove(), AHA.afterAnswerFreezeMs);
}

function smallShake() {
    document.body.animate(
        [
            { transform: "translate(0,0)" },
            { transform: "translate(-3px,0)" },
            { transform: "translate(3px,0)" },
            { transform: "translate(0,0)" },
        ],
        { duration: 140, iterations: 1 }
    );
}

//ミニゲーム進行管理
function nextAhaStep() {
    ahaRounds++;
    if (ahaRounds >= AHA.roundCount) {
        endAhaGame();
    } else {
        setTimeout(() => {
            currentRoundStartMs = performance.now();
            startAhaRound();
        }, 180);
    }
}

function endAhaGame() {
    ahaActive = false;
    if (ahaKeydownBound) {
        window.removeEventListener("keydown", ahaKeydownBound);
        ahaKeydownBound = null;
    }
    clearBoard();
    console.log("[Aha] ミニゲーム終了");
}

function startMiniGame() {
    ahaActive = true;
    ahaRounds = 0;
    currentRoundStartMs = performance.now();
    makeBoard();

    zoneSvgs.forEach(z => {
        const type = randItem(SHAPES);
        const size = randItem(SIZES) * 0.9;
        const color = randItem(COLORS);
        const pad = size / 2 + 6;

        if (z.rect.w < 2 * pad || z.rect.h < 2 * pad) return; // 小さすぎるゾーンはスキップ

        const x = randInt(pad, z.rect.w - pad);
        const y = randInt(pad, z.rect.h - pad);
        const g = svg("g", { class: "shape" });

        g.dataset.type = type;
        g.setAttribute("transform", `rotate(${randInt(0, 359)}, ${x}, ${y})`);
        drawShape(g, type, x, y, size, color);
        z.svg.appendChild(g);
        z.busy = true;
    });

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
// ===== 図形＆ゾーン =====
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
            outline: "1px dashed rgba(0,255,0,.35)" // デバッグ
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

    // ボタン領域くり抜き（固定座標）
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
}
