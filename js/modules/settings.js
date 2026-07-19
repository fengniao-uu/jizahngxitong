window.ModSettings = {
  async init() {
    const c = document.getElementById("mod-settings-content");
    const user = API.user() || {};
    if (!c) return;
    const isMobileVer = Boolean(
      (window.matchMedia && window.matchMedia("(max-width: 768px)").matches) ||
      (typeof window.innerWidth === "number" && window.innerWidth < 769) ||
      (document.documentElement && document.documentElement.clientWidth < 769)
    );
    const versionBadge = isMobileVer ? "V 3.1.5" : "V3.0";
    const versionFooter = isMobileVer ? "V 3.1.5" : "V3.0";
    c.innerHTML = `
    <div class="mcb-shell">
      <div class="accordion-card" data-acc-key="profile">
        <div class="accordion-head">
          <span class="accordion-title">👤 账号信息</span>
          <svg class="accordion-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
        </div>
        <div class="accordion-body">
          <div class="glass-card">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px 18px;max-width:720px;">
              <div><label>账号（只读）</label><input value="${escapeHtml(user.account_no || "")}" readonly/></div>
              <div><label>昵称</label><input id="set-nick" value="${escapeHtml(user.nickname || "")}"/></div>
              <div><label>手机号</label><input id="set-phone" value="${escapeHtml(user.phone || "")}"/></div>
              <div><label>创建时间</label><input value="${escapeHtml(user.created_at || "")}" readonly/></div>
              <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                <button class="btn-primary" id="set-save-profile">保存资料</button>
                <button class="btn-ghost" id="set-refresh-me">从服务器刷新</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="accordion-card" data-acc-key="pwd">
        <div class="accordion-head">
          <span class="accordion-title">🔒 修改密码</span>
          <svg class="accordion-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
        </div>
        <div class="accordion-body">
          <div class="glass-card">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px 18px;max-width:720px;">
              <div><label>原密码</label><input id="set-old" type="password" placeholder="6~12位数字"/></div>
              <div><label>新密码 <span class="req">*</span></label><input id="set-new" type="password" placeholder="6~12位数字"/></div>
              <div style="grid-column:span 2;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                <button class="btn-primary" id="set-change-pwd">确认修改密码</button>
                <span style="color:#6b7280;font-size:12px;">建议 6~12 位数字，管理员可用更长密码提升安全性。</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="accordion-card" data-acc-key="backup">
        <div class="accordion-head">
          <span class="accordion-title">
            💾 数据备份
            <span style="display:inline-block;margin-left:8px;padding:2px 10px;border-radius:12px;background:linear-gradient(135deg,#9ca3af,#6b7280);color:#fff;font-size:11px;font-weight:500;letter-spacing:1px;">未开发</span>
          </span>
          <svg class="accordion-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
        </div>
        <div class="accordion-body">
          <div class="glass-card">
            <div style="color:#6b7280;font-size:13px;margin-bottom:12px;">定期导出，防止设备丢失或误删。（该功能开发中，暂未开放）</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">
              <button class="btn-primary-outline" id="set-backup-tx" disabled style="opacity:.55;cursor:not-allowed;">交易备份（XLSX）</button>
              <button class="btn-primary-outline" id="set-backup-zip" disabled style="opacity:.55;cursor:not-allowed;">完整备份（ZIP）</button>
              <button class="btn-ghost" id="set-sessions">查看登录会话</button>
            </div>
            <div id="set-session-info" style="margin-top:12px;color:#6b7280;font-size:13px;"></div>
          </div>
        </div>
      </div>

      <div class="accordion-card acc-danger" data-acc-key="danger">
        <div class="accordion-head">
          <span class="accordion-title" style="color:#b91c1c;">⚠️ 危险操作</span>
          <svg class="accordion-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
        </div>
        <div class="accordion-body">
          <div class="glass-card" style="border-left:4px solid #ef4444;">
            <div style="color:#6b7280;font-size:13px;margin-bottom:12px;">注销账号将永久删除你的所有交易记录、提醒和云端数据，操作不可恢复！</div>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
              <input id="set-del-pwd" type="password" placeholder="请输入当前密码确认" style="width:220px;max-width:58vw;"/>
              <button class="btn-danger" id="set-delete-account">永久注销本账号</button>
              <button class="btn-ghost" id="set-logout">退出登录</button>
            </div>
          </div>
        </div>
      </div>

      <div class="glass-card mt-3" style="padding:14px 18px;display:flex;gap:14px;align-items:center;justify-content:space-between;flex-wrap:wrap;">
        <div style="display:flex;align-items:center;gap:10px;">
          <div style="width:40px;height:40px;border-radius:10px;background:linear-gradient(135deg,#3b82f6,#8b5cf6);display:flex;align-items:center;justify-content:center;">
            <svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" class="w-5 h-5"><path d="M12 2l9 8h-3v9h-5v-6H11v6H6v-9H3z"/></svg>
          </div>
          <div>
            <div style="font-size:13px;color:#6b7280;">系统信息</div>
            <div style="font-size:15px;font-weight:600;color:#1e293b;">智能记账 · 多端互通</div>
          </div>
        </div>
        <div style="padding:4px 12px;border-radius:999px;background:rgba(99,102,241,.1);color:#6366f1;font-weight:600;font-size:13px;letter-spacing:0.5px;">
          ${versionBadge}
        </div>
      </div>
      <div class="glass-card mt-3 md:hidden" style="padding:16px 18px;">
        <button onclick="doLogout()" style="width:100%;" class="btn-danger-outline py-2.5 flex items-center justify-center gap-2 text-[14px] font-semibold">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-4 h-4"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>
          退出账号
        </button>
      </div>
      <div style="text-align:center;color:#94a3b8;font-size:12px;margin-top:14px;padding-bottom:4px;">系统版本 ${versionFooter} · © 智能记账 保留所有权利</div>
    </div>`;
    const accCards = c.querySelectorAll(".accordion-card");
    const isDesk = window.matchMedia && window.matchMedia("(min-width: 769px)").matches;
    accCards.forEach((card) => {
      if (isDesk) card.classList.add("is-open");
      const head = card.querySelector(".accordion-head");
      if (head) head.addEventListener("click", () => card.classList.toggle("is-open"));
    });
    const b = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = fn; };
    b("set-save-profile", async () => {
      const nickname = document.getElementById("set-nick").value;
      const phone = document.getElementById("set-phone").value;
      const r = await API.authUpdateProfile(nickname, phone);
      alert((r && r.code === 0) ? "资料已保存" : ((r && r.msg) || "保存失败"));
      if (r && r.code === 0) this.refreshMe();
    });
    b("set-refresh-me", () => this.refreshMe());
    b("set-change-pwd", async () => {
      const o = document.getElementById("set-old").value;
      const n = document.getElementById("set-new").value;
      if (!/^\d{6,12}$/.test(n)) return alert("新密码必须是 6~12 位数字");
      const r = await API.authChangePwd(o, n);
      if (r && r.code === 0) {
        alert("密码已修改，请重新登录");
        doLogout();
      } else alert((r && r.msg) || "修改失败");
    });
    b("set-backup-tx", () => API.backupTx());
    b("set-backup-zip", () => API.backupFull());
    b("set-sessions", async () => {
      const r = await API.authSessions();
      const info = document.getElementById("set-session-info");
      if (r && r.code === 0) {
        const list = r.data && (r.data.list || r.data.items || []);
        info.innerHTML = `当前 ${list.length} 个设备登录：<br>` + list.slice(0, 10).map((s) => `· id=${s.id} ip=${escapeHtml(s.ip || "-")} ua=${escapeHtml(s.ua ? s.ua.slice(0, 50) : "-")} ${s.is_current ? "（当前）" : ""}<br>`).join("");
      } else info.textContent = (r && r.msg) || "失败";
    });
    b("set-logout", () => doLogout());
    b("set-delete-account", async () => {
      const pwd = document.getElementById("set-del-pwd").value;
      if (!pwd) return alert("请输入当前密码");
      if (!confirm("真的要永久注销账号？所有数据无法恢复！")) return;
      const r = await API.authDeleteAccount(pwd);
      if (r && r.code === 0) {
        alert("账号已注销。已退出登录。");
        doLogout();
      } else alert((r && r.msg) || "注销失败");
    });
  },
  async refreshMe() {
    const r = await API.authMe();
    if (r && r.code === 0 && r.data) {
      API.store(API.token(), r.data);
      try {
        const nickEl = document.getElementById("set-nick");
        const phoneEl = document.getElementById("set-phone");
        if (nickEl) nickEl.value = r.data.nickname || "";
        if (phoneEl) phoneEl.value = r.data.phone || "";
      } catch (_) {}
    }
  },
};

function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
window._escapeHtml = escapeHtml;
