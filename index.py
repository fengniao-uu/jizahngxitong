import os
import sys
import io
import json
import asyncio
import traceback
from pathlib import Path
from urllib.parse import urlparse

os.environ.setdefault("CF_PAGES", "1")
os.environ.setdefault("WORKER_RUNTIME", "cloudflare")
IS_CF_WORKERS = True

ROOT = Path(__file__).resolve().parent
BACKEND_DIR = ROOT / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

try:
    from werkzeug.middleware.proxy_fix import ProxyFix
except Exception:
    def ProxyFix(app, **k): return app

from app import app as _flask_app

_flask_app.wsgi_app = ProxyFix(
    _flask_app.wsgi_app,
    x_for=2,
    x_proto=2,
    x_host=2,
    x_port=1,
    x_prefix=1,
)

try:
    from asgiref.wsgi import WsgiToAsgi
    _asgi_app = WsgiToAsgi(_flask_app)
except Exception:
    _asgi_app = None


def _flask_direct_call(method, path, query, headers_dict, body_bytes):
    """终极兜底：不用 asgiref，直接构造 WSGI environ 调用 Flask。"""
    from io import BytesIO
    environ = {
        "wsgi.version": (1, 0),
        "wsgi.url_scheme": headers_dict.get("x-forwarded-proto", "https").split(",")[0].strip().lower() or "https",
        "wsgi.input": BytesIO(body_bytes or b""),
        "wsgi.errors": sys.stderr,
        "wsgi.multithread": False,
        "wsgi.multiprocess": False,
        "wsgi.run_once": False,
        "REQUEST_METHOD": method.upper(),
        "SCRIPT_NAME": "",
        "PATH_INFO": path or "/",
        "QUERY_STRING": query or "",
        "SERVER_NAME": headers_dict.get("host", ""),
        "SERVER_PORT": str(443),
        "SERVER_PROTOCOL": "HTTP/1.1",
        "CONTENT_TYPE": headers_dict.get("content-type", ""),
        "CONTENT_LENGTH": str(len(body_bytes or b"")),
    }
    for k, v in headers_dict.items():
        k_upper = k.upper().replace("-", "_")
        if k_upper in ("CONTENT_TYPE", "CONTENT_LENGTH"):
            continue
        environ["HTTP_" + k_upper] = v
    status_line = ["500 Internal Server Error"]
    headers_out = []
    def start_response(status, headers, exc_info=None):
        status_line[0] = status
        headers_out[:] = headers
        def write(data):
            pass
        return write
    resp = _flask_app(environ, start_response)
    try:
        body_parts = [bytes(x) if not isinstance(x, (bytes, bytearray)) else bytes(x) for x in resp]
        full_body = b"".join(body_parts)
    finally:
        if hasattr(resp, "close"):
            try: resp.close()
            except Exception: pass
    status_code = 200
    sp = status_line[0].split(" ", 1)
    try:
        status_code = int(sp[0])
    except Exception:
        pass
    resp_headers = []
    has_cl = False
    for hk, hv in headers_out:
        if isinstance(hk, bytes): hk = hk.decode("latin-1")
        if isinstance(hv, bytes): hv = hv.decode("latin-1")
        if hk.lower() == "content-length":
            has_cl = True
            continue
        if hk.lower() in ("transfer-encoding", "connection"):
            continue
        resp_headers.append([hk, hv])
    if not has_cl:
        resp_headers.append(["content-length", str(len(full_body))])
    return status_code, resp_headers, full_body


async def _handle_request(request):
    """把 Cloudflare Workers Request 转成 Flask（WSGI→ASGI）调用，并返回 Response 三要素。"""
    try:
        from workers import Response as CFResponse, Request as CFRequest
    except Exception:
        CFResponse = None
        CFRequest = None

    method = getattr(request, "method", "GET") or "GET"
    url_str = str(getattr(request, "url", "") or "")
    parsed = urlparse(url_str)
    path = parsed.path or "/"
    query = parsed.query or ""

    headers_dict = {}
    try:
        raw_headers = getattr(request, "headers", None)
        if raw_headers is not None:
            try:
                for k in raw_headers.keys():
                    headers_dict[k.lower()] = str(raw_headers.get(k) or "")
            except Exception:
                try:
                    it = iter(raw_headers)
                    for kv in it:
                        if isinstance(kv, (list, tuple)) and len(kv) >= 2:
                            headers_dict[str(kv[0]).lower()] = str(kv[1])
                except Exception:
                    pass
    except Exception:
        pass

    body_bytes = b""
    try:
        body_task = getattr(request, "bytes", None)
        if callable(body_task):
            body_bytes = await body_task()
        else:
            body_attr = getattr(request, "body", None)
            if body_attr is not None:
                if asyncio.iscoroutine(body_attr) or hasattr(body_attr, "__await__"):
                    body_bytes = await body_attr
                else:
                    body_bytes = body_attr
            if isinstance(body_bytes, str):
                body_bytes = body_bytes.encode("utf-8")
    except Exception:
        body_bytes = b""

    if _asgi_app is not None:
        scope_headers = []
        for k, v in headers_dict.items():
            scope_headers.append([k.lower().encode("latin-1"), v.encode("latin-1")])
        host = headers_dict.get("host", "") or (parsed.hostname or "")
        server_port = parsed.port or 443
        scope = {
            "type": "http",
            "asgi": {"version": "3.0", "spec_version": "2.1"},
            "http_version": "1.1",
            "method": method.upper(),
            "scheme": headers_dict.get("x-forwarded-proto", "https").split(",")[0].strip().lower() or "https",
            "path": path,
            "raw_path": path.encode("utf-8"),
            "query_string": query.encode("utf-8") if query else b"",
            "headers": scope_headers,
            "server": [host, int(server_port)],
            "client": None,
        }
        send_queue = []
        done = {"flag": False}
        async def receive():
            return {"type": "http.request", "body": body_bytes or b"", "more_body": False}
        async def send(msg):
            send_queue.append(msg)
            if msg.get("type") == "http.response.body" and not msg.get("more_body", False):
                done["flag"] = True
        try:
            await _asgi_app(scope, receive, send)
        except Exception as e:
            tb = traceback.format_exc(limit=80)
            print("[index] asgiref WSGI 桥异常，fallback 到直调 Flask：" + str(e) + "\n" + tb, file=sys.stderr)
            status, hdrs, body = _flask_direct_call(method, path, query, headers_dict, body_bytes)
            return status, hdrs, body

        status = 500
        resp_headers = []
        resp_body = b""
        for msg in send_queue:
            t = msg.get("type", "")
            if t == "http.response.start":
                status = int(msg.get("status", 500))
                for hk, hv in msg.get("headers", []) or []:
                    if isinstance(hk, (bytes, bytearray)):
                        hk = bytes(hk).decode("latin-1")
                    if isinstance(hv, (bytes, bytearray)):
                        hv = bytes(hv).decode("latin-1")
                    if str(hk).lower() in ("content-length", "transfer-encoding", "connection"):
                        continue
                    resp_headers.append([str(hk), str(hv)])
            elif t == "http.response.body":
                chunk = msg.get("body", b"") or b""
                if isinstance(chunk, str):
                    chunk = chunk.encode("utf-8")
                resp_body += bytes(chunk)
        has_cl = any(str(h[0]).lower() == "content-length" for h in resp_headers)
        if not has_cl:
            resp_headers.append(["content-length", str(len(resp_body))])
        return status, resp_headers, resp_body
    else:
        return _flask_direct_call(method, path, query, headers_dict, body_bytes)


try:
    from workers import WorkerEntrypoint, Response
    class Default(WorkerEntrypoint):
        async def fetch(self, request):
            try:
                status, headers_list, body = await _handle_request(request)
                headers_dict = {}
                for hk, hv in headers_list or []:
                    k = str(hk)
                    v = str(hv)
                    kl = k.lower()
                    if kl in ("content-length", "transfer-encoding", "connection", "keep-alive"):
                        continue
                    headers_dict[k] = v
                if isinstance(body, str):
                    body = body.encode("utf-8")
                elif isinstance(body, bytearray):
                    body = bytes(body)
                return Response(body, status=int(status), headers=headers_dict)
            except Exception as e:
                tb = traceback.format_exc(limit=100)
                print("[index] Worker 未捕获异常：" + str(e) + "\n" + tb, file=sys.stderr)
                payload = json.dumps({
                    "code": 500,
                    "msg": "Worker 内部错误：" + str(e)[:200],
                    "data": None,
                    "trace_id": "",
                }, ensure_ascii=False)
                return Response(
                    payload,
                    status=500,
                    headers={"Content-Type": "application/json; charset=utf-8"},
                )
except Exception as _import_err:
    print("[index] workers SDK 导入失败（本地环境正常）：" + str(_import_err), file=sys.stderr)
    Default = None


if __name__ == "__main__":
    print("[index] 本文件是 Cloudflare Workers 入口，不应直接用 python 运行。")
    print("部署命令：uv run pywrangler deploy")
    print("本地预览：uv run pywrangler dev")
    sys.exit(1)
