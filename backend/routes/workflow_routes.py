import logging
import os
import uuid
from datetime import datetime, timezone

import requests
from flask import Blueprint, jsonify, request

from helpers import clean_nan

workflow_bp = Blueprint("workflows", __name__)
logger = logging.getLogger(__name__)

# In-memory workflow store (resets when the server restarts)
workflow_events = []

ACTIVE_WORKFLOW_ISSUES = {
    "speed_issue",
    "support_issue",
    "billing_issue",
    "reliability_issue",
    "setup_issue",
}

DEFAULT_WORKFLOW = {
    "workflow_name": "General Proactive Repair Workflow",
    "priority": "medium",
    "recommended_action": "Review affected customer feedback and initiate operational follow-up.",
}

WORKFLOW_CONFIG = {
    "speed_issue": {
        "workflow_name": "Speed Performance Troubleshooting Workflow",
        "priority": "high",
        "recommended_action": (
            "Initiate proactive speed diagnostics, verify bandwidth utilization, "
            "check area-level congestion, and prepare customer communication."
        ),
    },
    "support_issue": {
        "workflow_name": "Customer Support Recovery Workflow",
        "priority": "high",
        "recommended_action": (
            "Review support interaction history, identify response gaps, assign follow-up "
            "ownership, and initiate customer recovery communication."
        ),
    },
    "billing_issue": {
        "workflow_name": "Billing Investigation Workflow",
        "priority": "medium",
        "recommended_action": (
            "Validate invoice/payment details, review disputed charges, prepare billing "
            "clarification, and initiate customer follow-up."
        ),
    },
    "reliability_issue": {
        "workflow_name": "Network Stability Repair Workflow",
        "priority": "high",
        "recommended_action": (
            "Check outage history, router/device status, network stability signals, "
            "and initiate reliability diagnostics."
        ),
    },
    "setup_issue": {
        "workflow_name": "Installation Experience Recovery Workflow",
        "priority": "medium",
        "recommended_action": (
            "Review installation timeline, technician coordination, activation status, "
            "and customer onboarding gaps."
        ),
    },
}


def call_external_mock_api(payload):
    """POST the workflow to an external mock API (e.g. Postman Mock Server).

    Only active when WORKFLOW_TRIGGER_MODE=external and EXTERNAL_WORKFLOW_API_URL
    are set in backend/.env. Otherwise the workflow is only stored internally.
    """
    trigger_mode = os.getenv("WORKFLOW_TRIGGER_MODE", "internal").lower()
    external_url = os.getenv("EXTERNAL_WORKFLOW_API_URL", "").strip()

    if trigger_mode != "external" or not external_url:
        return {
            "external_api_enabled": False,
            "external_api_status": "skipped",
            "external_system": "InternalMockWorkflowEngine",
            "message": "External workflow API not configured. Stored internal workflow event.",
        }

    try:
        response = requests.post(external_url, json=clean_nan(payload), timeout=10)

        try:
            response_body = response.json()
        except ValueError:
            response_body = {"raw_response": response.text}

        return {
            "external_api_enabled": True,
            "external_api_status": "success" if response.ok else "failed",
            "http_status": response.status_code,
            "external_system": "PostmanMockRepairAPI",
            "response": response_body,
        }
    except Exception as exc:
        logger.exception("External workflow API call failed")
        return {
            "external_api_enabled": True,
            "external_api_status": "failed",
            "external_system": "PostmanMockRepairAPI",
            "error": str(exc),
        }


def trigger_grouped_repair_workflow(issue_type, affected_reviews, source_file=None, trigger_reason=None):
    """Create one grouped proactive repair workflow for one issue type."""
    config = WORKFLOW_CONFIG.get(issue_type, DEFAULT_WORKFLOW)
    workflow_id = f"wf_{uuid.uuid4().hex[:12]}"

    payload = {
        "workflow_id": workflow_id,
        "workflow_type": "proactive_repair",
        "workflow_name": config["workflow_name"],
        "issue_type": issue_type,
        "priority": config["priority"],
        "affected_review_count": len(affected_reviews),
        "source_file": source_file,
        "trigger_reason": trigger_reason or f"{len(affected_reviews)} negative {issue_type} reviews detected.",
        "recommended_action": config["recommended_action"],
        "created_at": datetime.now(timezone.utc).isoformat(),
        "sample_reviews": affected_reviews[:5],
    }

    workflow_event = {
        **payload,
        "status": "triggered",
        "external_api_result": call_external_mock_api(payload),
    }
    workflow_events.append(workflow_event)

    logger.info("Proactive workflow triggered: %s | issue=%s | affected=%s",
                workflow_id, issue_type, len(affected_reviews))
    return workflow_event


def trigger_grouped_workflows_for_reviews(processed_reviews, source_file=None):
    """Group negative reviews by issue type; trigger one workflow per issue type."""
    grouped = {}

    for row in processed_reviews:
        issue_type = row.get("_issue_category")

        if row.get("_sentiment") != "negative":
            continue
        if issue_type not in ACTIVE_WORKFLOW_ISSUES:
            continue

        grouped.setdefault(issue_type, []).append({
            "review_text": row.get("_review_text"),
            "rating": row.get("_rating"),
            "sentiment": row.get("_sentiment"),
            "issue_category": issue_type,
            "suggestion": row.get("_suggestion"),
            "timestamp": row.get("_timestamp"),
            "author": row.get("Author Name") or row.get("author") or "Unknown",
        })

    return [
        trigger_grouped_repair_workflow(
            issue_type=issue_type,
            affected_reviews=affected,
            source_file=source_file,
            trigger_reason=(
                f"{len(affected)} negative reviews detected for {issue_type} "
                f"in uploaded file {source_file or 'unknown'}."
            ),
        )
        for issue_type, affected in grouped.items()
    ]


def build_workflow_summary():
    """Counts used by both /api/workflows/stats and /api/data/stats."""
    by_issue_type = {}
    external = {"success": 0, "failed": 0, "skipped": 0}

    for wf in workflow_events:
        issue = wf.get("issue_type", "unknown")
        by_issue_type[issue] = by_issue_type.get(issue, 0) + 1

        status = (wf.get("external_api_result") or {}).get("external_api_status")
        if status in external:
            external[status] += 1

    return {
        "total": len(workflow_events),
        "triggered": sum(1 for wf in workflow_events if wf.get("status") == "triggered"),
        "by_issue_type": by_issue_type,
        "external_success": external["success"],
        "external_failed": external["failed"],
        "external_skipped": external["skipped"],
    }


@workflow_bp.route("/trigger", methods=["POST"])
def trigger_workflow():
    """Manual/API workflow trigger."""
    try:
        data = request.get_json(silent=True) or {}
        workflow = trigger_grouped_repair_workflow(
            issue_type=data.get("issue_type", "speed_issue"),
            affected_reviews=data.get("affected_reviews", []),
            source_file=data.get("source_file"),
            trigger_reason=data.get("trigger_reason"),
        )
        return jsonify(clean_nan({
            "status": "success",
            "message": "Workflow triggered successfully",
            "workflow": workflow,
        })), 200
    except Exception as exc:
        logger.exception("Failed to trigger workflow")
        return jsonify({"error": str(exc)}), 500


@workflow_bp.route("/history", methods=["GET"])
def get_workflow_history():
    try:
        limit = max(request.args.get("limit", 50, type=int), 1)
        return jsonify(clean_nan({
            "status": "success",
            "history": workflow_events[-limit:],
            "total": len(workflow_events),
        })), 200
    except Exception as exc:
        logger.exception("Failed to get workflow history")
        return jsonify({"error": str(exc)}), 500


@workflow_bp.route("/stats", methods=["GET"])
def get_workflow_stats():
    try:
        return jsonify({"status": "success", "workflows": build_workflow_summary()}), 200
    except Exception as exc:
        logger.exception("Failed to get workflow stats")
        return jsonify({"error": str(exc)}), 500
