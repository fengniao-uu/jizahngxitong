import os
import secrets
import logging
import tempfile
from pathlib import Path

_BASE_DIR = Path(__file__).resolve().parent
_ENV_PATH = _BASE_DIR / ".env"

IS_CF_WORKERS = any(
    k in os.environ for k in ("CF_PAGES", "CF_WORKER", "CLOUDFLARE_WORKER", "CF_PAGES_COMMIT_SHA")
) or os.environ.get("WORKER_RUNTIME", "") == "cloudflare"

try:
    from dotenv import load_dotenv, set_key
    _DOTENV_OK = True
except ImportError:
    _DOTENV_OK = False
    def load_dotenv(*a, **k): pass
    def set_key(*a, **k): raise OSError("python-dotenv 未安装")

if not IS_CF_WORKERS and _DOTENV_OK:
    try:
        load_dotenv(_ENV_PATH)
    except Exception:
        pass

BASE_DIR = _BASE_DIR
if IS_CF_WORKERS:
    try:
        DATA_DIR = Path(tempfile.gettempdir()) / "jz_data"
        LOG_DIR = Path(tempfile.gettempdir()) / "jz_logs"
    except Exception:
        DATA_DIR = Path("/tmp") / "jz_data"
        LOG_DIR = Path("/tmp") / "jz_logs"
    try:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
    except Exception:
        pass
    try:
        LOG_DIR.mkdir(parents=True, exist_ok=True)
    except Exception:
        pass
    DB_PATH = DATA_DIR / "app.db"
    try:
        Path(DB_PATH).touch(exist_ok=True)
    except Exception:
        pass
else:
    DATA_DIR = BASE_DIR / "data"
    LOG_DIR = BASE_DIR / "logs"
    DB_PATH = DATA_DIR / "app.db"
    try:
        DATA_DIR.mkdir(exist_ok=True)
        LOG_DIR.mkdir(exist_ok=True)
    except Exception:
        pass

_cfg_logger = logging.getLogger("config")
if not _cfg_logger.handlers:
    _h = logging.StreamHandler()
    _h.setFormatter(logging.Formatter("[%(asctime)s] %(levelname)s | %(message)s", "%Y-%m-%d %H:%M:%S"))
    _cfg_logger.addHandler(_h)
    _cfg_logger.setLevel(logging.INFO)

def _ensure_jwt_secret() -> str:
    """从 .env 读取 JWT_SECRET；缺失/空/占位时用 secrets 密码学安全伪随机数生成器（CSPRNG）生成 64 字符高熵密钥并持久化。"""
    raw = (os.getenv("JWT_SECRET") or "").strip()
    weak_placeholders = {
        "",
        "dev_secret_change_me_in_production",
        "dev_secret_change_me_in_production_2026",
        "dev_secret_change_me_in_production_2026!",
        "change_me",
        "please_change_me",
    }
    if raw not in weak_placeholders and len(raw) >= 32:
        return raw
    new_secret = secrets.token_urlsafe(48)
    while len(new_secret) < 64:
        new_secret = secrets.token_urlsafe(48)
    new_secret = new_secret[:64]
    saved_hint = ""
    if not IS_CF_WORKERS and _DOTENV_OK:
        try:
            if not _ENV_PATH.exists():
                try:
                    _ENV_PATH.touch(mode=0o600, exist_ok=True)
                except Exception:
                    pass
            try:
                set_key(str(_ENV_PATH), "JWT_SECRET", new_secret, quote_mode="never")
                saved_hint = f" & saved to .env ({_ENV_PATH.name})"
            except Exception as e:
                _cfg_logger.warning("JWT_SECRET generated but failed to persist to .env: %s", e)
        except Exception:
            pass
    else:
        _cfg_logger.warning(
            "="*68 + "\n" +
            "[严重警告] Cloudflare 环境未设置持久化 JWT_SECRET！当前生成的随机密钥仅本次冷启动有效，"
            "下次部署/冷启动后所有已登录用户的 Token 将全部失效。请立刻在 Cloudflare Pages 项目后台的 "
            "Environment Variables 中添加一个 >=32 位的高熵 JWT_SECRET 环境变量，然后重新部署。\n" +
            "="*68
        )
        saved_hint = "（临时密钥，冷启动后会变化！请设置环境变量）"
    _cfg_logger.info(
        "JWT_SECRET auto-generated (CSPRNG, len=%d, entropy~384bits)%s",
        len(new_secret),
        saved_hint,
    )
    os.environ["JWT_SECRET"] = new_secret
    return new_secret

JWT_SECRET = _ensure_jwt_secret()
JWT_ALG = "HS256"
JWT_EXPIRE_DAYS = 7

PBKDF2_ITERATIONS = 260000
CORS_ORIGINS = [x.strip() for x in os.getenv("CORS_ORIGINS", "*").split(",") if x.strip()]

DATABASE_URL = (os.getenv("DATABASE_URL") or os.getenv("POSTGRES_URL") or os.getenv("POSTGRESQL_URL") or "").strip()
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = "postgresql://" + DATABASE_URL[len("postgres://"):]
_DB_FROM_ENV = "postgres" if DATABASE_URL.startswith("postgresql://") else os.getenv("DB_ADAPTER", "sqlite").lower()
DB_ADAPTER = _DB_FROM_ENV.lower()
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY", "")

SYSTEM_CATEGORIES = {
    "收入": ["房租", "网费", "取暖费", "房租押金", "门禁卡押金", "违约金", "其他"],
    "支出": ["网费", "招租费", "配件", "工人费", "保洁费", "水电", "维修", "其他"],
}
DEMO_ACCOUNT = {"account_no": "123456", "password": "123456"}

SMART_TAG_OVERDUE = "已逾期"
SMART_TAG_DUE_SOON = "即将到期（2d内）"
SMART_TAG_LEASE_END = "租期即将结束（7d内）"
SMART_TAG_NORMAL = "正常"
SMART_TAGS = [SMART_TAG_OVERDUE, SMART_TAG_DUE_SOON, SMART_TAG_LEASE_END, SMART_TAG_NORMAL]
SMART_TAG_PRIORITY = {SMART_TAG_OVERDUE: 0, SMART_TAG_DUE_SOON: 1, SMART_TAG_LEASE_END: 2, SMART_TAG_NORMAL: 9}

# ==================== 登录安全配置 ====================
LOGIN_MAX_FAILS_BEFORE_LOCK: int = 3          # 失败次数阈值（超过锁定）
LOGIN_LOCK_MINUTES: int = 15                  # 锁定时长（分钟；仅当 LOGIN_PERMANENT_LOCK=False 时生效，到时自动解锁）
LOGIN_PERMANENT_LOCK: bool = True             # True=达到阈值后"永久锁定"，仅管理员在后台可解锁；False=按 LOGIN_LOCK_MINUTES 限时锁定
LOGIN_FAIL_COUNTERS_RESET_ON_SUCCESS: bool = True  # 成功后清零失败计数
RATE_LIMIT_CAPTCHA_PER_MIN: int = 60          # 同 IP 每分钟 /captcha 次数上限
RATE_LIMIT_LOGIN_PER_MIN: int = 20            # 同 IP 每分钟 /login 次数上限

# ==================== 开源部署安全开关 ====================
# 是否禁用 Demo 账号（123456/123456）的自动创建：生产部署建议设为 1
DISABLE_DEMO_USER: bool = str(os.getenv("DISABLE_DEMO_USER", "0") or "0").lower() in {"1", "true", "yes", "y", "on"}
# 是否禁用默认管理员（100000）的自动创建；设为 1 后需通过 DB 脚本或命令行手动创建首个管理员
DISABLE_DEFAULT_ADMIN: bool = str(os.getenv("DISABLE_DEFAULT_ADMIN", "0") or "0").lower() in {"1", "true", "yes", "y", "on"}
# 当检测到当前管理员仍在使用默认密码（123456）时，是否在登录响应里要求强制改密码
ENFORCE_CHANGE_DEFAULT_ADMIN_PWD: bool = str(os.getenv("ENFORCE_CHANGE_DEFAULT_ADMIN_PWD", "1") or "1").lower() not in {"0", "false", "no", "n", "off"}
# 当检测到 Demo 账号（123456）仍存在/仍使用默认密码时，登录成功后提示改密
WARN_DEMO_DEFAULT_CREDENTIALS: bool = True

# ==================== 管理员账号 ====================
# 默认管理员账号（首次部署自动创建，无管理员时触发；首次登录请立刻修改密码！）
ADMIN_DEFAULT_ACCOUNT: str = os.getenv("ADMIN_ACCOUNT", "100000").strip()[:6] or "100000"
ADMIN_DEFAULT_PASSWORD: str = os.getenv("ADMIN_PASSWORD", "123456").strip()[:12] or "123456"
# 角色枚举：0=普通用户（记账/收租），1=超级管理员（用户管理/解锁/审计）
ROLE_USER: int = 0
ROLE_ADMIN: int = 1
USER_ROLE_NAMES = {ROLE_USER: "普通用户", ROLE_ADMIN: "超级管理员"}

# ==================== 启动时安全自检 ====================
try:
    _WARN = "\033[1;31m[安全警告]\033[0m"
    _YEL = "\033[1;33m"
    _RST = "\033[0m"
    _is_prod_like = (
        bool(DISABLE_DEMO_USER)
        or bool(DISABLE_DEFAULT_ADMIN)
        or (CORS_ORIGINS and CORS_ORIGINS != ["*"])
    )
    if not _is_prod_like:
        _cfg_logger.warning(
            "%s 当前为开发/演示模式，CORS 允许任意来源。生产部署请通过 .env 设置：%sDISABLE_DEMO_USER=1、CORS_ORIGINS=https://你的域名%s",
            _WARN, _YEL, _RST,
        )
    if ADMIN_DEFAULT_PASSWORD == "123456" and not DISABLE_DEFAULT_ADMIN:
        _cfg_logger.warning(
            "%s 默认管理员密码仍为 123456！生产部署前请在 .env 设置 %sADMIN_PASSWORD=<强密码>%s，或设置 DISABLE_DEFAULT_ADMIN=1 后手动创建首个管理员。",
            _WARN, _YEL, _RST,
        )
    if DEMO_ACCOUNT.get("password") == "123456" and not DISABLE_DEMO_USER:
        _cfg_logger.warning(
            "%s Demo 账号（%s/%s）仍处于启用状态！生产部署请在 .env 设置 %sDISABLE_DEMO_USER=1%s 关闭自动创建。",
            _WARN, DEMO_ACCOUNT.get("account_no"), DEMO_ACCOUNT.get("password"), _YEL, _RST,
        )
    if JWT_SECRET in {"", "dev_secret_change_me_in_production", "change_me", "please_change_me"}:
        _cfg_logger.warning("%s JWT_SECRET 使用弱占位符！生产部署前请替换为高熵随机字符串。", _WARN)
except Exception as _e:
    _cfg_logger.info("安全自检输出跳过: %s", _e)

REMINDER_STATUSES = ["未完成", "已完成", "已确认"]
RENEW_MODES = ["30d", "1y"]

EXPORT_MAX_PAGE_SIZE = 200
DEFAULT_PAGE_SIZE = 50
IMPORT_MAX_ROWS = 5000
APP_VERSION = "rent-admin-v1.0"
DB_VERSION = "1.0"
