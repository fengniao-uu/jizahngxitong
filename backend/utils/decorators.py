from functools import wraps
from typing import Callable

from flask import request, jsonify, g
import jwt

import config
from db import get_adapter


def _get_remote_ip() -> str:
    xff = request.headers.get("X-Forwarded-For", "")
    if xff:
        return xff.split(",", 1)[0].strip() or request.remote_addr or ""
    return request.remote_addr or ""


def login_required(fn: Callable):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        header = request.headers.get("Authorization", "") or ""
        if not header.lower().startswith("bearer "):
            return (
                jsonify({"code": 401, "msg": "请先登录", "data": None}),
                401,
            )
        token = header[7:].strip()
        if not token:
            return (
                jsonify({"code": 401, "msg": "请先登录", "data": None}),
                401,
            )
        try:
            payload = jwt.decode(
                token,
                config.JWT_SECRET,
                algorithms=[config.JWT_ALG],
                options={"require": ["exp", "sub", "jti"]},
            )
        except jwt.ExpiredSignatureError:
            return (
                jsonify({"code": 401, "msg": "登录已过期，请重新登录", "data": None}),
                401,
            )
        except jwt.InvalidTokenError:
            return (
                jsonify({"code": 401, "msg": "无效的登录凭证", "data": None}),
                401,
            )

        jti = str(payload.get("jti") or "").strip()
        try:
            user_id = int(payload["sub"])
        except Exception:
            return (
                jsonify({"code": 401, "msg": "无效的登录凭证", "data": None}),
                401,
            )

        if not jti or get_adapter().is_jti_revoked(jti):
            return (
                jsonify({"code": 401, "msg": "登录已退出，请重新登录", "data": None}),
                401,
            )

        user = get_adapter().get_user_by_id(user_id)
        if not user or user.get("is_deleted"):
            return (
                jsonify({"code": 401, "msg": "账号不存在或已注销", "data": None}),
                401,
            )
        if not int(user.get("is_active", 1)):
            return (
                jsonify({"code": 403, "msg": "账号已被管理员禁用，如有疑问请联系管理员", "data": None}),
                403,
            )

        g.current_user = user
        g.current_jti = jti
        g.current_ip = _get_remote_ip()
        g.current_ua = (request.headers.get("User-Agent") or "")[:512]
        return fn(*args, **kwargs)

    return wrapper


def require_admin(fn: Callable):
    """
    管理员权限装饰器：
    1) 必须是有效登录用户（复用 login_required 前置：token 校验 + 用户存在性）
    2) g.current_user.role == 1 (config.ROLE_ADMIN)
    3) 用户 is_active=1 软禁用=0

    错误行为：
    - 无token/非法token/吊销= 401 请先登录/重新登录
    - 有token但不是管理员= 403 您没有权限执行该操作（app.py errorhandler统一格式化，这里直接 raise werkzeug.exceptions.Forbidden 或返回元组）
    - 用户被软禁用= 403 账号已被管理员禁用
    """
    @wraps(fn)
    def wrapper(*args, **kwargs):
        header = request.headers.get("Authorization", "") or ""
        if not header.lower().startswith("bearer "):
            return jsonify({"code": 401, "msg": "请先登录", "data": None}), 401
        token = header[7:].strip()
        if not token:
            return jsonify({"code": 401, "msg": "请先登录", "data": None}), 401
        try:
            payload = jwt.decode(
                token, config.JWT_SECRET, algorithms=[config.JWT_ALG],
                options={"require": ["exp", "sub", "jti"]},
            )
        except jwt.ExpiredSignatureError:
            return jsonify({"code": 401, "msg": "登录已过期，请重新登录", "data": None}), 401
        except jwt.InvalidTokenError:
            return jsonify({"code": 401, "msg": "无效的登录凭证", "data": None}), 401

        jti = str(payload.get("jti") or "").strip()
        try:
            user_id = int(payload["sub"])
        except Exception:
            return jsonify({"code": 401, "msg": "无效的登录凭证", "data": None}), 401
        if not jti or get_adapter().is_jti_revoked(jti):
            return jsonify({"code": 401, "msg": "登录已退出，请重新登录", "data": None}), 401

        user = get_adapter().get_user_by_id(user_id)
        if not user or user.get("is_deleted"):
            return jsonify({"code": 401, "msg": "账号不存在或已注销", "data": None}), 401
        if not int(user.get("is_active", 1)):
            return jsonify({"code": 403, "msg": "账号已被管理员禁用", "data": None}), 403
        role_admin = int(getattr(config, "ROLE_ADMIN", 1))
        if int(user.get("role", 0) or 0) != role_admin:
            return jsonify({"code": 403, "msg": "您没有权限执行该操作（非管理员）", "data": None}), 403

        g.current_user = user
        g.current_jti = jti
        g.current_ip = _get_remote_ip()
        g.current_ua = (request.headers.get("User-Agent") or "")[:512]
        return fn(*args, **kwargs)

    return wrapper


def ok(data=None, msg: str = "ok", code: int = 0):
    return {"code": code, "msg": msg, "data": data}


def fail(msg: str, code: int = 400, data=None):
    return {"code": code, "msg": msg, "data": data}, code
