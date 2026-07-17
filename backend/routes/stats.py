from flask import Blueprint, request, jsonify, g
from utils.decorators import login_required
from services.stats_service import StatsService

stats_bp = Blueprint("stats", __name__)


def _q():
    return {k: (v if not isinstance(v, list) else v[-1]) for k, v in (request.args.to_dict(flat=False) or {}).items()}


@stats_bp.get("/summary")
@login_required
def summary():
    return jsonify(StatsService.summary(g.current_user))


@stats_bp.get("/trend")
@login_required
def trend():
    return jsonify(StatsService.trend_12m(g.current_user))


@stats_bp.get("/pie")
@login_required
def pie():
    scope = _q().get("scope") or _q().get("months") or 12
    return jsonify(StatsService.category_pie(g.current_user, scope))


@stats_bp.get("/compare")
@login_required
def compare():
    scope = _q().get("scope") or _q().get("months") or 12
    return jsonify(StatsService.category_compare(g.current_user, scope))
