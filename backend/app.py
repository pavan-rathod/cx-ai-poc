"""Customer Sentiment Insights & Proactive Repair - Flask backend.

Run from the backend folder:   python app.py
Then open:                     http://localhost:5000
(The same server also serves the ../frontend folder.)
"""
import logging
import os
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, abort, jsonify, request, send_from_directory
from flask_cors import CORS

BASE_DIR = Path(__file__).resolve().parent
FRONTEND_DIR = BASE_DIR.parent / "frontend"

load_dotenv(BASE_DIR / ".env")

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger(__name__)

app = Flask(__name__, static_folder=None)
app.config["MAX_CONTENT_LENGTH"] = 16 * 1024 * 1024  # 16 MB uploads

# CORS is only needed if the frontend is served from somewhere other than
# this Flask app (e.g. VS Code Live Server or `python -m http.server 8000`).
DEFAULT_ORIGINS = (
    "http://localhost:5000,http://127.0.0.1:5000,"
    "http://localhost:8000,http://127.0.0.1:8000,"
    "http://localhost:5500,http://127.0.0.1:5500"
)
origins = [o.strip() for o in os.getenv("CORS_ORIGINS", DEFAULT_ORIGINS).split(",") if o.strip()]
CORS(app, resources={r"/api/*": {
    "origins": origins,
    "methods": ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    "allow_headers": ["Content-Type"],
}})

# Blueprints (imported after app creation; they only hold in-memory state)
from routes.csv_routes import csv_bp
from routes.data_routes import data_bp
from routes.scraping_routes import scraping_bp
from routes.trustpilot_routes import trustpilot_bp
from routes.workflow_routes import workflow_bp

app.register_blueprint(csv_bp, url_prefix="/api/csv")
app.register_blueprint(trustpilot_bp, url_prefix="/api/trustpilot")
app.register_blueprint(scraping_bp, url_prefix="/api/scrape")
app.register_blueprint(data_bp, url_prefix="/api/data")
app.register_blueprint(workflow_bp, url_prefix="/api/workflows")


@app.route("/api/health", methods=["GET"])
def health_check():
    return jsonify({
        "status": "ok",
        "message": "Customer feedback backend is running",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }), 200


# ---- Serve the frontend from the same origin (no CORS / file:// problems) ----
@app.route("/")
def serve_index():
    return send_from_directory(FRONTEND_DIR, "index.html")


@app.route("/<path:filename>")
def serve_static(filename):
    if filename.startswith("api/"):
        abort(404)
    return send_from_directory(FRONTEND_DIR, filename)


@app.errorhandler(404)
def not_found(_error):
    if request.path.startswith("/api/"):
        return jsonify({"status": "error", "error": "Endpoint not found"}), 404
    return "Not found", 404


@app.errorhandler(413)
def too_large(_error):
    return jsonify({"status": "error", "error": "File too large (max 16 MB)"}), 413


@app.errorhandler(500)
def internal_error(error):
    logger.error("Internal server error: %s", error)
    return jsonify({"status": "error", "error": "Internal server error"}), 500


if __name__ == "__main__":
    port = int(os.getenv("PORT", 5000))
    debug = os.getenv("FLASK_DEBUG", "0") == "1"
    app.run(debug=debug, host="0.0.0.0", port=port)
