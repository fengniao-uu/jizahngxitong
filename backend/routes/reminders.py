from flask import Blueprint, request, jsonify, g
from utils.decorators import login_required
from services.reminder_service import ReminderService
from services.io_service import IOService

reminders_bp = Blueprint("reminders", __name__)


def _json() -> dict:
    return request.get_json(force=True, silent=True) or {}


def _query() -> dict:
    return {k: (v if not isinstance(v, list) else v[-1]) for k, v in (request.args.to_dict(flat=False) or {}).items()}


def _resp(result):
    if isinstance(result, tuple):
        body, code = result
        return jsonify(body), code
    return jsonify(result)


@reminders_bp.get("")
@login_required
def list_reminders():
    return jsonify(ReminderService.list_all(g.current_user, _query()))


@reminders_bp.post("")
@login_required
def create_reminder():
    return _resp(ReminderService.create(g.current_user, _json()))


@reminders_bp.get("/<rid>")
@login_required
def get_reminder(rid):
    return _resp(ReminderService.detail(g.current_user, rid))


@reminders_bp.put("/<rid>")
@login_required
def update_reminder(rid):
    return _resp(ReminderService.update(g.current_user, rid, _json()))


@reminders_bp.delete("/<rid>")
@login_required
def delete_reminder(rid):
    return _resp(ReminderService.delete(g.current_user, rid))


@reminders_bp.post("/<rid>/renew")
@login_required
def renew_reminder(rid):
    r = _json()
    return _resp(
        ReminderService.renew(
            g.current_user,
            rid,
            r.get("mode") or r.get("renew_mode") or r.get("duration"),
            r.get("rent_amount") if "rent_amount" in r else (r.get("amount") if "amount" in r else None),
        )
    )


@reminders_bp.post("/batch-delete")
@login_required
def batch_delete():
    r = _json()
    ids = r.get("ids") or r.get("reminder_ids") or r.get("id_list") or []
    return _resp(ReminderService.batch_delete(g.current_user, ids))


@reminders_bp.post("/import/preview")
@login_required
def import_preview():
    file = None
    try:
        storage = request.files
    except Exception:
        storage = None
    if storage and len(storage) > 0:
        file = next(iter(storage.values()), None)
    if file is None:
        return jsonify({"code": 400, "msg": "请上传 Excel 或 CSV 文件", "data": None}), 400
    try:
        raw = file.read()
    except Exception as e:
        return jsonify({"code": 400, "msg": f"读取文件失败：{e}", "data": None}), 400
    return jsonify(IOService.preview_reminders(g.current_user, raw, file.filename or ""))


@reminders_bp.post("/import/confirm")
@login_required
def import_confirm():
    r = _json()
    rows = r.get("rows") or r.get("items") or r.get("preview_rows") or []
    return _resp(IOService.confirm_reminders(g.current_user, rows))


@reminders_bp.get("/export.<any('xlsx','csv'):fmt>")
@login_required
def export_fmt(fmt):
    from flask import send_file, Response
    from io import BytesIO, StringIO
    q = _query()
    result = ReminderService.list_all(g.current_user, {k: v for k, v in q.items() if k not in ("page", "page_size")})
    items = (result.get("data") or {}).get("items") or []
    buf, fname, mime = IOService.export_reminders(items, fmt)
    if fmt == "csv":
        text = buf.getvalue() if isinstance(buf, StringIO) else ""
        return Response(
            ("\ufeff" + text),
            mimetype=mime,
            headers={"Content-Disposition": f"attachment; filename={fname}"},
        )
    buf_bytes: BytesIO = buf  # type: ignore
    buf_bytes.seek(0)
    return send_file(buf_bytes, mimetype=mime, as_attachment=True, download_name=fname)
