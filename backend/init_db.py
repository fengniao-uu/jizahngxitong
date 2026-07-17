from pathlib import Path
import datetime as dt
from typing import Optional
from werkzeug.security import generate_password_hash

import config
from db import get_adapter, reset_adapter_for_tests
from data import mock_data


def _hash_pwd(plain: str) -> str:
    return generate_password_hash(
        plain, method=f"pbkdf2:sha256:{config.PBKDF2_ITERATIONS}"
    )


def _normalize_type(t) -> Optional[str]:
    if not t:
        return None
    s = str(t).strip().lower()
    if s in ("收入", "income", "in", "shouru", "1", "true", "yes"):
        return "收入"
    if s in ("支出", "expense", "exp", "out", "zhichu", "0", "false", "no"):
        return "支出"
    return None


def seed_default_admin_if_needed() -> int:
    """当 DISABLE_DEFAULT_ADMIN=0 时，若无任何管理员则创建默认管理员（幂等）。"""
    import sqlite3 as _sq3
    if bool(getattr(config, "DISABLE_DEFAULT_ADMIN", False)):
        return 0
    adapter = get_adapter()
    admin_role = int(getattr(config, "ROLE_ADMIN", 1))
    admin_acc = str(getattr(config, "ADMIN_DEFAULT_ACCOUNT", "100000") or "100000").strip()[:6]
    admin_pwd = str(getattr(config, "ADMIN_DEFAULT_PASSWORD", "123456") or "123456").strip()[:6]
    existing = adapter.get_user_by_account(admin_acc)
    if existing:
        return int(existing["id"])
    try:
        user_id = adapter.create_user(admin_acc, _hash_pwd(admin_pwd), role=admin_role,
                                      nickname="超级管理员")
        adapter.upsert_system_categories_for_user(user_id)
        adapter.update_user_last_login(user_id)
        return int(user_id)
    except _sq3.IntegrityError:
        fallback = adapter.get_user_by_account(admin_acc)
        return int(fallback["id"]) if fallback else 0


def seed_demo_user_if_needed() -> int:
    """当 DISABLE_DEMO_USER=1（生产建议）时不自动创建 Demo 账号（幂等）。"""
    import sqlite3 as _sq3
    if bool(getattr(config, "DISABLE_DEMO_USER", False)):
        return 0
    adapter = get_adapter()
    account = config.DEMO_ACCOUNT["account_no"]
    pwd = config.DEMO_ACCOUNT["password"]
    u = adapter.get_user_by_account(account)
    if u:
        return int(u["id"])
    user_id = None
    try:
        user_id = adapter.create_user(account, _hash_pwd(pwd))
    except _sq3.IntegrityError:
        fallback = adapter.get_user_by_account(account)
        return int(fallback["id"]) if fallback else 0
    adapter.upsert_system_categories_for_user(user_id)
    adapter.update_user_last_login(user_id)

    cats_by_type = adapter.list_categories_grouped(user_id)
    income_names = {c["name"] for c in cats_by_type.get("收入", [])}
    expense_names = {c["name"] for c in cats_by_type.get("支出", [])}

    today = dt.date.today()
    base = today - dt.timedelta(days=40)
    fallback_income_cat = "房租" if "房租" in income_names else (next(iter(income_names), ""))
    fallback_expense_cat = "招租费" if "招租费" in expense_names else (next(iter(expense_names), ""))

    def _push_item(type_raw, name_raw: str, amount: float, desc: str = "", room: str = "", days_offset: int = 0):
        t = _normalize_type(type_raw)
        if t not in ("收入", "支出"):
            return
        if amount <= 0:
            return
        allowed_names = income_names if t == "收入" else expense_names
        fallback = fallback_income_cat if t == "收入" else fallback_expense_cat
        cat = str(name_raw or "").strip()
        if cat not in allowed_names:
            cat = fallback
        if not cat:
            return
        d = base + dt.timedelta(days=days_offset)
        adapter.create_transaction(
            user_id,
            {
                "type": t,
                "category": cat,
                "amount": float(amount),
                "description": str(desc or ""),
                "room_no": str(room or ""),
                "trans_date": d.isoformat(),
                "tag": "",
            },
        )

    summary = getattr(mock_data, "SUMMARY", {}) or {}
    cards = summary.get("cards") or []
    if len(cards) >= 2:
        try:
            inc_val = float(cards[0].get("amount", 0) or 0)
            exp_val = float(cards[1].get("amount", 0) or 0)
        except Exception:
            inc_val = exp_val = 0.0
        if inc_val > 0:
            _push_item("收入", "房租", inc_val, "[Demo] 本月房租汇总", "101-601", days_offset=20)
        if exp_val > 0:
            _push_item("支出", "招租费", exp_val * 0.4, "[Demo] 招租推广", "全部", days_offset=18)
            _push_item("支出", "工人费", exp_val * 0.3, "[Demo] 公共区域维修", "公共", days_offset=15)
            _push_item("支出", "保洁费", exp_val * 0.3, "[Demo] 月度保洁", "公共", days_offset=12)

    recent = getattr(mock_data, "RECENT_TRANSACTIONS", []) or []
    for i, item in enumerate(recent[:10]):
        t = item.get("type") or ("支出" if float(item.get("amount", 0) or 0) < 0 else "收入")
        try:
            amt = abs(float(item.get("amount", 0) or 0))
        except Exception:
            amt = 0.0
        if amt <= 0:
            amt = 100.0
        cat = item.get("category") or ("房租" if _normalize_type(t) == "收入" else "配件")
        desc = item.get("description") or item.get("note") or f"[Demo] 第 {i+1} 笔"
        room = item.get("room") or item.get("room_no") or (f"{101 + i}")
        _push_item(t, cat, amt, desc, room, days_offset=(10 - i))

    # 加几条提醒示例
    rems = [
        ("101", 1500.00, today + dt.timedelta(days=1), today + dt.timedelta(days=90), "未完成", "正常租户"),
        ("102", 1200.00, today - dt.timedelta(days=3), today + dt.timedelta(days=60), "未完成", "已逾期 3 天"),
        ("201", 1600.00, today + dt.timedelta(days=2), today + dt.timedelta(days=5), "未完成", "7 天内租期到期"),
        ("202", 1800.00, today + dt.timedelta(days=15), today + dt.timedelta(days=365), "未完成", "下个月到期"),
        ("301", 2000.00, today + dt.timedelta(days=45), today + dt.timedelta(days=400), "已确认", "提前交租，已确认"),
    ]
    for row in rems:
        adapter.create_reminder(
            user_id,
            {
                "room_no": row[0],
                "rent_amount": row[1],
                "due_date": row[2].isoformat(),
                "lease_end_date": row[3].isoformat() if row[3] else None,
                "status": row[4],
                "remark": row[5],
            },
        )
    return user_id


def ensure_db_initialized(force: bool = False) -> None:
    db_path: Path = config.DB_PATH
    if force and db_path.exists():
        db_path.unlink()
        reset_adapter_for_tests()
    get_adapter().init_schema()
    seed_default_admin_if_needed()
    seed_demo_user_if_needed()


if __name__ == "__main__":
    import argparse
    import os
    parser = argparse.ArgumentParser()
    parser.add_argument("--reset", action="store_true", help="删除现有 app.db 并重建")
    args = parser.parse_args()
    ensure_db_initialized(force=args.reset)
    print(f"[OK] 数据库已初始化: {config.DB_PATH}")
    _debug_mode = str(os.getenv("DEBUG", "0") or "0").lower() in {"1", "true", "yes", "y", "on"}
    if _debug_mode:
        print(f"[DEBUG] Demo 账号: {config.DEMO_ACCOUNT['account_no']} / {config.DEMO_ACCOUNT['password']}")
        print(f"[DEBUG] 默认管理员: {config.ADMIN_DEFAULT_ACCOUNT} / {config.ADMIN_DEFAULT_PASSWORD}")
    else:
        print("[提示] 生产环境下已隐藏默认凭据。如需查看，请设置 DEBUG=1 后重新运行。")
