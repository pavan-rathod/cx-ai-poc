// Main Application Logic
// (Chart.js, utils.js, api-client.js and charts.js are loaded before this file by index.html)

const SOURCE_LABELS = {
    csv: 'CSV',
    trustpilot: 'Mock Reviews',
    scraping: 'Web Scraping'
};

let isOnline = false;

/**
 * Initialize application
 */
async function initializeApp() {
    setupEventListeners();
    initializeCharts();

    const isHealthy = await checkAPIHealth();
    isOnline = isHealthy;
    updateStatus(isHealthy);

    if (!isHealthy) {
        showToast('Backend API not available. Start it with "python app.py" in the backend folder, then click Manual Refresh.', 'error', 7000);
        return;
    }

    await refreshAllData();
}

/**
 * Setup event listeners
 */
function setupEventListeners() {
    // Tab navigation (currentTarget = the button, even if the click lands on its text)
    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.addEventListener('click', (e) => switchTab(e.currentTarget.dataset.tab));
    });

    // Manual refresh button
    const refreshBtn = document.getElementById('refreshBtn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', async () => {
            refreshBtn.disabled = true;
            refreshBtn.textContent = 'Refreshing...';
            try {
                await refreshAllData();
            } finally {
                refreshBtn.disabled = false;
                refreshBtn.textContent = '🔁 Manual Refresh';
            }
        });
    }

    // CSV upload: drag & drop
    const uploadArea = document.getElementById('uploadArea');
    if (uploadArea) {
        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.style.backgroundColor = 'rgba(37, 99, 235, 0.1)';
        });

        uploadArea.addEventListener('dragleave', () => {
            uploadArea.style.backgroundColor = 'transparent';
        });

        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.style.backgroundColor = 'transparent';
            handleCSVUpload(e.dataTransfer.files[0]);
        });
    }

    // CSV upload: file picker
    const csvInput = document.getElementById('csvInput');
    if (csvInput) {
        csvInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            await handleCSVUpload(file);
            csvInput.value = '';   // allow choosing the same file again
        });
    }

    // Mock reviews search and filter
    const trustpilotSearch = document.getElementById('trustpilotSearch');
    const ratingFilter = document.getElementById('ratingFilter');
    if (trustpilotSearch) {
        trustpilotSearch.addEventListener('input', debounce(loadTrustpilotData, 300));
    }
    if (ratingFilter) {
        ratingFilter.addEventListener('change', loadTrustpilotData);
    }

    // Web scraping
    const scrapeBtn = document.getElementById('scrapeBtn');
    if (scrapeBtn) {
        scrapeBtn.addEventListener('click', handleWebScraping);
    }

    // All-data search and filter
    const dataSearch = document.getElementById('dataSearch');
    const sourceFilter = document.getElementById('sourceFilter');
    if (dataSearch) {
        dataSearch.addEventListener('input', debounce(loadAllData, 300));
    }
    if (sourceFilter) {
        sourceFilter.addEventListener('change', loadAllData);
    }

    // Trend chart time filter
    const timeFilter = document.getElementById('timeFilter');
    if (timeFilter) {
        timeFilter.addEventListener('change', (e) => applyTimeFilter(e.target.value));
    }

    // Delete buttons are created dynamically, so listen on the document
    document.addEventListener('click', (e) => {
        const button = e.target.closest('[data-action]');
        if (!button) return;

        const { action, id } = button.dataset;
        if (action === 'delete-csv') deleteCSVFile(id);
        if (action === 'delete-scrape') deleteScrapingResult(id);
    });
}

/**
 * Switch tabs
 */
function switchTab(tabName) {
    if (!tabName) return;

    document.querySelectorAll('.tab-content').forEach(tab => removeClass(tab, 'active'));
    document.querySelectorAll('.nav-tab').forEach(tab => removeClass(tab, 'active'));

    addClass(document.getElementById(tabName), 'active');
    document.querySelector(`.nav-tab[data-tab="${tabName}"]`)?.classList.add('active');

    // Load tab-specific data
    switch (tabName) {
        case 'dashboard':
            refreshAllData();
            break;
        case 'csv':
            loadCSVFiles();
            break;
        case 'trustpilot':
            loadTrustpilotData();
            break;
        case 'scraping':
            loadScrapingResults();
            break;
        case 'data':
            loadAllData();
            break;
        case 'workflows':
            loadWorkflowHistory();
            break;
    }
}

/**
 * Refresh all dashboard data
 */
async function refreshAllData() {
    try {
        const [data, stats] = await Promise.all([
            api.getAggregatedData(),
            api.getDataStats()
        ]);

        updateDashboard(data, stats);
        isOnline = true;
        updateStatus(true);
    } catch (error) {
        console.error('Error refreshing data:', error);
        isOnline = false;
        updateStatus(false);
        showToast('Could not load data: ' + error.message, 'error');
    }
}

/**
 * Update dashboard with stats
 */
function updateDashboard(data, stats) {
    window.dashboardData = data;

    const csvCount = stats.stats?.csv?.files || 0;
    const csvRows = stats.stats?.csv?.rows || 0;
    const trustpilotCount = stats.stats?.trustpilot?.reviews || 0;
    const trustpilotRating = stats.stats?.trustpilot?.average_rating || 0;
    const scrapingCount = stats.stats?.scraping?.results || 0;
    const scrapingUrls = stats.stats?.scraping?.urls || 0;
    const totalData = data.total || 0;

    const sentiment = stats.sentiment || { positive: 0, neutral: 0, negative: 0 };
    const workflows = stats.workflows || { total: 0, triggered: 0, by_issue_type: {} };

    setElementContent(document.getElementById('csvCount'), String(csvCount));
    setElementContent(document.getElementById('csvRows'), `${csvRows} rows`);
    setElementContent(document.getElementById('trustpilotCount'), String(trustpilotCount));
    setElementContent(document.getElementById('trustpilotRating'), `⭐️ ${trustpilotRating}`);
    setElementContent(document.getElementById('scrapingCount'), String(scrapingCount));
    setElementContent(document.getElementById('scrapingUrls'), `${scrapingUrls} URLs`);
    setElementContent(document.getElementById('totalData'), String(totalData));

    setElementContent(document.getElementById('positiveCount'), String(sentiment.positive || 0));
    setElementContent(document.getElementById('neutralCount'), String(sentiment.neutral || 0));
    setElementContent(document.getElementById('negativeCount'), String(sentiment.negative || 0));

    setElementContent(document.getElementById('workflowDashboardCount'), String(workflows.total || 0));

    updateInsights(stats);

    const sourceCounts = data.sources || stats.sources || {
        csv: csvRows,
        trustpilot: trustpilotCount,
        scraping: scrapingCount
    };

    updateDistributionChart(
        Number(sourceCounts.csv) || 0,
        Number(sourceCounts.trustpilot) || 0,
        Number(sourceCounts.scraping) || 0
    );
    updateRatingChart(stats.rating_distribution || { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 });
    updateSentimentChart(sentiment);

    renderSuggestions(stats.suggestions || []);
    renderIssueSummary(stats.issues || {});

    // Trend chart honours the currently selected time filter
    applyTimeFilter(document.getElementById('timeFilter')?.value || 'all');
}

/**
 * Insights box (left panel on the dashboard)
 */
function updateInsights(stats) {
    const insightsBox = document.getElementById('insightsBox');
    if (!insightsBox) return;

    const sentiment = stats.sentiment || {};
    const positive = sentiment.positive || 0;
    const neutral = sentiment.neutral || 0;
    const negative = sentiment.negative || 0;
    const analysed = positive + neutral + negative;

    const lines = [];

    if (analysed === 0) {
        lines.push('<p>Upload a CSV file in the <strong>CSV</strong> tab to generate sentiment insights and proactive repair workflows.</p>');
    } else {
        const negativePct = Math.round((negative / analysed) * 100);
        lines.push(`<p><strong>${analysed}</strong> uploaded reviews analysed: <strong>${negativePct}%</strong> negative.</p>`);

        const topIssue = Object.entries(stats.issues || {})
            .filter(([issue]) => issue !== 'general_feedback')
            .sort((a, b) => b[1] - a[1])[0];

        if (topIssue) {
            lines.push(`<p>Most common issue: <strong>${escapeHtml(formatIssueName(topIssue[0]))}</strong> (${topIssue[1]} reviews).</p>`);
        }

        lines.push(negativePct >= 40
            ? '<p><strong>Tip:</strong> A high share of negative feedback; check the Proactive Monitoring &amp; Repair tab for triggered workflows.</p>'
            : '<p><strong>Tip:</strong> Focus on improving low ratings to keep negative feedback down.</p>');
    }

    const avg = stats.stats?.trustpilot?.average_rating;
    if (avg) {
        lines.push(`<p>Average mock review rating: <strong>${escapeHtml(avg)}</strong> / 5</p>`);
    }

    insightsBox.innerHTML = lines.join('');
}

/**
 * Rendering suggestions
 */
function renderSuggestions(suggestions) {
    const container = document.getElementById('suggestionsList');
    if (!container) return;

    if (!suggestions || suggestions.length === 0) {
        container.innerHTML = '<p class="empty-state">No suggestions available yet.</p>';
        return;
    }

    container.innerHTML = suggestions.map(item => `
        <div class="suggestion-item">
            <div class="suggestion-count">${Number(item.count) || 0} reviews</div>
            <div class="suggestion-text">${escapeHtml(item.suggestion)}</div>
        </div>
    `).join('');
}

function renderIssueSummary(issues) {
    const container = document.getElementById('issueList');
    if (!container) return;

    const entries = Object.entries(issues || {});

    if (entries.length === 0) {
        container.innerHTML = '<p class="empty-state">No issue categories detected yet.</p>';
        return;
    }

    container.innerHTML = entries.map(([issue, count]) => `
        <div class="issue-item">
            <span class="issue-name">${escapeHtml(formatIssueName(issue))}</span>
            <span class="issue-count">${Number(count) || 0}</span>
        </div>
    `).join('');
}

function formatIssueName(issue) {
    return String(issue)
        .replaceAll('_', ' ')
        .replace(/\b\w/g, char => char.toUpperCase());
}

/**
 * Trend chart time filter
 */
function applyTimeFilter(days) {
    const rows = window.dashboardData?.data || [];

    if (days === 'all') {
        updateTrendChart(rows.map(row => row._timestamp));
        return;
    }

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - Number(days));

    const filtered = rows.filter(row => new Date(row._timestamp) >= cutoff);
    updateTrendChart(filtered.map(row => row._timestamp));
}

/**
 * Handle CSV upload
 */
async function handleCSVUpload(file) {
    if (!file) {
        showToast('No file selected', 'error');
        return;
    }

    if (!/\.(csv|xlsx|xls)$/i.test(file.name)) {
        showToast('Please choose a .csv, .xlsx or .xls file', 'error');
        return;
    }

    const progressToast = showToast('Uploading file...', 'info', 0);

    try {
        const response = await api.uploadCSV(file);
        showToast(`File uploaded successfully! ${response.rows} rows`, 'success');

        if (response.workflow_triggered) {
            showToast(`${response.workflow_count} proactive repair workflow(s) triggered.`, 'success', 5000);
        }

        loadCSVFiles();
        refreshAllData();
    } catch (error) {
        console.error('Upload error:', error);
        showToast('Failed to upload file: ' + error.message, 'error', 6000);
    } finally {
        progressToast.remove();
    }
}

/**
 * Load uploaded files list
 */
async function loadCSVFiles() {
    const container = document.getElementById('fileList');
    if (!container) return;

    try {
        const response = await api.getCSVFiles();
        const files = response.files || [];

        if (files.length === 0) {
            container.innerHTML = '<p class="empty-state">No files uploaded yet</p>';
            return;
        }

        container.innerHTML = files.map(file => {
            const columns = Array.isArray(file.columns) ? file.columns : [];
            const rowCount = Number(file.row_count) || 0;
            const uploadedAt = file.uploaded_at ? formatDate(file.uploaded_at) : 'N/A';

            return `
                <div class="file-item">
                    <div class="file-info">
                        <h4>${escapeHtml(file.filename || 'Unknown file')}</h4>
                        <p><strong>Rows:</strong> ${rowCount}</p>
                        <p><strong>Columns:</strong> ${columns.length}</p>
                        <p><strong>Uploaded:</strong> ${escapeHtml(uploadedAt)}</p>
                    </div>

                    <button class="btn btn-danger" data-action="delete-csv" data-id="${escapeHtml(file.file_id)}">
                        Delete
                    </button>
                </div>
            `;
        }).join('');
    } catch (error) {
        console.error('Error loading files:', error);
        container.innerHTML = '<p class="empty-state">Error loading files</p>';
    }
}

/**
 * Delete uploaded file
 */
async function deleteCSVFile(fileId) {
    if (!fileId) {
        showToast('Invalid file ID', 'error');
        return;
    }

    if (!confirm('Are you sure you want to delete this file?')) return;

    try {
        await api.deleteCSVFile(fileId);
        showToast('File deleted successfully', 'success');
        loadCSVFiles();
        refreshAllData();
    } catch (error) {
        console.error('Delete error:', error);
        showToast('Failed to delete file: ' + error.message, 'error');
    }
}

/**
 * Load mock reviews (the "Trustpilot" source)
 */
async function loadTrustpilotData() {
    const container = document.getElementById('trustpilotList');
    if (!container) return;

    try {
        const query = (document.getElementById('trustpilotSearch')?.value || '').trim();
        const rating = document.getElementById('ratingFilter')?.value || '';

        let response;
        if (query) {
            response = await api.searchTrustpilotReviews(query);
        } else if (rating) {
            response = await api.getTrustpilotByRating(parseInt(rating, 10));
        } else {
            response = await api.getTrustpilotReviews();
        }

        let reviews = response.reviews || response.results || [];

        // The search endpoint can't filter by rating, so combine both filters here
        if (query && rating) {
            reviews = reviews.filter(review => String(review.rating) === rating);
        }

        if (reviews.length === 0) {
            container.innerHTML = '<p class="empty-state">No reviews found</p>';
            return;
        }

        container.innerHTML = reviews.map(review => `
            <div class="review-item">
                <div class="review-header">
                    <span class="review-title">${escapeHtml(truncate(review.title || '', 50))}</span>
                    <span class="review-rating">${getRatingStars(review.rating)}</span>
                </div>
                <div class="review-content">${escapeHtml(truncate(review.content || '', 150))}</div>
                <div class="review-meta">
                    By ${escapeHtml(review.author || 'Anonymous')} · ${escapeHtml(formatTimeAgo(review.date))}
                    ${review.verified ? ' · ✓ Verified' : ''}
                </div>
            </div>
        `).join('');
    } catch (error) {
        console.error('Error loading mock reviews:', error);
        container.innerHTML = '<p class="empty-state">Error loading reviews</p>';
    }
}

/**
 * Scrape a URL
 */
async function handleWebScraping() {
    const url = (document.getElementById('scrapeUrl')?.value || '').trim();
    const selector = (document.getElementById('scrapeSelector')?.value || '').trim();

    if (!url) {
        showToast('Please enter a URL', 'error');
        return;
    }

    if (!isValidURL(url) || !/^https?:\/\//i.test(url)) {
        showToast('Invalid URL. It must start with http:// or https://', 'error');
        return;
    }

    const btn = document.getElementById('scrapeBtn');
    btn.disabled = true;
    btn.textContent = 'Scraping...';

    try {
        const selectors = selector ? { extracted: selector } : {};
        await api.scrapeURL(url, selectors);
        showToast('Scraping completed!', 'success');
        loadScrapingResults();
        refreshAllData();
    } catch (error) {
        console.error('Scraping error:', error);
        showToast('Scraping failed: ' + error.message, 'error', 6000);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Scrape URL';
    }
}

/**
 * Load scraping results
 */
async function loadScrapingResults() {
    const container = document.getElementById('scrapingList');
    if (!container) return;

    try {
        const response = await api.getScrapeHistory(50);
        const results = (response.history || []).slice().reverse();   // newest first

        if (results.length === 0) {
            container.innerHTML = '<p class="empty-state">No scraping results yet</p>';
            return;
        }

        container.innerHTML = results.map(result => `
            <div class="result-item">
                <div style="display: flex; justify-content: space-between; align-items: start;">
                    <div>
                        <div style="font-weight: 600;">${escapeHtml(truncate(result.url || '', 70))}</div>
                        <div style="font-size: 0.85rem; color: #999; margin-top: 0.5rem;">
                            ${escapeHtml(formatTimeAgo(result.scraped_at))}
                        </div>
                    </div>
                    <button class="btn btn-small" data-action="delete-scrape" data-id="${escapeHtml(result.result_id)}"
                            style="color: #ef4444; background: #fee2e2; border-color: #fca5a5;">
                        Delete
                    </button>
                </div>
            </div>
        `).join('');
    } catch (error) {
        console.error('Error loading scraping results:', error);
        container.innerHTML = '<p class="empty-state">Error loading results</p>';
    }
}

/**
 * Delete scraping result
 */
async function deleteScrapingResult(resultId) {
    try {
        await api.deleteScrapingResult(resultId);
        showToast('Result deleted', 'success');
        loadScrapingResults();
        refreshAllData();
    } catch (error) {
        console.error('Delete error:', error);
        showToast('Failed to delete result: ' + error.message, 'error');
    }
}

/**
 * Load all aggregated data (Individual Reviews tab)
 */
async function loadAllData() {
    const tableBody = document.getElementById('dataTableBody');
    if (!tableBody) return;

    const emptyRow = (text) => `<tr><td colspan="3" class="empty-state">${text}</td></tr>`;

    try {
        const query = (document.getElementById('dataSearch')?.value || '').toLowerCase();
        const source = document.getElementById('sourceFilter')?.value || '';

        const response = await api.getAggregatedData();
        let rows = response.data || [];

        if (source) {
            rows = rows.filter(item => item._source === source);
        }

        if (query) {
            rows = rows.filter(item => JSON.stringify(item).toLowerCase().includes(query));
        }

        if (!rows.length) {
            tableBody.innerHTML = emptyRow('No data found');
            return;
        }

        tableBody.innerHTML = rows.map(item => {
            const timestamp = item._timestamp || item.date || item.timestamp || '';

            return `
                <tr>
                    <td class="source-cell">${renderSourceBadge(item._source || 'unknown')}</td>
                    <td>${renderReadableDataCard(item)}</td>
                    <td class="timestamp-cell">${timestamp ? escapeHtml(formatDate(timestamp)) : 'N/A'}</td>
                </tr>
            `;
        }).join('');
    } catch (error) {
        console.error('Error loading all data:', error);
        tableBody.innerHTML = emptyRow('Error loading data');
    }
}

/**
 * Workflow tab
 */
async function loadWorkflowHistory() {
    try {
        const [historyResponse, statsResponse] = await Promise.all([
            api.getWorkflowHistory(50),
            api.getWorkflowStats()
        ]);

        updateWorkflowSummary(statsResponse.workflows || {});
        renderWorkflowHistory(historyResponse.history || []);
    } catch (error) {
        console.error('Error loading workflow history:', error);

        const container = document.getElementById('workflowHistoryList');
        if (container) {
            container.innerHTML = '<p class="empty-state">Error loading workflow history.</p>';
        }
    }
}

function updateWorkflowSummary(workflows) {
    const byIssueType = workflows.by_issue_type || {};
    const topIssue = Object.entries(byIssueType).sort((a, b) => b[1] - a[1])[0]?.[0];

    setElementContent(document.getElementById('workflowTotal'), String(workflows.total || 0));
    setElementContent(document.getElementById('workflowTriggered'), String(workflows.triggered || 0));
    setElementContent(document.getElementById('workflowTopIssue'), topIssue ? formatIssueName(topIssue) : '-');
}

function renderWorkflowHistory(history) {
    const container = document.getElementById('workflowHistoryList');
    if (!container) return;

    if (!history || history.length === 0) {
        container.innerHTML = '<p class="empty-state">No workflows triggered yet.</p>';
        return;
    }

    container.innerHTML = history.slice().reverse().map(workflow => {
        const externalStatus = workflow.external_api_result?.external_api_status || 'unknown';
        const externalSystem = workflow.external_api_result?.external_system || 'N/A';
        const createdAt = workflow.created_at ? formatDate(workflow.created_at) : 'N/A';

        return `
            <div class="workflow-item">
                <div class="workflow-item-header">
                    <div>
                        <strong>${escapeHtml(workflow.workflow_name || workflow.workflow_type || 'Workflow')}</strong>
                        <p class="workflow-subtitle">${escapeHtml(workflow.workflow_id || '')}</p>
                    </div>

                    <span class="workflow-status">${escapeHtml(workflow.status || 'unknown')}</span>
                </div>

                <div class="workflow-meta">
                    <span>Issue: <strong>${escapeHtml(formatIssueName(workflow.issue_type || 'unknown'))}</strong></span>
                    <span>Affected Reviews: <strong>${Number(workflow.affected_review_count) || 0}</strong></span>
                    <span>Priority: <strong>${escapeHtml(workflow.priority || 'medium')}</strong></span>
                </div>

                <p class="workflow-reason">${escapeHtml(workflow.trigger_reason || '')}</p>

                <div class="workflow-action">
                    <strong>Proactive Measures Implemented to Prevent Future Occurrences:</strong>
                    ${escapeHtml(workflow.recommended_action || '')}
                </div>

                <div class="workflow-action">
                    <strong>External Mock API Status:</strong>
                    ${escapeHtml(externalStatus)}
                </div>

                <div class="workflow-action">
                    <strong>External System:</strong>
                    ${escapeHtml(externalSystem)}
                </div>

                <div class="workflow-time">${escapeHtml(createdAt)}</div>
            </div>
        `;
    }).join('');
}

/**
 * Renderers for the Individual Reviews table
 */
function renderSourceBadge(source) {
    const colors = {
        csv: '#2563eb',
        trustpilot: '#10b981',
        scraping: '#8b5cf6'
    };

    const color = colors[source] || '#64748b';
    const label = SOURCE_LABELS[source] || source || 'unknown';

    return `<span class="source-badge" style="background:${color}">${escapeHtml(label)}</span>`;
}

function renderReadableDataCard(item) {
    switch (item._source) {
        case 'csv':
            return renderCSVData(item);
        case 'trustpilot':
            return renderTrustpilotData(item);
        case 'scraping':
            return renderScrapingData(item);
        default:
            return renderGenericData(item);
    }
}

function renderCSVData(item) {
    const author = item['Author Name'] || item.author || item.customer_name || 'Unknown Customer';
    const reviewTitle = item['Review Title'] || item.title || 'Customer Review';
    const reviewText = item._review_text || item['Review Text'] || item.content || 'No review text available';
    const rating = item._rating ?? item['Review Rating'] ?? item.rating ?? 'N/A';
    const sentiment = item._sentiment || 'unknown';
    const suggestion = item._suggestion || '';

    return `
        <div class="data-card">
            <div class="data-card-header">
                <div>
                    <strong>${escapeHtml(reviewTitle)}</strong>
                    <p class="data-subtitle">${escapeHtml(author)}</p>
                </div>

                <div class="rating-pill">⭐️ ${escapeHtml(String(rating))}</div>
            </div>

            <p class="review-text">${escapeHtml(truncate(String(reviewText), 240))}</p>

            <div class="data-meta-row">${renderSentimentBadge(sentiment)}</div>

            ${suggestion ? `
                <div class="suggestion-box">
                    <strong>Suggestion:</strong>
                    ${escapeHtml(truncate(suggestion, 280))}
                </div>` : ''}
        </div>
    `;
}

function renderTrustpilotData(item) {
    return `
        <div class="data-card">
            <div class="data-card-header">
                <div>
                    <strong>${escapeHtml(item.title || 'Mock Review')}</strong>
                    <p class="data-subtitle">${escapeHtml(item.author || 'Unknown Reviewer')}</p>
                </div>

                <div class="rating-pill">⭐️ ${escapeHtml(String(item.rating ?? 'N/A'))}</div>
            </div>

            <p class="review-text">${escapeHtml(truncate(item.content || 'No review content available', 240))}</p>
        </div>
    `;
}

function renderScrapingData(item) {
    const url = item.url || 'Unknown URL';
    const values = Object.values(item.extracted || {}).filter(Boolean);
    const content = values.length ? values.join(' | ') : 'Nothing matched the selector';

    return `
        <div class="data-card">
            <div class="data-card-header">
                <div>
                    <strong>Scraped Result</strong>
                    <p class="data-subtitle">${escapeHtml(url)}</p>
                </div>
            </div>

            <p class="review-text">${escapeHtml(truncate(content, 280))}</p>
        </div>
    `;
}

function renderGenericData(item) {
    const cleaned = { ...item };

    delete cleaned._source;
    delete cleaned._file;
    delete cleaned._file_id;
    delete cleaned._timestamp;

    return `
        <div class="data-card">
            <pre class="json-preview">${escapeHtml(JSON.stringify(cleaned, null, 2))}</pre>
        </div>
    `;
}

function renderSentimentBadge(sentiment) {
    const value = String(sentiment || 'unknown').toLowerCase();
    return `<span class="sentiment-badge sentiment-${escapeHtml(value)}">${escapeHtml(value)}</span>`;
}

// Initialize app when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApp);
} else {
    initializeApp();
}
