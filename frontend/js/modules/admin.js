window.ModAdmin = {
  tab: "users",
  overview: null,
  usersPage: 1,
  usersSize: 20,
  usersQuery: { keyword: "", only_locked: "0", only_admin: "0", sort: "created_at_desc" },
  usersList: [],
  usersTotal: 0,
  logsPage: 1,
  logsSize: 30,
  logsQuery: { account_no: "", only_fail: "0", fail_reason: "" },
  logsList: [],
  logsTotal: 0,
  annPage: 1,
  annSize: 30,
  annList: [],
  annTotal: 0,
  _lastVerifiedAt: 0,
  async init() {
    const c = document.getElementById("mod-admin-content");
    if (!c) return;
    c.innerHTML = `
    <div class="mcb-shell">
      <div id="adm-overview" style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:14px;"></div>
      <div class="glass-card" style="padding:10px 14px;margin-bottom:14px;">
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
          <button data-adm-tab="users" class="adm-tab-btn adm-tab-active" style="padding:8px 16px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;border:1px solid transparent;">
            👥 用户管理
          </button>
          <button data-adm-tab="logs" class="adm-tab-btn" style="padding:8px 16px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;border:1px solid transparent;background:transparent;color:#64748b;">
            📋 审计日志
          </button>
          <button data-adm-tab="announcements" class="adm-tab-btn" style="padding:8px 16px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;border:1px solid transparent;background:transparent;color:#64748b;">
            📢 系统公告
          </button>
          <div style="flex:1;"></div>
          <button id="adm-btn-refresh" class="btn-ghost-sm" title="刷新所有数据">🔄 刷新</button>
        </div>
      </div>
      <div id="adm-tab-users"></div>
      <div id="adm-tab-logs" style="display:none;"></div>
      <div id="adm-tab-announcements" style="display:none;"></div>
    </div>`;
    c.querySelectorAll(".adm-tab-btn").forEach((b) => {
      b.onclick = () => this.switchTab(b.getAttribute("data-adm-tab"));
    });
    document.getElementById("adm-btn-refresh").onclick = () => this.reloadAll();
    await this.reloadOverview();
    this.renderUsersTabShell();
    this.renderLogsTabShell();
    this.renderAnnTabShell();
    this.reloadUsers(1);
    this.reloadLogs(1);
    this.reloadAnnouncements(1);
  },
  switchTab(t) {
    this.tab = t;
    const tabs = document.querySelectorAll(".adm-tab-btn");
    tabs.forEach((b) => {
      const isAct = b.getAttribute("data-adm-tab") === t;
      if (isAct) {
        b.classList.add("adm-tab-active");
        b.style.background = "#3b82f6";
        b.style.color = "#fff";
        b.style.borderColor = "#3b82f6";
      } else {
        b.classList.remove("adm-tab-active");
        b.style.background = "transparent";
        b.style.color = "#64748b";
        b.style.borderColor = "transparent";
      }
    });
    document.getElementById("adm-tab-users").style.display = (t === "users") ? "" : "none";
    document.getElementById("adm-tab-logs").style.display = (t === "logs") ? "" : "none";
    document.getElementById("adm-tab-announcements").style.display = (t === "announcements") ? "" : "none";
  },
  async reloadAll() {
    await this.reloadOverview();
    this.reloadUsers(1);
    this.reloadLogs(1);
    this.reloadAnnouncements(1);
  },
  async reloadOverview() {
    const res = await API.adminOverview();
    if (res && res.code === 0 && res.data) {
      this.overview = res.data;
      this.renderOverview();
    }
  },
  renderOverview() {
    const d = this.overview || {};
    const el = document.getElementById("adm-overview");
    if (!el) return;
    const cards = [
      { t: "总用户数", v: d.total_users || 0, icon: "👥", color: ["#3b82f6", "#dbeafe"], sub: "已注册账号" },
      { t: "被锁定账号", v: d.locked_users || 0, icon: "🔒", color: ["#dc2626", "#fee2e2"], sub: "解锁后可正常登录" },
      { t: "管理员", v: d.admin_users || 0, icon: "⭐", color: ["#f59e0b", "#fef3c7"], sub: "超级管理员账号" },
      { t: "今日操作", v: d.today_logs || 0, icon: "📝", color: ["#7c3aed", "#ede9fe"], sub: "登录/解锁/重置等" },
    ];
    el.innerHTML = cards.map((x) => `
      <div style="background:#fff;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.06);padding:14px 16px;position:relative;overflow:hidden;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;">
          <div>
            <div style="font-size:13px;color:#64748b;margin-bottom:6px;">${x.t}</div>
            <div style="font-size:24px;font-weight:800;color:${x.color[0]};">${x.v}</div>
            <div style="font-size:11px;color:#94a3b8;margin-top:4px;">${x.sub}</div>
          </div>
          <div style="width:40px;height:40px;border-radius:10px;display:flex;align-items:center;justify-content:center;background:${x.color[1]};font-size:20px;">${x.icon}</div>
        </div>
      </div>`).join("");
  },

  // ================ Tab 1. 用户管理 ================
  renderUsersTabShell() {
    const el = document.getElementById("adm-tab-users");
    if (!el) return;
    el.innerHTML = `
      <div class="glass-card" style="padding:12px 16px;margin-bottom:12px;">
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
          <input id="adm-u-kw" placeholder="搜索：账号 / 昵称" style="height:34px;border-radius:8px;border:1px solid #e5e7eb;padding:4px 10px;min-width:200px;"/>
          <select id="adm-u-lock" style="height:34px;border-radius:8px;border:1px solid #e5e7eb;padding:4px 8px;">
            <option value="0">全部用户</option>
            <option value="1">仅看被锁定</option>
          </select>
          <select id="adm-u-role" style="height:34px;border-radius:8px;border:1px solid #e5e7eb;padding:4px 8px;">
            <option value="0">全部角色</option>
            <option value="1">仅看管理员</option>
          </select>
          <select id="adm-u-sort" style="height:34px;border-radius:8px;border:1px solid #e5e7eb;padding:4px 8px;">
            <option value="created_at_desc">注册时间 · 新→旧</option>
            <option value="created_at_asc">注册时间 · 旧→新</option>
            <option value="last_login_desc">最后登录 · 近→远</option>
            <option value="fails_desc">失败次数 · 高→低</option>
          </select>
          <button id="adm-u-search" class="btn-primary-sm">查询</button>
          <button id="adm-u-reset" class="btn-ghost-sm">重置</button>
        </div>
      </div>
      <div id="adm-u-table" class="glass-card" style="padding:16px 18px;"></div>`;
    document.getElementById("adm-u-search").onclick = () => this.reloadUsers(1);
    document.getElementById("adm-u-reset").onclick = () => {
      document.getElementById("adm-u-kw").value = "";
      document.getElementById("adm-u-lock").value = "0";
      document.getElementById("adm-u-role").value = "0";
      document.getElementById("adm-u-sort").value = "created_at_desc";
      this.reloadUsers(1);
    };
  },
  _usersQs() {
    return {
      keyword: (document.getElementById("adm-u-kw") || {}).value || "",
      only_locked: (document.getElementById("adm-u-lock") || {}).value || "0",
      only_admin: (document.getElementById("adm-u-role") || {}).value || "0",
      sort: (document.getElementById("adm-u-sort") || {}).value || "created_at_desc",
    };
  },
  async reloadUsers(p) {
    if (p) this.usersPage = p;
    const q = Object.assign({}, this._usersQs(), { page: this.usersPage, page_size: this.usersSize });
    const res = await API.adminListUsers(q);
    if (res && res.code === 0 && res.data) {
      this.usersList = (res.data.list || res.data.items || []);
      this.usersTotal = parseInt(res.data.total || this.usersList.length, 10) || 0;
    } else {
      this.usersList = [];
      this.usersTotal = 0;
    }
    this.renderUsers();
  },
  renderUsers() {
    const w = document.getElementById("adm-u-table");
    if (!w) return;
    if (!this.usersList.length) {
      w.innerHTML = `<div class="empty-state"><div class="empty-title">没有匹配的用户</div><div class="empty-desc">试试调整筛选条件或搜索关键词</div></div>`;
      return;
    }
    const pages = Math.max(1, Math.ceil(this.usersTotal / this.usersSize));
    const curUid = parseInt(((window.API && API.user && API.user()) || {}).id || 0, 10) || 0;
    const head = `
      <thead style="background:#f8fafc;"><tr>
        <th style="text-align:left;padding:10px 12px;font-size:12px;color:#64748b;font-weight:600;">账号</th>
        <th style="text-align:left;padding:10px 12px;font-size:12px;color:#64748b;font-weight:600;">昵称</th>
        <th style="text-align:left;padding:10px 12px;font-size:12px;color:#64748b;font-weight:600;">角色</th>
        <th style="text-align:left;padding:10px 12px;font-size:12px;color:#64748b;font-weight:600;">状态</th>
        <th style="text-align:left;padding:10px 12px;font-size:12px;color:#64748b;font-weight:600;">失败/锁定</th>
        <th style="text-align:left;padding:10px 12px;font-size:12px;color:#64748b;font-weight:600;">注册时间</th>
        <th style="text-align:left;padding:10px 12px;font-size:12px;color:#64748b;font-weight:600;">最后登录</th>
        <th style="text-align:right;padding:10px 12px;font-size:12px;color:#64748b;font-weight:600;">操作</th>
      </tr></thead>`;
    const rows = this.usersList.map((u) => {
      const isSelf = parseInt(u.id, 10) === curUid;
      const isLocked = !!u.is_locked;
      const role = parseInt(u.role, 10) || 0;
      const isAdmin = role === 1;
      const isActive = !!u.is_active;
      const fails = parseInt(u.fail_count || 0, 10) || 0;
      const lockedUntil = u.locked_until ? new Date(u.locked_until) : null;
      const lockTxt = lockedUntil ? (lockedUntil > new Date() ? `锁至 ${this._fmt(lockedUntil)}` : "已过期") : "—";
      const statusTag = (parseInt(u.is_deleted, 10) || 0)
        ? `<span style="background:#f1f5f9;color:#64748b;padding:2px 8px;border-radius:6px;font-size:11px;">已注销</span>`
        : isActive
          ? `<span style="background:#dcfce7;color:#15803d;padding:2px 8px;border-radius:6px;font-size:11px;">✅ 正常</span>`
          : `<span style="background:#fee2e2;color:#b91c1c;padding:2px 8px;border-radius:6px;font-size:11px;">🚫 已禁用</span>`;
      const roleTag = isAdmin
        ? `<span style="background:#fef3c7;color:#b45309;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:700;">⭐ 超级管理员</span>`
        : `<span style="background:#e0f2fe;color:#075985;padding:2px 8px;border-radius:6px;font-size:11px;">普通用户</span>`;
      const lockCell = (fails > 0 || isLocked)
        ? `<div style="font-size:12px;">
            <div style="color:${isLocked ? "#b91c1c" : fails >= 3 ? "#d97706" : "#475569"};">失败 ${fails} 次</div>
            <div style="color:${isLocked ? "#dc2626" : "#94a3b8"};font-size:11px;margin-top:2px;">${isLocked ? "🔒 " + lockTxt : ""}</div>
          </div>`
        : `<span style="color:#94a3b8;font-size:12px;">—</span>`;
      return `<tr style="border-top:1px solid #f1f5f9;">
        <td style="padding:10px 12px;font-size:13px;"><b style="font-family:monospace;color:#0f172a;">${u.account_no || "-"}</b>${isSelf ? ' <span style="color:#3b82f6;font-size:11px;">（自己）</span>' : ""}</td>
        <td style="padding:10px 12px;font-size:13px;color:#334155;">${u.nickname ? escapeHtml(u.nickname) : '<span style="color:#94a3b8;">（未设置）</span>'}</td>
        <td style="padding:10px 12px;">${roleTag}</td>
        <td style="padding:10px 12px;">${statusTag}</td>
        <td style="padding:10px 12px;">${lockCell}</td>
        <td style="padding:10px 12px;font-size:12px;color:#64748b;">${this._fmt(u.created_at)}</td>
        <td style="padding:10px 12px;font-size:12px;color:#64748b;">${this._fmt(u.last_login_at, "从未登录")}</td>
        <td style="padding:10px 12px;text-align:right;">
          <div style="display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap;">
            <button class="btn-primary-sm" data-uact="unlock" data-uid="${u.id}" ${!isLocked ? "disabled style='opacity:.4;cursor:not-allowed;'" : ""}>🔓 解锁</button>
            <button class="btn-ghost-sm" data-uact="toggleactive" data-uid="${u.id}" data-uactive="${isActive ? 0 : 1}" ${isSelf && !isActive ? "disabled style='opacity:.4;cursor:not-allowed;'" : ""} title="${isActive ? "软禁用账号（无法登录，现有会话立刻失效）" : "恢复启用账号"}">${isActive ? "🚫 禁用" : "✅ 启用"}</button>
            <button class="btn-ghost-sm" data-uact="resetpwd" data-uid="${u.id}" title="重置密码为 123456">🔑 重置密码</button>
            <button class="btn-ghost-sm" data-uact="role" data-uid="${u.id}" data-urole="${isAdmin ? 0 : 1}" title="${isAdmin ? "降级为普通用户" : "升级为管理员"}">${isAdmin ? "⬇️ 降级" : "⬆️ 升级管理员"}</button>
            <button class="btn-danger-outline-sm" data-uact="delete" data-uid="${u.id}" ${isSelf ? "disabled style='opacity:.4;cursor:not-allowed;'" : ""} title="${isSelf ? "不能删除自己" : "软删除（可在DB恢复）"}">🗑️ 注销</button>
          </div>
        </td>
      </tr>`;
    }).join("");
    const pagHtml = this._pagHtml(this.usersPage, pages, (p) => this.reloadUsers(p));
    w.innerHTML = `
      <div style="margin-bottom:10px;font-size:12px;color:#64748b;">共 <b style="color:#0f172a;">${this.usersTotal}</b> 个用户，第 ${this.usersPage}/${pages} 页</div>
      <div style="border:1px solid #e5e7eb;border-radius:10px;overflow:auto;">
        <table style="width:100%;border-collapse:collapse;">${head}<tbody>${rows}</tbody></table>
      </div>
      ${pagHtml}`;
    w.querySelectorAll("[data-uact]").forEach((b) => {
      b.onclick = () => this.onUserAction(b.getAttribute("data-uact"), b.getAttribute("data-uid"), b.getAttribute("data-urole"), b.getAttribute("data-uactive"));
    });
  },

  // ================ 自定义模态框（替代原生 confirm/alert/prompt，防拦截） ================
  _openDlg({ title, bodyHtml, confirmText = "确定", cancelText = "取消", showCancel = true, confirmDanger = false, inputOpts = null, onConfirm = null }) {
    const self = this;
    return new Promise((resolve) => {
      const cover = document.createElement("div");
      Object.assign(cover.style, {
        position: "fixed", inset: "0", background: "rgba(15,23,42,.55)", display: "flex",
        alignItems: "center", justifyContent: "center", zIndex: "999999", padding: "16px",
      });
      const box = document.createElement("div");
      Object.assign(box.style, {
        width: "100%", maxWidth: "460px", maxHeight: "90vh", overflow: "auto",
        background: "#fff", borderRadius: "14px", padding: "22px 24px", boxShadow: "0 20px 60px rgba(0,0,0,.3)",
      });
      const inputId = "adm-dlg-input-" + Math.random().toString(36).slice(2, 8);
      const errId = inputId + "-err";
      const isPwd = inputOpts && inputOpts.type === "password";
      box.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
          <div style="font-size:17px;font-weight:800;color:#0f172a;">${escapeHtml(title || "")}</div>
          <button data-dlg="x" style="border:0;background:transparent;font-size:20px;cursor:pointer;color:#64748b;">✕</button>
        </div>
        <div data-dlg="body" style="font-size:13.5px;color:#334155;line-height:1.7;white-space:pre-wrap;word-break:break-word;">${bodyHtml || ""}</div>
        ${inputOpts ? `
          <div style="margin-top:16px;">
            <input id="${inputId}" type="${isPwd ? "password" : "text"}" maxlength="${inputOpts.maxlen || 50}"
              value="${escapeAttr(inputOpts.defaultValue || "")}"
              placeholder="${escapeAttr(inputOpts.placeholder || "")}"
              style="width:100%;height:40px;border-radius:10px;border:1.5px solid #e5e7eb;padding:4px 14px;font-size:15px;letter-spacing:.5px;outline:none;color:#0f172a;background:#fff;-webkit-text-fill-color:#0f172a;caret-color:#0f172a;box-sizing:border-box;"/>
            ${isPwd ? `<label style="display:flex;align-items:center;gap:6px;margin-top:8px;font-size:12px;color:#64748b;cursor:pointer;user-select:none;">
              <input type="checkbox" data-dlg="showpwd"/> <span>显示密码</span>
            </label>` : ""}
            <div id="${errId}" style="color:#dc2626;font-size:12px;margin-top:6px;min-height:16px;"></div>
          </div>` : ""}
        <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:18px;">
          ${showCancel ? `<button data-dlg="cancel" class="btn-ghost-sm">${escapeHtml(cancelText)}</button>` : ""}
          <button data-dlg="ok" class="btn-primary-sm" ${confirmDanger ? "style='background:#dc2626;border-color:#dc2626;'" : ""}>${escapeHtml(confirmText)}</button>
        </div>`;
      cover.appendChild(box);
      document.body.appendChild(cover);
      const close = (val) => { try { if (cover.parentNode) document.body.removeChild(cover); } catch (_) {} resolve(val); };
      const $x = box.querySelector('[data-dlg="x"]'); if ($x) $x.onclick = () => close(inputOpts ? null : false);
      if (showCancel) { const $c = box.querySelector('[data-dlg="cancel"]'); if ($c) $c.onclick = () => close(inputOpts ? null : false); }
      const okBtn = box.querySelector('[data-dlg="ok"]');
      if (!okBtn) { close(inputOpts ? null : false); return; }
      const runOk = async () => {
        if (inputOpts) {
          const inp = box.querySelector("#" + inputId);
          if (!inp) { close(inputOpts ? null : false); return; }
          const v = String(inp.value || "").trim();
          const $err = box.querySelector("#" + errId);
          if (inputOpts.allowEmpty === false && v === "") {
            if ($err) $err.textContent = inputOpts.emptyMsg || "内容不能为空";
            inp.style.borderColor = "#dc2626"; inp.focus(); return;
          }
          if (inputOpts.regex && !inputOpts.regex.test(v)) {
            if ($err) $err.textContent = inputOpts.regexMsg || "输入格式不正确";
            inp.style.borderColor = "#dc2626"; inp.focus(); return;
          }
          if (typeof onConfirm === "function") {
            okBtn.disabled = true; okBtn.style.opacity = ".6";
            let ok = false, errMsg = "";
            try { ok = await onConfirm(v); } catch (e) { errMsg = (e && e.message) || "验证失败"; }
            okBtn.disabled = false; okBtn.style.opacity = "";
            if (!ok) { if ($err) $err.textContent = errMsg || "验证未通过"; inp.style.borderColor = "#dc2626"; inp.focus(); return; }
          }
          close(v);
        } else {
          if (typeof onConfirm === "function") { try { await onConfirm(); } catch (_) {} }
          close(true);
        }
      };
      okBtn.onclick = runOk;
      if (inputOpts) {
        const inp = box.querySelector("#" + inputId);
        if (inp) {
          setTimeout(() => { try { inp.focus(); } catch (_) {} try { inp.select(); } catch (_) {} }, 20);
          inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); runOk(); } if (e.key === "Escape") close(inputOpts ? null : false); });
          if (isPwd) {
            const sp = box.querySelector('[data-dlg="showpwd"]');
            if (sp) sp.onchange = () => { inp.type = sp.checked ? "text" : "password"; };
          }
          inp.addEventListener("input", () => {
            inp.style.borderColor = "#e5e7eb";
            const $err = box.querySelector("#" + errId);
            if ($err) $err.textContent = "";
          });
        }
      }
      cover.addEventListener("click", (e) => { if (e.target === cover) close(inputOpts ? null : false); });
    });
  },
  _dlgAlert(msg, title) {
    return this._openDlg({
      title: title || "提示",
      bodyHtml: escapeHtml(msg || ""),
      showCancel: false,
      confirmText: "知道了",
    });
  },
  _dlgConfirm(msg, title, opts) {
    return this._openDlg(Object.assign({
      title: title || "请确认",
      bodyHtml: escapeHtml(msg || ""),
      confirmText: "确认",
      cancelText: "取消",
      showCancel: true,
    }, opts || {}));
  },
  _dlgPrompt({ message, title, defaultValue = "", placeholder = "", type = "text", maxlen = 50, allowEmpty = true, emptyMsg = "", regex = null, regexMsg = "" }) {
    return this._openDlg({
      title: title || "请输入",
      bodyHtml: escapeHtml(message || ""),
      confirmText: "确定",
      cancelText: "取消",
      showCancel: true,
      inputOpts: { defaultValue, placeholder, type, maxlen, allowEmpty, emptyMsg, regex, regexMsg },
    });
  },
  _showMiniToast(msg, level) {
    const id = "adm-mini-t-" + Math.random().toString(36).slice(2, 7);
    const color = level === "ok" ? "#16a34a" : level === "err" ? "#dc2626" : "#2563eb";
    const el = document.createElement("div");
    Object.assign(el.style, {
      position: "fixed", left: "50%", top: "70px", transform: "translateX(-50%)", zIndex: "9999999",
      padding: "9px 16px", borderRadius: "999px", color: "#fff", fontSize: "13px", fontWeight: "700",
      background: color, boxShadow: "0 6px 16px rgba(0,0,0,.18)", letterSpacing: ".3px",
    });
    el.id = id;
    el.textContent = String(msg || "");
    document.body.appendChild(el);
    setTimeout(() => { try { const n = document.getElementById(id); if (n) document.body.removeChild(n); } catch (_) {} }, 1800);
  },

  // ================ 二次密码验证（功能2核心） ================
  async _requireVerifyPwd(reasonText) {
    try {
      let attempt = 0;
      let lastValidTs = Number(window.sessionStorage.getItem("__admin_pwd_ok_ts") || "0");
      let uid = Number(window.sessionStorage.getItem("__admin_pwd_ok_uid") || "0");
      const curUid = Number((typeof API.currentUserId === "function" ? API.currentUserId() : 0)) || 0;
      if (lastValidTs > 0 && Date.now() - lastValidTs < 60 * 1000 && uid === curUid && curUid > 0) {
        return true;
      }
      while (attempt < 3) {
        const baseText = reasonText || "此操作需验证您的管理员密码（6~12 位数字）\n（60秒内只需要验证一次）";
        const retryText = attempt > 0 ? `\n\n⚠️ 前面${attempt}次密码错误，请重试` : "";
        const pwd = await this._dlgPrompt({
          title: "🔐 管理员二次验证",
          message: `${baseText}${retryText}`,
          type: "password", maxlen: 12, allowEmpty: false, emptyMsg: "请输入密码",
          regex: /^\d{6,12}$/, regexMsg: "密码必须是 6~12 位数字",
        });
        if (pwd === null || pwd === "") return false;
        let res = null;
        try { res = await API.adminVerifySelfPwd(pwd); } catch (e) { res = null; }
        if (res && res.code === 0 && res.data && res.data.valid) {
          const nowUid = Number(typeof API.currentUserId === "function" ? API.currentUserId() : 0) || 0;
          window.sessionStorage.setItem("__admin_pwd_ok_ts", String(Date.now()));
          window.sessionStorage.setItem("__admin_pwd_ok_uid", String(nowUid));
          return true;
        }
        attempt++;
        await this._dlgAlert("❌ " + (res && res.msg ? res.msg : "管理员密码错误") + (attempt < 3 ? `（还剩 ${3 - attempt} 次机会）` : ""), "密码错误");
      }
      await this._dlgAlert("多次密码错误，已取消本次操作", "操作已取消");
      return false;
    } catch (e) {
      console.error("[ModAdmin._requireVerifyPwd] 异常:", e);
      try { await this._dlgAlert("验证过程出错：" + ((e && e.message) ? e.message : String(e)), "异常"); } catch (_) {}
      return false;
    }
  },

  async onUserAction(act, uid, roleExtra, activeExtra) {
    try {
      if (!uid) return;
      uid = parseInt(uid, 10);
      if (!uid || uid <= 0) return;
      if (act === "unlock") {
        const ok = await this._dlgConfirm(`确认解锁用户 #${uid}？\n解锁后失败计数清零，用户可重新登录。`, "解锁用户");
        if (!ok) return;
        const res = await API.adminUnlockUser(uid);
        this._toast(res, "解锁成功");
        this.reloadAll();
      } else if (act === "toggleactive") {
        const newAct = parseInt(activeExtra, 10) || 0;
        const txt = newAct === 1 ? "启用（恢复登录）" : "禁用（立刻踢下线，无法登录）";
        const ok = await this._dlgConfirm(`确认将用户 #${uid} ${txt}？`, newAct === 1 ? "启用用户" : "禁用用户", { confirmDanger: newAct === 0 });
        if (!ok) return;
        if (newAct === 0) {
          const ok2 = await this._requireVerifyPwd("禁用用户账号（高风险：立即踢下线）");
          if (!ok2) return;
        }
        const res = await API.adminToggleActive(uid, newAct);
        this._toast(res, `用户已${newAct === 1 ? "启用" : "禁用"}`);
        this.reloadAll();
      } else if (act === "resetpwd") {
        const newPwd = await this._dlgPrompt({
          title: "重置用户密码",
          message: `请为用户 #${uid} 设置新密码（6~12 位数字）\n留空则重置为默认 123456`,
          defaultValue: "123456", placeholder: "6~12位数字，留空=123456",
          type: "password", maxlen: 12,
          regex: /^(\d{6,12})?$/, regexMsg: "密码必须是 6~12 位数字",
        });
        if (newPwd === null) return;
        const realPwd = String(newPwd || "").trim();
        if (realPwd !== "" && !/^\d{6,12}$/.test(realPwd)) { await this._dlgAlert("密码必须是 6~12 位数字", "格式错误"); return; }
        const ok = await this._requireVerifyPwd("重置用户密码");
        if (!ok) return;
        const res = await API.adminResetPwd(uid, realPwd || "123456");
        this._toast(res, `密码已重置为 ${realPwd || "123456"}`);
      } else if (act === "role") {
        const nr = parseInt(roleExtra, 10) || 0;
        const txt = nr === 1 ? "升级为超级管理员" : "降级为普通用户";
        const ok = await this._dlgConfirm(`确认将用户 #${uid} ${txt}？\n（系统至少保留 1 名超级管理员）`, txt);
        if (!ok) return;
        const ok2 = await this._requireVerifyPwd(txt + "（系统权限变更）");
        if (!ok2) return;
        const res = await API.adminSetRole(uid, nr);
        this._toast(res, txt + " 成功");
        this.reloadAll();
      } else if (act === "delete") {
        const ok = await this._dlgConfirm(
          `确认注销用户 #${uid}？\n\n说明：这是软删除（DB 中 is_deleted=1），用户将无法登录，但所有数据保留，可在数据库中恢复。`,
          "注销用户（高风险）",
          { confirmText: "确认注销", confirmDanger: true }
        );
        if (!ok) return;
        const ok2 = await this._requireVerifyPwd("注销用户（高风险）");
        if (!ok2) return;
        const res = await API.adminDeleteUser(uid);
        this._toast(res, "用户已注销");
        setTimeout(() => this.reloadAll(), 80);
      }
    } catch (e) {
      console.error("[ModAdmin.onUserAction] 异常 act=" + act + " uid=" + uid + ":", e);
      try {
        await this._dlgAlert("操作过程中出现错误：\n" + ((e && e.message) ? e.message : String(e)), "操作异常");
      } catch (_) {
        try { alert("操作异常：" + ((e && e.message) ? e.message : String(e))); } catch (__) {}
      }
    }
  },

  // ================ Tab 2. 审计日志 ================
  renderLogsTabShell() {
    const el = document.getElementById("adm-tab-logs");
    if (!el) return;
    el.innerHTML = `
      <div class="glass-card" style="padding:12px 16px;margin-bottom:12px;">
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
          <input id="adm-l-acc" placeholder="按账号筛选（6位数字）" maxlength="6" style="height:34px;border-radius:8px;border:1px solid #e5e7eb;padding:4px 10px;min-width:180px;"/>
          <input id="adm-l-reason" placeholder="搜索原因 / 类型关键词" style="height:34px;border-radius:8px;border:1px solid #e5e7eb;padding:4px 10px;min-width:180px;"/>
          <select id="adm-l-fail" style="height:34px;border-radius:8px;border:1px solid #e5e7eb;padding:4px 8px;">
            <option value="0">全部日志</option>
            <option value="1">仅看失败</option>
          </select>
          <button id="adm-l-search" class="btn-primary-sm">查询</button>
          <button id="adm-l-reset" class="btn-ghost-sm">重置</button>
          <div style="flex:1;display:flex;justify-content:flex-end;">
            <span style="font-size:12px;color:#94a3b8;align-self:center;">💡 仅展示最近操作，敏感操作（解锁/重置/删用户）会特别记录</span>
          </div>
        </div>
      </div>
      <div id="adm-l-table" class="glass-card" style="padding:16px 18px;"></div>`;
    document.getElementById("adm-l-search").onclick = () => this.reloadLogs(1);
    document.getElementById("adm-l-reset").onclick = () => {
      document.getElementById("adm-l-acc").value = "";
      document.getElementById("adm-l-reason").value = "";
      document.getElementById("adm-l-fail").value = "0";
      this.reloadLogs(1);
    };
  },
  _logsQs() {
    return {
      account_no: (document.getElementById("adm-l-acc") || {}).value || "",
      fail_reason: (document.getElementById("adm-l-reason") || {}).value || "",
      only_fail: (document.getElementById("adm-l-fail") || {}).value || "0",
    };
  },
  async reloadLogs(p) {
    if (p) this.logsPage = p;
    const q = Object.assign({}, this._logsQs(), { page: this.logsPage, page_size: this.logsSize });
    const res = await API.adminLogs(q);
    if (res && res.code === 0 && res.data) {
      this.logsList = (res.data.list || res.data.items || []);
      this.logsTotal = parseInt(res.data.total || this.logsList.length, 10) || 0;
    } else {
      this.logsList = [];
      this.logsTotal = 0;
    }
    this.renderLogs();
  },
  renderLogs() {
    const w = document.getElementById("adm-l-table");
    if (!w) return;
    if (!this.logsList.length) {
      w.innerHTML = `<div class="empty-state"><div class="empty-title">暂无操作日志</div><div class="empty-desc">修改筛选条件或稍后再看</div></div>`;
      return;
    }
    const pages = Math.max(1, Math.ceil(this.logsTotal / this.logsSize));
    const reasonColor = (r) => {
      const rr = String(r || "");
      if (rr.startsWith("admin_")) return "#7c3aed";
      if (["locked", "rate_limited_login", "pwd_err", "captcha_wrong"].includes(rr)) return "#dc2626";
      if (rr === "" || rr === "login_ok" || rr === "success") return "#16a34a";
      return "#475569";
    };
    const reasonLabel = (r) => {
      const map = {
        admin_unlock: "管理员·解锁用户", admin_reset_pwd: "管理员·重置密码",
        admin_set_role: "管理员·改角色", admin_delete_user: "管理员·注销用户",
        admin_set_active: "管理员·启用/禁用", admin_verify_pwd_ok: "管理员·二次验证通过", admin_verify_pwd_fail: "管理员·二次验证失败",
        admin_ann_create: "管理员·新增公告", admin_ann_update: "管理员·修改公告",
        admin_ann_delete: "管理员·删除公告", admin_ann_pin: "管理员·置/取消顶公告",
        locked: "账号锁定", pwd_err: "密码错误", captcha_wrong: "验证码错误",
        captcha_missing: "缺少验证码", captcha_expired: "验证码过期",
        not_found: "账号不存在", rate_limited_login: "登录频率过高",
      };
      return map[r] || (r || "登录/操作");
    };
    const head = `
      <thead style="background:#f8fafc;"><tr>
        <th style="text-align:left;padding:10px 12px;font-size:12px;color:#64748b;font-weight:600;width:160px;">时间</th>
        <th style="text-align:left;padding:10px 12px;font-size:12px;color:#64748b;font-weight:600;">账号</th>
        <th style="text-align:left;padding:10px 12px;font-size:12px;color:#64748b;font-weight:600;">状态</th>
        <th style="text-align:left;padding:10px 12px;font-size:12px;color:#64748b;font-weight:600;">操作 / 原因</th>
        <th style="text-align:left;padding:10px 12px;font-size:12px;color:#64748b;font-weight:600;">IP</th>
        <th style="text-align:left;padding:10px 12px;font-size:12px;color:#64748b;font-weight:600;">客户端</th>
      </tr></thead>`;
    const rows = this.logsList.map((r) => {
      const ok = !!r.is_success;
      const tag = ok
        ? `<span style="background:#dcfce7;color:#15803d;padding:2px 8px;border-radius:6px;font-size:11px;">✅ 成功</span>`
        : `<span style="background:#fee2e2;color:#b91c1c;padding:2px 8px;border-radius:6px;font-size:11px;">❌ 失败</span>`;
      const rTxt = reasonLabel(r.fail_reason);
      const rCol = reasonColor(r.fail_reason);
      const ua = (r.user_agent || "").toString().slice(0, 80);
      const ip = r.ip_masked || r.ip || "—";
      return `<tr style="border-top:1px solid #f1f5f9;">
        <td style="padding:10px 12px;font-size:12px;color:#475569;white-space:nowrap;">${this._fmt(r.created_at)}</td>
        <td style="padding:10px 12px;font-size:13px;"><b style="font-family:monospace;color:#0f172a;">${r.attempt_account || r.account_no || "-"}</b></td>
        <td style="padding:10px 12px;">${tag}</td>
        <td style="padding:10px 12px;font-size:12px;"><span style="color:${rCol};font-weight:600;">${escapeHtml(rTxt)}</span>${r.fail_reason && !rTxt.includes(r.fail_reason) ? `<span style="color:#94a3b8;font-size:11px;margin-left:6px;">(${escapeHtml(r.fail_reason)})</span>` : ""}</td>
        <td style="padding:10px 12px;font-size:12px;color:#475569;font-family:monospace;">${ip}</td>
        <td style="padding:10px 12px;font-size:11px;color:#94a3b8;max-width:320px;" title="${escapeHtml(r.user_agent || "")}">${escapeHtml(ua)}${r.user_agent && r.user_agent.length > 80 ? "…" : ""}</td>
      </tr>`;
    }).join("");
    const pagHtml = this._pagHtml(this.logsPage, pages, (p) => this.reloadLogs(p));
    w.innerHTML = `
      <div style="margin-bottom:10px;font-size:12px;color:#64748b;">共 <b style="color:#0f172a;">${this.logsTotal}</b> 条日志，第 ${this.logsPage}/${pages} 页</div>
      <div style="border:1px solid #e5e7eb;border-radius:10px;overflow:auto;">
        <table style="width:100%;border-collapse:collapse;">${head}<tbody>${rows}</tbody></table>
      </div>
      ${pagHtml}`;
  },

  // ================ Tab 3. 系统公告 ================
  renderAnnTabShell() {
    const el = document.getElementById("adm-tab-announcements");
    if (!el) return;
    el.innerHTML = `
      <div class="glass-card" style="padding:12px 16px;margin-bottom:12px;">
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
          <select id="adm-a-active" style="height:34px;border-radius:8px;border:1px solid #e5e7eb;padding:4px 8px;">
            <option value="0">全部公告（含未启用/已过期）</option>
            <option value="1">仅看当前生效中</option>
          </select>
          <button id="adm-a-search" class="btn-primary-sm">查询</button>
          <button id="adm-a-reset" class="btn-ghost-sm">重置</button>
          <div style="flex:1;display:flex;justify-content:flex-end;">
            <button id="adm-a-new" class="btn-primary-sm" style="background:#7c3aed;border-color:#7c3aed;">➕ 发布新公告</button>
          </div>
        </div>
      </div>
      <div id="adm-a-table" class="glass-card" style="padding:16px 18px;"></div>`;
    document.getElementById("adm-a-search").onclick = () => this.reloadAnnouncements(1);
    document.getElementById("adm-a-reset").onclick = () => { document.getElementById("adm-a-active").value = "0"; this.reloadAnnouncements(1); };
    document.getElementById("adm-a-new").onclick = () => this._openAnnEditor(null);
  },
  async reloadAnnouncements(p) {
    if (p) this.annPage = p;
    const onlyActive = (document.getElementById("adm-a-active") || {}).value === "1" ? 1 : 0;
    const res = await API.adminListAnnouncements({ page: this.annPage, page_size: this.annSize, only_active: onlyActive });
    if (res && res.code === 0 && res.data) {
      this.annList = (res.data.list || []);
      this.annTotal = parseInt(res.data.total || this.annList.length, 10) || 0;
    } else {
      this.annList = [];
      this.annTotal = 0;
    }
    this.renderAnnouncements();
  },
  _bannerStyle(level) {
    const L = String(level || "info").toLowerCase();
    const map = {
      info:    { bg: "#dbeafe", fg: "#1e40af", tag: "🔵 普通" },
      success: { bg: "#dcfce7", fg: "#166534", tag: "🟢 重要通知" },
      warning: { bg: "#fef3c7", fg: "#92400e", tag: "🟡 提醒" },
      danger:  { bg: "#fee2e2", fg: "#991b1b", tag: "🔴 紧急" },
    };
    return map[L] || map.info;
  },
  renderAnnouncements() {
    const w = document.getElementById("adm-a-table");
    if (!w) return;
    if (!this.annList.length) {
      w.innerHTML = `<div class="empty-state"><div class="empty-title">还没有公告</div><div class="empty-desc">点右上角「发布新公告」就可以给全站用户发通知啦～</div></div>`;
      return;
    }
    const pages = Math.max(1, Math.ceil(this.annTotal / this.annSize));
    const now = new Date();
    const rows = this.annList.map((a) => {
      const st = this._bannerStyle(a.banner_level);
      const eff = a.effective_at ? new Date(a.effective_at) : null;
      const exp = a.expire_at ? new Date(a.expire_at) : null;
      const notYet = eff && eff > now;
      const expired = exp && exp < now;
      let stat = "";
      if (!a.is_active) stat = `<span style="background:#f1f5f9;color:#64748b;padding:2px 8px;border-radius:6px;font-size:11px;">未启用</span>`;
      else if (notYet) stat = `<span style="background:#ede9fe;color:#5b21b6;padding:2px 8px;border-radius:6px;font-size:11px;">⏱️ 未生效</span>`;
      else if (expired) stat = `<span style="background:#f1f5f9;color:#64748b;padding:2px 8px;border-radius:6px;font-size:11px;">已过期</span>`;
      else stat = `<span style="background:#dcfce7;color:#15803d;padding:2px 8px;border-radius:6px;font-size:11px;">✅ 生效中</span>`;
      const pinTag = a.is_pinned ? `<span style="margin-right:6px;padding:2px 6px;border-radius:4px;background:#fef3c7;color:#92400e;font-size:10px;font-weight:700;">📌 置顶</span>` : "";
      const priTag = (a.priority && a.priority !== 0) ? `<span style="margin-right:6px;padding:1px 6px;border-radius:4px;background:#f1f5f9;color:#475569;font-size:10px;">优先级 ${a.priority}</span>` : "";
      const contentSnippet = String(a.content || "").replace(/\s+/g, " ").slice(0, 60);
      return `<tr style="border-top:1px solid #f1f5f9;">
        <td style="padding:10px 12px;">
          ${pinTag}${priTag}<span style="padding:2px 8px;border-radius:6px;background:${st.bg};color:${st.fg};font-size:11px;font-weight:700;">${st.tag}</span>
        </td>
        <td style="padding:10px 12px;">
          <div style="font-size:14px;font-weight:700;color:#0f172a;">${escapeHtml(a.title || "")}</div>
          <div style="font-size:12px;color:#64748b;margin-top:4px;line-height:1.5;">${escapeHtml(contentSnippet)}${(a.content || "").length > 60 ? "…" : ""}</div>
        </td>
        <td style="padding:10px 12px;font-size:12px;color:#64748b;white-space:nowrap;">
          <div>创建：${this._fmt(a.created_at)}</div>
          <div style="margin-top:3px;">更新：${this._fmt(a.updated_at, "-")}</div>
          <div style="margin-top:3px;">生效：${a.effective_at ? this._fmt(a.effective_at).slice(0, 10) : "立即"} ~ ${a.expire_at ? this._fmt(a.expire_at).slice(0, 10) : "永久"}</div>
        </td>
        <td style="padding:10px 12px;">${stat}</td>
        <td style="padding:10px 12px;text-align:right;">
          <div style="display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap;">
            <button class="btn-ghost-sm" data-act="pin" data-id="${a.id}" data-pin="${a.is_pinned ? 0 : 1}" title="${a.is_pinned ? "取消置顶" : "置顶（全站首页第一个）"}">${a.is_pinned ? "📌 取消置顶" : "📍 置顶"}</button>
            <button class="btn-ghost-sm" data-act="edit" data-id="${a.id}">✏️ 编辑</button>
            <button class="btn-danger-outline-sm" data-act="del" data-id="${a.id}" title="删除（软删）">🗑️ 删除</button>
          </div>
        </td>
      </tr>`;
    }).join("");
    const pagHtml = this._pagHtml(this.annPage, pages, (p) => this.reloadAnnouncements(p));
    w.innerHTML = `
      <div style="margin-bottom:10px;font-size:12px;color:#64748b;">共 <b style="color:#0f172a;">${this.annTotal}</b> 条公告，第 ${this.annPage}/${pages} 页</div>
      <div style="border:1px solid #e5e7eb;border-radius:10px;overflow:auto;">
        <table style="width:100%;border-collapse:collapse;">
          <thead style="background:#f8fafc;"><tr>
            <th style="text-align:left;padding:10px 12px;font-size:12px;color:#64748b;font-weight:600;width:230px;">类型/标签</th>
            <th style="text-align:left;padding:10px 12px;font-size:12px;color:#64748b;font-weight:600;">标题 / 内容</th>
            <th style="text-align:left;padding:10px 12px;font-size:12px;color:#64748b;font-weight:600;width:220px;">时间</th>
            <th style="text-align:left;padding:10px 12px;font-size:12px;color:#64748b;font-weight:600;">状态</th>
            <th style="text-align:right;padding:10px 12px;font-size:12px;color:#64748b;font-weight:600;width:280px;">操作</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      ${pagHtml}`;
    w.querySelectorAll("[data-act]").forEach((b) => {
      b.onclick = () => this._onAnnAction(b.getAttribute("data-act"), b.getAttribute("data-id"), b.getAttribute("data-pin"));
    });
  },
  async _onAnnAction(act, id, pinExtra) {
    try {
      if (!id) return;
      id = parseInt(id, 10);
      if (!id || id <= 0) return;
      if (act === "pin") {
        const pin = parseInt(pinExtra, 10) || 0;
        const res = await API.adminPinAnnouncement(id, pin);
        this._toast(res, pin ? "已置顶" : "已取消置顶");
        this.reloadAnnouncements(1);
      } else if (act === "edit") {
        const item = this.annList.find((x) => parseInt(x.id, 10) === id);
        if (!item) return;
        this._openAnnEditor(item);
      } else if (act === "del") {
        const ok = await this._dlgConfirm("确认删除这条公告吗？\n（软删，DB 里可以恢复）", "删除公告", { confirmDanger: true });
        if (!ok) return;
        const ok2 = await this._requireVerifyPwd("删除公告");
        if (!ok2) return;
        const res = await API.adminDeleteAnnouncement(id);
        this._toast(res, "已删除");
        setTimeout(() => this.reloadAnnouncements(1), 80);
      }
    } catch (e) {
      console.error("[ModAdmin._onAnnAction] 异常 act=" + act + " id=" + id + ":", e);
      try {
        await this._dlgAlert("操作出错：" + ((e && e.message) ? e.message : String(e)), "异常");
      } catch (_) {}
    }
  },
  _openAnnEditor(item) {
    const self = this;
    const isEdit = !!item;
    const d = item || {};
    const titleOri = String(d.title || "").trim();
    const contentOri = String(d.content || "").trim();
    const levelOri = String(d.banner_level || "info").toLowerCase();
    const pinOri = !!d.is_pinned ? "1" : "0";
    const actOri = !!d.is_active ? "1" : "0";
    const priOri = Number.isFinite(+d.priority) ? String(+d.priority) : "0";
    const effOri = d.effective_at ? this._fmtForInput(d.effective_at) : "";
    const expOri = d.expire_at ? this._fmtForInput(d.expire_at) : "";
    const cover = document.createElement("div");
    Object.assign(cover.style, {
      position: "fixed", inset: "0", background: "rgba(15,23,42,.55)", display: "flex",
      alignItems: "center", justifyContent: "center", zIndex: "99999", padding: "16px",
    });
    const box = document.createElement("div");
    Object.assign(box.style, {
      width: "100%", maxWidth: "640px", maxHeight: "90vh", overflow: "auto",
      background: "#fff", borderRadius: "14px", padding: "22px 24px", boxShadow: "0 20px 60px rgba(0,0,0,.3)",
    });
    box.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
        <div style="font-size:18px;font-weight:800;color:#0f172a;">${isEdit ? "✏️ 编辑公告" : "➕ 发布新公告"}</div>
        <button id="adm-ann-x" style="border:0;background:transparent;font-size:20px;cursor:pointer;color:#64748b;">✕</button>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px 16px;">
        <div style="grid-column:1 / -1;">
          <label style="font-size:12px;color:#475569;font-weight:600;">公告标题</label>
          <input id="f-title" maxlength="80" value="${escapeAttr(titleOri)}" placeholder="请输入标题（80字以内）" style="width:100%;height:38px;border-radius:8px;border:1px solid #e5e7eb;padding:4px 12px;margin-top:6px;"/>
        </div>
        <div>
          <label style="font-size:12px;color:#475569;font-weight:600;">横幅样式</label>
          <select id="f-level" style="width:100%;height:38px;border-radius:8px;border:1px solid #e5e7eb;padding:4px 10px;margin-top:6px;">
            <option value="info">🔵 普通公告（蓝）</option>
            <option value="success">🟢 重要通知（绿）</option>
            <option value="warning">🟡 提醒类（黄）</option>
            <option value="danger">🔴 紧急公告（红）</option>
          </select>
        </div>
        <div>
          <label style="font-size:12px;color:#475569;font-weight:600;">优先级（-10~10，数越大越靠前）</label>
          <input id="f-pri" type="number" min="-10" max="10" value="${escapeAttr(priOri)}" style="width:100%;height:38px;border-radius:8px;border:1px solid #e5e7eb;padding:4px 12px;margin-top:6px;"/>
        </div>
        <div>
          <label style="font-size:12px;color:#475569;font-weight:600;">📌 置顶？</label>
          <select id="f-pin" style="width:100%;height:38px;border-radius:8px;border:1px solid #e5e7eb;padding:4px 10px;margin-top:6px;">
            <option value="0">否</option>
            <option value="1">是（全站首页第一个，最多一条）</option>
          </select>
        </div>
        <div>
          <label style="font-size:12px;color:#475569;font-weight:600;">立即启用？</label>
          <select id="f-act" style="width:100%;height:38px;border-radius:8px;border:1px solid #e5e7eb;padding:4px 10px;margin-top:6px;">
            <option value="1">是，保存后立即生效</option>
            <option value="0">否，先存为草稿</option>
          </select>
        </div>
        <div>
          <label style="font-size:12px;color:#475569;font-weight:600;">生效开始时间（留空=立即）</label>
          <input id="f-eff" type="datetime-local" value="${escapeAttr(effOri)}" style="width:100%;height:38px;border-radius:8px;border:1px solid #e5e7eb;padding:4px 12px;margin-top:6px;"/>
        </div>
        <div>
          <label style="font-size:12px;color:#475569;font-weight:600;">到期时间（留空=永久）</label>
          <input id="f-exp" type="datetime-local" value="${escapeAttr(expOri)}" style="width:100%;height:38px;border-radius:8px;border:1px solid #e5e7eb;padding:4px 12px;margin-top:6px;"/>
        </div>
        <div style="grid-column:1 / -1;">
          <label style="font-size:12px;color:#475569;font-weight:600;">公告正文（支持换行，4000字以内）</label>
          <textarea id="f-content" rows="7" maxlength="4000" placeholder="请输入公告内容，支持换行..." style="width:100%;border-radius:8px;border:1px solid #e5e7eb;padding:10px 12px;margin-top:6px;resize:vertical;line-height:1.6;">${escapeHtml(contentOri)}</textarea>
          <div style="text-align:right;font-size:11px;color:#94a3b8;margin-top:4px;"><span id="f-cnt">0</span> / 4000</div>
          <div id="f-err" style="color:#dc2626;font-size:12px;margin-top:4px;min-height:16px;"></div>
        </div>
      </div>
      <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:16px;">
        <button id="adm-ann-cancel" class="btn-ghost-sm">取消</button>
        <button id="adm-ann-save" class="btn-primary-sm" style="background:#7c3aed;border-color:#7c3aed;">💾 保存${isEdit ? "修改" : "并发布"}</button>
      </div>
    `;
    cover.appendChild(box);
    document.body.appendChild(cover);
    const levelSel = box.querySelector("#f-level");
    if (["info", "success", "warning", "danger"].includes(levelOri)) levelSel.value = levelOri;
    box.querySelector("#f-pin").value = pinOri;
    box.querySelector("#f-act").value = actOri;
    const ta = box.querySelector("#f-content");
    const cnt = box.querySelector("#f-cnt");
    const errBox = box.querySelector("#f-err");
    const up = () => { cnt.textContent = String(ta.value.length); };
    ta.addEventListener("input", up); up();
    ["#f-title", "#f-content"].forEach((sel) => {
      const n = box.querySelector(sel); if (n) n.addEventListener("input", () => { errBox.textContent = ""; });
    });
    const close = () => { try { if (cover.parentNode) document.body.removeChild(cover); } catch (_) {} };
    const $x = box.querySelector("#adm-ann-x"); if ($x) $x.onclick = close;
    const $cancel = box.querySelector("#adm-ann-cancel"); if ($cancel) $cancel.onclick = close;
    const $save = box.querySelector("#adm-ann-save");
    if ($save) $save.onclick = async () => {
      try {
        const $title = box.querySelector("#f-title");
        const $pri = box.querySelector("#f-pri");
        const $pin = box.querySelector("#f-pin");
        const $act = box.querySelector("#f-act");
        const $eff = box.querySelector("#f-eff");
        const $exp = box.querySelector("#f-exp");
        const ti = String(($title ? $title.value : "") || "").trim();
        const co = String((ta ? ta.value : "") || "").trim();
        if (ti.length === 0) { if (errBox) errBox.textContent = "请输入公告标题"; if ($title) $title.focus(); return; }
        if (co.length === 0) { if (errBox) errBox.textContent = "请输入公告内容"; if (ta) ta.focus(); return; }
        const payload = {
          title: ti, content: co,
          banner_level: levelSel ? levelSel.value : "info",
          priority: parseInt(($pri ? $pri.value : "0") || "0", 10) || 0,
          is_pinned: ($pin && $pin.value === "1") ? 1 : 0,
          is_active: ($act && $act.value === "1") ? 1 : 0,
        };
        const eff = String(($eff ? $eff.value : "") || "").trim();
        if (eff) payload.effective_at = eff.replace("T", " ") + ":00";
        const exp = String(($exp ? $exp.value : "") || "").trim();
        if (exp) payload.expire_at = exp.replace("T", " ") + ":00";
        const ok = await self._requireVerifyPwd(isEdit ? "编辑公告" : "发布新公告");
        if (!ok) return;
        const res = isEdit
          ? await API.adminUpdateAnnouncement(id, payload)
          : await API.adminCreateAnnouncement(payload);
        self._toast(res, isEdit ? "公告已更新" : "公告已发布");
        if (res && res.code === 0) {
          close();
          setTimeout(() => self.reloadAnnouncements(1), 60);
        }
      } catch (e) {
        console.error("[ModAdmin._openAnnEditor.save] 异常:", e);
        try {
          await self._dlgAlert("保存出错：" + ((e && e.message) ? e.message : String(e)), "异常");
        } catch (_) {}
      }
    };
  },
  _fmtForInput(s) {
    if (!s) return "";
    const d = s instanceof Date ? s : new Date(s);
    if (isNaN(d.getTime())) return "";
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  },

  // ================ 通用工具 ================
  _fmt(s, fallback = "—") {
    if (!s) return fallback;
    try {
      const d = (s instanceof Date) ? s : new Date(s);
      if (isNaN(d.getTime())) return fallback;
      const pad = (n) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    } catch (_) {
      return String(s);
    }
  },
  _pagHtml(cur, total, goFn) {
    if (total <= 1) return "";
    let btns = [];
    const add = (label, p, disabled = false, active = false) => {
      btns.push(`<button data-p="${p}" ${disabled ? "disabled" : ""} ${active ? "class='pag-act'" : ""} style="${active ? "background:#3b82f6;color:#fff;border-color:#3b82f6;" : ""}padding:4px 10px;border-radius:6px;border:1px solid #e5e7eb;background:#fff;font-size:12px;cursor:pointer;${disabled ? "opacity:.4;cursor:not-allowed;" : ""}">${label}</button>`);
    };
    add("‹ 上一页", cur - 1, cur <= 1);
    const win = [];
    const push = (n) => { if (!win.includes(n) && n >= 1 && n <= total) win.push(n); };
    push(1); push(total);
    for (let i = cur - 2; i <= cur + 2; i++) push(i);
    win.sort((a, b) => a - b);
    for (let i = 0; i < win.length; i++) {
      if (i > 0 && win[i] - win[i - 1] > 1) btns.push(`<span style="padding:0 4px;color:#94a3b8;">…</span>`);
      add(String(win[i]), win[i], false, win[i] === cur);
    }
    add("下一页 ›", cur + 1, cur >= total);
    const html = `<div style="display:flex;gap:6px;justify-content:center;margin-top:14px;flex-wrap:wrap;">${btns.join("")}</div>`;
    setTimeout(() => {
      document.querySelectorAll("[data-p]").forEach((b) => {
        if (b.getAttribute("data-bound")) return;
        b.setAttribute("data-bound", "1");
        b.addEventListener("click", () => {
          if (b.disabled) return;
          const p = parseInt(b.getAttribute("data-p"), 10);
          if (p >= 1 && p <= total) goFn(p);
        });
      });
    }, 0);
    return html;
  },
  _toast(res, okMsg) {
    if (!res) return;
    if (res.code === 0) {
      this._showMiniToast("✅ " + (res.msg || okMsg || "操作成功"), "ok");
    } else {
      const msg = "❌ " + (res.msg || "操作失败");
      this._showMiniToast(msg, "err");
      this._dlgAlert(msg, "操作失败").catch(() => {});
    }
  },
};

function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function escapeAttr(s) { return escapeHtml(s).replace(/\n/g, "&#10;"); }
