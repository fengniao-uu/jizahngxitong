import os
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.join(ROOT, "backend")
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from app import app as application

app = application

if __name__ == "__main__":
    import config
    print(f"[{config.APP_VERSION}] 智能记账系统启动中...")
    print(f"数据库适配器: {config.DB_ADAPTER}")
    print(f"数据库路径: {config.DB_PATH}")
    print("=" * 50)
    print("访问地址: http://localhost:5000")
    print("=" * 50)
    
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)), debug=False, threaded=True)
