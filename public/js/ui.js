// UI Components: Toast, Modal, Loading

// Toast manager - limit the number of toasts displayed simultaneously
const toastManager = {
    maxToasts: 5,
    activeToasts: [],

    add(toast) {
        this.activeToasts.push(toast);
        // If exceeds max count, remove the oldest
        while (this.activeToasts.length > this.maxToasts) {
            const oldest = this.activeToasts.shift();
            if (oldest && oldest.parentNode) {
                oldest.remove();
            }
        }
    },

    remove(toast) {
        const index = this.activeToasts.indexOf(toast);
        if (index > -1) {
            this.activeToasts.splice(index, 1);
        }
    },

    clear() {
        for (const toast of this.activeToasts) {
            if (toast && toast.parentNode) {
                toast.remove();
            }
        }
        this.activeToasts = [];
    }
};

function showToast(message, type = 'info', title = '') {
    const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
    const titles = { success: 'Success', error: 'Error', warning: 'Warning', info: 'Info' };
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    // Escape user input to prevent XSS
    const safeTitle = escapeHtml(title || titles[type]);
    const safeMessage = escapeHtml(message);
    toast.innerHTML = `
        <div class="toast-icon">${icons[type]}</div>
        <div class="toast-content">
            <div class="toast-title">${safeTitle}</div>
            <div class="toast-message">${safeMessage}</div>
        </div>
    `;
    document.body.appendChild(toast);
    toastManager.add(toast);

    // Use requestAnimationFrame to optimize animation performance
    const removeToast = () => {
        toast.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => {
            toastManager.remove(toast);
            if (toast.parentNode) {
                toast.remove();
            }
        }, 300);
    };

    setTimeout(removeToast, 3000);
}

function showConfirm(message, title = 'Confirm Action') {
    return new Promise((resolve) => {
        const modal = document.createElement('div');
        modal.className = 'modal';
        // Escape user input to prevent XSS
        const safeTitle = escapeHtml(title);
        const safeMessage = escapeHtml(message);
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-title">${safeTitle}</div>
                <div class="modal-message">${safeMessage}</div>
                <div class="modal-actions">
                    <button class="btn btn-secondary" id="confirmCancelBtn">Cancel</button>
                    <button class="btn btn-danger" id="confirmOkBtn">Confirm</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        const cancelBtn = modal.querySelector('#confirmCancelBtn');
        const okBtn = modal.querySelector('#confirmOkBtn');

        // Cleanup function
        const cleanup = () => {
            cancelBtn.removeEventListener('click', handleCancel);
            okBtn.removeEventListener('click', handleOk);
            modal.removeEventListener('click', handleModalClick);
            modal.remove();
        };

        const handleCancel = () => {
            cleanup();
            resolve(false);
        };

        const handleOk = () => {
            cleanup();
            resolve(true);
        };

        const handleModalClick = (e) => {
            if (e.target === modal) {
                cleanup();
                resolve(false);
            }
        };

        cancelBtn.addEventListener('click', handleCancel);
        okBtn.addEventListener('click', handleOk);
        modal.addEventListener('click', handleModalClick);
    });
}

// Store current loading overlay reference
let currentLoadingOverlay = null;

function showLoading(text = 'Processing...') {
    // If loading already exists, remove it first
    hideLoading();

    const overlay = document.createElement('div');
    overlay.className = 'loading-overlay';
    overlay.id = 'loadingOverlay';
    // Escape user input to prevent XSS
    const safeText = escapeHtml(text);
    overlay.innerHTML = `<div class="spinner"></div><div class="loading-text">${safeText}</div>`;
    document.body.appendChild(overlay);
    currentLoadingOverlay = overlay;
}

function hideLoading() {
    if (currentLoadingOverlay && currentLoadingOverlay.parentNode) {
        currentLoadingOverlay.remove();
    }
    currentLoadingOverlay = null;

    // Fallback cleanup: find by ID
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) overlay.remove();
}

function switchTab(tab, saveState = true) {
    // Update html element class to prevent flickering
    document.documentElement.classList.remove('tab-settings', 'tab-logs', 'tab-geminicli');
    if (tab === 'settings') {
        document.documentElement.classList.add('tab-settings');
    } else if (tab === 'logs') {
        document.documentElement.classList.add('tab-logs');
    } else if (tab === 'geminicli') {
        document.documentElement.classList.add('tab-geminicli');
    }

    // Remove active state from all tabs
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));

    // Find the corresponding tab button and activate it
    const targetTab = document.querySelector(`.tab[data-tab="${tab}"]`);
    if (targetTab) {
        targetTab.classList.add('active');
    }

    const tokensPage = document.getElementById('tokensPage');
    const settingsPage = document.getElementById('settingsPage');
    const logsPage = document.getElementById('logsPage');
    const geminicliPage = document.getElementById('geminicliPage');

    // Hide all pages and remove animation classes
    tokensPage.classList.add('hidden');
    tokensPage.classList.remove('page-enter');
    settingsPage.classList.add('hidden');
    settingsPage.classList.remove('page-enter');
    if (logsPage) {
        logsPage.classList.add('hidden');
        logsPage.classList.remove('page-enter');
    }
    if (geminicliPage) {
        geminicliPage.classList.add('hidden');
        geminicliPage.classList.remove('page-enter');
    }

    // Clean up auto-refresh for logs page (if leaving logs page)
    if (tab !== 'logs' && typeof cleanupLogsPage === 'function') {
        cleanupLogsPage();
    }

    // Show corresponding page and add enter animation
    if (tab === 'tokens') {
        tokensPage.classList.remove('hidden');
        // Trigger reflow to replay animation
        void tokensPage.offsetWidth;
        tokensPage.classList.add('page-enter');
        // When entering Token page, load latest token list from backend
        if (typeof loadTokens === 'function' && isLoggedIn) {
            loadTokens();
        }
    } else if (tab === 'settings') {
        settingsPage.classList.remove('hidden');
        // Trigger reflow to replay animation
        void settingsPage.offsetWidth;
        settingsPage.classList.add('page-enter');
        loadConfig();
    } else if (tab === 'logs') {
        if (logsPage) {
            logsPage.classList.remove('hidden');
            // Trigger reflow to replay animation
            void logsPage.offsetWidth;
            logsPage.classList.add('page-enter');
            // Load logs when entering logs page
            if (typeof initLogsPage === 'function') {
                initLogsPage();
            }
        }
    } else if (tab === 'geminicli') {
        if (geminicliPage) {
            geminicliPage.classList.remove('hidden');
            // Trigger reflow to replay animation
            void geminicliPage.offsetWidth;
            geminicliPage.classList.add('page-enter');
            // Load token list when entering Gemini CLI page
            if (typeof initGeminiCliPage === 'function' && isLoggedIn) {
                initGeminiCliPage();
            }
        }
    }

    // Save current tab state to localStorage
    if (saveState) {
        localStorage.setItem('currentTab', tab);
    }
}

// Restore tab state
function restoreTabState() {
    const savedTab = localStorage.getItem('currentTab');
    if (savedTab && (savedTab === 'tokens' || savedTab === 'settings' || savedTab === 'logs' || savedTab === 'geminicli')) {
        switchTab(savedTab, false);
    }
}

// ==================== General Modal/Import Tools ====================

// Click backdrop to close (return cleanup for unbinding)
function wireModalBackdropClose(modal, onClose) {
    if (!modal) return () => { };

    const handleModalClick = (e) => {
        if (e.target === modal) {
            try {
                onClose && onClose();
            } catch {
                // ignore
            }
        }
    };

    modal.addEventListener('click', handleModalClick);
    return () => {
        try {
            modal.removeEventListener('click', handleModalClick);
        } catch {
            // ignore
        }
    };
}

// Bind JSON file drag/drop and click selection (return cleanup for unbinding)
function wireJsonFileDropzone({ dropzone, fileInput, onFile, onError } = {}) {
    const safeOnError = (message) => {
        try {
            if (typeof onError === 'function') onError(message);
            else if (typeof showToast === 'function') showToast(message, 'warning');
        } catch {
            // ignore
        }
    };

    const isJsonFile = (file) => String(file?.name || '').toLowerCase().endsWith('.json');

    const handlePickedFile = (file) => {
        if (!file) return;
        if (!isJsonFile(file)) {
            safeOnError('Please select a JSON file');
            return;
        }
        try {
            onFile && onFile(file);
        } catch (err) {
            safeOnError('Failed to process file: ' + (err?.message || String(err)));
        }
    };

    const handleClick = () => {
        try {
            fileInput && fileInput.click();
        } catch {
            // ignore
        }
    };

    const handleChange = () => {
        const file = fileInput?.files && fileInput.files[0];
        handlePickedFile(file);
    };

    const handleDragOver = (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone?.classList?.add('dragover');
    };

    const handleDragLeave = (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone?.classList?.remove('dragover');
    };

    const handleDrop = (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropzone?.classList?.remove('dragover');
        const file = e.dataTransfer?.files && e.dataTransfer.files[0];
        handlePickedFile(file);
    };

    if (dropzone) {
        dropzone.addEventListener('click', handleClick);
        dropzone.addEventListener('dragover', handleDragOver);
        dropzone.addEventListener('dragleave', handleDragLeave);
        dropzone.addEventListener('drop', handleDrop);
    }
    if (fileInput) {
        fileInput.addEventListener('change', handleChange);
    }

    return () => {
        try {
            if (dropzone) {
                dropzone.removeEventListener('click', handleClick);
                dropzone.removeEventListener('dragover', handleDragOver);
                dropzone.removeEventListener('dragleave', handleDragLeave);
                dropzone.removeEventListener('drop', handleDrop);
            }
            if (fileInput) {
                fileInput.removeEventListener('change', handleChange);
            }
        } catch {
            // ignore
        }
    };
}

