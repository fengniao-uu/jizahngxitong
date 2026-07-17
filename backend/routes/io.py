from io import BytesIO
import datetime as dt
import uuid
import zipfile

from flask import Blueprint, jsonify, g, request, send_file
from utils.decorators import login_required
from services.io_service import IOService
from services.transaction_service import TransactionService
from services.reminder_service import ReminderService
from db import get_adapter


io_bp = Blueprint("io", __name__)


_PREVIEW_STORE: dict = {}


def _clean_expired_previews():
    try:
        now = dt.datetime.now().timestamp()
        dead = [k for k, v in _PREVIEW_STORE.items() if now - (v.get("ts") or 0) > 3600]
        for k in dead:
            _PREVIEW_STORE.pop(k, None)
    except Exception:
        pass


def _send_buf(buf, filename: str, mime: str):
    if isinstance(buf, BytesIO):
        buf.seek(0)
        return send_file(buf, as_attachment=True, download_name=filename, mimetype=mime)
    from io import StringIO
    if isinstance(buf, StringIO):
        buf.seek(0)
        data = buf.getvalue().encode("utf-8-sig")
        out = BytesIO(data)
        out.seek(0)
        return send_file(out, as_attachment=True, download_name=filename, mimetype=mime)
    buf.seek(0)
    return send_file(buf, as_attachment=True, download_name=filename, mimetype=mime)


# ========== 备份：JSON ==========
@io_bp.get("/backup.json")
@login_required
def backup_user_json():
    data = IOService.backup_user(g.current_user)
    return jsonify({
        "code": 0,
        "msg": "备份完成",
        "data": data,
    })


# ========== Backup: Full ZIP ==========
@io_bp.get("/backup/full")
@login_required
def backup_full_zip():
    user_id = int(g.current_user["id"])
    user = g.current_user
    adapter = get_adapter()
    tx_raw = adapter.list_transactions(user_id, {}, 1, 200000)
    if isinstance(tx_raw, dict):
        tx = tx_raw.get("items") or tx_raw.get("list") or []
    else:
        tx = list(tx_raw or [])
    rem_raw = adapter.list_reminders(user_id, {})
    if isinstance(rem_raw, dict):
        rems = rem_raw.get("items") or rem_raw.get("list") or []
    else:
        rems = list(rem_raw or [])
    cats = adapter.list_categories_grouped(user_id)

    # 交易 xlsx
    tx_buf, tx_fn, _ = IOService.export_transactions(tx, "xlsx")
    # 提醒 xlsx
    rem_buf, rem_fn, _ = IOService.export_reminders(rems, "xlsx")
    # JSON 备份
    import json
    meta = {
        "version": "rent-admin-v1.0",
        "exported_at": dt.datetime.now().isoformat(timespec="seconds"),
        "account_no": user.get("account_no"),
        "user_id": user_id,
        "counts": {"transactions": len(tx), "reminders": len(rems)},
    }

    zip_buf = BytesIO()
    with zipfile.ZipFile(zip_buf, "w", zipfile.ZIP_DEFLATED) as zf:
        tx_buf.seek(0)
        zf.writestr(tx_fn, tx_buf.read())
        rem_buf.seek(0)
        zf.writestr(rem_fn, rem_buf.read())
        zf.writestr("categories.json", json.dumps(cats, ensure_ascii=False, indent=2))
        zf.writestr("meta.json", json.dumps(meta, ensure_ascii=False, indent=2))
    zip_buf.seek(0)
    fname = f"backup_full_{dt.date.today().isoformat()}.zip"
    return send_file(
        zip_buf,
        as_attachment=True,
        download_name=fname,
        mimetype="application/zip",
    )


# ========== Backup: Transactions XLSX ==========
@io_bp.get("/backup/transactions")
@login_required
def backup_tx_xlsx():
    user_id = int(g.current_user["id"])
    tx_raw = get_adapter().list_transactions(user_id, {}, 1, 200000)
    tx = tx_raw.get("items") or tx_raw.get("list") or []
    buf, fname, mime = IOService.export_transactions(tx, "xlsx")
    return _send_buf(buf, fname, mime)


# ========== Export: Transactions ==========
@io_bp.get("/transactions/export")
@login_required
def tx_export():
    fmt = (request.args.get("format") or "xlsx").lower()
    if fmt not in ("xlsx", "csv"):
        fmt = "xlsx"
    q = {k: (v if not isinstance(v, list) else v[-1]) for k, v in (request.args.to_dict(flat=False) or {}).items()}
    q.pop("format", None)
    res = TransactionService.list_paged(g.current_user, {**q, "page": 1, "size": 200000})
    data = (res or {}).get("data") or {}
    items = data.get("items") or data.get("list") or []
    buf, fname, mime = IOService.export_transactions(items, fmt)
    return _send_buf(buf, fname, mime)


# ========== 导出：提醒 ==========
@io_bp.get("/reminders/export")
@login_required
def rem_export():
    fmt = (request.args.get("format") or "xlsx").lower()
    if fmt not in ("xlsx", "csv"):
        fmt = "xlsx"
    q = {k: (v if not isinstance(v, list) else v[-1]) for k, v in (request.args.to_dict(flat=False) or {}).items()}
    q.pop("format", None)
    res = ReminderService.list_all(g.current_user, {**q, "page": 1, "size": 200000})
    data = (res or {}).get("data") or {}
    items = data.get("items") or data.get("list") or []
    buf, fname, mime = IOService.export_reminders(items, fmt)
    return _send_buf(buf, fname, mime)


# ========== Import Preview: Transactions ==========
@io_bp.post("/transactions/import-preview")
@login_required
def tx_import_preview():
    user = g.current_user
    f = request.files.get("file")
    if not f:
        return jsonify({"code": 400, "msg": "请上传文件"}), 400
    try:
        file_bytes = f.read()
    except Exception:
        return jsonify({"code": 400, "msg": "文件读取失败"}), 400
    result = IOService.preview_transactions(user, file_bytes, f.filename or "")
    if isinstance(result, tuple):
        return jsonify(result[0]), result[1]
    data = result.get("data") or {}
    sample_rows = data.get("rows") or []
    full_rows = data.get("_ok_rows_full") or sample_rows
    invalid_rows = data.get("errors") or []
    preview_id = uuid.uuid4().hex[:16]
    _clean_expired_previews()
    _PREVIEW_STORE[preview_id] = {
        "ts": dt.datetime.now().timestamp(),
        "scope": "transactions",
        "user_id": int(user["id"]),
        "rows": full_rows,
    }
    return jsonify({
        "code": 0,
        "msg": result.get("msg") or "预览完成",
        "data": {
            "preview_id": preview_id,
            "rows": sample_rows,
            "valid": data.get("ok", len(sample_rows)),
            "invalid": data.get("invalid", len(invalid_rows)) or len(invalid_rows),
            "errors": invalid_rows,
            "total": data.get("total"),
        },
    })


# ========== 导入确认：交易 ==========
@io_bp.post("/transactions/import-confirm")
@login_required
def tx_import_confirm():
    user = g.current_user
    payload = request.get_json(silent=True) or {}
    pid = payload.get("preview_id")
    if not pid or pid not in _PREVIEW_STORE:
        return jsonify({"code": 400, "msg": "预览已过期或不存在，请重新上传"}), 400
    entry = _PREVIEW_STORE[pid]
    if entry.get("scope") != "transactions" or int(entry.get("user_id") or 0) != int(user["id"]):
        return jsonify({"code": 403, "msg": "预览不属于当前用户"}), 403
    rows = entry.get("rows") or []
    result = IOService.confirm_transactions(user, rows)
    _PREVIEW_STORE.pop(pid, None)
    if isinstance(result, tuple):
        return jsonify(result[0]), result[1]
    return jsonify(result)


# ========== 导入预览：提醒 ==========
@io_bp.post("/reminders/import-preview")
@login_required
def rem_import_preview():
    user = g.current_user
    f = request.files.get("file")
    if not f:
        return jsonify({"code": 400, "msg": "请上传文件"}), 400
    try:
        file_bytes = f.read()
    except Exception:
        return jsonify({"code": 400, "msg": "文件读取失败"}), 400
    result = IOService.preview_reminders(user, file_bytes, f.filename or "")
    if isinstance(result, tuple):
        return jsonify(result[0]), result[1]
    data = result.get("data") or {}
    sample_rows = data.get("rows") or []
    full_rows = data.get("_ok_rows_full") or sample_rows
    invalid_rows = data.get("errors") or []
    preview_id = uuid.uuid4().hex[:16]
    _clean_expired_previews()
    _PREVIEW_STORE[preview_id] = {
        "ts": dt.datetime.now().timestamp(),
        "scope": "reminders",
        "user_id": int(user["id"]),
        "rows": full_rows,
    }
    return jsonify({
        "code": 0,
        "msg": result.get("msg") or "预览完成",
        "data": {
            "preview_id": preview_id,
            "rows": sample_rows,
            "valid": data.get("ok", len(sample_rows)),
            "invalid": data.get("invalid", len(invalid_rows)) or len(invalid_rows),
            "errors": invalid_rows,
            "total": data.get("total"),
        },
    })


# ========== 导入确认：提醒 ==========
@io_bp.post("/reminders/import-confirm")
@login_required
def rem_import_confirm():
    user = g.current_user
    payload = request.get_json(silent=True) or {}
    pid = payload.get("preview_id")
    if not pid or pid not in _PREVIEW_STORE:
        return jsonify({"code": 400, "msg": "预览已过期或不存在，请重新上传"}), 400
    entry = _PREVIEW_STORE[pid]
    if entry.get("scope") != "reminders" or int(entry.get("user_id") or 0) != int(user["id"]):
        return jsonify({"code": 403, "msg": "预览不属于当前用户"}), 403
    rows = entry.get("rows") or []
    result = IOService.confirm_reminders(user, rows)
    _PREVIEW_STORE.pop(pid, None)
    if isinstance(result, tuple):
        return jsonify(result[0]), result[1]
    return jsonify(result)


@io_bp.post("/restore-preview")
@login_required
def restore_preview():
    return jsonify({"code": 400, "msg": "备份还原功能待实现", "data": None}), 400


@io_bp.post("/restore-confirm")
@login_required
def restore_confirm():
    return jsonify({"code": 400, "msg": "备份还原功能待实现", "data": None}), 400
