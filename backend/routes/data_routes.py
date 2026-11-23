import logging
from datetime import datetime, timezone

from flask import Blueprint, jsonify, request

from helpers import clean_nan
from routes.csv_routes import csv_data_store, iter_csv_rows
from routes.scraping_routes import scraping_results
from routes.trustpilot_routes import get_trustpilot_reviews
from routes.workflow_routes import build_workflow_summary

data_bp = Blueprint("data", __name__)
logger = logging.getLogger(__name__)

VALID_SOURCES = ("csv", "trustpilot", "scraping")


def now_iso():
    return datetime.now(timezone.utc).isoformat()


# ----- Row builders: always return copies, never the stored dicts -----
def csv_rows():
    rows = []
    for row in iter_csv_rows():
        row["_timestamp"] = row.get("_timestamp") or now_iso()
        rows.append(row)
    return rows


def trustpilot_rows():
    try:
        reviews = get_trustpilot_reviews()
    except Exception as exc:
        logger.warning("Error getting Trustpilot data: %s", exc)
        return []

    rows = []
    for review in reviews:
        row = dict(review)
        row["_source"] = "trustpilot"
        row["_timestamp"] = review.get("date") or now_iso()
        rows.append(row)
    return rows


def scraping_rows():
    rows = []
    for result_id, result in scraping_results.items():
        row = dict(result)
        row["_source"] = "scraping"
        row["_result_id"] = result_id
        row["_timestamp"] = result.get("scraped_at") or now_iso()
        rows.append(row)
    return rows


ROW_BUILDERS = {"csv": csv_rows, "trustpilot": trustpilot_rows, "scraping": scraping_rows}


def all_rows(source=None):
    sources = [source] if source else VALID_SOURCES
    rows = []
    for name in sources:
        rows.extend(ROW_BUILDERS[name]())
    return rows


# ----- Analytics helpers (computed from uploaded CSV rows) -----
def build_rating_distribution(rows):
    distribution = {"1": 0, "2": 0, "3": 0, "4": 0, "5": 0}
    for row in rows:
        rating = row.get("_rating")
        try:
            if rating is None or rating == "":
                continue
            bucket = min(max(int(round(float(rating))), 1), 5)
            distribution[str(bucket)] += 1
        except (TypeError, ValueError):
            continue
    return distribution


def build_sentiment_summary(rows):
    summary = {"positive": 0, "neutral": 0, "negative": 0}
    for row in rows:
        if row.get("_sentiment") in summary:
            summary[row["_sentiment"]] += 1
    return summary


def build_issue_summary(rows):
    issues = {}
    for row in rows:
        issue = row.get("_issue_category")
        if issue:
            issues[issue] = issues.get(issue, 0) + 1
    return issues


def build_top_suggestions(rows, limit=5):
    counts = {}
    for row in rows:
        suggestion = row.get("_suggestion")
        if suggestion:
            counts[suggestion] = counts.get(suggestion, 0) + 1

    ranked = sorted(counts.items(), key=lambda item: item[1], reverse=True)[:limit]
    return [{"suggestion": s, "count": c} for s, c in ranked]


# ----- Endpoints -----
@data_bp.route("/aggregate", methods=["GET"])
def get_aggregated_data():
    try:
        csv_part, tp_part, scrape_part = csv_rows(), trustpilot_rows(), scraping_rows()
        data = csv_part + tp_part + scrape_part

        return jsonify(clean_nan({
            "status": "success",
            "data": data,
            "total": len(data),
            "sources": {"csv": len(csv_part), "trustpilot": len(tp_part), "scraping": len(scrape_part)},
        })), 200
    except Exception as exc:
        logger.error("Error aggregating data: %s", exc)
        return jsonify({"error": str(exc)}), 500


@data_bp.route("/by-source", methods=["GET"])
def get_by_source():
    try:
        source = request.args.get("source", "").lower()
        if source not in VALID_SOURCES:
            return jsonify({"error": "Invalid source. Use csv, trustpilot, or scraping"}), 400

        data = all_rows(source)
        return jsonify(clean_nan({"status": "success", "source": source, "data": data, "count": len(data)})), 200
    except Exception as exc:
        logger.error("Error getting data by source: %s", exc)
        return jsonify({"error": str(exc)}), 500


@data_bp.route("/recent", methods=["GET"])
def get_recent():
    try:
        limit = max(request.args.get("limit", 100, type=int), 1)
        source = request.args.get("source", "").lower() or None
        if source and source not in VALID_SOURCES:
            return jsonify({"error": "Invalid source. Use csv, trustpilot, or scraping"}), 400

        rows = all_rows(source)
        recent = rows[-limit:]

        return jsonify(clean_nan({
            "status": "success",
            "data": recent,
            "count": len(recent),
            "total_available": len(rows),
            "limit": limit,
        })), 200
    except Exception as exc:
        logger.error("Error getting recent data: %s", exc)
        return jsonify({"error": str(exc)}), 500


@data_bp.route("/stats", methods=["GET"])
def get_stats():
    try:
        csv_part = csv_rows()
        trustpilot_reviews = trustpilot_rows()
        ratings = [r["rating"] for r in trustpilot_reviews if r.get("rating") is not None]

        stats = {
            "csv": {
                "files": len(csv_data_store),
                "rows": len(csv_part),
                "columns": sorted({col for f in csv_data_store.values() for col in f.get("columns", [])}),
            },
            "trustpilot": {
                "reviews": len(trustpilot_reviews),
                "average_rating": round(sum(ratings) / len(ratings), 2) if ratings else 0,
            },
            "scraping": {
                "results": len(scraping_results),
                "urls": len({r.get("url") for r in scraping_results.values() if r.get("url")}),
            },
        }

        return jsonify(clean_nan({
            "status": "success",
            "stats": stats,
            "sources": {
                "csv": len(csv_part),
                "trustpilot": len(trustpilot_reviews),
                "scraping": len(scraping_results),
            },
            "sentiment": build_sentiment_summary(csv_part),
            "issues": build_issue_summary(csv_part),
            "suggestions": build_top_suggestions(csv_part),
            "rating_distribution": build_rating_distribution(csv_part),
            "workflows": build_workflow_summary(),
        })), 200
    except Exception as exc:
        logger.error("Error getting stats: %s", exc)
        return jsonify({"error": str(exc)}), 500


@data_bp.route("/search", methods=["GET"])
def search_data():
    try:
        query = request.args.get("query", "").strip().lower()
        if not query:
            return jsonify({"error": "Query parameter required"}), 400

        results = []
        for row in all_rows():
            haystack = [v for v in row.values() if isinstance(v, str)]
            haystack += [v for v in (row.get("extracted") or {}).values() if isinstance(v, str)]
            if any(query in text.lower() for text in haystack):
                results.append(row)

        return jsonify(clean_nan({"status": "success", "query": query, "results": results, "count": len(results)})), 200
    except Exception as exc:
        logger.error("Error searching data: %s", exc)
        return jsonify({"error": str(exc)}), 500
