import os
import sys
import logging
import traceback
import uuid
from datetime import datetime
from pathlib import Path

from flask import Flask, jsonify, request, send_file
from flask_cors import CORS

import config  # noqa: E402  需要在 system_health 之前可用
from config import CORS_ORIGINS, JWT_SECRET, APP_VERSION, LOG_DIR

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"

from init_db import ensure_db_initialized

_db_initialized = False

def ensure_db_lazy():
    global _db_initialized
    if not _db_initialized:
        try:
            ensure_db_initialized()
            _db_initialized = True
        except Exception as e:
            import logging
            logging.getLogger("app").error(f"Database init failed: {e}")
            raise

app = Flask(__name__, static_folder=None)
app.config["JWT_SECRET"] = JWT_SECRET
app.config["JSON_AS_ASCII"] = False
app.config["MAX_CONTENT_LENGTH"] = 32 * 1024 * 1024  # 32MB

if CORS_ORIGINS and CORS_ORIGINS != ["*"]:
    CORS(app, resources={r"/api/*": {"origins": CORS_ORIGINS}}, supports_credentials=True)
else:
    CORS(app, resources={r"/api/*": {"origins": "*"}}, supports_credentials=True)

IS_CF = any(
    k in os.environ for k in ("CF_PAGES", "CF_WORKER", "CLOUDFLARE_WORKER", "CF_PAGES_COMMIT_SHA")
) or os.environ.get("WORKER_RUNTIME", "") == "cloudflare"

try:
    if not IS_CF:
        os.makedirs(LOG_DIR, exist_ok=True)
except Exception:
    pass

today_str = datetime.now().strftime("%Y%m%d")
logger = logging.getLogger("app")
logger.setLevel(logging.INFO)
if not logger.handlers:
    if not IS_CF:
        try:
            log_path = Path(LOG_DIR) / f"app-{today_str}.log"
            file_handler = logging.FileHandler(str(log_path), encoding="utf-8")
            file_handler.setLevel(logging.INFO)
            file_handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s | %(message)s"))
            logger.addHandler(file_handler)
        except Exception:
            pass
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(logging.INFO)
    console_handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s | %(message)s"))
    logger.addHandler(console_handler)
app.logger.handlers = logger.handlers
app.logger.setLevel(logging.INFO)

from routes.auth import auth_bp
from routes.dashboard import dashboard_bp

app.register_blueprint(auth_bp, url_prefix="/api/auth")
app.register_blueprint(auth_bp, name="auth_user", url_prefix="/api/user")
app.register_blueprint(dashboard_bp, url_prefix="/api/dashboard")

try:
    from routes.admin import admin_bp
    app.register_blueprint(admin_bp, url_prefix="/api/admin")
except Exception as e:
    app.logger.warning(f"Skip blueprint: routes.admin: {e}")

try:
    from routes.transactions import transactions_bp  # noqa: F811
    app.register_blueprint(transactions_bp, url_prefix="/api/transactions")
except Exception as e:
    app.logger.warning(f"Skip blueprint: routes.transactions: {e}")

try:
    from routes.reminders import reminders_bp
    app.register_blueprint(reminders_bp, url_prefix="/api/reminders")
except Exception as e:
    app.logger.warning(f"Skip blueprint: routes.reminders: {e}")

try:
    from routes.stats import stats_bp
    app.register_blueprint(stats_bp, url_prefix="/api/stats")
except Exception as e:
    app.logger.warning(f"Skip blueprint: routes.stats: {e}")

try:
    from routes.io import io_bp
    app.register_blueprint(io_bp, url_prefix="/api/io")
except Exception as e:
    app.logger.warning(f"Skip blueprint: routes.io: {e}")

try:
    from routes.system import system_bp
    app.register_blueprint(system_bp, url_prefix="/api/system-mgmt")
except Exception:
    pass


@app.before_request
def _before_request():
    if request.path.startswith("/api/"):
        ensure_db_lazy()


@app.get("/api/system/health")
def system_health():
    try:
        ensure_db_lazy()
        from db import get_adapter
        adapter = get_adapter()
        db_ok = True
    except Exception as e:
        db_ok = False
        db_error = str(e)[:100]
    
    return jsonify(
        {
            "code": 0,
            "msg": "ok",
            "data": {
                "db_exists": db_ok,
                "db_error": "" if db_ok else db_error,
                "version": APP_VERSION,
                "db_adapter": config.DB_ADAPTER,
                "time": datetime.now().isoformat(timespec="seconds"),
            },
        }
    )


@app.get("/api/system/constants")
def system_constants():
    import config as cfg
    return jsonify(
        {
            "code": 0,
            "msg": "ok",
            "data": {
                "system_categories": cfg.SYSTEM_CATEGORIES,
                "smart_tags": cfg.SMART_TAGS,
                "reminder_statuses": cfg.REMINDER_STATUSES,
                "renew_modes": cfg.RENEW_MODES,
                "version": APP_VERSION,
            },
        }
    )


@app.get("/api/system/announcements")
def public_announcements():
    """公共接口：用户/登录页/首页顶部展示公告；无需登录。只返回当前生效中、未删除的。"""
    from db import get_adapter
    try:
        limit = max(1, min(50, int(request.args.get("limit", 8) or 8)))
    except Exception:
        limit = 8
    raw_list = get_adapter().list_public_announcements(limit=limit)
    safe = []
    for r in raw_list or []:
        if not isinstance(r, dict):
            continue
        r["is_pinned"] = bool(int(r.get("is_pinned") or 0))
        r["priority"] = int(r.get("priority") or 0)
        safe.append(r)
    return jsonify({"code": 0, "msg": "ok", "data": {"list": safe, "server_time": datetime.now().strftime("%Y-%m-%d %H:%M:%S")}})


@app.route("/")
def _serve_index():
    return send_file(str(FRONTEND_DIR / "index.html"))


@app.route("/<path:filename>")
def _serve_static_file(filename):
    target = (FRONTEND_DIR / filename).resolve()
    if not str(target).startswith(str(FRONTEND_DIR.resolve())):
        return jsonify({"code": 403, "msg": "禁止访问", "data": None}), 403
    if target.is_file():
        return send_file(str(target))
    return jsonify({"code": 404, "msg": "资源不存在", "data": {"path": filename}}), 404


def _now_trace_id() -> str:
    return datetime.now().strftime("%Y%m%d%H%M%S") + "-" + uuid.uuid4().hex[:6]


@app.errorhandler(400)
def _h400(e):
    tid = _now_trace_id()
    logger.warning(f"[400][tid={tid}] {request.method} {request.path} | {str(e)[:200]}")
    return jsonify({"code": 400, "msg": "请求参数不正确", "data": None, "trace_id": tid}), 400


@app.errorhandler(401)
def _h401(e):
    tid = _now_trace_id()
    logger.info(f"[401][tid={tid}] {request.method} {request.path} | {getattr(e, 'description', '')[:200]}")
    return (
        jsonify(
            {
                "code": 401,
                "msg": getattr(e, "description", "请先登录") or "请先登录",
                "data": None,
                "trace_id": tid,
            }
        ),
        401,
    )


@app.errorhandler(403)
def _h403(e):
    tid = _now_trace_id()
    logger.warning(f"[403][tid={tid}] {request.method} {request.path}")
    return jsonify({"code": 403, "msg": "您没有权限执行该操作", "data": None, "trace_id": tid}), 403


@app.errorhandler(404)
def _h404(e):
    return (
        jsonify(
            {
                "code": 404,
                "msg": "资源不存在",
                "data": {"path": request.path},
                "trace_id": _now_trace_id(),
            }
        ),
        404,
    )


@app.errorhandler(500)
def _h500(e):
    tid = _now_trace_id()
    tb = traceback.format_exc(limit=100)
    logger.error(f"[500][tid={tid}] {request.method} {request.path}\n{tb}")
    return (
        jsonify(
            {
                "code": 500,
                "msg": "服务繁忙请稍后重试",
                "data": None,
                "trace_id": tid,
            }
        ),
        500,
    )


@app.errorhandler(Exception)
def _any(e):
    tid = _now_trace_id()
    tb = traceback.format_exc(limit=100)
    logger.error(f"[EXC][tid={tid}] {request.method} {request.path} exc={type(e).__name__}:{e}\n{tb}")
    status = getattr(e, "code", None) if hasattr(e, "code") else None
    if status in (400, 401, 403, 404, 500):
        pass
    return (
        jsonify(
            {
                "code": 500,
                "msg": "服务繁忙请稍后重试",
                "data": None,
                "trace_id": tid,
            }
        ),
        500,
    )


if __name__ == "__main__":
    logger.info(f"[{APP_VERSION}] Start on 0.0.0.0:5000 · DB_ADAPTER={config.DB_ADAPTER}")
    app.run(host="0.0.0.0", port=5000, debug=False, threaded=True)
