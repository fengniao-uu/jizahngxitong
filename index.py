import os
import sys
import json
import traceback

ROOT = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.join(ROOT, "backend")
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

_flask_app = None
_d1_initialized = False


def _init_d1_from_env(env):
    global _d1_initialized
    if _d1_initialized:
        return
    try:
        db_binding = None
        if env is not None:
            if hasattr(env, "DB"):
                db_binding = getattr(env, "DB", None)
            elif hasattr(env, "__getitem__"):
                try:
                    db_binding = env["DB"]
                except:
                    pass
            elif callable(getattr(env, "get", None)):
                db_binding = env.get("DB", None)
        if db_binding is not None:
            from db.d1_adapter import set_d1_db
            set_d1_db(db_binding)
            _d1_initialized = True
            print("[d1 init] D1 database initialized successfully", file=sys.stderr)
        else:
            print("[d1 init] DB binding not found in env", file=sys.stderr)
    except Exception as e:
        print(f"[d1 init error] {e}", file=sys.stderr)


def _init_flask_app(env=None):
    global _flask_app
    if _flask_app is not None:
        return _flask_app
    
    try:
        if env is not None:
            _init_d1_from_env(env)
        from app import app as flask_app
        _flask_app = flask_app
        return flask_app
    except Exception as e:
        tb = traceback.format_exc(limit=30)
        print("[init] Flask 应用初始化失败: " + str(e) + "\n" + tb, file=sys.stderr)
        raise


async def _handle_request(request, env=None):
    url = getattr(request, "url", "")
    path = str(url).split("?")[0] if url else "/"
    query = str(url).split("?")[1] if "?" in str(url) else ""
    
    method = getattr(request, "method", "GET")
    
    headers_dict = {}
    raw_headers = getattr(request, "headers", None)
    if raw_headers:
        try:
            for k in raw_headers.keys():
                headers_dict[k.lower()] = str(raw_headers.get(k) or "")
        except:
            pass
    
    body_bytes = b""
    try:
        body_task = getattr(request, "bytes", None)
        if callable(body_task):
            body_bytes = await body_task()
    except:
        pass
    
    try:
        app = _init_flask_app(env)
        
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
            "SERVER_PORT": "443",
            "SERVER_PROTOCOL": "HTTP/1.1",
            "CONTENT_TYPE": headers_dict.get("content-type", ""),
            "CONTENT_LENGTH": str(len(body_bytes or b"")),
        }
        for k, v in headers_dict.items():
            k_upper = k.upper().replace("-", "_")
            if k_upper not in ("CONTENT_TYPE", "CONTENT_LENGTH"):
                environ["HTTP_" + k_upper] = v
        
        status_line = ["500 Internal Server Error"]
        headers_out = []
        
        def start_response(status, headers, exc_info=None):
            status_line[0] = status
            headers_out[:] = headers
            def write(data): pass
            return write
        
        resp = app(environ, start_response)
        try:
            body_parts = [bytes(x) if not isinstance(x, (bytes, bytearray)) else bytes(x) for x in resp]
            full_body = b"".join(body_parts)
        finally:
            if hasattr(resp, "close"):
                try:
                    resp.close()
                except:
                    pass
        
        status_code = int(status_line[0].split(" ", 1)[0])
        resp_headers = {}
        for hk, hv in headers_out:
            if isinstance(hk, bytes):
                hk = hk.decode("latin-1")
            if isinstance(hv, bytes):
                hv = hv.decode("latin-1")
            kl = hk.lower()
            if kl not in ("content-length", "transfer-encoding", "connection", "keep-alive"):
                resp_headers[hk] = hv
        if "Content-Type" not in resp_headers:
            resp_headers["Content-Type"] = "text/html; charset=utf-8"
        
        return {
            "status": status_code,
            "headers": resp_headers,
            "body": full_body
        }
    
    except Exception as e:
        tb = traceback.format_exc(limit=50)
        payload = json.dumps({
            "code": 500,
            "msg": str(e)[:200],
            "trace": tb[:1000]
        }, ensure_ascii=False)
        return {
            "status": 500,
            "headers": {"Content-Type": "application/json; charset=utf-8"},
            "body": payload.encode("utf-8")
        }


from workers import WorkerEntrypoint, Response

class Default(WorkerEntrypoint):
    async def fetch(self, request, env=None, ctx=None):
        actual_env = getattr(self, "env", env)
        result = await _handle_request(request, env=actual_env)
        headers_dict = {}
        for k, v in (result.get("headers") or {}).items():
            headers_dict[str(k)] = str(v)
        body = result.get("body", b"")
        if isinstance(body, str):
            body = body.encode("utf-8")
        return Response(body, status=int(result.get("status", 200)), headers=headers_dict)


if __name__ == "__main__":
    for k in ("CF_PAGES", "CF_WORKER", "CLOUDFLARE_WORKER", "CF_PAGES_COMMIT_SHA", "WORKER_RUNTIME"):
        if k in os.environ:
            del os.environ[k]
    
    from app import app
    import config
    
    print(f"[{config.APP_VERSION}] 智能记账系统启动中...")
    print(f"数据库适配器: {config.DB_ADAPTER}")
    print(f"数据库路径: {config.DB_PATH}")
    print("=" * 50)
    print("访问地址: http://localhost:5000")
    print("=" * 50)
    
    app.run(host="0.0.0.0", port=5000, debug=False, threaded=True)
