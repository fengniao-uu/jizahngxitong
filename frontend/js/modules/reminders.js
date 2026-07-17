const REM_STATUSES = ["未完成", "已完成", "已确认"];

function _isMobileRem() {
  return Boolean(
    (window.matchMedia && window.matchMedia("(max-width: 768px)").matches) ||
    (typeof window.innerWidth === "number" && window.innerWidth < 769) ||
    (document.documentElement && document.documentElement.clientWidth < 769)
  );
}
function _swapRentTextForMobile(rootEl) {
  if (!rootEl || !_isMobileRem()) return;
  try {
    // 1) 替换 textNode
    if (typeof document.createTreeWalker === "function") {
      const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, null);
      let n;
      while (n = walker.nextNode()) {
        if (n && n.nodeValue && typeof n.nodeValue === "string" && n.nodeValue.indexOf("收租") !== -1) {
          n.nodeValue = n.nodeValue.replace(/收租/g, "收支");
        }
      }
    }
    // 2) 顺便替换常见的 title 提示
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

window.ModReminders = {
  page: 1,
  size: 12,
  query: { status: "", smart_tag: "", keyword: "", room: "" },
  items: [],
  summary: null,
  total: 0,
  async init() {
    this.importState = { preview_id: null, rows: [], valid: 0, invalid: 0 };
    const c = document.getElementById("mod-reminders-content");
    if (!c) return;
    c.innerHTML = `
    <div class="mcb-shell">
      <div class="rem-stats" style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:12px;"></div>
      <div id="r-alert-banner-wrap" style="display:none;"></div>
      <div class="glass-card rem-toolbar-card" style="padding:12px 16px;">
        <div class="rem-toolbar" style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-start;flex-direction:column;">
          <div class="rem-filter-area" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;width:100%;">
            <select id="r-filter-status" class="rem-filter-item rem-filter-select">
              <option value="">全部状态</option>
              ${REM_STATUSES.map((s) => `<option value="${s}">${s}</option>`).join("")}
            </select>
            <select id="r-filter-tag" class="rem-filter-item rem-filter-select">
              <option value="">全部标签</option>
              <option value="已逾期">已逾期</option>
              <option value="即将到期（2d内）">即将到期（2d内）</option>
              <option value="租期即将结束（7d内）">租期即将结束（7d内）</option>
              <option value="正常">正常</option>
            </select>
            <input id="r-filter-room" class="rem-filter-item rem-filter-input" placeholder="房间号" style="height:34px;border-radius:8px;border:1px solid #e5e7eb;padding:4px 8px;"/>
            <input id="r-filter-keyword" class="rem-filter-item rem-filter-input" placeholder="关键词" style="height:34px;border-radius:8px;border:1px solid #e5e7eb;padding:4px 8px;min-width:160px;"/>
            <button id="r-btn-search" class="rem-filter-item btn-primary-sm rem-btn-search">查询</button>
            <button id="r-btn-reset" class="rem-filter-item btn-ghost-sm rem-btn-reset">重置</button>
          </div>
          <div class="rem-actions-area" style="width:100%;display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap;">
            <button id="r-btn-add" class="btn-primary">+ 新建提醒</button>
            <button id="r-btn-export-xlsx" class="btn-primary-outline">导出 Excel</button>
            <button id="r-btn-export-csv" class="btn-ghost">导出 CSV</button>
            <button id="r-btn-del-sel" class="btn-danger-outline">删除选中</button>
          </div>
        </div>
      </div>

      <div class="glass-card rem-import-card" style="margin-top:14px;padding:18px 20px;">
        <div class="rem-import-title">导入收租提醒</div>
        <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-top:14px;">
          <button id="r-btn-analyze" class="btn-import-analyze">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><path d="M3 3v18h18"/><path d="M7 16l4-8 3 5 4-7"/></svg>
            <span>分析表格</span>
          </button>
          <button id="r-btn-import-confirm" class="btn-import-do" disabled>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>
            <span>导入数据</span>
          </button>
          <input id="r-file-import" type="file" accept=".xlsx,.xls,.csv" style="display:none;"/>
        </div>
        <div id="r-import-preview-wrap" style="display:none;margin-top:18px;">
          <div id="r-import-summary" style="font-size:13px;color:#4b5563;margin-bottom:10px;"></div>
          <div class="r-import-table-wrap" style="border:1px solid #e5e7eb;border-radius:10px;overflow:auto;max-height:320px;">
            <table class="r-import-table" style="width:100%;border-collapse:collapse;font-size:13px;">
              <thead id="r-import-thead" style="background:#f8fafc;position:sticky;top:0;"></thead>
              <tbody id="r-import-tbody"></tbody>
            </table>
          </div>
        </div>
      </div>

      <div id="r-table-wrap" class="glass-card" style="margin-top:14px;padding:16px 18px;"></div>
    </div>`;
    document.getElementById("r-btn-search").onclick = () => this.reload(1);
    document.getElementById("r-btn-reset").onclick = () => {
      ["status", "tag", "room", "keyword"].forEach((k) => {
        const el = document.getElementById("r-filter-" + k);
        if (el) el.value = "";
      });
      this.reload(1);
    };
    document.getElementById("r-btn-add").onclick = () => this.openModal();
    document.getElementById("r-btn-export-xlsx").onclick = () => API.remExport("xlsx", this._qs());
    document.getElementById("r-btn-export-csv").onclick = () => API.remExport("csv", this._qs());
    document.getElementById("r-btn-del-sel").onclick = () => this.deleteSelected();
    document.getElementById("r-file-import").onchange = (e) => this.onAnalyzeFile(e);
    document.getElementById("r-btn-analyze").onclick = () => document.getElementById("r-file-import").click();
    document.getElementById("r-btn-import-confirm").onclick = () => this.onImportConfirm();
    this.reload(1);
    _swapRentTextForMobile(c);
  },
  _qs() {
    this.query = {
      status: document.getElementById("r-filter-status").value,
      smart_tag: document.getElementById("r-filter-tag").value,
      room: document.getElementById("r-filter-room").value,
      keyword: document.getElementById("r-filter-keyword").value,
    };
    return this.query;
  },
  _scrollTop() {
    try {
      const main = document.querySelector(".dashboard-main") || document.getElementById("dash-scroll-root") || document.documentElement;
      if (main) {
        main.scrollTop = 0;
        if (typeof main.scrollTo === "function") main.scrollTo({ top: 0, left: 0, behavior: "auto" });
      }
      const wrap = document.querySelector("#r-table-wrap .data-table-wrap");
      if (wrap) { wrap.scrollTop = 0; wrap.scrollLeft = 0; }
    } catch (_) {}
  },
  async reload(p, noScroll) {
    if (p) this.page = p;
    this._noScrollNextRender = !!noScroll;
    const q = Object.assign({}, this._qs(), { page: this.page, size: this.size });
    const res = await API.remList(q);
    const d = (res && res.data) || {};
    this.items = d.items || d.list || [];
    this.summary = d.summary || {};
    this.total = d.total || this.items.length;
    this.render();
  },
  render() {
    const sm = this.summary || {};
    const shell = document.querySelector(".rem-stats");
    if (shell) {
      // ========== 第一层：原有异常总览卡片 ==========
      const baseCards = [
        { k: "pending", t: "待处理", v: sm.pending || 0, cls: "st-pending", ex: "" },
        { k: "overdue", t: "已逾期", v: sm.overdue || 0, cls: "st-overdue", ex: (parseInt(sm.overdue,10)||0) > 0 ? '<span class="st-exclaim st-exclaim-red" title="有已逾期房间">❗</span>' : "" },
        { k: "due_soon", t: "即将到期（2d）", v: sm.due_soon || 0, cls: "st-due", ex: (parseInt(sm.due_soon,10)||0) > 0 ? '<span class="st-exclaim st-exclaim-orange" title="有2日内到期房间">❗</span>' : "" },
        { k: "lease_end_soon", t: "租期快结束（7d）", v: sm.lease_end_soon || 0, cls: "st-lease", ex: (parseInt(sm.lease_end_soon,10)||0) > 0 ? '<span class="st-exclaim st-exclaim-purple" title="有租期一周内结束房间">❗</span>' : "" },
      ];
      // ========== 第二层：每月租金到期提醒（细分） ==========
      const rentCards = [
        { k: "rent_overdue", t: "租金已逾期", v: sm.rent_overdue || 0, cls: "st-rent-overdue", ex: (parseInt(sm.rent_overdue,10)||0) > 0 ? '<span class="st-exclaim st-exclaim-red">❗</span>' : "" },
        { k: "rent_today", t: "租金今日到期", v: sm.rent_today || 0, cls: "st-rent-today", ex: (parseInt(sm.rent_today,10)||0) > 0 ? '<span class="st-exclaim st-exclaim-orange">🔥</span>' : "" },
        { k: "rent_due_3d", t: "租金 3 天内到期", v: sm.rent_due_3d || 0, cls: "st-rent-3d", ex: "" },
        { k: "rent_due_7d", t: "租金 7 天内到期", v: sm.rent_due_7d || 0, cls: "st-rent-7d", ex: "" },
        { k: "rent_due_15d", t: "租金 15 天内到期", v: sm.rent_due_15d || 0, cls: "st-rent-15d", ex: "" },
        { k: "rent_due_30d", t: "租金 30 天内到期", v: sm.rent_due_30d || 0, cls: "st-rent-30d", ex: "" },
      ];
      // ========== 第三层：每年租期到期提醒（细分） ==========
      const leaseCards = [
        { k: "lease_expired", t: "租期已到期", v: sm.lease_expired || 0, cls: "st-lease-expired", ex: (parseInt(sm.lease_expired,10)||0) > 0 ? '<span class="st-exclaim st-exclaim-red">❗</span>' : "" },
        { k: "lease_today", t: "租期今日到期", v: sm.lease_today || 0, cls: "st-lease-today", ex: (parseInt(sm.lease_today,10)||0) > 0 ? '<span class="st-exclaim st-exclaim-purple">🔥</span>' : "" },
        { k: "lease_due_7d", t: "租期 7 天内", v: sm.lease_due_7d || 0, cls: "st-lease-7d", ex: "" },
        { k: "lease_due_30d", t: "租期 30 天内", v: sm.lease_due_30d || 0, cls: "st-lease-30d", ex: "" },
        { k: "lease_due_90d", t: "租期 90 天内", v: sm.lease_due_90d || 0, cls: "st-lease-90d", ex: "" },
        { k: "lease_due_180d", t: "租期 180 天内", v: sm.lease_due_180d || 0, cls: "st-lease-180d", ex: "" },
        { k: "lease_due_365d", t: "租期 1 年内", v: sm.lease_due_365d || 0, cls: "st-lease-365d", ex: "" },
      ];
      const baseHtml = baseCards.map(x => `<div class="stat-card ${x.cls}">${x.ex}<div class="stat-title">${x.t}</div><div class="stat-val">${x.v}</div><div class="stat-sub">总提醒 ${sm.total || 0}</div></div>`).join("");
      const rentHtml = `<div style="grid-column:1/-1;display:flex;align-items:center;gap:8px;margin-top:4px;">
        <div style="width:4px;height:16px;background:linear-gradient(180deg,#ef4444,#f59e0b);border-radius:3px;"></div>
        <div style="font-size:13px;font-weight:600;color:#1e3a8a;">💳 每月租金到期提醒</div>
      </div>` + rentCards.map(x => `<div class="stat-card-mini ${x.cls}">${x.ex}<div class="stat-title">${x.t}</div><div class="stat-val">${x.v}</div></div>`).join("");
      const leaseHtml = `<div style="grid-column:1/-1;display:flex;align-items:center;gap:8px;margin-top:4px;">
        <div style="width:4px;height:16px;background:linear-gradient(180deg,#8b5cf6,#6366f1);border-radius:3px;"></div>
        <div style="font-size:13px;font-weight:600;color:#4c1d95;">📅 每年租期到期提醒</div>
      </div>` + leaseCards.map(x => `<div class="stat-card-mini ${x.cls}">${x.ex}<div class="stat-title">${x.t}</div><div class="stat-val">${x.v}</div></div>`).join("");
      shell.style.gridTemplateColumns = "repeat(6, 1fr)";
      shell.innerHTML = baseHtml + rentHtml + leaseHtml;
    }
    const bannerWrap = document.getElementById("r-alert-banner-wrap");
    const abn_total = (parseInt(sm.overdue,10)||0) + (parseInt(sm.due_soon,10)||0) + (parseInt(sm.lease_end_soon,10)||0);
    if (bannerWrap) {
      if (abn_total > 0) {
        bannerWrap.style.display = "block";
        bannerWrap.innerHTML = `
        <div class="rem-alert-banner">
          <div class="rem-alert-banner__total">
            <div class="badge-icon">🚨</div>
            <div>
              <div class="title"><span style="color:#b91c1c;font-weight:800;">❗</span> 异常房间总数</div>
              <div><span class="big-num">${abn_total}</span><span class="unit">间</span></div>
            </div>
          </div>
          <div class="rem-alert-banner__chip rem-alert-chip-red" data-tag="已逾期" title="点击筛选已逾期">
            <div class="chip-icon">❗</div>
            <div>
              <div class="chip-val">${sm.overdue || 0}</div>
              <div class="chip-label">已逾期</div>
            </div>
          </div>
          <div class="rem-alert-banner__chip rem-alert-chip-orange" data-tag="即将到期（2d内）" title="点击筛选2日内到期">
            <div class="chip-icon">❗</div>
            <div>
              <div class="chip-val">${sm.due_soon || 0}</div>
              <div class="chip-label">即将到期（2天内）</div>
            </div>
          </div>
          <div class="rem-alert-banner__chip rem-alert-chip-purple" data-tag="租期即将结束（7d内）" title="点击筛选租期一周内结束">
            <div class="chip-icon">❗</div>
            <div>
              <div class="chip-val">${sm.lease_end_soon || 0}</div>
              <div class="chip-label">租期即将结束（7天内）</div>
            </div>
          </div>
        </div>`;
        bannerWrap.querySelectorAll(".rem-alert-banner__chip").forEach((chip) => {
          chip.onclick = () => {
            const tagSel = document.getElementById("r-filter-tag");
            const tagVal = chip.getAttribute("data-tag") || "";
            if (tagSel) {
              Array.from(tagSel.options).forEach((o) => { o.selected = (o.value === tagVal); });
              try { const evt = new Event("change"); tagSel.dispatchEvent(evt); } catch(_) {}
            }
            this.query.smart_tag = tagVal;
            this.reload(1);
          };
        });
      } else {
        bannerWrap.style.display = "none";
        bannerWrap.innerHTML = "";
      }
    }
    // 侧栏菜单感叹号角标（显示异常总数）
    const sb = document.getElementById("sb-reminders-exclaim");
    if (sb) {
      if (abn_total > 0) {
        sb.className = "sb-exclaim";
        sb.style.display = "inline-flex";
        sb.innerHTML = `<span class="sb-excl-badge">${abn_total > 99 ? "99+" : abn_total}</span>`;
        sb.title = `收租提醒：${abn_total} 间异常（逾期${sm.overdue||0} / 2d内${sm.due_soon||0} / 租期7d${sm.lease_end_soon||0}）`;
      } else {
        sb.className = "";
        sb.style.display = "none";
        sb.innerHTML = "";
        sb.removeAttribute("title");
      }
    }
    const w = document.getElementById("r-table-wrap");
    if (!w) return;
    if (!this.items.length) {
      w.innerHTML = `<div class="empty-state"><div class="empty-title">暂无收租提醒</div><div class="empty-desc">点击“+ 新建提醒”设置房租到期</div></div>`;
      return;
    }
    const pages = Math.max(1, Math.ceil(this.total / this.size));
    const rows = this.items.map((it) => {
      const cls =
        it.smart_tag === "已逾期" ? "tag-bad" :
        it.smart_tag === "即将到期（2d内）" ? "tag-warn" :
        it.smart_tag === "租期即将结束（7d内）" ? "tag-accent" : "tag-ok";
      const rowCls =
        it.smart_tag === "已逾期" ? "rem-row-overdue" :
        it.smart_tag === "即将到期（2d内）" ? "rem-row-due-soon" :
        it.smart_tag === "租期即将结束（7d内）" ? "rem-row-lease-end" : "";
      const exclHtml =
        it.smart_tag === "已逾期"                ? '<span class="excl-icon excl-red" title="该房间已逾期">!</span>' :
        it.smart_tag === "即将到期（2d内）"       ? '<span class="excl-icon excl-orange" title="该房间2天内到期">!</span>' :
        it.smart_tag === "租期即将结束（7d内）"    ? '<span class="excl-icon excl-purple" title="该房间租期一周内结束">!</span>' : "";
      const tagPrefix = (it.smart_tag === "已逾期" || it.smart_tag === "即将到期（2d内）" || it.smart_tag === "租期即将结束（7d内）") ? '<span class="tag-excl">❗</span>' : "";
      const room = it.room || it.room_no || "-";
      const rent = Number(it.amount || it.rent_amount || 0).toFixed(2);

      // 租金状态颜色标签
      const rdl = it.rent_days_left;
      let rentBadgeCls = "tag-rent-normal";
      let rentBadgePrefix = "";
      if (rdl != null) {
        if (rdl < 0) { rentBadgeCls = "tag-rent-overdue"; rentBadgePrefix = "❌"; }
        else if (rdl === 0) { rentBadgeCls = "tag-rent-today"; rentBadgePrefix = "🔥"; }
        else if (rdl <= 3) { rentBadgeCls = "tag-rent-3d"; rentBadgePrefix = "⚠️"; }
        else if (rdl <= 7) { rentBadgeCls = "tag-rent-7d"; rentBadgePrefix = "📌"; }
        else if (rdl <= 15) { rentBadgeCls = "tag-rent-15d"; }
        else if (rdl <= 30) { rentBadgeCls = "tag-rent-30d"; }
      }

      // 租期状态颜色标签
      const ldl = it.lease_days_left;
      let leaseBadgeCls = "tag-lease-none";
      let leaseBadgePrefix = "";
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

      return `<tr data-id="${it.id}" class="${rowCls}">
        <td style="padding-left:12px !important;"><input type="checkbox" class="r-sel" data-id="${it.id}"/></td>
        <td>${exclHtml}<b>${room}</b></td>
        <td>¥${rent}</td>
        <td>
          <div style="line-height:1.4;">
            <div>${it.due_date || "-"}</div>
            <div style="margin-top:3px;"><span class="tag-pill-sm ${rentBadgeCls}" title="${it.rent_status || ""}">${rentBadgePrefix}${it.rent_status || "无提醒"}</span></div>
          </div>
        </td>
        <td>
          <div style="line-height:1.4;">
            <div>${it.lease_end_date || "-"}</div>
            <div style="margin-top:3px;"><span class="tag-pill-sm ${leaseBadgeCls}" title="${it.lease_status || ""}">${leaseBadgePrefix}${it.lease_status || "未设置租期结束日期"}</span></div>
          </div>
        </td>
        <td><span class="tag-pill ${cls}">${tagPrefix}${it.smart_tag || "-"}</span></td>
        <td>${it.status || "-"}</td>
        <td>${it.note || "-"}</td>
        <td>
          <button class="btn-link-edit" data-act="renew30" data-id="${it.id}">+30天</button>
          <button class="btn-link-edit" data-act="renew1y" data-id="${it.id}">+1年</button>
          <button class="btn-link-edit" data-act="edit" data-id="${it.id}">编辑</button>
          <button class="btn-link-del" data-act="del" data-id="${it.id}">删除</button>
        </td>
      </tr>`;
    }).join("");
    w.innerHTML = `
      <div class="data-table-wrap" style="margin:-16px -18px 0;padding:16px 18px 8px;">
        <table class="data-table" style="min-width:1180px;">
          <thead><tr>
            <th style="width:40px;"><input type="checkbox" id="r-sel-all"/></th>
            <th style="width:100px;">房间号</th>
            <th style="width:120px;">房租</th>
            <th style="width:120px;">到期日期</th>
            <th style="width:120px;">租期结束</th>
            <th style="width:150px;">提醒标签</th>
            <th style="width:100px;">状态</th>
            <th>备注</th>
            <th style="width:260px;">操作</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      ${this.pagination(pages)}
    `;
    document.getElementById("r-sel-all").onchange = (e) => {
      w.querySelectorAll(".r-sel").forEach((x) => (x.checked = e.target.checked));
    };
    w.querySelectorAll("[data-act]").forEach((btn) => {
      btn.onclick = async () => {
        const id = btn.getAttribute("data-id");
        const act = btn.getAttribute("data-act");
        if (act === "edit") this.openModal(id);
        if (act === "del") this.deleteOne(id);
        if (act === "renew30" || act === "renew1y") {
          const mode = act === "renew30" ? "30d" : "1y";
          const r = await API.remRenew(id, mode);
          if (r && r.code === 0) { this.reload(1, true); }
          else alert((r && r.msg) || "续租失败");
        }
      };
    });
    const prev = w.querySelector("#r-prev");
    const next = w.querySelector("#r-next");
    if (prev) prev.onclick = () => this.reload(this.page - 1);
    if (next) next.onclick = () => this.reload(this.page + 1);
    if (this._noScrollNextRender) this._noScrollNextRender = false;
    else this._scrollTop();
    const swapRoot = document.querySelector(".mcb-shell");
    _swapRentTextForMobile(swapRoot || document.getElementById("mod-reminders-content"));
  },
  pagination(pages) {
    return `<div style="display:flex;align-items:center;justify-content:space-between;margin-top:14px;color:#6b7280;font-size:13px;">
      <div>第 ${this.page} / ${pages} 页，共 ${this.total} 条</div>
      <div style="display:flex;gap:6px;">
        <button id="r-prev" class="btn-ghost-sm" ${this.page <= 1 ? "disabled" : ""}>上一页</button>
        <button id="r-next" class="btn-ghost-sm" ${this.page >= pages ? "disabled" : ""}>下一页</button>
      </div>
    </div>`;
  },
  async openModal(editId) {
    const id = editId || null;
    let init = { room_no: "", room: "", rent_amount: "", amount: "", due_date: "", due: "", lease_end_date: "", lease_end: "", status: "未完成", note: "" };
    if (id) {
      const d = await API.remDetail(id);
      if (d && d.data) Object.assign(init, d.data);
    }
    const modal = document.createElement("div");
    modal.className = "modal-mask";
    const titleText = id ? "编辑收租提醒" : "添加收租提醒";
    const saveBtnText = id ? "保存修改" : "添加提醒";
    modal.innerHTML = `
    <div class="modal-card modal-rent-card" style="max-width:520px;">
      <div class="modal-header modal-rent-header">
        <button class="modal-back-btn" data-act="close" aria-label="返回">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
        </button>
        <div class="modal-title">${titleText}</div>
        <button class="modal-close" data-act="close" aria-label="关闭">×</button>
      </div>
      <div class="modal-body modal-rent-body">
        <div class="rent-field-wrap">
          <label class="rent-label">房间号 <span class="req">*</span></label>
          <div class="rent-input rent-input-with-icon rent-input-icon-room">
            <input id="m-room" type="text" placeholder="请输入房间号"/>
          </div>
        </div>

        <div class="rent-field-wrap">
          <label class="rent-label">房租金额 <span class="req">*</span></label>
          <div class="rent-input rent-input-with-icon rent-input-icon-money">
            <input id="m-amount" type="number" step="0.01" min="0" placeholder="0.00"/>
          </div>
        </div>

        <div class="rent-field-wrap">
          <label class="rent-label">到期日期 <span class="req">*</span></label>
          <div class="rent-input rent-input-with-icon rent-input-icon-date">
            <input id="m-due" type="date" placeholder="yyyy/mm/dd"/>
          </div>
        </div>

        <div class="rent-field-wrap">
          <label class="rent-label">租期结束日期</label>
          <div class="rent-input rent-input-with-icon rent-input-icon-date">
            <input id="m-lease-end" type="date" placeholder="yyyy/mm/dd"/>
          </div>
          <div class="rent-hint">设置租期结束日期后，系统会在租期结束前一周提醒您是否需要续租</div>
        </div>

        <input type="hidden" id="m-status" value="${init.status || "未完成"}"/>
        <input type="hidden" id="m-note" value="${init.note || ""}"/>
      </div>
      <div class="modal-footer modal-rent-footer">
        <button class="btn-ghost btn-rent-cancel" data-act="close">取消</button>
        <button class="btn-primary btn-rent-save" data-act="save">${saveBtnText}</button>
      </div>
    </div>`;
    document.body.appendChild(modal);
    _swapRentTextForMobile(modal);
    const get = (sel) => modal.querySelector(sel);
    get("#m-room").value = init.room_no || init.room || "";
    get("#m-amount").value = init.rent_amount || init.amount || "";
    get("#m-due").value = init.due_date || init.due || todayStr();
    get("#m-lease-end").value = init.lease_end_date || init.lease_end || "";
    const close = () => { if (modal.parentNode) modal.parentNode.removeChild(modal); };
    modal.querySelectorAll("[data-act=close]").forEach((x) => (x.onclick = close));
    get('[data-act="save"]').onclick = async () => {
      const room = (get("#m-room").value || "").trim();
      const amount = parseFloat(get("#m-amount").value);
      const due_date = get("#m-due").value;
      const lease_end_date = get("#m-lease-end").value || "";
      const status = (get("#m-status").value || "未完成").trim();
      const note = (get("#m-note").value || "").trim();
      if (!room) return alert("请填写房间号");
      if (!amount || amount <= 0) return alert("请输入有效金额");
      if (!due_date) return alert("请选择到期日期");
      const payload = {
        room: room,
        room_no: room,
        amount: amount,
        rent_amount: amount,
        due_date: due_date,
        due: due_date,
        lease_end_date: lease_end_date,
        lease_end: lease_end_date,
        status: status,
        note: note,
      };
      const res = id ? await API.remUpdate(id, payload) : await API.remCreate(payload);
      if (res && res.code === 0) {
        close();
        this.reload(1);
        setTimeout(() => this._scrollTop(), 30);
      } else alert((res && res.msg) || "保存失败");
    };
  },
  async deleteOne(id) {
    if (!confirm("确认删除这条提醒？")) return;
    const r = await API.remDelete(id);
    if (r && r.code === 0) { this.reload(1, true); }
    else alert((r && r.msg) || "删除失败");
  },
  async deleteSelected() {
    const ids = Array.from(document.querySelectorAll(".r-sel:checked")).map((x) => parseInt(x.getAttribute("data-id")));
    if (!ids.length) return alert("请先勾选要删除的提醒");
    if (!confirm(`确认删除 ${ids.length} 条提醒？`)) return;
    const r = await API.remBatchDelete(ids);
    if (r && r.code === 0) { this.reload(1, true); }
    else alert((r && r.msg) || "批量删除失败");
  },
  async onAnalyzeFile(e) {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    if (!this._analyzeLock) this._analyzeLock = true;
    try {
      const fd = new FormData();
      fd.append("file", f);
      const r = await API.remImportPreview(fd);
      e.target.value = "";
      if (!(r && r.code === 0)) { alert((r && r.msg) || "预览失败"); this.importState = { preview_id: null, rows: [], valid: 0, invalid: 0 }; this._hidePreview(); return; }
      const d = r.data || {};
      const rows = Array.isArray(d.rows) ? d.rows : [];
      const valid = parseInt(d.valid || 0, 10) || 0;
      const invalid = parseInt(d.invalid || 0, 10) || 0;
      this.importState = { preview_id: d.preview_id || null, rows, valid, invalid };
      this._renderPreviewTable(rows, valid, invalid);
    } finally { this._analyzeLock = false; }
  },
  _hidePreview() {
    const w = document.getElementById("r-import-preview-wrap");
    const btn = document.getElementById("r-btn-import-confirm");
    if (w) w.style.display = "none";
    if (btn) { btn.disabled = true; try { btn.setAttribute("disabled", "disabled"); } catch(_){} }
  },
  _renderPreviewTable(rows, valid, invalid) {
    const w = document.getElementById("r-import-preview-wrap");
    const btn = document.getElementById("r-btn-import-confirm");
    const sum = document.getElementById("r-import-summary");
    const thead = document.getElementById("r-import-thead");
    const tbody = document.getElementById("r-import-tbody");
    if (!(w && thead && tbody)) return;
    w.style.display = "block";
    const n = rows.length;
    if (sum) sum.innerHTML = `共解析 <b style="color:#111827;">${n}</b> 行 · 有效 <b style="color:#16a34a;">${valid}</b> 行 · 错误 <b style="color:#dc2626;">${invalid}</b> 行`;
    if (btn) {
      const ok = !!(this.importState.preview_id && valid > 0);
      btn.disabled = !ok;
      try { if (ok) btn.removeAttribute("disabled"); else btn.setAttribute("disabled", "disabled"); } catch(_) {}
    }
    thead.innerHTML = `<tr>
      <th style="text-align:left;padding:10px 12px;border-bottom:1px solid #e5e7eb;background:#f8fafc;font-weight:600;color:#111827;min-width:100px;">房间号</th>
      <th style="text-align:left;padding:10px 12px;border-bottom:1px solid #e5e7eb;background:#f8fafc;font-weight:600;color:#111827;min-width:100px;">房租金额</th>
      <th style="text-align:left;padding:10px 12px;border-bottom:1px solid #e5e7eb;background:#f8fafc;font-weight:600;color:#111827;min-width:120px;">到期日期</th>
      <th style="text-align:left;padding:10px 12px;border-bottom:1px solid #e5e7eb;background:#f8fafc;font-weight:600;color:#111827;min-width:120px;">租期结束</th>
      <th style="text-align:left;padding:10px 12px;border-bottom:1px solid #e5e7eb;background:#f8fafc;font-weight:600;color:#111827;min-width:90px;">状态</th>
      <th style="text-align:left;padding:10px 12px;border-bottom:1px solid #e5e7eb;background:#f8fafc;font-weight:600;color:#111827;">备注 / 解析说明</th>
    </tr>`;
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="6" style="padding:26px 12px;text-align:center;color:#6b7280;font-size:13px;">没有可显示的解析行</td></tr>`;
      return;
    }
    tbody.innerHTML = rows.slice(0, 200).map((r, i) => {
      const room = r.room_no || r.room || r.roomNo || "";
      const amt = Number(r.rent_amount || r.amount || 0) || 0;
      const due = r.due_date || r.due || r.dueDate || "";
      const lease = r.lease_end_date || r.lease_end || r.leaseEnd || "";
      const st = r.status || (r.valid === false ? "无效" : "有效");
      const note = r.note || r.remark || r.message || r.error || (r.valid === false ? "无效行" : "");
      const cls = r.valid === false ? "background:#fff1f2;color:#b91c1c;" : "";
      return `<tr style="${cls}">
        <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;font-weight:600;color:#111827;">${room || "<span style='color:#9ca3af;'>-</span>"}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;">¥${amt.toFixed(2)}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;">${due || "<span style='color:#9ca3af;'>-</span>"}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;">${lease || "<span style='color:#9ca3af;'>-</span>"}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;">${st || "-"}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;color:#6b7280;font-size:12px;">${note || ""}</td>
      </tr>`;
    }).join("") + (rows.length > 200 ? `<tr><td colspan="6" style="padding:8px 12px;text-align:center;color:#6b7280;font-size:12px;background:#f9fafb;">… 另有 ${rows.length - 200} 行未展示，导入时会一并处理</td></tr>` : "");
  },
  async onImportConfirm() {
    const preview_id = this.importState && this.importState.preview_id;
    if (!preview_id) { alert("请先选择 Excel/CSV 并点击「分析表格」"); return; }
    const valid = parseInt((this.importState && this.importState.valid) || 0, 10) || 0;
    const _mobile = _isMobileRem();
    const confirmMsg = `共 ${valid} 条有效数据，确认导入到您的收租提醒？`;
    if (!confirm(_mobile ? confirmMsg.replace(/收租/g, "收支") : confirmMsg)) return;
    const c = await API.remImportConfirm(preview_id);
    if (c && c.code === 0) {
      const inserted = (c.data && c.data.inserted) || 0;
      const alertMsg = `✅ 导入成功，已写入 ${inserted} 条收租提醒`;
      alert(_mobile ? alertMsg.replace(/收租/g, "收支") : alertMsg);
      this.importState = { preview_id: null, rows: [], valid: 0, invalid: 0 };
      this._hidePreview();
      this.reload();
    } else {
      alert((c && c.msg) || "导入失败");
    }
  },
};
