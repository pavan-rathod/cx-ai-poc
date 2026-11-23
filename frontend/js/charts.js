// ======================= Chart Management ===========================

// Chart.js is loaded from the CDN <script> tag in index.html (global `Chart`).

// Chart Management
let distributionChart = null;
let ratingChart = null;
let trendChart = null;
let sentimentChart = null;

/**
 * Initialize all charts
 */
function initializeCharts() {
    console.log("Initializing charts");

    initDistributionChart();
    initRatingChart();
    initTrendChart();
    initSentimentChart();
}

/**
 * Get safe canvas context
 */
function getCanvasContext(id) {
    const canvas = document.getElementById(id);

    if (!canvas) {
        console.warn(`Canvas not found: ${id}`);
        return null;
    }

    if (!(canvas instanceof HTMLCanvasElement)) {
        console.error(`${id} is not a canvas element`);
        return null;
    }

    // Force reflow
    canvas.style.display = "block";
    const rect = canvas.getBoundingClientRect();

    if (rect.width === 0 || rect.height === 0) {
        console.error(`Canvas has zero size: ${id}`);
        return null;
    }

    const ctx = canvas.getContext("2d");

    if (!ctx) {
        console.error(`Failed to get canvas context for ${id}`);
        return null;
    }

    return ctx;
}

/**
 * Initialize distribution chart
 */
function initDistributionChart() {
    const ctx = getCanvasContext("distributionChart");
    if (!ctx) return;

    // Destroy only if valid chart
    if (distributionChart && typeof distributionChart.destroy === "function") {
        distributionChart.destroy();
    }

    distributionChart = new Chart(ctx, {
        type: "doughnut",
        data: {
            labels: ["CSV", "Mock Reviews", "Scraping"],
            datasets: [{
                data: [0,0,0],
                backgroundColor: [
                    "#3b82f6",
                    "#22c55e",
                    "#f97316"
                ]
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
        }
    });
}

/**
 * Initialize rating chart
 */
function initRatingChart() {
    const ctx = getCanvasContext("ratingChart");
    if (!ctx) return;

    if (ratingChart && typeof ratingChart.destroy === "function") {
        ratingChart.destroy();
    }

    ratingChart = new Chart(ctx, {
        type: "bar",
        data: {
            labels: ["1*", "2*", "3*", "4*", "5*"],
            datasets: [{
                label: "Number of Reviews",
                data: [0, 0, 0, 0, 0],
                backgroundColor: [
                    "#ef4444",
                    "#f97316",
                    "#facc15",
                    "#34d399",
                    "#10b981"
                ],
                borderColor: [
                    "#dc2626",
                    "#ea580c",
                    "#eab308",
                    "#10b981",
                    "#059669"
                ],
                borderWidth: 1,
                borderRadius: 8,
                maxBarThickness: 48
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: {
                duration: 800,
                easing: "easeOutQuart"
            },
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    backgroundColor: "#111827",
                    titleColor: "#ffffff",
                    bodyColor: "#e5e7eb",
                    padding: 10,
                    cornerRadius: 8,
                    callbacks: {
                        label: function(ctx) {
                            const value = Number(ctx.raw) || 0;
                            return `${value} ${value === 1 ? "review" : "reviews"}`;
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    suggestedMax: 5,
                    ticks: {
                        precision: 0,
                        color: "#64748b"
                    },
                    grid: {
                        color: "rgba(148, 163, 184, 0.25)"
                    },
                    title: {
                        display: true,
                        text: "Reviews",
                        color: "#334155"
                    }
                },
                x: {
                    ticks: {
                        color: "#334155",
                        font: {
                            weight: "600"
                        }
                    },
                    grid: {
                        display: false
                    },
                    title: {
                        display: true,
                        text: "Rating",
                        color: "#334155"
                    }
                }
            }
        }
    });
}

/**
 * Initialize trend chart
 */
function filterByDate(selectedDate) {
    const rows = window.dashboardData?.data || [];
    const filtered = rows.filter(row => {
        const parsed = new Date(row._timestamp);
        return !isNaN(parsed) && parsed.toLocaleDateString() === selectedDate;
    });

    updateTrendChart(filtered.map(x => x._timestamp));
}

function initTrendChart() {
    const ctx = getCanvasContext("trendChart");
    if (!ctx) return;

    if (trendChart && typeof trendChart.destroy === "function") {
        trendChart.destroy();
    }

    trendChart = new Chart(ctx, {
        type: "line",
        data: {
            labels: [],
            datasets: [{
                label: "Data Trends",
                data: [],
                borderColor: "#6366f1",
                backgroundColor: "rgba(99,102,241,0.2)",
                borderWidth: 2,
                tension: 0.4,
                fill: true,
                pointRadius: 4,
                pointHoverRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,

            animation: {
                duration: 600
            },

            interaction: {
                mode: "index",
                intersect: false,
            },

            plugins: {
                tooltip: {
                    callbacks: {
                        label: function(ctx) {
                            return `${ctx.raw} records`;
                        }
                    }
                }
            },

            scales: {
                x: { title: { display: true, text: "Date" }},
                y: { title: { display: true, text: "Count" }, beginAtZero: true }
            },

            // Click Interaction
            onClick: (evt, elements) => {
                if (!elements.length) return;

                const index = elements[0].index;
                const label = trendChart.data.labels[index];

                console.log("Clicked date:", label);
                filterByDate(label);
            }
        }
    });
}
    
/**
 * Sentiment Chart
 */
function initSentimentChart() {
    const ctx = getCanvasContext("sentimentChart");
    if (!ctx) return;

    if (sentimentChart && typeof sentimentChart.destroy === "function") {
        sentimentChart.destroy();
    }

    sentimentChart = new Chart(ctx, {
        type: "doughnut",
        data: {
            labels: ["Positive", "Neutral", "Negative"],
            datasets: [{
                data: [0, 0, 0],
                backgroundColor: [
                    "#10b981",
                    "#f59e0b",
                    "#ef4444"
                ],
                borderWidth: 2,
                borderColor: "#ffffff"
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: "65%",
            plugins: {
                legend: {
                    position: "bottom"
                },
                tooltip: {
                    callbacks: {
                        label: function(ctx) {
                            const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                            const value = ctx.raw || 0;
                            const pct = total ? ((value / total) * 100).toFixed(1) : 0;
                            return `${ctx.label}: ${value} reviews (${pct}%)`;
                        }
                    }
                }
            }
        }
    });
}

/**
 * Update distribution chart
 */
function updateDistributionChart(csvCount, trustpilotCount, scrapingCount) {
    if (!distributionChart || !distributionChart.data) {
        console.warn("[charts] distributionChart missing, reinitializing...");
        initDistributionChart();
    }

    if (!distributionChart || !distributionChart.data) {
        console.error("[charts] distributionChart still missing");
        return;
    }

    const values = [
        Number(csvCount) || 0,
        Number(trustpilotCount) || 0,
        Number(scrapingCount) || 0
    ];

    distributionChart.data.datasets[0].data = values;
    distributionChart.update();
}

/**
 * Update rating chart
 */
function updateRatingChart(distribution) {
    if (!ratingChart || !ratingChart.data) {
        console.warn("Rating chart not ready, reinitializing...");
        initRatingChart();
    }

    if (!ratingChart || !ratingChart.data) return;
    const values = [
        Number(distribution["1"] ?? distribution[1] ?? 0),
        Number(distribution["2"] ?? distribution[2] ?? 0),
        Number(distribution["3"] ?? distribution[3] ?? 0),
        Number(distribution["4"] ?? distribution[4] ?? 0),
        Number(distribution["5"] ?? distribution[5] ?? 0)
    ];

    ratingChart.data.datasets[0].data = values;
    
    const maxValue = Math.max(...values);
    ratingChart.options.scales.y.suggestedMax = maxValue > 0 ? maxValue + 2 : 5;

    ratingChart.update();
}

/**
 * Update Trend Charts
 */
function updateTrendChart(timestamps) {
    if (!trendChart || !trendChart.data) {
        initTrendChart();
    }

    if (!trendChart) return;

    if (!timestamps || timestamps.length === 0) {
        console.warn("No timeline data available");
        trendChart.data.labels = [];
        trendChart.data.datasets[0].data = [];
        trendChart.update();
        return;
    }

    const grouped = {};

    timestamps.forEach(ts => {
        const parsed = new Date(ts);
        if (isNaN(parsed)) return;   // skip timestamps the browser can't parse
        const dateKey = parsed.toLocaleDateString();
        grouped[dateKey] = (grouped[dateKey] || 0) + 1;
    });

    const labels = Object.keys(grouped).sort((a, b) => new Date(a) - new Date(b));
    const values = labels.map(l => grouped[l]);

    trendChart.data.labels = labels;
    trendChart.data.datasets[0].data = values;

    trendChart.update();
} 

/**
 * Update Sentiment Chart
 */
function updateSentimentChart(sentiment) {
    if (!sentimentChart || !sentimentChart.data) {
        initSentimentChart();
    }

    if (!sentimentChart || !sentimentChart.data) return;

    const values = [
        Number(sentiment?.positive) || 0,
        Number(sentiment?.neutral) || 0,
        Number(sentiment?.negative) || 0,
    ];

    sentimentChart.data.datasets[0].data = values;
    sentimentChart.update();
}

/**
 * Destroy Charts
 */
function destroyAllCharts() {
    if (distributionChart && typeof distributionChart.destroy === "function") {
        distributionChart.destroy();
        distributionChart = null;
    }

    if (ratingChart && typeof ratingChart.destroy === "function") {
        ratingChart.destroy();
        ratingChart = null;
    }

    if (trendChart && typeof trendChart.destroy === "function") {
        trendChart.destroy();
        trendChart = null;
    }

    if (sentimentChart && typeof sentimentChart.destroy === "function") {
        sentimentChart.destroy();
        sentimentChart = null;
    }
}

// Expose globally
window.initializeCharts = initializeCharts;
window.updateDistributionChart = updateDistributionChart;
window.updateRatingChart = updateRatingChart;
window.updateTrendChart = updateTrendChart;
window.updateSentimentChart = updateSentimentChart;
window.destroyAllCharts = destroyAllCharts;

