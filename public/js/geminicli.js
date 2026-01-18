// Gemini CLI Token management module

let cachedGeminiCliTokens = [];
let currentGeminiCliFilter = localStorage.getItem('geminicliTokenFilter') || 'all';

// Gemini CLI OAuth configuration
const GEMINICLI_CLIENT_ID = '681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com';
const GEMINICLI_SCOPES = [
    'openid',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/cloud-platform'
].join(' ');

let geminicliOauthPort = null;

// Get Gemini CLI OAuth URL
function getGeminiCliOAuthUrl() {
    if (!geminicliOauthPort) geminicliOauthPort = Math.floor(Math.random() * 10000) + 50000;
    const redirectUri = `http://localhost:${geminicliOauthPort}/oauth-callback`;
    return `https://accounts.google.com/o/oauth2/v2/auth?` +
        `access_type=offline&client_id=${GEMINICLI_CLIENT_ID}&prompt=consent&` +
        `redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&` +
        `scope=${encodeURIComponent(GEMINICLI_SCOPES)}&state=geminicli_${Date.now()}`;
}

// Open Gemini CLI OAuth window
function openGeminiCliOAuthWindow() {
    window.open(getGeminiCliOAuthUrl(), '_blank');
}

// Copy Gemini CLI OAuth URL
function copyGeminiCliOAuthUrl() {
    const url = getGeminiCliOAuthUrl();
    navigator.clipboard.writeText(url).then(() => {
        showToast('Gemini CLI authorization link copied', 'success');
    }).catch(() => {
        showToast('Copy failed', 'error');
    });
}

// Show Gemini CLI OAuth modal
function showGeminiCliOAuthModal() {
    showToast('Click to complete authorization in a new window.', 'info');
    const modal = document.createElement('div');
    modal.className = 'modal form-modal';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-title">🔐 Gemini CLI OAuth Authorization</div>
            <div class="oauth-steps">
                <p><strong>📝 Authorization steps:</strong></p>
                <p>1️⃣ Click the button below to open the Google authorization page</p>
                <p>2️⃣ After authorizing, copy the full URL from the browser address bar</p>
                <p>3️⃣ Paste the URL below and submit</p>
            </div>
            <div style="display: flex; gap: 8px; margin-bottom: 12px;">
                <button type="button" onclick="openGeminiCliOAuthWindow()" class="btn btn-success" style="flex: 1;">🔐 Open authorization page</button>
                <button type="button" onclick="copyGeminiCliOAuthUrl()" class="btn btn-info" style="flex: 1;">📋 Copy authorization link</button>
            </div>
            <input type="text" id="geminicliCallbackUrl" placeholder="Paste the full callback URL (http://localhost:xxxxx/oauth-callback?code=...)">
            <div class="modal-actions">
                <button class="btn btn-secondary" onclick="this.closest('.modal').remove()">Cancel</button>
                <button class="btn btn-success" onclick="processGeminiCliOAuthCallback()">✅ Submit</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
}

// Handle Gemini CLI OAuth callback
async function processGeminiCliOAuthCallback() {
    const modal = document.querySelector('.form-modal');
    const callbackUrl = document.getElementById('geminicliCallbackUrl').value.trim();
    if (!callbackUrl) {
        showToast('Please enter the callback URL', 'warning');
        return;
    }

    showLoading('Processing authorization...');

    try {
        const url = new URL(callbackUrl);
        const code = url.searchParams.get('code');
        const port = new URL(url.origin).port || (url.protocol === 'https:' ? 443 : 80);

        if (!code) {
            hideLoading();
            showToast('No authorization code found in URL', 'error');
            return;
        }

        // Exchange token in geminicli mode
        const response = await authFetch('/admin/oauth/exchange', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ code, port, mode: 'geminicli' })
        });

        const result = await response.json();
        if (result.success) {
            const account = result.data;
            // Add to Gemini CLI token list
            const addResponse = await authFetch('/admin/geminicli/tokens', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(account)
            });

            const addResult = await addResponse.json();
            hideLoading();
            if (addResult.success) {
                modal.remove();
                showToast('Gemini CLI Token added', 'success');
                loadGeminiCliTokens();
            } else {
                showToast('Add failed: ' + addResult.message, 'error');
            }
        } else {
            hideLoading();
            showToast('Exchange failed: ' + result.message, 'error');
        }
    } catch (error) {
        hideLoading();
        showToast('Processing failed: ' + error.message, 'error');
    }
}

// Load Gemini CLI Token list
async function loadGeminiCliTokens() {
    try {
        const response = await authFetch('/admin/geminicli/tokens');
        const data = await response.json();
        if (data.success) {
            renderGeminiCliTokens(data.data);
        } else {
            showToast('Load failed: ' + (data.message || 'Unknown error'), 'error');
        }
    } catch (error) {
        if (error.message !== 'Unauthorized') {
            showToast('Failed to load Gemini CLI Tokens: ' + error.message, 'error');
        }
    }
}

// Render Gemini CLI Token list
function renderGeminiCliTokens(tokens) {
    cachedGeminiCliTokens = tokens;

    document.getElementById('geminicliTotalTokens').textContent = tokens.length;
    document.getElementById('geminicliEnabledTokens').textContent = tokens.filter(t => t.enable).length;
    document.getElementById('geminicliDisabledTokens').textContent = tokens.filter(t => !t.enable).length;

    // Filter by current criteria
    let filteredTokens = tokens;
    if (currentGeminiCliFilter === 'enabled') {
        filteredTokens = tokens.filter(t => t.enable);
    } else if (currentGeminiCliFilter === 'disabled') {
        filteredTokens = tokens.filter(t => !t.enable);
    }

    const tokenList = document.getElementById('geminicliTokenList');
    if (filteredTokens.length === 0) {
        const emptyText = currentGeminiCliFilter === 'all' ? 'No Tokens yet' :
            currentGeminiCliFilter === 'enabled' ? 'No enabled Tokens' : 'No disabled Tokens';
        const emptyHint = currentGeminiCliFilter === 'all' ? 'Click OAuth above to add a Token' : 'Click “Total” to view all';
        tokenList.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📦</div>
                <div class="empty-state-text">${emptyText}</div>
                <div class="empty-state-hint">${emptyHint}</div>
            </div>
        `;
        return;
    }

    tokenList.innerHTML = filteredTokens.map((token, index) => {
        const tokenId = token.id;
        const cardId = tokenId.substring(0, 8);
        const originalIndex = cachedGeminiCliTokens.findIndex(t => t.id === token.id);
        const tokenNumber = originalIndex + 1;

        const safeTokenId = escapeJs(tokenId);
        const safeEmail = escapeHtml(token.email || '');
        const safeEmailJs = escapeJs(token.email || '');
        const safeProjectId = escapeHtml(token.projectId || '');
        const hasProjectId = !!token.projectId;

        return `
        <div class="token-card ${!token.enable ? 'disabled' : ''}" id="geminicli-card-${escapeHtml(cardId)}">
            <div class="token-header">
                <div class="token-header-left">
                    <span class="status ${token.enable ? 'enabled' : 'disabled'}">
                        ${token.enable ? '✅ Enabled' : '❌ Disabled'}
                    </span>
                    <button class="btn-icon token-refresh-btn" onclick="refreshGeminiCliToken('${safeTokenId}')" title="Refresh Token">🔄</button>
                </div>
                <div class="token-header-right">
                    <span class="token-id">#${tokenNumber}</span>
                </div>
            </div>
            <div class="token-info">
                <div class="info-row editable sensitive-row" onclick="editGeminiCliField(event, '${safeTokenId}', 'email', '${safeEmailJs}')" title="Click to edit">
                    <span class="info-label">📧</span>
                    <span class="info-value sensitive-info">${safeEmail || 'Click to set'}</span>
                    <span class="info-edit-icon">✏️</span>
                </div>
                <div class="info-row ${hasProjectId ? '' : 'warning'}" title="${hasProjectId ? 'Project ID' : 'Missing Project ID, click to fetch'}">
                    <span class="info-label">📁</span>
                    <span class="info-value ${hasProjectId ? '' : 'text-warning'}">${safeProjectId || 'Not fetched'}</span>
                    ${!hasProjectId ? `<button class="btn btn-info btn-xs" onclick="fetchGeminiCliProjectId('${safeTokenId}')" style="margin-left: auto;">Fetch</button>` : ''}
                </div>
            </div>
            <div class="token-id-row" title="Token ID: ${escapeHtml(tokenId)}">
                <span class="token-id-label">🔑</span>
                <span class="token-id-value">${escapeHtml(tokenId.length > 24 ? tokenId.substring(0, 12) + '...' + tokenId.substring(tokenId.length - 8) : tokenId)}</span>
            </div>
            <div class="token-actions">
                <button class="btn ${token.enable ? 'btn-warning' : 'btn-success'} btn-xs" onclick="toggleGeminiCliToken('${safeTokenId}', ${!token.enable})" title="${token.enable ? 'Disable' : 'Enable'}">
                    ${token.enable ? '⏸️ Disable' : '▶️ Enable'}
                </button>
                <button class="btn btn-danger btn-xs" onclick="deleteGeminiCliToken('${safeTokenId}')" title="Delete">🗑️ Delete</button>
            </div>
        </div>
    `}).join('');

    updateSensitiveInfoDisplay();
}

// Filter Gemini CLI Tokens
function filterGeminiCliTokens(filter) {
    currentGeminiCliFilter = filter;
    localStorage.setItem('geminicliTokenFilter', filter);
    updateGeminiCliFilterButtonState(filter);
    renderGeminiCliTokens(cachedGeminiCliTokens);
}

// Update filter button state
function updateGeminiCliFilterButtonState(filter) {
    document.querySelectorAll('#geminicliPage .stat-item').forEach(item => {
        item.classList.remove('active');
    });
    const filterMap = { 'all': 'geminicliTotalTokens', 'enabled': 'geminicliEnabledTokens', 'disabled': 'geminicliDisabledTokens' };
    const activeElement = document.getElementById(filterMap[filter]);
    if (activeElement) {
        activeElement.closest('.stat-item').classList.add('active');
    }
}

// Refresh Gemini CLI Token
async function refreshGeminiCliToken(tokenId) {
    try {
        const response = await authFetch(`/admin/geminicli/tokens/${encodeURIComponent(tokenId)}/refresh`, {
            method: 'POST'
        });
        const data = await response.json();
        if (data.success) {
            showToast('Token refreshed', 'success');
            loadGeminiCliTokens();
        } else {
            showToast(`Refresh failed: ${data.message || 'Unknown error'}`, 'error');
        }
    } catch (error) {
        if (error.message !== 'Unauthorized') {
            showToast(`Refresh failed: ${error.message}`, 'error');
        }
    }
}

// Fetch Project ID for Gemini CLI Token
async function fetchGeminiCliProjectId(tokenId) {
    showLoading('Fetching Project ID...');
    try {
        const response = await authFetch(`/admin/geminicli/tokens/${encodeURIComponent(tokenId)}/fetch-project-id`, {
            method: 'POST'
        });
        const data = await response.json();
        hideLoading();
        if (data.success) {
            showToast(`Project ID fetched: ${data.projectId}`, 'success');
            loadGeminiCliTokens();
        } else {
            showToast(`Fetch failed: ${data.message || 'Unknown error'}`, 'error');
        }
    } catch (error) {
        hideLoading();
        if (error.message !== 'Unauthorized') {
            showToast(`Fetch failed: ${error.message}`, 'error');
        }
    }
}

// Edit Gemini CLI Token fields
function editGeminiCliField(event, tokenId, field, currentValue) {
    event.stopPropagation();
    const row = event.currentTarget;
    const valueSpan = row.querySelector('.info-value');

    if (row.querySelector('input')) return;

    const fieldLabels = { email: 'Email' };

    const input = document.createElement('input');
    input.type = 'email';
    input.value = currentValue;
    input.className = 'inline-edit-input';
    input.placeholder = `Enter ${fieldLabels[field]}`;

    valueSpan.style.display = 'none';
    row.insertBefore(input, valueSpan.nextSibling);
    input.focus();
    input.select();

    const save = async () => {
        const newValue = input.value.trim();
        input.disabled = true;

        try {
            const response = await authFetch(`/admin/geminicli/tokens/${encodeURIComponent(tokenId)}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ [field]: newValue })
            });

            const data = await response.json();
            if (data.success) {
                showToast('Saved', 'success');
                loadGeminiCliTokens();
            } else {
                showToast(data.message || 'Save failed', 'error');
                cancel();
            }
        } catch (error) {
            showToast('Save failed', 'error');
            cancel();
        }
    };

    const cancel = () => {
        input.remove();
        valueSpan.style.display = '';
    };

    input.addEventListener('blur', () => {
        setTimeout(() => {
            if (document.activeElement !== input) {
                if (input.value.trim() !== currentValue) {
                    save();
                } else {
                    cancel();
                }
            }
        }, 100);
    });

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            save();
        } else if (e.key === 'Escape') {
            cancel();
        }
    });
}

// Toggle Gemini CLI Token state
async function toggleGeminiCliToken(tokenId, enable) {
    const action = enable ? 'Enable' : 'Disable';
    const confirmed = await showConfirm(`Are you sure you want to ${action.toLowerCase()} this Token?`, `${action} confirmation`);
    if (!confirmed) return;

    showLoading(`${action}ing...`);
    try {
        const response = await authFetch(`/admin/geminicli/tokens/${encodeURIComponent(tokenId)}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ enable })
        });

        const data = await response.json();
        hideLoading();
        if (data.success) {
            showToast(`${action}d`, 'success');
            loadGeminiCliTokens();
        } else {
            showToast(data.message || 'Operation failed', 'error');
        }
    } catch (error) {
        hideLoading();
        showToast('Operation failed: ' + error.message, 'error');
    }
}

// Delete Gemini CLI Token
async function deleteGeminiCliToken(tokenId) {
    const confirmed = await showConfirm('This cannot be undone. Delete anyway?', '⚠️ Delete confirmation');
    if (!confirmed) return;

    showLoading('Deleting...');
    try {
        const response = await authFetch(`/admin/geminicli/tokens/${encodeURIComponent(tokenId)}`, {
            method: 'DELETE'
        });

        const data = await response.json();
        hideLoading();
        if (data.success) {
            showToast('Deleted', 'success');
            loadGeminiCliTokens();
        } else {
            showToast(data.message || 'Delete failed', 'error');
        }
    } catch (error) {
        hideLoading();
        showToast('Delete failed: ' + error.message, 'error');
    }
}

// Export Gemini CLI Tokens
async function exportGeminiCliTokens() {
    const password = await showPasswordPrompt('Enter admin password to export Gemini CLI Tokens');
    if (!password) return;

    showLoading('Exporting...');
    try {
        const response = await authFetch('/admin/geminicli/tokens/export', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password })
        });

        const data = await response.json();
        hideLoading();

        if (data.success) {
            const blob = new Blob([JSON.stringify(data.data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `geminicli-tokens-export-${new Date().toISOString().slice(0, 10)}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            showToast('Export successful', 'success');
        } else {
            if (response.status === 403) {
                showToast('Incorrect password, please try again', 'error');
            } else {
                showToast(data.message || 'Export failed', 'error');
            }
        }
    } catch (error) {
        hideLoading();
        showToast('Export failed: ' + error.message, 'error');
    }
}

// Reload Gemini CLI Tokens
async function reloadGeminiCliTokens() {
    showLoading('Reloading...');
    try {
        const response = await authFetch('/admin/geminicli/tokens/reload', {
            method: 'POST'
        });
        const data = await response.json();
        hideLoading();
        if (data.success) {
            showToast('Reloaded successfully', 'success');
            loadGeminiCliTokens();
        } else {
            showToast(data.message || 'Reload failed', 'error');
        }
    } catch (error) {
        hideLoading();
        showToast('Reload failed: ' + error.message, 'error');
    }
}

// Initialize Gemini CLI page
function initGeminiCliPage() {
    updateGeminiCliFilterButtonState(currentGeminiCliFilter);
    loadGeminiCliTokens();
}

// ==================== Import Gemini CLI Tokens ====================

let geminicliImportTab = 'file';
let geminicliImportFile = null;

// Store import modal handlers for cleanup
let geminicliImportModalHandlers = null;

async function importGeminiCliTokens() {
    showGeminiCliImportModal();
}

function closeGeminiCliImportModal() {
    try {
        const h = geminicliImportModalHandlers;
        if (typeof h?.cleanup === 'function') {
            h.cleanup();
        }
    } catch {
        // ignore
    }

    geminicliImportModalHandlers = null;

    const modal = document.getElementById('geminicliImportModal');
    if (modal) modal.remove();

    // Reset state to avoid carrying over next time
    geminicliImportTab = 'file';
    geminicliImportFile = null;
}

function switchGeminiCliImportTab(tab) {
    geminicliImportTab = tab;

    const tabs = document.querySelectorAll('#geminicliImportModal .import-tab');
    tabs.forEach(t => {
        const isActive = t.getAttribute('data-tab') === tab;
        t.classList.toggle('active', isActive);
    });

    const filePanel = document.getElementById('geminicliImportTabFile');
    const jsonPanel = document.getElementById('geminicliImportTabJson');
    if (filePanel) filePanel.classList.toggle('hidden', tab !== 'file');
    if (jsonPanel) jsonPanel.classList.toggle('hidden', tab !== 'json');
}

function clearGeminiCliImportFile() {
    geminicliImportFile = null;
    const info = document.getElementById('geminicliImportFileInfo');
    const input = document.getElementById('geminicliImportFileInput');
    if (input) input.value = '';
    if (info) info.classList.add('hidden');
}

function showGeminiCliImportModal() {
    // If it already exists, close with cleanup
    const existing = document.getElementById('geminicliImportModal');
    if (existing) closeGeminiCliImportModal();

    const modal = document.createElement('div');
    modal.className = 'modal form-modal';
    modal.id = 'geminicliImportModal';
    modal.innerHTML = `
        <div class="modal-content modal-lg">
            <div class="modal-title">📥 Import Gemini CLI Tokens</div>

            <div class="import-tabs">
                <button class="import-tab active" data-tab="file" onclick="switchGeminiCliImportTab('file')">📁 File upload</button>
                <button class="import-tab" data-tab="json" onclick="switchGeminiCliImportTab('json')">📝 JSON import</button>
            </div>

            <div class="import-tab-content" id="geminicliImportTabFile">
                <div class="import-dropzone" id="geminicliImportDropzone">
                    <div class="dropzone-icon">📁</div>
                    <div class="dropzone-text">Drag and drop files here</div>
                    <div class="dropzone-hint">or click to choose a file</div>
                    <input type="file" id="geminicliImportFileInput" accept=".json" style="display: none;">
                </div>
                <div class="import-file-info hidden" id="geminicliImportFileInfo">
                    <div class="file-info-icon">📄</div>
                    <div class="file-info-details">
                        <div class="file-info-name" id="geminicliImportFileName">-</div>
                    </div>
                    <button class="btn btn-xs btn-secondary" onclick="clearGeminiCliImportFile()">✕</button>
                </div>
            </div>

            <div class="import-tab-content hidden" id="geminicliImportTabJson">
                <div class="form-group">
                    <label>📝 Paste JSON content</label>
                    <textarea id="geminicliImportJsonInput" rows="8" placeholder='{"tokens": [...], "exportTime": "..."}'></textarea>
                </div>
            </div>

            <div class="form-group">
                <label>Import mode</label>
                <select id="geminicliImportMode">
                    <option value="merge">Merge (keep existing, add/update)</option>
                    <option value="replace">Replace (clear existing, import new)</option>
                </select>
                <p style="font-size: 0.75rem; color: var(--text-light); margin-top: 0.25rem;">💡 De-dup by refresh_token: merge updates matching refresh_token records.</p>
            </div>

            <div class="form-group">
                <label>Admin password</label>
                <input type="password" id="geminicliImportPassword" placeholder="Required" autocomplete="current-password">
            </div>

            <div class="modal-actions">
                <button class="btn btn-secondary" onclick="closeGeminiCliImportModal()">Cancel</button>
                <button class="btn btn-success" onclick="submitGeminiCliImport()">✅ Import</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    // wire dropzone
    const dropzone = document.getElementById('geminicliImportDropzone');
    const fileInput = document.getElementById('geminicliImportFileInput');
    const fileInfo = document.getElementById('geminicliImportFileInfo');
    const fileName = document.getElementById('geminicliImportFileName');

    const setFile = (file) => {
        geminicliImportFile = file;
        if (fileName) fileName.textContent = file?.name || '-';
        if (fileInfo) fileInfo.classList.toggle('hidden', !file);
    };

    const cleanupDropzone = (typeof wireJsonFileDropzone === 'function')
        ? wireJsonFileDropzone({
            dropzone,
            fileInput,
            onFile: (file) => setFile(file),
            onError: (message) => showToast(message, 'warning')
        })
        : null;
    const cleanupBackdrop = (typeof wireModalBackdropClose === 'function')
        ? wireModalBackdropClose(modal, closeGeminiCliImportModal)
        : null;

    geminicliImportModalHandlers = {
        cleanup: () => {
            try { cleanupDropzone && cleanupDropzone(); } catch { /* ignore */ }
            try { cleanupBackdrop && cleanupBackdrop(); } catch { /* ignore */ }
        }
    };

    // reset state
    geminicliImportTab = 'file';
    geminicliImportFile = null;
    switchGeminiCliImportTab('file');
}

function normalizeGeminiCliImportData(parsed) {
    // Backend expects: { tokens: [...] }
    if (Array.isArray(parsed)) return { tokens: parsed };
    if (parsed && typeof parsed === 'object') {
        if (Array.isArray(parsed.tokens)) return { tokens: parsed.tokens };
        if (Array.isArray(parsed.accounts)) return { tokens: parsed.accounts };
        // Allow users to paste export data directly
        if (parsed.data && Array.isArray(parsed.data.tokens)) return { tokens: parsed.data.tokens };
        if (parsed.data && Array.isArray(parsed.data.accounts)) return { tokens: parsed.data.accounts };

        // Support gcli single-file credentials (one credential object)
        // Common fields: refresh_token / refreshToken / token / access_token / accessToken
        const hasRefresh = (parsed.refresh_token || parsed.refreshToken);
        const hasAccess = (parsed.access_token || parsed.accessToken || parsed.token);
        if (hasRefresh || hasAccess) return { tokens: [parsed] };
    }
    return null;
}

async function submitGeminiCliImport() {
    const password = document.getElementById('geminicliImportPassword')?.value?.trim();
    const mode = document.getElementById('geminicliImportMode')?.value || 'merge';

    if (!password) {
        showToast('Please enter the admin password', 'warning');
        return;
    }

    let rawText = '';
    if (geminicliImportTab === 'file') {
        if (!geminicliImportFile) {
            showToast('Please select a JSON file to import', 'warning');
            return;
        }
        rawText = await geminicliImportFile.text();
    } else {
        rawText = document.getElementById('geminicliImportJsonInput')?.value || '';
        if (!rawText.trim()) {
            showToast('Please paste JSON content', 'warning');
            return;
        }
    }

    let parsed;
    try {
        parsed = JSON.parse(rawText);
    } catch (e) {
        showToast('JSON parse failed: ' + (e?.message || e), 'error');
        return;
    }

    const data = normalizeGeminiCliImportData(parsed);
    if (!data) {
        showToast('Invalid import format: expected {\"tokens\": [...]} or a token array', 'error');
        return;
    }

    showLoading('Importing...');
    try {
        const response = await authFetch('/admin/geminicli/tokens/import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password, mode, data })
        });
        const result = await response.json();
        hideLoading();

        if (result.success) {
            closeGeminiCliImportModal();
            showToast(result.message || 'Import successful', 'success');
            loadGeminiCliTokens();
        } else {
            if (response.status === 403) {
                showToast('Incorrect password, please try again', 'error');
            } else {
                showToast(result.message || 'Import failed', 'error');
            }
        }
    } catch (error) {
        hideLoading();
        showToast('Import failed: ' + error.message, 'error');
    }
}
