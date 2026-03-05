// Quota management: view, refresh, cache

let currentQuotaToken = null;

const quotaCache = {
    data: {},
    ttl: 5 * 60 * 1000,
    maxSize: 50, // Max cache entries
    cleanupTimer: null,

    get(tokenId) {
        const cached = this.data[tokenId];
        if (!cached) return null;
        if (Date.now() - cached.timestamp > this.ttl) {
            delete this.data[tokenId];
            return null;
        }
        return cached.data;
    },

    set(tokenId, data) {
        // Check cache size; evict oldest entries if needed
        const keys = Object.keys(this.data);
        if (keys.length >= this.maxSize) {
            this._evictOldest(Math.ceil(this.maxSize * 0.2)); // Evict 20%
        }
        this.data[tokenId] = { data, timestamp: Date.now() };
    },

    clear(tokenId) {
        if (tokenId) {
            delete this.data[tokenId];
        } else {
            this.data = {};
        }
    },

    // Remove expired cache entries
    cleanup() {
        const now = Date.now();
        const keys = Object.keys(this.data);
        let cleaned = 0;
        for (const key of keys) {
            if (now - this.data[key].timestamp > this.ttl) {
                delete this.data[key];
                cleaned++;
            }
        }
        return cleaned;
    },

    // Evict the oldest n entries
    _evictOldest(n) {
        const entries = Object.entries(this.data)
            .sort((a, b) => a[1].timestamp - b[1].timestamp);
        for (let i = 0; i < Math.min(n, entries.length); i++) {
            delete this.data[entries[i][0]];
        }
    },

    // Start periodic cleanup
    startCleanupTimer() {
        if (this.cleanupTimer) return;
        this.cleanupTimer = setInterval(() => {
            this.cleanup();
        }, 60 * 1000); // Clean expired cache every minute
    },

    // Stop periodic cleanup
    stopCleanupTimer() {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = null;
        }
    },

    // Get cache stats
    getStats() {
        return {
            size: Object.keys(this.data).length,
            maxSize: this.maxSize
        };
    }
};

// Start cache cleanup timer on page load
if (typeof document !== 'undefined') {
    quotaCache.startCleanupTimer();

    // Cleanup on page unload
    window.addEventListener('beforeunload', () => {
        quotaCache.stopCleanupTimer();
        quotaCache.clear();
    });
}

const QUOTA_GROUPS = [
    {
        key: 'claude',
        label: 'Claude',
        iconSrc: '/assets/icons/claude.svg',
        match: (modelId) => modelId.toLowerCase().includes('claude')
    },
    {
        key: 'banana',
        label: 'banana',
        iconSrc: '/assets/icons/banana.svg',
        match: (modelId) => modelId.toLowerCase().includes('gemini-3.1-flash-image')
    },
    {
        key: 'gemini',
        label: 'Gemini',
        iconSrc: '/assets/icons/gemini.svg',
        match: (modelId) => modelId.toLowerCase().includes('gemini') || modelId.toLowerCase().includes('publishers/google/')
    },
    {
        key: 'other',
        label: 'Other',
        iconSrc: '',
        match: () => true
    }
];

const QUOTA_SUMMARY_KEYS = ['claude', 'gemini', 'banana'];

function getGroupIconHtml(group) {
    const src = group?.iconSrc || '';
    const alt = escapeHtml(group?.label || '');
    const safeSrc = escapeHtml(src);
    if (!safeSrc) return '';
    return `<img class="quota-icon-img" src="${safeSrc}" alt="${alt}" loading="lazy" decoding="async">`;
}

function clamp01(value) {
    const numberValue = Number(value);
    if (!Number.isFinite(numberValue)) return 0;
    return Math.min(1, Math.max(0, numberValue));
}

function toPercentage(fraction01) {
    return clamp01(fraction01) * 100;
}

function formatPercentage(fraction01) {
    return `${toPercentage(fraction01).toFixed(2)}%`;
}

function getBarColor(percentage) {
    if (percentage > 50) return '#10b981';
    if (percentage > 20) return '#f59e0b';
    return '#ef4444';
}

function groupModels(models) {
    const grouped = { claude: [], gemini: [], banana: [], other: [] };

    Object.entries(models || {}).forEach(([modelId, quota]) => {
        const groupKey = (QUOTA_GROUPS.find(g => g.match(modelId)) || QUOTA_GROUPS[QUOTA_GROUPS.length - 1]).key;
        if (!grouped[groupKey]) grouped[groupKey] = [];
        grouped[groupKey].push({ modelId, quota });
    });

    return grouped;
}

// 不同模型系列的每次请求消耗百分比（与后端 GROUP_COST_PERCENT 保持一致）
const GROUP_COST_PERCENT = {
    claude: 0.6667,
    gemini: 0.6667,
    banana: 5.0,    // 图片生成模型消耗更高，约 20 次/满额
    other: 0.6667
};

function summarizeGroup(items, requestCount = 0, groupKey = null) {
    if (!items || items.length === 0) {
        return { percentage: 0, percentageText: '--', resetTime: '--', estimatedRequests: 0 };
    }

    let minRemaining = 1;
    let earliestResetMs = null;
    let earliestResetText = null;

    items.forEach(({ quota }) => {
        const remaining = clamp01(quota?.remaining);
        if (remaining < minRemaining) minRemaining = remaining;

        const resetRaw = quota?.resetTimeRaw;
        const resetText = quota?.resetTime;

        if (resetRaw) {
            const ms = Date.parse(resetRaw);
            if (Number.isFinite(ms) && (earliestResetMs === null || ms < earliestResetMs)) {
                earliestResetMs = ms;
                earliestResetText = resetText || null;
            }
        } else if (!earliestResetText && resetText) {
            earliestResetText = resetText;
        }
    });

    // Use different cost percentage based on model group
    const costPercent = (groupKey && GROUP_COST_PERCENT[groupKey]) || 0.6667;
    // Estimate total requests based on the current threshold, then subtract recorded count
    const percentageValue = toPercentage(minRemaining);
    const totalFromThreshold = Math.floor(percentageValue / costPercent);
    const estimatedRequests = Math.max(0, totalFromThreshold - requestCount);

    return {
        percentage: percentageValue,
        percentageText: formatPercentage(minRemaining),
        resetTime: earliestResetText || '--',
        estimatedRequests
    };
}

// Load quota summary by tokenId
async function loadTokenQuotaSummary(tokenId) {
    const cardId = tokenId.substring(0, 8);
    const summaryEl = document.getElementById(`quota-summary-${cardId}`);
    if (!summaryEl) return;

    const cached = quotaCache.get(tokenId);
    if (cached) {
        renderQuotaSummary(summaryEl, cached);
        return;
    }

    try {
        const response = await authFetch(`/admin/tokens/${encodeURIComponent(tokenId)}/quotas`);
        const data = await response.json();

        if (data.success && data.data && data.data.models) {
            quotaCache.set(tokenId, data.data);
            renderQuotaSummary(summaryEl, data.data);
        } else if (data.success && data.data) {
            // Disabled tokens may return empty data
            renderQuotaSummary(summaryEl, data.data);
        } else {
            const errMsg = escapeHtml(data.message || 'Unknown error');
            summaryEl.innerHTML = `<span class="quota-summary-error">📊 ${errMsg}</span>`;
        }
    } catch (error) {
        if (error.message !== 'Unauthorized') {
            console.error('Failed to load quota summary:', error);
            summaryEl.innerHTML = `<span class="quota-summary-error">📊 Load failed</span>`;
        }
    }
}

function renderQuotaSummary(summaryEl, quotaData) {
    const models = quotaData.models;
    const requestCounts = quotaData.requestCounts || {};
    const modelEntries = Object.entries(models || {});

    if (modelEntries.length === 0) {
        summaryEl.textContent = '📊 No quota available';
        return;
    }

    const grouped = groupModels(models);
    const groupByKey = Object.fromEntries(QUOTA_GROUPS.map(g => [g.key, g]));

    const rowsHtml = QUOTA_SUMMARY_KEYS.map((groupKey) => {
        const group = groupByKey[groupKey];
        const summary = summarizeGroup(grouped[groupKey], requestCounts[groupKey] || 0, groupKey);
        const barColor = summary.percentageText === '--' ? '#9ca3af' : getBarColor(summary.percentage);
        const safeResetTime = escapeHtml(summary.resetTime);
        const resetText = safeResetTime === '--' ? '--' : `Reset: ${safeResetTime}`;
        const estimatedText = summary.estimatedRequests > 0 ? ` · ~${summary.estimatedRequests} requests` : '';
        const safeLabel = escapeHtml(group?.label || groupKey);
        const title = `${group?.label || groupKey} - Reset: ${summary.resetTime} - Estimated: ${summary.estimatedRequests} requests`;
        return `
            <div class="quota-summary-row" title="${escapeHtml(title)}">
                <span class="quota-summary-icon">${getGroupIconHtml(group)}</span>
                <span class="quota-summary-label">${safeLabel}</span>
                <span class="quota-summary-bar"><span style="width:${summary.percentage}%;background:${barColor}"></span></span>
                <span class="quota-summary-pct">${summary.percentageText}</span>
                <span class="quota-summary-reset">${resetText}${estimatedText}</span>
            </div>
        `;
    }).join('');

    summaryEl.innerHTML = `
        <div class="quota-summary-grid">
            ${rowsHtml}
        </div>
    `;
}

async function toggleQuotaExpand(cardId, tokenId) {
    const detailEl = document.getElementById(`quota-detail-${cardId}`);
    const toggleEl = document.getElementById(`quota-toggle-${cardId}`);
    if (!detailEl || !toggleEl) return;

    const isHidden = detailEl.classList.contains('hidden');

    if (isHidden) {
        detailEl.classList.remove('hidden');
        detailEl.classList.remove('collapsing');
        toggleEl.classList.add('expanded');

        if (!detailEl.dataset.loaded) {
            detailEl.innerHTML = '<div class="quota-loading-small">Loading...</div>';
            await loadQuotaDetail(cardId, tokenId);
            detailEl.dataset.loaded = 'true';
        }
    } else {
        // Add collapse animation
        detailEl.classList.add('collapsing');
        toggleEl.classList.remove('expanded');

        // Hide after animation
        setTimeout(() => {
            detailEl.classList.add('hidden');
            detailEl.classList.remove('collapsing');
        }, 200);
    }
}

async function loadQuotaDetail(cardId, tokenId) {
    const detailEl = document.getElementById(`quota-detail-${cardId}`);
    if (!detailEl) return;

    try {
        const response = await authFetch(`/admin/tokens/${encodeURIComponent(tokenId)}/quotas`);
        const data = await response.json();

        if (data.success && data.data && data.data.models) {
            const models = data.data.models;
            const modelEntries = Object.entries(models);

            if (modelEntries.length === 0) {
                detailEl.innerHTML = '<div class="quota-empty-small">No quota data available</div>';
                return;
            }

            const grouped = groupModels(models);

            let html = '<div class="quota-detail-grid">';

            const renderGroup = (items, icon) => {
                if (items.length === 0) return '';
                let groupHtml = '';
                items.forEach(({ modelId, quota }) => {
                    const percentage = toPercentage(quota?.remaining);
                    const percentageText = formatPercentage(quota?.remaining);
                    const barColor = getBarColor(percentage);
                    const shortName = escapeHtml(modelId.replace('models/', '').replace('publishers/google/', '').split('/').pop());
                    const safeModelId = escapeHtml(modelId);
                    const safeResetTime = escapeHtml(quota.resetTime);
                    groupHtml += `
                        <div class="quota-detail-row" title="${safeModelId} - Reset: ${safeResetTime}">
                            <span class="quota-detail-icon">${icon}</span>
                            <span class="quota-detail-name">${shortName}</span>
                            <span class="quota-detail-bar"><span style="width:${percentage}%;background:${barColor}"></span></span>
                            <span class="quota-detail-pct">${percentageText}</span>
                        </div>
                    `;
                });
                return groupHtml;
            };

            const groupByKey = Object.fromEntries(QUOTA_GROUPS.map(g => [g.key, g]));
            html += renderGroup(grouped.claude, getGroupIconHtml(groupByKey.claude));
            html += renderGroup(grouped.gemini, getGroupIconHtml(groupByKey.gemini));
            html += renderGroup(grouped.banana, getGroupIconHtml(groupByKey.banana));
            html += renderGroup(grouped.other, '');
            html += '</div>';
            html += `<button class="btn btn-info btn-xs quota-refresh-btn" onclick="refreshInlineQuota('${escapeJs(cardId)}', '${escapeJs(tokenId)}')">🔄 Refresh quota</button>`;

            detailEl.innerHTML = html;
        } else {
            const errMsg = escapeHtml(data.message || 'Unknown error');
            detailEl.innerHTML = `<div class="quota-error-small">Load failed: ${errMsg}</div>`;
        }
    } catch (error) {
        if (error.message !== 'Unauthorized') {
            detailEl.innerHTML = `<div class="quota-error-small">Network error</div>`;
        }
    }
}

async function refreshInlineQuota(cardId, tokenId) {
    const detailEl = document.getElementById(`quota-detail-${cardId}`);
    const summaryEl = document.getElementById(`quota-summary-${cardId}`);

    if (detailEl) detailEl.innerHTML = '<div class="quota-loading-small">Refreshing...</div>';
    if (summaryEl) summaryEl.textContent = '📊 Refreshing...';

    quotaCache.clear(tokenId);

    try {
        const response = await authFetch(`/admin/tokens/${encodeURIComponent(tokenId)}/quotas?refresh=true`);
        const data = await response.json();
        if (data.success && data.data) {
            quotaCache.set(tokenId, data.data);
        }
    } catch (e) { }

    await loadTokenQuotaSummary(tokenId);
    await loadQuotaDetail(cardId, tokenId);
}

// Store current modal handler references for cleanup
let quotaModalWheelHandler = null;

async function showQuotaModal(tokenId) {
    currentQuotaToken = tokenId;

    const activeIndex = cachedTokens.findIndex(t => t.id === tokenId);

    const emailTabs = cachedTokens.map((t, index) => {
        const email = t.email || 'Unknown';
        const shortEmail = email.length > 20 ? email.substring(0, 17) + '...' : email;
        const isActive = index === activeIndex;
        const safeEmail = escapeHtml(email);
        const safeShortEmail = escapeHtml(shortEmail);
        return `<button type="button" class="quota-tab${isActive ? ' active' : ''}" data-index="${index}" onclick="switchQuotaAccountByIndex(${index})" title="${safeEmail}">${safeShortEmail}</button>`;
    }).join('');

    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = 'quotaModal';
    modal.innerHTML = `
        <div class="modal-content modal-xl">
            <div class="quota-modal-header">
                <div class="modal-title">📊 Model quota</div>
                <div class="quota-update-time" id="quotaUpdateTime"></div>
            </div>
            <div class="quota-tabs" id="quotaEmailList">
                ${emailTabs}
            </div>
            <div id="quotaContent" class="quota-container">
                <div class="quota-loading">Loading...</div>
            </div>
            <div class="modal-actions">
                <button class="btn btn-secondary btn-sm" onclick="closeQuotaModal()">Close</button>
                <button class="btn btn-info btn-sm" id="quotaRefreshBtn" onclick="refreshQuotaData()">🔄 Refresh</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    // Cleanup listeners when closing the modal
    modal.onclick = (e) => {
        if (e.target === modal) {
            closeQuotaModal();
        }
    };

    await loadQuotaData(tokenId);

    const tabsContainer = document.getElementById('quotaEmailList');
    if (tabsContainer) {
        // Create and store handler references
        quotaModalWheelHandler = (e) => {
            if (e.deltaY !== 0) {
                e.preventDefault();
                tabsContainer.scrollLeft += e.deltaY;
            }
        };
        tabsContainer.addEventListener('wheel', quotaModalWheelHandler, { passive: false });
    }
}

// Close quota modal and cleanup listeners
function closeQuotaModal() {
    const modal = document.getElementById('quotaModal');

    // Cleanup wheel event listener
    if (quotaModalWheelHandler) {
        const tabsContainer = document.getElementById('quotaEmailList');
        if (tabsContainer) {
            tabsContainer.removeEventListener('wheel', quotaModalWheelHandler);
        }
        quotaModalWheelHandler = null;
    }

    if (modal) {
        modal.remove();
    }

    currentQuotaToken = null;
}

async function switchQuotaAccountByIndex(index) {
    if (index < 0 || index >= cachedTokens.length) return;

    const token = cachedTokens[index];
    currentQuotaToken = token.id;

    document.querySelectorAll('.quota-tab').forEach((tab, i) => {
        if (i === index) {
            tab.classList.add('active');
        } else {
            tab.classList.remove('active');
        }
    });

    await loadQuotaData(token.id);
}

async function switchQuotaAccount(tokenId) {
    const index = cachedTokens.findIndex(t => t.id === tokenId);
    if (index >= 0) {
        await switchQuotaAccountByIndex(index);
    }
}

async function loadQuotaData(tokenId, forceRefresh = false) {
    const quotaContent = document.getElementById('quotaContent');
    if (!quotaContent) return;

    const refreshBtn = document.getElementById('quotaRefreshBtn');
    if (refreshBtn) {
        refreshBtn.disabled = true;
        refreshBtn.textContent = '⏳ Loading...';
    }

    if (!forceRefresh) {
        const cached = quotaCache.get(tokenId);
        if (cached) {
            renderQuotaModal(quotaContent, cached);
            if (refreshBtn) {
                refreshBtn.disabled = false;
                refreshBtn.textContent = '🔄 Refresh';
            }
            return;
        }
    } else {
        quotaCache.clear(tokenId);
    }

    quotaContent.innerHTML = '<div class="quota-loading">Loading...</div>';

    try {
        const url = `/admin/tokens/${encodeURIComponent(tokenId)}/quotas${forceRefresh ? '?refresh=true' : ''}`;
        const response = await authFetch(url);

        const data = await response.json();

        if (data.success) {
            quotaCache.set(tokenId, data.data);
            renderQuotaModal(quotaContent, data.data);
        } else {
            quotaContent.innerHTML = `<div class="quota-error">Load failed: ${escapeHtml(data.message)}</div>`;
        }
    } catch (error) {
        if (quotaContent) {
            quotaContent.innerHTML = `<div class="quota-error">Load failed: ${escapeHtml(error.message)}</div>`;
        }
    } finally {
        if (refreshBtn) {
            refreshBtn.disabled = false;
            refreshBtn.textContent = '🔄 Refresh';
        }
    }
}

async function refreshQuotaData() {
    if (currentQuotaToken) {
        await loadQuotaData(currentQuotaToken, true);
    }
}

// Refresh quota data for all Tokens
async function refreshAllQuotas() {
    if (!cachedTokens || cachedTokens.length === 0) {
        showToast('No Tokens available to refresh', 'warning');
        return;
    }

    // Filter enabled tokens only
    const enabledTokens = cachedTokens.filter(t => t.enable !== false);
    if (enabledTokens.length === 0) {
        showToast('No enabled Tokens to refresh', 'warning');
        return;
    }

    const btn = document.getElementById('refreshQuotasBtn');
    if (btn) {
        btn.disabled = true;
        btn.textContent = '⏳ Refreshing...';
    }

    // Clear cache only for enabled tokens
    enabledTokens.forEach(t => quotaCache.clear(t.id));

    try {
        // Refresh enabled token quotas in parallel
        const refreshPromises = enabledTokens.map(async (token) => {
            try {
                const response = await authFetch(`/admin/tokens/${encodeURIComponent(token.id)}/quotas?refresh=true`);
                const data = await response.json();
                if (data.success && data.data) {
                    quotaCache.set(token.id, data.data);
                }
            } catch (e) {
                // Single token refresh failure should not block others
                console.error(`Failed to refresh quota for Token ${token.email || token.id.substring(0, 8)}:`, e);
            }
        });

        await Promise.all(refreshPromises);

        // Re-render quota summary for enabled tokens
        enabledTokens.forEach(token => {
            loadTokenQuotaSummary(token.id);
        });

        showToast(`Refreshed quotas for ${enabledTokens.length} Tokens`, 'success');
    } catch (error) {
        showToast('Failed to refresh quotas: ' + error.message, 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = '📊 Refresh quotas';
        }
    }
}

function renderQuotaModal(quotaContent, quotaData) {
    const models = quotaData.models;
    const requestCounts = quotaData.requestCounts || {};

    const updateTimeEl = document.getElementById('quotaUpdateTime');
    if (updateTimeEl && quotaData.lastUpdated) {
        const lastUpdated = new Date(quotaData.lastUpdated).toLocaleString('en-US', {
            month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
        });
        updateTimeEl.textContent = `Updated ${lastUpdated}`;
    }

    if (Object.keys(models).length === 0) {
        quotaContent.innerHTML = '<div class="quota-empty">No quota data available</div>';
        return;
    }

    const grouped = groupModels(models);

    let html = '';

    const renderGroup = (items, group, groupKey) => {
        const summary = summarizeGroup(items, requestCounts[groupKey] || 0, groupKey);
        const safeLabel = escapeHtml(group.label);
        const safeResetTime = escapeHtml(summary.resetTime);
        const estimatedText = summary.estimatedRequests > 0 ? ` · ~${summary.estimatedRequests} requests` : '';
        const iconHtml = getGroupIconHtml(group);
        let groupHtml = `
            <div class="quota-group-title">
                <span class="quota-group-left">
                    <span class="quota-group-icon">${iconHtml}</span>
                    <span class="quota-group-label">${safeLabel}</span>
                </span>
                <span class="quota-group-meta">${escapeHtml(summary.percentageText)} · Reset: ${safeResetTime}${estimatedText}</span>
            </div>
        `;

        if (items.length === 0) {
            groupHtml += '<div class="quota-empty-small">None</div>';
            return groupHtml;
        }

        groupHtml += '<div class="quota-grid">';
        items.forEach(({ modelId, quota }) => {
            const percentage = toPercentage(quota?.remaining);
            const percentageText = formatPercentage(quota?.remaining);
            const barColor = getBarColor(percentage);
            const shortName = escapeHtml(modelId.replace('models/', '').replace('publishers/google/', ''));
            const safeModelId = escapeHtml(modelId);
            const safeResetTime = escapeHtml(quota.resetTime);
            groupHtml += `
                <div class="quota-item">
                    <div class="quota-model-name" title="${safeModelId}">
                        <span class="quota-model-icon">${iconHtml}</span>
                        <span class="quota-model-text">${shortName}</span>
                    </div>
                    <div class="quota-bar-container">
                        <div class="quota-bar" style="width: ${percentage}%; background: ${barColor};"></div>
                    </div>
                    <div class="quota-info-row">
                        <span class="quota-reset">Reset: ${safeResetTime}</span>
                        <span class="quota-percentage">${percentageText}</span>
                    </div>
                </div>
            `;
        });
        groupHtml += '</div>';
        return groupHtml;
    };

    const groupByKey = Object.fromEntries(QUOTA_GROUPS.map(g => [g.key, g]));
    html += renderGroup(grouped.claude, groupByKey.claude, 'claude');
    html += renderGroup(grouped.gemini, groupByKey.gemini, 'gemini');
    html += renderGroup(grouped.banana, groupByKey.banana, 'banana');
    if (grouped.other && grouped.other.length > 0) {
        html += renderGroup(grouped.other, groupByKey.other, 'other');
    }

    quotaContent.innerHTML = html;
}
