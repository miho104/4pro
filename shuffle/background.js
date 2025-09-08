chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("messege受信");
    if (message.action === "openTraining") {
        console.log("受け取り成功");
        chrome.tabs.create({
        url: `training.html?videoId=${message.videoId}`,
        });
    }
});
