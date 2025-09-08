document.getElementById("start-btn").addEventListener("click", () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        console.log("開始");
        chrome.scripting.executeScript({
            target: { tabId: tabs[0].id },
            func: () => {
            if (typeof window.__peripheralTrainerStarted === "undefined") {
            window.__peripheralTrainerStarted = true;
            let total = 0;
            let hit = 0;
            const endTime = Date.now() + 60000;
            let color=["red","lime","magenta","blue"];//カラー配列
            spawnTarget();

            function getVideoArea() {
                const v = document.querySelector("video");
                return v ? v.getBoundingClientRect() : null;
            }
//ターゲット生成
            function spawnTarget() {
                if (Date.now() > endTime) return;
                const rect = getVideoArea();
                const target = document.createElement("div");
                target.style.position = "fixed";
                let targetsize =(Math.floor(Math.random() * 3) + 2) * 10;//20,30,40のランダム
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
                setTimeout(()=>{
                    target.remove()},2000);
                total++;
            }

            const interval = setInterval(spawnTarget, Math.random()*3000+2000);
            //分析を載せたいex)苦手なカラー,位置,座標（画面9当分ぐらいで）
            setTimeout(() => {
                clearInterval(interval);
                    document.querySelectorAll(".training-target").forEach(el => el.remove());//残りのターゲットの消去
                    alert(`トレーニング終了！ヒット率: ${(hit / total * 100).toFixed(1)}%`);
                    window.__peripheralTrainerStarted = undefined;
                    target.remove();
                }, 60000); // 60秒間トレーニング
            } else {
                alert("すでにトレーニング中です");
                }
            }
        });
        });
    });
