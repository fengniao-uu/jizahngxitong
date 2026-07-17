from flask import Blueprint, request, jsonify, g
from utils.decorators import login_required
from services.stats_service import StatsService

dashboard_bp = Blueprint("dashboard", __name__)


def _q():
    return {k: (v if not isinstance(v, list) else v[-1]) for k, v in (request.args.to_dict(flat=False) or {}).items()}


@dashboard_bp.get("/summary")
@login_required
def summary():
    return jsonify(StatsService.dashboard_summary(g.current_user))


@dashboard_bp.get("/recent")
@login_required
def recent():
    limit = _q().get("limit") or 5
    return jsonify(StatsService.dashboard_recent(g.current_user, limit))
