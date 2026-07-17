from io import BytesIO, StringIO
from typing import Any

from flask import Blueprint, request, jsonify, g, send_file, Response

from utils.decorators import login_required
from services.transaction_service import TransactionService
from services.io_service import IOService

transactions_bp = Blueprint("transactions", __name__)


def _json() -> dict:
    return request.get_json(force=True, silent=True) or {}


def _query() -> dict:
    return {k: (v if not isinstance(v, list) else v[-1]) for k, v in (request.args.to_dict(flat=False) or {}).items()}


def _resp(result: Any):
    if isinstance(result, tuple):
        body, code = result
        return jsonify(body), code
    return jsonify(result)


@transactions_bp.get("/categories")
@login_required
def categories():
    return jsonify(TransactionService.categories(g.current_user))


@transactions_bp.get("")
@login_required
def list_paged():
    return jsonify(TransactionService.list_paged(g.current_user, _query()))


@transactions_bp.post("")
@login_required
def create():
    return _resp(TransactionService.create(g.current_user, _json()))


@transactions_bp.get("/<tx_id>")
@login_required
def detail(tx_id):
    return _resp(TransactionService.detail(g.current_user, tx_id))


@transactions_bp.put("/<tx_id>")
@login_required
def update(tx_id):
    return _resp(TransactionService.update(g.current_user, tx_id, _json()))


@transactions_bp.delete("/<tx_id>")
@login_required
def delete(tx_id):
    return _resp(TransactionService.delete(g.current_user, tx_id))


@transactions_bp.post("/batch-delete")
@login_required
def batch_delete():
    r = _json()
    ids = r.get("ids") or r.get("transaction_ids") or r.get("id_list")
    return _resp(TransactionService.batch_delete(g.current_user, ids))


@transactions_bp.post("/import/preview")
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
    return jsonify(IOService.preview_transactions(g.current_user, raw, file.filename or ""))


@transactions_bp.post("/import/confirm")
@login_required
def import_confirm():
    r = _json()
    rows = r.get("rows") or r.get("items") or r.get("preview_rows") or []
    return _resp(IOService.confirm_transactions(g.current_user, rows))


@transactions_bp.get("/export.<any('xlsx','csv'):fmt>")
@login_required
def export_fmt(fmt):
    items, _filters = TransactionService.export_payload(g.current_user, _query())
    buf, fname, mime = IOService.export_transactions(items, fmt)
    if fmt == "csv":
        text = buf.getvalue() if isinstance(buf, StringIO) else ""
        return Response(
            ("\ufeff" + text),
            mimetype=mime,
            headers={"Content-Disposition": f"attachment; filename={fname}"},
        )
    buf_bytes: BytesIO = buf  # type: ignore
    buf_bytes.seek(0)
    return send_file(
        buf_bytes,
        mimetype=mime,
        as_attachment=True,
        download_name=fname,
    )
