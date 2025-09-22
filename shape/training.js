const SHAPES = ["circle", "triangle", "square", "star", "pentagon"];
const COLORS = ["#f87171", "#60a5fa", "#34d399", "#fbbf24", "#a78bfa", "#f472b6"];
const SIZES = [80, 100, 120];
const AVOID_PAD = 16;
const CELL_INSET = 10;
const MIN_CELL_WH = 44;
const TARGET_TOTAL_CELLS = 12;

let score = 0;
let startTime = null;
let targetShape = null;
let overlayShown = false;
let hits = 0, misses = 0, remainingTarget = 0;

const iframe = document.getElementById("video-frame");
const params = new URLSearchParams(window.location.search);
const videoId = params.get("videoId") || "dQw4w9WgXcQ";


let duration = 0;
let lastCheckpoint = 0;
let gameActive = false;
let rounds = 0;

// 難易度設定
let difficulty = null;
let config = { rounds: 3, targetRatio: 0.4 };

Object.assign(iframe.style, {
    pointerEvents: "none"
});

function ytCommand(func, args = []) {
    iframe.contentWindow.postMessage(JSON.stringify({
        event: "command",
        func,
        args
    }), "*");
}
function requestDuration() { ytCommand("getDuration"); }
function getCurrentTime() { ytCommand("getCurrentTime"); }
function playVideo() { ytCommand("playVideo"); }
function pauseVideo() { ytCommand("pauseVideo"); }

// 受信
window.addEventListener("message", (event) => {
    try {
        const data = JSON.parse(event.data);
        if (data.event === "infoDelivery") {
            if (data.info && data.info.duration) duration = data.info.duration;
            if (data.info && data.info.currentTime) {
                const current = data.info.currentTime;
                if (duration > 0) {
                    const checkpoint = Math.floor(current / (duration / 5));
                    if (checkpoint > lastCheckpoint) {
                        lastCheckpoint = checkpoint;
                        startMiniGame();
                    }
                }
            }
        }
    } catch (e) { }
});

setInterval(() => {
    requestDuration();
    getCurrentTime();
}, 1000);

//難易度
const startArea = document.querySelector(".start");

function showDifficultyUI() {
    if (!startArea) return;
    const wrap = document.createElement("div");
    wrap.id = "diff-wrap";
    wrap.style.display = "flex";
    wrap.style.gap = "8px";

    const btnEasy = document.createElement("button");
    btnEasy.textContent = "かんたん"; btnEasy.className = "btn";

    const btnNormal = document.createElement("button");
    btnNormal.textContent = "ふつう"; btnNormal.className = "btn";

    const btnHard = document.createElement("button");
    btnHard.textContent = "むずかしい"; btnHard.className = "btn";

    wrap.appendChild(btnEasy);
    wrap.appendChild(btnNormal);
    wrap.appendChild(btnHard);
    startArea.appendChild(wrap);

    function pick(level) {
        difficulty = level;
        if (level === "easy") {
            config = { rounds: 2, targetRatio: 0.5 };
        } else if (level === "normal") {
            config = { rounds: 3, targetRatio: 0.4 };
        } else if (level === "hard") {
            config = { rounds: 4, targetRatio: 0.3 };
        }
        wrap.remove();
        showConfirmUI();
    }

    btnEasy.addEventListener("click", () => pick("easy"));
    btnNormal.addEventListener("click", () => pick("normal"));
    btnHard.addEventListener("click", () => pick("hard"));
}

function showConfirmUI() {
    const start = document.querySelector('.start');
    if (!start) return;

    const btnConfirm = document.createElement('button');
    btnConfirm.id = 'btn-confirm';
    btnConfirm.textContent = '覚えたらクリック';
    btnConfirm.className = 'btn';
    btnConfirm.style.marginLeft = '8px';
    start.appendChild(btnConfirm);
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
    const s = document.createElementNS("http://www.w3.org/2000/svg","svg");
    const px = Math.min(r.width, r.height) * 0.28;
    s.setAttribute("viewBox", `0 0 ${px} ${px}`);
    s.setAttribute("width", px);
    s.setAttribute("height", px);
    const g = document.createElementNS("http://www.w3.org/2000/svg","g");
    drawShape(g, targetShape ?? randItem(SHAPES), px/2, px/2, px*0.9, "#10d1cf");
    s.appendChild(g);
    ov.appendChild(s);
    document.body.appendChild(ov);

    btnConfirm.addEventListener('click', () => {
        const u = new URL(`https://www.youtube.com/embed/${videoId}`);
        u.searchParams.set('start','1');
        u.searchParams.set('playsinline','1');
        u.searchParams.set('rel','0');
        u.searchParams.set('autoplay','1');
        u.searchParams.set('enablejsapi','1');
        iframe.src = u.toString();

        btnConfirm.remove();
        document.getElementById('target-overlay')?.remove();

        setTimeout(makeBoard, 60);
    });
}

function startMiniGame() {
    if (gameActive) return;
    gameActive = true;
    rounds = 0;
    if (!targetShape) targetShape = randItem(SHAPES);
    runRound();
}

function runRound() {
    if (rounds >= config.rounds) {
        endMiniGame();
        return;
    }
    rounds++;
    makeBoard();
}

function endMiniGame() {
    clearBoard();
    gameActive = false;
}

function clearBoard() {
    for (const z of zoneSvgs) z.svg.remove();
    zoneSvgs = [];
}

const btnStop = document.getElementById("btn-stop");
btnStop?.addEventListener("click", () => {
    if (btnStop.dataset.state === "playing") {
        pauseVideo();
        btnStop.dataset.state = "paused";
    } else {
        playVideo();
        btnStop.dataset.state = "playing";
    }
});

const btnCalib = document.getElementById("btn-recalib");
btnCalib?.addEventListener("click", () => {
    window.Tracker.forceCalibrate();
    alert("キャリブレーション完了");
});

const btnEnd    = document.getElementById("btn-end");
btnEnd?.addEventListener("click", ()=>{
    const totalPicks = hits+misses;
    alert(`終了！ 正解:${hits} / ミス:${misses}（正解率 ${(totalPicks?(hits/totalPicks*100):0).toFixed(1)}%）`);
    for (const z of zoneSvgs) z.svg.remove();
    zoneSvgs=[];
});

let zoneSvgs = [];
const randItem = arr => arr[(Math.random() * arr.length) | 0];
const randInt = (min, max) => (Math.random() * (max - min + 1) + min) | 0;
const svgNS = "http://www.w3.org/2000/svg";

function svg(tag, attrs) {
    const el = document.createElementNS(svgNS, tag);
    for (const k in attrs) el.setAttribute(k, String(attrs[k]));
    return el;
}
function rect(x, y, w, h) { return { x, y, w, h }; }
function intersects(a, b) {
    return !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
}
function inflate(r, pad) { return { x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2 }; }

function getVideoRect() {
    const r = iframe.getBoundingClientRect();
    return rect(r.left, r.top, r.width, r.height);
}
function getControlsRect() {
    return {
        x: 0,
        y: 16,
        w: 210,
        h: 40
    };
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
            const r = s / 2, pts = [];
            for (let i = 0; i < 5; i++) {
                const a = -Math.PI / 2 + i * (2 * Math.PI / 5);
                pts.push([x + r * Math.cos(a), y + r * Math.sin(a)]);
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
            outline: "1px dashed rgba(0,255,0,.35)"
        });
        document.body.appendChild(s);
        zoneSvgs.push({ svg: s, rect: z, busy: false });
    }
}

function spawnInZone(zoneIndex, type, color) {
    const z = zoneSvgs[zoneIndex];
    if (!z || z.busy) return false;
    let size = randItem(SIZES);
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
        hits++; remainingTarget = Math.max(0, remainingTarget - 1);
        this.remove();
        if (remainingTarget === 0) setTimeout(runRound, 400);
    } else {
        misses++;
        this.animate(
            [
                { transform: "translate(0,0)" },
                { transform: "translate(-3px,0)" },
                { transform: "translate(3px,0)" },
                { transform: "translate(0,0)" },
            ], { duration: 120, iterations: 1 }
        );
    }
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
    const cut = inflate(c, AVOID_PAD);
    if (cut.w > 0 && cut.h > 0) {
        const next = [];
        for (const cell of cells) next.push(...cutOutCellByObstacle(cell, cut));
        cells = next;
    }
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
    if (!zones.length) { return; }
    rebuildZoneSvgs(zones);
    remainingTarget = 0;
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
        const placed = spawnInZone(order[zi % order.length], t, nextColor());
        zi++;
        if (placed && t === targetShape) remainingTarget++;
    }
}

showDifficultyUI();
