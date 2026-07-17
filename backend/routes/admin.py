"""
管理员路由（Blueprint: /api/admin 前缀）
- 全部接口强制 @require_admin：token 必须有效 + users.role == ROLE_ADMIN（1）
- 保护：
  1. 禁止删除/降级/禁用最后一个超级管理员
  2. 禁止删除/禁用自己
  3. 所有返回数据不会泄漏 password_hash
  4. 高敏感操作（改角色/删用户/重置密码/禁用用户）会写 session_logs 审计
"""
from __future__ import annotations

from flask import Blueprint, request, jsonify, g
import datetime as dt
from typing import Any, Dict
from werkzeug.security import check_password_hash

import config
from utils.decorators import require_admin
from services.auth_service import AuthService
from db import get_adapter

admin_bp = Blueprint("admin", __name__)

# ============== 辅助函数 ==============
_ADMIN_CACHE_LIMIT = 500


def _json() -> Dict[str, Any]:
    return request.get_json(force=True, silent=True) or {}


def _q(k, default=None):
    v = request.args.get(k)
    if v is None or v == "":
        return default
    return v


def _admin_audit_log(op: str, extra: str = ""):
    """高敏感管理员操作记一条审计（用于溯源）"""
    try:
        uid = int((g.current_user or {}).get("id", 0) or 0)
        jti = str(getattr(g, "current_jti", "") or "")[:36] or None
        ip = str(getattr(g, "current_ip", "") or "")
        ua = str(getattr(g, "current_ua", "") or "")
        acc = str((g.current_user or {}).get("account_no", "") or "")[:6]
        adapter = get_adapter()
        adapter.insert_session_log(
            user_id=uid,
            jti=jti if jti else "",
            ip=ip,
            ua=ua,
            is_success=True,
            fail_reason=("admin_" + str(op))[:40],
            attempt_account=acc,
        )
    except Exception:
        pass


def _rows_to_public_users(rows):
    """把 SQLite 返回的用户行转换成安全字段（剔除 password_hash 等）"""
    safe = []
    for r in rows or []:
        if not isinstance(r, dict):
            continue
        rd = {k: v for k, v in r.items() if k not in {"password_hash"}}
        role_i = int(rd.get("role", 0) or 0)
        rd["role_name"] = getattr(config, "USER_ROLE_NAMES", {}).get(role_i, "普通用户")
        rd["is_locked"] = bool(int(rd.get("is_locked", 0) or 0))
        rd["is_active"] = bool(int(rd.get("is_active", 1) or 0))
        safe.append(rd)
    return safe


# ============== 1. 概览统计 ==============
@admin_bp.get("/overview")
@require_admin
def admin_overview():
    raw = get_adapter().admin_overview_stats() or {}
    data = {
        "total_users": int(raw.get("total_users") or 0),
        "locked_users": int(raw.get("locked_count") or raw.get("locked_users") or 0),
        "admin_users": int(raw.get("admin_count") or raw.get("admin_users") or 0),
        "today_logs": int(raw.get("login_today") or raw.get("new_today") or raw.get("today_logs") or 0),
        "login_today": int(raw.get("login_today") or 0),
        "new_today": int(raw.get("new_today") or 0),
        "ok_logins_7d": int(raw.get("ok_logins_7d") or 0),
        "fail_logins_7d": int(raw.get("fail_logins_7d") or 0),
        "fail_rate_7d": float(raw.get("fail_rate_7d") or 0),
        "top_failed_accounts_24h": raw.get("top_failed_accounts_24h") or [],
        "fail_by_reason_7d": raw.get("fail_by_reason_7d") or [],
    }
    return jsonify({"code": 0, "msg": "ok", "data": data})


# ============== 2. 用户列表（分页+筛选） ==============
@admin_bp.get("/users")
@require_admin
def admin_users_list():
    try:
        page = max(1, int(_q("page", 1) or 1))
    except Exception:
        page = 1
    try:
        page_size = min(500, max(1, int(_q("page_size", 50) or 50)))
    except Exception:
        page_size = 50
    kw = str(_q("keyword", "") or "").strip()
    only_locked = str(_q("only_locked", "0") or "0").lower() in {"1", "true", "yes", "y"}
    only_admin = str(_q("only_admin", "0") or "0").lower() in {"1", "true", "yes", "y"}
    sort = str(_q("sort", "created_at_desc") or "created_at_desc").strip()
    res = get_adapter().admin_list_users(
        page=page, page_size=page_size,
        keyword=kw, only_locked=only_locked, only_admin=only_admin, sort=sort,
    )
    res["list"] = _rows_to_public_users(res.get("list") or [])
    return jsonify({"code": 0, "msg": "ok", "data": res})


# ============== 3. 解锁用户（清零失败计数+清除锁定） ==============
@admin_bp.post("/users/<int:user_id>/unlock")
@require_admin
def admin_unlock_user(user_id: int):
    rows = get_adapter().admin_unlock_user(int(user_id))
    if rows <= 0:
        return jsonify({"code": 404, "msg": "目标用户不存在", "data": None}), 404
    _admin_audit_log("unlock", f"target_uid={user_id}")
    return jsonify({"code": 0, "msg": f"用户 #{user_id} 已解锁，失败计数清零", "data": {"unlocked": rows, "target_user_id": user_id}})


# ============== 4. 重置密码 ==============
@admin_bp.post("/users/<int:user_id>/reset-password")
@require_admin
def admin_reset_password(user_id: int):
    r = _json()
    new_pwd = r.get("new_password") or r.get("password") or ""
    # 默认重置成 123456（通用默认，用户之后改）
    if not new_pwd:
        new_pwd = "123456"
    result = AuthService.admin_reset_password(int(user_id), new_pwd)
    if (isinstance(result, tuple) and result and result[0].get("code", 0) == 0) or (
        not isinstance(result, tuple) and isinstance(result, dict) and result.get("code", 0) == 0
    ):
        _admin_audit_log("reset_pwd", f"target_uid={user_id}")
    if isinstance(result, tuple):
        body, code = result
        return jsonify(body), code
    return jsonify(result)


# ============== 5. 改角色（升级/降级管理员） ==============
@admin_bp.post("/users/<int:user_id>/role")
@require_admin
def admin_set_role(user_id: int):
    r = _json()
    try:
        new_role = int(r.get("role", 0) or 0)
    except Exception:
        new_role = 0
    rows = get_adapter().admin_set_role(int(user_id), new_role)
    if rows == -1:
        return jsonify({"code": 409, "msg": "系统必须至少保留 1 名超级管理员，禁止降级最后一个管理员", "data": None}), 409
    if rows <= 0:
        return jsonify({"code": 404, "msg": "目标用户不存在或未更新", "data": None}), 404
    _admin_audit_log("set_role", f"target_uid={user_id} new_role={new_role}")
    role_user = int(getattr(config, "ROLE_USER", 0))
    role_admin = int(getattr(config, "ROLE_ADMIN", 1))
    new_role_n = "超级管理员" if new_role >= role_admin else ("普通用户" if new_role == role_user else f"角色{new_role}")
    return jsonify({"code": 0, "msg": f"用户角色已更新为 {new_role_n}", "data": {"target_user_id": user_id, "new_role": new_role, "new_role_name": new_role_n}})


# ============== 5b. 启用/禁用用户账号（软禁用，is_active = 0/1） ==============
@admin_bp.post("/users/<int:user_id>/toggle-active")
@require_admin
def admin_toggle_active(user_id: int):
    r = _json()
    raw = r.get("is_active")
    if raw is None or raw == "":
        new_active = 1
    else:
        try:
            new_active = int(raw)
        except Exception:
            new_active = 1
    new_active = 1 if new_active >= 1 else 0
    operator_uid = int((g.current_user or {}).get("id", 0) or 0)
    rows = get_adapter().admin_set_active(int(user_id), new_active=new_active, operator_uid=operator_uid)
    if rows == -2:
        return jsonify({"code": 400, "msg": "不允许管理员禁用自己", "data": None}), 400
    if rows == -3:
        return jsonify({"code": 409, "msg": "系统必须至少保留 1 名可登录的超级管理员，禁止禁用最后一个管理员", "data": None}), 409
    if rows <= 0:
        return jsonify({"code": 404, "msg": "目标用户不存在或未更新", "data": None}), 404
    _admin_audit_log("set_active", f"target_uid={user_id} is_active={new_active}")
    txt = "已启用（可正常登录）" if new_active == 1 else "已禁用（无法登录，现有会话立即失效）"
    return jsonify({"code": 0, "msg": f"用户 #{user_id} {txt}", "data": {"target_user_id": user_id, "is_active": new_active == 1, "status_text": txt}})


# ============== 6. 软删除用户（注销用户） ==============
@admin_bp.delete("/users/<int:user_id>")
@require_admin
def admin_delete_user(user_id: int):
    operator_uid = int((g.current_user or {}).get("id", 0) or 0)
    rows = get_adapter().admin_soft_delete(int(user_id), operator_uid=operator_uid)
    if rows == -2:
        return jsonify({"code": 400, "msg": "不允许管理员删除自己", "data": None}), 400
    if rows == -3:
        return jsonify({"code": 409, "msg": "禁止删除最后一个超级管理员（请先提升其他管理员，再执行删除）", "data": None}), 409
    if rows <= 0:
        return jsonify({"code": 404, "msg": "目标用户不存在或已注销", "data": None}), 404
    _admin_audit_log("delete_user", f"target_uid={user_id}")
    return jsonify({"code": 0, "msg": f"用户 #{user_id} 已删除（硬删，不可恢复）", "data": {"target_user_id": user_id}})


# ============== 7. 单个用户详情（管理员查看任意用户资料） ==============
@admin_bp.get("/users/<int:user_id>")
@require_admin
def admin_user_detail(user_id: int):
    u = get_adapter().get_user_by_id(int(user_id))
    if not u or int(u.get("is_deleted", 0)):
        return jsonify({"code": 404, "msg": "用户不存在", "data": None}), 404
    u_safe = _rows_to_public_users([u])
    return jsonify({"code": 0, "msg": "ok", "data": u_safe[0] if u_safe else None})


# ============== 8. 审计日志（session_logs 分页） ==============
@admin_bp.get("/logs")
@require_admin
def admin_logs():
    try:
        page = max(1, int(_q("page", 1) or 1))
    except Exception:
        page = 1
    try:
        page_size = min(500, max(1, int(_q("page_size", 50) or 50)))
    except Exception:
        page_size = 50
    acc = str(_q("account_no", "") or "").strip()[:6]
    only_fail = str(_q("only_fail", "0") or "0").lower() in {"1", "true", "yes", "y"}
    reason = str(_q("fail_reason", "") or "").strip()
    res = get_adapter().admin_list_session_logs(
        page=page, page_size=page_size, account_no=acc, only_fail=only_fail, fail_reason=reason,
    )
    # 脱敏：user_agent 最长 120，ip 保留中段打码（简单保留首段）
    for r in res.get("list") or []:
        if isinstance(r, dict):
            r["is_success"] = bool(int(r.get("is_success", 0) or 0))
            ip0 = str(r.get("ip") or "")
            if ip0:
                try:
                    parts = ip0.split(".")
                    if len(parts) == 4:
                        parts[1] = "*"
                        parts[2] = "*"
                        r["ip_masked"] = ".".join(parts)
                except Exception:
                    pass
    return jsonify({"code": 0, "msg": "ok", "data": res})


# ============== 9. 管理员自用：当前管理员个人信息 + 当前管理员可做的管理范围 ==============
@admin_bp.get("/me")
@require_admin
def admin_me():
    u = _rows_to_public_users([dict(g.current_user or {})])
    return jsonify({"code": 0, "msg": "ok", "data": {
        "user": (u[0] if u else None),
        "server_time": dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "version": getattr(config, "APP_VERSION", ""),
        "security": {
            "login_lock_threshold": getattr(config, "LOGIN_MAX_FAILS_BEFORE_LOCK", 5),
            "login_lock_minutes": getattr(config, "LOGIN_LOCK_MINUTES", 15),
            "rate_limit_login_per_min": getattr(config, "RATE_LIMIT_LOGIN_PER_MIN", 20),
            "rate_limit_captcha_per_min": getattr(config, "RATE_LIMIT_CAPTCHA_PER_MIN", 60),
            "pbkdf2_iterations": getattr(config, "PBKDF2_ITERATIONS", 260000),
        },
    }})


# ============== 10. 管理员二次验证：敏感操作（升级/降级/删用户/重置密码）之前先验证本人密码 ==============
@admin_bp.post("/verify-self-pwd")
@require_admin
def admin_verify_self_password():
    """前端在触发高敏感操作前调用此接口：
    body: {"password": "6~12位数字管理员本人的密码"}
    成功 code=0 + data.valid=True；失败 code=401/400
    注意：只验证当前 g.current_user 的密码，不会做锁定（此操作允许失败几次但不锁账号，避免管理员自己锁自己）
    """
    from utils.validators import is_valid_password
    r = _json()
    pwd = str(r.get("password") or "").strip()
    if not is_valid_password(pwd):
        return jsonify({"code": 400, "msg": "请输入 6~12 位数字密码", "data": {"valid": False}}), 400
    cur_uid = int((g.current_user or {}).get("id", 0) or 0)
    if cur_uid <= 0:
        return jsonify({"code": 401, "msg": "登录态无效", "data": {"valid": False}}), 401
    # 直接再拉一次DB确保实时
    u = get_adapter().get_user_by_id(cur_uid)
    _active = u.get("is_active") if u else 1
    _active_i = 1 if _active is None else int(_active)
    if not u or int(u.get("is_deleted") or 0) or not _active_i:
        return jsonify({"code": 403, "msg": "账号状态异常", "data": {"valid": False}}), 403
    pwd_hash = str(u.get("password_hash") or "")
    if not pwd_hash:
        return jsonify({"code": 401, "msg": "密码校验失败", "data": {"valid": False}}), 401
    try:
        ok = bool(check_password_hash(pwd_hash, pwd))
    except Exception:
        ok = False
    if not ok:
        _admin_audit_log("verify_pwd_fail", "")
        return jsonify({"code": 401, "msg": "管理员密码错误，请核对后重试", "data": {"valid": False}}), 401
    _admin_audit_log("verify_pwd_ok", "")
    # 给前端一个一次性的短token（60秒内有效，可以直接做后续敏感操作，避免让用户每次弹窗都输入一遍）
    import hashlib, time, uuid as _uuid
    nonce = _uuid.uuid4().hex
    ts = int(time.time())
    raw = f"svc|{cur_uid}|{ts}|{nonce}|{getattr(config, 'JWT_SECRET', '')}"
    sig = hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]
    ticket = f"{cur_uid}.{ts}.{nonce}.{sig}"
    return jsonify({"code": 0, "msg": "验证通过", "data": {"valid": True, "ticket": ticket, "ticket_expire_seconds": 60}})


# ============== 11. 系统公告（管理员端）：列表/新增/编辑/删除/置顶 ==============
def _announcement_to_public(r: Any, *, for_admin: bool = False) -> Dict[str, Any]:
    if not isinstance(r, dict):
        return {}
    d = {k: v for k, v in r.items()}
    d["is_pinned"] = bool(int(d.get("is_pinned") or 0))
    _a = d.get("is_active")
    d["is_active"] = bool(int(_a) if _a is not None else 1)
    d["priority"] = int(d.get("priority") or 0)
    if not for_admin:
        for k in ("updated_by", "created_by"):
            d.pop(k, None)
    return d


@admin_bp.get("/announcements")
@require_admin
def admin_list_announcements():
    try:
        page = max(1, int(_q("page", 1) or 1))
    except Exception:
        page = 1
    try:
        page_size = min(500, max(1, int(_q("page_size", 30) or 30)))
    except Exception:
        page_size = 30
    only_active = str(_q("only_active", "0") or "0").lower() in {"1", "true", "yes", "y"}
    res = get_adapter().admin_list_announcements(page=page, page_size=page_size, only_active=only_active)
    out = [_announcement_to_public(x, for_admin=True) for x in (res.get("list") or [])]
    return jsonify({"code": 0, "msg": "ok", "data": {"list": out, "total": int(res.get("total") or 0), "page": page, "page_size": page_size}})


@admin_bp.post("/announcements")
@require_admin
def admin_create_announcement():
    r = _json()
    title = str(r.get("title") or "").strip()
    content = str(r.get("content") or "").strip()
    if len(title) == 0:
        return jsonify({"code": 400, "msg": "公告标题不能为空", "data": None}), 400
    if len(title) > 80:
        return jsonify({"code": 400, "msg": "标题不能超过 80 字", "data": None}), 400
    if len(content) == 0:
        return jsonify({"code": 400, "msg": "公告内容不能为空", "data": None}), 400
    if len(content) > 4000:
        return jsonify({"code": 400, "msg": "内容不能超过 4000 字", "data": None}), 400
    try:
        priority = int(r.get("priority", 0) or 0)
    except Exception:
        priority = 0
    is_pinned = 1 if str(r.get("is_pinned") or "").lower() in {"1", "true", "yes", "y", "on"} else 0
    # is_active: 不传默认 1；传了就按"真值/假值"解析，false/0/off 等都写0
    if "is_active" not in r or r.get("is_active") is None or r.get("is_active") == "":
        is_active = 1
    else:
        is_active = 1 if str(r.get("is_active")).lower() in {"1", "true", "yes", "y", "on"} else 0
    banner_level = str(r.get("banner_level") or "info").strip().lower()
    if banner_level not in {"info", "success", "warning", "danger"}:
        banner_level = "info"
    # 生效/失效时间（可选）
    effective_at = str(r.get("effective_at") or "").strip() or None
    expire_at = str(r.get("expire_at") or "").strip() or None
    operator_uid = int((g.current_user or {}).get("id", 0) or 0)
    new_id = get_adapter().admin_create_announcement(
        title=title, content=content, priority=priority, is_pinned=is_pinned, is_active=is_active,
        banner_level=banner_level, effective_at=effective_at, expire_at=expire_at,
        created_by=operator_uid, updated_by=operator_uid,
    )
    if new_id <= 0:
        return jsonify({"code": 500, "msg": "创建失败", "data": None}), 500
    _admin_audit_log("ann_create", f"ann_id={new_id}")
    return jsonify({"code": 0, "msg": "公告已创建", "data": {"id": new_id}})


@admin_bp.put("/announcements/<int:ann_id>")
@require_admin
def admin_update_announcement(ann_id: int):
    r = _json()
    title = r.get("title", None)
    content = r.get("content", None)
    if title is not None:
        title = str(title).strip()
        if len(title) == 0:
            return jsonify({"code": 400, "msg": "公告标题不能为空", "data": None}), 400
        if len(title) > 80:
            return jsonify({"code": 400, "msg": "标题不能超过 80 字", "data": None}), 400
    if content is not None:
        content = str(content).strip()
        if len(content) == 0:
            return jsonify({"code": 400, "msg": "公告内容不能为空", "data": None}), 400
        if len(content) > 4000:
            return jsonify({"code": 400, "msg": "内容不能超过 4000 字", "data": None}), 400
    fields: Dict[str, Any] = {}
    if title is not None:
        fields["title"] = title
    if content is not None:
        fields["content"] = content
    if "priority" in r:
        try:
            fields["priority"] = max(-10, min(10, int(r.get("priority") or 0)))
        except Exception:
            pass
    if "is_pinned" in r:
        fields["is_pinned"] = 1 if str(r.get("is_pinned") or "").lower() in {"1", "true", "yes", "y", "on"} else 0
    if "is_active" in r:
        _raw = r.get("is_active")
        if _raw is None or _raw == "":
            fields["is_active"] = 1
        else:
            fields["is_active"] = 1 if str(_raw).lower() in {"1", "true", "yes", "y", "on"} else 0
    if "banner_level" in r:
        bl = str(r.get("banner_level") or "").strip().lower()
        if bl in {"info", "success", "warning", "danger"}:
            fields["banner_level"] = bl
    if "effective_at" in r:
        fields["effective_at"] = (str(r.get("effective_at") or "").strip() or None)
    if "expire_at" in r:
        fields["expire_at"] = (str(r.get("expire_at") or "").strip() or None)
    if len(fields) == 0:
        return jsonify({"code": 400, "msg": "没有任何可更新字段", "data": None}), 400
    operator_uid = int((g.current_user or {}).get("id", 0) or 0)
    fields["updated_by"] = operator_uid
    rows = get_adapter().admin_update_announcement(int(ann_id), fields)
    if rows <= 0:
        return jsonify({"code": 404, "msg": "公告不存在或未更新", "data": None}), 404
    _admin_audit_log("ann_update", f"ann_id={ann_id}")
    return jsonify({"code": 0, "msg": "公告已更新", "data": {"id": ann_id, "updated": rows}})


@admin_bp.delete("/announcements/<int:ann_id>")
@require_admin
def admin_delete_announcement(ann_id: int):
    rows = get_adapter().admin_delete_announcement(int(ann_id))
    if rows <= 0:
        return jsonify({"code": 404, "msg": "公告不存在", "data": None}), 404
    _admin_audit_log("ann_delete", f"ann_id={ann_id}")
    return jsonify({"code": 0, "msg": "公告已删除", "data": {"id": ann_id}})


@admin_bp.post("/announcements/<int:ann_id>/pin")
@require_admin
def admin_pin_announcement(ann_id: int):
    r = _json()
    is_pin = 1 if str(r.get("is_pinned", "1") or "1").lower() in {"1", "true", "yes", "y", "on"} else 0
    operator_uid = int((g.current_user or {}).get("id", 0) or 0)
    rows = get_adapter().admin_update_announcement(int(ann_id), {"is_pinned": is_pin, "updated_by": operator_uid})
    if rows <= 0:
        return jsonify({"code": 404, "msg": "公告不存在", "data": None}), 404
    _admin_audit_log("ann_pin", f"ann_id={ann_id} is_pinned={is_pin}")
    return jsonify({"code": 0, "msg": ("已置顶" if is_pin else "已取消置顶"), "data": {"id": ann_id, "is_pinned": is_pin == 1}})
