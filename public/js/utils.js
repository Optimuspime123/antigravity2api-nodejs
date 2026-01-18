// HTML escape function - prevent XSS injection
function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Escape content for JavaScript strings
function escapeJs(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r');
}

// Font size settings
function initFontSize() {
    const savedSize = localStorage.getItem('fontSize') || '18';
    document.documentElement.style.setProperty('--font-size-base', savedSize + 'px');
    updateFontSizeInputs(savedSize);
}

function changeFontSize(size) {
    size = Math.max(10, Math.min(24, parseInt(size) || 14));
    document.documentElement.style.setProperty('--font-size-base', size + 'px');
    localStorage.setItem('fontSize', size);
    updateFontSizeInputs(size);
}

function updateFontSizeInputs(size) {
    const rangeInput = document.getElementById('fontSizeRange');
    const numberInput = document.getElementById('fontSizeInput');
    if (rangeInput) rangeInput.value = size;
    if (numberInput) numberInput.value = size;
}

// Sensitive info hiding feature
let sensitiveInfoHidden = localStorage.getItem('sensitiveInfoHidden') !== 'false';

function initSensitiveInfo() {
    updateSensitiveInfoDisplay();
    updateSensitiveBtn();
}

function toggleSensitiveInfo() {
    sensitiveInfoHidden = !sensitiveInfoHidden;
    localStorage.setItem('sensitiveInfoHidden', sensitiveInfoHidden);
    updateSensitiveInfoDisplay();
    updateSensitiveBtn();
}

function updateSensitiveBtn() {
    const btn = document.getElementById('toggleSensitiveBtn');
    if (btn) {
        if (sensitiveInfoHidden) {
            btn.innerHTML = '🙈 Hide';
            btn.title = 'Click to show sensitive info';
            btn.classList.remove('btn-info');
            btn.classList.add('btn-secondary');
        } else {
            btn.innerHTML = '👁️ Show';
            btn.title = 'Click to hide sensitive info';
            btn.classList.remove('btn-secondary');
            btn.classList.add('btn-info');
        }
    }
}

function updateSensitiveInfoDisplay() {
    // Hide/show entire rows containing sensitive info
    document.querySelectorAll('.sensitive-row').forEach(row => {
        if (sensitiveInfoHidden) {
            row.style.display = 'none';
        } else {
            row.style.display = '';
        }
    });
    // Also hide/show token-info containers
    document.querySelectorAll('.token-info').forEach(container => {
        if (sensitiveInfoHidden) {
            container.style.display = 'none';
        } else {
            container.style.display = '';
        }
    });
}
