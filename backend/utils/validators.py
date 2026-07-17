import re
from datetime import datetime
from typing import Optional

_6DIGIT = re.compile(r"^\d{6}$")
_6TO12DIGIT = re.compile(r"^\d{6,12}$")
_YYYYMMDD = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_PHONE = re.compile(r"^1[3-9]\d{9}$")


def is_6digit(s) -> bool:
    if s is None:
        return False
    return bool(_6DIGIT.fullmatch(str(s)))


def is_valid_password(s) -> bool:
    """账号密码统一规则：纯数字，长度 6~12 位。"""
    if s is None:
        return False
    return bool(_6TO12DIGIT.fullmatch(str(s)))


def is_phone(s) -> bool:
    """检查是否为中国大陆手机号（11位，1开头，第二位3-9）"""
    if s is None:
        return False
    return bool(_PHONE.fullmatch(str(s)))


def is_amount_positive(s) -> bool:
    try:
        return float(s) > 0
    except Exception:
        return False


def is_amount_nonnegative(s) -> bool:
    try:
        return float(s) >= 0
    except Exception:
        return False


def is_yyyymmdd(s) -> bool:
    if not s or not _YYYYMMDD.fullmatch(str(s)):
        return False
    try:
        datetime.strptime(str(s), "%Y-%m-%d")
        return True
    except Exception:
        return False


def type_in(tx_type: str) -> bool:
    return tx_type in ("收入", "支出")


def status_in(st: str) -> bool:
    return st in ("未完成", "已完成", "已确认")


def renew_mode_in(m: str) -> bool:
    return m in ("30d", "1y")


def safe_str(s, max_len: int = 200) -> str:
    v = "" if s is None else str(s)
    return v if max_len <= 0 else v[:max_len]


def safe_int(v, default: int = 0, minimum: Optional[int] = None, maximum: Optional[int] = None) -> int:
    try:
        n = int(v)
    except Exception:
        return default
    if minimum is not None and n < minimum:
        n = minimum
    if maximum is not None and n > maximum:
        n = maximum
    return n
