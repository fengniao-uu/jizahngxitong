from typing import Any, Dict, List, Optional
import datetime as dt
from copy import deepcopy

import config
from db import get_adapter
from utils.validators import safe_int
from services.reminder_service import compute_smart_tag


def _month_key(y, m) -> str:
    return f"{int(y):04d}-{int(m):02d}"


def _float(v, default=0.0) -> float:
    try:
        return round(float(v), 2)
    except Exception:
        return default


class StatsService:
    @staticmethod
    def _ok(data=None, msg="ok", code=0):
        return {"code": code, "msg": msg, "data": data}

    @staticmethod
    def _summary_payload(user_id: int) -> Dict[str, Any]:
        s = get_adapter().aggregate_summary(user_id) or {}
        month_income = _float(s.get("month_income") or s.get("current_month_income"))
        month_expense = _float(s.get("month_expense") or s.get("current_month_expense"))
        total_income = _float(s.get("total_income"))
        total_expense = _float(s.get("total_expense"))
        last_month_income = _float(s.get("last_month_income"))
        last_month_expense = _float(s.get("last_month_expense"))

        def _trend(cur, prev) -> float:
            if prev <= 0:
                return 0.0 if cur <= 0 else 100.0
            return round((cur - prev) / prev * 100, 1)

        return {
            "month_income": month_income,
            "month_expense": month_expense,
            "month_balance": round(month_income - month_expense, 2),
            "total_asset": round(total_income - total_expense, 2),
            "total_income": total_income,
            "total_expense": total_expense,
            "trend_income_pct": _trend(month_income, last_month_income),
            "trend_expense_pct": _trend(month_expense, last_month_expense),
            "last_month_income": last_month_income,
            "last_month_expense": last_month_expense,
        }

    @staticmethod
    def summary(user: Dict) -> Dict:
        """4 张卡片 + 汇总元数据（给 /api/stats/summary 用）"""
        su = StatsService._summary_payload(int(user["id"]))
        cards = [
            {
                "key": "month_income",
                "title": "本月收入",
                "amount": su["month_income"],
                "unit": "元",
                "trend_pct": su["trend_income_pct"],
                "compare_title": "环比上月",
            },
            {
                "key": "month_expense",
                "title": "本月支出",
                "amount": su["month_expense"],
                "unit": "元",
                "trend_pct": su["trend_expense_pct"],
                "compare_title": "环比上月",
            },
            {
                "key": "month_balance",
                "title": "本月结余",
                "amount": su["month_balance"],
                "unit": "元",
                "trend_pct": 0.0,
                "compare_title": "收入-支出",
            },
            {
                "key": "total_asset",
                "title": "总资产",
                "amount": su["total_asset"],
                "unit": "元",
                "trend_pct": round((su["month_balance"] / su["total_asset"] * 100) if su["total_asset"] > 0 else 0.0, 1),
                "compare_title": "本月结余占比",
            },
        ]
        return StatsService._ok({"cards": cards, "meta": su}, "获取统计汇总成功")

    @staticmethod
    def trend_12m(user: Dict) -> Dict:
        """返回 { months: [], income: [], expense: [], balance: [] } 每个数组 12 个元素对齐"""
        adapter = get_adapter()
        raw = adapter.trend_12m(int(user["id"])) or []
        by_month = {str(r.get("month")): r for r in raw if r.get("month")}
        today = dt.date.today()
        months: List[str] = []
        income_series: List[float] = []
        expense_series: List[float] = []
        balance_series: List[float] = []
        for i in range(11, -1, -1):
            y = today.year if today.month > i else today.year - 1
            m = today.month - i
            if m <= 0:
                m += 12
            key = _month_key(y, m)
            r = by_month.get(key) or {}
            inc = _float(r.get("income"))
            exp = _float(r.get("expense"))
            months.append(key)
            income_series.append(inc)
            expense_series.append(exp)
            balance_series.append(round(inc - exp, 2))
        total_income = round(sum(income_series), 2)
        total_expense = round(sum(expense_series), 2)
        return StatsService._ok(
            {
                "months": months,
                "income": income_series,
                "expense": expense_series,
                "balance": balance_series,
                "total_income_12m": total_income,
                "total_expense_12m": total_expense,
                "net_12m": round(total_income - total_expense, 2),
            },
            "获取 12 个月收支趋势成功",
        )

    @staticmethod
    def category_pie(user: Dict, scope: Any = 12) -> Dict:
        n = safe_int(scope, 12, 1, 120)
        adapter = get_adapter()
        grouped = adapter.category_pie(int(user["id"]), n) or {}
        income_raw = grouped.get("income") or grouped.get("收入") or []
        expense_raw = grouped.get("expense") or grouped.get("支出") or []

        def _sum(nodes):
            total = 0.0
            out = []
            for it in nodes:
                name = str(it.get("category") or it.get("name") or "未分类")
                amt = _float(it.get("amount") or it.get("total") or it.get("value") or 0)
                total += amt
                out.append({"name": name, "value": round(amt, 2)})
            out.sort(key=lambda x: x["value"], reverse=True)
            return out, round(total, 2)

        income_list, income_total = _sum(income_raw)
        expense_list, expense_total = _sum(expense_raw)
        return StatsService._ok(
            {
                "scope_months": n,
                "income": {"items": income_list, "total": income_total},
                "expense": {"items": expense_list, "total": expense_total},
            },
            "获取分类占比成功",
        )

    @staticmethod
    def category_compare(user: Dict, scope: Any = 12) -> Dict:
        n = safe_int(scope, 12, 1, 120)
        adapter = get_adapter()
        cmp = adapter.category_compare(int(user["id"]), n) or {}
        categories = [str(x) for x in (cmp.get("categories") or [])]
        income = [_float(v) for v in (cmp.get("income") or [])]
        expense = [_float(v) for v in (cmp.get("expense") or [])]
        # 长度对齐（避免数据库返回长度不一致）
        size = max(len(categories), len(income), len(expense))
        while len(categories) < size:
            categories.append(f"未命名{len(categories)+1}")
        for arr in (income, expense):
            while len(arr) < size:
                arr.append(0.0)
        net = [round(a - b, 2) for a, b in zip(income, expense)]
        return StatsService._ok(
            {
                "scope_months": n,
                "categories": categories[:30],
                "income": income[:30],
                "expense": expense[:30],
                "net": net[:30],
            },
            "获取分类对比成功",
        )

    @staticmethod
    def dashboard_summary(user: Dict) -> Dict:
        """/api/dashboard/summary：cards + 最近 5 条交易（recent tx 5） + 快捷入口 + 紧急提醒（smart_tag 已逾期/即将到期）"""
        user_id = int(user["id"])
        su = StatsService.summary(user)["data"]
        adapter = get_adapter()
        recent = adapter.recent_transactions(user_id, 5) or []
        rems = adapter.list_reminders(user_id, {}) or []
        today = dt.date.today()
        rems_enriched = []
        for it in rems:
            tag = compute_smart_tag(
                str(it.get("due_date") or ""),
                str(it.get("lease_end_date") or ""),
                str(it.get("status") or "未完成"),
                today=today,
            )
            rems_enriched.append({**it, "smart_tag": tag})
        # 紧急排序
        urgent_rank = {
            config.SMART_TAG_OVERDUE: 0,
            config.SMART_TAG_DUE_SOON: 1,
            config.SMART_TAG_LEASE_END: 2,
            config.SMART_TAG_NORMAL: 9,
        }
        rems_enriched.sort(
            key=lambda it: (
                urgent_rank.get(str(it.get("smart_tag") or config.SMART_TAG_NORMAL), 99),
                str(it.get("due_date") or "9999-12-31"),
                -int(it.get("id") or 0),
            )
        )
        top_rems = rems_enriched[:5]
        quick_actions = [
            {"key": "add_income", "title": "添加收入", "icon": "plus-circle", "route": "#/dashboard/bills", "default_type": "收入"},
            {"key": "add_expense", "title": "添加支出", "icon": "minus-circle", "route": "#/dashboard/bills", "default_type": "支出"},
            {"key": "view_records", "title": "查看记录", "icon": "list", "route": "#/dashboard/bills"},
            {"key": "analysis", "title": "统计分析", "icon": "bar-chart-2", "route": "#/dashboard/stats"},
            {"key": "add_reminder", "title": "新建提醒", "icon": "bell-plus", "route": "#/dashboard/reminders"},
        ]
        return StatsService._ok(
            {
                "cards": su["cards"],
                "meta": su["meta"],
                "quick_actions": quick_actions,
                "recent_transactions": recent,
                "urgent_reminders": top_rems,
                "reminder_summary": {
                    "pending": sum(1 for it in rems_enriched if it.get("status") == "未完成"),
                    "overdue": sum(1 for it in rems_enriched if it.get("smart_tag") == config.SMART_TAG_OVERDUE),
                    "due_soon": sum(1 for it in rems_enriched if it.get("smart_tag") == config.SMART_TAG_DUE_SOON),
                    "lease_end_soon": sum(1 for it in rems_enriched if it.get("smart_tag") == config.SMART_TAG_LEASE_END),
                    "total": len(rems_enriched),
                },
            },
            "获取仪表板汇总成功",
        )

    @staticmethod
    def dashboard_recent(user: Dict, limit: Any = 5) -> Dict:
        user_id = int(user["id"])
        n = safe_int(limit, 5, 1, 50)
        items = get_adapter().recent_transactions(user_id, n) or []
        return StatsService._ok({"items": items, "total": len(items)}, "获取最近交易成功")
