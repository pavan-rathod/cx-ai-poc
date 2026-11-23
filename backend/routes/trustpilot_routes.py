import logging
import os
from datetime import datetime, timezone

import requests
from flask import Blueprint, jsonify, request

trustpilot_bp = Blueprint("trustpilot", __name__)
logger = logging.getLogger(__name__)

# Mock reviews used unless real Trustpilot credentials are set in backend/.env
MOCK_REVIEWS = [
    {"id": "review_001", "title": "Excellent ISP Service",
     "content": "Great speeds and reliable connection. Customer service is responsive.",
     "rating": 5, "author": "John D.", "date": "2026-01-15T10:30:00Z", "verified": True},
    {"id": "review_002", "title": "Good but slow setup",
     "content": "Connection is stable but took too long to set up initially",
     "rating": 4, "author": "Sarah M.", "date": "2026-08-15T15:45:00Z", "verified": True},
    {"id": "review_003", "title": "Average Service",
     "content": "Service is average. Nothing special but does the job.",
     "rating": 3, "author": "Mike T.", "date": "2026-07-13T10:30:00Z", "verified": True},
    {"id": "review_004", "title": "Poor customer support",
     "content": "Connection works but support team was unhelpful.",
     "rating": 2, "author": "Lisa K.", "date": "2026-05-12T11:30:00Z", "verified": True},
    {"id": "review_005", "title": "Fantastic experience",
     "content": "Switched from another provider and very happy with the switch!",
     "rating": 5, "author": "Robert H.", "date": "2026-03-11T16:10:00Z", "verified": True},
]


def get_trustpilot_reviews():
    """Return reviews from the Trustpilot API, or mock data if not configured / on error."""
    api_key = os.getenv("TRUSTPILOT_API_KEY")
    business_id = os.getenv("TRUSTPILOT_BUSINESS_ID")
    api_base = os.getenv("TRUSTPILOT_API_BASE_URL", "https://api.trustpilot.com/v1")

    if not api_key or "mock" in api_key.lower() or not business_id or "mock" in business_id.lower():
        return [dict(r) for r in MOCK_REVIEWS]

    try:
        response = requests.get(
            f"{api_base}/business-units/{business_id}/reviews",
            headers={"Authorization": f"Bearer {api_key}"},
            params={"pageSize": 50, "sort": "-createdate"},
            timeout=10,
        )
        response.raise_for_status()

        return [{
            "id": r.get("id"),
            "title": r.get("title"),
            "content": r.get("content"),
            "rating": r.get("rating"),
            "author": (r.get("reviewer") or {}).get("name", "Anonymous"),
            "date": r.get("createdAt"),
            "verified": r.get("verifiedBuyerBadge", False),
        } for r in response.json().get("reviews", [])]
    except Exception as exc:
        logger.warning("Trustpilot API failed, using mock data: %s", exc)
        return [dict(r) for r in MOCK_REVIEWS]


def tag(review):
    review = dict(review)
    review["_source"] = "trustpilot"
    review["_timestamp"] = review.get("date") or datetime.now(timezone.utc).isoformat()
    return review


@trustpilot_bp.route("/reviews", methods=["GET"])
def get_reviews():
    try:
        reviews = [tag(r) for r in get_trustpilot_reviews()]
        return jsonify({"status": "success", "reviews": reviews, "count": len(reviews)}), 200
    except Exception as exc:
        logger.error("Error getting reviews: %s", exc)
        return jsonify({"error": str(exc)}), 500


@trustpilot_bp.route("/stats", methods=["GET"])
def get_stats():
    try:
        reviews = get_trustpilot_reviews()
        ratings = [r["rating"] for r in reviews if r.get("rating") is not None]

        distribution = {i: 0 for i in range(1, 6)}
        for rating in ratings:
            if rating in distribution:
                distribution[rating] += 1

        return jsonify({
            "status": "success",
            "total_reviews": len(reviews),
            "average_rating": round(sum(ratings) / len(ratings), 2) if ratings else 0,
            "distribution": distribution,
            "verified_count": sum(1 for r in reviews if r.get("verified")),
        }), 200
    except Exception as exc:
        logger.error("Error getting stats: %s", exc)
        return jsonify({"error": str(exc)}), 500


@trustpilot_bp.route("/search", methods=["GET"])
def search_reviews():
    try:
        query = request.args.get("query", "").strip().lower()
        if not query:
            return jsonify({"error": "Query parameter required"}), 400

        results = [
            tag(r) for r in get_trustpilot_reviews()
            if query in (r.get("title") or "").lower()
            or query in (r.get("content") or "").lower()
            or query in (r.get("author") or "").lower()
        ]
        return jsonify({"status": "success", "query": query, "results": results, "count": len(results)}), 200
    except Exception as exc:
        logger.error("Error searching reviews: %s", exc)
        return jsonify({"error": str(exc)}), 500


@trustpilot_bp.route("/by-rating/<int:rating>", methods=["GET"])
def get_by_rating(rating):
    try:
        if rating < 1 or rating > 5:
            return jsonify({"error": "Rating must be between 1 and 5"}), 400

        filtered = [tag(r) for r in get_trustpilot_reviews() if r.get("rating") == rating]
        return jsonify({"status": "success", "rating": rating, "reviews": filtered, "count": len(filtered)}), 200
    except Exception as exc:
        logger.error("Error filtering by rating: %s", exc)
        return jsonify({"error": str(exc)}), 500
