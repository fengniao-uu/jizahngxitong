from typing import Any, Dict, List, Optional
import datetime as dt

import config
from db import get_adapter
from utils.validators import (
    is_amount_positive,
    is_yyyymmdd,
    type_in,
    safe_str,
    safe_int,
)


class TransactionService:
    """业务层纯方法，返回 {code,msg,data} 或 Tuple({code,msg,data},http_code) 给 routes"""

    @staticmethod
    def _ok(data=None, msg="ok", code=0):
        return {"code": code, "msg": msg, "data": data}

    @staticmethod
    def _fail(msg, code=400, data=None):
        return {"code": code, "msg": msg, "data": data}, code

    @staticmethod
    def categories(user: Dict) -> Dict:
        grouped = get_adapter().list_categories_grouped(int(user["id"]))
        system = []
        for typ, names in config.SYSTEM_CATEGORIES.items():
            for idx, n in enumerate(names):
                system.append(
                    {"name": n, "type": typ, "is_system": True, "sort_order": idx}
                )
        builtin = {item["name"] for item in system}
        custom_items = []
        for _t, items in grouped.items():
            for c in items:
                if c.get("name") not in builtin:
                    custom_items.append(c)
        return TransactionService._ok(
            {
                "system": system,
                "by_type": grouped,
                "custom": custom_items,
            },
            msg="获取分类成功",
        )

    @staticmethod
    def _normalize_tx_type(t) -> Optional[str]:
        if not t:
            return None
        s = str(t).strip()
        s_low = s.lower()
        if s in ("收入",) or s_low in ("income", "in", "shouru", "1", "true", "yes"):
            return "收入"
        if "收入" in s or "income" in s_low or s_low == "shouru":
            return "收入"
        if s in ("支出",) or s_low in ("expense", "exp", "out", "zhichu", "0", "false", "no"):
            return "支出"
        if "支出" in s or "expense" in s_low or "exp" in s_low or "zhichu" in s_low:
            return "支出"
        return None

    @staticmethod
    def _validate(user_id: int, payload: Dict) -> Optional[Dict]:
        """校验并返回规范化 payload；失败返回 (response_dict, code) 元组"""
        tx_type = TransactionService._normalize_tx_type(payload.get("type"))
        if tx_type is None:
            return TransactionService._fail(
                "交易类型必须是「收入」或「支出」，也支持英文 income/expense", 400
            )
        amount_raw = payload.get("amount")
        if not is_amount_positive(amount_raw):
            return TransactionService._fail("金额必须是大于 0 的数字", 400)
        category = safe_str(payload.get("category"), 64)
        if not category:
            return TransactionService._fail("请指定分类", 400)
        grouped = get_adapter().list_categories_grouped(user_id)
        allowed = {c.get("name") for c in grouped.get(tx_type, []) if isinstance(c, dict)}
        if category not in allowed:
            return TransactionService._fail(
                f"分类「{category}」不属于 {tx_type}，可选：{sorted(allowed)[:15]}", 400
            )
        td = safe_str(payload.get("trans_date") or payload.get("date"))
        if td and not is_yyyymmdd(td):
            return TransactionService._fail("日期格式必须是 YYYY-MM-DD", 400)
        if not td:
            td = dt.date.today().isoformat()
        return {
            "type": tx_type,
            "category": category,
            "amount": float(amount_raw),
            "description": safe_str(payload.get("description"), 255),
            "room_no": safe_str(payload.get("room_no") or payload.get("room"), 32),
            "trans_date": td,
            "tag": safe_str(payload.get("tag"), 64),
        }

    @staticmethod
    def create(user: Dict, payload: Dict):
        user_id = int(user["id"])
        cleaned = TransactionService._validate(user_id, payload)
        if isinstance(cleaned, tuple):
            return cleaned
        adapter = get_adapter()
        tx_id = adapter.create_transaction(user_id, cleaned)
        return TransactionService._ok(adapter.get_transaction(user_id, tx_id), "添加交易成功", 0)

    @staticmethod
    def detail(user: Dict, tx_id: Any):
        try:
            tid = int(tx_id)
        except Exception:
            return TransactionService._fail("交易 ID 无效", 400)
        item = get_adapter().get_transaction(int(user["id"]), tid)
        if not item:
            return TransactionService._fail("交易不存在", 404)
        return TransactionService._ok(item)

    @staticmethod
    def update(user: Dict, tx_id: Any, payload: Dict):
        user_id = int(user["id"])
        try:
            tid = int(tx_id)
        except Exception:
            return TransactionService._fail("交易 ID 无效", 400)
        if not get_adapter().get_transaction(user_id, tid):
            return TransactionService._fail("交易不存在", 404)
        cleaned = TransactionService._validate(user_id, payload)
        if isinstance(cleaned, tuple):
            return cleaned
        get_adapter().update_transaction(user_id, tid, cleaned)
        return TransactionService._ok(get_adapter().get_transaction(user_id, tid), "更新交易成功")

    @staticmethod
    def delete(user: Dict, tx_id: Any):
        user_id = int(user["id"])
        try:
            tid = int(tx_id)
        except Exception:
            return TransactionService._fail("交易 ID 无效", 400)
        if not get_adapter().get_transaction(user_id, tid):
            return TransactionService._fail("交易不存在", 404)
        ok = get_adapter().delete_transaction(user_id, tid)
        return TransactionService._ok({"deleted": bool(ok)}, "删除交易成功")

    @staticmethod
    def batch_delete(user: Dict, ids_raw: Any):
        user_id = int(user["id"])
        if isinstance(ids_raw, str):
            ids = [x.strip() for x in ids_raw.split(",") if x.strip()]
        else:
            ids = list(ids_raw or [])
        if not ids:
            return TransactionService._fail("请指定要删除的交易 ID 列表", 400)
        id_list: List[int] = []
        for s in ids:
            try:
                id_list.append(int(s))
            except Exception:
                pass
        if not id_list:
            return TransactionService._fail("没有有效的交易 ID", 400)
        n = get_adapter().delete_transactions_batch(user_id, id_list)
        return TransactionService._ok({"deleted": int(n)}, f"批量删除 {n} 条交易")

    @staticmethod
    def list_paged(user: Dict, query: Dict):
        user_id = int(user["id"])
        page = safe_int(query.get("page") or 1, 1, 1, 10_000)
        page_size = safe_int(query.get("page_size") or 20, 20, 1, 200)
        keyword = safe_str(query.get("keyword"), 100)
        f: Dict[str, Any] = {}
        for k in ("type", "category", "room_no"):
            if query.get(k):
                f[k] = safe_str(query.get(k), 64)
        if not f.get("room_no") and query.get("room"):
            f["room_no"] = safe_str(query.get("room"), 64)
        for qk, dbk in (
            ("date_from", "date_from"),
            ("date_to", "date_to"),
            ("start_date", "date_from"),
            ("end_date", "date_to"),
        ):
            if query.get(qk):
                f[dbk] = safe_str(query.get(qk), 16)
        if keyword:
            f["keyword"] = keyword
        result = get_adapter().list_transactions(user_id, f, page, page_size)
        items = list(result.get("items") or result.get("list") or [])
        total = int(result.get("total") or len(items))
        total_pages = 0 if page_size <= 0 else (total + page_size - 1) // page_size
        raw_summary = result.get("summary") or {}
        summary = {
            "total_income": round(float(raw_summary.get("total_income") or 0), 2),
            "total_expense": round(float(raw_summary.get("total_expense") or 0), 2),
            "net": round(float(raw_summary.get("net") or 0), 2),
        }
        return TransactionService._ok(
            {
                "items": items,
                "total": total,
                "page": page,
                "page_size": page_size,
                "total_pages": int(total_pages),
                "summary": summary,
            },
            "获取交易列表成功",
        )

    @staticmethod
    def export_payload(user: Dict, query: Dict):
        """导出用：一次性拉取全部符合条件的 items（不分页）"""
        user_id = int(user["id"])
        f: Dict[str, Any] = {}
        keyword = safe_str(query.get("keyword"), 100)
        for k in ("type", "category", "room_no"):
            if query.get(k):
                f[k] = safe_str(query.get(k), 64)
        for qk, dbk in (
            ("date_from", "date_from"),
            ("date_to", "date_to"),
            ("start_date", "date_from"),
            ("end_date", "date_to"),
        ):
            if query.get(qk):
                f[dbk] = safe_str(query.get(qk), 16)
        if keyword:
            f["keyword"] = keyword
        result = get_adapter().list_transactions(user_id, f, 1, 100_000)
        items: List[Dict] = list(result.get("items") or result.get("list") or [])
        return items, f
