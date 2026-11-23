import logging
import uuid
from datetime import datetime, timezone

import pandas as pd
from flask import Blueprint, jsonify, request

from helpers import clean_nan
from routes.workflow_routes import trigger_grouped_workflows_for_reviews

csv_bp = Blueprint("csv", __name__)
logger = logging.getLogger(__name__)

# In-memory store: {file_id: {filename, data, row_count, columns, uploaded_at}}
csv_data_store = {}

ALLOWED_EXTENSIONS = {"csv", "xlsx", "xls"}

# (issue_type, keywords, suggestion). First matching rule wins.
ISSUE_RULES = [
    ("speed_issue",
     ["slow", "speed", "bandwidth", "latency", "buffering"],
     "Performance Opportunity: Customer feedback indicates internet speed or performance concerns. "
     "Recommended Action: Run speed diagnostics, review network congestion, and communicate a clear resolution plan."),
    ("support_issue",
     ["support", "customer care", "agent", "response", "helpdesk", "service team", "rude", "unhelpful"],
     "Customer Support Recovery: Feedback indicates a support experience gap. "
     "Recommended Action: Review support interaction history, identify response delays, and initiate customer follow-up."),
    ("billing_issue",
     ["bill", "billing", "payment", "charge", "invoice", "refund", "price", "cost"],
     "Billing Experience Review: Feedback suggests a billing or payment concern. "
     "Recommended Action: Validate billing details, explain charges transparently, and resolve payment concerns quickly."),
    ("reliability_issue",
     ["disconnect", "connection", "downtime", "outage", "unstable", "not working", "network issue"],
     "Network Reliability Focus: Customer feedback indicates connection stability concerns. "
     "Recommended Action: Review outage logs, device/router health, and network stability signals."),
    ("setup_issue",
     ["install", "installation", "setup", "technician", "activation", "onboarding"],
     "Installation Experience Recovery: Feedback indicates friction during setup or activation. "
     "Recommended Action: Review installation timeline, technician coordination, and activation quality."),
]

POSITIVE_WORDS = [
    "good", "great", "excellent", "amazing", "happy", "satisfied",
    "fast", "reliable", "helpful", "best", "smooth", "fantastic",
    "love", "perfect", "awesome", "quick", "responsive",
]

NEGATIVE_WORDS = [
    "bad", "poor", "slow", "worst", "terrible", "unhappy",
    "disconnect", "disconnected", "issue", "problem", "delay",
    "late", "rude", "unhelpful", "expensive", "billing", "refund",
    "complaint", "not working", "failed", "failure", "downtime",
    "unstable", "outage",
]


def allowed_file(filename):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS


def get_column_value(row, possible_columns):
    """Case-insensitive lookup of the first matching column name."""
    lower_map = {str(k).strip().lower(): k for k in row.keys()}
    for col in possible_columns:
        key = lower_map.get(col.strip().lower())
        if key is not None:
            return row.get(key)
    return None


def normalize_text(value):
    return "" if value is None else str(value).strip()


def normalize_rating(value):
    try:
        if value is None or value == "":
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def classify_issue_type(text):
    text = normalize_text(text).lower()
    for issue_type, keywords, _ in ISSUE_RULES:
        if any(word in text for word in keywords):
            return issue_type
    return "general_feedback"


def generate_suggestion(text, sentiment):
    text = normalize_text(text).lower()

    for _, keywords, suggestion in ISSUE_RULES:
        if any(word in text for word in keywords):
            return suggestion

    if sentiment == "negative":
        return ("High-Priority Customer Recovery: This review reflects dissatisfaction and potential churn risk. "
                "Recommended Action: Assign ownership, contact the customer proactively, and provide a clear resolution timeline.")
    if sentiment == "neutral":
        return ("Customer Experience Enhancement: This review reflects an average experience. "
                "Recommended Action: Follow up to identify improvement opportunities and convert the experience into a positive one.")
    return ("Customer Advocacy Opportunity: This review reflects a positive experience. "
            "Recommended Action: Thank the customer and consider requesting a testimonial or referral.")


def analyze_review_sentiment(review_text, rating=None):
    text = normalize_text(review_text).lower()
    rating = normalize_rating(rating)

    score = sum(1 for w in POSITIVE_WORDS if w in text) - sum(1 for w in NEGATIVE_WORDS if w in text)

    if rating is not None:
        if rating >= 4:
            score += 2
        elif rating <= 2:
            score -= 2

    sentiment = "positive" if score > 0 else "negative" if score < 0 else "neutral"
    return {"sentiment": sentiment, "score": score, "suggestion": generate_suggestion(text, sentiment)}


def read_uploaded_file(file, ext):
    if ext == "csv":
        try:
            return pd.read_csv(file)
        except UnicodeDecodeError:
            file.stream.seek(0)
            return pd.read_csv(file, encoding="latin-1")
    return pd.read_excel(file)


@csv_bp.route("/upload", methods=["POST"])
def upload_csv():
    try:
        if "file" not in request.files:
            return jsonify({"error": "No file provided"}), 400

        file = request.files["file"]

        if file.filename == "":
            return jsonify({"error": "Empty filename"}), 400
        if not allowed_file(file.filename):
            return jsonify({"error": "Invalid file format. Allowed: csv, xlsx, xls"}), 400

        ext = file.filename.rsplit(".", 1)[1].lower()

        try:
            df = read_uploaded_file(file, ext)
        except pd.errors.EmptyDataError:
            return jsonify({"error": "The file is empty"}), 400
        except ImportError as exc:  # missing openpyxl / xlrd
            return jsonify({"error": f"Missing dependency for this file type: {exc}"}), 500

        if df.empty:
            return jsonify({"error": "The file has no data rows"}), 400

        df = df.astype(object).where(pd.notnull(df), None)
        uploaded_at = datetime.now(timezone.utc).isoformat()
        processed_data = []

        for row in df.to_dict(orient="records"):
            row = clean_nan(row)

            review_text = get_column_value(row, [
                "Review Text", "review_text", "review", "feedback",
                "comment", "content", "Data_review", "data_review",
            ])
            rating = get_column_value(row, ["Review Rating", "rating", "review_rating", "ReviewRating"])
            timestamp = get_column_value(row, [
                "Review Date (UTC)", "data__review_timestamp", "data_review_timestamp",
                "timestamp", "date", "review_date",
            ])

            analysis = analyze_review_sentiment(review_text, rating)

            row["_review_text"] = normalize_text(review_text)
            row["_rating"] = normalize_rating(rating)
            row["_timestamp"] = timestamp or uploaded_at
            row["_sentiment"] = analysis["sentiment"]
            row["_sentiment_score"] = analysis["score"]
            row["_issue_category"] = classify_issue_type(review_text)
            row["_suggestion"] = analysis["suggestion"]
            processed_data.append(row)

        file_id = str(uuid.uuid4())
        csv_data_store[file_id] = {
            "filename": file.filename,
            "data": processed_data,
            "row_count": len(processed_data),
            "columns": [str(c) for c in df.columns],
            "uploaded_at": uploaded_at,
        }

        triggered = trigger_grouped_workflows_for_reviews(
            processed_reviews=processed_data,
            source_file=file.filename,
        )

        return jsonify(clean_nan({
            "status": "success",
            "message": "Upload successful",
            "file_id": file_id,
            "rows": len(processed_data),
            "columns": csv_data_store[file_id]["columns"],
            "workflow_triggered": len(triggered) > 0,
            "workflow_count": len(triggered),
            "workflows": triggered,
        })), 200

    except Exception as exc:
        logger.exception("CSV upload failed")
        return jsonify({"error": str(exc)}), 500


def iter_csv_rows():
    """Yield copies of every stored CSV row, tagged with source/file info."""
    for file_id, info in csv_data_store.items():
        for row in info["data"]:
            new_row = dict(row)
            new_row["_source"] = "csv"
            new_row["_file"] = info["filename"]
            new_row["_file_id"] = file_id
            yield new_row


@csv_bp.route("/data", methods=["GET"])
def get_csv_data():
    try:
        rows = list(iter_csv_rows())
        return jsonify(clean_nan({"status": "success", "data": rows, "total": len(rows)})), 200
    except Exception as exc:
        logger.exception("Failed to get CSV data")
        return jsonify({"error": str(exc)}), 500


@csv_bp.route("/files", methods=["GET"])
def list_files():
    try:
        files = [{
            "file_id": file_id,
            "filename": info.get("filename"),
            "row_count": info.get("row_count", 0),
            "columns": info.get("columns", []),
            "uploaded_at": info.get("uploaded_at"),
        } for file_id, info in csv_data_store.items()]
        return jsonify(clean_nan({"status": "success", "files": files})), 200
    except Exception as exc:
        logger.exception("Failed to list files")
        return jsonify({"error": str(exc)}), 500


@csv_bp.route("/data/<file_id>", methods=["GET"])
def get_csv_file_data(file_id):
    info = csv_data_store.get(file_id)
    if info is None:
        return jsonify({"error": "File not found"}), 404
    return jsonify(clean_nan({
        "status": "success",
        "filename": info["filename"],
        "data": info["data"],
        "total": info["row_count"],
    })), 200


@csv_bp.route("/data/<file_id>", methods=["DELETE"])
def delete_csv_file(file_id):
    try:
        if file_id not in csv_data_store:
            return jsonify({"error": "File not found"}), 404

        del csv_data_store[file_id]
        return jsonify({"status": "success", "message": "File deleted successfully", "file_id": file_id}), 200
    except Exception as exc:
        logger.exception("Failed to delete file")
        return jsonify({"error": str(exc)}), 500
