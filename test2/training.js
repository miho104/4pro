const params = new URLSearchParams(window.location.search);
const videoId = params.get("videoId");

document.getElementById("video-frame").src =
    `https://www.youtube.com/embed/${videoId}?autoplay=1&controls=1`;

let total = 0;
let hit = 0;
let flag=true;
//const endTime = Date.now() + 60000;//トレーニング時間
let color=["red","lime","magenta","blue"];//カラー配列


//ターゲット生成

function spawnTarget() {
    //if (Date.now() > endTime) return;
    const rect = document.getElementById("video-frame").getBoundingClientRect();
    const target = document.createElement("div");
    target.style.position = "fixed";
    let targetsize =(Math.floor(Math.random() * 4) + 5) * 10;//50~80のランダム
    target.style.width = `${targetsize}px`;
    target.style.height = `${targetsize}px`;
    target.style.backgroundColor =  color[Math.floor(Math.random() * color.length)];//カラーランダム
    target.style.borderRadius = "50%";
    target.style.zIndex = "999999";
    target.style.cursor = "pointer";
    target.style.pointerEvents = "auto";
    target.className = "training-target";//全削除用クラス分け

    let x, y;
    do {
        x = Math.random() * (window.innerWidth-targetsize);
        y = Math.random() * (window.innerHeight-targetsize);
    } while (
        rect &&
        x > rect.left - 40 && x < rect.right &&
        y > rect.top - 40 && y < rect.bottom
            );

    target.style.left = `${x}px`;
    target.style.top = `${y}px`;
            
    target.onclick = (e) => {
        e.stopPropagation();
        hit++;
        target.remove();
    };

    document.body.appendChild(target);
    total++;

    setTimeout(()=>{
        target.remove()},2000);

    
}

function loopSpawn() {
    //if (Date.now() > endTime) return;
    if(!flag)return;
    spawnTarget();
    setTimeout(loopSpawn, Math.random() * 1000 + 2000);
}
    
loopSpawn();

//const interval = setInterval(spawnTarget, Math.random()*1000+2000);
//分析を載せたいex)苦手なカラー,位置,座標（画面9当分ぐらいで）
/*setTimeout(() => {
    //clearInterval(interval);
    document.querySelectorAll(".training-target").forEach(el => el.remove());//残りのターゲットの消去
    alert(`トレーニング終了！ヒット率: ${(hit / total * 100).toFixed(1)}%`);
    }, 60000); // 60秒間トレーニング
*/
        
document.getElementById("end_btn").addEventListener("click",()=>{
        flag=false;
        document.querySelectorAll(".training-target").forEach(el => el.remove());//残りのターゲットの消去
        alert(`トレーニング終了！ヒット率: ${(hit / total * 100).toFixed(1)}%`);
    });