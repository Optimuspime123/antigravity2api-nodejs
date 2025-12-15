let authToken = localStorage.getItem('authToken');
let oauthPort = null;
const CLIENT_ID = '1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com';
const SCOPES = [
    'https://www.googleapis.com/auth/cloud-platform',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/cclog',
    'https://www.googleapis.com/auth/experimentsandconfigs'
].join(' ');

// Wrapper around fetch to automatically handle 401 responses
const authFetch = async (url, options = {}) => {
    const response = await fetch(url, options);
    if (response.status === 401) {
        silentLogout();
        showToast('Session expired, please sign in again', 'warning');
        throw new Error('Unauthorized');
    }
    return response;
};

function showToast(message, type = 'info', title = '') {
    const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
    const titles = { success: 'Success', error: 'Error', warning: 'Warning', info: 'Notice' };
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
        <div class="toast-icon">${icons[type]}</div>
        <div class="toast-content">
            <div class="toast-title">${title || titles[type]}</div>
            <div class="toast-message">${message}</div>
        </div>
    `;
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function showConfirm(message, title = 'Confirm action') {
    return new Promise((resolve) => {
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-title">${title}</div>
                <div class="modal-message">${message}</div>
                <div class="modal-actions">
                    <button class="btn btn-secondary" onclick="this.closest('.modal').remove(); window.modalResolve(false)">Cancel</button>
                    <button class="btn btn-danger" onclick="this.closest('.modal').remove(); window.modalResolve(true)">Confirm</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
        modal.onclick = (e) => { if (e.target === modal) { modal.remove(); resolve(false); } };
        window.modalResolve = resolve;
    });
}

function showLoading(text = 'Processing...') {
    const overlay = document.createElement('div');
    overlay.className = 'loading-overlay';
    overlay.id = 'loadingOverlay';
    overlay.innerHTML = `<div class="spinner"></div><div class="loading-text">${text}</div>`;
    document.body.appendChild(overlay);
}

function hideLoading() {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) overlay.remove();
}

if (authToken) {
    showMainContent();
    loadTokens();
    loadConfig();
}

document.getElementById('login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    if (btn.disabled) return;
    
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    
    btn.disabled = true;
    btn.classList.add('loading');
    const originalText = btn.textContent;
    btn.textContent = 'Signing in';
    
    try {
        const response = await fetch('/admin/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        
        const data = await response.json();
        if (data.success) {
            authToken = data.token;
            localStorage.setItem('authToken', authToken);
            showToast('Signed in successfully, welcome back!', 'success');
            showMainContent();
            loadTokens();
        } else {
            showToast(data.message || 'Incorrect username or password', 'error');
        }
    } catch (error) {
        showToast('Sign-in failed: ' + error.message, 'error');
    } finally {
        btn.disabled = false;
        btn.classList.remove('loading');
        btn.textContent = originalText;
    }
});

function showOAuthModal() {
    showToast('After clicking, complete authorization in the new window', 'info', 'Notice');
    const modal = document.createElement('div');
    modal.className = 'modal form-modal';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-title">🔐 OAuth Sign-In</div>
            <div class="oauth-steps">
                <p><strong>📝 Authorization steps:</strong></p>
                <p>1️⃣ Click the button below to open the Google authorization page</p>
                <p>2️⃣ After authorization, copy the full URL from your browser address bar</p>
                <p>3️⃣ Paste the URL into the field below and submit</p>
            </div>
            <div style="display: flex; gap: 8px; margin-bottom: 16px;">
                <button type="button" onclick="openOAuthWindow()" class="btn btn-success" style="flex: 1;">🔐 Open authorization page</button>
                <button type="button" onclick="copyOAuthUrl()" class="btn btn-info" style="width: 44px; padding: 0; font-size: 18px;" title="Copy authorization link">📋</button>
            </div>
            <input type="text" id="modalCallbackUrl" placeholder="Paste the full callback URL (http://localhost:xxxxx/oauth-callback?code=...)">
            <div class="modal-actions">
                <button class="btn btn-secondary" onclick="this.closest('.modal').remove()">Cancel</button>
                <button class="btn btn-success" onclick="processOAuthCallbackModal()">✅ Submit</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
}

function showManualModal() {
    const modal = document.createElement('div');
    modal.className = 'modal form-modal';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-title">✏️ Enter token manually</div>
            <div class="form-row">
                <input type="text" id="modalAccessToken" placeholder="Access Token (required)">
                <input type="text" id="modalRefreshToken" placeholder="Refresh Token (required)">
                <input type="number" id="modalExpiresIn" placeholder="Expires in (seconds)" value="3599">
            </div>
            <p style="font-size: 0.85rem; color: var(--text-light); margin-bottom: 16px;">💡 Tip: default expiration is 3599 seconds (about 1 hour)</p>
            <div class="modal-actions">
                <button class="btn btn-secondary" onclick="this.closest('.modal').remove()">Cancel</button>
                <button class="btn btn-success" onclick="addTokenFromModal()">✅ Add</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
}

function getOAuthUrl() {
    if (!oauthPort) oauthPort = Math.floor(Math.random() * 10000) + 50000;
    const redirectUri = `http://localhost:${oauthPort}/oauth-callback`;
    return `https://accounts.google.com/o/oauth2/v2/auth?` +
        `access_type=offline&client_id=${CLIENT_ID}&prompt=consent&` +
        `redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&` +
        `scope=${encodeURIComponent(SCOPES)}&state=${Date.now()}`;
}

function openOAuthWindow() {
    window.open(getOAuthUrl(), '_blank');
}

function copyOAuthUrl() {
    const url = getOAuthUrl();
    navigator.clipboard.writeText(url).then(() => {
        showToast('Authorization link copied to clipboard', 'success');
    }).catch(() => {
        showToast('Copy failed, please copy manually', 'error');
    });
}

async function processOAuthCallbackModal() {
    const modal = document.querySelector('.form-modal');
    const callbackUrl = document.getElementById('modalCallbackUrl').value.trim();
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
            showToast('Authorization code not found in URL—please check the full URL', 'error');
            return;
        }
        
        const response = await authFetch('/admin/oauth/exchange', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ code, port })
        });
        
        const result = await response.json();
        if (result.success) {
            const account = result.data;
            const addResponse = await authFetch('/admin/tokens', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${authToken}`
                },
                body: JSON.stringify(account)
            });
            
            const addResult = await addResponse.json();
            hideLoading();
            if (addResult.success) {
                modal.remove();
                showToast('Token added successfully!', 'success');
                loadTokens();
            } else {
                showToast('Failed to add token: ' + addResult.message, 'error');
            }
        } else {
            hideLoading();
            showToast('Token exchange failed: ' + result.message, 'error');
        }
    } catch (error) {
        hideLoading();
        showToast('Processing failed: ' + error.message, 'error');
    }
}

async function addTokenFromModal() {
    const modal = document.querySelector('.form-modal');
    const accessToken = document.getElementById('modalAccessToken').value.trim();
    const refreshToken = document.getElementById('modalRefreshToken').value.trim();
    const expiresIn = parseInt(document.getElementById('modalExpiresIn').value);
    
    if (!accessToken || !refreshToken) {
        showToast('Please fill out all token fields', 'warning');
        return;
    }

    showLoading('Adding token...');
    try {
        const response = await authFetch('/admin/tokens', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ access_token: accessToken, refresh_token: refreshToken, expires_in: expiresIn })
        });
        
        const data = await response.json();
        hideLoading();
        if (data.success) {
            modal.remove();
            showToast('Token added successfully!', 'success');
            loadTokens();
        } else {
            showToast(data.message || 'Add failed', 'error');
        }
    } catch (error) {
        hideLoading();
        showToast('Add failed: ' + error.message, 'error');
    }
}

function showMainContent() {
    document.getElementById('loginForm').classList.add('hidden');
    document.getElementById('mainContent').classList.remove('hidden');
}

function switchTab(tab) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    event.target.classList.add('active');
    
    if (tab === 'tokens') {
        document.getElementById('tokensPage').classList.remove('hidden');
        document.getElementById('settingsPage').classList.add('hidden');
    } else if (tab === 'settings') {
        document.getElementById('tokensPage').classList.add('hidden');
        document.getElementById('settingsPage').classList.remove('hidden');
        loadConfig();
    }
}

function silentLogout() {
    localStorage.removeItem('authToken');
    authToken = null;
    document.getElementById('loginForm').classList.remove('hidden');
    document.getElementById('mainContent').classList.add('hidden');
}

async function logout() {
    const confirmed = await showConfirm('Are you sure you want to sign out?', 'Sign-out confirmation');
    if (!confirmed) return;

    silentLogout();
    showToast('Signed out', 'info');
}

async function loadTokens() {
    try {
        const response = await authFetch('/admin/tokens', {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        const data = await response.json();
        if (data.success) {
            renderTokens(data.data);
        } else {
            showToast('Load failed: ' + (data.message || 'Unknown error'), 'error');
        }
    } catch (error) {
        showToast('Failed to load tokens: ' + error.message, 'error');
    }
}

function renderTokens(tokens) {
    document.getElementById('totalTokens').textContent = tokens.length;
    document.getElementById('enabledTokens').textContent = tokens.filter(t => t.enable).length;
    document.getElementById('disabledTokens').textContent = tokens.filter(t => !t.enable).length;
    
    const tokenList = document.getElementById('tokenList');
    if (tokens.length === 0) {
        tokenList.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📦</div>
            <div class="empty-state-text">No tokens yet</div>
            <div class="empty-state-hint">Click the buttons above to add your first token</div>
            </div>
        `;
        return;
    }
    
    tokenList.innerHTML = tokens.map(token => `
        <div class="token-card">
            <div class="token-header">
                <span class="status ${token.enable ? 'enabled' : 'disabled'}">
                    ${token.enable ? '✅ Enabled' : '❌ Disabled'}
                </span>
                <span class="token-id">#${token.refresh_token.substring(0, 8)}</span>
            </div>
            <div class="token-info">
                <div class="info-row">
                    <span class="info-label">🎫 Access</span>
                    <span class="info-value">${token.access_token_suffix}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">📦 Project</span>
                    <span class="info-value">${token.projectId || 'N/A'}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">📧 Email</span>
                    <span class="info-value">${token.email || 'N/A'}</span>
                </div>
                <div class="info-row">
                    <span class="info-label">⏰ Expires</span>
                    <span class="info-value">${new Date(token.timestamp + token.expires_in * 1000).toLocaleString('en-US', {month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'})}</span>
                </div>
            </div>
            <div class="token-actions">
                <button class="btn btn-info" onclick="showQuotaModal('${token.refresh_token}')">📊 View quota</button>
                <button class="btn ${token.enable ? 'btn-warning' : 'btn-success'}" onclick="toggleToken('${token.refresh_token}', ${!token.enable})">
                    ${token.enable ? '⏸️ Disable' : '▶️ Enable'}
                </button>
                <button class="btn btn-danger" onclick="deleteToken('${token.refresh_token}')">🗑️ Delete</button>
            </div>
        </div>
    `).join('');
}

async function toggleToken(refreshToken, enable) {
    const action = enable ? 'enable' : 'disable';
    const confirmed = await showConfirm(`Are you sure you want to ${action} this token?`, `${action} confirmation`);
    if (!confirmed) return;
    
    showLoading(`${action === 'enable' ? 'Enabling' : 'Disabling'} token...`);
    try {
        const response = await authFetch(`/admin/tokens/${encodeURIComponent(refreshToken)}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ enable })
        });
        
        const data = await response.json();
        hideLoading();
        if (data.success) {
            showToast(`Token ${enable ? 'enabled' : 'disabled'}`, 'success');
            loadTokens();
        } else {
            showToast(data.message || 'Operation failed', 'error');
        }
    } catch (error) {
        hideLoading();
        showToast('Operation failed: ' + error.message, 'error');
    }
}

async function deleteToken(refreshToken) {
    const confirmed = await showConfirm('This action cannot be undone. Delete this token?', '⚠️ Delete confirmation');
    if (!confirmed) return;

    showLoading('Deleting token...');
    try {
        const response = await authFetch(`/admin/tokens/${encodeURIComponent(refreshToken)}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        const data = await response.json();
        hideLoading();
        if (data.success) {
            showToast('Token deleted', 'success');
            loadTokens();
        } else {
            showToast(data.message || 'Delete failed', 'error');
        }
    } catch (error) {
        hideLoading();
        showToast('Delete failed: ' + error.message, 'error');
    }
}

async function showQuotaModal(refreshToken) {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 600px;">
            <div class="modal-title">📊 Model quota information</div>
            <div id="quotaContent" style="max-height: 60vh; overflow-y: auto;">
                <div class="quota-loading">Loading...</div>
            </div>
            <div class="modal-actions">
                <button class="btn btn-info" onclick="refreshQuotaData('${refreshToken}')">🔄 Refresh now</button>
                <button class="btn btn-secondary" onclick="this.closest('.modal').remove()">Close</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
    
    await loadQuotaData(refreshToken);
}

async function loadQuotaData(refreshToken, forceRefresh = false) {
    const quotaContent = document.getElementById('quotaContent');
    if (!quotaContent) return;
    
    const refreshBtn = document.querySelector('.modal-content .btn-info');
    if (refreshBtn) {
        refreshBtn.disabled = true;
        refreshBtn.textContent = '⏳ Loading...';
    }

    quotaContent.innerHTML = '<div class="quota-loading">Loading...</div>';
    
    try {
        const url = `/admin/tokens/${encodeURIComponent(refreshToken)}/quotas${forceRefresh ? '?refresh=true' : ''}`;
        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        
        const data = await response.json();
        
        if (data.success) {
            const quotaData = data.data;
            const models = quotaData.models;

            if (Object.keys(models).length === 0) {
                quotaContent.innerHTML = '<div class="quota-empty">No quota information</div>';
                return;
            }

            const lastUpdated = new Date(quotaData.lastUpdated).toLocaleString('en-US', {
                month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
            });

            // Group by model type
            const grouped = { claude: [], gemini: [], other: [] };
            Object.entries(models).forEach(([modelId, quota]) => {
                const item = { modelId, quota };
                if (modelId.toLowerCase().includes('claude')) grouped.claude.push(item);
                else if (modelId.toLowerCase().includes('gemini')) grouped.gemini.push(item);
                else grouped.other.push(item);
            });

            let html = `<div class="quota-header">Updated at ${lastUpdated}</div>`;

            // Render each group
            if (grouped.claude.length > 0) {
                html += '<div class="quota-group-title">🤖 Claude models</div>';
                grouped.claude.forEach(({ modelId, quota }) => {
                    const percentage = (quota.remaining * 100).toFixed(1);
                    const barColor = percentage > 50 ? '#10b981' : percentage > 20 ? '#f59e0b' : '#ef4444';
                    html += `
                        <div class="quota-item">
                            <div class="quota-model-name">${modelId}</div>
                            <div class="quota-bar-container">
                                <div class="quota-bar" style="width: ${percentage}%; background: ${barColor};"></div>
                                <span class="quota-percentage">${percentage}%</span>
                            </div>
                            <div class="quota-reset">🔄 Reset: ${quota.resetTime}</div>
                        </div>
                    `;
                });
            }

            if (grouped.gemini.length > 0) {
                html += '<div class="quota-group-title">💎 Gemini models</div>';
                grouped.gemini.forEach(({ modelId, quota }) => {
                    const percentage = (quota.remaining * 100).toFixed(1);
                    const barColor = percentage > 50 ? '#10b981' : percentage > 20 ? '#f59e0b' : '#ef4444';
                    html += `
                        <div class="quota-item">
                            <div class="quota-model-name">${modelId}</div>
                            <div class="quota-bar-container">
                                <div class="quota-bar" style="width: ${percentage}%; background: ${barColor};"></div>
                                <span class="quota-percentage">${percentage}%</span>
                            </div>
                            <div class="quota-reset">🔄 Reset: ${quota.resetTime}</div>
                        </div>
                    `;
                });
            }

            if (grouped.other.length > 0) {
                html += '<div class="quota-group-title">🔧 Other models</div>';
                grouped.other.forEach(({ modelId, quota }) => {
                    const percentage = (quota.remaining * 100).toFixed(1);
                    const barColor = percentage > 50 ? '#10b981' : percentage > 20 ? '#f59e0b' : '#ef4444';
                    html += `
                        <div class="quota-item">
                            <div class="quota-model-name">${modelId}</div>
                            <div class="quota-bar-container">
                                <div class="quota-bar" style="width: ${percentage}%; background: ${barColor};"></div>
                                <span class="quota-percentage">${percentage}%</span>
                            </div>
                            <div class="quota-reset">🔄 Reset: ${quota.resetTime}</div>
                        </div>
                    `;
                });
            }

            quotaContent.innerHTML = html;
        } else {
            quotaContent.innerHTML = `<div class="quota-error">Load failed: ${data.message}</div>`;
        }
    } catch (error) {
        if (quotaContent) {
            quotaContent.innerHTML = `<div class="quota-error">Load failed: ${error.message}</div>`;
        }
    } finally {
        if (refreshBtn) {
            refreshBtn.disabled = false;
            refreshBtn.textContent = '🔄 Refresh now';
        }
    }
}

async function refreshQuotaData(refreshToken) {
    await loadQuotaData(refreshToken, true);
}

async function loadConfig() {
    try {
        const response = await authFetch('/admin/config', {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const data = await response.json();
        if (data.success) {
            const form = document.getElementById('configForm');
            const { env, json } = data.data;
            
            // Load .env configuration
            Object.entries(env).forEach(([key, value]) => {
                const input = form.elements[key];
                if (input) input.value = value || '';
            });
            
            // Load config.json configuration
            if (json.server) {
                if (form.elements['PORT']) form.elements['PORT'].value = json.server.port || '';
                if (form.elements['HOST']) form.elements['HOST'].value = json.server.host || '';
                if (form.elements['MAX_REQUEST_SIZE']) form.elements['MAX_REQUEST_SIZE'].value = json.server.maxRequestSize || '';
            }
            if (json.defaults) {
                if (form.elements['DEFAULT_TEMPERATURE']) form.elements['DEFAULT_TEMPERATURE'].value = json.defaults.temperature ?? '';
                if (form.elements['DEFAULT_TOP_P']) form.elements['DEFAULT_TOP_P'].value = json.defaults.topP ?? '';
                if (form.elements['DEFAULT_TOP_K']) form.elements['DEFAULT_TOP_K'].value = json.defaults.topK ?? '';
                if (form.elements['DEFAULT_MAX_TOKENS']) form.elements['DEFAULT_MAX_TOKENS'].value = json.defaults.maxTokens ?? '';
            }
            if (json.other) {
                if (form.elements['TIMEOUT']) form.elements['TIMEOUT'].value = json.other.timeout ?? '';
                if (form.elements['MAX_IMAGES']) form.elements['MAX_IMAGES'].value = json.other.maxImages ?? '';
                if (form.elements['USE_NATIVE_AXIOS']) form.elements['USE_NATIVE_AXIOS'].value = json.other.useNativeAxios ? 'true' : 'false';
                if (form.elements['SKIP_PROJECT_ID_FETCH']) form.elements['SKIP_PROJECT_ID_FETCH'].value = json.other.skipProjectIdFetch ? 'true' : 'false';
            }
        }
    } catch (error) {
        showToast('Failed to load configuration: ' + error.message, 'error');
}
}

document.getElementById('configForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const allConfig = Object.fromEntries(formData);
    
    // Separate sensitive and non-sensitive configuration
    const sensitiveKeys = ['API_KEY', 'ADMIN_USERNAME', 'ADMIN_PASSWORD', 'JWT_SECRET', 'PROXY', 'SYSTEM_INSTRUCTION', 'IMAGE_BASE_URL'];
    const envConfig = {};
    const jsonConfig = {
        server: {},
        api: {},
        defaults: {},
        other: {}
    };
    
    Object.entries(allConfig).forEach(([key, value]) => {
        if (sensitiveKeys.includes(key)) {
            envConfig[key] = value;
        } else {
            // Map to config.json structure
            if (key === 'PORT') jsonConfig.server.port = parseInt(value);
            else if (key === 'HOST') jsonConfig.server.host = value;
            else if (key === 'MAX_REQUEST_SIZE') jsonConfig.server.maxRequestSize = value;
            else if (key === 'API_URL') jsonConfig.api.url = value;
            else if (key === 'API_MODELS_URL') jsonConfig.api.modelsUrl = value;
            else if (key === 'API_NO_STREAM_URL') jsonConfig.api.noStreamUrl = value;
            else if (key === 'API_HOST') jsonConfig.api.host = value;
            else if (key === 'API_USER_AGENT') jsonConfig.api.userAgent = value;
            else if (key === 'DEFAULT_TEMPERATURE') jsonConfig.defaults.temperature = parseFloat(value);
            else if (key === 'DEFAULT_TOP_P') jsonConfig.defaults.topP = parseFloat(value);
            else if (key === 'DEFAULT_TOP_K') jsonConfig.defaults.topK = parseInt(value);
            else if (key === 'DEFAULT_MAX_TOKENS') jsonConfig.defaults.maxTokens = parseInt(value);
            else if (key === 'USE_NATIVE_AXIOS') jsonConfig.other.useNativeAxios = value !== 'false';
            else if (key === 'TIMEOUT') jsonConfig.other.timeout = parseInt(value);
            else if (key === 'MAX_IMAGES') jsonConfig.other.maxImages = parseInt(value);
            else if (key === 'SKIP_PROJECT_ID_FETCH') jsonConfig.other.skipProjectIdFetch = value === 'true';
            else envConfig[key] = value;
        }
    });
    
    showLoading('Saving configuration...');
    try {
        const response = await authFetch('/admin/config', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({ env: envConfig, json: jsonConfig })
        });
        
        const data = await response.json();
        hideLoading();
        if (data.success) {
            showToast(data.message, 'success');
        } else {
            showToast(data.message || 'Save failed', 'error');
        }
    } catch (error) {
        hideLoading();
        showToast('Save failed: ' + error.message, 'error');
    }
});
