from flask import Blueprint, request, jsonify, g
import datetime as dt
import time as _time
from collections import defaultdict, deque
import threading as _th

import config
from utils.decorators import login_required
from services.auth_service import AuthService
from utils.captcha_helper import generate_captcha, is_captcha_disabled
from db import get_adapter

auth_bp = Blueprint("auth", __name__)

# ============== 接口限流（内存级，单进程多线程安全；分布式部署可换 Redis =====================
_RL_LOCK = _th.Lock()
_RL_WINDOWS: dict = {}


def _rate_limit_check(tag: str, ip: str, max_per_minute: int) -> tuple:
    """滑动窗口限流：返回 (通过:bool, 剩余次数:int, 重置秒:int)"""
    now = _time.monotonic()
    window = 60.0
    key = f"{tag}|{ip}"
    with _RL_LOCK:
        dq = _RL_WINDOWS.get(key)
        if dq is None:
            dq = deque()
            _RL_WINDOWS[key] = dq
        # 清掉 60 秒外的
        while dq and dq[0] <= now - window:
            dq.popleft()
        remain = max_per_minute - len(dq)
        reset_sec = int(max(0.0, (dq[0] + window) - now)) if dq else 0
        if remain <= 0:
            return False, 0, reset_sec
        dq.append(now)
        # 超 2 万条旧记录清理（防内存泄漏）
        if len(_RL_WINDOWS) > 20000:
            oldest_k = None
            oldest_t = now
            for k, q in _RL_WINDOWS.items():
                while q and q[0] <= now - window:
                    q.popleft()
                if not q:
                    oldest_k = k
                    break
                if q[0] < oldest_t:
                    oldest_t = q[0]
                    oldest_k = k
            if oldest_k and oldest_k in _RL_WINDOWS:
                        _RL_WINDOWS.pop(oldest_k, None)
        return True, remain - 1, reset_sec


def _remote_ip() -> str:
    xff = request.headers.get("X-Forwarded-For", "")
    if xff:
        return xff.split(",", 1)[0].strip() or (request.remote_addr or "")
    return request.remote_addr or ""


def _ua() -> str:
    return (request.headers.get("User-Agent") or "")[:512]


def _json() -> dict:
    return request.get_json(force=True, silent=True) or {}


@auth_bp.get("/captcha")
def captcha_new():
    ip = _remote_ip()
    ok, remain, reset_s = _rate_limit_check("captcha", ip, config.RATE_LIMIT_CAPTCHA_PER_MIN)
    if not ok:
        return jsonify({"code": 429, "msg": f"验证码获取太频繁，请 {reset_s} 秒后再试", "data": {"retry_after": reset_s, "limit": config.RATE_LIMIT_CAPTCHA_PER_MIN}}), 429
    captcha_disabled = is_captcha_disabled()
    try:
        data = generate_captcha()
    except Exception as e:
        import uuid as _uuid
        import hashlib as _hl
        import datetime as _dt
        data = {
            "captcha_id": _uuid.uuid4().hex,
            "code_hash": _hl.sha256(b"fallback").hexdigest(),
            "salt": "fb",
            "expires_at": (_dt.datetime.utcnow() + _dt.timedelta(seconds=300)).strftime("%Y-%m-%d %H:%M:%S"),
            "image": "",
            "ttl": 300,
            "disabled": captcha_disabled,
        }
    adapter = None
    try:
        adapter = get_adapter()
        adapter.create_captcha(
            captcha_id=data["captcha_id"],
            code_hash=data["code_hash"],
            salt=data["salt"],
            expires_at_iso=data["expires_at"],
        )
    except Exception:
        pass
    resp = {
        "code": 0,
        "msg": "ok",
        "data": {
            "captcha_id": data.get("captcha_id") or "",
            "image": data.get("image") or "",
            "ttl": int(data.get("ttl") or 300),
            "expires_at": data.get("expires_at") or "",
            "length": 4,
            "rate_limit_remain": remain,
            "disabled": bool(data.get("disabled", captcha_disabled)),
        },
    }
    return jsonify(resp)


@auth_bp.post("/register")
def register():
    r = _json()
    result = AuthService.register(
        r.get("account_no"),
        r.get("password"),
        nickname=r.get("nickname") or r.get("name") or "",
        ip=_remote_ip(),
        ua=_ua(),
    )
    if isinstance(result, tuple):
        body, code = result
        return jsonify(body), code
    return jsonify(result)


@auth_bp.post("/login")
def login():
    ip = _remote_ip()
    ua = _ua()
    ok, remain, reset_s = _rate_limit_check("login", ip, config.RATE_LIMIT_LOGIN_PER_MIN)
    if not ok:
        try:
            get_adapter().insert_session_log(
                user_id=0, jti="", ip=ip, ua=ua,
                is_success=False, fail_reason="rate_limited_login", attempt_account="",
            )
        except Exception:
            pass
        return jsonify({"code": 429, "msg": f"登录请求过于频繁，请 {reset_s} 秒后再试", "data": {"retry_after": reset_s, "limit": config.RATE_LIMIT_LOGIN_PER_MIN}}), 429
    r = _json()
    account_no = r.get("account_no") or r.get("username")
    password = r.get("password")
    captcha_id = (r.get("captcha_id") or r.get("captchaId") or "").strip()
    captcha_code = (r.get("captcha_code") or r.get("captchaCode") or r.get("verify_code") or "").strip()
    adapter = get_adapter()
    attempt_acc = (str(account_no).strip() if account_no else "")[:6]
    captcha_disabled = is_captcha_disabled()
    if not captcha_disabled:
        if not captcha_id or not captcha_code:
            try:
                adapter.insert_session_log(
                    user_id=0, jti="", ip=ip, ua=ua,
                    is_success=False, fail_reason="captcha_missing", attempt_account=attempt_acc,
                )
            except Exception:
                pass
            return jsonify({"code": 400, "msg": "请输入验证码", "data": None}), 400
        now_iso = dt.datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
        try:
            vc = adapter.verify_and_consume_captcha(captcha_id, captcha_code.upper(), now_iso)
        except Exception as _e:
            vc = 0
        if vc == 1:
            try:
                adapter.insert_session_log(
                    user_id=0, jti="", ip=ip, ua=ua,
                    is_success=False, fail_reason="captcha_expired", attempt_account=attempt_acc,
                )
            except Exception:
                pass
            return jsonify({"code": 400, "msg": "验证码已过期或已使用，请刷新验证码", "data": None}), 400
        if vc == 2:
            try:
                if attempt_acc:
                    u = adapter.get_user_by_account(attempt_acc)
                    if u:
                        adapter.increment_login_failure(user_id=int(u["id"]))
            except Exception:
                pass
            try:
                adapter.insert_session_log(
                    user_id=0, jti="", ip=ip, ua=ua,
                    is_success=False, fail_reason="captcha_wrong", attempt_account=attempt_acc,
                )
            except Exception:
                pass
            return jsonify({"code": 400, "msg": "验证码错误", "data": None}), 400
    result = AuthService.login(account_no, password, ip=ip, ua=ua)
    if isinstance(result, tuple):
        body, code = result
        return jsonify(body), code
    return jsonify(result)


@auth_bp.post("/logout")
@login_required
def logout():
    jti = getattr(g, "current_jti", "") or ""
    result = AuthService.logout(jti)
    if isinstance(result, tuple):
        body, code = result
        return jsonify(body), code
    return jsonify(result)


@auth_bp.get("/me")
@login_required
def me():
    user = g.current_user
    return jsonify(AuthService.me(user))


@auth_bp.post("/change-password")
@login_required
def change_password():
    user = g.current_user
    r = _json()
    result = AuthService.change_password(
        user, r.get("old_password"), r.get("new_password")
    )
    if isinstance(result, tuple):
        body, code = result
        return jsonify(body), code
    return jsonify(result)


@auth_bp.post("/cancel-account")
@login_required
def cancel_account():
    user = g.current_user
    r = _json()
    result = AuthService.cancel_account(user, r.get("confirm_password") or r.get("password"))
    if isinstance(result, tuple):
        body, code = result
        return jsonify(body), code
    resp = jsonify(result)
    return resp


@auth_bp.post("/delete-account")
@login_required
def delete_account():
    return cancel_account()


@auth_bp.get("/session-status")
@login_required
def session_status():
    user = g.current_user
    result = AuthService.session_status(user)
    return jsonify(result)
