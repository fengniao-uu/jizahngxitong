import sqlite3
from pathlib import Path
from contextlib import contextmanager
from typing import Optional, List, Dict, Any
import datetime as dt
from . import DatabaseAdapter
import config


SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_no CHAR(6) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login_at TIMESTAMP,
    is_deleted BOOLEAN NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type CHAR(4) NOT NULL CHECK(type IN ('收入','支出')),
    name VARCHAR(20) NOT NULL,
    is_system BOOLEAN NOT NULL DEFAULT 0,
    sort INTEGER NOT NULL DEFAULT 0,
    disabled BOOLEAN NOT NULL DEFAULT 0,
    UNIQUE(user_id, type, name)
);
CREATE INDEX IF NOT EXISTS idx_categories_user_type ON categories(user_id, type);

CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type CHAR(4) NOT NULL CHECK(type IN ('收入','支出')),
    category VARCHAR(20) NOT NULL,
    amount DECIMAL(12,2) NOT NULL CHECK(amount > 0),
    description VARCHAR(200) NOT NULL DEFAULT '',
    room_no VARCHAR(20) NOT NULL DEFAULT '',
    trans_date DATE NOT NULL,
    tag VARCHAR(50) NOT NULL DEFAULT '',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deleted BOOLEAN NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_tx_user_date ON transactions(user_id, trans_date DESC);
CREATE INDEX IF NOT EXISTS idx_tx_user_cat ON transactions(user_id, category);
CREATE INDEX IF NOT EXISTS idx_tx_user_room ON transactions(user_id, room_no);

CREATE TABLE IF NOT EXISTS reminders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    room_no VARCHAR(20) NOT NULL,
    rent_amount DECIMAL(12,2) NOT NULL CHECK(rent_amount >= 0),
    due_date DATE NOT NULL,
    lease_end_date DATE,
    status VARCHAR(10) NOT NULL DEFAULT '未完成' CHECK(status IN ('未完成','已完成','已确认')),
    remark VARCHAR(200) NOT NULL DEFAULT '',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deleted BOOLEAN NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_rem_user_due ON reminders(user_id, due_date);

CREATE TABLE IF NOT EXISTS session_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    login_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ip VARCHAR(64) NOT NULL DEFAULT '',
    user_agent VARCHAR(512) NOT NULL DEFAULT '',
    jti CHAR(36) NOT NULL UNIQUE,
    revoked BOOLEAN NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON session_logs(user_id);

CREATE TABLE IF NOT EXISTS captcha_store (
    id CHAR(32) PRIMARY KEY,
    code_hash CHAR(64) NOT NULL,
    salt CHAR(16) NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    used BOOLEAN NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_captcha_exp ON captcha_store(expires_at);

CREATE TABLE IF NOT EXISTS announcements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title VARCHAR(80) NOT NULL,
    content TEXT NOT NULL,
    banner_level VARCHAR(10) NOT NULL DEFAULT 'info' CHECK(banner_level IN ('info','success','warning','danger')),
    priority INTEGER NOT NULL DEFAULT 0,
    is_pinned BOOLEAN NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT 1,
    effective_at TIMESTAMP,
    expire_at TIMESTAMP,
    created_by INTEGER,
    updated_by INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_deleted BOOLEAN NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_ann_active ON announcements(is_active, is_deleted);
"""


def _row_to_dict(cursor, row) -> Dict[str, Any]:
    if row is None:
        return None
    cols = [d[0] for d in cursor.description]
    return dict(zip(cols, row))


def _rows_to_dict(cursor, rows) -> List[Dict[str, Any]]:
    if not rows:
        return []
    cols = [d[0] for d in cursor.description]
    return [dict(zip(cols, r)) for r in rows]


class SQLiteAdapter(DatabaseAdapter):
    def __init__(self, db_path: Optional[Path] = None):
        self.db_path = Path(db_path or config.DB_PATH)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._conn_pool_conn: Optional[sqlite3.Connection] = None
        self.init_schema()

    # ---------------- 连接管理 --------------------
    @contextmanager
    def _conn(self):
        conn = sqlite3.connect(self.db_path, isolation_level=None)
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA journal_mode = WAL")
        conn.row_factory = None
        try:
            yield conn
        finally:
            conn.close()

    # ---------------- schema --------------------
    def init_schema(self) -> None:
        with self._conn() as c:
            c.executescript(SCHEMA_SQL)
            # schema_migration：为老库补列（users 失败锁定 / session_logs 失败记录 + role 角色）
            try:
                cols = {r[1] for r in c.execute("PRAGMA table_info(users)").fetchall()}
                for col_sql in [
                    "ALTER TABLE users ADD COLUMN failed_attempts INTEGER NOT NULL DEFAULT 0",
                    "ALTER TABLE users ADD COLUMN last_failed_at TIMESTAMP",
                    "ALTER TABLE users ADD COLUMN locked_until TIMESTAMP",
                    "ALTER TABLE users ADD COLUMN nickname VARCHAR(32) NOT NULL DEFAULT ''",
                    "ALTER TABLE users ADD COLUMN phone VARCHAR(20) NOT NULL DEFAULT ''",
                    "ALTER TABLE users ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT 1",
                    "ALTER TABLE users ADD COLUMN role INTEGER NOT NULL DEFAULT 0",
                ]:
                    col_name = col_sql.split("ADD COLUMN ")[1].split(" ")[0]
                    if col_name not in cols:
                        try: c.execute(col_sql)
                        except Exception: pass
                s_cols = {r[1] for r in c.execute("PRAGMA table_info(session_logs)").fetchall()}
                for col_sql in [
                    "ALTER TABLE session_logs ADD COLUMN fail_reason VARCHAR(40) NOT NULL DEFAULT ''",
                    "ALTER TABLE session_logs ADD COLUMN is_success BOOLEAN NOT NULL DEFAULT 1",
                    "ALTER TABLE session_logs ADD COLUMN attempt_account CHAR(6) NOT NULL DEFAULT ''",
                ]:
                    col_name = col_sql.split("ADD COLUMN ")[1].split(" ")[0]
                    if col_name not in s_cols:
                        try: c.execute(col_sql)
                        except Exception: pass
            except Exception:
                pass
            # ===== schema OK → 首次部署种子管理员 =====
            try:
                self.ensure_admin_seeded()
            except Exception:
                pass

    # ---------------- 管理员种子数据初始化 --------------------
    def ensure_admin_seeded(self) -> int:
        """确保至少有 1 名超级管理员（role=1）；
        若 users 表中无任何 role=1 记录，则用 config.ADMIN_DEFAULT_ACCOUNT 创建。
        返回超级管理员 user_id（用于启动日志）。

        行为：
        - DISABLE_DEFAULT_ADMIN=1 且已经存在管理员 → 正常返回
        - DISABLE_DEFAULT_ADMIN=1 且还没有管理员 → 返回 0 并打印 WARNING，
          要求用户通过 env 配置 ADMIN_ACCOUNT/ADMIN_PASSWORD 或手动创建首个管理员
        """
        import config
        admin_acc = str(getattr(config, "ADMIN_DEFAULT_ACCOUNT", "100000") or "100000").strip()[:6]
        admin_pwd = str(getattr(config, "ADMIN_DEFAULT_PASSWORD", "123456") or "123456").strip()[:6]
        admin_role = int(getattr(config, "ROLE_ADMIN", 1))
        disable_default = bool(getattr(config, "DISABLE_DEFAULT_ADMIN", False))
        with self._conn() as c:
            existing_admin = c.execute(
                "SELECT id FROM users WHERE is_deleted = 0 AND role = ? LIMIT 1",
                (admin_role,),
            ).fetchone()
            if existing_admin:
                return int(existing_admin[0])
            if disable_default:
                try:
                    import logging
                    logging.getLogger("app").warning(
                        "[seed] DISABLE_DEFAULT_ADMIN=1，跳过默认管理员(100000)创建；"
                        "当前系统还没有任何超级管理员！请通过 ADMIN_ACCOUNT/ADMIN_PASSWORD 环境变量指定，"
                        "或通过 init_db.py 手动创建。"
                    )
                except Exception:
                    pass
                return 0
            import re
            from werkzeug.security import generate_password_hash
            if not re.fullmatch(r"\d{6}", admin_acc) or not re.fullmatch(r"\d{6}", admin_pwd):
                admin_acc = "100000"
                admin_pwd = "123456"
            u = c.execute(
                "SELECT id, role FROM users WHERE account_no = ? AND is_deleted = 0 LIMIT 1",
                (admin_acc,),
            ).fetchone()
            if u:
                if int(u[1] or 0) != admin_role:
                    c.execute("UPDATE users SET role = ?, is_active = 1 WHERE id = ?", (admin_role, int(u[0])))
                return int(u[0])
            iters = int(getattr(config, "PBKDF2_ITERATIONS", 260000))
            pwd_hash = generate_password_hash(admin_pwd, method=f"pbkdf2:sha256:{iters}")
            cur = c.execute(
                "INSERT INTO users(account_no, password_hash, role, nickname, is_active) VALUES(?,?,?,?,1)",
                (admin_acc, pwd_hash, admin_role, "超级管理员"),
            )
            uid = int(getattr(cur, "lastrowid", 0) or 0)
            for idx, (typ, names) in enumerate(getattr(config, "SYSTEM_CATEGORIES", {}).items()):
                for i, n in enumerate(names):
                    c.execute(
                        """INSERT OR IGNORE INTO categories(user_id, type, name, is_system, sort)
                           VALUES(?,?,?,1,?)""",
                        (uid, typ, n, idx * 100 + i),
                    )
            try:
                import logging
                lg = logging.getLogger("app")
                lg.warning(
                    "=" * 68
                )
                lg.warning(
                    "[seed] 已自动创建默认管理员【账号=%s / 密码=%s】"
                    " —— 请立即登录并修改密码！或通过 env DISABLE_DEFAULT_ADMIN=1 禁用本机制。",
                    admin_acc, admin_pwd if not disable_default else "******",
                )
                lg.warning(
                    "=" * 68
                )
            except Exception:
                pass
            return uid

    # ---------------- 用户管理 --------------------
    def get_user_by_account(self, account_no: str) -> Optional[Dict[str, Any]]:
        with self._conn() as c:
            cur = c.execute(
                "SELECT * FROM users WHERE account_no = ? AND is_deleted = 0 LIMIT 1",
                (account_no,),
            )
            return _row_to_dict(cur, cur.fetchone())

    def get_user_by_phone(self, phone: str) -> Optional[Dict[str, Any]]:
        with self._conn() as c:
            cur = c.execute(
                "SELECT * FROM users WHERE phone = ? AND is_deleted = 0 LIMIT 1",
                (phone,),
            )
            return _row_to_dict(cur, cur.fetchone())

    def get_user_by_id(self, user_id: int) -> Optional[Dict[str, Any]]:
        with self._conn() as c:
            cur = c.execute(
                "SELECT * FROM users WHERE id = ? AND is_deleted = 0 LIMIT 1",
                (user_id,),
            )
            return _row_to_dict(cur, cur.fetchone())

    def create_user(self, account_no: str, password_hash: str, *, role: Optional[int] = None, nickname: str = "", phone: str = "") -> int:
        import config
        default_role = int(role) if role is not None else int(getattr(config, "ROLE_USER", 0))
        with self._conn() as c:
            cur = c.execute(
                "INSERT INTO users(account_no, password_hash, role, nickname, phone) VALUES(?,?,?,?,?)",
                (account_no, password_hash, default_role, (nickname or "")[:32], (phone or "")[:20]),
            )
            return int(cur.lastrowid)

    def update_user_last_login(self, user_id: int) -> None:
        with self._conn() as c:
            c.execute(
                "UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?",
                (user_id,),
            )

    # ---------------- users login lock/failure --------------------
    def check_login_lock_status(self, *, user_id: Optional[int] = None, account_no: Optional[str] = None):
        """返回 (locked:bool, locked_until:str|None, failed_attempts:int, remain_seconds:int)"""
        if not user_id and not account_no:
            return False, None, 0, 0
        with self._conn() as c:
            if user_id:
                row = c.execute(
                    "SELECT failed_attempts, locked_until, IFNULL(locked_until,'') AS lu,"
                    " CASE WHEN locked_until IS NOT NULL AND locked_until > datetime('now') THEN 1 ELSE 0 END AS is_locked,"
                    " CAST(CASE WHEN locked_until IS NOT NULL THEN strftime('%s', locked_until) - strftime('%s','now') ELSE 0 END AS INTEGER) AS remain_sec"
                    " FROM users WHERE id = ? AND is_deleted = 0 LIMIT 1",
                    (int(user_id),),
                ).fetchone()
            else:
                row = c.execute(
                    "SELECT failed_attempts, locked_until, IFNULL(locked_until,'') AS lu,"
                    " CASE WHEN locked_until IS NOT NULL AND locked_until > datetime('now') THEN 1 ELSE 0 END AS is_locked,"
                    " CAST(CASE WHEN locked_until IS NOT NULL THEN strftime('%s', locked_until) - strftime('%s','now') ELSE 0 END AS INTEGER) AS remain_sec"
                    " FROM users WHERE account_no = ? AND is_deleted = 0 LIMIT 1",
                    (str(account_no).strip()[:6],),
                ).fetchone()
        if not row:
            return False, None, 0, 0
        failed = int(row[0] or 0)
        locked = bool(row[3])
        remain = max(0, int(row[4] or 0))
        locked_until = row[1] if locked else None
        if not locked and remain <= 0:
            locked_until = None
        return locked, locked_until, failed, remain

    def increment_login_failure(self, *, user_id: Optional[int], account_no: Optional[str] = None) -> int:
        """失败计数+1；达到阈值写 locked_until；返回当前累计失败次数"""
        import datetime as _dt
        with self._conn() as c:
            # 先查询当前状态（兼容老库缺列：COALESCE 默认 0）
            if user_id:
                cur = c.execute("SELECT COALESCE(failed_attempts,0) FROM users WHERE id = ? AND is_deleted = 0 LIMIT 1", (int(user_id),))
                row = cur.fetchone()
                cond, val = "id = ?", int(user_id)
            elif account_no:
                cur = c.execute("SELECT COALESCE(failed_attempts,0), id FROM users WHERE account_no = ? AND is_deleted = 0 LIMIT 1", (str(account_no).strip()[:6],))
                row = cur.fetchone()
                if row:
                    user_id = int(row[1])
                cond, val = "account_no = ?", str(account_no).strip()[:6]
            else:
                return 0
            if not row:
                return 0
            current = int(row[0] or 0) + 1
            upd_sql = ["UPDATE users SET failed_attempts = ?, last_failed_at = datetime('now')"]
            params: List[Any] = [current]
            if current >= config.LOGIN_MAX_FAILS_BEFORE_LOCK:
                if getattr(config, "LOGIN_PERMANENT_LOCK", False):
                    lock_until_str = "9999-12-31 23:59:59"
                else:
                    lock_until = _dt.datetime.utcnow() + _dt.timedelta(minutes=config.LOGIN_LOCK_MINUTES)
                    lock_until_str = lock_until.strftime("%Y-%m-%d %H:%M:%S")
                upd_sql.append(", locked_until = ?")
                params.append(lock_until_str)
            upd_sql.append(" WHERE ")
            upd_sql.append(cond)
            params.append(val)
            try:
                c.execute("".join(upd_sql), params)
            except Exception:
                pass
            return current

    def reset_login_failures(self, user_id: int) -> None:
        """登录成功 → 清零失败计数 + 清除锁定"""
        with self._conn() as c:
            try:
                c.execute(
                    "UPDATE users SET failed_attempts = 0, last_failed_at = NULL, locked_until = NULL WHERE id = ?",
                    (int(user_id),),
                )
            except Exception:
                pass

    # ---------------- 管理员功能：用户/日志管理 --------------------
    def admin_unlock_user(self, target_user_id: int) -> int:
        """管理员解锁目标账号：清零失败计数+清除锁定，返回实际被 UPDATE 的行数（0=不存在，1=成功）"""
        if not target_user_id or int(target_user_id) <= 0:
            return 0
        with self._conn() as c:
            cur = c.execute(
                "UPDATE users SET failed_attempts = 0, last_failed_at = NULL, locked_until = NULL"
                " WHERE id = ? AND is_deleted = 0",
                (int(target_user_id),),
            )
            return int(getattr(cur, "rowcount", 0) or 0)

    def admin_set_password(self, target_user_id: int, new_hash: str) -> int:
        """管理员强制重置密码（不需要原密码），返回 UPDATE 行数"""
        if not target_user_id or int(target_user_id) <= 0:
            return 0
        if not new_hash or len(str(new_hash)) < 10:
            return 0
        with self._conn() as c:
            cur = c.execute(
                "UPDATE users SET password_hash = ?, failed_attempts = 0, last_failed_at = NULL, locked_until = NULL"
                " WHERE id = ? AND is_deleted = 0",
                (str(new_hash), int(target_user_id)),
            )
            return int(getattr(cur, "rowcount", 0) or 0)

    def admin_set_role(self, target_user_id: int, new_role: int) -> int:
        """管理员改角色（0=普通，1=超级管理员）；禁止把系统最后一个超级管理员降级为普通（返回0）"""
        import config
        role_user = int(getattr(config, "ROLE_USER", 0))
        role_admin = int(getattr(config, "ROLE_ADMIN", 1))
        new_role_i = int(new_role)
        new_role_i = role_admin if new_role_i >= 1 else role_user
        with self._conn() as c:
            # 降级为普通前：检查还有多少其他管理员
            if new_role_i == role_user:
                others = c.execute(
                    "SELECT COUNT(*) FROM users WHERE is_deleted = 0 AND role = ? AND id != ?",
                    (role_admin, int(target_user_id)),
                ).fetchone()
                if int(others[0] or 0) <= 0:
                    return -1  # 不能降最后一个管理员
            cur = c.execute(
                "UPDATE users SET role = ? WHERE id = ? AND is_deleted = 0",
                (new_role_i, int(target_user_id)),
            )
            return int(getattr(cur, "rowcount", 0) or 0)

    def admin_set_active(self, target_user_id: int, *, new_active: int, operator_uid: int = 0) -> int:
        """管理员 启用/禁用 用户；禁止禁用自己；禁止禁用最后一名超级管理员；返回 行数或 负数错误码"""
        import config
        role_admin = int(getattr(config, "ROLE_ADMIN", 1))
        target = int(target_user_id)
        new_active_i = 1 if int(new_active or 0) >= 1 else 0
        op = int(operator_uid or 0)
        if target <= 0:
            return 0
        if new_active_i == 0 and target == op:
            return -2  # 不能禁用自己
        with self._conn() as c:
            if new_active_i == 0:
                info = c.execute(
                    "SELECT role FROM users WHERE id = ? AND is_deleted = 0 LIMIT 1",
                    (target,),
                ).fetchone()
                if info and int(info[0] or 0) == role_admin:
                    rest = c.execute(
                        "SELECT COUNT(*) FROM users WHERE is_deleted = 0 AND role = ? AND id != ? AND is_active = 1",
                        (role_admin, target),
                    ).fetchone()
                    if int(rest[0] or 0) <= 0:
                        return -3  # 不能禁用最后一名超级管理员
            cur = c.execute(
                "UPDATE users SET is_active = ? WHERE id = ? AND is_deleted = 0",
                (new_active_i, target),
            )
            rows = int(getattr(cur, "rowcount", 0) or 0)
            if rows > 0 and new_active_i == 0:
                # 禁用的同时：清登录态（把该用户现有未失效的jti标记为revoked），防止他拿着老token继续访问
                try:
                    c.execute(
                        "UPDATE session_logs SET revoked = 1 WHERE user_id = ? AND COALESCE(revoked,0)=0",
                        (target,),
                    )
                except Exception:
                    pass
            return rows

    def admin_soft_delete(self, target_user_id: int, *, operator_uid: int = 0) -> int:
        """管理员硬删（级联删除，不可恢复）；禁止删除自己；禁止删除最后一名超级管理员；返回 DELETE 行数或负数"""
        import config
        role_admin = int(getattr(config, "ROLE_ADMIN", 1))
        if int(target_user_id) <= 0:
            return 0
        if int(target_user_id) == int(operator_uid):
            return -2  # 不能删自己
        with self._conn() as c:
            # 是否最后一名超级管理员
            info = c.execute(
                "SELECT role FROM users WHERE id = ? AND is_deleted = 0 LIMIT 1",
                (int(target_user_id),),
            ).fetchone()
            if info and int(info[0] or 0) == role_admin:
                rest = c.execute(
                    "SELECT COUNT(*) FROM users WHERE is_deleted = 0 AND role = ? AND id != ?",
                    (role_admin, int(target_user_id)),
                ).fetchone()
                if int(rest[0] or 0) <= 0:
                    return -3  # 不能删最后一名超级管理员
            # 级联删除用户及其关联数据（硬删除，不可恢复）
            c.execute("DELETE FROM transactions WHERE user_id = ?", (int(target_user_id),))
            c.execute("DELETE FROM reminders WHERE user_id = ?", (int(target_user_id),))
            c.execute("DELETE FROM categories WHERE user_id = ?", (int(target_user_id),))
            c.execute("DELETE FROM session_logs WHERE user_id = ?", (int(target_user_id),))
            cur = c.execute("DELETE FROM users WHERE id = ? AND is_deleted = 0", (int(target_user_id),))
            return int(getattr(cur, "rowcount", 0) or 0)

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
        """管理端用户分页列表"""
        import config
        page = max(1, int(page or 1))
        page_size = min(max(1, int(page_size or 50)), 500)
        offset = (page - 1) * page_size
        where = ["u.is_deleted = 0"]
        params: List[Any] = []
        kw = str(keyword or "").strip()
        if kw:
            where.append("(u.account_no LIKE ? OR IFNULL(u.nickname,'') LIKE ? OR IFNULL(u.phone,'') LIKE ?)")
            kwp = "%" + kw + "%"
            params.extend([kwp, kwp, kwp])
        if only_locked:
            where.append("u.locked_until IS NOT NULL AND u.locked_until > datetime('now')")
        if only_admin:
            where.append("u.role = ?")
            params.append(int(getattr(config, "ROLE_ADMIN", 1)))
        where_sql = " WHERE " + " AND ".join(where)
        order_allowed = {
            "created_at_desc": "u.created_at DESC, u.id DESC",
            "created_at_asc": "u.created_at ASC, u.id ASC",
            "last_login_desc": "u.last_login_at DESC, u.id DESC",
            "failed_desc": "COALESCE(u.failed_attempts,0) DESC, u.id DESC",
            "account_asc": "u.account_no ASC, u.id ASC",
        }
        order_sql = order_allowed.get(str(sort or "").strip(), order_allowed["created_at_desc"])
        with self._conn() as c:
            total = int(c.execute("SELECT COUNT(*) FROM users u" + where_sql, params).fetchone()[0] or 0)
            cur = c.execute(
                "SELECT u.id, u.account_no, u.role, u.nickname, u.phone, u.is_active, u.created_at, u.last_login_at,"
                " COALESCE(u.failed_attempts,0) AS failed_attempts, u.last_failed_at, u.locked_until,"
                " CASE WHEN u.locked_until IS NOT NULL AND u.locked_until > datetime('now') THEN 1 ELSE 0 END AS is_locked,"
                " CAST(CASE WHEN u.locked_until IS NOT NULL AND u.locked_until > datetime('now')"
                "  THEN strftime('%s', u.locked_until) - strftime('%s','now') ELSE 0 END AS INTEGER) AS lock_remain_sec,"
                " (SELECT COUNT(*) FROM transactions t WHERE t.user_id = u.id AND t.deleted = 0) AS tx_count,"
                " (SELECT COUNT(*) FROM reminders r WHERE r.user_id = u.id AND r.deleted = 0) AS rem_count,"
                " (SELECT COUNT(*) FROM session_logs s WHERE s.user_id = u.id AND s.is_success = 1) AS ok_login_count"
                " FROM users u" + where_sql + " ORDER BY " + order_sql + " LIMIT ? OFFSET ?",
                params + [page_size, offset],
            )
            rows = _rows_to_dict(cur, cur.fetchall())
        return {"total": total, "page": page, "page_size": page_size, "list": rows}

    def admin_overview_stats(self) -> Dict[str, Any]:
        """管理端概览统计卡片数据"""
        import config
        role_admin = int(getattr(config, "ROLE_ADMIN", 1))
        with self._conn() as c:
            totals = c.execute(
                """SELECT
                     COUNT(*) FILTER (WHERE is_deleted = 0) AS total_users,
                     COUNT(*) FILTER (WHERE is_deleted = 0 AND role = ?) AS admin_count,
                     COUNT(*) FILTER (WHERE is_deleted = 0 AND locked_until IS NOT NULL AND locked_until > datetime('now')) AS locked_count,
                     COUNT(*) FILTER (WHERE is_deleted = 0 AND DATE(created_at) = DATE('now','localtime')) AS new_today,
                     COUNT(*) FILTER (WHERE is_deleted = 0 AND DATE(last_login_at) = DATE('now','localtime')) AS login_today
                   FROM users""",
                (role_admin,),
            ).fetchone() or (0, 0, 0, 0, 0)
            log_counts = c.execute(
                """SELECT
                     COALESCE(SUM(CASE WHEN is_success = 1 THEN 1 ELSE 0 END),0) AS ok_logins_7d,
                     COALESCE(SUM(CASE WHEN is_success = 0 THEN 1 ELSE 0 END),0) AS fail_logins_7d
                   FROM session_logs WHERE login_at >= datetime('now','-7 days')"""
            ).fetchone() or (0, 0)
            top_fail = c.execute(
                """SELECT attempt_account, COUNT(*) AS cnt
                   FROM session_logs
                   WHERE is_success = 0 AND login_at >= datetime('now','-24 hours') AND attempt_account <> ''
                   GROUP BY attempt_account ORDER BY cnt DESC LIMIT 8"""
            ).fetchall() or []
            fail_by_reason = c.execute(
                """SELECT fail_reason, COUNT(*) AS cnt
                   FROM session_logs
                   WHERE is_success = 0 AND login_at >= datetime('now','-7 days')
                   GROUP BY fail_reason ORDER BY cnt DESC"""
            ).fetchall() or []
            daily_14d = c.execute(
                """SELECT DATE(login_at) AS d,
                     COALESCE(SUM(CASE WHEN is_success = 1 THEN 1 ELSE 0 END),0) AS ok,
                     COALESCE(SUM(CASE WHEN is_success = 0 THEN 1 ELSE 0 END),0) AS fail
                   FROM session_logs
                   WHERE login_at >= datetime('now','-13 days')
                   GROUP BY DATE(login_at) ORDER BY d ASC"""
            ).fetchall() or []
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
        """管理端审计日志分页（最近登录/失败记录）"""
        page = max(1, int(page or 1))
        page_size = min(max(1, int(page_size or 50)), 500)
        offset = (page - 1) * page_size
        where = ["1=1"]
        params: List[Any] = []
        acc = str(account_no or "").strip()
        if acc:
            where.append("(s.attempt_account = ? OR u.account_no = ?)")
            params.extend([acc[:6], acc[:6]])
        if only_fail:
            where.append("s.is_success = 0")
        fr = str(fail_reason or "").strip()
        if fr:
            where.append("s.fail_reason = ?")
            params.append(fr)
        where_sql = " WHERE " + " AND ".join(where)
        with self._conn() as c:
            total = int(c.execute(
                "SELECT COUNT(*) FROM session_logs s LEFT JOIN users u ON u.id = s.user_id"
                + where_sql, params,
            ).fetchone()[0] or 0)
            cur = c.execute(
                """SELECT s.id, s.login_at, s.is_success, s.fail_reason, s.attempt_account, s.ip,
                          s.user_agent, u.account_no AS user_account, u.nickname AS user_nickname
                   FROM session_logs s LEFT JOIN users u ON u.id = s.user_id"""
                + where_sql
                + " ORDER BY s.id DESC LIMIT ? OFFSET ?",
                params + [page_size, offset],
            )
            rows = _rows_to_dict(cur, cur.fetchall())
        return {"total": total, "page": page, "page_size": page_size, "list": rows}

    def delete_user_cascade(self, user_id: int) -> None:
        with self._conn() as c:
            c.execute("DELETE FROM transactions WHERE user_id = ?", (user_id,))
            c.execute("DELETE FROM reminders WHERE user_id = ?", (user_id,))
            c.execute("DELETE FROM categories WHERE user_id = ?", (user_id,))
            c.execute("DELETE FROM session_logs WHERE user_id = ?", (user_id,))
            c.execute("DELETE FROM users WHERE id = ?", (user_id,))

    def change_password(self, user_id: int, new_hash: str) -> None:
        with self._conn() as c:
            c.execute(
                "UPDATE users SET password_hash = ? WHERE id = ?",
                (new_hash, user_id),
            )

    def upsert_system_categories_for_user(self, user_id: int) -> None:
        with self._conn() as c:
            for idx, (typ, names) in enumerate(config.SYSTEM_CATEGORIES.items()):
                for i, n in enumerate(names):
                    c.execute(
                        """INSERT OR IGNORE INTO categories(user_id, type, name, is_system, sort)
                        VALUES(?, ?, ?, 1, ?)""",
                        (user_id, typ, n, idx * 100 + i),
                    )

    # ---------------- session --------------------
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
        """写登录审计日志：
        - 成功：正常 jti，is_success=1，fail_reason=""（外键 users.user_id 正常引用）
        - 失败：伪 jti=F-前缀，is_success=0（user_id 可能 0 或无对应用户 → 临时关外键约束插入，不破坏成功日志的引用完整性）
        """
        import uuid as _uuid
        jti_final = (jti or "").strip() or _uuid.uuid4().hex
        if not is_success:
            jti_final = "F-" + _uuid.uuid4().hex[:35]
        uid = int(user_id) if user_id else 0
        with self._conn() as c:
            had_to_disable_fk = (not is_success) and uid <= 0
            try:
                if had_to_disable_fk:
                    # 失败日志 user_id 可能是 0（账号不存在或还没通过验证码）——临时关外键，
                    # 不影响成功日志的 FK 引用完整性检查
                    c.execute("PRAGMA foreign_keys = OFF")
                c.execute(
                    """INSERT INTO session_logs(
                         user_id, jti, ip, user_agent, is_success, fail_reason, attempt_account
                       ) VALUES(?,?,?,?,?,?,?)""",
                    (
                        uid if uid > 0 else None if self._fk_nullable_uid_supported() else 0,
                        jti_final[:36],
                        (ip or "")[:64],
                        (ua or "")[:512],
                        1 if is_success else 0,
                        str(fail_reason or "")[:40],
                        str(attempt_account or "")[:6],
                    ),
                )
            except Exception:
                # 兜底：无论如何都要写一条（关闭所有约束，用 uid=0，用原始 VALUES 插入）
                try:
                    c.execute("PRAGMA foreign_keys = OFF")
                    c.execute(
                        """INSERT INTO session_logs(
                             user_id, jti, ip, user_agent, is_success, fail_reason, attempt_account
                           ) VALUES(0,?,?,?,0,?,?)""",
                        (jti_final[:36], (ip or "")[:64], (ua or "")[:512],
                         str(fail_reason or "")[:40], str(attempt_account or "")[:6]),
                    )
                finally:
                    try: c.execute("PRAGMA foreign_keys = ON")
                    except Exception: pass
            else:
                if had_to_disable_fk:
                    try: c.execute("PRAGMA foreign_keys = ON")
                    except Exception: pass

    @staticmethod
    def _fk_nullable_uid_supported() -> bool:
        # 老版本 session_logs.user_id 是 NOT NULL → 不能写 NULL，返回 False 统一用 0 + 关 FK
        return False

    def revoke_jti(self, jti: str) -> None:
        with self._conn() as c:
            c.execute("UPDATE session_logs SET revoked = 1 WHERE jti = ?", (jti,))

    def is_jti_revoked(self, jti: str) -> bool:
        with self._conn() as c:
            cur = c.execute(
                "SELECT revoked FROM session_logs WHERE jti = ? LIMIT 1", (jti,)
            )
            row = cur.fetchone()
            return not row or bool(row[0])

    # ---------------- captcha store --------------------
    def create_captcha(self, captcha_id: str, code_hash: str, salt: str, expires_at_iso: str) -> None:
        with self._conn() as c:
            try:
                c.execute("DELETE FROM captcha_store WHERE expires_at < datetime('now') LIMIT 100")
            except Exception:
                pass
            c.execute(
                "INSERT INTO captcha_store(id, code_hash, salt, expires_at) VALUES(?,?,?,?)",
                (captcha_id[:32], code_hash[:64], salt[:16], expires_at_iso),
            )

    def verify_and_consume_captcha(self, captcha_id: str, input_upper: str, now_iso: str) -> int:
        """返回 0=成功 1=不存在/已用/过期 2=答案错误；**无论对错，只要尝试过即 mark used=1（一次一用防重放）"""
        if not captcha_id or not input_upper:
            return 1
        captcha_id = str(captcha_id).strip()[:32]
        import hashlib
        with self._conn() as c:
            cur = c.execute(
                "SELECT id, code_hash, salt, used, expires_at FROM captcha_store WHERE id = ? LIMIT 1",
                (captcha_id,),
            )
            row = cur.fetchone()
            if not row:
                return 1
            _id, code_hash, salt, used, expires_at = row
            if used:
                return 1
            if not expires_at or str(expires_at) < str(now_iso):
                try:
                    c.execute("DELETE FROM captcha_store WHERE id = ?", (captcha_id,))
                except Exception:
                    pass
                return 1
            inp_hash = hashlib.sha256((str(salt) + str(input_upper).strip().upper()).encode("utf-8")).hexdigest()
            matched = (inp_hash == str(code_hash))
            # ✅ 关键：无论对错，尝试过一次就 used=1（同一验证码最多试 1 次密码，不允许 OCR 一次试 N 次）
            try:
                c.execute("UPDATE captcha_store SET used = 1 WHERE id = ?", (captcha_id,))
            except Exception:
                pass
            return 0 if matched else 2

    # ---------------- 交易管理 --------------------
    def list_transactions(
        self,
        user_id: int,
        filters: Dict[str, Any],
        page: int,
        page_size: int,
    ) -> Dict[str, Any]:
        page = max(1, int(page or 1))
        page_size = min(max(1, int(page_size or config.DEFAULT_PAGE_SIZE)), config.EXPORT_MAX_PAGE_SIZE)
        offset = (page - 1) * page_size

        where = ["user_id = ?", "deleted = 0"]
        params: List[Any] = [user_id]
        if filters.get("type"):
            where.append("type = ?"); params.append(filters["type"])
        if filters.get("category"):
            where.append("category = ?"); params.append(filters["category"])
        if filters.get("room_no"):
            where.append("room_no LIKE ?"); params.append("%" + filters["room_no"] + "%")
        if filters.get("keyword"):
            kw = "%" + filters["keyword"] + "%"
            where.append("(description LIKE ? OR category LIKE ? OR room_no LIKE ?)")
            params.extend([kw, kw, kw])
        for fk in ("start_date", "date_from"):
            if filters.get(fk):
                where.append("trans_date >= ?"); params.append(filters[fk])
                break
        for fk in ("end_date", "date_to"):
            if filters.get(fk):
                where.append("trans_date <= ?"); params.append(filters[fk])
                break

        where_sql = " WHERE " + " AND ".join(where)
        with self._conn() as c:
            cnt = c.execute(
                "SELECT COUNT(*) FROM transactions" + where_sql, params
            ).fetchone()[0]
            sm_row = c.execute(
                """SELECT
                    COALESCE(SUM(CASE WHEN type = '收入' THEN amount ELSE 0 END), 0) AS total_income,
                    COALESCE(SUM(CASE WHEN type = '支出' THEN amount ELSE 0 END), 0) AS total_expense
                FROM transactions""" + where_sql, params,
            ).fetchone() or (0, 0)
            cur = c.execute(
                """SELECT id, type, category, amount, description, room_no, trans_date, tag, created_at
                   FROM transactions"""
                + where_sql
                + " ORDER BY trans_date DESC, id DESC LIMIT ? OFFSET ?",
                params + [page_size, offset],
            )
            rows = _rows_to_dict(cur, cur.fetchall())
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
        with self._conn() as c:
            cur = c.execute(
                """SELECT id, type, category, amount, description, room_no, trans_date, tag, created_at
                   FROM transactions WHERE id = ? AND user_id = ? AND deleted = 0 LIMIT 1""",
                (tx_id, user_id),
            )
            return _row_to_dict(cur, cur.fetchone())

    def create_transaction(self, user_id: int, payload: Dict[str, Any]) -> int:
        with self._conn() as c:
            cur = c.execute(
                """INSERT INTO transactions(user_id, type, category, amount, description, room_no, trans_date, tag)
                   VALUES(?,?,?,?,?,?,?,?)""",
                (
                    user_id,
                    payload["type"],
                    payload["category"],
                    float(payload["amount"]),
                    payload.get("description", "") or "",
                    payload.get("room_no", "") or "",
                    payload["trans_date"],
                    payload.get("tag", "") or "",
                ),
            )
            return int(cur.lastrowid)

    def update_transaction(self, user_id: int, tx_id: int, payload: Dict[str, Any]) -> bool:
        fields = []
        params = []
        for k in ("type", "category", "amount", "description", "room_no", "trans_date", "tag"):
            if k in payload:
                fields.append(f"{k} = ?")
                params.append(float(payload[k]) if k == "amount" else payload[k])
        if not fields:
            return True
        fields.append("updated_at = CURRENT_TIMESTAMP")
        params.extend([tx_id, user_id])
        with self._conn() as c:
            cur = c.execute(
                f"UPDATE transactions SET {', '.join(fields)} WHERE id = ? AND user_id = ? AND deleted = 0",
                params,
            )
            return cur.rowcount > 0

    def delete_transaction(self, user_id: int, tx_id: int) -> bool:
        with self._conn() as c:
            cur = c.execute(
                "UPDATE transactions SET deleted = 1 WHERE id = ? AND user_id = ? AND deleted = 0",
                (tx_id, user_id),
            )
            return cur.rowcount > 0

    def delete_transactions_batch(self, user_id: int, ids: List[int]) -> int:
        if not ids:
            return 0
        qs = ",".join(["?"] * len(ids))
        with self._conn() as c:
            cur = c.execute(
                f"UPDATE transactions SET deleted = 1 WHERE user_id = ? AND deleted = 0 AND id IN ({qs})",
                [user_id, *ids],
            )
            return cur.rowcount

    # ---------------- categories --------------------
    def list_categories_grouped(self, user_id: int) -> Dict[str, List[Dict[str, Any]]]:
        with self._conn() as c:
            cur = c.execute(
                """SELECT id, type, name, is_system, sort, disabled FROM categories
                   WHERE user_id = ? AND disabled = 0 ORDER BY type, sort, id""",
                (user_id,),
            )
            rows = _rows_to_dict(cur, cur.fetchall())
        grouped: Dict[str, List[Dict[str, Any]]] = {"收入": [], "支出": []}
        for r in rows:
            grouped.setdefault(r["type"], []).append(r)
        return grouped

    # ---------------- reminders --------------------
    def list_reminders(self, user_id: int, filters: Dict[str, Any]) -> List[Dict[str, Any]]:
        where = ["user_id = ?", "deleted = 0"]
        params: List[Any] = [user_id]
        if filters.get("status"):
            where.append("status = ?"); params.append(filters["status"])
        if filters.get("room_no"):
            where.append("room_no LIKE ?"); params.append("%" + filters["room_no"] + "%")
        if filters.get("keyword"):
            kw = "%" + filters["keyword"] + "%"
            where.append("(room_no LIKE ? OR remark LIKE ?)")
            params.extend([kw, kw])
        where_sql = " WHERE " + " AND ".join(where)
        with self._conn() as c:
            cur = c.execute(
                """SELECT id, room_no, rent_amount, due_date, lease_end_date, status, remark, created_at
                   FROM reminders"""
                + where_sql
                + " ORDER BY CASE status WHEN '未完成' THEN 0 ELSE 1 END, due_date ASC, id DESC",
                params,
            )
            return _rows_to_dict(cur, cur.fetchall())

    def get_reminder(self, user_id: int, rem_id: int) -> Optional[Dict[str, Any]]:
        with self._conn() as c:
            cur = c.execute(
                """SELECT * FROM reminders WHERE id = ? AND user_id = ? AND deleted = 0 LIMIT 1""",
                (rem_id, user_id),
            )
            return _row_to_dict(cur, cur.fetchone())

    def create_reminder(self, user_id: int, payload: Dict[str, Any]) -> int:
        with self._conn() as c:
            cur = c.execute(
                """INSERT INTO reminders(user_id, room_no, rent_amount, due_date, lease_end_date, status, remark)
                   VALUES(?,?,?,?,?,?,?)""",
                (
                    user_id,
                    payload["room_no"],
                    float(payload["rent_amount"]),
                    payload["due_date"],
                    payload.get("lease_end_date") or None,
                    payload.get("status", "未完成"),
                    payload.get("remark", "") or "",
                ),
            )
            return int(cur.lastrowid)

    def update_reminder(self, user_id: int, rem_id: int, payload: Dict[str, Any]) -> bool:
        fields = []
        params = []
        for k in ("room_no", "rent_amount", "due_date", "lease_end_date", "status", "remark"):
            if k in payload:
                fields.append(f"{k} = ?")
                params.append(float(payload[k]) if k == "rent_amount" else payload[k])
        if not fields:
            return True
        fields.append("updated_at = CURRENT_TIMESTAMP")
        params.extend([rem_id, user_id])
        with self._conn() as c:
            cur = c.execute(
                f"UPDATE reminders SET {', '.join(fields)} WHERE id = ? AND user_id = ? AND deleted = 0",
                params,
            )
            return cur.rowcount > 0

    def delete_reminder(self, user_id: int, rem_id: int) -> bool:
        with self._conn() as c:
            cur = c.execute(
                "UPDATE reminders SET deleted = 1 WHERE id = ? AND user_id = ? AND deleted = 0",
                (rem_id, user_id),
            )
            return cur.rowcount > 0

    # ---------------- dashboard --------------------
    def aggregate_summary(self, user_id: int) -> Dict[str, Any]:
        today = dt.date.today()
        cur_first = today.replace(day=1)
        if cur_first.month == 12:
            next_first = dt.date(cur_first.year + 1, 1, 1)
            last_first = dt.date(cur_first.year, cur_first.month - 1, 1)
            last_end = cur_first
        else:
            next_first = dt.date(cur_first.year, cur_first.month + 1, 1)
            last_first = dt.date(cur_first.year, cur_first.month - 1, 1)
            last_end = cur_first

        cur_s = cur_first.isoformat()
        next_s = next_first.isoformat()
        last_s = last_first.isoformat()
        last_end_s = last_end.isoformat()

        with self._conn() as c:
            row = c.execute(
                """SELECT
                    COALESCE(SUM(CASE WHEN type = '收入' AND trans_date >= ? AND trans_date < ? THEN amount ELSE 0 END), 0) AS month_income,
                    COALESCE(SUM(CASE WHEN type = '支出' AND trans_date >= ? AND trans_date < ? THEN amount ELSE 0 END), 0) AS month_expense,
                    COALESCE(SUM(CASE WHEN type = '收入' AND trans_date >= ? AND trans_date < ? THEN amount ELSE 0 END), 0) AS last_month_income,
                    COALESCE(SUM(CASE WHEN type = '支出' AND trans_date >= ? AND trans_date < ? THEN amount ELSE 0 END), 0) AS last_month_expense,
                    COALESCE(SUM(CASE WHEN type = '收入' THEN amount ELSE 0 END), 0) AS total_income,
                    COALESCE(SUM(CASE WHEN type = '支出' THEN amount ELSE 0 END), 0) AS total_expense
                FROM transactions WHERE user_id = ? AND deleted = 0""",
                (cur_s, next_s, cur_s, next_s, last_s, last_end_s, last_s, last_end_s, int(user_id)),
            ).fetchone()

        m_in = round(float(row[0] or 0), 2)
        m_out = round(float(row[1] or 0), 2)
        lm_in = round(float(row[2] or 0), 2)
        lm_out = round(float(row[3] or 0), 2)
        t_in = round(float(row[4] or 0), 2)
        t_out = round(float(row[5] or 0), 2)
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
        with self._conn() as c:
            cur = c.execute(
                """SELECT id, type, category, amount, description, room_no, trans_date, created_at
                   FROM transactions WHERE user_id = ? AND deleted = 0
                   ORDER BY created_at DESC, id DESC LIMIT ?""",
                (user_id, int(limit or 5)),
            )
            return _rows_to_dict(cur, cur.fetchall())

    def all_reminders_uncompleted(self, user_id: int) -> List[Dict[str, Any]]:
        with self._conn() as c:
            cur = c.execute(
                """SELECT id, room_no, rent_amount, due_date, lease_end_date, status, remark
                   FROM reminders WHERE user_id = ? AND deleted = 0 AND status != '已完成'
                   ORDER BY due_date ASC, id DESC LIMIT 200""",
                (user_id,),
            )
            return _rows_to_dict(cur, cur.fetchall())

    def trend_12m(self, user_id: int) -> List[Dict[str, Any]]:
        today = dt.date.today()
        # 构造 12 个月
        months: List[str] = []
        cur = today.replace(day=1)
        for _ in range(12):
            months.append(cur.strftime("%Y-%m"))
            # 上月
            if cur.month == 1:
                cur = cur.replace(year=cur.year - 1, month=12)
            else:
                cur = cur.replace(month=cur.month - 1)
        months = list(reversed(months))
        month_bounds = []
        for m in months:
            y, mo = [int(x) for x in m.split("-")]
            start = dt.date(y, mo, 1)
            if mo == 12:
                end = dt.date(y + 1, 1, 1) - dt.timedelta(days=1)
            else:
                end = dt.date(y, mo + 1, 1) - dt.timedelta(days=1)
            month_bounds.append((m, start.isoformat(), end.isoformat()))

        result = []
        with self._conn() as c:
            for m, s, e in month_bounds:
                inc = c.execute(
                    "SELECT COALESCE(SUM(amount),0) FROM transactions WHERE user_id = ? AND deleted = 0 AND type='收入' AND trans_date BETWEEN ? AND ?",
                    (user_id, s, e),
                ).fetchone()[0]
                exp = c.execute(
                    "SELECT COALESCE(SUM(amount),0) FROM transactions WHERE user_id = ? AND deleted = 0 AND type='支出' AND trans_date BETWEEN ? AND ?",
                    (user_id, s, e),
                ).fetchone()[0]
                result.append({
                    "month": m,
                    "income": round(float(inc or 0), 2),
                    "expense": round(float(exp or 0), 2),
                })
        return result

    def category_pie(self, user_id: int, scope_months: int) -> Dict[str, List[Dict[str, Any]]]:
        start_date = None
        if scope_months and scope_months > 0:
            today = dt.date.today()
            cur = today.replace(day=1)
            for _ in range(scope_months - 1):
                if cur.month == 1:
                    cur = cur.replace(year=cur.year - 1, month=12)
                else:
                    cur = cur.replace(month=cur.month - 1)
            start_date = cur.isoformat()
        income_rows, expense_rows = [], []
        with self._conn() as c:
            if start_date:
                inc = c.execute(
                    """SELECT category, COALESCE(SUM(amount),0) s FROM transactions
                       WHERE user_id = ? AND deleted = 0 AND type = '收入' AND trans_date >= ?
                       GROUP BY category ORDER BY s DESC""",
                    (user_id, start_date),
                ).fetchall()
                exp = c.execute(
                    """SELECT category, COALESCE(SUM(amount),0) s FROM transactions
                       WHERE user_id = ? AND deleted = 0 AND type = '支出' AND trans_date >= ?
                       GROUP BY category ORDER BY s DESC""",
                    (user_id, start_date),
                ).fetchall()
            else:
                inc = c.execute(
                    """SELECT category, COALESCE(SUM(amount),0) s FROM transactions
                       WHERE user_id = ? AND deleted = 0 AND type = '收入'
                       GROUP BY category ORDER BY s DESC""",
                    (user_id,),
                ).fetchall()
                exp = c.execute(
                    """SELECT category, COALESCE(SUM(amount),0) s FROM transactions
                       WHERE user_id = ? AND deleted = 0 AND type = '支出'
                       GROUP BY category ORDER BY s DESC""",
                    (user_id,),
                ).fetchall()
            income_rows = [{"name": r[0], "value": round(float(r[1]), 2)} for r in inc]
            expense_rows = [{"name": r[0], "value": round(float(r[1]), 2)} for r in exp]
        return {"income": income_rows, "expense": expense_rows}

    def category_compare(self, user_id: int, scope_months: int) -> Dict[str, Any]:
        pie = self.category_pie(user_id, scope_months)
        names = sorted({x["name"] for x in pie["income"]} | {x["name"] for x in pie["expense"]})
        inc_map = {x["name"]: x["value"] for x in pie["income"]}
        exp_map = {x["name"]: x["value"] for x in pie["expense"]}
        income_vals = [round(inc_map.get(n, 0.0), 2) for n in names]
        expense_vals = [round(exp_map.get(n, 0.0), 2) for n in names]
        return {"categories": names, "income": income_vals, "expense": expense_vals}

    # ============== 系统公告（announcements）管理员端 ==================

    def admin_list_announcements(self, *, page: int = 1, page_size: int = 30, only_active: bool = False) -> Dict[str, Any]:
        page = max(1, int(page or 1))
        page_size = min(500, max(1, int(page_size or 30)))
        offset = (page - 1) * page_size
        where = ["is_deleted = 0"]
        params: List[Any] = []
        if only_active:
            where.append("is_active = 1")
            where.append("(effective_at IS NULL OR effective_at <= datetime('now'))")
            where.append("(expire_at IS NULL OR expire_at >= datetime('now'))")
        where_sql = " WHERE " + " AND ".join(where)
        order_sql = "is_pinned DESC, priority DESC, created_at DESC, id DESC"
        with self._conn() as c:
            total_row = c.execute(f"SELECT COUNT(*) FROM announcements{where_sql}", params).fetchone()
            total = int(total_row[0] or 0)
            cur = c.execute(
                f"SELECT id, title, content, banner_level, priority, is_pinned, is_active, effective_at, expire_at, created_by, updated_by, created_at, updated_at FROM announcements{where_sql} ORDER BY {order_sql} LIMIT ? OFFSET ?",
                list(params) + [page_size, offset],
            )
            rows = _rows_to_dict(cur, cur.fetchall())
        return {"total": total, "list": rows, "page": page, "page_size": page_size}

    def admin_create_announcement(
        self,
        *,
        title: str,
        content: str,
        priority: int = 0,
        is_pinned: int = 0,
        is_active: int = 1,
        banner_level: str = "info",
        effective_at=None,
        expire_at=None,
        created_by: int = 0,
        updated_by: int = 0,
    ) -> int:
        with self._conn() as c:
            cur = c.execute(
                """INSERT INTO announcements(title, content, priority, is_pinned, is_active, banner_level,
                   effective_at, expire_at, created_by, updated_by)
                   VALUES(?,?,?,?,?,?,?,?,?,?)""",
                (
                    str(title), str(content),
                    max(-10, min(10, int(priority or 0))),
                    1 if int(is_pinned or 0) >= 1 else 0,
                    1 if (int(is_active) if is_active is not None else 1) >= 1 else 0,
                    str(banner_level or "info"),
                    effective_at if effective_at else None,
                    expire_at if expire_at else None,
                    int(created_by or 0) or None,
                    int(updated_by or 0) or None,
                ),
            )
            new_id = int(getattr(cur, "lastrowid", 0) or 0)
            # 如果置顶，则取消其他公告的置顶（保证最多1条置顶，更清爽展示）
            if is_pinned and new_id > 0:
                c.execute("UPDATE announcements SET is_pinned = 0 WHERE id != ? AND is_pinned = 1 AND is_deleted = 0", (new_id,))
            return new_id

    def admin_update_announcement(self, ann_id: int, fields: Dict[str, Any]) -> int:
        if not fields or int(ann_id or 0) <= 0:
            return 0
        allowed = {
            "title", "content", "priority", "is_pinned", "is_active",
            "banner_level", "effective_at", "expire_at", "updated_by",
        }
        sets: List[str] = []
        params: List[Any] = []
        for k, v in (fields or {}).items():
            if k not in allowed:
                continue
            if k == "priority":
                v = max(-10, min(10, int(v or 0)))
            elif k == "is_pinned":
                v = 1 if int(v or 0) >= 1 else 0
            elif k == "is_active":
                v = 1 if int(v or 0) >= 1 else 0
            sets.append(f"{k} = ?")
            params.append(v)
        if not sets:
            return 0
        sets.append("updated_at = CURRENT_TIMESTAMP")
        params.append(int(ann_id))
        with self._conn() as c:
            cur = c.execute(
                f"UPDATE announcements SET {', '.join(sets)} WHERE id = ? AND is_deleted = 0",
                params,
            )
            rows = int(getattr(cur, "rowcount", 0) or 0)
            if rows > 0 and "is_pinned" in fields and int(fields["is_pinned"] or 0) >= 1:
                c.execute("UPDATE announcements SET is_pinned = 0 WHERE id != ? AND is_pinned = 1 AND is_deleted = 0", (int(ann_id),))
            return rows

    def admin_delete_announcement(self, ann_id: int) -> int:
        if int(ann_id or 0) <= 0:
            return 0
        with self._conn() as c:
            cur = c.execute("UPDATE announcements SET is_deleted = 1 WHERE id = ? AND is_deleted = 0", (int(ann_id),))
            return int(getattr(cur, "rowcount", 0) or 0)

    def list_public_announcements(self, *, limit: int = 10) -> List[Dict[str, Any]]:
        """公共接口：用户首页展示用。只返回生效中、未删除的公告。"""
        limit = min(100, max(1, int(limit or 10)))
        with self._conn() as c:
            cur = c.execute(
                """SELECT id, title, content, banner_level, is_pinned, priority, effective_at, expire_at, created_at
                   FROM announcements
                   WHERE is_deleted = 0 AND is_active = 1
                     AND (effective_at IS NULL OR effective_at <= datetime('now'))
                     AND (expire_at IS NULL OR expire_at >= datetime('now'))
                   ORDER BY is_pinned DESC, priority DESC, created_at DESC, id DESC
                   LIMIT ?""",
                (limit,),
            )
            return _rows_to_dict(cur, cur.fetchall())
