chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'screenshot') {
    chrome.tabs.captureVisibleTab(null, { format: 'png' }, (dataUrl) => {
      if (chrome.runtime.lastError) {
        sendResponse({ error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ base64: dataUrl.split(',')[1] });
      }
    });
    return true; // async
  }
});
