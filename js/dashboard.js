function _isMobileDash() {
  return Boolean(
    (window.matchMedia && window.matchMedia("(max-width: 768px)").matches) ||
    (typeof window.innerWidth === "number" && window.innerWidth < 769) ||
    (document.documentElement && document.documentElement.clientWidth < 769)
  );
}
function _swapRentTextForMobileDash(rootEl) {
  if (!rootEl || !_isMobileDash()) return;
  try {
    if (typeof document.createTreeWalker === "function") {
      const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, null);
      let n;
      while (n = walker.nextNode()) {
        if (n && n.nodeValue && typeof n.nodeValue === "string" && n.nodeValue.indexOf("收租") !== -1) {
          n.nodeValue = n.nodeValue.replace(/收租/g, "收支");
        }
      }
    }
    const all = rootEl.querySelectorAll ? rootEl.querySelectorAll("*") : [];
    for (let i = 0; i < all.length; i++) {
      const el = all[i];
      if (el && el.getAttribute && typeof el.getAttribute === "function") {
        const t = el.getAttribute("title");
        if (t && typeof t === "string" && t.indexOf("收租") !== -1) {
          el.setAttribute("title", t.replace(/收租/g, "收支"));
        }
        const alt = el.getAttribute("alt");
        if (alt && typeof alt === "string" && alt.indexOf("收租") !== -1) {
          el.setAttribute("alt", alt.replace(/收租/g, "收支"));
        }
      }
    }
  } catch (_) {}
}

window.DashApp = {
  charts: { trend: null },
  _destroy(inst) {
    if (inst && typeof inst.destroy === "function") try { inst.destroy(); } catch (_) {}
  },
  _destroyCanvas(ctx) {
    if (!ctx) return;
    if (window.Chart && typeof Chart.getChart === "function") {
      try { const old = Chart.getChart(ctx); if (old && typeof old.destroy === "function") old.destroy(); } catch (_) {}
    }
    try {
      ctx.style.width = "";
      ctx.style.height = "";
      ctx.removeAttribute("width");
      ctx.removeAttribute("height");
    } catch (_) {}
  },
  applyRoleUI() {
    const u = (window.API && typeof window.API.user === "function") ? (window.API.user() || {}) : {};
    const role = parseInt(u.role, 10) || 0;
    const isAdmin = role === 1;
    const adminMenu = document.querySelector('[data-admin-menu]');
    if (adminMenu) {
      adminMenu.style.display = isAdmin ? "flex" : "none";
    }
    const sbUserCard = document.querySelector('.sidebar .mx-2.mt-4');
    if (sbUserCard) {
      const sbNickEl = sbUserCard.querySelector('.flex-1 .truncate');
      const sbRoleEl = sbUserCard.querySelector('.flex-1 .text-xs');
      const sbAvatarEl = sbUserCard.querySelector('.w-10.h-10.rounded-full');
      const nickText = u.nickname || u.account_no || "用户";
      if (sbNickEl) sbNickEl.textContent = nickText;
      if (sbRoleEl) {
        sbRoleEl.textContent = isAdmin ? "超级管理员" : "普通用户";
        sbRoleEl.style.color = isAdmin ? "#fbbf24" : "";
        sbRoleEl.className = "text-xs truncate " + (isAdmin ? "" : "text-white/50");
      }
      if (sbAvatarEl) {
        const firstChar = (u.nickname ? u.nickname.charAt(0) : (u.account_no ? u.account_no.charAt(0) : "用"));
        sbAvatarEl.textContent = firstChar;
        if (isAdmin) {
          sbAvatarEl.style.background = "linear-gradient(135deg,#f59e0b,#fbbf24)";
          sbAvatarEl.style.color = "#78350f";
        } else {
          sbAvatarEl.style.background = "linear-gradient(135deg,#3b82f6,#8b5cf6)";
          sbAvatarEl.style.color = "#ffffff";
        }
      }
      if (isAdmin) {
        let badge = sbUserCard.querySelector('.admin-role-badge');
        if (!badge) {
          const row = sbUserCard.querySelector('.flex.items-center.gap-3');
          if (row) {
            const div = document.createElement('div');
            div.className = 'admin-role-badge';
            div.textContent = 'ADMIN';
            Object.assign(div.style, {
              padding: '2px 6px',
              borderRadius: '4px',
              fontSize: '10px',
              fontWeight: '700',
              letterSpacing: '0.05em',
              background: 'rgba(251,191,36,0.2)',
              color: '#fbbf24',
              border: '1px solid rgba(251,191,36,0.35)',
              flexShrink: '0',
              marginLeft: '6px',
            });
            const userInfoBox = row.querySelector('.flex-1');
            if (userInfoBox) userInfoBox.style.minWidth = '0';
            row.appendChild(div);
          }
        }
      } else {
        const badge = sbUserCard.querySelector('.admin-role-badge');
        if (badge) try { badge.remove(); } catch (_) {}
      }
    }
    const welcomeText = document.querySelector(".dashboard-main .welcome-bar .text-2xl");
    if (welcomeText) {
      const greetH = new Date().getHours();
      const greet = greetH < 6 ? "凌晨好" : greetH < 12 ? "早上好" : greetH < 14 ? "中午好" : greetH < 18 ? "下午好" : "晚上好";
      const nickText = (u.nickname || u.account_no || "用户");
      welcomeText.textContent = `${greet}，${nickText} 👋`;
    }
  },
  async init() {
    this.setupMobileSidebar();
    this.applyRoleUI();
    // 公告横幅（非阻塞：先渲染其他数据，不影响主流程）
    try {
      this.renderAnnouncementsBanner();
    } catch (e) { console.warn("[ann banner]", e); }

    const r = await API.dashSummary();
    const data = r && r.data;
    if (!data || r.code !== 0) {
      const statsRow = document.getElementById("stats-row");
      if (statsRow) statsRow.insertAdjacentHTML("beforebegin", `<div class="px-5 mb-3"><div class="glass-card warn" style="padding:10px 16px;color:#b45309;background:#fffbeb;border-left:4px solid #f59e0b;">⚠️ 仪表板数据加载失败：${(r && r.msg) || "请确认后端已启动"}</div></div>`);
      return;
    }
    this.renderCards(data.cards, data.meta);
    this.renderQuick(data.quick_actions || []);
    this.renderRecentTx(data.recent_transactions || []);
    this.renderUrgentReminders(data.urgent_reminders || [], data.reminder_summary || {});
    // 红色重要提醒横幅（定期导出数据）
    try {
      const statsRow = document.getElementById("stats-row");
      if (statsRow && !document.getElementById("home-data-warning")) {
        const warn = document.createElement("div");
        warn.id = "home-data-warning";
        warn.className = "px-5";
        warn.style.marginBottom = "10px";
        warn.innerHTML = `
          <div style="
            background:linear-gradient(135deg,#7f1d1d 0%,#b91c1c 40%,#dc2626 100%);
            border:1px solid rgba(252,165,165,.35);
            border-left:6px solid #fca5a5;
            border-radius:12px;
            padding:14px 18px;
            box-shadow:0 4px 18px rgba(220,38,38,.25);
            position:relative;
            overflow:hidden;
          ">
            <div style="position:absolute;right:-18px;top:-18px;font-size:120px;opacity:.06;line-height:1;color:#fff;">⚠️</div>
            <div style="display:flex;gap:12px;align-items:flex-start;position:relative;z-index:1;">
              <div style="flex-shrink:0;width:40px;height:40px;border-radius:10px;background:rgba(255,255,255,.15);display:flex;align-items:center;justify-content:center;font-size:22px;box-shadow:inset 0 0 0 1px rgba(255,255,255,.18);">
                ⚠️
              </div>
              <div style="flex:1;min-width:0;">
                <div style="font-size:16px;font-weight:800;color:#ffffff;letter-spacing:.2px;line-height:1.3;margin-bottom:4px;text-shadow:0 1px 2px rgba(0,0,0,.35);">
                  🔴 重要提醒
                </div>
                <div style="font-size:13px;font-weight:600;color:#fee2e2;line-height:1.65;">
                  请每隔<span style="color:#fff;font-weight:800;padding:1px 6px;border-radius:6px;background:rgba(255,255,255,.14);margin:0 2px;">一个月</span>或者<span style="color:#fff;font-weight:800;padding:1px 6px;border-radius:6px;background:rgba(255,255,255,.14);margin:0 2px;">两个月</span>导出一次数据，<span style="color:#ffffff;font-weight:800;">防止数据损坏或者丢失！</span>
                </div>
                <div style="font-size:12px;color:#fecaca;margin-top:5px;line-height:1.55;opacity:.95;">
                  虽然已经加强了防护机制，建议定期通过「报表导出」功能进行数据备份。
                </div>
              </div>
              <a href="#/dashboard/reports" style="flex-shrink:0;display:inline-flex;align-items:center;gap:5px;padding:8px 14px;border-radius:9px;background:#fff;color:#b91c1c;font-size:12px;font-weight:800;text-decoration:none;box-shadow:0 2px 6px rgba(0,0,0,.15);transition:transform .15s ease;"
               onmouseover="this.style.transform='translateY(-1px)'" onmouseout="this.style.transform='translateY(0)'">
                📤 立即备份
              </a>
            </div>
          </div>`;
        statsRow.parentNode.insertBefore(warn, statsRow);
      }
    } catch (_) {}
    const td = await API.statsTrend();
    if (td && td.code === 0) this.renderTrend(td.data);
  },
  _bannerStyle(level) {
    const L = String(level || "info").toLowerCase();
    const map = {
      info:    { bg: "#dbeafe", fg: "#1e40af", border: "#3b82f6", icon: "🔵" },
      success: { bg: "#dcfce7", fg: "#166534", border: "#22c55e", icon: "🟢" },
      warning: { bg: "#fef3c7", fg: "#92400e", border: "#f59e0b", icon: "🟡" },
      danger:  { bg: "#fee2e2", fg: "#991b1b", border: "#ef4444", icon: "🔴" },
    };
    return map[L] || map.info;
  },
  async renderAnnouncementsBanner() {
    const wrap = document.getElementById("ann-banner-wrap");
    if (!wrap) {
      const statsRow = document.getElementById("stats-row");
      if (!statsRow) return;
      const node = document.createElement("div");
      node.id = "ann-banner-wrap";
      node.className = "px-5";
      node.style.marginBottom = "4px";
      statsRow.parentElement.insertBefore(node, statsRow);
    }
    const box = document.getElementById("ann-banner-wrap");
    if (!box) return;
    const res = await API.getPublicAnnouncements(5);
    const list = (res && res.code === 0 && res.data && res.data.list) || [];
    if (!list.length) { box.innerHTML = ""; return; }
    const now = new Date();
    const cards = list.map((a, idx) => {
      const st = this._bannerStyle(a.banner_level);
      const pinned = !!a.is_pinned;
      const title = String(a.title || "").trim();
      const content = String(a.content || "").trim().replace(/\n/g, "<br>");
      return `<div data-ann-id="${a.id}" ${idx > 0 ? 'style="margin-top:8px;"' : ''}
        class="ann-banner-item"
        style="position:relative;background:${st.bg};color:${st.fg};border:1px solid ${st.bg};border-left:4px solid ${st.border};border-radius:10px;padding:10px 14px 10px 14px;box-shadow:0 1px 2px rgba(0,0,0,.04);">
        <div style="display:flex;gap:8px;align-items:flex-start;">
          <div style="flex-shrink:0;font-size:16px;line-height:1.4;">${st.icon}</div>
          <div style="flex:1;min-width:0;">
            <div style="font-weight:700;font-size:13px;line-height:1.4;">
              ${pinned ? '<span style="background:#fef3c7;color:#92400e;padding:1px 6px;border-radius:4px;font-size:10px;margin-right:6px;display:inline-block;vertical-align:middle;">📌 置顶</span>' : ''}
              <span style="vertical-align:middle;">${window.escapeHtml ? window.escapeHtml(title) : title}</span>
            </div>
            ${content ? `<div style="font-size:12px;opacity:.9;margin-top:4px;line-height:1.55;white-space:pre-wrap;word-break:break-word;">${window.escapeHtml ? window.escapeHtml(content).replace(/&lt;br&gt;/g, "<br>") : content}</div>` : ''}
          </div>
          <button data-ann-close="${a.id}" style="border:0;background:transparent;font-size:16px;cursor:pointer;color:${st.fg};opacity:.55;padding:0 2px;line-height:1;flex-shrink:0;" title="关闭这条公告">✕</button>
        </div>
      </div>`;
    }).join("");
    box.innerHTML = cards;
    box.querySelectorAll("[data-ann-close]").forEach((b) => {
      b.onclick = () => {
        const id = b.getAttribute("data-ann-close");
        const item = box.querySelector(`[data-ann-id="${id}"]`);
        if (item) try { item.style.display = "none"; } catch (_) {}
      };
    });
  },
  renderCards(cards, meta) {
    const row = document.getElementById("stats-row");
    if (!row || !cards || !cards.length) return;
    const palette = {
      month_income: ["#16a34a", "#dcfce7"],
      month_expense: ["#dc2626", "#fee2e2"],
      month_balance: ["#2563eb", "#dbeafe"],
      total_asset: ["#7c3aed", "#ede9fe"],
    };
    const icons = {
      month_income: '<path d="M12 19V5"/><path d="M5 12l7-7 7 7"/>',
      month_expense: '<path d="M12 5v14"/><path d="M5 12l7 7 7-7"/>',
      month_balance: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M2 10h20"/>',
      total_asset: '<circle cx="12" cy="12" r="10"/><path d="M12 6v12"/><path d="M15 9H9.5a2.5 2.5 0 000 5h5a2.5 2.5 0 010 5H6"/>',
    };
    row.innerHTML = cards.map((c) => {
      const p = palette[c.key] || palette.month_income;
      const ic = icons[c.key] || "";
      const up = (c.trend_pct || 0) >= 0;
      const arrow = up ? '<path d="M5 12l5-5 7 7"/><path d="M10 7v10"/>' : '<path d="M19 12l-5 5-7-7"/><path d="M14 17V7"/>';
      const pctColor = up ? "#4ade80" : "#f87171";
      const sign = up ? "+" : "";
      return `<div class="dash-card" style="padding:18px 20px;box-shadow:0 4px 20px rgba(0,0,0,.25);">
        <div class="flex items-center justify-between mb-4">
          <span style="font-size:15px;font-weight:600;color:#e2e8f0;letter-spacing:.2px;">${c.title}</span>
          <div style="width:42px;height:42px;border-radius:11px;display:flex;align-items:center;justify-content:center;color:${p[0]};background:${p[1]};box-shadow:0 2px 8px rgba(255,255,255,.06);">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" style="width:22px;height:22px;">${ic}</svg>
          </div>
        </div>
        <div style="font-size:30px;font-weight:800;color:#ffffff;line-height:1.2;letter-spacing:.3px;text-shadow:0 1px 2px rgba(0,0,0,.35);">¥ ${Number(c.amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
        <div style="font-size:12px;color:${pctColor};margin-top:10px;display:flex;align-items:center;gap:5px;font-weight:600;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" style="width:14px;height:14px;">${arrow}</svg>
          ${c.compare_title || "环比上月"} ${sign}${c.trend_pct || 0}%
        </div>
      </div>`;
    }).join("");
  },
  renderQuick(actions) {
    const col = document.getElementById("quick-col");
    if (!col) return;
    const palette = {
      add_income: ["#16a34a", "#dcfce7", "12 5v14/M5 12h14"],
      add_expense: ["#dc2626", "#fee2e2", "5 12h14"],
      view_records: ["#2563eb", "#dbeafe", "8 7h11l-3-3/M17 17H6l3 3"],
      analysis: ["#7c3aed", "#ede9fe", "3 3v18h18/M7 14l4-4 4 4 5-5"],
      add_reminder: ["#f59e0b", "#fef3c7", "18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9/M13.73 21a2 2 0 01-3.46 0"],
    };
    const list = actions.slice(0, 4);
    if (!list.length) return;
    const h2 = col.querySelector("h2");
    const grid = col.querySelector(".grid-cols-2");
    if (h2) h2.textContent = "快捷功能";
    if (grid) {
      grid.innerHTML = list.map((a) => {
        const p = palette[a.key] || palette.analysis;
        const [color, bg] = [p[0], p[1]];
        const ds = (p[2] || "").split("/");
        const paths = ds.map((d) => {
          const [tag, pts] = d.split(" ");
          if (tag === "M") return `<path d="M ${pts.replace(/([A-Z])/g, "$1").trim()}" />`;
          return `<${d.startsWith("c") ? "circle" : "rect"} ... />`;
        }).join("");
        // 更简单：使用通用加/图表/列表图标
        const svg =
          a.key === "add_income" ? '<path d="M12 5v14"/><path d="M5 12h14"/>' :
          a.key === "add_expense" ? '<path d="M5 12h14"/>' :
          a.key === "view_records" ? '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18"/>' :
          a.key === "add_reminder" ? '<path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/>' :
          '<path d="M3 3v18h18"/><path d="M7 14l4-4 4 4 5-5"/>';
        return `<button onclick="location.hash='${a.route || "#/dashboard/home"}'" class="flex flex-col items-center justify-center p-4 rounded-xl transition border" style="color:${color};background:${bg};border-color:${bg};">
          <div class="w-12 h-12 rounded-full text-white flex items-center justify-center mb-2" style="background:${color};">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="w-6 h-6">${svg}</svg>
          </div>
          <span class="text-sm font-medium">${a.title}</span>
        </button>`;
      }).join("");
    }
  },
  renderRecentTx(items) {
    const listE = document.getElementById("trans-list");
    if (!listE) return;
    if (!items || !items.length) {
      listE.innerHTML = `<div class="empty-state" style="padding:20px;"><div class="empty-title" style="font-size:14px;">暂无交易记录</div><div class="empty-desc">点击“+ 添加交易”开始记账</div></div>`;
      return;
    }
    const total = Array.isArray(items) ? items.length : 0;
    const shown = Math.min(5, total);
    const more = total > shown ? total - shown : 0;
    const rows = items.slice(0, shown).map((it) => {
      const isIn = it.type === "收入";
      const cls = isIn ? "bg-green-100 text-green-600" : "bg-red-100 text-red-600";
      const amtCls = isIn ? "text-green-600" : "text-red-600";
      const svg = isIn
        ? '<path d="M12 19V5"/><path d="M5 12l7-7 7 7"/>'
        : '<path d="M12 5v14"/><path d="M5 12l7 7 7-7"/>';
      const sign = isIn ? "+" : "-";
      const roomRaw = it.room_no || it.room || "";
      const room = roomRaw ? ` · 房间${roomRaw}` : "";
      return `<div class="flex items-center gap-3 px-2 py-3 hover:bg-gray-50">
        <div class="w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${cls}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-5 h-5">${svg}</svg>
        </div>
        <div class="flex-1 min-w-0">
          <div class="text-sm font-medium text-gray-800 truncate">${it.category || it.type || "交易"} · ${it.description || it.note || "（无描述）"}</div>
          <div class="text-xs text-gray-500 mt-0.5">${it.trans_date || it.date || ""}${room}</div>
        </div>
        <div class="text-right shrink-0">
          <div class="text-sm font-bold ${amtCls}">${sign}¥ ${Number(it.amount || 0).toFixed(2)}</div>
        </div>
      </div>`;
    }).join("");
    const moreHtml = more
      ? `<a href="#/dashboard/bills" class="tx-more-link" style="display:flex;align-items:center;justify-content:center;gap:4px;margin-top:8px;padding:10px 4px 4px;color:#3b82f6;font-size:13px;font-weight:600;border-top:1px dashed #e2e8f0;">还有 ${more} 条未显示 · 查看全部 →</a>`
      : `<a href="#/dashboard/bills" class="tx-more-link" style="display:flex;align-items:center;justify-content:center;gap:4px;margin-top:8px;padding:10px 4px 4px;color:#3b82f6;font-size:13px;font-weight:600;border-top:1px dashed #e2e8f0;">查看全部交易 →</a>`;
    listE.innerHTML = rows + moreHtml;
    // 顶部“查看全部 →”链接跳转 bills
    const col = document.querySelector(".trans-col h2 a");
    if (col) col.href = "#/dashboard/bills";
  },
  renderUrgentReminders(reminders, sm) {
    // 3 列中间卡片：上方「异常房间总览」大卡 + 下方「紧急收租提醒」列表 + 新建按钮
    const budgetCol = document.querySelector("#stats-row").parentElement.querySelector(".grid-cols-3 > div:nth-child(2)");
    if (!budgetCol) return;
    const smObj = sm || {};
    const n_over = parseInt(smObj.overdue, 10) || 0;
    const n_soon = parseInt(smObj.due_soon, 10) || 0;
    const n_lease = parseInt(smObj.lease_end_soon, 10) || 0;
    const abnormal_total = n_over + n_soon + n_lease;
    const smLine =
      `待处理 <b style="color:#b91c1c;">${smObj.pending || 0}</b> · 逾期 <b style="color:#dc2626;">${n_over}</b> · 2d内 <b style="color:#d97706;">${n_soon}</b> · 7d租期 <b style="color:#7c3aed;">${n_lease}</b>`;
    // 租金/租期关注提示
    const rent_overdue = parseInt(smObj.rent_overdue, 10) || 0;
    const rent_today = parseInt(smObj.rent_today, 10) || 0;
    const rent_due_7d = parseInt(smObj.rent_due_7d, 10) || 0;
    const rent_due_3d = parseInt(smObj.rent_due_3d, 10) || 0;
    const lease_1y = parseInt(smObj.lease_due_365d, 10) || 0;
    const lease_30d = parseInt(smObj.lease_due_30d, 10) || 0;
    const rentFocus = rent_overdue + rent_today + rent_due_3d + rent_due_7d;
    const focusLine = `<div class="text-xs mt-1"><span style="color:#b91c1c;">💳 ${rentFocus}</span> 间租金需关注 · <span style="color:#7c3aed;">📅 ${lease_30d + lease_1y}</span> 间租期快到期</div>`;
    const rows = (reminders || []).slice(0, 4).map((r) => {
      const tag = r.smart_tag || "";
      const cls =
        tag === "已逾期" ? "tag-bad" :
        tag === "即将到期（2d内）" ? "tag-warn" :
        tag === "租期即将结束（7d内）" ? "tag-accent" : "tag-ok";
      const rowCls =
        tag === "已逾期" ? "rem-row-overdue" :
        tag === "即将到期（2d内）" ? "rem-row-due-soon" :
        tag === "租期即将结束（7d内）" ? "rem-row-lease-end" : "";

      // 租金状态颜色标签
      const rdl = r.rent_days_left;
      let rentBadgeCls = "tag-rent-normal", rentBadgePrefix = "";
      if (rdl != null && (r.status || "未完成") !== "已完成" && r.status !== "已确认") {
        if (rdl < 0) { rentBadgeCls = "tag-rent-overdue"; rentBadgePrefix = "❌"; }
        else if (rdl === 0) { rentBadgeCls = "tag-rent-today"; rentBadgePrefix = "🔥"; }
        else if (rdl <= 3) { rentBadgeCls = "tag-rent-3d"; rentBadgePrefix = "⚠️"; }
        else if (rdl <= 7) { rentBadgeCls = "tag-rent-7d"; rentBadgePrefix = "📌"; }
        else if (rdl <= 15) { rentBadgeCls = "tag-rent-15d"; }
        else if (rdl <= 30) { rentBadgeCls = "tag-rent-30d"; }
      }

      // 租期状态颜色标签
      const ldl = r.lease_days_left;
      let leaseBadgeCls = "tag-lease-none", leaseBadgePrefix = "";
      if (ldl != null) {
        if (ldl < 0) { leaseBadgeCls = "tag-lease-expired"; leaseBadgePrefix = "❌"; }
        else if (ldl === 0) { leaseBadgeCls = "tag-lease-today"; leaseBadgePrefix = "🔥"; }
        else if (ldl <= 7) { leaseBadgeCls = "tag-lease-7d"; leaseBadgePrefix = "⚠️"; }
        else if (ldl <= 30) { leaseBadgeCls = "tag-lease-30d"; leaseBadgePrefix = "📌"; }
        else if (ldl <= 90) { leaseBadgeCls = "tag-lease-90d"; }
        else if (ldl <= 180) { leaseBadgeCls = "tag-lease-180d"; }
        else if (ldl <= 365) { leaseBadgeCls = "tag-lease-365d"; }
        else { leaseBadgeCls = "tag-lease-normal"; }
      }

      return `<div class="py-2 ${rowCls}" style="border-left: 4px solid transparent; padding-left: 8px; border-bottom: 1px solid #f1f5f9;">
        <div class="flex items-center justify-between">
          <div class="min-w-0">
            <div class="text-sm font-semibold text-gray-800 truncate">房间 <b>${r.room_no || r.room || "-"}</b> · ¥${Number(r.rent_amount || r.amount || 0).toFixed(2)}</div>
            <div class="text-xs text-gray-500 mt-0.5">到期：${r.due_date || r.expire_date || "-"} · 租期：${r.lease_end_date || "-"}</div>
          </div>
          <span class="tag-pill ${cls}" style="flex-shrink:0;">${tag || "-"}</span>
        </div>
        <div class="flex flex-wrap gap-1 mt-1.5">
          <span class="tag-pill-sm ${rentBadgeCls}" title="${r.rent_status || ""}">${rentBadgePrefix}${r.rent_status || "无提醒"}</span>
          <span class="tag-pill-sm ${leaseBadgeCls}" title="${r.lease_status || ""}">${leaseBadgePrefix}${r.lease_status || "未设置租期结束日期"}</span>
        </div>
      </div>`;
    }).join("");
    budgetCol.innerHTML = `
      <div class="h-80 bg-white rounded-xl shadow flex flex-col overflow-hidden">
        <div class="dash-alert-card" style="border-radius:0;border:0;border-bottom:1px solid #fecdd3;box-shadow:none;padding:14px 18px 14px;" onclick="location.hash='#/dashboard/reminders'">
          <div class="dash-alert-card__title-row">
            <div class="dash-alert-card__title">
              <span class="pulse-dot"></span>
              <span>异常房间总览</span>
            </div>
            <div class="dash-alert-card__more">点击查看全部 →</div>
          </div>
          <div class="dash-alert-card__total">
            <div>
              <div class="big">${abnormal_total}</div>
              <div class="label">间异常房间需要关注</div>
            </div>
            <div class="icon-box">🚨</div>
          </div>
          <div class="dash-alert-card__breakdown">
            <div class="break b-red">
              <div class="num">${n_over}</div>
              <div class="name">🔥 已逾期</div>
            </div>
            <div class="break b-orange">
              <div class="num">${n_soon}</div>
              <div class="name">🔔 2天内到期</div>
            </div>
            <div class="break b-purple">
              <div class="num">${n_lease}</div>
              <div class="name">📜 7天内租期结束</div>
            </div>
          </div>
        </div>

        <div style="padding:10px 18px 0;">
          <div style="display:flex;align-items:center;justify-content:space-between;">
            <h2 class="text-base font-bold text-gray-800">紧急收租提醒</h2>
            <a href="#/dashboard/reminders" class="text-sm text-cblue hover:underline">查看全部 →</a>
          </div>
          <div class="text-xs text-gray-500 mt-1">${smLine}</div>
          ${focusLine}
        </div>
        <div class="flex-1 overflow-auto px-5 pb-2 pr-3">${rows || `<div class="empty-state" style="padding:20px;"><div class="empty-title" style="font-size:14px;">暂无紧急提醒</div><div class="empty-desc">快去新建提醒，不错过每笔房租 🏠</div></div>`}</div>
        <div style="padding:10px 18px 14px;">
          <button onclick="location.hash='#/dashboard/reminders'" class="btn-primary" style="width:100%;">+ 新建收租提醒</button>
        </div>
      </div>`;
    // 同步侧栏菜单感叹号角标（首页直接显示异常数）
    const sb = document.getElementById("sb-reminders-exclaim");
    if (sb) {
      if (abnormal_total > 0) {
        sb.className = "sb-exclaim";
        sb.style.display = "inline-flex";
        sb.innerHTML = `<span class="sb-excl-badge">${abnormal_total > 99 ? "99+" : abnormal_total}</span>`;
        sb.title = `收租提醒：${abnormal_total} 间异常（逾期${n_over} / 2d内${n_soon} / 租期7d${n_lease}）`;
      } else {
        sb.className = "";
        sb.style.display = "none";
        sb.innerHTML = "";
        try { sb.removeAttribute("title"); } catch(_) {}
      }
    }
    _swapRentTextForMobileDash(budgetCol || document.querySelector(".dashboard-main") || document.getElementById("mod-dashboard-content"));
  },
  renderTrend(d) {
    if (!window.Chart) return;
    const ctx = document.getElementById("dashboard-trend");
    if (!ctx || !d) return;
    this._destroy(this.charts.trend);
    this._destroyCanvas(ctx);
    this.charts.trend = null;
    const labels = Array.isArray(d.months) ? d.months.slice() : [];
    const income = Array.isArray(d.income) ? d.income.slice() : [];
    const expense = Array.isArray(d.expense) ? d.expense.slice() : [];
    const balance = Array.isArray(d.balance) ? d.balance.slice() : [];
    const wrap = ctx.parentElement;
    const isMobile = window.matchMedia && window.matchMedia("(max-width: 768px)").matches;
    const targetH = isMobile ? 280 : 320;
    if (wrap) {
      wrap.style.position = "relative";
      wrap.style.flex = "0 0 auto";
      wrap.style.height = targetH + "px";
      wrap.style.minHeight = targetH + "px";
      wrap.style.width = "100%";
    }
    ctx.style.display = "block";
    ctx.style.width = "100%";
    ctx.style.height = targetH + "px";
    ctx.height = targetH * 2;
    const card = wrap && wrap.parentElement;
    if (card) {
      card.style.minHeight = (targetH + 110) + "px";
      card.style.height = "auto";
    }
    const baseOpts = window._baseChartOpts ? window._baseChartOpts() : {};
    const isMobileTrend2 = window.matchMedia && window.matchMedia("(max-width: 768px)").matches;
    this.charts.trend = new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [
          { label: "收入", data: income, borderColor: "#16a34a", backgroundColor: "rgba(22,163,74,0.12)", fill: true, tension: 0.35 },
          { label: "支出", data: expense, borderColor: "#dc2626", backgroundColor: "rgba(220,38,38,0.08)", fill: true, tension: 0.35 },
          { label: "结余", data: balance, type: "bar", backgroundColor: "rgba(99,102,241,0.55)", barPercentage: 0.6 },
        ],
      },
      options: Object.assign({}, baseOpts, isMobileTrend2 ? { layout: { padding: { bottom: 30 } } } : {}, {
        responsive: true,
        maintainAspectRatio: false,
      }),
    });
  },
  setupMobileSidebar() {
    const btn = document.getElementById("mobile-menu-btn");
    const sb = document.getElementById("sidebar");
    const mask = document.getElementById("mobile-menu-mask");
    if (!btn || !sb || !mask) return;
    if (btn.__mobileSidebarBound) return;
    btn.__mobileSidebarBound = true;
    const isMobile = () => window.matchMedia("(max-width: 768px)").matches;
    const open = () => {
      if (!isMobile()) return;
      sb.classList.add("mobile-open");
      mask.classList.remove("hidden");
      mask.style.pointerEvents = "auto";
      requestAnimationFrame(() => mask.classList.add("show"));
    };
    const close = () => {
      sb.classList.remove("mobile-open");
      mask.classList.remove("show");
      mask.style.pointerEvents = "none"; /* 立即停止拦截，不等 220ms 过渡 */
      setTimeout(() => mask.classList.add("hidden"), 220);
    };
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      sb.classList.contains("mobile-open") ? close() : open();
    });
    mask.addEventListener("click", close);
    sb.querySelectorAll("a.menu-item, a[href^='#/dashboard']").forEach((a) => {
      a.addEventListener("click", () => {
        if (isMobile()) setTimeout(close, 80);
      });
    });
    const logoutBtn = sb.querySelector("button[onclick*='logout']");
    if (logoutBtn) logoutBtn.addEventListener("click", () => { if (isMobile()) close(); });
    const mq = window.matchMedia("(max-width: 768px)");
    const onChange = (e) => {
      if (!e.matches) {
        sb.classList.remove("mobile-open");
        mask.classList.remove("show");
        mask.classList.add("hidden");
      }
    };
    try { mq.addEventListener("change", onChange); } catch (_) { try { mq.addListener(onChange); } catch (_) {} }
  },
};

/* 移动端侧边栏抽屉绑定：DOM 就绪即执行，不依赖登录/数据加载 */
(function _bindMobileDrawerEarly() {
  const run = () => { try { if (window.DashApp && typeof window.DashApp.setupMobileSidebar === "function") window.DashApp.setupMobileSidebar(); } catch (_) {} };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run);
  else run();
  if (!window.DashApp || !window.DashApp.setupMobileSidebar) {
    let tries = 0;
    const t = setInterval(() => {
      tries++;
      if (window.DashApp && typeof window.DashApp.setupMobileSidebar === "function") {
        clearInterval(t);
        run();
      } else if (tries > 30) clearInterval(t);
    }, 200);
  }
})();

/* 移动端横滑表格手势守卫：
 * 外层纵向容器是 touch-action: pan-y，用户在表格上手指斜滑时 90% 会被外层抢走纵向滚动；
 * 这里用 body 事件委托（表格是动态 DOM，每次 reload 会替换），touchmove 前 2 帧里
 * 一旦判定 |dx| > |dy| * 1.3 就 preventDefault 抢占，让 Chromium 判给横滑容器的原生滚动，
 * 不手写 scrollLeft（避免破坏惯性），只做手势抢占。 */
(function _bindHScrollGuard() {
  const run = () => {
    const isMobile = () => window.matchMedia && window.matchMedia("(max-width: 768px)").matches;
    const SELECTOR = ".data-table-wrap, .r-import-table-wrap, .table-wrap";
    let startX = 0, startY = 0, scrollEl = null, locked = null;
    const findScrollEl = (target) => target && target.closest ? target.closest(SELECTOR) : null;
    document.addEventListener("touchstart", (e) => {
      if (!isMobile() || !e.touches || e.touches.length !== 1) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      scrollEl = findScrollEl(e.target);
      locked = null;
    }, { passive: true });
    document.addEventListener("touchmove", (e) => {
      if (!isMobile() || !e.touches || e.touches.length !== 1 || !scrollEl) return;
      const dx = e.touches[0].clientX - startX;
      const dy = e.touches[0].clientY - startY;
      if (locked === null) {
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
        locked = Math.abs(dx) > Math.abs(dy) * 1.3 ? "h" : "v";
      }
      if (locked === "h") {
        try { e.preventDefault(); } catch (_) {}
      }
    }, { passive: false });
    document.addEventListener("touchend", () => { scrollEl = null; locked = null; }, { passive: true });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run);
  else run();
})();
