from typing import Any, Dict, List, Optional
import datetime as dt
import copy

from db import get_adapter
from utils.validators import (
    safe_str,
    safe_int,
    is_amount_nonnegative,
    is_yyyymmdd,
    status_in,
    renew_mode_in,
)
import config


def compute_smart_tag(due_date: str, lease_end_date: str, status: str, today: Optional[dt.date] = None) -> str:
    """计算提醒智能标签：即将到期(2d内)/已逾期/租期即将结束(7d内)/正常
    优先级：已逾期 > 即将到期 > 租期即将结束 > 正常
    status=已完成/已确认 → 正常"""
    today = today or dt.date.today()
    if status in ("已完成", "已确认"):
        return config.SMART_TAG_NORMAL
    tag = config.SMART_TAG_NORMAL
    try:
        due = dt.date.fromisoformat(due_date) if due_date else None
    except Exception:
        due = None
    try:
        end = dt.date.fromisoformat(lease_end_date) if lease_end_date else None
    except Exception:
        end = None
    if due is not None:
        delta_days = (due - today).days
        if delta_days < 0:
            tag = config.SMART_TAG_OVERDUE
        elif delta_days <= 2:
            tag = config.SMART_TAG_DUE_SOON
    if tag != config.SMART_TAG_OVERDUE and end is not None:
        days_to_end = (end - today).days
        if 0 <= days_to_end <= 7:
            if tag == config.SMART_TAG_NORMAL:
                tag = config.SMART_TAG_LEASE_END
            # 如果已标记即将到期但租期也将结束，仍然保留更紧急的房租到期提醒（SMART_TAG_DUE_SOON 优先）
    return tag


def _apply_smart_tag(item: Dict, today: Optional[dt.date] = None) -> Dict:
    it = dict(item or {})
    due_date_raw = str(it.get("due_date") or "")
    lease_end_raw = str(it.get("lease_end_date") or "")
    status = str(it.get("status") or "未完成")
    it["smart_tag"] = compute_smart_tag(due_date_raw, lease_end_raw, status, today=today)

    today = today or dt.date.today()

    try:
        due = dt.date.fromisoformat(due_date_raw) if due_date_raw else None
    except Exception:
        due = None
    try:
        end = dt.date.fromisoformat(lease_end_raw) if lease_end_raw else None
    except Exception:
        end = None

    is_closed = status in ("已完成", "已确认")

    # ============ 每月租金到期提醒 ============
    rent_days_left: Optional[int] = None
    rent_status: str = "无提醒"
    if due is not None and not is_closed:
        rent_days_left = (due - today).days
        if rent_days_left < 0:
            rent_status = f"租金已逾期（{-rent_days_left}天）"
        elif rent_days_left == 0:
            rent_status = "租金今天到期"
        elif rent_days_left <= 3:
            rent_status = f"租金即将到期（{rent_days_left}天后）"
        elif rent_days_left <= 7:
            rent_status = f"租金 {rent_days_left} 天内到期"
        elif rent_days_left <= 15:
            rent_status = f"租金 {rent_days_left} 天内到期"
        elif rent_days_left <= 30:
            rent_status = f"租金 {rent_days_left} 天内到期"
        else:
            rent_status = f"租金正常（还有 {rent_days_left} 天）"
    it["rent_days_left"] = rent_days_left
    it["rent_status"] = rent_status

    # ============ 每年租期到期提醒 ============
    lease_days_left: Optional[int] = None
    lease_status: str = "未设置租期结束日期"
    if end is not None:
        lease_days_left = (end - today).days
        if lease_days_left < 0:
            lease_status = f"租期已到期（{-lease_days_left}天前）"
        elif lease_days_left == 0:
            lease_status = "租期今天到期"
        elif lease_days_left <= 7:
            lease_status = f"租期即将结束（{lease_days_left}天后）"
        elif lease_days_left <= 30:
            lease_status = f"租期 {lease_days_left} 天内结束"
        elif lease_days_left <= 90:
            lease_status = f"租期 {lease_days_left} 天内结束"
        elif lease_days_left <= 180:
            lease_status = f"租期 {lease_days_left} 天内结束"
        elif lease_days_left <= 365:
            lease_status = f"租期 {lease_days_left} 天内到期（1年内）"
        else:
            lease_status = f"租期正常（还有 {lease_days_left} 天）"
    it["lease_days_left"] = lease_days_left
    it["lease_status"] = lease_status

    return it


def _summary_from(items: List[Dict]) -> Dict[str, int]:
    out = {
        "pending": 0, "urgent": 0, "overdue": 0, "due_soon": 0,
        "total": 0, "lease_end_soon": 0, "normal": 0,
        # ============ 每月租金到期细分 ============
        "rent_overdue": 0,        # 租金已逾期
        "rent_today": 0,          # 租金今天到期
        "rent_due_3d": 0,         # 租金 1-3 天内到期
        "rent_due_7d": 0,         # 租金 4-7 天内到期
        "rent_due_15d": 0,        # 租金 8-15 天内到期
        "rent_due_30d": 0,        # 租金 16-30 天内到期
        # ============ 每年租期到期细分 ============
        "lease_expired": 0,       # 租期已到期
        "lease_today": 0,         # 租期今天到期
        "lease_due_7d": 0,        # 租期 1-7 天内结束
        "lease_due_30d": 0,       # 租期 8-30 天内结束
        "lease_due_90d": 0,       # 租期 31-90 天内结束
        "lease_due_180d": 0,      # 租期 91-180 天内结束
        "lease_due_365d": 0,      # 租期 181-365 天内到期
    }
    for it in items:
        out["total"] += 1
        st = str(it.get("status") or "未完成")
        if st not in ("已完成", "已确认"):
            out["pending"] += 1
        tag = str(it.get("smart_tag") or config.SMART_TAG_NORMAL)
        if tag == config.SMART_TAG_OVERDUE:
            out["overdue"] += 1
            out["urgent"] += 1
        elif tag == config.SMART_TAG_DUE_SOON:
            out["due_soon"] += 1
            out["urgent"] += 1
        if tag == config.SMART_TAG_LEASE_END:
            out["lease_end_soon"] += 1
        if tag == config.SMART_TAG_NORMAL:
            out["normal"] += 1

        # 租金细分
        rdl = it.get("rent_days_left")
        if rdl is not None and st not in ("已完成", "已确认"):
            if rdl < 0:
                out["rent_overdue"] += 1
            elif rdl == 0:
                out["rent_today"] += 1
            elif rdl <= 3:
                out["rent_due_3d"] += 1
            elif rdl <= 7:
                out["rent_due_7d"] += 1
            elif rdl <= 15:
                out["rent_due_15d"] += 1
            elif rdl <= 30:
                out["rent_due_30d"] += 1

        # 租期细分
        ldl = it.get("lease_days_left")
        if ldl is not None:
            if ldl < 0:
                out["lease_expired"] += 1
            elif ldl == 0:
                out["lease_today"] += 1
            elif ldl <= 7:
                out["lease_due_7d"] += 1
            elif ldl <= 30:
                out["lease_due_30d"] += 1
            elif ldl <= 90:
                out["lease_due_90d"] += 1
            elif ldl <= 180:
                out["lease_due_180d"] += 1
            elif ldl <= 365:
                out["lease_due_365d"] += 1

    return out


class ReminderService:
    @staticmethod
    def _ok(data=None, msg="ok", code=0):
        return {"code": code, "msg": msg, "data": data}

    @staticmethod
    def _fail(msg, code=400, data=None):
        return {"code": code, "msg": msg, "data": data}, code

    @staticmethod
    def _validate(user_id: int, payload: Dict, *, for_update: bool = False) -> Any:
        if not for_update:
            room = safe_str(payload.get("room_no") or payload.get("room"), 32)
            if not room:
                return ReminderService._fail("房间号不能为空", 400)
        else:
            room = safe_str(payload.get("room_no") or payload.get("room"), 32)
        amt = payload.get("rent_amount") if "rent_amount" in payload else payload.get("amount")
        if amt is None:
            if for_update:
                amt_ok = True
                amt_value = None
            else:
                return ReminderService._fail("房租金额不能为空", 400)
        else:
            amt_ok = is_amount_nonnegative(amt)
            amt_value = float(amt) if amt_ok else None
            if not amt_ok:
                return ReminderService._fail("房租金额必须是 >= 0 的数字", 400)
        due = safe_str(payload.get("due_date"))
        if not for_update and not due:
            return ReminderService._fail("到期日期不能为空", 400)
        if due and not is_yyyymmdd(due):
            return ReminderService._fail("到期日期格式必须是 YYYY-MM-DD", 400)
        end = safe_str(payload.get("lease_end_date") or payload.get("end_date"))
        if end and not is_yyyymmdd(end):
            return ReminderService._fail("租期结束日期格式必须是 YYYY-MM-DD", 400)
        st = safe_str(payload.get("status"))
        if st and not status_in(st):
            for alias, canon in (
                ("待缴", "未完成"), ("待收", "未完成"), ("未完成", "未完成"),
                ("已交", "已完成"), ("已收款", "已完成"), ("已完成", "已完成"),
                ("已确认", "已确认"), ("确认", "已确认"),
            ):
                if alias and alias in st:
                    st = canon
                    break
            if not status_in(st):
                st = "未完成"
        cleaned: Dict[str, Any] = {}
        if room:
            cleaned["room_no"] = room
        if amt_value is not None:
            cleaned["rent_amount"] = amt_value
        if due:
            cleaned["due_date"] = due
        if end:
            cleaned["lease_end_date"] = end
        if st:
            cleaned["status"] = st
        note_key = "note" if "note" in payload else ("remark" if "remark" in payload else "note")
        note_val = safe_str(payload.get(note_key), 255)
        if note_val or note_key in payload or (not for_update):
            cleaned["note"] = note_val
        return cleaned

    @staticmethod
    def create(user: Dict, payload: Dict):
        user_id = int(user["id"])
        cleaned = ReminderService._validate(user_id, payload, for_update=False)
        if isinstance(cleaned, tuple):
            return cleaned
        rid = get_adapter().create_reminder(user_id, cleaned)
        item = get_adapter().get_reminder(user_id, rid)
        return ReminderService._ok(_apply_smart_tag(item), "添加提醒成功")

    @staticmethod
    def detail(user: Dict, rem_id: Any):
        user_id = int(user["id"])
        try:
            rid = int(rem_id)
        except Exception:
            return ReminderService._fail("提醒 ID 无效", 400)
        item = get_adapter().get_reminder(user_id, rid)
        if not item:
            return ReminderService._fail("提醒不存在", 404)
        return ReminderService._ok(_apply_smart_tag(item))

    @staticmethod
    def update(user: Dict, rem_id: Any, payload: Dict):
        user_id = int(user["id"])
        try:
            rid = int(rem_id)
        except Exception:
            return ReminderService._fail("提醒 ID 无效", 400)
        if not get_adapter().get_reminder(user_id, rid):
            return ReminderService._fail("提醒不存在", 404)
        cleaned = ReminderService._validate(user_id, payload, for_update=True)
        if isinstance(cleaned, tuple):
            return cleaned
        if not cleaned:
            cleaned = {}
        get_adapter().update_reminder(user_id, rid, cleaned)
        item = get_adapter().get_reminder(user_id, rid)
        return ReminderService._ok(_apply_smart_tag(item), "更新提醒成功")

    @staticmethod
    def delete(user: Dict, rem_id: Any):
        user_id = int(user["id"])
        try:
            rid = int(rem_id)
        except Exception:
            return ReminderService._fail("提醒 ID 无效", 400)
        if not get_adapter().get_reminder(user_id, rid):
            return ReminderService._fail("提醒不存在", 404)
        ok = get_adapter().delete_reminder(user_id, rid)
        return ReminderService._ok({"deleted": bool(ok)}, "删除提醒成功")

    @staticmethod
    def batch_delete(user: Dict, ids_raw: Any):
        user_id = int(user["id"])
        if isinstance(ids_raw, str):
            ids = [x.strip() for x in ids_raw.split(",") if x.strip()]
        else:
            ids = list(ids_raw or [])
        if not ids:
            return ReminderService._fail("请指定要删除的提醒 ID 列表", 400)
        id_list: List[int] = []
        for s in ids:
            try:
                id_list.append(int(s))
            except Exception:
                pass
        if not id_list:
            return ReminderService._fail("没有有效的提醒 ID", 400)
        # sqlite adapter 未实现 batch_delete_reminders 接口，采用循环删除方式
        adapter = get_adapter()
        n = 0
        for rid in id_list:
            if adapter.delete_reminder(user_id, rid):
                n += 1
        return ReminderService._ok({"deleted": n}, f"批量删除 {n} 条提醒")

    @staticmethod
    def list_all(user: Dict, query: Dict):
        user_id = int(user["id"])
        filters: Dict[str, Any] = {}
        keyword = safe_str(query.get("keyword"), 100)
        for k in ("status", "room_no"):
            if query.get(k):
                filters[k] = safe_str(query.get(k), 64)
        raw = get_adapter().list_reminders(user_id, filters)
        today = dt.date.today()
        items = [_apply_smart_tag(it, today) for it in raw]
        if keyword:
            k = keyword.lower()
            items = [
                it for it in items
                if k in str(it.get("room_no") or "").lower()
                or k in str(it.get("note") or "").lower()
                or k in str(it.get("smart_tag") or "").lower()
            ]
        # 排序：紧急度 > 到期日 升序 > id 降序
        urgency_rank = {
            config.SMART_TAG_OVERDUE: 0,
            config.SMART_TAG_DUE_SOON: 1,
            config.SMART_TAG_LEASE_END: 2,
            config.SMART_TAG_NORMAL: 3,
        }
        items.sort(
            key=lambda it: (
                urgency_rank.get(str(it.get("smart_tag") or config.SMART_TAG_NORMAL), 99),
                (str(it.get("due_date") or "9999-12-31")),
                -(int(it.get("id") or 0)),
            )
        )
        page = safe_int(query.get("page") or 1, 1, 1, 10_000)
        page_size = safe_int(query.get("page_size") or 0, 0, 0, 5000)
        total = len(items)
        if page_size > 0:
            start = (page - 1) * page_size
            paged = items[start : start + page_size]
            total_pages = (total + page_size - 1) // page_size
            return ReminderService._ok(
                {
                    "items": paged,
                    "total": total,
                    "page": page,
                    "page_size": page_size,
                    "total_pages": int(total_pages),
                    "summary": _summary_from(items),
                },
                "获取提醒列表成功",
            )
        return ReminderService._ok(
            {
                "items": items,
                "total": total,
                "summary": _summary_from(items),
            },
            "获取提醒列表成功",
        )

    @staticmethod
    def renew(user: Dict, rem_id: Any, mode: Any, rent_amount: Any = None):
        user_id = int(user["id"])
        try:
            rid = int(rem_id)
        except Exception:
            return ReminderService._fail("提醒 ID 无效", 400)
        if not renew_mode_in(safe_str(mode)):
            return ReminderService._fail("续租模式必须是 30d（30天）或 1y（1年）", 400)
        existing = get_adapter().get_reminder(user_id, rid)
        if not existing:
            return ReminderService._fail("提醒不存在", 404)
        cleaned = ReminderService._validate(user_id, {
            "room_no": existing.get("room_no"),
            "rent_amount": (rent_amount if rent_amount is not None else existing.get("rent_amount")),
            "due_date": existing.get("due_date"),
            "lease_end_date": existing.get("lease_end_date"),
            "status": existing.get("status") or "未完成",
            "note": existing.get("note") or "",
        }, for_update=False)
        if isinstance(cleaned, tuple):
            return cleaned
        base_due = None
        base_end = None
        if cleaned.get("due_date"):
            base_due = dt.date.fromisoformat(cleaned["due_date"])
        if cleaned.get("lease_end_date"):
            base_end = dt.date.fromisoformat(cleaned["lease_end_date"])
        m = safe_str(mode)
        if m == "30d":
            if base_due:
                new_due = base_due + dt.timedelta(days=30)
            else:
                new_due = dt.date.today() + dt.timedelta(days=30)
            new_end = base_end
        else:  # 1y
            if base_due:
                try:
                    new_due = base_due.replace(year=base_due.year + 1)
                except ValueError:
                    new_due = base_due + dt.timedelta(days=365)
            else:
                new_due = dt.date.today() + dt.timedelta(days=365)
            if base_end:
                try:
                    new_end = base_end.replace(year=base_end.year + 1)
                except ValueError:
                    new_end = base_end + dt.timedelta(days=365)
            else:
                new_end = None
        new_payload = copy.copy(cleaned)
        new_payload["due_date"] = new_due.isoformat()
        if new_end:
            new_payload["lease_end_date"] = new_end.isoformat()
        new_payload["status"] = "未完成"
        new_payload["note"] = (cleaned.get("note") or "") + f" [续租 {m}]"
        get_adapter().update_reminder(user_id, rid, new_payload)
        item = get_adapter().get_reminder(user_id, rid)
        return ReminderService._ok(_apply_smart_tag(item), f"已完成续租 {m}")
