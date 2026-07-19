window.ModStats = {
  scope: 12,
  charts: { trend: null, incomePie: null, expensePie: null, compare: null },
  _styleInjected: false,
  _applyMobileStyles() {
    const isMobile = Boolean(
      (window.matchMedia && window.matchMedia("(max-width: 768px)").matches) ||
      (typeof window.innerWidth === "number" && window.innerWidth < 769) ||
      (document.documentElement && document.documentElement.clientWidth < 769)
    );
    const root = document.getElementById("mod-stats-content");
    if (root) {
      root.classList.toggle("is-mobile", isMobile);
      root.classList.toggle("is-desktop", !isMobile);
    }
    if (!this._styleInjected) {
      const s = document.createElement("style");
      s.id = "mod-stats-mq-styles";
      s.textContent = `
@media (max-width: 768px) {
  #mod-stats-content.is-mobile .mcb-shell .glass-card:first-child {
    flex-wrap: wrap !important;
    gap: 10px !important;
    padding: 10px 12px !important;
  }
  #mod-stats-content.is-mobile .mcb-shell #s-meta {
    width: 100% !important;
    font-size: 12px !important;
    order: 99;
  }
  #mod-stats-content.is-mobile .mcb-shell .chart-grid,
  #mod-stats-content.is-mobile .mcb-shell div[style*="grid-template-columns:1fr 1fr"] {
    grid-template-columns: 1fr !important;
    gap: 12px !important;
    margin-top: 12px !important;
  }
  #mod-stats-content.is-mobile .mcb-shell .chart-grid > .glass-card,
  #mod-stats-content.is-mobile .mcb-shell div[style*="grid-template-columns:1fr 1fr"] > .glass-card {
    display: flex !important;
    flex-direction: column !important;
    padding: 10px !important;
    min-height: 0 !important;
    overflow: visible !important;
  }
  #mod-stats-content.is-mobile .mcb-shell [style*="height:300px"],
  #mod-stats-content.is-mobile .mcb-shell [style*="height:320px"] {
    height: 290px !important;
    min-height: 290px !important;
  }
  #mod-stats-content.is-mobile .mcb-shell canvas { min-height: 250px !important; }
  #mod-stats-content.is-mobile .chart-title {
    font-size: 13px !important;
    line-height: 1.35 !important;
    margin-bottom: 6px !important;
    white-space: nowrap !important;
    overflow: hidden !important;
    text-overflow: ellipsis !important;
  }
  #mod-stats-content.is-mobile .chart-title .sub {
    font-size: 12px !important;
    display: inline !important;
    margin-left: 6px !important;
  }
}`;
      document.head.appendChild(s);
      this._styleInjected = true;
    }
  },
  async init() {
    const isMobile = Boolean(
      (window.matchMedia && window.matchMedia("(max-width: 768px)").matches) ||
      (typeof window.innerWidth === "number" && window.innerWidth < 769) ||
      (document.documentElement && document.documentElement.clientWidth < 769)
    );
    this.scope = isMobile ? 6 : 12;
    const defaultScope = this.scope;
    const c = document.getElementById("mod-stats-content");
    if (!c) return;
    this._applyMobileStyles();
    const chartKeys = Object.keys(this.charts || {});
    for (const k of chartKeys) this._destroy(this.charts[k]);
    ["chart-trend", "chart-income", "chart-expense", "chart-compare"].forEach((id) => {
      try {
        const el = document.getElementById(id);
        if (el && window.Chart && typeof Chart.getChart === "function") {
          const old = Chart.getChart(el);
          if (old && typeof old.destroy === "function") old.destroy();
        }
      } catch (_) {}
    });
    c.innerHTML = `
    <div class="mcb-shell">
      <div class="glass-card" style="padding:10px 16px;display:flex;gap:12px;align-items:center;">
        <div style="font-weight:600;">统计时间范围</div>
        <select id="s-scope">
          ${[3, 6, 12, 24, 60].map((n) => `<option value="${n}" ${n === defaultScope ? "selected" : ""}>最近 ${n} 个月</option>`).join("")}
        </select>
        <button id="s-refresh" class="btn-primary-sm">刷新图表</button>
        <div style="margin-left:auto;color:#6b7280;font-size:13px;" id="s-meta"></div>
      </div>

      <div class="chart-grid" style="display:grid;grid-template-columns:2fr 1fr;gap:14px;margin-top:14px;">
        <div class="glass-card" style="padding:16px 18px;">
          <div class="chart-title">近 ${this.scope} 个月 收支趋势 <span class="sub" id="trend-sum"></span></div>
          <div style="position:relative;height:320px;"><canvas id="chart-trend"></canvas></div>
        </div>
        <div class="glass-card" style="padding:16px 18px;">
          <div class="chart-title">分类对比（柱状图）</div>
          <div style="position:relative;height:320px;"><canvas id="chart-compare"></canvas></div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:14px;">
        <div class="glass-card" style="padding:16px 18px;">
          <div class="chart-title">收入分类占比 <span class="sub" id="income-sum"></span></div>
          <div style="position:relative;height:300px;"><canvas id="chart-income"></canvas></div>
        </div>
        <div class="glass-card" style="padding:16px 18px;">
          <div class="chart-title">支出分类占比 <span class="sub" id="expense-sum"></span></div>
          <div style="position:relative;height:300px;"><canvas id="chart-expense"></canvas></div>
        </div>
      </div>
    </div>`;
    document.getElementById("s-scope").onchange = (e) => {
      this.scope = parseInt(e.target.value || 12);
      this.refresh();
    };
    document.getElementById("s-refresh").onclick = () => this.refresh();
    this.refresh();
  },
  async refresh() {
    const [trend, pie, compare] = await Promise.all([API.statsTrend(), API.statsPie(this.scope), API.statsCompare(this.scope)]);
    const meta = document.getElementById("s-meta");
    if (trend && trend.code === 0 && meta) {
      const td = trend.data;
      meta.textContent = `12m 收入 ¥${td.total_income_12m} / 支出 ¥${td.total_expense_12m} / 净 ¥${td.net_12m}`;
    }
    this.renderTrend(trend && trend.data);
    this.renderPies(pie && pie.data);
    this.renderCompare(compare && compare.data);
  },
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
  renderTrend(d) {
    if (!d || !window.Chart) return;
    const ctx = document.getElementById("chart-trend");
    if (!ctx) return;
    this._destroy(this.charts.trend);
    this._destroyCanvas(ctx);
    this.charts.trend = null;
    const sum = document.getElementById("trend-sum");
    if (sum) sum.textContent = `（共 ${(d.months && d.months.length) || 0} 个月）`;
    const labels = Array.isArray(d.months) ? d.months.slice() : [];
    const income = Array.isArray(d.income) ? d.income.slice() : [];
    const expense = Array.isArray(d.expense) ? d.expense.slice() : [];
    const balance = Array.isArray(d.balance) ? d.balance.slice() : [];
    const _trendIsMobile = Boolean(
      (window.matchMedia && window.matchMedia("(max-width: 768px)").matches) ||
      (typeof window.innerWidth === "number" && window.innerWidth < 769) ||
      (document.documentElement && document.documentElement.clientWidth < 769)
    );
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
      options: Object.assign({}, baseChartOpts(), {
        layout: { padding: { bottom: _trendIsMobile ? 30 : 8 } },
      }),
    });
  },
  renderPies(d) {
    if (!d || !window.Chart) return;
    const palette = ["#6366f1", "#22c55e", "#f59e0b", "#ef4444", "#0ea5e9", "#8b5cf6", "#14b8a6", "#ec4899", "#f97316", "#06b6d4"];
    const make = (elId, saveKey, data, totalId) => {
      const ctx = document.getElementById(elId);
      if (!ctx) return null;
      this._destroy(this.charts[saveKey]);
      this._destroyCanvas(ctx);
      this.charts[saveKey] = null;
      const td = document.getElementById(totalId);
      if (td) td.textContent = `合计 ¥${data.total}`;
      const items = data.items || [];
      const labels = items.map((x) => x.name);
      const values = items.map((x) => x.value);
      const inst = new Chart(ctx, {
        type: "doughnut",
        data: {
          labels,
          datasets: [{
            data: values,
            backgroundColor: palette.slice(0, Math.max(values.length, 1)),
            borderWidth: 2,
            borderColor: "#ffffff",
          }],
        },
        options: Object.assign({}, baseChartOpts(), {
          plugins: Object.assign({}, (baseChartOpts().plugins || {}), { legend: { position: "bottom", labels: { boxWidth: 12, padding: 12 } } }),
        }),
      });
      this.charts[saveKey] = inst;
      return inst;
    };
    make("chart-income", "incomePie", d.income || {}, "income-sum");
    make("chart-expense", "expensePie", d.expense || {}, "expense-sum");
  },
  renderCompare(d) {
    if (!d || !window.Chart) return;
    const ctx = document.getElementById("chart-compare");
    if (!ctx) return;
    this._destroy(this.charts.compare);
    this._destroyCanvas(ctx);
    this.charts.compare = null;
    const labels = Array.isArray(d.categories) ? d.categories.slice() : [];
    const income = Array.isArray(d.income) ? d.income.slice() : [];
    const expense = Array.isArray(d.expense) ? d.expense.slice() : [];
    this.charts.compare = new Chart(ctx, {
      type: "bar",
      data: {
        labels,
        datasets: [
          { label: "收入", data: income, backgroundColor: "#22c55e", borderRadius: 6 },
          { label: "支出", data: expense, backgroundColor: "#ef4444", borderRadius: 6 },
        ],
      },
      options: baseChartOpts(),
    });
  },
};

function baseChartOpts() {
  const isMobile = Boolean(
    (window.matchMedia && window.matchMedia("(max-width: 768px)").matches) ||
    (typeof window.innerWidth === "number" && window.innerWidth < 769) ||
    (document.documentElement && document.documentElement.clientWidth < 769)
  );
  const yTickCallback = (v) => {
    const n = Number(v);
    if (!isFinite(n)) return v;
    if (Math.abs(n) >= 10000) return (n / 10000).toFixed(n % 10000 === 0 ? 0 : 1) + "w";
    if (Math.abs(n) >= 1000) return (n / 1000).toFixed(n % 1000 === 0 ? 0 : 1) + "k";
    return String(Math.round(n));
  };
  const xTick = isMobile
    ? {
        display: true,
        grid: { display: false },
        ticks: {
          font: { size: 9 },
          maxRotation: -35,
          minRotation: -35,
          autoSkip: true,
          autoSkipPadding: 12,
          maxTicksLimit: 6,
          padding: 6,
        },
      }
    : { grid: { display: false }, ticks: { font: { size: 11 } } };
  const yTick = {
    beginAtZero: true,
    grid: { color: "#f3f4f6" },
    ticks: { font: { size: isMobile ? 9 : 11 }, callback: yTickCallback },
  };
  const legend = isMobile
    ? {
        position: "top",
        align: "end",
        labels: {
          boxWidth: 9,
          boxHeight: 9,
          padding: 6,
          font: { size: 10 },
          usePointStyle: true,
          pointStyle: "rectRounded",
        },
      }
    : { position: "top", labels: { boxWidth: 12, padding: 14, font: { size: 12 } } };
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: isMobile ? 400 : 800 },
    plugins: {
      legend,
      tooltip: { backgroundColor: "#111827", padding: 10, titleFont: { size: 13 }, bodyFont: { size: 12 } },
    },
    scales: { x: xTick, y: yTick },
  };
}
window._baseChartOpts = baseChartOpts;
