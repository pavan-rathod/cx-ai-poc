import logging
import os
import uuid
from datetime import datetime, timezone

import requests
from bs4 import BeautifulSoup
from flask import Blueprint, jsonify, request

scraping_bp = Blueprint("scraping", __name__)
logger = logging.getLogger(__name__)

# In-memory store: {result_id: {url, status_code, scraped_at, extracted}}
scraping_results = {}

REQUEST_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
}


def new_result_id():
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    return f"scrape_{stamp}_{uuid.uuid4().hex[:6]}"


def is_http_url(url):
    return isinstance(url, str) and url.startswith(("http://", "https://"))


def scraping_is_enabled():
    """Allow deployments to disable user-controlled URL fetching."""
    return os.getenv("ENABLE_WEB_SCRAPING", "true").strip().lower() in {"1", "true", "yes", "on"}


def scrape(url, selectors):
    """Fetch one URL, extract data, store it, and return (result_id, data)."""
    response = requests.get(url, headers=REQUEST_HEADERS, timeout=10)
    response.raise_for_status()

    soup = BeautifulSoup(response.content, "html.parser")
    extracted = {}

    if selectors:
        for key, selector in selectors.items():
            try:
                element = soup.select_one(selector)
                extracted[key] = element.get_text(strip=True) if element else None
            except Exception as exc:  # invalid CSS selector
                logger.warning("Error extracting %s: %s", key, exc)
                extracted[key] = None
    else:
        extracted["text"] = soup.get_text(separator=" ", strip=True)[:1000]

    data = {
        "url": url,
        "status_code": response.status_code,
        "scraped_at": datetime.now(timezone.utc).isoformat(),
        "extracted": extracted,
    }
    result_id = new_result_id()
    scraping_results[result_id] = data
    return result_id, data


def error_response(exc):
    if isinstance(exc, requests.exceptions.Timeout):
        return jsonify({"error": "Request timed out"}), 408
    if isinstance(exc, requests.exceptions.ConnectionError):
        return jsonify({"error": "Could not connect to that URL"}), 503
    if isinstance(exc, requests.exceptions.HTTPError):
        return jsonify({"error": f"Target site returned an error: {exc}"}), 502
    logger.error("Scraping error: %s", exc)
    return jsonify({"error": str(exc)}), 500


@scraping_bp.route("", methods=["POST"])
def scrape_url():
    if not scraping_is_enabled():
        return jsonify({"error": "URL scraping is disabled on this deployment"}), 403
    try:
        body = request.get_json(silent=True)
        if not body or "url" not in body:
            return jsonify({"error": "URL required"}), 400

        url = (body.get("url") or "").strip()
        if not is_http_url(url):
            return jsonify({"error": "Invalid URL (must start with http:// or https://)"}), 400

        result_id, data = scrape(url, body.get("selectors") or {})
        logger.info("Scraped %s", url)
        return jsonify({"status": "success", "result_id": result_id, "url": url, "data": data}), 200
    except Exception as exc:
        return error_response(exc)


@scraping_bp.route("/batch", methods=["POST"])
def scrape_batch():
    if not scraping_is_enabled():
        return jsonify({"error": "URL scraping is disabled on this deployment"}), 403
    try:
        body = request.get_json(silent=True)
        if not body or "urls" not in body:
            return jsonify({"error": "URLs list required"}), 400

        urls = body.get("urls")
        if not isinstance(urls, list):
            return jsonify({"error": "URLs must be a list"}), 400

        selectors = body.get("selectors") or {}
        results = []

        for url in urls:
            if not is_http_url(url):
                logger.warning("Invalid URL skipped: %s", url)
                continue
            try:
                result_id, data = scrape(url, selectors)
                results.append({"result_id": result_id, "url": url, "data": data, "success": True})
            except Exception as exc:
                logger.error("Error scraping %s: %s", url, exc)
                results.append({"url": url, "error": str(exc), "success": False})

        return jsonify({
            "status": "success",
            "results": results,
            "total": len(results),
            "successful": sum(1 for r in results if r.get("success")),
        }), 200
    except Exception as exc:
        return error_response(exc)


@scraping_bp.route("/history", methods=["GET"])
def get_history():
    try:
        limit = max(request.args.get("limit", 50, type=int), 1)

        history = [{
            "result_id": result_id,
            "url": result.get("url"),
            "scraped_at": result.get("scraped_at"),
            "extracted_keys": list((result.get("extracted") or {}).keys()),
        } for result_id, result in list(scraping_results.items())[-limit:]]

        return jsonify({"status": "success", "history": history, "total": len(scraping_results)}), 200
    except Exception as exc:
        logger.error("Error getting history: %s", exc)
        return jsonify({"error": str(exc)}), 500


@scraping_bp.route("/<result_id>", methods=["GET"])
def get_result(result_id):
    result = scraping_results.get(result_id)
    if result is None:
        return jsonify({"error": "Result not found"}), 404
    return jsonify({"status": "success", "result_id": result_id, "data": result}), 200


@scraping_bp.route("/<result_id>", methods=["DELETE"])
def delete_result(result_id):
    result = scraping_results.pop(result_id, None)
    if result is None:
        return jsonify({"error": "Result not found"}), 404

    logger.info("Deleted scraping result: %s", result_id)
    return jsonify({"status": "success", "message": f"Result for {result.get('url')} deleted"}), 200
