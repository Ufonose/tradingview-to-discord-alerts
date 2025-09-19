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

function showStatus(message, type) {
    const statusDiv = document.getElementById('status');
    statusDiv.textContent = message;
    statusDiv.className = `status ${type}`;
    statusDiv.style.display = 'block';
    
    setTimeout(() => {
        statusDiv.style.display = 'none';
    }, 5000);
}