// Entry point: initialization and event bindings

// Initialize on page load
initFontSize();
initSensitiveInfo();
initFilterState(); // Restore filter state

// Check login state and initialize
(async function initApp() {
    try {
        // Check if logged in (via cookie)
        const loggedIn = await checkLoginStatus();
        
        // Verification done; switch to auth-ready state
        document.documentElement.classList.remove('auth-checking');
        document.documentElement.classList.add('auth-ready');
        
        if (loggedIn) {
            showMainContent();
            // Restore tab state; switchTab will load relevant data by tab
            const savedTab = localStorage.getItem('currentTab');
            if (savedTab === 'settings') {
                switchTab('settings', false);
            } else if (savedTab === 'logs') {
                switchTab('logs', false);
            } else if (savedTab === 'geminicli') {
                switchTab('geminicli', false);
            } else {
                // Default to tokens page
                switchTab('tokens', false);
            }
        }
    } catch (e) {
        // Even on failure, switch state and show login form
        document.documentElement.classList.remove('auth-checking');
        document.documentElement.classList.add('auth-ready');
    }
})();

// Login form submission
document.getElementById('login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');
    if (btn.disabled) return;
    
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    
    btn.disabled = true;
    btn.classList.add('loading');
    const originalText = btn.textContent;
    btn.textContent = 'Signing in...';
    
    try {
        const response = await fetch('/admin/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ username, password })
        });
        
        const data = await response.json();
        if (data.success) {
            // No longer store token in localStorage; use HttpOnly cookie
            showToast('Signed in successfully', 'success');
            showMainContent();
            loadTokens();
            loadConfig();
        } else {
            showToast(data.message || 'Incorrect username or password', 'error');
        }
    } catch (error) {
        showToast('Login failed: ' + error.message, 'error');
    } finally {
        btn.disabled = false;
        btn.classList.remove('loading');
        btn.textContent = originalText;
    }
});

// Config form submission
document.getElementById('configForm').addEventListener('submit', saveConfig);
