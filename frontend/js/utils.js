// Utility Functions

/**
 * Format a date string as a readable "date time" string
 */
function formatDate(dateString) {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    if (isNaN(date)) return String(dateString);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
}

/**
 * Escape text before putting it into innerHTML
 */
function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

/**
 * Format time ago (e.g., "2 hours ago")
 */
function formatTimeAgo(dateString) {
    if (!dateString) return "N/A";
    const date = new Date(dateString);
    if (isNaN(date)) return String(dateString);

    const now = new Date();
    const seconds = Math.floor((now - date) / 1000);

    let interval = Math.floor(seconds / 31536000);
    if (interval >= 1) return interval + ' year' + (interval > 1 ? 's' : '') + ' ago';

    interval = Math.floor(seconds / 2592000);
    if (interval >= 1) return interval + ' month' + (interval > 1 ? 's' : '') + ' ago';

    interval = Math.floor(seconds / 86400);
    if (interval >= 1) return interval + ' day' + (interval > 1 ? 's' : '') + ' ago';

    interval = Math.floor(seconds / 3600);
    if (interval >= 1) return interval + ' hour' + (interval > 1 ? 's' : '') + ' ago';

    interval = Math.floor(seconds / 60);
    if (interval >= 1) return interval + ' minute' + (interval > 1 ? 's' : '') + ' ago';

    return Math.floor(seconds) + ' second' + (Math.floor(seconds) > 1 ? 's' : '') + ' ago';
}

/**
 * Truncate text
 */
function truncate(text, length = 100) {
    if (typeof text !== 'string') return '';
    return text.length > length ? text.substring(0, length) + '...' : text;
}

/**
 * Get star rating HTML
 */
function getRatingStars(rating) {
    const value = Number(rating);
    if (!Number.isFinite(value) || value <= 0) return 'N/A';
    return '⭐️'.repeat(Math.round(value));
}

/**
 * Format file size
 */
function formatFileSize(bytes) {
    if (!bytes) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i]; 
}

/**
 * Show toast notification
 */
function showToast(message, type = 'info', duration = 3000) {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    toast.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    padding: 1rem 1.5rem;
    background: ${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#3b82f6'};
    color: white;
    border-radius: 6px;
    box-shadow: 0 10px 15px rgba(0, 0, 0, 0.2);
    z-index: 10000;
    animation: slideIn 0.3s ease;
    `;

    document.body.appendChild(toast);
     
    if (duration > 0) {
        setTimeout(() => {
            toast.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }, duration)
    }

    return toast;
}

function setElementContent(element, content) {
    if (!element) return;

    if (content instanceof HTMLElement) {
        element.innerHTML = "";
        element.appendChild(content);
        return;
    }

    element.textContent = content ?? "";
}

/**
 * Add class to element 
 */
function addClass(element, className) {
    if (element) element.classList.add(className);
}

/**
 * Remove class from element
 */
function removeClass(element, className) {
    if (element) element.classList.remove(className);
}

/**
 * Toggle class on element
 */
function toggleClass(element, className) {
    if (element) element.classList.toggle(className);
}

/**
 * Update element status
 */
function updateStatus(connected = true) {
    const statusDot = document.getElementById('statusDot');
    const statusText = document.getElementById('statusText');

    if (connected) {
        if (statusDot) {
            removeClass(statusDot, 'loading');
            removeClass(statusDot, 'error');
            addClass(statusDot, 'connected');
        }
        if (statusText) statusText.textContent = 'Connected';
    } else {
        if (statusDot) {
            removeClass(statusDot, 'loading');
            removeClass(statusDot, 'connected');
            addClass(statusDot, 'error');
        }
        if (statusText) statusText.textContent = 'Disconnected';
    }
}

/**
 * Create source badge HTML
 */
function createSourceBadge(source) {
    const colors = {
        csv: '#2563eb',
        trustpilot: '#10b981',
        scraping: '#8b5cf6'
    };
    return `<span style="
        display: inline-block;
        padding: 0.25rem 0.75rem;
        background: ${colors[source] || '#64748b'};
        color: white;
        border-radius: 4px;
        font-size: 0.75rem;
        font-weight: 600;
        text-transform: uppercase;
        margin-right: 0.5rem;
    ">${source}</span>`;
}

/**
 * Validate URL
 */
function isValidURL(string){
    try {
        new URL(string);
        return true;
    } catch (_) {
        return false;
    }
}

/**
 * Debounce function
 */
function debounce(func, wait) {
    let timeout; 
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
 * Throttle function
 */
function throttle(func, limit) {
    let inThrottle;
    return function(...args) {
        if (!inThrottle) {
            func.apply(this, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

/**
 * Get URL parameters
 */
function getURLParams() {
    const params = new URLSearchParams(window.location.search);
    const obj = {};
    params.forEach((value, key) => {
        obj[key] = value;
    });
    return obj;
}

/**
 * Copy to clipboard
 */
async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        showToast('Copied to clipboard!', 'success', 2000);
        return true;
    } catch (error) {
        console.error('Copy error:', error);
        showToast('Failed to copy', 'error');
        return false;
    }
}

/**
 * Export data as JSON
 */
function exportAsJSON(data, filename = 'data.json') {
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
}

/**
 * Export data as CSV
 */
function exportAsCSV(data, filename = 'data.csv') {
    if (!Array.isArray(data) || data.length === 0) {
        showToast('No data to export', 'error');
        return;
    }
    
    const headers = Object.keys(data[0]);
    const rows = data.map(item => 
        headers.map(header => {
            const value = item[header];
            return typeof value === 'string' && value.includes(',')
                ? `"${value}"`
                : value;
        }).join(',')
    );

    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
}

// Add slide animations CSS
(function addToastAnimations() {
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from {
            transform: translateX(400px);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }

    @keyframes slideOut {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(400px);
            opacity: 0;
        }
    }
`;
document.head.appendChild(style);
})();
