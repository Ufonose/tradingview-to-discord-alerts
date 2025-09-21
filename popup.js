document.addEventListener('DOMContentLoaded', function() {
    loadSettings();
    
    document.getElementById('saveSettings').addEventListener('click', saveSettings);
    document.getElementById('testWebhook').addEventListener('click', testWebhook);
    document.getElementById('resetPosition').addEventListener('click', resetPosition);
    
    // Help modal functionality
    document.getElementById('helpBtn').addEventListener('click', function() {
        document.getElementById('helpModal').style.display = 'block';
    });
    
    document.getElementById('closeModal').addEventListener('click', function() {
        document.getElementById('helpModal').style.display = 'none';
    });
    
    // Close modal when clicking outside of it
    window.addEventListener('click', function(event) {
        const modal = document.getElementById('helpModal');
        if (event.target === modal) {
            modal.style.display = 'none';
        }
    });
    
    // Auto-save notification toggle
    document.getElementById('enableNotifications').addEventListener('change', function() {
        const enableNotifications = this.checked;
        
        chrome.storage.sync.set({
            enableNotifications: enableNotifications
        }, function() {
            const status = enableNotifications ? 'enabled' : 'disabled';
            showInlineFeedback('notificationsFeedback', `Notifications ${status}!`);
        });
    });
    
    // Auto-save symbol toggle
    document.getElementById('includeSymbol').addEventListener('change', function() {
        const includeSymbol = this.checked;
        
        chrome.storage.sync.set({
            includeSymbol: includeSymbol
        }, function() {
            const status = includeSymbol ? 'enabled' : 'disabled';
            showInlineFeedback('symbolFeedback', `Symbol info ${status}!`);
        });
    });
    
    // Auto-save screenshot toggle
    document.getElementById('enableScreenshots').addEventListener('change', function() {
        const enableScreenshots = this.checked;
        
        chrome.storage.sync.set({
            enableScreenshots: enableScreenshots
        }, function() {
            const status = enableScreenshots ? 'enabled' : 'disabled';
            showInlineFeedback('screenshotsFeedback', `Screenshots ${status}!`);
        });
    });
    
    // NEW: Load symbols dropdown and position functionality
    loadSymbolsDropdown();
    
    // NEW: Set position button
    const setPositionBtn = document.getElementById('setPosition');
    if (setPositionBtn) {
        setPositionBtn.addEventListener('click', setManualPosition);
    }
    
    // NEW: Delete symbol button
    const deleteSymbolBtn = document.getElementById('deleteSymbol');
    if (deleteSymbolBtn) {
        deleteSymbolBtn.addEventListener('click', deleteSelectedSymbol);
    }
    
    // NEW: Update position input when symbol selection changes
    const symbolSelect = document.getElementById('symbolSelect');
    if (symbolSelect) {
        symbolSelect.addEventListener('change', function() {
            const selectedSymbol = this.value;
            if (selectedSymbol) {
                loadCurrentPosition(selectedSymbol);
            } else {
                const positionInput = document.getElementById('positionInput');
                if (positionInput) {
                    positionInput.value = '';
                }
            }
        });
    }
});

function loadSettings() {
    chrome.storage.sync.get(['webhookUrl', 'enableNotifications', 'enableScreenshots', 'includeSymbol'], function(result) {
        document.getElementById('webhookUrl').value = result.webhookUrl || '';
        document.getElementById('enableNotifications').checked = result.enableNotifications !== false;
        document.getElementById('includeSymbol').checked = result.includeSymbol === true;
        document.getElementById('enableScreenshots').checked = result.enableScreenshots === true;
    });
}

function saveSettings() {
    const webhookUrl = document.getElementById('webhookUrl').value;
    
    if (!webhookUrl) {
        showConnectionFeedback('Please enter webhook URL', 'error');
        return;
    }
    
    if (!webhookUrl.includes('discord.com/api/webhooks/')) {
        showConnectionFeedback('Invalid webhook URL format', 'error');
        return;
    }
    
    chrome.storage.sync.set({
        webhookUrl: webhookUrl
    }, function() {
        showConnectionFeedback('Webhook URL saved!', 'success');
    });
}

function testWebhook() {
    const webhookUrl = document.getElementById('webhookUrl').value;
    
    if (!webhookUrl) {
        showConnectionFeedback('Enter webhook URL first', 'error');
        return;
    }
    
    const testMessage = {
        "content": "🧪 **Test Message from TradingView Extension**\n\n✅ If you see this message, your setup is complete!"
    };
    
    fetch(webhookUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(testMessage)
    })
    .then(response => {
        if (response.ok) {
            showConnectionFeedback('Test message sent successfully!', 'success');
        } else {
            showConnectionFeedback('Test failed - check webhook URL', 'error');
        }
    })
    .catch(error => {
        showConnectionFeedback('Connection error', 'error');
    });
}

function resetPosition() {
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        chrome.tabs.sendMessage(tabs[0].id, {action: 'resetPosition'}, function(response) {
            if (chrome.runtime.lastError) {
                showResetFeedback('Please navigate to TradingView first, then try reset', 'error');
            } else if (response && response.success) {
                showResetFeedback('Position tracking reset successfully!', 'success');
                // NEW: Refresh the dropdown since positions were reset (but symbols are preserved)
                loadSymbolsDropdown();
                // NEW: Clear the position input
                const positionInput = document.getElementById('positionInput');
                const symbolSelect = document.getElementById('symbolSelect');
                if (positionInput) positionInput.value = '';
                if (symbolSelect) symbolSelect.value = '';
            } else {
                showResetFeedback('Failed to reset position tracking', 'error');
            }
        });
    });
}

function showConnectionFeedback(message, type) {
    const feedbackElement = document.getElementById('connectionFeedback');
    feedbackElement.textContent = message;
    feedbackElement.className = `connection-feedback-item ${type} show`;
    
    // Hide the feedback after 2.5 seconds
    setTimeout(() => {
        feedbackElement.classList.remove('show');
    }, 2500);
}

function showResetFeedback(message, type) {
    const feedbackElement = document.getElementById('resetFeedback');
    feedbackElement.textContent = message;
    feedbackElement.className = `reset-feedback ${type} show`;
    
    // Hide the feedback after 3 seconds (bit longer for reset since it's more important)
    setTimeout(() => {
        feedbackElement.classList.remove('show');
    }, 3000);
}

function showInlineFeedback(elementId, message) {
    const feedbackElement = document.getElementById(elementId);
    feedbackElement.textContent = message;
    feedbackElement.className = 'setting-feedback success show';
    
    // Hide the feedback after 2 seconds
    setTimeout(() => {
        feedbackElement.classList.remove('show');
    }, 2000);
}

// NEW FUNCTIONS ONLY - Added for manual position input
function loadSymbolsDropdown() {
    const symbolSelect = document.getElementById('symbolSelect');
    if (!symbolSelect) return;
    
    chrome.storage.sync.get(['symbolPositions'], function(result) {
        const symbolPositions = result.symbolPositions || {};
        
        // Clear existing options except the first one
        symbolSelect.innerHTML = '<option value="">Choose a symbol...</option>';
        
        // Get all symbols that have been traded (even if position is currently 0)
        chrome.storage.sync.get(['tradedSymbols'], function(tradedResult) {
            const tradedSymbols = tradedResult.tradedSymbols || [];
            
            // Combine symbols from positions and traded symbols
            const allSymbols = new Set([...Object.keys(symbolPositions), ...tradedSymbols]);
            
            // Sort symbols alphabetically
            const sortedSymbols = Array.from(allSymbols).sort();
            
            sortedSymbols.forEach(symbol => {
                const option = document.createElement('option');
                option.value = symbol;
                const currentPosition = symbolPositions[symbol] || 0;
                // Fix floating point precision issues by rounding to 8 decimal places
                const displayPosition = Math.round(currentPosition * 100000000) / 100000000;
                option.textContent = `${symbol} (Current: ${displayPosition})`;
                symbolSelect.appendChild(option);
            });
            
            if (sortedSymbols.length === 0) {
                const option = document.createElement('option');
                option.value = '';
                option.textContent = 'No symbols available - execute a trade first';
                option.disabled = true;
                symbolSelect.appendChild(option);
            }
        });
    });
}

function loadCurrentPosition(symbol) {
    chrome.storage.sync.get(['symbolPositions'], function(result) {
        const symbolPositions = result.symbolPositions || {};
        const currentPosition = symbolPositions[symbol] || 0;
        // Fix floating point precision issues by rounding to 8 decimal places
        const displayPosition = Math.round(currentPosition * 100000000) / 100000000;
        const positionInput = document.getElementById('positionInput');
        if (positionInput) {
            positionInput.value = displayPosition;
        }
    });
}

function setManualPosition() {
    const symbolSelect = document.getElementById('symbolSelect');
    const positionInput = document.getElementById('positionInput');
    
    if (!symbolSelect || !positionInput) return;
    
    const selectedSymbol = symbolSelect.value;
    const positionInputValue = positionInput.value;
    
    if (!selectedSymbol) {
        showPositionFeedback('Please select a symbol first', 'error');
        return;
    }
    
    if (positionInputValue === '') {
        showPositionFeedback('Please enter a position value', 'error');
        return;
    }
    
    const positionValue = parseFloat(positionInputValue);
    
    if (isNaN(positionValue)) {
        showPositionFeedback('Please enter a valid number', 'error');
        return;
    }
    
    // Load current symbol positions
    chrome.storage.sync.get(['symbolPositions'], function(result) {
        const symbolPositions = result.symbolPositions || {};
        
        // Set the new position
        if (positionValue === 0) {
            delete symbolPositions[selectedSymbol];
        } else {
            symbolPositions[selectedSymbol] = positionValue;
        }
        
        // Save the updated positions
        chrome.storage.sync.set({
            symbolPositions: symbolPositions
        }, function() {
            const positionText = positionValue === 0 ? 'flat' : 
                                positionValue > 0 ? `${positionValue} long` : 
                                `${Math.abs(positionValue)} short`;
            
            showPositionFeedback(`Position set to ${positionText} for ${selectedSymbol}`, 'success');
            
            // Refresh the dropdown to show updated positions
            loadSymbolsDropdown();
            
            // Send message to content script to update its position data
            chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
                if (tabs[0] && tabs[0].url && tabs[0].url.includes('tradingview.com')) {
                    chrome.tabs.sendMessage(tabs[0].id, {
                        action: 'updatePosition',
                        symbol: selectedSymbol,
                        position: positionValue
                    }, function(response) {
                        // Handle response if needed
                        if (chrome.runtime.lastError) {
                            // Content script might not be ready, that's ok
                            console.log('Content script not available, position will sync on next page load');
                        }
                    });
                }
            });
        });
    });
}

function showPositionFeedback(message, type) {
    const feedbackElement = document.getElementById('positionFeedback');
    if (!feedbackElement) return;
    
    feedbackElement.textContent = message;
    feedbackElement.className = `position-feedback-item ${type} show`;
    
    // Hide the feedback after 3 seconds
    setTimeout(() => {
        feedbackElement.classList.remove('show');
    }, 3000);
}

// NEW: Delete selected symbol from traded symbols list
function deleteSelectedSymbol() {
    const symbolSelect = document.getElementById('symbolSelect');
    
    if (!symbolSelect) return;
    
    const selectedSymbol = symbolSelect.value;
    
    if (!selectedSymbol) {
        showPositionFeedback('Please select a symbol to delete', 'error');
        return;
    }
    
    // Confirm deletion
    if (!confirm(`Are you sure you want to remove "${selectedSymbol}" from the symbols list? This will also clear any position data for this symbol.`)) {
        return;
    }
    
    // Load current data
    chrome.storage.sync.get(['symbolPositions', 'tradedSymbols'], function(result) {
        const symbolPositions = result.symbolPositions || {};
        const tradedSymbols = result.tradedSymbols || [];
        
        // Remove symbol from both lists
        delete symbolPositions[selectedSymbol];
        const updatedTradedSymbols = tradedSymbols.filter(symbol => symbol !== selectedSymbol);
        
        // Save the updated data
        chrome.storage.sync.set({
            symbolPositions: symbolPositions,
            tradedSymbols: updatedTradedSymbols
        }, function() {
            showPositionFeedback(`"${selectedSymbol}" removed from symbols list`, 'success');
            
            // Refresh the dropdown
            loadSymbolsDropdown();
            
            // Clear the inputs
            const positionInput = document.getElementById('positionInput');
            if (positionInput) positionInput.value = '';
            symbolSelect.value = '';
            
            // Send message to content script to update its data
            chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
                if (tabs[0] && tabs[0].url && tabs[0].url.includes('tradingview.com')) {
                    chrome.tabs.sendMessage(tabs[0].id, {
                        action: 'deleteSymbol',
                        symbol: selectedSymbol
                    }, function(response) {
                        if (chrome.runtime.lastError) {
                            console.log('Content script not available, symbol will be removed on next page load');
                        }
                    });
                }
            });
        });
    });
}
