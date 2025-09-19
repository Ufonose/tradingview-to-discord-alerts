// Background script for TradingView to Discord Extension

console.log('Background script loaded and ready');

// Keep the service worker alive
let keepAlive = () => setInterval(chrome.runtime.getPlatformInfo, 20000);
chrome.runtime.onStartup.addListener(keepAlive);
chrome.runtime.onInstalled.addListener(keepAlive);
keepAlive();

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('Background script received message:', request.action);
    
    // Handle ping for connection testing
    if (request.action === 'ping') {
        console.log('Ping received, responding with pong');
        sendResponse({success: true, message: 'pong'});
        return true;
    }
    
    // Handle screenshot capture
    if (request.action === 'captureScreenshot') {
        console.log('Capturing screenshot for tab:', sender.tab?.id);
        
        // First check if the sender is from TradingView
        if (!sender.tab?.url?.includes('tradingview.com')) {
            console.error('Screenshot request from non-TradingView tab:', sender.tab?.url);
            sendResponse({success: false, error: 'Screenshots only work on TradingView pages', errorType: 'not_tradingview_tab'});
            return true;
        }
        
        // Now check if TradingView is the active tab
        chrome.tabs.query({active: true, windowId: sender.tab.windowId}, (activeTabs) => {
            if (chrome.runtime.lastError) {
                console.error('Error checking active tab:', chrome.runtime.lastError.message);
                sendResponse({success: false, error: chrome.runtime.lastError.message, errorType: 'permission_needed'});
                return;
            }
            
            const activeTab = activeTabs[0];
            if (!activeTab || !activeTab.url.includes('tradingview.com')) {
                console.error('Active tab is not TradingView:', activeTab?.url);
                sendResponse({success: false, error: 'TradingView must be the active tab', errorType: 'not_active_tab'});
                return;
            }
            
            // TradingView is active, try to capture screenshot
            chrome.tabs.captureVisibleTab(sender.tab.windowId, {
                format: 'png', 
                quality: 90
            }, (dataUrl) => {
                if (chrome.runtime.lastError) {
                    console.error('Screenshot capture failed:', chrome.runtime.lastError.message);
                    sendResponse({success: false, error: chrome.runtime.lastError.message, errorType: 'permission_needed'});
                    return;
                }
                
                if (dataUrl) {
                    console.log('✅ Screenshot captured successfully, size:', dataUrl.length);
                    sendResponse({success: true, screenshotDataUrl: dataUrl});
                } else {
                    console.error('Screenshot capture returned no data');
                    sendResponse({success: false, error: 'No screenshot data returned', errorType: 'permission_needed'});
                }
            });
        });
        
        return true; // Async response
    }
    
    // Handle sending cropped screenshot to Discord
    if (request.action === 'sendCroppedScreenshot') {
        console.log('Sending cropped screenshot to Discord...');
        
        // Get webhook URL from storage
        chrome.storage.sync.get(['webhookUrl'], (result) => {
            if (!result.webhookUrl) {
                console.error('No webhook URL configured');
                sendResponse({success: false, error: 'No webhook URL configured'});
                return;
            }
            
            try {
                // Convert base64 to blob
                const base64Data = request.croppedScreenshotDataUrl.split(',')[1];
                const byteCharacters = atob(base64Data);
                const byteNumbers = new Array(byteCharacters.length);
                
                for (let i = 0; i < byteCharacters.length; i++) {
                    byteNumbers[i] = byteCharacters.charCodeAt(i);
                }
                
                const byteArray = new Uint8Array(byteNumbers);
                const blob = new Blob([byteArray], {type: 'image/png'});
                
                console.log('Created blob, size:', blob.size, 'bytes');
                
                // Create FormData for Discord webhook
                const formData = new FormData();
                formData.append('content', request.message);
                formData.append('file', blob, 'tradingview_screenshot.png');
                
                // Send to Discord
                fetch(result.webhookUrl, {
                    method: 'POST',
                    body: formData
                })
                .then(response => {
                    console.log('Discord response status:', response.status);
                    if (response.ok) {
                        console.log('✅ Screenshot sent to Discord successfully');
                        sendResponse({success: true});
                    } else {
                        console.error('Failed to send screenshot to Discord:', response.status);
                        sendResponse({success: false, error: `Discord API error: ${response.status}`});
                    }
                })
                .catch(error => {
                    console.error('Error sending screenshot to Discord:', error);
                    sendResponse({success: false, error: error.message});
                });
                
            } catch (error) {
                console.error('Error processing screenshot data:', error);
                sendResponse({success: false, error: 'Error processing screenshot: ' + error.message});
            }
        });
        
        return true; // Async response
    }
});