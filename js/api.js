const _getApiBase = () => {
  if (window.API_BASE_URL && String(window.API_BASE_URL).trim()) {
    return String(window.API_BASE_URL).trim();
  }
  try {
    const urlParams = new URLSearchParams(window.location.search);
    const apiParam = urlParams.get("apiBase");
    if (apiParam && apiParam.trim()) return apiParam.trim();
  } catch (_) {}
  return "";
};

const API_BASE = _getApiBase();
const _FALLBACK_BACKEND_BASE = "http://127.0.0.1:5000";

function _joinUrl(base, path) {
  if (!path) return base || "";
  if (!base) return path;
  const b = base.replace(/\/+$/, "");
  const p = path.replace(/^\/+/, "");
  return b + "/" + p;
}

function _isLocalHostname() {
  try {
    const hn = (location.hostname || "").toLowerCase();
    return hn === "localhost" || hn === "127.0.0.1" || hn === "0.0.0.0" || hn === "[::1]" || hn === "";
  } catch (_) { return false; }
}
const TOKEN_KEY = "account_app_token";
const USER_KEY = "account_app_user";

function _handleGlobalAuthError(json) {
  if (!json || typeof json !== "object") return json;
  const code = parseInt(json.code || 0, 10) || 0;
  const msg = String(json.msg || "");
  if (code === 401) {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    if (window.Router && typeof window.Router.logout === "function") {
      try { window.Router.logout(); } catch (_) {}
    }
    try {
      if (location.hash !== "#/login") {
        setTimeout(() => { location.hash = "#/login"; }, 50);
      }
    } catch (_) {}
  } else if (code === 403 && (msg.includes("已被管理员禁用") || msg.includes("账号已被管理员"))) {
    try {
      const banner = document.getElementById("global-disabled-banner");
      if (!banner) {
        const d = document.createElement("div");
        d.id = "global-disabled-banner";
        Object.assign(d.style, {
          position: "fixed", top: "0", left: "0", right: "0", zIndex: "9999999",
          background: "#b91c1c", color: "#fff", padding: "10px 18px", textAlign: "center",
          fontSize: "14px", fontWeight: "600", boxShadow: "0 2px 12px rgba(185,28,28,.3)",
        });
        d.textContent = "🚫 " + (msg || "您的账号已被管理员禁用，如有疑问请联系管理员");
        document.body.appendChild(d);
      }
    } catch (_) {}
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setTimeout(() => {
      try {
        if (window.Router && typeof window.Router.logout === "function") window.Router.logout();
        else location.hash = "#/login";
      } catch (_) { location.hash = "#/login"; }
    }, 800);
  }
  return json;
}

async function api(path, opts = {}) {
  const headers = Object.assign({ "Content-Type": "application/json" }, opts.headers || {});
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) headers["Authorization"] = "Bearer " + token;
  const mergedOpts = Object.assign({ credentials: "omit" }, opts, { headers });
  const LOCAL_FALLBACK = "http://127.0.0.1:5000";
  const tryBases = [API_BASE];
  if (_isLocalHostname() && API_BASE !== LOCAL_FALLBACK) {
    tryBases.push(LOCAL_FALLBACK);
  }
  const failCodes = [];
  for (let i = 0; i < tryBases.length; i++) {
    const base = tryBases[i];
    let res = null;
    try {
      res = await fetch(_joinUrl(base, path), mergedOpts);
    } catch (e) {
      failCodes.push({ base: base || "/", err: "network:" + (e && e.message ? e.message : "unknown") });
      console.warn("[api] 网络异常（base=" + (base || "/") + "）path=" + path + (i < tryBases.length - 1 ? " → fallback 到 " + tryBases[i+1] : ""), e);
      continue;
    }
    let json = null;
    let parseFailed = false;
    try {
      json = await res.json();
    } catch (_) {
      parseFailed = true;
      const txt = (res.statusText || "响应非 JSON") + (res.status ? " (HTTP " + res.status + ")" : "");
      json = { code: res.status || -99, msg: txt };
    }
    const httpStatus5xx = (typeof res.status === "number") && (res.status >= 500 && res.status < 600);
    const httpStatus404 = (res.status === 404);
    let ct = "";
    try { ct = (res.headers && res.headers.get ? String(res.headers.get("content-type") || "") : "").toLowerCase(); } catch (_) { ct = ""; }
    const contentTypeIsJson = ct.includes("application/json") || ct.includes("text/json");
    let codeValid = false;
    if (!parseFailed && json && typeof json === "object") {
      if (typeof json.code === "number") codeValid = true;
      else if (typeof json.code === "string" && json.code !== "" && !isNaN(parseInt(json.code, 10))) codeValid = true;
    }
    let shouldFallback = false;
    if (i < tryBases.length - 1) {
      // 后端明确返回了合法 JSON 且 code 是业务错误(<500 且 !=404) → 不 fallback，直接展示业务错误（400/401/403/409/429 等）
      // 只有网络错误/解析失败/5xx/404/响应非 JSON/code 不合法 → 才 fallback 到下一个 base
      const codeNum = (json && typeof json === "object" && typeof json.code === "number") ? json.code : ((json && typeof json === "object" && typeof json.code === "string" && !isNaN(parseInt(json.code,10))) ? parseInt(json.code,10) : null);
      const isBusinessError = (!parseFailed) && contentTypeIsJson && codeValid && codeNum !== null && (codeNum < 500) && (codeNum !== 404);
      if (isBusinessError) {
        shouldFallback = false;
      } else if (parseFailed) {
        shouldFallback = true;
      } else if (httpStatus5xx) {
        shouldFallback = true;
      } else if (httpStatus404) {
        shouldFallback = true;
      } else if (!contentTypeIsJson) {
        shouldFallback = true;
      } else if (!codeValid) {
        shouldFallback = true;
      } else {
        shouldFallback = false;
      }
    }
    if (shouldFallback) {
      failCodes.push({ base: base || "/", http: res.status, parseFailed: parseFailed, code: json.code, msg: (json.msg || "").substring(0, 60) });
      console.warn("[api] 上游失败（base=" + (base || "/") + ", HTTP=" + res.status + ", parseFailed=" + parseFailed + ", code=" + json.code + "）" + path + " → fallback 到 " + tryBases[i+1]);
      continue;
    }
    if (failCodes.length) json._fallback_chain = failCodes;
    return _handleGlobalAuthError(json);
  }
  const lastPart = "（已自动尝试直连后端 http://127.0.0.1:5000 均失败，请确认后端 Flask 服务是否已启动：cd backend && python app.py）";
  return { code: -1, msg: "网络错误：后端未启动或使用file://协议。请用Live Server启动前端并启动后端。" + lastPart, _attempts: failCodes };
}

function apiDownload(path, filename, method = "GET", body = null) {
  const token = localStorage.getItem(TOKEN_KEY);
  const url = _joinUrl(API_BASE, path);
  const headers = {};
  if (token) headers["Authorization"] = "Bearer " + token;
  const fetchOpts = { method, headers, credentials: "omit" };
  if (body) {
    fetchOpts.body = typeof body === "string" ? body : JSON.stringify(body);
    headers["Content-Type"] = "application/json";
  }
  return fetch(url, fetchOpts)
    .then((r) => {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.blob();
    })
    .then((blob) => {
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(href);
        if (a.parentNode) a.parentNode.removeChild(a);
      }, 300);
      return true;
    })
    .catch((e) => {
      console.error("[apiDownload] 失败", e);
      alert("下载失败：" + (e && e.message ? e.message : "未知错误"));
      return false;
    });
}

function authStore(token, user) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
}
function authClear() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}
function authUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || "null");
  } catch (_) {
    return null;
  }
}
function authToken() {
  return localStorage.getItem(TOKEN_KEY);
}

const API = {
  // ========== 认证 8 ==========
  captcha: () => api("/api/auth/captcha", { method: "GET" }),
  login: (account_no, password, captcha_id, captcha_code) =>
    api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ account_no, password, captcha_id, captcha_code }),
    }),
  register: (account_no, password, nickname) =>
    api("/api/auth/register", { method: "POST", body: JSON.stringify({ account_no, password, nickname: nickname || "" }) }),
  logout: () => api("/api/auth/logout", { method: "POST" }),
  authMe: () => api("/api/auth/me"),
  authChangePwd: (old_pwd, new_pwd) =>
    api("/api/auth/change-password", { method: "POST", body: JSON.stringify({ old_password: old_pwd, new_password: new_pwd }) }),
  authUpdateProfile: (nickname, phone) =>
    api("/api/auth/profile", { method: "PUT", body: JSON.stringify({ nickname, phone }) }),
  authDeleteAccount: (password) =>
    api("/api/auth/delete-account", { method: "POST", body: JSON.stringify({ password }) }),
  authSessions: () => api("/api/auth/sessions"),

  // ========== 交易记录 10 ==========
  txList: (query = {}) => {
    const qs = new URLSearchParams();
    Object.keys(query).forEach((k) => {
      if (query[k] !== undefined && query[k] !== null && query[k] !== "") qs.append(k, query[k]);
    });
    const s = qs.toString();
    return api("/api/transactions" + (s ? "?" + s : ""));
  },
  txDetail: (id) => api("/api/transactions/" + encodeURIComponent(id)),
  txCreate: (payload) => api("/api/transactions", { method: "POST", body: JSON.stringify(payload) }),
  txUpdate: (id, payload) =>
    api("/api/transactions/" + encodeURIComponent(id), { method: "PUT", body: JSON.stringify(payload) }),
  txDelete: (id) => api("/api/transactions/" + encodeURIComponent(id), { method: "DELETE" }),
  txBatchDelete: (ids) => api("/api/transactions/batch-delete", { method: "POST", body: JSON.stringify({ ids }) }),
  txImportPreview: (formData) => apiForm("/api/io/transactions/import-preview", "POST", formData),
  txImportConfirm: (preview_id) =>
    api("/api/io/transactions/import-confirm", { method: "POST", body: JSON.stringify({ preview_id }) }),
  txExport: (format = "xlsx", query = {}) => {
    const qs = new URLSearchParams();
    qs.append("format", format);
    Object.keys(query).forEach((k) => {
      if (query[k] !== undefined && query[k] !== null && query[k] !== "") qs.append(k, query[k]);
    });
    const fname = "transactions_" + tsTag() + "." + (format === "csv" ? "csv" : "xlsx");
    return apiDownload("/api/io/transactions/export?" + qs.toString(), fname);
  },
  txCategories: () => api("/api/transactions/categories"),

  // ========== 收租提醒 9 ==========
  remList: (query = {}) => {
    const qs = new URLSearchParams();
    Object.keys(query).forEach((k) => {
      if (query[k] !== undefined && query[k] !== null && query[k] !== "") qs.append(k, query[k]);
    });
    const s = qs.toString();
    return api("/api/reminders" + (s ? "?" + s : ""));
  },
  remDetail: (id) => api("/api/reminders/" + encodeURIComponent(id)),
  remCreate: (payload) => api("/api/reminders", { method: "POST", body: JSON.stringify(payload) }),
  remUpdate: (id, payload) =>
    api("/api/reminders/" + encodeURIComponent(id), { method: "PUT", body: JSON.stringify(payload) }),
  remDelete: (id) => api("/api/reminders/" + encodeURIComponent(id), { method: "DELETE" }),
  remBatchDelete: (ids) => api("/api/reminders/batch-delete", { method: "POST", body: JSON.stringify({ ids }) }),
  remRenew: (id, mode) =>
    api("/api/reminders/" + encodeURIComponent(id) + "/renew", { method: "POST", body: JSON.stringify({ mode }) }),
  remExport: (format = "xlsx", query = {}) => {
    const qs = new URLSearchParams();
    qs.append("format", format);
    Object.keys(query).forEach((k) => {
      if (query[k] !== undefined && query[k] !== null && query[k] !== "") qs.append(k, query[k]);
    });
    const fname = "reminders_" + tsTag() + "." + (format === "csv" ? "csv" : "xlsx");
    return apiDownload("/api/io/reminders/export?" + qs.toString(), fname);
  },
  remImportPreview: (formData) => apiForm("/api/io/reminders/import-preview", "POST", formData),
  remImportConfirm: (preview_id) =>
    api("/api/io/reminders/import-confirm", { method: "POST", body: JSON.stringify({ preview_id }) }),

  // ========== 统计分析 4 ==========
  statsSummary: () => api("/api/stats/summary"),
  statsTrend: () => api("/api/stats/trend"),
  statsPie: (scope) => api("/api/stats/pie?scope=" + encodeURIComponent(scope || 12)),
  statsCompare: (scope) => api("/api/stats/compare?scope=" + encodeURIComponent(scope || 12)),

  // ========== 仪表板首页 2 ==========
  dashSummary: () => api("/api/dashboard/summary"),
  dashRecent: (limit) => api("/api/dashboard/recent?limit=" + encodeURIComponent(limit || 5)),

  // ========== 管理员 (管理员专用，后端 @require_admin 会校验 role=1) ==========
  adminOverview: () => api("/api/admin/overview"),
  adminMe: () => api("/api/admin/me"),
  adminListUsers: (query = {}) => {
    const qs = new URLSearchParams();
    Object.keys(query).forEach((k) => {
      if (query[k] !== undefined && query[k] !== null && query[k] !== "") qs.append(k, query[k]);
    });
    const s = qs.toString();
    return api("/api/admin/users" + (s ? "?" + s : ""));
  },
  adminGetUser: (id) => api("/api/admin/users/" + encodeURIComponent(id)),
  adminUnlockUser: (id) =>
    api("/api/admin/users/" + encodeURIComponent(id) + "/unlock", { method: "POST", body: "{}" }),
  adminResetPwd: (id, new_password) =>
    api("/api/admin/users/" + encodeURIComponent(id) + "/reset-password", {
      method: "POST",
      body: JSON.stringify({ new_password: new_password || "" }),
    }),
  adminSetRole: (id, role_0_or_1) =>
    api("/api/admin/users/" + encodeURIComponent(id) + "/role", {
      method: "POST",
      body: JSON.stringify({ role: role_0_or_1 }),
    }),
  adminDeleteUser: (id) => api("/api/admin/users/" + encodeURIComponent(id), { method: "DELETE" }),
  adminToggleActive: (id, is_active_1_or_0) =>
    api("/api/admin/users/" + encodeURIComponent(id) + "/toggle-active", {
      method: "POST",
      body: JSON.stringify({ is_active: is_active_1_or_0 || 0 }),
    }),
  adminVerifySelfPwd: (password) =>
    api("/api/admin/verify-self-pwd", {
      method: "POST",
      body: JSON.stringify({ password: (password && String(password).trim()) || "" }),
    }),
  adminLogs: (query = {}) => {
    const qs = new URLSearchParams();
    Object.keys(query).forEach((k) => {
      if (query[k] !== undefined && query[k] !== null && query[k] !== "") qs.append(k, query[k]);
    });
    const s = qs.toString();
    return api("/api/admin/logs" + (s ? "?" + s : ""));
  },
  adminListAnnouncements: (query = {}) => {
    const qs = new URLSearchParams();
    Object.keys(query).forEach((k) => {
      if (query[k] !== undefined && query[k] !== null && query[k] !== "") qs.append(k, query[k]);
    });
    const s = qs.toString();
    return api("/api/admin/announcements" + (s ? "?" + s : ""));
  },
  adminCreateAnnouncement: (payload) =>
    api("/api/admin/announcements", { method: "POST", body: JSON.stringify(payload || {}) }),
  adminUpdateAnnouncement: (id, payload) =>
    api("/api/admin/announcements/" + encodeURIComponent(id), {
      method: "PUT",
      body: JSON.stringify(payload || {}),
    }),
  adminDeleteAnnouncement: (id) =>
    api("/api/admin/announcements/" + encodeURIComponent(id), { method: "DELETE" }),
  adminPinAnnouncement: (id, is_pin_1_or_0) =>
    api("/api/admin/announcements/" + encodeURIComponent(id) + "/pin", {
      method: "POST",
      body: JSON.stringify({ is_pinned: is_pin_1_or_0 || 0 }),
    }),

  // ========== 公共：系统公告（无需登录，首页/登录页顶部展示） ==========
  getPublicAnnouncements: (limit) => {
    const lv = (limit && Number(limit) > 0) ? Number(limit) : 8;
    return api("/api/system/announcements?limit=" + lv, { noAuth: true });
  },

  // ========== 备份 / 导入导出 ==========
  backupFull: () => apiDownload("/api/io/backup/full", "backup_" + tsTag() + ".zip"),
  backupTx: () => apiDownload("/api/io/backup/transactions", "tx_backup_" + tsTag() + ".xlsx"),

  // ========== 辅助函数 ==========
  store: authStore,
  clear: authClear,
  user: authUser,
  token: authToken,
  download: apiDownload,
  base: API_BASE,
  currentUserId() {
    try {
      const u = authUser() || {};
      const id = parseInt(u.id || u.user_id || 0, 10) || 0;
      return id > 0 ? id : 0;
    } catch (_) {
      return 0;
    }
  },
  currentAccountNo() {
    try {
      const u = authUser() || {};
      return String(u.account_no || u.account || "").trim() || "";
    } catch (_) {
      return "";
    }
  },
  currentRole() {
    try {
      const u = authUser() || {};
      return parseInt(u.role || 0, 10) || 0;
    } catch (_) {
      return 0;
    }
  },
};

function tsTag() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}

async function apiForm(path, method, formData) {
  const token = localStorage.getItem(TOKEN_KEY);
  const headers = {};
  if (token) headers["Authorization"] = "Bearer " + token;
  try {
    const res = await fetch(_joinUrl(API_BASE, path), { method, headers, body: formData, credentials: "omit" });
    const json = await res.json();
    return json;
  } catch (e) {
    console.warn("[apiForm] 失败", e);
    return { code: -1, msg: "网络错误" };
  }
}

window.API = API;
window.apiBase = API_BASE;

function todayStr() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  const s = String(str);
  const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return s.replace(/[&<>"']/g, (c) => map[c] || c);
}

function doLogout() {
  try {
    if (window.API && typeof window.API.logout === "function") {
      try { window.API.logout(); } catch (_) {}
    }
  } catch (_) {}
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  localStorage.removeItem("userInfo");
  if (window.Router && typeof window.Router.resetInit === "function") try { window.Router.resetInit(); } catch (_) {}
  if (window.Router && typeof window.Router.go === "function") {
    window.Router.go("#/login");
  } else {
    location.hash = "#/login";
  }
}

function baseChartOpts() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: {
        position: "bottom",
        labels: { boxWidth: 12, padding: 14, font: { size: 12 } },
      },
      tooltip: {
        backgroundColor: "rgba(15,23,42,0.92)",
        padding: 10,
        cornerRadius: 8,
        titleFont: { size: 13 },
        bodyFont: { size: 12 },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { color: "#6b7280", font: { size: 11 } },
      },
      y: {
        beginAtZero: true,
        grid: { color: "rgba(148,163,184,0.18)" },
        ticks: { color: "#6b7280", font: { size: 11 } },
      },
    },
  };
}

window.todayStr = todayStr;
window.escapeHtml = escapeHtml;
window.doLogout = doLogout;
window.baseChartOpts = baseChartOpts;
