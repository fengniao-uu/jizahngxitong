window.ModReports = {
  async init() {
    const c = document.getElementById("mod-reports-content");
    if (!c) return;
    c.innerHTML = `
    <div class="mcb-shell">
      <div class="glass-card" style="padding:18px;">
        <div style="font-size:16px;font-weight:600;margin-bottom:4px;">📤 报表 & 导出</div>
        <div style="color:#6b7280;font-size:13px;margin-bottom:16px;">一键导出当前所有交易记录与收租提醒，用于备份 / 打印 / Excel 分析。</div>

        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px;">
          <div class="card-report">
            <div class="rep-t">交易记录 · Excel</div>
            <div class="rep-d">导出全部收入/支出记录（含日期/分类/房间号/金额/描述）</div>
            <div class="rep-acts">
              <button class="btn-primary" id="rep-tx-xlsx">导出 XLSX</button>
              <button class="btn-ghost" id="rep-tx-csv">导出 CSV</button>
            </div>
          </div>
          <div class="card-report">
            <div class="rep-t">收租提醒 · Excel</div>
            <div class="rep-d">导出房间、房租、到期日期、状态、提醒标签</div>
            <div class="rep-acts">
              <button class="btn-primary" id="rep-rem-xlsx">导出 XLSX</button>
              <button class="btn-ghost" id="rep-rem-csv">导出 CSV</button>
            </div>
          </div>
          <div class="card-report">
            <div class="rep-t">💾 数据备份 <span style="display:inline-flex;align-items:center;padding:2px 8px;border-radius:999px;background:linear-gradient(135deg,#f1f5f9,#e2e8f0);color:#64748b;font-size:11px;font-weight:600;margin-left:6px;vertical-align:middle;">未开发</span></div>
            <div class="rep-d">定期导出，防止设备丢失或误删。（该功能开发中，暂未开放）</div>
            <div class="rep-acts">
              <button class="btn-primary-outline" id="rep-backup-tx" disabled style="opacity:.55;cursor:not-allowed;">交易备份 XLSX</button>
              <button class="btn-primary-outline" id="rep-backup-zip" disabled style="opacity:.55;cursor:not-allowed;">完整备份 ZIP</button>
            </div>
          </div>
        </div>
      </div>

      <div class="glass-card" style="margin-top:14px;padding:18px;">
        <div style="font-size:16px;font-weight:600;margin-bottom:8px;">📥 批量导入</div>
        <div style="color:#6b7280;font-size:13px;margin-bottom:12px;">先预览再确认写入，避免误操作。</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
          <div class="card-report">
            <div class="rep-t">交易记录批量导入</div>
            <div class="rep-d">支持 .xlsx / .csv 格式，会先解析预览再确认写入</div>
            <div class="rep-acts">
              <label class="btn-primary" style="cursor:pointer;">
                选择文件…
                <input type="file" id="rep-import-tx" accept=".xlsx,.xls,.csv" style="display:none;"/>
              </label>
            </div>
          </div>
          <div class="card-report">
            <div class="rep-t">提醒批量导入</div>
            <div class="rep-d">支持 .xlsx / .csv 格式，字段：房间号 / 房租金额 / 到期日期 / 租期结束 / 状态 / 备注</div>
            <div class="rep-acts">
              <label class="btn-primary" style="cursor:pointer;">
                选择文件…
                <input type="file" id="rep-import-rem" accept=".xlsx,.xls,.csv" style="display:none;"/>
              </label>
            </div>
          </div>
        </div>
      </div>
    </div>`;
    const b = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = fn; };
    b("rep-tx-xlsx", () => API.txExport("xlsx"));
    b("rep-tx-csv", () => API.txExport("csv"));
    b("rep-rem-xlsx", () => API.remExport("xlsx"));
    b("rep-rem-csv", () => API.remExport("csv"));
    b("rep-backup-tx", () => API.backupTx());
    b("rep-backup-zip", () => API.backupFull());

    const itx = document.getElementById("rep-import-tx");
    const irem = document.getElementById("rep-import-rem");
    if (itx) itx.onchange = (e) => {
      const f = e.target.files[0]; if (!f) return;
      const fd = new FormData(); fd.append("file", f);
      API.txImportPreview(fd).then((r) => {
        e.target.value = "";
        if (r && r.code === 0) {
          const d = r.data || {};
          const doIt = confirm(`解析 ${d.rows && d.rows.length} 行，有效 ${d.valid||0} 行，错误 ${d.invalid||0} 行，确认写入？`);
          if (doIt) API.txImportConfirm(d.preview_id).then((c) => alert((c&&c.code===0)?("已写入 "+(c.data&&c.data.inserted||0)+" 条"):(c&&c.msg||"写入失败")));
        } else alert((r && r.msg) || "预览失败");
      });
    };
    if (irem) irem.onchange = (e) => {
      const f = e.target.files[0]; if (!f) return;
      const fd = new FormData(); fd.append("file", f);
      API.remImportPreview(fd).then((r) => {
        e.target.value = "";
        if (r && r.code === 0) {
          const d = r.data || {};
          const doIt = confirm(`解析 ${d.rows && d.rows.length} 行，有效 ${d.valid||0} 行，错误 ${d.invalid||0} 行，确认写入？`);
          if (doIt) API.remImportConfirm(d.preview_id).then((c) => alert((c&&c.code===0)?("已写入 "+(c.data&&c.data.inserted||0)+" 条"):(c&&c.msg||"写入失败")));
        } else alert((r && r.msg) || "预览失败");
      });
    };
  },
};
