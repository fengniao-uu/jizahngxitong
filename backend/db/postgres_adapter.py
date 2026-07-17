import re
import os
from contextlib import contextmanager
from typing import Optional, List, Dict, Any
import datetime as dt
from urllib.parse import urlparse, unquote

_PSYCOPG2_OK = False
_PG8000_OK = False
_pg_errors_duplicates = ()
_pg_connect_fn = None

try:
    import psycopg2
    from psycopg2 import errors as pg_errors
    _PSYCOPG2_OK = True
    _pg_errors_duplicates = (pg_errors.DuplicateTable, pg_errors.DuplicateObject, pg_errors.UniqueViolation)
    def _psycopg2_connect(url: str):
        conn = psycopg2.connect(url)
        conn.autocommit = False
        return conn
    _pg_connect_fn = _psycopg2_connect
except ImportError:
    try:
        import pg8000
        import pg8000.dbapi
        _PG8000_OK = True
        class _Pg8000DummyErrors:
            class DuplicateTable(Exception): pass
            class DuplicateObject(Exception): pass
            class UniqueViolation(Exception): pass
        pg_errors = _Pg8000DummyErrors()
        _pg_errors_duplicates = (
            pg8000.dbapi.ProgrammingError,
            pg8000.dbapi.IntegrityError,
        )
        def _parse_pg_url(url: str) -> Dict[str, Any]:
            p = urlparse(url)
            return {
                "host": p.hostname or "localhost",
                "port": int(p.port or 5432),
                "user": unquote(p.username) if p.username else None,
                "password": unquote(p.password) if p.password else None,
                "database": (p.path or "").lstrip("/") or None,
            }
        def _pg8000_connect(url: str):
            kw = _parse_pg_url(url)
            if kw.get("user") is None:
                kw["user"] = os.getenv("PGUSER") or "postgres"
            if kw.get("password") is None:
                kw["password"] = os.getenv("PGPASSWORD") or ""
            if kw.get("database") is None:
                kw["database"] = os.getenv("PGDATABASE") or kw["user"] or "postgres"
            sslmode = os.getenv("PGSSLMODE") or "require"
            kw["ssl_context"] = True
            if sslmode in ("disable", "allow", "prefer"):
                kw["ssl_context"] = None
            conn = pg8000.dbapi.connect(**kw)
            conn.autocommit = False
            return conn
        _pg_connect_fn = _pg8000_connect
    except ImportError:
        _pg_errors_duplicates = ()
        _pg_connect_fn = None

from . import DatabaseAdapter
import config


SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,
    account_no CHAR(6) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_login_at TIMESTAMP,
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    last_failed_at TIMESTAMP,
    locked_until TIMESTAMP,
    nickname VARCHAR(32) NOT NULL DEFAULT '',
    phone VARCHAR(20) NOT NULL DEFAULT '',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    role INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS categories (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type CHAR(4) NOT NULL CHECK(type IN ('收入','支出')),
    name VARCHAR(20) NOT NULL,
    is_system BOOLEAN NOT NULL DEFAULT FALSE,
    sort INTEGER NOT NULL DEFAULT 0,
    disabled BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE(user_id, type, name)
);
CREATE INDEX IF NOT EXISTS idx_categories_user_type ON categories(user_id, type);

CREATE TABLE IF NOT EXISTS transactions (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type CHAR(4) NOT NULL CHECK(type IN ('收入','支出')),
    category VARCHAR(20) NOT NULL,
    amount DECIMAL(12,2) NOT NULL CHECK(amount > 0),
    description VARCHAR(200) NOT NULL DEFAULT '',
    room_no VARCHAR(20) NOT NULL DEFAULT '',
    trans_date DATE NOT NULL,
    tag VARCHAR(50) NOT NULL DEFAULT '',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS idx_tx_user_date ON transactions(user_id, trans_date DESC);
CREATE INDEX IF NOT EXISTS idx_tx_user_cat ON transactions(user_id, category);
CREATE INDEX IF NOT EXISTS idx_tx_user_room ON transactions(user_id, room_no);

CREATE TABLE IF NOT EXISTS reminders (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    room_no VARCHAR(20) NOT NULL,
    rent_amount DECIMAL(12,2) NOT NULL CHECK(rent_amount >= 0),
    due_date DATE NOT NULL,
    lease_end_date DATE,
    status VARCHAR(10) NOT NULL DEFAULT '未完成' CHECK(status IN ('未完成','已完成','已确认')),
    remark VARCHAR(200) NOT NULL DEFAULT '',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS idx_rem_user_due ON reminders(user_id, due_date);

CREATE TABLE IF NOT EXISTS session_logs (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
    login_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ip VARCHAR(64) NOT NULL DEFAULT '',
    user_agent VARCHAR(512) NOT NULL DEFAULT '',
    jti CHAR(36) UNIQUE,
    revoked BOOLEAN NOT NULL DEFAULT FALSE,
    fail_reason VARCHAR(40) NOT NULL DEFAULT '',
    is_success BOOLEAN NOT NULL DEFAULT TRUE,
    attempt_account CHAR(6) NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON session_logs(user_id);

CREATE TABLE IF NOT EXISTS captcha_store (
    id CHAR(32) PRIMARY KEY,
    code_hash CHAR(64) NOT NULL,
    salt CHAR(16) NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    used BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_captcha_exp ON captcha_store(expires_at);

CREATE TABLE IF NOT EXISTS announcements (
    id BIGSERIAL PRIMARY KEY,
    title VARCHAR(80) NOT NULL,
    content TEXT NOT NULL,
    banner_level VARCHAR(10) NOT NULL DEFAULT 'info' CHECK(banner_level IN ('info','success','warning','danger')),
    priority INTEGER NOT NULL DEFAULT 0,
    is_pinned BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    effective_at TIMESTAMP,
    expire_at TIMESTAMP,
    created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS idx_ann_active ON announcements(is_active, is_deleted);
"""


def _row_to_dict(cursor, row) -> Optional[Dict[str, Any]]:
    if row is None:
        return None
    cols = [d.name for d in cursor.description]
    return dict(zip(cols, row))


def _rows_to_dict(cursor, rows) -> List[Dict[str, Any]]:
    if not rows:
        return []
    cols = [d.name for d in cursor.description]
    return [dict(zip(cols, r)) for r in rows]


def _first_col_name_from_info(table_name: str, conn) -> set:
    with conn.cursor() as c:
        c.execute(
            "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=%s",
            (table_name,),
        )
        return {r[0] for r in c.fetchall()}


class PostgresAdapter(DatabaseAdapter):
    def __init__(self):
        self._db_url = config.DATABASE_URL
        self.init_schema()

    # ---------------- 连接管理 --------------------
    @contextmanager
    def _conn(self):
        if _pg_connect_fn is None:
            raise RuntimeError("未找到可用的 PostgreSQL 驱动，请安装 psycopg2-binary 或 pg8000")
        conn = _pg_connect_fn(self._db_url)
        try:
            yield conn
            if not conn.autocommit:
                conn.commit()
        except Exception:
            try:
                conn.rollback()
            except Exception:
                pass
            raise
        finally:
            try:
                conn.close()
            except Exception:
                pass

    @staticmethod
    def _is_duplicate_err(exc: BaseException) -> bool:
        if isinstance(exc, _pg_errors_duplicates):
            msg = (str(getattr(exc, "args", ("",))[0]) if getattr(exc, "args", None) else str(exc)).lower()
            if _PSYCOPG2_OK:
                return True
            if _PG8000_OK:
                return any(k in msg for k in ("already exists", "duplicate", "relation ", "constraint", "unique_violation", "42p07", "42710", "23505"))
        return False

    # ---------------- schema --------------------
    def init_schema(self) -> None:
        with self._conn() as conn:
            with conn.cursor() as c:
                for stmt in SCHEMA_SQL.strip().split(";"):
                    stmt = stmt.strip()
                    if not stmt:
                        continue
                    try:
                        c.execute(stmt)
                    except Exception as e:
                        if self._is_duplicate_err(e):
                            try:
                                conn.rollback()
                            except Exception:
                                pass
                            continue
                        raise
            # ===== 兼容老库缺列 =====
            try:
                u_cols = _first_col_name_from_info("users", conn)
                for col_sql in [
                    "ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_attempts INTEGER NOT NULL DEFAULT 0",
                    "ALTER TABLE users ADD COLUMN IF NOT EXISTS last_failed_at TIMESTAMP",
                    "ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMP",
                    "ALTER TABLE users ADD COLUMN IF NOT EXISTS nickname VARCHAR(32) NOT NULL DEFAULT ''",
                    "ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(20) NOT NULL DEFAULT ''",
                    "ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE",
                    "ALTER TABLE users ADD COLUMN IF NOT EXISTS role INTEGER NOT NULL DEFAULT 0",
                ]:
                    try:
                        with conn.cursor() as c:
                            c.execute(col_sql)
                    except Exception:
                        conn.rollback()
                s_cols = _first_col_name_from_info("session_logs", conn)
                for col_sql in [
                    "ALTER TABLE session_logs ADD COLUMN IF NOT EXISTS fail_reason VARCHAR(40) NOT NULL DEFAULT ''",
                    "ALTER TABLE session_logs ADD COLUMN IF NOT EXISTS is_success BOOLEAN NOT NULL DEFAULT TRUE",
                    "ALTER TABLE session_logs ADD COLUMN IF NOT EXISTS attempt_account CHAR(6) NOT NULL DEFAULT ''",
                ]:
                    try:
                        with conn.cursor() as c:
                            c.execute(col_sql)
                    except Exception:
                        conn.rollback()
            except Exception:
                pass
            # ===== 种子管理员 =====
            try:
                self.ensure_admin_seeded()
            except Exception:
                pass

    # ---------------- 种子管理员（兼容SQLite逻辑） --------------------
    def ensure_admin_seeded(self) -> int:
        import re
        from werkzeug.security import generate_password_hash

        admin_acc = str(getattr(config, "ADMIN_DEFAULT_ACCOUNT", "100000") or "100000").strip()[:6]
        admin_pwd = str(getattr(config, "ADMIN_DEFAULT_PASSWORD", "123456") or "123456").strip()[:6]
        admin_role = int(getattr(config, "ROLE_ADMIN", 1))
        disable_default = bool(getattr(config, "DISABLE_DEFAULT_ADMIN", False))
        with self._conn() as conn:
            with conn.cursor() as c:
                c.execute(
                    "SELECT id FROM users WHERE is_deleted = FALSE AND role = %s LIMIT 1",
                    (admin_role,),
                )
                existing = c.fetchone()
                if existing:
                    return int(existing[0])
                if disable_default:
                    import logging
                    logging.getLogger("app").warning(
                        "[seed] DISABLE_DEFAULT_ADMIN=1；当前系统无超级管理员，请通过 ADMIN_ACCOUNT/ADMIN_PASSWORD 设置。"
                    )
                    return 0
                if not re.fullmatch(r"\d{6}", admin_acc) or not re.fullmatch(r"\d{6}", admin_pwd):
                    admin_acc = "100000"
                    admin_pwd = "123456"
                c.execute(
                    "SELECT id, role FROM users WHERE account_no = %s AND is_deleted = FALSE LIMIT 1",
                    (admin_acc,),
                )
                u = c.fetchone()
                if u:
                    if int(u[1] or 0) != admin_role:
                        c.execute("UPDATE users SET role = %s, is_active = TRUE WHERE id = %s", (admin_role, int(u[0])))
                    return int(u[0])
                iters = int(getattr(config, "PBKDF2_ITERATIONS", 260000))
                pwd_hash = generate_password_hash(admin_pwd, method=f"pbkdf2:sha256:{iters}")
                c.execute(
                    "INSERT INTO users(account_no, password_hash, role, nickname, is_active) VALUES(%s,%s,%s,%s,TRUE) RETURNING id",
                    (admin_acc, pwd_hash, admin_role, "超级管理员"),
                )
                uid = int(c.fetchone()[0])
                cats = getattr(config, "SYSTEM_CATEGORIES", {}) or {}
                for idx, (typ, names) in enumerate(cats.items()):
                    for i, n in enumerate(names or []):
                        c.execute(
                            """
                            INSERT INTO categories(user_id, type, name, is_system, sort)
                            VALUES(%s,%s,%s,TRUE,%s)
                            ON CONFLICT (user_id, type, name) DO NOTHING
                            """,
                            (uid, typ, n, idx * 100 + i),
                        )
                try:
                    import logging
                    logging.getLogger("app").warning("=" * 68)
                    logging.getLogger("app").warning(
                        "[seed] 已自动创建默认管理员【账号=%s / 密码=%s】—— 请立即登录并修改密码！",
                        admin_acc, admin_pwd,
                    )
                    logging.getLogger("app").warning("=" * 68)
                except Exception:
                    pass
                return uid

    # ---------------- 用户管理 --------------------
    def get_user_by_account(self, account_no: str) -> Optional[Dict[str, Any]]:
        with self._conn() as conn:
            with conn.cursor() as c:
                c.execute(
                    "SELECT * FROM users WHERE account_no = %s AND is_deleted = FALSE LIMIT 1",
                    (account_no,),
                )
                return _row_to_dict(c, c.fetchone())

    def get_user_by_phone(self, phone: str) -> Optional[Dict[str, Any]]:
        with self._conn() as conn:
            with conn.cursor() as c:
                c.execute(
                    "SELECT * FROM users WHERE phone = %s AND is_deleted = FALSE LIMIT 1",
                    (phone,),
                )
                return _row_to_dict(c, c.fetchone())

    def get_user_by_id(self, user_id: int) -> Optional[Dict[str, Any]]:
        with self._conn() as conn:
            with conn.cursor() as c:
                c.execute(
                    "SELECT * FROM users WHERE id = %s AND is_deleted = FALSE LIMIT 1",
                    (int(user_id),),
                )
                return _row_to_dict(c, c.fetchone())

    def create_user(self, account_no: str, password_hash: str, *, role: Optional[int] = None, nickname: str = "", phone: str = "") -> int:
        default_role = int(role) if role is not None else int(getattr(config, "ROLE_USER", 0))
        with self._conn() as conn:
            with conn.cursor() as c:
                c.execute(
                    "INSERT INTO users(account_no, password_hash, role, nickname, phone) VALUES(%s,%s,%s,%s,%s) RETURNING id",
                    (account_no, password_hash, default_role, (nickname or "")[:32], (phone or "")[:20]),
                )
                return int(c.fetchone()[0])

    def update_user_last_login(self, user_id: int) -> None:
        with self._conn() as conn:
            with conn.cursor() as c:
                c.execute(
                    "UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = %s",
                    (int(user_id),),
                )

    # ---------------- 登录失败锁定 --------------------
    def check_login_lock_status(self, *, user_id: Optional[int] = None, account_no: Optional[str] = None):
        if not user_id and not account_no:
            return False, None, 0, 0
        with self._conn() as conn:
            with conn.cursor() as c:
                if user_id:
                    c.execute(
                        """SELECT COALESCE(failed_attempts,0), locked_until,
                                  CASE WHEN locked_until IS NOT NULL AND locked_until > CURRENT_TIMESTAMP THEN 1 ELSE 0 END AS is_locked,
                                  CAST(CASE WHEN locked_until IS NOT NULL THEN EXTRACT(EPOCH FROM locked_until) - EXTRACT(EPOCH FROM CURRENT_TIMESTAMP) ELSE 0 END AS INTEGER) AS remain_sec
                           FROM users WHERE id = %s AND is_deleted = FALSE LIMIT 1""",
                        (int(user_id),),
                    )
                    row = c.fetchone()
                else:
                    c.execute(
                        """SELECT COALESCE(failed_attempts,0), locked_until,
                                  CASE WHEN locked_until IS NOT NULL AND locked_until > CURRENT_TIMESTAMP THEN 1 ELSE 0 END AS is_locked,
                                  CAST(CASE WHEN locked_until IS NOT NULL THEN EXTRACT(EPOCH FROM locked_until) - EXTRACT(EPOCH FROM CURRENT_TIMESTAMP) ELSE 0 END AS INTEGER) AS remain_sec
                           FROM users WHERE account_no = %s AND is_deleted = FALSE LIMIT 1""",
                        (str(account_no).strip()[:6],),
                    )
                    row = c.fetchone()
        if not row:
            return False, None, 0, 0
        failed = int(row[0] or 0)
        locked = bool(row[2])
        remain = max(0, int(row[3] or 0))
        locked_until = row[1] if locked else None
        if not locked and remain <= 0:
            locked_until = None
        return locked, locked_until, failed, remain

    def increment_login_failure(self, *, user_id: Optional[int], account_no: Optional[str] = None) -> int:
        with self._conn() as conn:
            with conn.cursor() as c:
                if user_id:
                    c.execute("SELECT COALESCE(failed_attempts,0) FROM users WHERE id = %s AND is_deleted = FALSE LIMIT 1", (int(user_id),))
                    row = c.fetchone()
                    cond, val = "id = %s", int(user_id)
                elif account_no:
                    c.execute("SELECT COALESCE(failed_attempts,0), id FROM users WHERE account_no = %s AND is_deleted = FALSE LIMIT 1", (str(account_no).strip()[:6],))
                    row = c.fetchone()
                    if row:
                        user_id = int(row[1])
                    cond, val = "account_no = %s", str(account_no).strip()[:6]
                else:
                    return 0
                if not row:
                    return 0
                current = int(row[0] or 0) + 1
                upd_sql = ["UPDATE users SET failed_attempts = %s, last_failed_at = CURRENT_TIMESTAMP"]
                params: List[Any] = [current]
                if current >= int(getattr(config, "LOGIN_MAX_FAILS_BEFORE_LOCK", 3)):
                    if bool(getattr(config, "LOGIN_PERMANENT_LOCK", True)):
                        lock_until_str = "9999-12-31 23:59:59"
                    else:
                        lock_until = dt.datetime.utcnow() + dt.timedelta(minutes=int(getattr(config, "LOGIN_LOCK_MINUTES", 15)))
                        lock_until_str = lock_until.strftime("%Y-%m-%d %H:%M:%S")
                    upd_sql.append(", locked_until = %s")
                    params.append(lock_until_str)
                upd_sql.append(f" WHERE {cond}")
                params.append(val)
                try:
                    c.execute("".join(upd_sql), params)
                except Exception:
                    pass
                return current

    def reset_login_failures(self, user_id: int) -> None:
        with self._conn() as conn:
            with conn.cursor() as c:
                try:
                    c.execute(
                        "UPDATE users SET failed_attempts = 0, last_failed_at = NULL, locked_until = NULL WHERE id = %s",
                        (int(user_id),),
                    )
                except Exception:
                    pass

    # ---------------- 管理员 --------------------
    def admin_unlock_user(self, target_user_id: int) -> int:
        if not target_user_id or int(target_user_id) <= 0:
            return 0
        with self._conn() as conn:
            with conn.cursor() as c:
                c.execute(
                    "UPDATE users SET failed_attempts = 0, last_failed_at = NULL, locked_until = NULL WHERE id = %s AND is_deleted = FALSE",
                    (int(target_user_id),),
                )
                return int(getattr(c, "rowcount", 0) or 0)

    def admin_set_password(self, target_user_id: int, new_hash: str) -> int:
        if not target_user_id or int(target_user_id) <= 0:
            return 0
        if not new_hash or len(str(new_hash)) < 10:
            return 0
        with self._conn() as conn:
            with conn.cursor() as c:
                c.execute(
                    "UPDATE users SET password_hash = %s, failed_attempts = 0, last_failed_at = NULL, locked_until = NULL WHERE id = %s AND is_deleted = FALSE",
                    (str(new_hash), int(target_user_id)),
                )
                return int(getattr(c, "rowcount", 0) or 0)

    def admin_set_role(self, target_user_id: int, new_role: int) -> int:
        role_user = int(getattr(config, "ROLE_USER", 0))
        role_admin = int(getattr(config, "ROLE_ADMIN", 1))
        new_role_i = role_admin if int(new_role) >= 1 else role_user
        with self._conn() as conn:
            with conn.cursor() as c:
                if new_role_i == role_user:
                    c.execute(
                        "SELECT COUNT(*) FROM users WHERE is_deleted = FALSE AND role = %s AND id <> %s",
                        (role_admin, int(target_user_id)),
                    )
                    others = c.fetchone()
                    if int(others[0] or 0) <= 0:
                        return -1
                c.execute("UPDATE users SET role = %s WHERE id = %s AND is_deleted = FALSE", (new_role_i, int(target_user_id)))
                return int(getattr(c, "rowcount", 0) or 0)

    def admin_set_active(self, target_user_id: int, *, new_active: int, operator_uid: int = 0) -> int:
        role_admin = int(getattr(config, "ROLE_ADMIN", 1))
        target = int(target_user_id)
        new_active_i = 1 if int(new_active or 0) >= 1 else 0
        op = int(operator_uid or 0)
        if target <= 0:
            return 0
        if new_active_i == 0 and target == op:
            return -2
        with self._conn() as conn:
            with conn.cursor() as c:
                if new_active_i == 0:
                    c.execute(
                        "SELECT role FROM users WHERE id = %s AND is_deleted = FALSE LIMIT 1",
                        (target,),
                    )
                    info = c.fetchone()
                    if info and int(info[0] or 0) == role_admin:
                        c.execute(
                            "SELECT COUNT(*) FROM users WHERE is_deleted = FALSE AND role = %s AND id <> %s AND is_active = TRUE",
                            (role_admin, target),
                        )
                        rest = c.fetchone()
                        if int(rest[0] or 0) <= 0:
                            return -3
                c.execute(
                    "UPDATE users SET is_active = %s WHERE id = %s AND is_deleted = FALSE",
                    (new_active_i, target),
                )
                rows = int(getattr(c, "rowcount", 0) or 0)
                if rows > 0 and new_active_i == 0:
                    try:
                        c.execute(
                            "UPDATE session_logs SET revoked = TRUE WHERE user_id = %s AND COALESCE(revoked,FALSE)=FALSE",
                            (target,),
                        )
                    except Exception:
                        pass
                return rows

    def admin_soft_delete(self, target_user_id: int, *, operator_uid: int = 0) -> int:
        """管理员硬删（级联删除，不可恢复）；禁止删除自己；禁止删除最后一名超级管理员；返回 DELETE 行数或负数"""
        role_admin = int(getattr(config, "ROLE_ADMIN", 1))
        if int(target_user_id) <= 0:
            return 0
        if int(target_user_id) == int(operator_uid):
            return -2
        with self._conn() as conn:
            with conn.cursor() as c:
                c.execute("SELECT role FROM users WHERE id = %s AND is_deleted = FALSE LIMIT 1", (int(target_user_id),))
                info = c.fetchone()
                if info and int(info[0] or 0) == role_admin:
                    c.execute(
                        "SELECT COUNT(*) FROM users WHERE is_deleted = FALSE AND role = %s AND id <> %s",
                        (role_admin, int(target_user_id)),
                    )
                    rest = c.fetchone()
                    if int(rest[0] or 0) <= 0:
                        return -3
                # 级联删除用户及其关联数据（硬删除，不可恢复）
                c.execute("DELETE FROM transactions WHERE user_id = %s", (int(target_user_id),))
                c.execute("DELETE FROM reminders WHERE user_id = %s", (int(target_user_id),))
                c.execute("DELETE FROM categories WHERE user_id = %s", (int(target_user_id),))
                c.execute("DELETE FROM session_logs WHERE user_id = %s", (int(target_user_id),))
                c.execute("DELETE FROM users WHERE id = %s AND is_deleted = FALSE", (int(target_user_id),))
                return int(getattr(c, "rowcount", 0) or 0)

    def admin_list_users(
        self,
        *,
        page: int = 1,
        page_size: int = 50,
        keyword: str = "",
        only_locked: bool = False,
        only_admin: bool = False,
        sort: str = "created_at_desc",
    ) -> Dict[str, Any]:
        role_admin = int(getattr(config, "ROLE_ADMIN", 1))
        page = max(1, int(page or 1))
        page_size = min(max(1, int(page_size or 50)), 500)
        offset = (page - 1) * page_size
        where = ["u.is_deleted = FALSE"]
        params: List[Any] = []
        kw = str(keyword or "").strip()
        if kw:
            where.append("(u.account_no ILIKE %s OR COALESCE(u.nickname,'') ILIKE %s OR COALESCE(u.phone,'') ILIKE %s)")
            kwp = "%" + kw + "%"
            params.extend([kwp, kwp, kwp])
        if only_locked:
            where.append("u.locked_until IS NOT NULL AND u.locked_until > CURRENT_TIMESTAMP")
        if only_admin:
            where.append("u.role = %s")
            params.append(role_admin)
        where_sql = " WHERE " + " AND ".join(where)
        order_allowed = {
            "created_at_desc": "u.created_at DESC, u.id DESC",
            "created_at_asc": "u.created_at ASC, u.id ASC",
            "last_login_desc": "u.last_login_at DESC NULLS LAST, u.id DESC",
            "failed_desc": "COALESCE(u.failed_attempts,0) DESC, u.id DESC",
            "account_asc": "u.account_no ASC, u.id ASC",
        }
        order_sql = order_allowed.get(str(sort or "").strip(), order_allowed["created_at_desc"])
        with self._conn() as conn:
            with conn.cursor() as c:
                c.execute(f"SELECT COUNT(*) FROM users u{where_sql}", params)
                total = int(c.fetchone()[0] or 0)
                c.execute(
                    f"""SELECT u.id, u.account_no, u.role, u.nickname, u.phone, u.is_active, u.created_at, u.last_login_at,
                               COALESCE(u.failed_attempts,0) AS failed_attempts, u.last_failed_at, u.locked_until,
                               CASE WHEN u.locked_until IS NOT NULL AND u.locked_until > CURRENT_TIMESTAMP THEN 1 ELSE 0 END AS is_locked,
                               CAST(CASE WHEN u.locked_until IS NOT NULL THEN EXTRACT(EPOCH FROM u.locked_until) - EXTRACT(EPOCH FROM CURRENT_TIMESTAMP) ELSE 0 END AS INTEGER) AS lock_remain_sec,
                               (SELECT COUNT(*) FROM transactions t WHERE t.user_id = u.id AND t.deleted = FALSE) AS tx_count,
                               (SELECT COUNT(*) FROM reminders r WHERE r.user_id = u.id AND r.deleted = FALSE) AS rem_count,
                               (SELECT COUNT(*) FROM session_logs s WHERE s.user_id = u.id AND s.is_success = TRUE) AS ok_login_count
                        FROM users u{where_sql}
                        ORDER BY {order_sql}
                        LIMIT %s OFFSET %s""",
                    params + [page_size, offset],
                )
                rows = _rows_to_dict(c, c.fetchall())
        return {"total": total, "page": page, "page_size": page_size, "list": rows}

    def admin_overview_stats(self) -> Dict[str, Any]:
        role_admin = int(getattr(config, "ROLE_ADMIN", 1))
        with self._conn() as conn:
            with conn.cursor() as c:
                c.execute(
                    """SELECT
                         COUNT(*) FILTER (WHERE is_deleted = FALSE) AS total_users,
                         COUNT(*) FILTER (WHERE is_deleted = FALSE AND role = %s) AS admin_count,
                         COUNT(*) FILTER (WHERE is_deleted = FALSE AND locked_until IS NOT NULL AND locked_until > CURRENT_TIMESTAMP) AS locked_count,
                         COUNT(*) FILTER (WHERE is_deleted = FALSE AND DATE(created_at) = CURRENT_DATE) AS new_today,
                         COUNT(*) FILTER (WHERE is_deleted = FALSE AND DATE(last_login_at) = CURRENT_DATE) AS login_today
                       FROM users""",
                    (role_admin,),
                )
                totals = c.fetchone() or (0, 0, 0, 0, 0)
                c.execute(
                    """SELECT
                         COALESCE(SUM(CASE WHEN is_success = TRUE THEN 1 ELSE 0 END),0) AS ok_logins_7d,
                         COALESCE(SUM(CASE WHEN is_success = FALSE THEN 1 ELSE 0 END),0) AS fail_logins_7d
                       FROM session_logs WHERE login_at >= CURRENT_TIMESTAMP - INTERVAL '7 days'"""
                )
                log_counts = c.fetchone() or (0, 0)
                c.execute(
                    """SELECT attempt_account, COUNT(*) AS cnt
                       FROM session_logs
                       WHERE is_success = FALSE AND login_at >= CURRENT_TIMESTAMP - INTERVAL '24 hours' AND attempt_account <> ''
                       GROUP BY attempt_account ORDER BY cnt DESC LIMIT 8"""
                )
                top_fail = c.fetchall() or []
                c.execute(
                    """SELECT fail_reason, COUNT(*) AS cnt
                       FROM session_logs
                       WHERE is_success = FALSE AND login_at >= CURRENT_TIMESTAMP - INTERVAL '7 days'
                       GROUP BY fail_reason ORDER BY cnt DESC"""
                )
                fail_by_reason = c.fetchall() or []
                c.execute(
                    """SELECT DATE(login_at) AS d,
                             COALESCE(SUM(CASE WHEN is_success = TRUE THEN 1 ELSE 0 END),0) AS ok,
                             COALESCE(SUM(CASE WHEN is_success = FALSE THEN 1 ELSE 0 END),0) AS fail
                       FROM session_logs
                       WHERE login_at >= CURRENT_TIMESTAMP - INTERVAL '13 days'
                       GROUP BY DATE(login_at) ORDER BY d ASC"""
                )
                daily_14d = c.fetchall() or []
        return {
            "total_users": int(totals[0] or 0),
            "admin_count": int(totals[1] or 0),
            "locked_count": int(totals[2] or 0),
            "new_today": int(totals[3] or 0),
            "login_today": int(totals[4] or 0),
            "ok_logins_7d": int(log_counts[0] or 0),
            "fail_logins_7d": int(log_counts[1] or 0),
            "fail_rate_7d": (
                round(int(log_counts[1] or 0) * 100.0 / max(1, (int(log_counts[0] or 0) + int(log_counts[1] or 0))), 2)
            ),
            "top_failed_accounts_24h": [
                {"account_no": r[0], "count": int(r[1] or 0)} for r in top_fail
            ],
            "fail_by_reason_7d": [
                {"reason": r[0] or "(other)", "count": int(r[1] or 0)} for r in fail_by_reason
            ],
            "daily_login_14d": [
                {"date": r[0], "ok": int(r[1] or 0), "fail": int(r[2] or 0)} for r in daily_14d
            ],
        }

    def admin_list_session_logs(
        self,
        *,
        page: int = 1,
        page_size: int = 50,
        account_no: str = "",
        only_fail: bool = False,
        fail_reason: str = "",
    ) -> Dict[str, Any]:
        page = max(1, int(page or 1))
        page_size = min(max(1, int(page_size or 50)), 500)
        offset = (page - 1) * page_size
        where = ["TRUE"]
        params: List[Any] = []
        acc = str(account_no or "").strip()
        if acc:
            where.append("(s.attempt_account = %s OR u.account_no = %s)")
            params.extend([acc[:6], acc[:6]])
        if only_fail:
            where.append("s.is_success = FALSE")
        fr = str(fail_reason or "").strip()
        if fr:
            where.append("s.fail_reason = %s")
            params.append(fr)
        where_sql = " WHERE " + " AND ".join(where)
        with self._conn() as conn:
            with conn.cursor() as c:
                c.execute(
                    "SELECT COUNT(*) FROM session_logs s LEFT JOIN users u ON u.id = s.user_id" + where_sql,
                    params,
                )
                total = int(c.fetchone()[0] or 0)
                c.execute(
                    f"""SELECT s.id, s.login_at, s.is_success, s.fail_reason, s.attempt_account, s.ip,
                              s.user_agent, u.account_no AS user_account, u.nickname AS user_nickname
                       FROM session_logs s LEFT JOIN users u ON u.id = s.user_id
                       {where_sql}
                       ORDER BY s.id DESC LIMIT %s OFFSET %s""",
                    params + [page_size, offset],
                )
                rows = _rows_to_dict(c, c.fetchall())
        return {"total": total, "page": page, "page_size": page_size, "list": rows}

    def delete_user_cascade(self, user_id: int) -> None:
        with self._conn() as conn:
            with conn.cursor() as c:
                c.execute("DELETE FROM transactions WHERE user_id = %s", (user_id,))
                c.execute("DELETE FROM reminders WHERE user_id = %s", (user_id,))
                c.execute("DELETE FROM categories WHERE user_id = %s", (user_id,))
                c.execute("DELETE FROM session_logs WHERE user_id = %s", (user_id,))
                c.execute("DELETE FROM users WHERE id = %s", (user_id,))

    def change_password(self, user_id: int, new_hash: str) -> None:
        with self._conn() as conn:
            with conn.cursor() as c:
                c.execute("UPDATE users SET password_hash = %s WHERE id = %s", (new_hash, int(user_id)))

    def upsert_system_categories_for_user(self, user_id: int) -> None:
        with self._conn() as conn:
            with conn.cursor() as c:
                for idx, (typ, names) in enumerate(getattr(config, "SYSTEM_CATEGORIES", {}).items() or {}):
                    for i, n in enumerate(names or []):
                        c.execute(
                            """INSERT INTO categories(user_id, type, name, is_system, sort)
                               VALUES(%s,%s,%s,TRUE,%s)
                               ON CONFLICT (user_id, type, name) DO NOTHING""",
                            (user_id, typ, n, idx * 100 + i),
                        )

    # ---------------- session / captcha --------------------
    def insert_session_log(
        self,
        user_id: int,
        jti: str,
        ip: str,
        ua: str,
        *,
        is_success: bool = True,
        fail_reason: str = "",
        attempt_account: str = "",
    ) -> None:
        import uuid as _uuid
        jti_final = (jti or "").strip() or _uuid.uuid4().hex
        if not is_success:
            jti_final = "F-" + _uuid.uuid4().hex[:35]
        uid = int(user_id) if user_id else None
        with self._conn() as conn:
            with conn.cursor() as c:
                try:
                    c.execute(
                        """INSERT INTO session_logs(user_id, jti, ip, user_agent, is_success, fail_reason, attempt_account)
                           VALUES(%s,%s,%s,%s,%s,%s,%s)""",
                        (
                            uid,
                            jti_final[:36],
                            (ip or "")[:64],
                            (ua or "")[:512],
                            True if is_success else False,
                            str(fail_reason or "")[:40],
                            str(attempt_account or "")[:6],
                        ),
                    )
                except Exception:
                    try:
                        c.execute(
                            """INSERT INTO session_logs(user_id, jti, ip, user_agent, is_success, fail_reason, attempt_account)
                               VALUES(0,%s,%s,%s,FALSE,%s,%s)""",
                            (jti_final[:36], (ip or "")[:64], (ua or "")[:512],
                             str(fail_reason or "")[:40], str(attempt_account or "")[:6]),
                        )
                    except Exception:
                        pass

    def revoke_jti(self, jti: str) -> None:
        with self._conn() as conn:
            with conn.cursor() as c:
                c.execute("UPDATE session_logs SET revoked = TRUE WHERE jti = %s", (jti,))

    def is_jti_revoked(self, jti: str) -> bool:
        with self._conn() as conn:
            with conn.cursor() as c:
                c.execute("SELECT revoked FROM session_logs WHERE jti = %s LIMIT 1", (jti,))
                row = c.fetchone()
                return not row or bool(row[0])

    def create_captcha(self, captcha_id: str, code_hash: str, salt: str, expires_at_iso: str) -> None:
        with self._conn() as conn:
            with conn.cursor() as c:
                try:
                    c.execute(
                        "DELETE FROM captcha_store WHERE expires_at < CURRENT_TIMESTAMP",
                    )
                except Exception:
                    pass
                c.execute(
                    "INSERT INTO captcha_store(id, code_hash, salt, expires_at) VALUES(%s,%s,%s,%s)",
                    (captcha_id[:32], code_hash[:64], salt[:16], expires_at_iso),
                )

    def verify_and_consume_captcha(self, captcha_id: str, input_upper: str, now_iso: str) -> int:
        if not captcha_id or not input_upper:
            return 1
        captcha_id = str(captcha_id).strip()[:32]
        import hashlib
        with self._conn() as conn:
            with conn.cursor() as c:
                c.execute(
                    "SELECT id, code_hash, salt, used, expires_at FROM captcha_store WHERE id = %s LIMIT 1",
                    (captcha_id,),
                )
                row = c.fetchone()
                if not row:
                    return 1
                _id, code_hash, salt, used, expires_at = row
                if used:
                    return 1
                if not expires_at or str(expires_at) < str(now_iso):
                    try:
                        c.execute("DELETE FROM captcha_store WHERE id = %s", (captcha_id,))
                    except Exception:
                        pass
                    return 1
                inp_hash = hashlib.sha256((str(salt) + str(input_upper).strip().upper()).encode("utf-8")).hexdigest()
                matched = (inp_hash == str(code_hash))
                try:
                    c.execute("UPDATE captcha_store SET used = TRUE WHERE id = %s", (captcha_id,))
                except Exception:
                    pass
                return 0 if matched else 2

    # ---------------- transactions --------------------
    def list_transactions(
        self,
        user_id: int,
        filters: Dict[str, Any],
        page: int,
        page_size: int,
    ) -> Dict[str, Any]:
        page = max(1, int(page or 1))
        page_size = min(max(1, int(page_size or int(getattr(config, "DEFAULT_PAGE_SIZE", 50)))), int(getattr(config, "EXPORT_MAX_PAGE_SIZE", 200)))
        offset = (page - 1) * page_size
        where = ["user_id = %s", "deleted = FALSE"]
        params: List[Any] = [int(user_id)]
        if filters.get("type"):
            where.append("type = %s"); params.append(filters["type"])
        if filters.get("category"):
            where.append("category = %s"); params.append(filters["category"])
        if filters.get("room_no"):
            where.append("room_no ILIKE %s"); params.append("%" + filters["room_no"] + "%")
        if filters.get("keyword"):
            kw = "%" + filters["keyword"] + "%"
            where.append("(description ILIKE %s OR category ILIKE %s OR room_no ILIKE %s)")
            params.extend([kw, kw, kw])
        for fk in ("start_date", "date_from"):
            if filters.get(fk):
                where.append("trans_date >= %s"); params.append(filters[fk])
                break
        for fk in ("end_date", "date_to"):
            if filters.get(fk):
                where.append("trans_date <= %s"); params.append(filters[fk])
                break
        where_sql = " WHERE " + " AND ".join(where)
        with self._conn() as conn:
            with conn.cursor() as c:
                c.execute("SELECT COUNT(*) FROM transactions" + where_sql, params)
                cnt = int(c.fetchone()[0] or 0)
                c.execute(
                    """SELECT
                         COALESCE(SUM(CASE WHEN type = '收入' THEN amount ELSE 0 END), 0) AS total_income,
                         COALESCE(SUM(CASE WHEN type = '支出' THEN amount ELSE 0 END), 0) AS total_expense
                       FROM transactions""" + where_sql,
                    params,
                )
                sm_row = c.fetchone() or (0, 0)
                c.execute(
                    """SELECT id, type, category, amount, description, room_no, trans_date, tag, created_at
                       FROM transactions"""
                    + where_sql
                    + " ORDER BY trans_date DESC, id DESC LIMIT %s OFFSET %s",
                    params + [page_size, offset],
                )
                rows = _rows_to_dict(c, c.fetchall())
        total_income = round(float(sm_row[0] or 0), 2)
        total_expense = round(float(sm_row[1] or 0), 2)
        return {
            "total": cnt,
            "page": page,
            "page_size": page_size,
            "list": rows,
            "summary": {
                "total_income": total_income,
                "total_expense": total_expense,
                "net": round(total_income - total_expense, 2),
            },
        }

    def get_transaction(self, user_id: int, tx_id: int) -> Optional[Dict[str, Any]]:
        with self._conn() as conn:
            with conn.cursor() as c:
                c.execute(
                    """SELECT id, type, category, amount, description, room_no, trans_date, tag, created_at
                       FROM transactions WHERE id = %s AND user_id = %s AND deleted = FALSE LIMIT 1""",
                    (int(tx_id), int(user_id)),
                )
                return _row_to_dict(c, c.fetchone())

    def create_transaction(self, user_id: int, payload: Dict[str, Any]) -> int:
        with self._conn() as conn:
            with conn.cursor() as c:
                c.execute(
                    """INSERT INTO transactions(user_id, type, category, amount, description, room_no, trans_date, tag)
                       VALUES(%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id""",
                    (
                        int(user_id),
                        payload["type"],
                        payload["category"],
                        float(payload["amount"]),
                        payload.get("description", "") or "",
                        payload.get("room_no", "") or "",
                        payload["trans_date"],
                        payload.get("tag", "") or "",
                    ),
                )
                return int(c.fetchone()[0])

    def update_transaction(self, user_id: int, tx_id: int, payload: Dict[str, Any]) -> bool:
        fields = []
        params = []
        for k in ("type", "category", "amount", "description", "room_no", "trans_date", "tag"):
            if k in payload:
                fields.append(f"{k} = %s")
                params.append(float(payload[k]) if k == "amount" else payload[k])
        if not fields:
            return True
        fields.append("updated_at = CURRENT_TIMESTAMP")
        params.extend([int(tx_id), int(user_id)])
        with self._conn() as conn:
            with conn.cursor() as c:
                c.execute(
                    f"UPDATE transactions SET {', '.join(fields)} WHERE id = %s AND user_id = %s AND deleted = FALSE",
                    params,
                )
                return (c.rowcount or 0) > 0

    def delete_transaction(self, user_id: int, tx_id: int) -> bool:
        with self._conn() as conn:
            with conn.cursor() as c:
                c.execute(
                    "UPDATE transactions SET deleted = TRUE WHERE id = %s AND user_id = %s AND deleted = FALSE",
                    (int(tx_id), int(user_id)),
                )
                return (c.rowcount or 0) > 0

    def delete_transactions_batch(self, user_id: int, ids: List[int]) -> int:
        if not ids:
            return 0
        ids = [int(x) for x in ids]
        qs = ",".join(["%s"] * len(ids))
        with self._conn() as conn:
            with conn.cursor() as c:
                c.execute(
                    f"UPDATE transactions SET deleted = TRUE WHERE user_id = %s AND deleted = FALSE AND id IN ({qs})",
                    [int(user_id), *ids],
                )
                return int(c.rowcount or 0)

    # ---------------- categories --------------------
    def list_categories_grouped(self, user_id: int) -> Dict[str, List[Dict[str, Any]]]:
        with self._conn() as conn:
            with conn.cursor() as c:
                c.execute(
                    """SELECT id, type, name, is_system, sort, disabled FROM categories
                       WHERE user_id = %s AND disabled = FALSE ORDER BY type, sort, id""",
                    (int(user_id),),
                )
                rows = _rows_to_dict(c, c.fetchall())
        grouped: Dict[str, List[Dict[str, Any]]] = {"收入": [], "支出": []}
        for r in rows:
            grouped.setdefault(r["type"], []).append(r)
        return grouped

    # ---------------- reminders --------------------
    def list_reminders(self, user_id: int, filters: Dict[str, Any]) -> List[Dict[str, Any]]:
        where = ["user_id = %s", "deleted = FALSE"]
        params: List[Any] = [int(user_id)]
        if filters.get("status"):
            where.append("status = %s"); params.append(filters["status"])
        if filters.get("room_no"):
            where.append("room_no ILIKE %s"); params.append("%" + filters["room_no"] + "%")
        if filters.get("keyword"):
            kw = "%" + filters["keyword"] + "%"
            where.append("(room_no ILIKE %s OR remark ILIKE %s)")
            params.extend([kw, kw])
        where_sql = " WHERE " + " AND ".join(where)
        with self._conn() as conn:
            with conn.cursor() as c:
                c.execute(
                    """SELECT id, room_no, rent_amount, due_date, lease_end_date, status, remark, created_at
                       FROM reminders"""
                    + where_sql
                    + " ORDER BY CASE status WHEN '未完成' THEN 0 ELSE 1 END, due_date ASC, id DESC",
                    params,
                )
                return _rows_to_dict(c, c.fetchall())

    def get_reminder(self, user_id: int, rem_id: int) -> Optional[Dict[str, Any]]:
        with self._conn() as conn:
            with conn.cursor() as c:
                c.execute(
                    "SELECT * FROM reminders WHERE id = %s AND user_id = %s AND deleted = FALSE LIMIT 1",
                    (int(rem_id), int(user_id)),
                )
                return _row_to_dict(c, c.fetchone())

    def create_reminder(self, user_id: int, payload: Dict[str, Any]) -> int:
        with self._conn() as conn:
            with conn.cursor() as c:
                c.execute(
                    """INSERT INTO reminders(user_id, room_no, rent_amount, due_date, lease_end_date, status, remark)
                       VALUES(%s,%s,%s,%s,%s,%s,%s) RETURNING id""",
                    (
                        int(user_id),
                        payload["room_no"],
                        float(payload["rent_amount"]),
                        payload["due_date"],
                        payload.get("lease_end_date") or None,
                        payload.get("status", "未完成"),
                        payload.get("remark", "") or "",
                    ),
                )
                return int(c.fetchone()[0])

    def update_reminder(self, user_id: int, rem_id: int, payload: Dict[str, Any]) -> bool:
        fields = []
        params = []
        for k in ("room_no", "rent_amount", "due_date", "lease_end_date", "status", "remark"):
            if k in payload:
                fields.append(f"{k} = %s")
                params.append(float(payload[k]) if k == "rent_amount" else payload[k])
        if not fields:
            return True
        fields.append("updated_at = CURRENT_TIMESTAMP")
        params.extend([int(rem_id), int(user_id)])
        with self._conn() as conn:
            with conn.cursor() as c:
                c.execute(
                    f"UPDATE reminders SET {', '.join(fields)} WHERE id = %s AND user_id = %s AND deleted = FALSE",
                    params,
                )
                return (c.rowcount or 0) > 0

    def delete_reminder(self, user_id: int, rem_id: int) -> bool:
        with self._conn() as conn:
            with conn.cursor() as c:
                c.execute(
                    "UPDATE reminders SET deleted = TRUE WHERE id = %s AND user_id = %s AND deleted = FALSE",
                    (int(rem_id), int(user_id)),
                )
                return (c.rowcount or 0) > 0

    # ---------------- dashboard/stats --------------------
    def aggregate_summary(self, user_id: int) -> Dict[str, Any]:
        today = dt.date.today()
        cur_first = today.replace(day=1)
        if cur_first.month == 12:
            next_first = dt.date(cur_first.year + 1, 1, 1)
            last_first = dt.date(cur_first.year, cur_first.month - 1, 1) if cur_first.month > 1 else dt.date(cur_first.year - 1, 12, 1)
        else:
            next_first = dt.date(cur_first.year, cur_first.month + 1, 1)
            last_first = dt.date(cur_first.year, cur_first.month - 1, 1)
        last_end = cur_first
        cur_s, next_s, last_s, last_end_s = cur_first.isoformat(), next_first.isoformat(), last_first.isoformat(), last_end.isoformat()
        with self._conn() as conn:
            with conn.cursor() as c:
                c.execute(
                    """SELECT
                        COALESCE(SUM(CASE WHEN type = '收入' AND trans_date >= %s AND trans_date < %s THEN amount ELSE 0 END), 0),
                        COALESCE(SUM(CASE WHEN type = '支出' AND trans_date >= %s AND trans_date < %s THEN amount ELSE 0 END), 0),
                        COALESCE(SUM(CASE WHEN type = '收入' AND trans_date >= %s AND trans_date < %s THEN amount ELSE 0 END), 0),
                        COALESCE(SUM(CASE WHEN type = '支出' AND trans_date >= %s AND trans_date < %s THEN amount ELSE 0 END), 0),
                        COALESCE(SUM(CASE WHEN type = '收入' THEN amount ELSE 0 END), 0),
                        COALESCE(SUM(CASE WHEN type = '支出' THEN amount ELSE 0 END), 0)
                       FROM transactions WHERE user_id = %s AND deleted = FALSE""",
                    (cur_s, next_s, cur_s, next_s, last_s, last_end_s, last_s, last_end_s, int(user_id)),
                )
                row = c.fetchone() or (0, 0, 0, 0, 0, 0)
        m_in, m_out, lm_in, lm_out, t_in, t_out = (round(float(x or 0), 2) for x in row)
        total_asset = round(t_in - t_out, 2)
        return {
            "month_income": m_in,
            "current_month_income": m_in,
            "income_month": m_in,
            "month_expense": m_out,
            "current_month_expense": m_out,
            "expense_month": m_out,
            "month_balance": round(m_in - m_out, 2),
            "balance_month": round(m_in - m_out, 2),
            "last_month_income": lm_in,
            "last_month_expense": lm_out,
            "total_income": t_in,
            "total_expense": t_out,
            "total_assets": total_asset,
            "total_asset": total_asset,
            "today": today.isoformat(),
            "first_of_month": cur_s,
            "next_month_first": next_s,
            "last_month_first": last_s,
            "last_month_end": last_end_s,
        }

    def recent_transactions(self, user_id: int, limit: int) -> List[Dict[str, Any]]:
        with self._conn() as conn:
            with conn.cursor() as c:
                c.execute(
                    """SELECT id, type, category, amount, description, room_no, trans_date, created_at
                       FROM transactions WHERE user_id = %s AND deleted = FALSE
                       ORDER BY created_at DESC, id DESC LIMIT %s""",
                    (int(user_id), int(limit or 5)),
                )
                return _rows_to_dict(c, c.fetchall())

    def all_reminders_uncompleted(self, user_id: int) -> List[Dict[str, Any]]:
        with self._conn() as conn:
            with conn.cursor() as c:
                c.execute(
                    """SELECT id, room_no, rent_amount, due_date, lease_end_date, status, remark
                       FROM reminders WHERE user_id = %s AND deleted = FALSE AND status <> '已完成'
                       ORDER BY due_date ASC, id DESC LIMIT 200""",
                    (int(user_id),),
                )
                return _rows_to_dict(c, c.fetchall())

    def trend_12m(self, user_id: int) -> List[Dict[str, Any]]:
        today = dt.date.today()
        months: List[str] = []
        cur = today.replace(day=1)
        for _ in range(12):
            months.append(cur.isoformat()[:7])
            if cur.month == 1:
                cur = cur.replace(year=cur.year - 1, month=12)
            else:
                cur = cur.replace(month=cur.month - 1)
        months = list(reversed(months))
        results: List[Dict[str, Any]] = []
        with self._conn() as conn:
            with conn.cursor() as c:
                for ym in months:
                    y, m = int(ym.split("-")[0]), int(ym.split("-")[1])
                    date_from = f"{y}-{m:02d}-01"
                    if m == 12:
                        date_to = f"{y + 1}-01-01"
                    else:
                        date_to = f"{y}-{m + 1:02d}-01"
                    c.execute(
                        """SELECT
                             COALESCE(SUM(CASE WHEN type='收入' AND trans_date>=%s AND trans_date<%s THEN amount ELSE 0 END),0),
                             COALESCE(SUM(CASE WHEN type='支出' AND trans_date>=%s AND trans_date<%s THEN amount ELSE 0 END),0)
                           FROM transactions WHERE user_id=%s AND deleted=FALSE""",
                        (date_from, date_to, date_from, date_to, int(user_id)),
                    )
                    row = c.fetchone() or (0, 0)
                    results.append({
                        "month": ym,
                        "income": round(float(row[0] or 0), 2),
                        "expense": round(float(row[1] or 0), 2),
                        "net": round(float(row[0] or 0) - float(row[1] or 0), 2),
                    })
        return results

    def category_pie(self, user_id: int, scope_months: int) -> Dict[str, List[Dict[str, Any]]]:
        scope = max(1, int(scope_months or 1))
        start_date = (dt.date.today().replace(day=1) - dt.timedelta(days=1)).replace(day=1)
        for _ in range(scope - 1):
            if start_date.month == 1:
                start_date = start_date.replace(year=start_date.year - 1, month=12)
            else:
                start_date = start_date.replace(month=start_date.month - 1)
        start_s = start_date.isoformat()
        result: Dict[str, List[Dict[str, Any]]] = {"收入": [], "支出": []}
        with self._conn() as conn:
            with conn.cursor() as c:
                for typ in ("收入", "支出"):
                    c.execute(
                        """SELECT category,
                                  COALESCE(SUM(amount),0) AS total,
                                  COUNT(*) AS cnt
                           FROM transactions
                           WHERE user_id=%s AND deleted=FALSE AND type=%s AND trans_date>=%s
                           GROUP BY category ORDER BY total DESC""",
                        (int(user_id), typ, start_s),
                    )
                    rows = c.fetchall() or []
                    result[typ] = [
                        {"category": r[0], "amount": round(float(r[1] or 0), 2), "count": int(r[2] or 0)}
                        for r in rows
                    ]
        return result

    def category_compare(self, user_id: int, scope_months: int) -> Dict[str, Any]:
        scope = max(1, int(scope_months or 1))
        cur_month_first = dt.date.today().replace(day=1)
        this_start = cur_month_first
        for _ in range(scope - 1):
            if this_start.month == 1:
                this_start = this_start.replace(year=this_start.year - 1, month=12)
            else:
                this_start = this_start.replace(month=this_start.month - 1)
        last_end = this_start
        last_start = last_end
        for _ in range(scope):
            if last_start.month == 1:
                last_start = last_start.replace(year=last_start.year - 1, month=12)
            else:
                last_start = last_start.replace(month=last_start.month - 1)
        this_s, last_s, last_end_s = this_start.isoformat(), last_start.isoformat(), last_end.isoformat()
        result: Dict[str, Any] = {
            "this": {"收入": {}, "支出": {}},
            "last": {"收入": {}, "支出": {}},
        }
        with self._conn() as conn:
            with conn.cursor() as c:
                for typ in ("收入", "支出"):
                    c.execute(
                        """SELECT category, COALESCE(SUM(amount),0)
                           FROM transactions WHERE user_id=%s AND deleted=FALSE AND type=%s AND trans_date>=%s AND trans_date<=%s
                           GROUP BY category""",
                        (int(user_id), typ, this_s, "9999-12-31"),
                    )
                    result["this"][typ] = {r[0]: round(float(r[1] or 0), 2) for r in (c.fetchall() or [])}
                    c.execute(
                        """SELECT category, COALESCE(SUM(amount),0)
                           FROM transactions WHERE user_id=%s AND deleted=FALSE AND type=%s AND trans_date>=%s AND trans_date<%s
                           GROUP BY category""",
                        (int(user_id), typ, last_s, last_end_s),
                    )
                    result["last"][typ] = {r[0]: round(float(r[1] or 0), 2) for r in (c.fetchall() or [])}
        return result
