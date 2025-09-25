// TradingView to Discord Content Script

let isMonitoring = false;
let settings = {};
let notificationData = {};
let symbolPositions = {}; // Track positions per symbol
let tradedSymbols = []; // Track all symbols that have been traded
let lastStopLossPrice = null;
let lastTakeProfitPrice = null;

// Load settings and position data, then start monitoring
chrome.storage.sync.get(['webhookUrl', 'enableNotifications', 'enableScreenshots', 'includeSymbol', 'includeTime'], function(result) {
    settings = {
        webhookUrl: result.webhookUrl || '',
        enableNotifications: result.enableNotifications !== false, // Default to true
        enableScreenshots: result.enableScreenshots === true, // Default to false
        includeSymbol: result.includeSymbol !== false, // Default to true
        includeTime: result.includeTime !== false // Default to true
    };
    
    console.log('Settings loaded:', settings);
    loadPositionData();
    loadTradedSymbols();
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

// Load traded symbols from storage
function loadTradedSymbols() {
    chrome.storage.sync.get(['tradedSymbols'], function(result) {
        if (result.tradedSymbols) {
            tradedSymbols = result.tradedSymbols;
            console.log('Loaded traded symbols:', tradedSymbols);
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

// Save traded symbols to storage
function saveTradedSymbols() {
    chrome.storage.sync.set({
        tradedSymbols: tradedSymbols
    }, function() {
        console.log('Traded symbols saved:', tradedSymbols);
    });
}

// Add symbol to traded symbols list
function addTradedSymbol(symbol) {
    if (symbol && !tradedSymbols.includes(symbol)) {
        tradedSymbols.push(symbol);
        saveTradedSymbols();
    }
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
        if (changes.includeTime) {
            settings.includeTime = changes.includeTime.newValue === true;
        }
        if (changes.symbolPositions) {
            symbolPositions = changes.symbolPositions.newValue || {};
        }
        if (changes.tradedSymbols) {
            tradedSymbols = changes.tradedSymbols.newValue || [];
        }
    }
});

// Listen for messages from popup
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    if (request.action === 'resetPosition') {
        symbolPositions = {}; // Clear positions but keep traded symbols
        lastStopLossPrice = null;
        lastTakeProfitPrice = null;
        savePositionData();
        // Don't clear tradedSymbols - they stay saved
        sendResponse({success: true});
    } else if (request.action === 'updatePosition') {
        // Handle manual position updates from popup
        if (request.symbol && typeof request.position === 'number') {
            if (request.position === 0) {
                delete symbolPositions[request.symbol];
            } else {
                symbolPositions[request.symbol] = request.position;
            }
            savePositionData();
            console.log(`Position manually updated for ${request.symbol}: ${request.position}`);
            sendResponse({success: true});
        } else {
            sendResponse({success: false, error: 'Invalid position data'});
        }
    } else if (request.action === 'deleteSymbol') {
        // Handle symbol deletion from popup
        if (request.symbol) {
            // Remove from both position tracking and traded symbols
            delete symbolPositions[request.symbol];
            tradedSymbols = tradedSymbols.filter(symbol => symbol !== request.symbol);
            
            savePositionData();
            saveTradedSymbols();
            console.log(`Symbol deleted: ${request.symbol}`);
            sendResponse({success: true});
        } else {
            sendResponse({success: false, error: 'No symbol specified'});
        }
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
    
    // Capture the current time when notification is detected
    notificationData.timestamp = new Date();
    
    // Extract basic trade info
    if (text.includes('executed') || text.includes('order placed') || text.includes('order cancelled') || text.includes('Limit order') || text.includes('Stop order')) {
        
        // Handle Stop order format
        const stopOrderMatch = text.match(/Stop\s+order\s+(?:placed|modified|cancelled)\s+on\s+([A-Z_:0-9!.]+?)(?:CloseBuy|CloseSell|\s|$).*?(?:(Buy|Sell)\s+)?([\d,]+\.?\d*)\s+at\s+([\d,]+\.?\d*)/i);
        
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
                const closeBuyMatch = text.match(/(CloseBuy|CloseSell)\s+([\d,]+\.?\d*)\s+at\s+([\d,]+\.?\d*)/i);
                
                if (closeBuyMatch) {
                    const closeSide = closeBuyMatch[1];
                    notificationData.side = closeSide.includes('Buy') ? 'BUY' : 'SELL';
                    notificationData.quantity = parseFloat(closeBuyMatch[2].replace(/,/g, ''));
                    notificationData.entry = parseFloat(closeBuyMatch[3].replace(/,/g, ''));
                } else {
                    // Standard Buy/Sell patterns
                    const standardPatterns = [
                        /(Buy|Sell)\s+([\d,]+\.?\d*)\s+at\s+([\d,]+\.?\d*)/i,
                        /Limit\s+order\s+(Buy|Sell)\s+([\d,]+\.?\d*)\s+at\s+([\d,]+\.?\d*)/i,
                        /Market\s+order\s+(Buy|Sell)\s+([\d,]+\.?\d*)\s+at\s+([\d,]+\.?\d*)/i,
                        /order\s+placed\s+.*?(Buy|Sell)\s+([\d,]+\.?\d*)\s+at\s+([\d,]+\.?\d*)/i
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
        const symbolMatch = text.match(/on\s+([A-Z_:0-9!.]+?)(?:CloseBuy|CloseSell|Buy|Sell|\s|$)/i);
        if (symbolMatch) {
            notificationData.symbol = symbolMatch[1];
        }
    }
    
    // Add symbol to traded symbols list if we have a symbol
    if (notificationData.symbol) {
        addTradedSymbol(notificationData.symbol);
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
    
    // Fix floating point precision issues by rounding to 8 decimal places
    const roundedPositionAfter = Math.round(positionAfter * 100000000) / 100000000;
    
    if (positionBefore !== 0) {
        if (Math.sign(positionBefore) !== Math.sign(quantityChange)) {
            notificationData.isLikelyPositionClose = true;
            
            // Calculate partial percentage (always enabled)
            const closedQuantity = Math.abs(quantityChange);
            const originalQuantity = Math.abs(positionBefore);
            const partialPercentage = Math.round((closedQuantity / originalQuantity) * 100);
            notificationData.partialPercentage = partialPercentage;
            
            if (Math.abs(roundedPositionAfter) < 0.00000001) { // Essentially zero
                notificationData.closeType = 'full';
                symbolPositions[symbol] = 0; // Set to exactly 0
            } else if (Math.sign(roundedPositionAfter) === Math.sign(positionBefore)) {
                notificationData.closeType = 'partial';
                symbolPositions[symbol] = roundedPositionAfter;
            } else {
                notificationData.closeType = 'reversal';
                symbolPositions[symbol] = roundedPositionAfter;
            }
        } else {
            notificationData.isAddingToPosition = true;
            
            // Calculate addition percentage (always enabled)
            const addedQuantity = Math.abs(quantityChange);
            const originalQuantity = Math.abs(positionBefore);
            const additionPercentage = Math.round((addedQuantity / originalQuantity) * 100);
            notificationData.additionPercentage = additionPercentage;
            
            symbolPositions[symbol] = roundedPositionAfter;
        }
    } else {
        symbolPositions[symbol] = roundedPositionAfter;
    }
    
    // Clean up positions that are essentially zero
    if (symbolPositions[symbol] === 0 || Math.abs(symbolPositions[symbol]) < 0.00000001) {
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
    // Add invisible separator for spacing
    const messageWithSpacing = messageWithNote + '\u200B';
    
    fetch(settings.webhookUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content: messageWithSpacing })
    })
    .catch(error => {
        console.error('Error sending notification with tab note:', error);
    });
}

function sendRegularMessageWithScreenshotNote(message) {
    // Add a note about screenshots requiring user interaction
    const messageWithNote = message + "\n\n📸 *Screenshot was enabled but requires opening the extension settings once to activate.*";
    // Add invisible separator for spacing
    const messageWithSpacing = messageWithNote + '\u200B';
    
    fetch(settings.webhookUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content: messageWithSpacing })
    })
    .catch(error => {
        console.error('Error sending notification with screenshot note:', error);
    });
}

function sendRegularMessage(message) {
    // Add invisible separator for spacing when sending regular text messages
    const messageWithSpacing = message + '\u200B';
    
    fetch(settings.webhookUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content: messageWithSpacing })
    })
    .catch(error => {
        console.error('Error sending notification:', error);
    });
}

// Function to format time in New York timezone
function formatNewYorkTime(date) {
    if (!date || !(date instanceof Date)) return '';
    
    try {
        // Format time in New York timezone (Eastern Time)
        const formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/New_York',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false // Use 24-hour format
        });
        
        return formatter.format(date);
    } catch (error) {
        console.error('Error formatting New York time:', error);
        // Fallback to local time if timezone formatting fails
        return date.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        });
    }
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
                    // Add percentage (always enabled)
                    if (data.partialPercentage) {
                        actionType = `📉 Partial Close (${data.partialPercentage}%)`;
                    }
                } else if (data.closeType === 'full') {
                    actionType = '🚪 Position Closed';
                } else if (data.closeType === 'reversal') {
                    actionType = '🔄 Position Reversed';
                }
            } else if (data.isAddingToPosition) {
                actionType = '🟩 Added to Position';
                // Add percentage (always enabled)
                if (data.additionPercentage) {
                    actionType = `🟩 Added to Position (+${data.additionPercentage}%)`;
                }
            } else {
                actionType = '✅ Trade Executed';
            }
        } else if (originalText.includes('take profit order')) {
            actionType = '🎯 Take Profit Order';
        } else if (originalText.includes('stop loss order')) {
            actionType = '🛑 Stop Loss Order';
        }
    }
    
    // Start with code block
    let message = `\`\`\`\n${actionType}`;
    
    // Add time right after action type if enabled
    if (settings.includeTime && data.timestamp) {
        const nyTime = formatNewYorkTime(data.timestamp);
        if (nyTime) {
            message += ` - ${nyTime}`;
        }
    }
    
    message += `\n\n`;
    
    // Add symbol if enabled and available
    if (settings.includeSymbol && data.symbol) {
        message += `Symbol: ${data.symbol}\n`;
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
            message += `Direction: ${data.side}\n`;
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
            message += `${priceLabel}: ${formatExactPrice(data.entry)}\n`;
        }
    }
    
    if (data.takeProfit) {
        message += `Take Profit: ${formatExactPrice(data.takeProfit)}\n`;
    }
    
    if (data.stopLoss) {
        message += `Stop Loss: ${formatExactPrice(data.stopLoss)}\n`;
    }
    
    // Close code block (don't add invisible space here anymore)
    message += `\`\`\``;
    
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
