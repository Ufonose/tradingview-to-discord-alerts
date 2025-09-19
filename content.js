// TradingView to Discord Content Script

let isMonitoring = false;
let settings = {};
let notificationData = {};
let symbolPositions = {}; // Track positions per symbol
let lastStopLossPrice = null;
let lastTakeProfitPrice = null;

// Load settings and position data, then start monitoring
chrome.storage.sync.get(['webhookUrl', 'enableNotifications', 'enableScreenshots', 'includeSymbol'], function(result) {
    settings = {
        webhookUrl: result.webhookUrl || '',
        enableNotifications: result.enableNotifications !== false, // Default to true
        enableScreenshots: result.enableScreenshots === true, // Default to false
        includeSymbol: result.includeSymbol === true // Default to false
    };
    
    console.log('Settings loaded:', settings);
    loadPositionData();
    startNotificationMonitoring();
});

// Load position data from storage
function loadPositionData() {
    chrome.storage.sync.get(['symbolPositions'], function(result) {
        if (result.symbolPositions) {
            symbolPositions = result.symbolPositions;
            console.log('Loaded position data:', symbolPositions);
        }
    });
}

// Save position data to storage
function savePositionData() {
    chrome.storage.sync.set({
        symbolPositions: symbolPositions
    }, function() {
        console.log('Position data saved:', symbolPositions);
    });
}

// Listen for settings changes
chrome.storage.onChanged.addListener(function(changes, namespace) {
    if (namespace === 'sync') {
        if (changes.webhookUrl) {
            settings.webhookUrl = changes.webhookUrl.newValue || '';
        }
        if (changes.enableNotifications) {
            settings.enableNotifications = changes.enableNotifications.newValue !== false;
        }
        if (changes.enableScreenshots) {
            settings.enableScreenshots = changes.enableScreenshots.newValue === true;
        }
        if (changes.includeSymbol) {
            settings.includeSymbol = changes.includeSymbol.newValue === true;
        }
        if (changes.symbolPositions) {
            symbolPositions = changes.symbolPositions.newValue || {};
        }
    }
});

// Listen for reset command from popup
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    if (request.action === 'resetPosition') {
        symbolPositions = {};
        lastStopLossPrice = null;
        lastTakeProfitPrice = null;
        savePositionData();
        sendResponse({success: true});
    }
});

function startNotificationMonitoring() {
    if (isMonitoring) return;
    
    isMonitoring = true;
    
    const observer = new MutationObserver(function(mutations) {
        mutations.forEach(function(mutation) {
            if (mutation.addedNodes) {
                mutation.addedNodes.forEach(function(node) {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        checkForNotification(node);
                    }
                });
            }
        });
    });
    
    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
}

function checkForNotification(element) {
    const text = element.textContent || '';
    
    // Skip very short text or common UI patterns
    if (text.trim().length < 10) return;
    
    const commonUIPatterns = [
        /^(Buy|Sell)$/,
        /^(Long|Short)$/,
        /^\d+$/,
        /^[A-Z]{2,6}:\w+$/
    ];
    
    for (const pattern of commonUIPatterns) {
        if (pattern.test(text.trim())) return;
    }
    
    // Detect trade notifications
    const isTradeNotification = (
        (text.includes('order placed') || 
         text.includes('order executed') || 
         text.includes('order modified') ||
         text.includes('order cancelled') ||
         text.includes('Market order') ||
         text.includes('Stop Loss order') ||
         text.includes('Take Profit order') ||
         text.includes('Limit order') ||
         text.includes('Stop order')) &&
        (text.includes(' at ') && /at\s+[\d,]+\.?\d*/i.test(text))
    );
    
    const isIndicatorAlert = text.includes('Alert on');
    
    if (isTradeNotification && !isIndicatorAlert) {
        parseNotification(element);
    }
}

function parseNotification(element) {
    const text = element.textContent || '';
    
    notificationData.originalText = text;
    notificationData.isLikelyPositionClose = false;
    notificationData.closeType = null;
    notificationData.isAddingToPosition = false;
    
    // Extract basic trade info
    if (text.includes('executed') || text.includes('order placed') || text.includes('order cancelled') || text.includes('Limit order') || text.includes('Stop order')) {
        
        // Handle Stop order format
        const stopOrderMatch = text.match(/Stop\s+order\s+(?:placed|modified|cancelled)\s+on\s+([A-Z_:0-9!]+?)(?:CloseBuy|CloseSell|\s|$).*?(?:(Buy|Sell)\s+)?([\d,]+)\s+at\s+([\d,]+\.?\d*)/i);
        
        if (stopOrderMatch) {
            notificationData.symbol = stopOrderMatch[1];
            const explicitSide = stopOrderMatch[2];
            notificationData.quantity = parseFloat(stopOrderMatch[3].replace(/,/g, ''));
            notificationData.entry = parseFloat(stopOrderMatch[4].replace(/,/g, ''));
            
            if (explicitSide) {
                notificationData.side = explicitSide.toUpperCase();
            } else if (text.includes('CloseBuy')) {
                notificationData.side = 'BUY';
            } else if (text.includes('CloseSell')) {
                notificationData.side = 'SELL';
            }
        } 
        // Handle Limit order format
        else {
            const limitOrderMatch = text.match(/Limit\s+order\s+(?:placed|modified|cancelled)\s+on\s+([A-Z_:0-9!]+?)(?:CloseBuy|CloseSell|\s|$).*?(?:(Buy|Sell)\s+)?([\d,]+)\s+at\s+([\d,]+\.?\d*)/i);
            
            if (limitOrderMatch) {
                notificationData.symbol = limitOrderMatch[1];
                const explicitSide = limitOrderMatch[2];
                notificationData.quantity = parseFloat(limitOrderMatch[3].replace(/,/g, ''));
                notificationData.entry = parseFloat(limitOrderMatch[4].replace(/,/g, ''));
                
                if (explicitSide) {
                    notificationData.side = explicitSide.toUpperCase();
                } else if (text.includes('CloseBuy')) {
                    notificationData.side = 'BUY';
                } else if (text.includes('CloseSell')) {
                    notificationData.side = 'SELL';
                }
            } else {
                // Handle legacy CloseBuy/CloseSell pattern
                const closeBuyMatch = text.match(/(CloseBuy|CloseSell)\s+([\d,]+)\s+at\s+([\d,]+\.?\d*)/i);
                
                if (closeBuyMatch) {
                    const closeSide = closeBuyMatch[1];
                    notificationData.side = closeSide.includes('Buy') ? 'BUY' : 'SELL';
                    notificationData.quantity = parseFloat(closeBuyMatch[2].replace(/,/g, ''));
                    notificationData.entry = parseFloat(closeBuyMatch[3].replace(/,/g, ''));
                } else {
                    // Standard Buy/Sell patterns
                    const standardPatterns = [
                        /(Buy|Sell)\s+([\d,]+)\s+at\s+([\d,]+\.?\d*)/i,
                        /Limit\s+order\s+(Buy|Sell)\s+([\d,]+)\s+at\s+([\d,]+\.?\d*)/i,
                        /Market\s+order\s+(Buy|Sell)\s+([\d,]+)\s+at\s+([\d,]+\.?\d*)/i,
                        /order\s+placed\s+.*?(Buy|Sell)\s+([\d,]+)\s+at\s+([\d,]+\.?\d*)/i
                    ];
                    
                    for (const pattern of standardPatterns) {
                        const match = text.match(pattern);
                        if (match) {
                            notificationData.side = match[1].toUpperCase();
                            notificationData.quantity = parseFloat(match[2].replace(/,/g, ''));
                            notificationData.entry = parseFloat(match[3].replace(/,/g, ''));
                            break;
                        }
                    }
                }
            }
        }
    }
    
    // Extract Stop Loss
    if (text.includes('Stop Loss order')) {
        const stopLossMatch = text.match(/at\s+([\d,]+\.?\d*)/i);
        if (stopLossMatch) {
            notificationData.stopLoss = parseFloat(stopLossMatch[1].replace(/,/g, ''));
        }
    }
    
    // Extract Take Profit
    if (text.includes('Take Profit order')) {
        const takeProfitMatch = text.match(/at\s+([\d,]+\.?\d*)/i);
        if (takeProfitMatch) {
            notificationData.takeProfit = parseFloat(takeProfitMatch[1].replace(/,/g, ''));
        }
    }
    
    // Extract Symbol (if not already set)
    if (!notificationData.symbol) {
        const symbolMatch = text.match(/on\s+([A-Z_:0-9!]+?)(?:CloseBuy|CloseSell|Buy|Sell|\s|$)/i);
        if (symbolMatch) {
            notificationData.symbol = symbolMatch[1];
        }
    }
    
    // Check for position changes if this is an executed trade
    if (text.includes('executed') && notificationData.quantity && notificationData.side) {
        checkForPositionClose();
    }
    
    sendNotificationToDiscord();
    resetNotificationData();
}

function checkForPositionClose() {
    if (!notificationData.symbol) return;
    
    const symbol = notificationData.symbol;
    const quantityChange = notificationData.side === 'BUY' ? notificationData.quantity : -notificationData.quantity;
    
    const positionBefore = symbolPositions[symbol] || 0;
    const positionAfter = positionBefore + quantityChange;
    
    if (positionBefore !== 0) {
        if (Math.sign(positionBefore) !== Math.sign(quantityChange)) {
            notificationData.isLikelyPositionClose = true;
            
            if (positionAfter === 0) {
                notificationData.closeType = 'full';
            } else if (Math.sign(positionAfter) === Math.sign(positionBefore)) {
                notificationData.closeType = 'partial';
            } else {
                notificationData.closeType = 'reversal';
            }
        } else {
            notificationData.isAddingToPosition = true;
        }
    }
    
    symbolPositions[symbol] = positionAfter;
    
    if (symbolPositions[symbol] === 0) {
        delete symbolPositions[symbol];
    }
    
    savePositionData();
}

function sendNotificationToDiscord() {
    // Check if notifications are enabled and webhook configured
    if (!settings.enableNotifications || !settings.webhookUrl) {
        return;
    }
    
    // Check if we have meaningful trade data
    if (!notificationData.symbol && !notificationData.entry && !notificationData.stopLoss && !notificationData.takeProfit) {
        return;
    }
    
    // Check for quantity-only changes in SL/TP (ignore these)
    if (notificationData.originalText) {
        const originalText = notificationData.originalText.toLowerCase();
        
        if (originalText.includes('stop loss order modified') && notificationData.stopLoss) {
            if (lastStopLossPrice !== null && Math.abs(notificationData.stopLoss - lastStopLossPrice) < 0.01) {
                return;
            }
            lastStopLossPrice = notificationData.stopLoss;
        }
        
        if (originalText.includes('take profit order modified') && notificationData.takeProfit) {
            if (lastTakeProfitPrice !== null && Math.abs(notificationData.takeProfit - lastTakeProfitPrice) < 0.01) {
                return;
            }
            lastTakeProfitPrice = notificationData.takeProfit;
        }
        
        if (originalText.includes('stop loss order') && !originalText.includes('modified') && notificationData.stopLoss) {
            lastStopLossPrice = notificationData.stopLoss;
        }
        if (originalText.includes('take profit order') && !originalText.includes('modified') && notificationData.takeProfit) {
            lastTakeProfitPrice = notificationData.takeProfit;
        }
    }
    
    const message = formatNotificationMessage(notificationData);
    
    // Check if this should include a screenshot
    const shouldIncludeScreenshot = settings.enableScreenshots && 
                                  notificationData.originalText && 
                                  notificationData.originalText.toLowerCase().includes('executed');
    
    if (shouldIncludeScreenshot) {
        captureAndSendScreenshot(message);
    } else {
        sendRegularMessage(message);
    }
}

function captureAndSendScreenshot(message) {
    setTimeout(() => {
        chrome.runtime.sendMessage({
            action: 'captureScreenshot'
        }, function(response) {
            if (chrome.runtime.lastError) {
                console.error('Chrome runtime error during screenshot:', chrome.runtime.lastError);
                sendRegularMessageWithScreenshotNote(message);
                return;
            }
            
            if (response && response.success && response.screenshotDataUrl) {
                cropScreenshotForTradingView(response.screenshotDataUrl)
                    .then(croppedDataUrl => {
                        chrome.runtime.sendMessage({
                            action: 'sendCroppedScreenshot',
                            message: message,
                            croppedScreenshotDataUrl: croppedDataUrl
                        }, function(finalResponse) {
                            if (chrome.runtime.lastError || !finalResponse || !finalResponse.success) {
                                sendRegularMessageWithScreenshotNote(message);
                            }
                        });
                    })
                    .catch(error => {
                        console.error('Error cropping screenshot:', error);
                        sendRegularMessageWithScreenshotNote(message);
                    });
            } else {
                // Handle different types of screenshot errors
                if (response && response.errorType === 'not_active_tab') {
                    sendRegularMessageWithTabNote(message);
                } else {
                    sendRegularMessageWithScreenshotNote(message);
                }
            }
        });
    }, 500);
}

async function cropScreenshotForTradingView(dataUrl) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = function() {
            try {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                
                const originalWidth = img.width;
                const originalHeight = img.height;
                
                // Crop settings for TradingView
                const cropLeft = 85;
                const cropRight = 75;
                const cropTop = 65;
                const cropBottom = 70;
                
                // Ensure safe crop boundaries
                const safeCropLeft = Math.min(cropLeft, Math.floor(originalWidth * 0.4));
                const safeCropRight = Math.min(cropRight, Math.floor(originalWidth * 0.4));
                const safeCropTop = Math.min(cropTop, Math.floor(originalHeight * 0.2));
                const safeCropBottom = Math.min(cropBottom, Math.floor(originalHeight * 0.2));
                
                const croppedWidth = originalWidth - safeCropLeft - safeCropRight;
                const croppedHeight = originalHeight - safeCropTop - safeCropBottom;
                
                // Ensure minimum dimensions
                if (croppedWidth < 400 || croppedHeight < 300) {
                    resolve(dataUrl);
                    return;
                }
                
                canvas.width = croppedWidth;
                canvas.height = croppedHeight;
                
                ctx.drawImage(
                    img,
                    safeCropLeft, safeCropTop, croppedWidth, croppedHeight,
                    0, 0, croppedWidth, croppedHeight
                );
                
                const croppedDataUrl = canvas.toDataURL('image/png', 0.9);
                resolve(croppedDataUrl);
            } catch (error) {
                reject(error);
            }
        };
        img.onerror = () => reject(new Error('Failed to load image for cropping'));
        img.src = dataUrl;
    });
}

function sendRegularMessageWithTabNote(message) {
    // Add a note about needing an active TradingView tab
    const messageWithNote = message + "\n\n📸 *Screenshot was enabled but requires an active open TradingView tab to work.*";
    
    fetch(settings.webhookUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content: messageWithNote })
    })
    .catch(error => {
        console.error('Error sending notification with tab note:', error);
    });
}

function sendRegularMessageWithScreenshotNote(message) {
    // Add a note about screenshots requiring user interaction
    const messageWithNote = message + "\n\n📸 *Screenshot was enabled but requires opening the extension settings once to activate.*";
    
    fetch(settings.webhookUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content: messageWithNote })
    })
    .catch(error => {
        console.error('Error sending notification with screenshot note:', error);
    });
}

function sendRegularMessage(message) {
    fetch(settings.webhookUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content: message })
    })
    .catch(error => {
        console.error('Error sending notification:', error);
    });
}

function formatNotificationMessage(data) {
    // Determine action type
    let actionType = 'Trade Notification from TradingView';
    
    if (data.originalText) {
        const originalText = data.originalText.toLowerCase();
        
        if (originalText.includes('limit order cancelled')) {
            actionType = '❌ Limit Order Cancelled';
        } else if (originalText.includes('limit order modified')) {
            actionType = '🛠️ Limit Order Modified';
        } else if (originalText.includes('limit order placed')) {
            actionType = '📋 Limit Order Placed';
        } else if (originalText.includes('stop order cancelled')) {
            actionType = '❌ Stop Order Cancelled';
        } else if (originalText.includes('stop order modified')) {
            actionType = '🛠️ Stop Order Modified';
        } else if (originalText.includes('stop order placed')) {
            actionType = '🛑 Stop Order Placed';
        } else if (originalText.includes('take profit order cancelled')) {
            actionType = '❌ Take Profit Cancelled';
        } else if (originalText.includes('stop loss order cancelled')) {
            actionType = '❌ Stop Loss Cancelled';
        } else if (originalText.includes('take profit order modified')) {
            actionType = '🛠️ Take Profit Modified';
        } else if (originalText.includes('stop loss order modified')) {
            actionType = '🛠️ Stop Loss Modified';
        } else if (originalText.includes('executed')) {
            if (data.isLikelyPositionClose) {
                if (data.closeType === 'partial') {
                    actionType = '📉 Partial Close';
                } else if (data.closeType === 'full') {
                    actionType = '🚪 Position Closed';
                } else if (data.closeType === 'reversal') {
                    actionType = '🔄 Position Reversed';
                }
            } else if (data.isAddingToPosition) {
                actionType = '🟩 Added to Position';
            } else {
                actionType = '✅ Trade Executed';
            }
        } else if (originalText.includes('take profit order')) {
            actionType = '🎯 Take Profit Order';
        } else if (originalText.includes('stop loss order')) {
            actionType = '🛑 Stop Loss Order';
        }
    }
    
    let message = `**${actionType}**\n\n`;
    
    // Add symbol if enabled and available
    if (settings.includeSymbol && data.symbol) {
        message += `**Symbol:** ${data.symbol}\n`;
    }
    
    // Add direction for relevant alerts
    if (data.side) {
        const skipDirectionTypes = [
            '🎯 Take Profit Order',
            '🛑 Stop Loss Order',
            '❌ Stop Loss Cancelled', 
            '❌ Take Profit Cancelled',
            '❌ Limit Order Cancelled',
            '❌ Stop Order Cancelled'
        ];
        
        if (!skipDirectionTypes.includes(actionType)) {
            message += `**Direction:** ${data.side}\n`;
        }
    }
    
    // Add price information
    if (data.entry) {
        let showGenericPrice = true;
        
        if (data.originalText) {
            const originalText = data.originalText.toLowerCase();
            if (originalText.includes('stop loss order') || originalText.includes('take profit order')) {
                showGenericPrice = false;
            }
        }
        
        if (showGenericPrice) {
            let priceLabel = 'Price';
            if (data.originalText) {
                const originalText = data.originalText.toLowerCase();
                if (originalText.includes('limit order cancelled') || originalText.includes('stop order cancelled')) {
                    priceLabel = 'Cancelled Price';
                } else if (originalText.includes('limit order')) {
                    priceLabel = 'Limit Price';
                } else if (originalText.includes('stop order')) {
                    priceLabel = 'Stop Price';
                } else if (originalText.includes('executed')) {
                    if (data.isLikelyPositionClose) {
                        if (data.closeType === 'partial') {
                            priceLabel = 'Partial Exit Price';
                        } else if (data.closeType === 'full') {
                            priceLabel = 'Exit Price';
                        } else if (data.closeType === 'reversal') {
                            priceLabel = 'Reversal Price';
                        }
                    } else {
                        priceLabel = 'Execution Price';
                    }
                }
            }
            message += `**${priceLabel}:** ${formatExactPrice(data.entry)}\n`;
        }
    }
    
    if (data.takeProfit) {
        message += `**Take Profit:** ${formatExactPrice(data.takeProfit)}\n`;
    }
    
    if (data.stopLoss) {
        message += `**Stop Loss:** ${formatExactPrice(data.stopLoss)}\n`;
    }
    
    // Add invisible separator for spacing
    message += '\u200B';
    
    return message;
}

// Helper function to format prices exactly without rounding
function formatExactPrice(price) {
    let priceStr = price.toString();
    
    // If it's a very small number in scientific notation, convert it
    if (priceStr.includes('e-')) {
        priceStr = price.toFixed(10).replace(/\.?0+$/, '');
    }
    
    // For very large numbers, add thousands separators but preserve decimals
    if (price >= 1000) {
        const parts = priceStr.split('.');
        const integerPart = parts[0];
        const decimalPart = parts[1] || '';
        
        const formattedInteger = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        
        return decimalPart ? `${formattedInteger}.${decimalPart}` : formattedInteger;
    }
    
    return priceStr;
}

function resetNotificationData() {
    notificationData = {};
}