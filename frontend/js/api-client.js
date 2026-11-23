// API Configuration:
// When the page is served by Flask (http://localhost:5000) we use a same-origin
// relative path. If you open the frontend some other way (Live Server,
// `python -m http.server 8000`, file://) we talk to Flask on localhost:5000.

const isLocalDev = ['localhost', '127.0.0.1'].includes(window.location.hostname);
const API_BASE_URL = (!isLocalDev || window.location.port === '5000') ? '/api' : 'http://localhost:5000/api';
const REQUEST_TIMEOUT = 15000; // 15 sec (scraping/uploads can take a moment)

// API Client Class
class APIClient {
    constructor(baseURL = API_BASE_URL, timeout = REQUEST_TIMEOUT) {
        this.baseURL = baseURL;
        this.timeout = timeout;
    }

    /**
     * Parse a fetch Response; on error throw the backend's message if it sent one
     */
    async handleResponse(response) {
        if (!response.ok) {
            let message = `${response.status} ${response.statusText}`;
            try {
                const body = await response.json();
                if (body && (body.error || body.message)) message = body.error || body.message;
            } catch (_) { /* response was not JSON */ }
            throw new Error(message);
        }
        return response.json();
    }

    /**
     * Make HTTP request
     */
    async request(endpoint, options = {}) {
        const url = `${this.baseURL}${endpoint}`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        try {
            const response = await fetch(url, {
                ...options,
                signal: controller.signal,
                headers: {
                    'Content-Type': 'application/json',
                    ...options.headers,
                },
            });

            clearTimeout(timeoutId);
            return await this.handleResponse(response);
        } catch (error) {
            clearTimeout(timeoutId);
            console.error('API Error:', error);
            throw error
        }
    }

    /**
     * GET request
     */
    async get(endpoint, params = {}) {
        const queryString = new URLSearchParams(params).toString();
        const url = queryString ? `${endpoint}?${queryString}` : endpoint;
        return this.request(url, { method: 'GET' });
    }

    /**
     * POST request
     */
    async post(endpoint, data = {}) {
        return this.request(endpoint, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    }

    /**
     * POST with FormData (for file uploads)
     */
    async postFormData(endpoint, formData) {
        const url = `${this.baseURL}${endpoint}`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        try {
            const response = await fetch(url, {
                method: 'POST',
                body: formData,   // no Content-Type header: the browser sets the multipart boundary
                signal: controller.signal,
            });

            clearTimeout(timeoutId);
            return await this.handleResponse(response);
        } catch (error) {
            clearTimeout(timeoutId);
            console.error('Upload Error:', error);
            throw error;
        }
    }

    /**
     * DELETE request
     */
    async delete(endpoint) {
        return this.request(endpoint, { method: 'DELETE' });
    }

    // =========== CSV Endpoints =========================
    
    async uploadCSV(file) {
        const formData = new FormData();
        formData.append('file', file);

        return this.postFormData('/csv/upload', formData);
    }

    async getCSVData() {
        return this.get('/csv/data');
    }

    async getCSVFileData(fileId) {
        return this.get(`/csv/data/${fileId}`);
    }

    async getCSVFiles() {
        return this.get('/csv/files');
    }

    async deleteCSVFile(fileId) {
        return this.delete(`/csv/data/${fileId}`);
    }

    // ========== Trustpilot Endpoints ===============
    async getTrustpilotReviews() {
        return this.get('/trustpilot/reviews');
    }

    async getTrustpilotStats() {
        return this.get('/trustpilot/stats');
    }

    async searchTrustpilotReviews(query) {
        return this.get('/trustpilot/search', { query });
    }

    async getTrustpilotByRating(rating) {
        return this.get(`/trustpilot/by-rating/${rating}`);
    }

    // ====== Web Scraping Endpoints ===========
    async scrapeURL(url, selectors = {}) {
        return this.post('/scrape', {
            url,
            selectors,
        });
    }

    async scrapeBatch(urls, selectors = {}) {
        return this.post('/scrape/batch', {
            urls,
            selectors,
        });
    }

    async getScrapeHistory(limit = 50) {
        return this.get('/scrape/history', { limit });
    }

    async getScrapeResult(resultId) {
        return this.get(`/scrape/${resultId}`);
    }

    async deleteScrapingResult(resultId) {
        return this.delete(`/scrape/${resultId}`);
    }

    // ========= Data Aggregation Endpoints ===========
    async getAggregatedData() {
        return this.get('/data/aggregate');
    }

    async getDataBySource(source) {
        return this.get('/data/by-source', {source});
    }

    async getRecentData(limit = 100, source = '') {
        return this.get('/data/recent', { limit, ...(source && { source }) });
    }

    async getDataStats() {
        return this.get('/data/stats');
    }

    async searchData(query) {
        return this.get('/data/search', {query});
    }

    // ======== Workflow Endpoints ===========
    async triggerWorkflow(payload) {
        return this.post('/workflows/trigger', payload);
    }

    async getWorkflowHistory(limit = 50) {
        return this.get('/workflows/history', { limit });
    }

    async getWorkflowStats() {
        return this.get('/workflows/stats');
    }
}

// Create global API client instance
const api = new APIClient();

// Health check function
async function checkAPIHealth() {
    try {
        const response = await api.get('/health');
        return response.status === 'ok';
    } catch (error) {
        console.error('API Health Check Failed:', error);
        return false;
    }
}