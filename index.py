import os
import sys
from pathlib import Path

for k in ("CF_PAGES", "CF_WORKER", "CLOUDFLARE_WORKER", "CF_PAGES_COMMIT_SHA", "WORKER_RUNTIME"):
    if k in os.environ:
        del os.environ[k]

ROOT = Path(__file__).resolve().parent
BACKEND_DIR = ROOT / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

if __name__ == "__main__":
    from app import app
    import config
    
    print(f"[{config.APP_VERSION}] 智能记账系统启动中...")
    print(f"数据库适配器: {config.DB_ADAPTER}")
    print(f"数据库路径: {config.DB_PATH}")
    print(f"前端目录: {ROOT / 'frontend'}")
    print("=" * 50)
    print("访问地址: http://localhost:5000")
    print("=" * 50)
    
    app.run(host="0.0.0.0", port=5000, debug=False, threaded=True)
