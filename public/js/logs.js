// Log management module

// Log state
let logsState = {
    logs: [],
    total: 0,
    currentLevel: 'all',
    searchKeyword: '',
    offset: 0,
    limit: 100,
    maxLogs: 500, // Max retained logs to prevent unbounded memory
    autoRefresh: false,
    autoRefreshTimer: null,
    stats: { total: 0, info: 0, warn: 0, error: 0, request: 0, debug: 0 },
    // WebSocket
    ws: null,
    wsConnected: false,
    wsReconnectTimer: null
};

// Load logs
async function loadLogs(append = false) {
    try {
        if (!append) {
            logsState.offset = 0;
        }

        const params = new URLSearchParams({
            level: logsState.currentLevel,
            search: logsState.searchKeyword,
            limit: logsState.limit,
            offset: logsState.offset
        });

        const response = await fetch(`/admin/logs?${params}`, {
            credentials: 'include'
        });

        if (!response.ok) {
            throw new Error('Failed to fetch logs');
        }

        const data = await response.json();
        if (data.success) {
            if (append) {
                logsState.logs = [...logsState.logs, ...data.data.logs];
            } else {
                logsState.logs = data.data.logs;
            }

            // Limit log count to prevent unbounded memory
            if (logsState.logs.length > logsState.maxLogs) {
                logsState.logs = logsState.logs.slice(-logsState.maxLogs);
            }

            logsState.total = data.data.total;
            renderLogs();
        }
    } catch (error) {
        console.error('Failed to load logs:', error);
        showToast('Failed to load logs: ' + error.message, 'error');
    }
}

// Load log statistics
async function loadLogStats() {
    try {
        const response = await fetch('/admin/logs/stats', {
            credentials: 'include'
        });

        if (!response.ok) {
            throw new Error('Failed to fetch log statistics');
        }

        const data = await response.json();
        if (data.success) {
            logsState.stats = data.data;
            renderLogStats();
        }
    } catch (error) {
        console.error('Failed to load log statistics:', error);
    }
}

// Clear logs
async function clearLogs() {
    if (!confirm('Are you sure you want to clear all logs? This action cannot be undone.')) {
        return;
    }

    try {
        const response = await fetch('/admin/logs', {
            method: 'DELETE',
            credentials: 'include'
        });

        const data = await response.json();
        if (data.success) {
            showToast('Logs cleared', 'success');
            logsState.logs = [];
            logsState.total = 0;
            logsState.stats = { total: 0, info: 0, warn: 0, error: 0, request: 0, debug: 0 };
            renderLogs();
            renderLogStats();
        } else {
            showToast(data.message || 'Failed to clear logs', 'error');
        }
    } catch (error) {
        console.error('Failed to clear logs:', error);
        showToast('Failed to clear logs: ' + error.message, 'error');
    }
}

// Filter log level
function filterLogLevel(level) {
    logsState.currentLevel = level;
    logsState.offset = 0;

    // Update active state for statistics
    renderLogStats();

    loadLogs();
}

// Search logs
function searchLogs(keyword) {
    logsState.searchKeyword = keyword;
    logsState.offset = 0;
    loadLogs();
}

// Load more logs
function loadMoreLogs() {
    logsState.offset += logsState.limit;
    loadLogs(true);
}

// Toggle auto refresh
function toggleAutoRefresh() {
    logsState.autoRefresh = !logsState.autoRefresh;
    const btn = document.getElementById('autoRefreshBtn');

    if (logsState.autoRefresh) {
        btn.classList.add('active');
        btn.innerHTML = '⏸️ Stop auto refresh';
        logsState.autoRefreshTimer = setInterval(() => {
            loadLogs();
            loadLogStats();
        }, 3000);
    } else {
        btn.classList.remove('active');
        btn.innerHTML = '🔄 Auto refresh';
        if (logsState.autoRefreshTimer) {
            clearInterval(logsState.autoRefreshTimer);
            logsState.autoRefreshTimer = null;
        }
    }
}

// Render log statistics
function renderLogStats() {
    const statsContainer = document.getElementById('logStats');
    if (!statsContainer) return;

    const currentLevel = logsState.currentLevel;

    statsContainer.innerHTML = `
        <div class="log-stat-item clickable ${currentLevel === 'all' ? 'active' : ''}" onclick="filterLogLevel('all')">
            <span class="log-stat-num">${logsState.stats.total}</span>
            <span class="log-stat-label">All</span>
        </div>
        <div class="log-stat-item info clickable ${currentLevel === 'info' ? 'active' : ''}" onclick="filterLogLevel('info')">
            <span class="log-stat-num">${logsState.stats.info}</span>
            <span class="log-stat-label">Info</span>
        </div>
        <div class="log-stat-item debug clickable ${currentLevel === 'debug' ? 'active' : ''}" onclick="filterLogLevel('debug')">
            <span class="log-stat-num">${logsState.stats.debug}</span>
            <span class="log-stat-label">Debug</span>
        </div>
        <div class="log-stat-item warn clickable ${currentLevel === 'warn' ? 'active' : ''}" onclick="filterLogLevel('warn')">
            <span class="log-stat-num">${logsState.stats.warn}</span>
            <span class="log-stat-label">Warning</span>
        </div>
        <div class="log-stat-item error clickable ${currentLevel === 'error' ? 'active' : ''}" onclick="filterLogLevel('error')">
            <span class="log-stat-num">${logsState.stats.error}</span>
            <span class="log-stat-label">Error</span>
        </div>
        <div class="log-stat-item request clickable ${currentLevel === 'request' ? 'active' : ''}" onclick="filterLogLevel('request')">
            <span class="log-stat-num">${logsState.stats.request}</span>
            <span class="log-stat-label">Request</span>
        </div>
    `;
}

// Check if a line is a separator (only repeating special chars)
function isSeparatorLine(message) {
    if (!message || typeof message !== 'string') return false;
    // Trim and check if it consists of repeating = ─ ═ - * etc.
    const trimmed = message.trim();
    if (trimmed.length < 3) return false;
    // Match lines containing only separator characters
    return /^[═─=\-*_~]+$/.test(trimmed);
}

// Copy log content
function copyLogContent(index, buttonElement) {
    // Retrieve the original message from the sorted logs
    const filteredLogs = logsState.logs.filter(log => !isSeparatorLine(log.message));
    const sortedLogs = [...filteredLogs].reverse();
    const log = sortedLogs[index];

    if (!log) {
        showToast('Copy failed: log not found', 'error');
        return;
    }

    const plainText = log.message;

    navigator.clipboard.writeText(plainText).then(() => {
        // Show copy success feedback
        if (buttonElement) {
            const originalText = buttonElement.innerHTML;
            buttonElement.innerHTML = '✓';
            buttonElement.classList.add('copied');
            setTimeout(() => {
                buttonElement.innerHTML = originalText;
                buttonElement.classList.remove('copied');
            }, 1500);
        }
        showToast('Copied to clipboard', 'success');
    }).catch(err => {
        console.error('Copy failed:', err);
        showToast('Copy failed', 'error');
    });
}

// Render log list
function renderLogs() {
    const container = document.getElementById('logList');
    if (!container) return;

    // Filter out separator lines
    const filteredLogs = logsState.logs.filter(log => !isSeparatorLine(log.message));

    if (filteredLogs.length === 0) {
        container.innerHTML = `
            <div class="log-empty">
                <div class="log-empty-icon">📋</div>
                <div class="log-empty-text">No logs yet</div>
            </div>
        `;
        return;
    }

    // Show logs in chronological order (oldest first)
    // logsState.logs is reverse-chronological (newest first), so reverse it
    const sortedLogs = [...filteredLogs].reverse();

    const logsHtml = sortedLogs.map((log, index) => {
        const levelClass = log.level;
        const levelIcon = {
            info: 'ℹ️',
            warn: '⚠️',
            error: '❌',
            request: '🌐',
            debug: '🔍'
        }[log.level] || '📝';

        const time = new Date(log.timestamp).toLocaleString('en-US', {
            hour12: false,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit'
        });

        // Highlight search terms
        let message = escapeHtml(log.message);
        if (logsState.searchKeyword) {
            const regex = new RegExp(`(${escapeRegExp(logsState.searchKeyword)})`, 'gi');
            message = message.replace(regex, '<mark>$1</mark>');
        }

        return `
            <div class="log-item ${levelClass}" data-log-index="${index}">
                <div class="log-item-header">
                    <span class="log-level-icon">${levelIcon}</span>
                    <span class="log-level-tag ${levelClass}">${log.level.toUpperCase()}</span>
                    <span class="log-time">${time}</span>
                    <button class="log-copy-btn" onclick="copyLogContent(${index}, this)" title="Copy log content">
                        📋
                    </button>
                </div>
                <div class="log-message">${message}</div>
            </div>
        `;
    }).join('');

    container.innerHTML = logsHtml;

    // Scroll to bottom (show latest logs)
    container.scrollTop = container.scrollHeight;

    // Update load more button state
    const loadMoreBtn = document.getElementById('loadMoreLogsBtn');
    if (loadMoreBtn) {
        const hasMore = logsState.logs.length < logsState.total;
        loadMoreBtn.style.display = hasMore ? 'block' : 'none';
        loadMoreBtn.textContent = `Load more (${logsState.logs.length}/${logsState.total})`;
    }
}

// HTML escape
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Regex escape
function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Export logs
function exportLogs() {
    if (logsState.logs.length === 0) {
        showToast('No logs to export', 'warning');
        return;
    }

    const content = logsState.logs.map(log => {
        const time = new Date(log.timestamp).toLocaleString('en-US', { hour12: false });
        return `[${time}] [${log.level.toUpperCase()}] ${log.message}`;
    }).join('\n');

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `logs-${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast('Logs exported', 'success');
}

// Connect WebSocket
function connectLogWebSocket() {
    if (logsState.ws && logsState.ws.readyState === WebSocket.OPEN) {
        return; // already connected
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws/logs`;

    try {
        logsState.ws = new WebSocket(wsUrl);

        logsState.ws.onopen = () => {
            logsState.wsConnected = true;
            console.log('WebSocket log connection established');
            updateWsStatus(true);
        };

        logsState.ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                handleWsMessage(data);
            } catch (e) {
                console.error('Failed to parse WebSocket message:', e);
            }
        };

        logsState.ws.onclose = () => {
            logsState.wsConnected = false;
            console.log('WebSocket log connection closed');
            updateWsStatus(false);
            // Reconnect after 5 seconds
            if (!logsState.wsReconnectTimer) {
                logsState.wsReconnectTimer = setTimeout(() => {
                    logsState.wsReconnectTimer = null;
                    connectLogWebSocket();
                }, 5000);
            }
        };

        logsState.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            logsState.wsConnected = false;
            updateWsStatus(false);
            // Fallback to HTTP loading
            loadLogs();
        };
    } catch (e) {
        console.error('Failed to create WebSocket:', e);
        // Fallback to HTTP loading
        loadLogs();
    }
}

// Handle WebSocket messages
function handleWsMessage(data) {
    switch (data.type) {
        case 'history':
            // Receive historical logs
            logsState.logs = data.logs.reverse(); // newest first
            logsState.total = data.logs.length;
            updateStats();
            renderLogs();
            break;

        case 'log':
            // Receive new logs
            addNewLog(data.log);
            break;

        case 'clear':
            // Logs cleared
            logsState.logs = [];
            logsState.total = 0;
            logsState.stats = { total: 0, info: 0, warn: 0, error: 0, request: 0, debug: 0 };
            renderLogs();
            renderLogStats();
            break;
    }
}

// Add new log
function addNewLog(log) {
    // Insert at the beginning (newest first)
    logsState.logs.unshift(log);
    logsState.total++;

    // Limit count
    if (logsState.logs.length > logsState.maxLogs) {
        logsState.logs.pop();
    }

    // Update stats
    if (!isSeparatorLine(log.message)) {
        logsState.stats.total++;
        if (logsState.stats[log.level] !== undefined) {
            logsState.stats[log.level]++;
        }
        renderLogStats();
    }

    // Check if it matches current filters
    if (logsState.currentLevel !== 'all' && log.level !== logsState.currentLevel) {
        return; // does not match filter; do not add
    }

    if (logsState.searchKeyword && !log.message.toLowerCase().includes(logsState.searchKeyword.toLowerCase())) {
        return; // does not match search
    }

    // Append to DOM
    appendLogToDOM(log);
}

// Append a single log to the DOM (incremental render)
function appendLogToDOM(log) {
    const container = document.getElementById('logList');
    if (!container) return;

    // Remove empty-state prompt if present
    const emptyState = container.querySelector('.log-empty');
    if (emptyState) {
        emptyState.remove();
    }

    const levelClass = log.level;
    const levelIcon = {
        info: 'ℹ️',
        warn: '⚠️',
        error: '❌',
        request: '🌐',
        debug: '🔍'
    }[log.level] || '📝';

    const time = new Date(log.timestamp).toLocaleString('en-US', {
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
    });

    let message = escapeHtml(log.message);
    if (logsState.searchKeyword) {
        const regex = new RegExp(`(${escapeRegExp(logsState.searchKeyword)})`, 'gi');
        message = message.replace(regex, '<mark>$1</mark>');
    }

    const logElement = document.createElement('div');
    logElement.className = `log-item ${levelClass}`;
    logElement.innerHTML = `
        <div class="log-item-header">
            <span class="log-level-icon">${levelIcon}</span>
            <span class="log-level-tag ${levelClass}">${log.level.toUpperCase()}</span>
            <span class="log-time">${time}</span>
        </div>
        <div class="log-message">${message}</div>
    `;

    // Append to bottom
    container.appendChild(logElement);

    // Scroll to bottom
    container.scrollTop = container.scrollHeight;
}

// Update stats
function updateStats() {
    const stats = { total: 0, info: 0, warn: 0, error: 0, request: 0, debug: 0 };
    for (const log of logsState.logs) {
        if (isSeparatorLine(log.message)) continue;
        stats.total++;
        if (stats[log.level] !== undefined) {
            stats[log.level]++;
        }
    }
    logsState.stats = stats;
    renderLogStats();
}

// Update WebSocket connection status display
function updateWsStatus(connected) {
    const btn = document.getElementById('autoRefreshBtn');
    if (btn) {
        if (connected) {
            btn.innerHTML = '🟢 Live streaming';
            btn.classList.add('active');
            btn.disabled = true;
        } else {
            btn.innerHTML = '🔴 Disconnected';
            btn.classList.remove('active');
            btn.disabled = false;
        }
    }
}

// Disconnect WebSocket
function disconnectLogWebSocket() {
    if (logsState.wsReconnectTimer) {
        clearTimeout(logsState.wsReconnectTimer);
        logsState.wsReconnectTimer = null;
    }

    if (logsState.ws) {
        logsState.ws.close();
        logsState.ws = null;
    }
    logsState.wsConnected = false;
}

// Initialize logs page
function initLogsPage() {
    // Prefer WebSocket live streaming
    connectLogWebSocket();
    // Load stats (always needed)
    loadLogStats();
}

// Cleanup logs page (when leaving)
function cleanupLogsPage() {
    // Disconnect WebSocket
    disconnectLogWebSocket();

    if (logsState.autoRefreshTimer) {
        clearInterval(logsState.autoRefreshTimer);
        logsState.autoRefreshTimer = null;
    }
    logsState.autoRefresh = false;

    // Clear log data to free memory
    logsState.logs = [];
    logsState.total = 0;
    logsState.offset = 0;

    // Clear DOM contents
    const container = document.getElementById('logList');
    if (container) {
        container.innerHTML = '';
    }
}
