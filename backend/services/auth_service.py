import uuid
import datetime as dt
from typing import Any, Dict, Optional, Tuple

import jwt
from werkzeug.security import check_password_hash, generate_password_hash

import config
from db import get_adapter
from utils.validators import is_6digit, is_valid_password, is_phone


def _pbkdf2(pwd: str) -> str:
    return generate_password_hash(
        pwd, method=f"pbkdf2:sha256:{config.PBKDF2_ITERATIONS}"
    )


def _issue_jwt(user_id: int, *, role: int = 0) -> Tuple[str, dt.datetime, str]:
    jti = uuid.uuid4().hex
    now = dt.datetime.utcnow()
    exp = now + dt.timedelta(days=config.JWT_EXPIRE_DAYS)
    payload = {
        "sub": str(user_id),
        "iat": int(now.timestamp()),
        "exp": int(exp.timestamp()),
        "jti": jti,
        "iss": "rent-admin",
        "role": int(role or 0),
    }
    token = jwt.encode(payload, config.JWT_SECRET, algorithm=config.JWT_ALG)
    return token, exp, jti


class AuthService:
    """所有方法均返回 {code,msg,data} 或 Tuple({code,msg,data}, http_code) 给 routes 直接 jsonify"""

    @staticmethod
    def _ok(data=None, msg="ok", code=0):
        return {"code": code, "msg": msg, "data": data}

    @staticmethod
    def _fail(msg, code=400, data=None):
        return {"code": code, "msg": msg, "data": data}, code

    @staticmethod
    def register(account_no: Any, password: Any, nickname: Any = "", ip: str = "", ua: str = "") -> Dict:
        if not is_valid_password(password):
            return AuthService._fail("密码必须是 6~12 位数字", 400)
        account = str(account_no).strip()
        use_phone = is_phone(account)
        phone = ""
        if use_phone:
            phone = account
            import random
            while True:
                new_account = str(random.randint(100000, 999999))
                if get_adapter().get_user_by_account(new_account) is None:
                    account = new_account
                    break
        else:
            if not is_6digit(account):
                return AuthService._fail("账号必须是 6 位数字或 11 位手机号", 400)
            if get_adapter().get_user_by_account(account) is not None:
                return AuthService._fail("该 6 位账号已被占用，请换一个", 409)
        pwd_hash = _pbkdf2(str(password).strip())
        nick = str(nickname or "")[:32]
        adapter = get_adapter()
        user_id = None
        try:
            user_id = adapter.create_user(account, pwd_hash, role=int(getattr(config, "ROLE_USER", 0)), nickname=nick, phone=phone)
        except Exception as e:
            # 捕获唯一约束冲突（并发/竞态/fallback 重复请求），不再抛 500，返回友好 409
            name = type(e).__name__.lower()
            msg = str(e).lower()
            is_unique_conflict = (
                "integrityerror" in name
                or "databaseerror" in name
                or "unique" in name
                or "duplicate" in name
                or "unique" in msg
                or "duplicate" in msg
                or "constraint" in msg
            )
            is_account_taken = False
            try:
                if is_unique_conflict and adapter.get_user_by_account(account) is not None:
                    is_account_taken = True
            except Exception:
                pass
            if is_account_taken or ("account_no" in msg):
                return AuthService._fail("该 6 位账号已被占用，请换一个", 409)
            if is_unique_conflict:
                return AuthService._fail("注册失败：数据冲突，请换一个账号重试", 409)
            return AuthService._fail("注册失败：服务繁忙请稍后重试", 500)
        try:
            adapter.upsert_system_categories_for_user(user_id)
            token, exp, jti = _issue_jwt(user_id, role=int(getattr(config, "ROLE_USER", 0)))
            adapter.insert_session_log(user_id, jti, ip, ua)
            adapter.update_user_last_login(user_id)
        except Exception as e:
            name = type(e).__name__.lower()
            msg = str(e).lower()
            is_unique_conflict = (
                "integrityerror" in name
                or "databaseerror" in name
                or "unique" in name
                or "duplicate" in name
                or "unique" in msg
                or "duplicate" in msg
                or "constraint" in msg
            )
            account_still_taken = False
            try:
                if is_unique_conflict and adapter.get_user_by_account(account) is not None:
                    account_still_taken = True
            except Exception:
                pass
            if account_still_taken or ("account_no" in msg):
                return AuthService._fail("该 6 位账号已被占用，请换一个", 409)
            if is_unique_conflict:
                return AuthService._fail("注册失败：数据冲突，请稍后重试", 409)
            return AuthService._fail("注册失败：服务繁忙请稍后重试", 500)
        role_i = int(getattr(config, "ROLE_USER", 0))
        return AuthService._ok(
            {
                "user_id": user_id,
                "account_no": account,
                "role": role_i,
                "role_name": getattr(config, "USER_ROLE_NAMES", {}).get(role_i, "普通用户"),
                "token": token,
                "expires_at": exp.isoformat() + "Z",
                "user": {
                    "id": user_id, "user_id": user_id, "account_no": account,
                    "nickname": nick, "phone": "", "role": role_i,
                },
                "userInfo": {
                    "id": user_id, "user_id": user_id, "account_no": account,
                    "nickname": nick, "phone": "", "role": role_i,
                },
            },
            "注册成功",
        )

    @staticmethod
    def login(account_no: Any, password: Any, ip: str = "", ua: str = "") -> Dict:
        if not is_valid_password(password):
            return AuthService._fail("密码必须是 6~12 位数字", 400)
        account = str(account_no).strip()
        pwd = str(password).strip()
        adapter = get_adapter()

        use_phone = is_phone(account)
        lookup_account = account
        if use_phone:
            user_by_phone = adapter.get_user_by_phone(account)
            if user_by_phone:
                lookup_account = user_by_phone.get("account_no", account)

        lk, lk_until, failed_so_far, remain = adapter.check_login_lock_status(account_no=lookup_account)
        if lk:
            adapter.insert_session_log(
                user_id=0, jti="", ip=ip, ua=ua,
                is_success=False, fail_reason="locked", attempt_account=account,
            )
            is_permanent = (remain > 31536000) or (lk_until and str(lk_until).startswith("9999-"))
            if is_permanent:
                tip = f"账号已被永久锁定（累计失败 {failed_so_far} 次），请联系管理员在后台解锁"
            else:
                mins = remain // 60
                secs = remain % 60
                tip = f"账号已临时锁定，请 {mins}分{secs:02d}秒 后重试（累计失败 {failed_so_far} 次）"
            return AuthService._fail(tip, 429, {"locked_until": lk_until, "remain_seconds": remain, "failed_attempts": failed_so_far, "permanent_locked": is_permanent})

        user = adapter.get_user_by_account(lookup_account)
        if not user:
            if use_phone:
                user = adapter.get_user_by_phone(account)
        if not user:
            adapter.insert_session_log(
                user_id=0, jti="", ip=ip, ua=ua,
                is_success=False, fail_reason="not_found", attempt_account=account,
            )
            return AuthService._fail("账号或密码错误", 401, {"hint": "统一返回，避免账号枚举"})
        user_id = int(user["id"])

        # 即使账号 is_active=0 也判一次（软禁用）
        try:
            ok_pwd = check_password_hash(user["password_hash"], pwd)
        except Exception:
            ok_pwd = False
        if not ok_pwd:
            adapter.increment_login_failure(user_id=user_id)
            adapter.insert_session_log(
                user_id=user_id, jti="", ip=ip, ua=ua,
                is_success=False, fail_reason="pwd_err", attempt_account=account,
            )
            # 🔒 密码错 → 再查一次锁，把锁定提示和剩余秒数给前端（用户能看到还剩多久）
            lk2, lk_until2, failed_now, remain2 = adapter.check_login_lock_status(user_id=user_id)
            extra = {"failed_attempts": failed_now}
            if lk2:
                is_perm = (remain2 > 31536000) or (lk_until2 and str(lk_until2).startswith("9999-"))
                if is_perm:
                    msg = f"密码错误，账号已被永久锁定（累计失败 {failed_now} 次），请联系管理员在后台解锁"
                else:
                    mins = remain2 // 60
                    secs = remain2 % 60
                    msg = f"密码错误，账号已临时锁定，请 {mins}分{secs:02d}秒 后重试"
                extra.update({"locked_until": lk_until2, "remain_seconds": remain2, "permanent_locked": is_perm})
                return AuthService._fail(msg, 429, extra)
            left = max(0, config.LOGIN_MAX_FAILS_BEFORE_LOCK - failed_now)
            if getattr(config, "LOGIN_PERMANENT_LOCK", False):
                lock_tip = f"超过 {config.LOGIN_MAX_FAILS_BEFORE_LOCK} 次将永久锁定（仅管理员可在后台解锁）"
            else:
                lock_tip = f"超过 {config.LOGIN_MAX_FAILS_BEFORE_LOCK} 次将锁定 {config.LOGIN_LOCK_MINUTES} 分钟"
            msg = f"账号或密码错误（剩余可尝试 {left} 次，累计失败 {failed_now} 次，{lock_tip}）"
            return AuthService._fail(msg, 401, extra)

        # ✅ 成功：清零计数 + 解锁（如果之前被锁了（边界）
        if config.LOGIN_FAIL_COUNTERS_RESET_ON_SUCCESS:
            adapter.reset_login_failures(user_id)
        role_i = int(user.get("role", 0) or 0)
        token, exp, jti = _issue_jwt(user_id, role=role_i)
        adapter.insert_session_log(user_id, jti, ip, ua, is_success=True, attempt_account=account)
        adapter.update_user_last_login(user_id)
        role_name = getattr(config, "USER_ROLE_NAMES", {}).get(role_i, "普通用户")
        nick = str(user.get("nickname") or "")
        phone = str(user.get("phone") or "")
        user_obj = {
            "id": user_id,
            "user_id": user_id,
            "account_no": user["account_no"],
            "nickname": nick,
            "phone": phone,
            "role": role_i,
            "role_name": role_name,
            "created_at": str(user.get("created_at") or ""),
            "last_login_at": str(user.get("last_login_at") or ""),
            "is_active": bool(int(user.get("is_active", 1))),
        }
        # ============ 默认弱密码检测（开源部署安全提醒） ============
        try:
            role_admin = int(getattr(config, "ROLE_ADMIN", 1))
            demo_cfg = getattr(config, "DEMO_ACCOUNT", None) or {}
            admin_def_acc = str(getattr(config, "ADMIN_DEFAULT_ACCOUNT", "100000") or "100000").strip()[:6]
            admin_def_pwd = str(getattr(config, "ADMIN_DEFAULT_PASSWORD", "123456") or "123456").strip()[:12]
            demo_acc = str(demo_cfg.get("account_no") if isinstance(demo_cfg, dict) else "123456").strip()[:6]
            demo_pwd = str(demo_cfg.get("password") if isinstance(demo_cfg, dict) else "123456").strip()[:12]
            enforce_admin = bool(getattr(config, "ENFORCE_CHANGE_DEFAULT_ADMIN_PWD", True))
            warn_demo = bool(getattr(config, "WARN_DEMO_DEFAULT_CREDENTIALS", True))
            # 管理员 + 默认密码 123456
            is_admin_default = False
            if role_i == role_admin and enforce_admin:
                try:
                    if check_password_hash(str(user.get("password_hash") or ""), admin_def_pwd):
                        is_admin_default = True
                except Exception:
                    pass
            # Demo 账号 + 默认密码
            is_demo_default = False
            acc = str(user.get("account_no") or "")
            if warn_demo and acc == demo_acc:
                try:
                    if check_password_hash(str(user.get("password_hash") or ""), demo_pwd):
                        is_demo_default = True
                except Exception:
                    pass
            warn_tags = []
            if is_admin_default:
                warn_tags.append("admin_default_password")
            if is_demo_default:
                warn_tags.append("demo_default_password")
            security_flags = {
                "need_change_default_pwd": is_admin_default,  # 管理员默认密码 = 建议强制改
                "warn_default_credentials": bool(warn_tags),
                "warn_tags": warn_tags,
                "default_admin_account": admin_def_acc if role_i == role_admin else None,
            }
        except Exception:
            security_flags = {}
        return AuthService._ok(
            {
                "user_id": user_id,
                "account_no": user["account_no"],
                "role": role_i,
                "role_name": role_name,
                "token": token,
                "expires_at": exp.isoformat() + "Z",
                "created_at": str(user.get("created_at") or ""),
                "last_login_at": str(user.get("last_login_at") or ""),
                "user": user_obj,
                "userInfo": dict(user_obj),
                "security": security_flags,
            },
            "登录成功",
        )

    @staticmethod
    def logout(jti: str) -> Dict:
        if not jti:
            return AuthService._ok(None, "未登录，无需退出")
        get_adapter().revoke_jti(jti)
        return AuthService._ok(None, "已退出登录")

    @staticmethod
    def me(user: Dict) -> Dict:
        user_id = int(user["id"])
        adapter = get_adapter()
        tx_total = adapter.list_transactions(user_id, {}, 1, 1)["total"]
        rem_total = len(adapter.list_reminders(user_id, {}))
        role_i = int(user.get("role", 0) or 0)
        return AuthService._ok(
            {
                "user_id": user_id,
                "account_no": user["account_no"],
                "role": role_i,
                "role_name": getattr(config, "USER_ROLE_NAMES", {}).get(role_i, "普通用户"),
                "nickname": str(user.get("nickname") or ""),
                "phone": str(user.get("phone") or ""),
                "is_active": bool(int(user.get("is_active", 1))),
                "created_at": str(user.get("created_at") or ""),
                "last_login_at": str(user.get("last_login_at") or ""),
                "tx_count": int(tx_total),
                "reminder_count": int(rem_total),
            }
        )

    @staticmethod
    def admin_reset_password(target_user_id: int, new_password: Any) -> Dict:
        """管理员重置密码入口（给 routes/admin.py 用）：必须传入 6~12 位数字新密码，返回 {code,msg,data}"""
        from utils.validators import is_valid_password
        if not target_user_id or int(target_user_id) <= 0:
            return AuthService._fail("目标用户ID无效", 400)
        if not is_valid_password(new_password):
            return AuthService._fail("新密码必须是 6~12 位数字", 400)
        u = get_adapter().get_user_by_id(int(target_user_id))
        if not u or int(u.get("is_deleted", 0)):
            return AuthService._fail("目标用户不存在", 404)
        rows = get_adapter().admin_set_password(
            int(target_user_id),
            _pbkdf2(str(new_password).strip()),
        )
        if rows <= 0:
            return AuthService._fail("密码重置失败", 500)
        return AuthService._ok({"new_password": str(new_password).strip()}, f"密码已重置为 {str(new_password).strip()}（同时已解锁+清零失败计数）")

    @staticmethod
    def change_password(user: Dict, old_password: Any, new_password: Any) -> Dict:
        if not is_6digit(old_password) or not is_6digit(new_password):
            return AuthService._fail("旧密码和新密码都必须是 6 位数字", 400)
        user_id = int(user["id"])
        u = get_adapter().get_user_by_id(user_id)
        if not u:
            return AuthService._fail("用户不存在", 404)
        if not check_password_hash(u["password_hash"], str(old_password).strip()):
            return AuthService._fail("旧密码不正确", 401)
        get_adapter().change_password(user_id, _pbkdf2(str(new_password).strip()))
        return AuthService._ok(None, "密码修改成功")

    @staticmethod
    def cancel_account(user: Dict, confirm_password: Any) -> Dict:
        if not is_valid_password(confirm_password):
            return AuthService._fail("请输入 6~12 位数字确认密码", 400)
        u = get_adapter().get_user_by_id(int(user["id"]))
        if not u:
            return AuthService._fail("用户不存在", 404)
        if not check_password_hash(u["password_hash"], str(confirm_password).strip()):
            return AuthService._fail("确认密码不正确", 401)
        get_adapter().delete_user_cascade(int(u["id"]))
        return AuthService._ok(None, "账号及所有数据已永久删除")

    @staticmethod
    def session_status(user: Dict, expires_at_from_payload: Optional[str] = None) -> Dict:
        return AuthService._ok(
            {
                "ok": True,
                "account_no": user.get("account_no"),
                "expires_at": expires_at_from_payload,
            }
        )
