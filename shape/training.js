// ========= 基本設定 =========
const SHAPES = ["circle", "triangle", "square", "star", "pentagon"];
const COLORS = ["#f87171", "#60a5fa", "#34d399", "#fbbf24", "#a78bfa", "#f472b6"];
const SIZES  = [80, 100, 120];
const AVOID_PAD  = 16;               // 枠からどれだけ離すか
const CELL_INSET = 10;               // ゾーン内部の余白
const MIN_CELL_WH = 44;              // ゾーン最小サイズ
const TARGET_TOTAL_CELLS = 12;       // ゾーン上限
const MAX_TARGET_RATIO = 0.4;        // 正解図形の比率
const MIN_SHAPE_SIZE = 80;           // 最小図形サイズ

let targetShape = null;
let overlayShown = false;
let hits = 0, misses = 0, remainingTarget = 0;

// ========= DOM =========
const board = document.getElementById("board");
const btnReset  = document.getElementById("btn-reset");
const btnEnd    = document.getElementById("btn-end");
const iframe    = document.getElementById("video-frame");

// ========= YouTube =========
const params = new URLSearchParams(window.location.search);
const videoId = params.get("videoId") || "dQw4w9WgXcQ";

// ========= 状態管理 =========
let zoneSvgs = []; // [{svg, rect, busy}]

// ========= ユーティリティ =========
const randItem = arr => arr[(Math.random() * arr.length) | 0];
const randInt = (min, max) => (Math.random() * (max - min + 1) + min) | 0;
const svgNS = "http://www.w3.org/2000/svg";

function svg(tag, attrs){
    const el = document.createElementNS(svgNS, tag);
    for (const k in attrs) el.setAttribute(k, String(attrs[k]));
    return el;
}
function rect(x,y,w,h){ return {x,y,w,h}; }
function intersects(a,b){
    return !(a.x+a.w <= b.x || b.x+b.w <= a.x || a.y+a.h <= b.y || b.y+b.h <= a.y);
}
function inflate(r, pad){ return { x:r.x-pad, y:r.y-pad, w:r.w+pad*2, h:r.h+pad*2 }; }

function getVideoRect() {
    const r = iframe.getBoundingClientRect();
    return rect(r.left, r.top, r.width, r.height);
}
function getControlsRect(){
    const ids = ["btn-reset","btn-end","btn-confirm"];
    const els = ids.map(id => document.getElementById(id)).filter(Boolean);
    if (!els.length) return {x:0,y:0,w:0,h:0};
    let x1=Infinity,y1=Infinity,x2=-Infinity,y2=-Infinity;
    for (const el of els) {
        const r = el.getBoundingClientRect();
        x1 = Math.min(x1, r.left);
        y1 = Math.min(y1, r.top);
        x2 = Math.max(x2, r.right);
        y2 = Math.max(y2, r.bottom);
    }
    return { x:x1, y:y1, w:x2-x1, h:y2-y1 };
}

// ========= 図形描画 =========
function drawShape(group, type, x, y, s, fill){
    switch (type) {
        case "circle":
            group.appendChild(svg("circle", { cx:x, cy:y, r:s/2, fill })); break;
        case "square": {
            const half = s/2;
        group.appendChild(svg("rect", { x:x-half, y:y-half, width:s, height:s, fill })); break;
        }
        case "triangle": {
            const h = s * Math.sqrt(3) / 2;
            const pts = [
                [x, y - (2/3)*h],
                [x - s/2, y + (1/3)*h],
            [x + s/2, y + (1/3)*h]
            ].map(p=>p.join(",")).join(" ");
            group.appendChild(svg("polygon", { points: pts, fill })); break;
        }
        case "star": {
            const outer = s/2, inner = s/4, pts=[];
            for (let i=0;i<10;i++){
                const r = (i%2===0)? outer : inner;
                const a = -Math.PI/2 + i*(Math.PI/5);
                pts.push([x + r*Math.cos(a), y + r*Math.sin(a)]);
            }
            group.appendChild(svg("polygon", { points: pts.map(p=>p.join(",")).join(" "), fill })); break;
        }
        case "pentagon": {
            const r = s/2, pts=[];
            for (let i=0;i<5;i++){
                const a = -Math.PI/2 + i*(2*Math.PI/5);
                pts.push([x + r*Math.cos(a), y + r*Math.sin(a)]);
            }
            group.appendChild(svg("polygon", { points: pts.map(p=>p.join(",")).join(" "), fill })); break;
        }
    }
}

// ========= ボタン領域のセル切り抜き =========
function rectOverlap(a,b){
    const x0 = Math.max(a.x, b.x);
    const y0 = Math.max(a.y, b.y);
    const x1 = Math.min(a.x+a.w, b.x+b.w);
    const y1 = Math.min(a.y+a.h, b.y+b.h);
    return { x:x0, y:y0, w:x1-x0, h:y1-y0 };
}
function cutOutCellByObstacle(cell, obstacle){
    const ov = rectOverlap(cell, obstacle);
    if (ov.w <= 0 || ov.h <= 0) return [cell];
    const out = [];
    if (ov.y - cell.y >= MIN_CELL_WH) {
        out.push({ x: cell.x, y: cell.y, w: cell.w, h: ov.y - cell.y });
    }
    if (cell.y + cell.h - (ov.y + ov.h) >= MIN_CELL_WH) {
        out.push({ x: cell.x, y: ov.y + ov.h, w: cell.w, h: cell.y + cell.h - (ov.y + ov.h) });
    }
    if (ov.x - cell.x >= MIN_CELL_WH) {
        out.push({ x: cell.x, y: ov.y, w: ov.x - cell.x, h: ov.h });
    }
    if (cell.x + cell.w - (ov.x + ov.w) >= MIN_CELL_WH) {
        out.push({ x: ov.x + ov.w, y: ov.y, w: cell.x + cell.w - (ov.x + ov.w), h: ov.h });
    }
    return out.map(r => ({
        x: r.x + CELL_INSET,
        y: r.y + CELL_INSET,
        w: Math.max(0, r.w - 2*CELL_INSET),
        h: Math.max(0, r.h - 2*CELL_INSET),
    })).filter(r => r.w >= MIN_CELL_WH && r.h >= MIN_CELL_WH);
}

// ========= ゾーン分割 =========
function buildZonesByGuides(){
    const W = window.innerWidth, H = window.innerHeight;
    const v = getVideoRect();
    const c = getControlsRect();

  // 動画を避けるガイド線
    const xs = new Set([0, W]);
    const ys = new Set([0, H]);
    [v].forEach(r => {
        xs.add(Math.max(0, Math.round(r.x - AVOID_PAD)));
        xs.add(Math.min(W, Math.round(r.x + r.w + AVOID_PAD)));
        ys.add(Math.max(0, Math.round(r.y - AVOID_PAD)));
        ys.add(Math.min(H, Math.round(r.y + r.h + AVOID_PAD)));
    });

    const xArr = Array.from(xs).sort((a,b)=>a-b);
    const yArr = Array.from(ys).sort((a,b)=>a-b);

    const avoidVideo = inflate(v,6);
    let cells = [];
    for (let xi=0; xi<xArr.length-1; xi++){
        const x0 = xArr[xi], x1 = xArr[xi+1];
        const w = x1 - x0; if (w <= 0) continue;
        for (let yi=0; yi<yArr.length-1; yi++){
            const y0 = yArr[yi], y1 = yArr[yi+1];
            const h = y1 - y0; if (h <= 0) continue;
            const cell = { x:x0, y:y0, w, h };
            if (intersects(cell, avoidVideo)) continue;
            const inset = {
                x: cell.x + CELL_INSET,
                y: cell.y + CELL_INSET,
                w: Math.max(0, cell.w - 2*CELL_INSET),
                h: Math.max(0, cell.h - 2*CELL_INSET),
            };
        if (inset.w >= MIN_CELL_WH && inset.h >= MIN_CELL_WH) cells.push(inset);
        }
    
    }

  // ボタン領域をくり抜く
    const cut = inflate(c, AVOID_PAD);
    if (cut.w > 0 && cut.h > 0) {
        const next = [];
        for (const cell of cells) next.push(...cutOutCellByObstacle(cell, cut));
        cells = next;
    }

  // シャッフルして上限まで
    for (let i=cells.length-1;i>0;i--){
        const j=(Math.random()*(i+1))|0;
        [cells[i],cells[j]]=[cells[j],cells[i]];
    }
    const vSafe = inflate(getVideoRect(),4);
    cells = cells.filter(cell => !intersects(cell, vSafe));
    return cells.slice(0, TARGET_TOTAL_CELLS);
}

// ========= ゾーンSVG構築 =========
function rebuildZoneSvgs(zones){
    for (const z of zoneSvgs) z.svg.remove();
    zoneSvgs = [];
    for (const z of zones) {
        const s = document.createElementNS(svgNS, "svg");
        s.style.outline = '1px dashed rgba(0,255,0,.35)';
        s.setAttribute("viewBox", `0 0 ${z.w} ${z.h}`);
        s.setAttribute("width", z.w);
        s.setAttribute("height", z.h);
        Object.assign(s.style, {
            position:'fixed',
            left:`${z.x}px`, top:`${z.y}px`,
            width:`${z.w}px`, height:`${z.h}px`,
            zIndex:'1001',
            pointerEvents:'none'
            });
        s.classList.add('zone-board');
        document.body.appendChild(s);
        zoneSvgs.push({ svg:s, rect:z, busy:false });
    }
}

// ========= 図形生成 =========
function spawnInZone(zoneIndex, type, color){
    const z = zoneSvgs[zoneIndex];
    if (!z || z.busy) return false;
    let size = randItem(SIZES);
    const pad = size/2+6;
    if (z.rect.w < 2*pad || z.rect.h < 2*pad) return false;
    const x = randInt(pad, z.rect.w-pad);
    const y = randInt(pad, z.rect.h-pad);
    const g = svg("g", { class:"shape" });
    g.dataset.type = type;
    g.setAttribute("transform", `rotate(${randInt(0,359)}, ${x}, ${y})`);
    drawShape(g, type, x, y, size, color ?? randItem(COLORS));
    g.style.pointerEvents = 'auto';
    g.addEventListener("click", onPick);
    z.svg.appendChild(g);
    z.busy = true;
    return true;
}

// ========= クリック処理 =========
function onPick(){
    const picked = this.dataset.type;
    if (picked === targetShape) {
        hits++; remainingTarget = Math.max(0, remainingTarget-1);
        this.remove();
        if (remainingTarget === 0) setTimeout(makeBoard, 400);
    } else {
        misses++;
        this.animate(
        [
            { transform:"translate(0,0)" },
            { transform:"translate(-3px,0)" },
            { transform:"translate(3px,0)" },
            { transform:"translate(0,0)" },
        ], { duration:120, iterations:1 }
        );
    }
}

// ========= トースト =========
let toastTimer=null;
function toast(msg){
    const div = document.createElement("div");
    div.textContent = msg;
    Object.assign(div.style,{
        position:"fixed", left:"50%", bottom:"32px", transform:"translateX(-50%)",
        background:"rgba(20,23,30,.95)", color:"white",
        padding:"10px 14px", borderRadius:"12px",
        border:"1px solid rgba(255,255,255,.08)", zIndex:3000,
        fontWeight:700,
        pointerEvents:'none'
    });
    document.body.appendChild(div);
    clearTimeout(toastTimer);
    toastTimer=setTimeout(()=>div.remove(),1600);
}

// ========= 盤面生成 =========
function makeBoard(){
    for (const z of zoneSvgs) z.svg.remove();
    zoneSvgs = [];

    const zones = buildZonesByGuides();
    if (!zones.length){ toast("ゾーンが作れません"); return; }
    rebuildZoneSvgs(zones);

    if (!targetShape) targetShape = randItem(SHAPES);

  // お手本は最初に一度だけ中央表示
    if (!overlayShown){
        const r = getVideoRect();
        const ov = document.createElement("div");
        ov.id = "target-overlay";
        Object.assign(ov.style,{
            position:"absolute", left:`${r.x}px`, top:`${r.y}px`,
            width:`${r.w}px`, height:`${r.h}px`,
            display:"grid", placeItems:"center",
            zIndex:1800, pointerEvents:"none"
            });
        const s = document.createElementNS(svgNS,"svg");
        const px = Math.min(r.w, r.h) * 0.28;
        s.setAttribute("viewBox",`0 0 ${px} ${px}`);
        s.setAttribute("width",px); s.setAttribute("height",px);
        const g = document.createElementNS(svgNS,"g");
        drawShape(g,targetShape,px/2,px/2,px*0.9,"#10d1cf");
        s.appendChild(g); ov.appendChild(s); document.body.appendChild(ov);
        overlayShown = true;
    }

    //hits=0; misses=0;
    remainingTarget=0;

  // 配置
    const order = [...zones.keys()];
    for (let i=order.length-1;i>0;i--){
        const j=(Math.random()*(i+1))|0; [order[i],order[j]]=[order[j],order[i]];
    }
    const total = order.length;
    const wantTarget = Math.max(2, Math.round(total*MAX_TARGET_RATIO));
    const others = SHAPES.filter(s=>s!==targetShape);
    const shuffledOthers = [...others];
    for (let i=shuffledOthers.length-1;i>0;i--){
        const j=(Math.random()*(i+1))|0; [shuffledOthers[i],shuffledOthers[j]]=[shuffledOthers[j],shuffledOthers[i]];
    }
    const pickedOthers = shuffledOthers.slice(0, randInt(1,3));

    const types = [];
    types.push(...Array(Math.min(wantTarget,total)).fill(targetShape));
    const remain = Math.max(0,total-types.length);
    for (let i=0;i<remain;i++) types.push(pickedOthers[i%pickedOthers.length]);
    for (let i=types.length-1;i>0;i--){
        const j=(Math.random()*(i+1))|0; [types[i],types[j]]=[types[j],types[i]];
    }

    const palette = [...COLORS]; for (let i=palette.length-1;i>0;i--){
        const j=(Math.random()*(i+1))|0; [palette[i],palette[j]]=[palette[j],palette[i]];
    }
    let ci=0; const nextColor=()=>palette[(ci++)%palette.length];
    let zi=0;
    for (const t of types){
        let tries=0;
        while(tries<order.length && zoneSvgs[order[zi%order.length]].busy){zi++;tries++;}
        if (tries>=order.length) break;
        const placed=spawnInZone(order[zi%order.length],t,nextColor());
        zi++;
        if (placed && t===targetShape) remainingTarget++;
    }
}

// ========= イベント =========
btnReset?.addEventListener("click", makeBoard);
btnEnd?.addEventListener("click", ()=>{
    const totalPicks = hits+misses;
    alert(`終了！ 正解:${hits} / ミス:${misses}（正解率 ${(totalPicks?(hits/totalPicks*100):0).toFixed(1)}%）`);
    for (const z of zoneSvgs) z.svg.remove();
    zoneSvgs=[];
});

// 初期化
makeBoard();
// 初期化の直後あたりに追加
if (board) {
    Object.assign(board.style, {
        position: 'fixed',
        inset: '0',
        zIndex: '0',
        pointerEvents: 'none'   // ★これで透過
    });
}

// 確認ボタン（動画再生開始用）
const start = document.querySelector('.start');
if (start) {
    const btnConfirm = document.createElement('button');
    btnConfirm.id = 'btn-confirm';
    btnConfirm.textContent = '覚えたらクリック';
    btnConfirm.className = 'btn';
    btnConfirm.style.marginLeft = '8px';
    start.appendChild(btnConfirm);

    btnConfirm.addEventListener('click', () => {
        const u = new URL(`https://www.youtube.com/embed/${videoId}`);
        u.searchParams.set('start','1');
        u.searchParams.set('playsinline','1');
        u.searchParams.set('rel','0');
        u.searchParams.set('autoplay','1');
        iframe.src = u.toString();
        btnConfirm.remove();
        document.getElementById('target-overlay')?.remove();
        setTimeout(makeBoard ,60);
    });
}
