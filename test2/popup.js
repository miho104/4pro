// popup.js
document.getElementById("start-btn").addEventListener("click", () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const url = new URL(tabs[0].url);
        if (url.hostname === "www.youtube.com" && url.searchParams.get("v")) {
            const videoId = url.searchParams.get("v");
            console.log(videoId);
            chrome.runtime.sendMessage({ action: "openTraining", videoId });
        } else {
        alert("YouTube動画ページで実行してください");
        }
    });
});
