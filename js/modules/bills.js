const TX_CATEGORIES_INCOME = ["房租", "网费", "取暖费", "房租押金", "门禁卡押金", "违约金", "其他"];
const TX_CATEGORIES_EXPENSE = ["网费", "招租费", "配件", "工人费", "保洁费", "水电", "维修", "其他"];
const TX_STATUSES = ["全部", "收入", "支出"];

window.ModBills = {
  page: 1,
  size: 10,
  query: { type: "", category: "", room: "", keyword: "", start: "", end: "" },
  items: [],
  total: 0,
  summary: null,
  async init() {
    this.importState = { preview_id: null, rows: [], valid: 0, invalid: 0 };
    const c = document.getElementById("mod-bills-content");
    if (!c) return;
    c.innerHTML = `
    <div class="mcb-shell">
      <div class="mcb-toolbar glass-card">
        <div class="mcb-filters" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
          <select id="b-filter-type" style="height:34px;border-radius:8px;border:1px solid #e5e7eb;padding:4px 8px;background:#fff;">
            ${TX_STATUSES.map((s) => `<option value="${s === "全部" ? "" : s}">${s}</option>`).join("")}
          </select>
          <select id="b-filter-category" style="height:34px;border-radius:8px;border:1px solid #e5e7eb;padding:4px 8px;background:#fff;">
            <option value="">全部分类</option>
          </select>
          <input id="b-filter-room" placeholder="房间号" style="height:34px;border-radius:8px;border:1px solid #e5e7eb;padding:4px 8px;"/>
          <input id="b-filter-keyword" placeholder="关键词（描述/备注）" style="height:34px;border-radius:8px;border:1px solid #e5e7eb;padding:4px 8px;min-width:180px;"/>
          <input id="b-filter-start" type="date" style="height:34px;border-radius:8px;border:1px solid #e5e7eb;padding:4px 8px;"/>
          <span style="color:#9ca3af;">~</span>
          <input id="b-filter-end" type="date" style="height:34px;border-radius:8px;border:1px solid #e5e7eb;padding:4px 8px;"/>
          <button id="b-btn-search" class="btn-primary-sm" style="height:34px;">查询</button>
          <button id="b-btn-reset" class="btn-ghost-sm" style="height:34px;">重置</button>
        </div>
        <div class="mcb-actions" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">
          <button id="b-btn-add" class="btn-primary">+ 添加交易</button>
          <button id="b-btn-export-xlsx" class="btn-primary-outline">导出 Excel</button>
          <button id="b-btn-export-csv" class="btn-ghost">导出 CSV</button>
          <button id="b-btn-del-sel" class="btn-danger-outline">删除选中</button>
          <span id="b-summary-info" style="margin-left:auto;color:#6b7280;font-size:13px;padding:8px 4px;"></span>
        </div>
      </div>

      <div class="glass-card rem-import-card" style="margin-top:14px;padding:18px 20px;">
        <div class="rem-import-title">导入交易记录</div>
        <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-top:14px;">
          <button id="b-btn-analyze" class="btn-import-analyze">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><path d="M3 3v18h18"/><path d="M7 16l4-8 3 5 4-7"/></svg>
            <span>分析表格</span>
          </button>
          <button id="b-btn-import-confirm" class="btn-import-do" disabled>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>
            <span>导入数据</span>
          </button>
          <input id="b-file-import" type="file" accept=".xlsx,.xls,.csv" style="display:none;"/>
        </div>
        <div id="b-import-preview-wrap" style="display:none;margin-top:18px;">
          <div id="b-import-summary" style="font-size:13px;color:#4b5563;margin-bottom:10px;"></div>
          <div class="r-import-table-wrap" style="border:1px solid #e5e7eb;border-radius:10px;overflow:auto;max-height:320px;">
            <table class="r-import-table" style="width:100%;border-collapse:collapse;font-size:13px;">
              <thead id="b-import-thead" style="background:#f8fafc;position:sticky;top:0;"></thead>
              <tbody id="b-import-tbody"></tbody>
            </table>
          </div>
        </div>
      </div>

      <div id="b-table-wrap" class="glass-card" style="margin-top:14px;padding:16px 18px;"></div>
    </div>`;

    const typeSel = document.getElementById("b-filter-type");
    const catSel = document.getElementById("b-filter-category");
    const refillCat = () => {
      const t = typeSel.value;
      const list = t === "收入" ? TX_CATEGORIES_INCOME : t === "支出" ? TX_CATEGORIES_EXPENSE : [...TX_CATEGORIES_INCOME, ...TX_CATEGORIES_EXPENSE];
      catSel.innerHTML = '<option value="">全部分类</option>' + list.map((x) => `<option value="${x}">${x}</option>`).join("");
    };
    refillCat();
    typeSel.onchange = refillCat;

    document.getElementById("b-btn-search").onclick = () => this.reload(1);
    document.getElementById("b-btn-reset").onclick = () => {
      this.query = { type: "", category: "", room: "", keyword: "", start: "", end: "" };
      ["type", "category", "room", "keyword", "start", "end"].forEach((k) => {
        const el = document.getElementById("b-filter-" + k);
        if (el) el.value = "";
      });
      typeSel.value = "";
      refillCat();
      this.reload(1);
    };
    document.getElementById("b-btn-add").onclick = () => this.openModal();
    document.getElementById("b-btn-export-xlsx").onclick = () => API.txExport("xlsx", this._qs());
    document.getElementById("b-btn-export-csv").onclick = () => API.txExport("csv", this._qs());
    document.getElementById("b-btn-del-sel").onclick = () => this.deleteSelected();
    document.getElementById("b-file-import").onchange = (e) => this.onAnalyzeFile(e);
    document.getElementById("b-btn-analyze").onclick = () => document.getElementById("b-file-import").click();
    document.getElementById("b-btn-import-confirm").onclick = () => this.onImportConfirm();
    this.reload(1);
  },
  _qs() {
    ["type", "category", "room", "keyword", "start", "end"].forEach((k) => {
      const el = document.getElementById("b-filter-" + k);
      if (el) this.query[k] = el.value;
    });
    const out = Object.assign({}, this.query);
    if (this.query.room) out.room_no = this.query.room;
    if (this.query.start) out.date_from = this.query.start;
    if (this.query.end) out.date_to = this.query.end;
    return out;
  },
  _scrollTop() {
    try {
      const main = document.querySelector(".dashboard-main") || document.getElementById("dash-scroll-root") || document.documentElement;
      if (main) {
        main.scrollTop = 0;
        if (typeof main.scrollTo === "function") main.scrollTo({ top: 0, left: 0, behavior: "auto" });
      }
      const wrap = document.querySelector(".data-table-wrap");
      if (wrap) { wrap.scrollTop = 0; wrap.scrollLeft = 0; }
    } catch (_) {}
  },
  async reload(p, noScroll) {
    if (p) this.page = p;
    this._noScrollNextRender = !!noScroll;
    const q = Object.assign({}, this._qs(), { page: this.page, size: this.size });
    const res = await API.txList(q);
    const data = (res && res.data) || {};
    this.items = data.items || data.list || [];
    this.total = data.total || 0;
    this.summary = data.summary || null;
    this.render();
  },
  render() {
    const w = document.getElementById("b-table-wrap");
    if (!w) return;
    const sm = this.summary || {};
    document.getElementById("b-summary-info").textContent =
      `共 ${this.total} 条 | 筛选收入 ¥${sm.total_income || 0}  支出 ¥${sm.total_expense || 0}  净 ¥${sm.net || 0}`;
    if (!this.items.length) {
      w.innerHTML = `<div class="empty-state"><div class="empty-title">暂无交易记录</div><div class="empty-desc">点击"+ 添加交易"开始记账</div></div>`;
      return;
    }
    const pages = Math.max(1, Math.ceil(this.total / this.size));
    const rows = this.items.map((it) => {
      const isIn = it.type === "收入";
      const amtCls = isIn ? "tx-amt-in" : "tx-amt-ex";
      const sign = isIn ? "+" : "-";
      return `<tr data-id="${it.id}">
        <td><input type="checkbox" class="b-sel" data-id="${it.id}"/></td>
        <td>${it.trans_date || it.date || "-"}</td>
        <td>${it.type || "-"}</td>
        <td><span class="cat-pill">${it.category || "-"}</span></td>
        <td>${it.room_no || it.room || "-"}</td>
        <td>${it.description || it.note || "-"}</td>
        <td class="${amtCls}" style="font-weight:600;">${sign}${Number(it.amount || 0).toFixed(2)}</td>
        <td>
          <button class="btn-link-edit" data-act="edit" data-id="${it.id}">编辑</button>
          <button class="btn-link-del" data-act="del" data-id="${it.id}">删除</button>
        </td>
      </tr>`;
    }).join("");
    w.innerHTML = `
      <div class="data-table-wrap" style="margin:-16px -18px 0;padding:16px 18px 8px;">
        <table class="data-table">
          <thead><tr>
            <th style="width:40px;"><input type="checkbox" id="b-sel-all"/></th>
            <th style="width:120px;">日期</th>
            <th style="width:90px;">类型</th>
            <th style="width:120px;">分类</th>
            <th style="width:100px;">房间号</th>
            <th>描述</th>
            <th style="width:130px;text-align:right;">金额</th>
            <th style="width:160px;">操作</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      ${this.pagination(pages)}
    `;
    document.getElementById("b-sel-all").onchange = (e) => {
      w.querySelectorAll(".b-sel").forEach((x) => (x.checked = e.target.checked));
    };
    w.querySelectorAll("[data-act]").forEach((btn) => {
      btn.onclick = () => {
        const id = btn.getAttribute("data-id");
        const act = btn.getAttribute("data-act");
        if (act === "edit") this.openModal(id);
        if (act === "del") this.deleteOne(id);
      };
    });
    const prev = w.querySelector("#b-prev");
    const next = w.querySelector("#b-next");
    if (prev) prev.onclick = () => this.reload(this.page - 1);
    if (next) next.onclick = () => this.reload(this.page + 1);
    if (this._noScrollNextRender) this._noScrollNextRender = false;
    else this._scrollTop();
  },
  pagination(pages) {
    return `<div style="display:flex;align-items:center;justify-content:space-between;margin-top:14px;color:#6b7280;font-size:13px;">
      <div>第 ${this.page} / ${pages} 页，共 ${this.total} 条</div>
      <div style="display:flex;gap:6px;">
        <button id="b-prev" class="btn-ghost-sm" ${this.page <= 1 ? "disabled" : ""}>上一页</button>
        <button id="b-next" class="btn-ghost-sm" ${this.page >= pages ? "disabled" : ""}>下一页</button>
      </div>
    </div>`;
  },
  async openModal(editId) {
    const id = editId || null;
    let init = { type: "支出", category: "房租", amount: "", date: todayStr(), room: "", description: "" };
    if (id) {
      const d = await API.txDetail(id);
      if (d && d.data) Object.assign(init, d.data);
    }
    const modal = document.createElement("div");
    modal.className = "modal-mask";
    modal.innerHTML = `
    <div class="modal-card">
      <div class="modal-header">
        <div class="modal-title">${id ? "编辑交易" : "添加交易"}</div>
        <button class="modal-close" data-act="close">×</button>
      </div>
      <div class="modal-body" style="display:grid;grid-template-columns:1fr 1fr;gap:12px 16px;">
        <div>
          <label>类型 <span class="req">*</span></label>
          <select id="m-type">
            <option value="收入">收入</option>
            <option value="支出">支出</option>
          </select>
        </div>
        <div>
          <label>分类 <span class="req">*</span></label>
          <select id="m-category"></select>
        </div>
        <div>
          <label>金额 <span class="req">*</span></label>
          <input id="m-amount" type="number" step="0.01" min="0" placeholder="请输入金额"/>
        </div>
        <div>
          <label>日期 <span class="req">*</span></label>
          <input id="m-date" type="date"/>
        </div>
        <div>
          <label>房间号</label>
          <input id="m-room" placeholder="例如 101"/>
        </div>
        <div style="grid-column: span 2;">
          <label>描述/备注</label>
          <input id="m-desc" placeholder="例如 6月房租"/>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-ghost" data-act="close">取消</button>
        <button class="btn-primary" data-act="save">${id ? "保存修改" : "确认添加"}</button>
      </div>
    </div>`;
    document.body.appendChild(modal);
    const mType = modal.querySelector("#m-type");
    const mCat = modal.querySelector("#m-category");
    const ref = () => {
      const arr = mType.value === "收入" ? TX_CATEGORIES_INCOME : TX_CATEGORIES_EXPENSE;
      mCat.innerHTML = arr.map((x) => `<option value="${x}">${x}</option>`).join("");
      if (init.category && arr.includes(init.category)) mCat.value = init.category;
    };
    mType.value = init.type;
    ref();
    mType.onchange = ref;
    modal.querySelector("#m-amount").value = init.amount;
    modal.querySelector("#m-date").value = init.trans_date || init.date || todayStr();
    modal.querySelector("#m-room").value = init.room_no || init.room || "";
    modal.querySelector("#m-desc").value = init.description || "";
    const close = () => modal.parentNode && modal.parentNode.removeChild(modal);
    modal.querySelectorAll("[data-act=close]").forEach((x) => (x.onclick = close));
    modal.querySelector('[data-act="save"]').onclick = async () => {
      const dateVal = modal.querySelector("#m-date").value;
      const roomVal = modal.querySelector("#m-room").value || "";
      const payload = {
        type: mType.value,
        category: mCat.value,
        amount: parseFloat(modal.querySelector("#m-amount").value),
        date: dateVal,
        trans_date: dateVal,
        room: roomVal,
        room_no: roomVal,
        description: modal.querySelector("#m-desc").value || "",
      };
      if (!payload.amount || payload.amount <= 0) return alert("请输入有效金额");
      if (!payload.date) return alert("请选择日期");
      const res = id ? await API.txUpdate(id, payload) : await API.txCreate(payload);
      if (res && res.code === 0) {
        close();
        this.reload(1);
        setTimeout(() => this._scrollTop(), 30);
      } else {
        alert((res && res.msg) || "保存失败");
      }
    };
  },
  async deleteOne(id) {
    if (!confirm("确认删除这条交易记录？")) return;
    const r = await API.txDelete(id);
    if (r && r.code === 0) { this.reload(1, true); }
    else alert((r && r.msg) || "删除失败");
  },
  async deleteSelected() {
    const ids = Array.from(document.querySelectorAll(".b-sel:checked")).map((x) => parseInt(x.getAttribute("data-id")));
    if (!ids.length) return alert("请先勾选要删除的记录");
    if (!confirm(`确认删除 ${ids.length} 条记录？`)) return;
    const r = await API.txBatchDelete(ids);
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
      const r = await API.txImportPreview(fd);
      e.target.value = "";
      if (!(r && r.code === 0)) {
        alert((r && r.msg) || "预览失败");
        this.importState = { preview_id: null, rows: [], valid: 0, invalid: 0 };
        this._hidePreview();
        return;
      }
      const d = r.data || {};
      const rows = Array.isArray(d.rows) ? d.rows : [];
      const valid = parseInt(d.valid || 0, 10) || 0;
      const invalid = parseInt(d.invalid || 0, 10) || 0;
      this.importState = { preview_id: d.preview_id || null, rows, valid, invalid };
      this._renderPreviewTable(rows, valid, invalid);
    } finally { this._analyzeLock = false; }
  },
  _hidePreview() {
    const w = document.getElementById("b-import-preview-wrap");
    const btn = document.getElementById("b-btn-import-confirm");
    if (w) w.style.display = "none";
    if (btn) { btn.disabled = true; try { btn.setAttribute("disabled", "disabled"); } catch(_){} }
  },
  _renderPreviewTable(rows, valid, invalid) {
    const w = document.getElementById("b-import-preview-wrap");
    const btn = document.getElementById("b-btn-import-confirm");
    const sum = document.getElementById("b-import-summary");
    const thead = document.getElementById("b-import-thead");
    const tbody = document.getElementById("b-import-tbody");
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
      <th style="text-align:left;padding:10px 12px;border-bottom:1px solid #e5e7eb;background:#f8fafc;font-weight:600;color:#111827;min-width:120px;">日期</th>
      <th style="text-align:left;padding:10px 12px;border-bottom:1px solid #e5e7eb;background:#f8fafc;font-weight:600;color:#111827;min-width:80px;">类型</th>
      <th style="text-align:left;padding:10px 12px;border-bottom:1px solid #e5e7eb;background:#f8fafc;font-weight:600;color:#111827;min-width:100px;">分类</th>
      <th style="text-align:left;padding:10px 12px;border-bottom:1px solid #e5e7eb;background:#f8fafc;font-weight:600;color:#111827;">描述 / 备注</th>
      <th style="text-align:left;padding:10px 12px;border-bottom:1px solid #e5e7eb;background:#f8fafc;font-weight:600;color:#111827;min-width:110px;">金额</th>
      <th style="text-align:left;padding:10px 12px;border-bottom:1px solid #e5e7eb;background:#f8fafc;font-weight:600;color:#111827;min-width:80px;">状态</th>
      <th style="text-align:left;padding:10px 12px;border-bottom:1px solid #e5e7eb;background:#f8fafc;font-weight:600;color:#111827;">解析说明</th>
    </tr>`;
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="8" style="padding:26px 12px;text-align:center;color:#6b7280;font-size:13px;">没有可显示的解析行</td></tr>`;
      return;
    }
    tbody.innerHTML = rows.slice(0, 200).map((r) => {
      const room = r.room_no || r.room || r.roomNo || "";
      const date = r.trans_date || r.date || r.transDate || "";
      const type = r.type || "";
      const cat = r.category || r.cat || "";
      const desc = r.description || r.note || r.remark || "";
      const amt = Number(r.amount || 0) || 0;
      const st = r.status || (r.valid === false ? "无效" : "有效");
      const msg = r.message || r.error || r._line ? ("行号 " + r._line) : "";
      const cls = r.valid === false ? "background:#fff1f2;color:#b91c1c;" : (type === "支出" ? "" : "");
      const amtSign = type === "支出" ? "-" : "+";
      const amtColor = type === "支出" ? "color:#dc2626;font-weight:600;" : "color:#16a34a;font-weight:600;";
      return `<tr style="${cls}">
        <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;font-weight:700;color:#0f172a;">${room || "<span style='color:#9ca3af;'>-</span>"}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;">${date || "<span style='color:#9ca3af;'>-</span>"}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;">${type || "-"}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;"><span class="cat-pill" style="font-size:12px;padding:2px 8px;border-radius:999px;">${cat || "-"}</span></td>
        <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;color:#475569;">${desc || "<span style='color:#9ca3af;'>-</span>"}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;${amtColor}">${amtSign}¥${amt.toFixed(2)}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;">${st || "-"}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;color:#6b7280;font-size:12px;">${msg || ""}</td>
      </tr>`;
    }).join("") + (rows.length > 200 ? `<tr><td colspan="8" style="padding:8px 12px;text-align:center;color:#6b7280;font-size:12px;background:#f9fafb;">… 另有 ${rows.length - 200} 行未展示，导入时会一并处理</td></tr>` : "");
  },
  async onImportConfirm() {
    const preview_id = this.importState && this.importState.preview_id;
    if (!preview_id) { alert("请先选择 Excel/CSV 并点击「分析表格」"); return; }
    const valid = parseInt((this.importState && this.importState.valid) || 0, 10) || 0;
    if (!confirm(`共 ${valid} 条有效数据，确认导入到您的交易记录？`)) return;
    const c = await API.txImportConfirm(preview_id);
    if (c && c.code === 0) {
      const inserted = (c.data && c.data.inserted) || 0;
      alert(`✅ 导入成功，已写入 ${inserted} 条交易记录`);
      this.importState = { preview_id: null, rows: [], valid: 0, invalid: 0 };
      this._hidePreview();
      this.reload();
    } else {
      alert((c && c.msg) || "导入失败");
    }
  },
};
