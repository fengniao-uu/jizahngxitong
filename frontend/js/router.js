(function () {
  const TOKEN_KEY = "account_app_token";

  const MODULE_MAP = {
    home: '首页',
    bills: '交易记录',
    reminders: '收租提醒',
    stats: '统计分析',
    reports: '报表导出',
    settings: '系统设置',
    categories: '分类管理',
    budget: '预算设置',
    assets: '资产账户',
    tags: '标签管理',
    members: '家庭成员',
    admin: '管理中心'
  };

  const MODULE_INIT = {
    home: () => { try { if (window.DashApp && typeof window.DashApp.init === "function") window.DashApp.init(); } catch (e) { console.warn("[dash init]", e); } },
    bills: () => { try { if (window.ModBills) window.ModBills.init(); } catch (e) { console.warn("[bills init]", e); } },
    reminders: () => { try { if (window.ModReminders) window.ModReminders.init(); } catch (e) { console.warn("[reminders init]", e); } },
    stats: () => { try { if (window.ModStats) window.ModStats.init(); } catch (e) { console.warn("[stats init]", e); } },
    reports: () => { try { if (window.ModReports) window.ModReports.init(); } catch (e) { console.warn("[reports init]", e); } },
    settings: () => { try { if (window.ModSettings) window.ModSettings.init(); } catch (e) { console.warn("[settings init]", e); } },
    admin: () => { try { if (window.ModAdmin) window.ModAdmin.init(); } catch (e) { console.warn("[admin init]", e); } },
  };

  function _loginBannerStyle(level) {
    const L = String(level || "info").toLowerCase();
    const map = {
      info:    { bg: "rgba(219,234,254,.92)", fg: "#1e40af", bd: "#3b82f6", icon: "🔵" },
      success: { bg: "rgba(220,252,231,.92)", fg: "#166534", bd: "#22c55e", icon: "🟢" },
      warning: { bg: "rgba(254,243,199,.92)", fg: "#92400e", bd: "#f59e0b", icon: "🟡" },
      danger:  { bg: "rgba(254,226,226,.92)", fg: "#991b1b", bd: "#ef4444", icon: "🔴" },
    };
    return map[L] || map.info;
  }
  function _renderLoginAnnouncements() {
    try {
      const host = document.getElementById("login-ann-wrap");
      if (!host) {
        const sec = document.getElementById("screen-login");
        if (!sec) return;
        const d = document.createElement("div");
        d.id = "login-ann-wrap";
        Object.assign(d.style, {
          position: "fixed", top: "12px", left: "50%", transform: "translateX(-50%)",
          zIndex: "9999", width: "calc(100% - 32px)", maxWidth: "720px", display: "flex",
          flexDirection: "column", gap: "6px", pointerEvents: "none",
        });
        sec.appendChild(d);
      }
      if (!window.API || typeof window.API.getPublicAnnouncements !== "function") return;
      (async () => {
        const res = await window.API.getPublicAnnouncements(3);
        const list = (res && res.code === 0 && res.data && res.data.list) || [];
        const box = document.getElementById("login-ann-wrap");
        if (!box) return;
        if (!list.length) { box.innerHTML = ""; return; }
        box.innerHTML = list.map((a) => {
          const st = _loginBannerStyle(a.banner_level);
          const pinned = !!a.is_pinned;
          const title = String(a.title || "").trim();
          const content = String(a.content || "").trim().replace(/\n/g, "<br>");
          const esc = window.escapeHtml || ((s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])));
          return `<div style="pointer-events:auto;position:relative;background:${st.bg};color:${st.fg};border:1px solid ${st.bd};border-left:4px solid ${st.bd};border-radius:10px;padding:8px 12px;box-shadow:0 4px 18px rgba(0,0,0,.08);backdrop-filter:blur(4px);">
            <div style="display:flex;gap:8px;align-items:flex-start;">
              <div style="flex-shrink:0;font-size:15px;line-height:1.35;">${st.icon}</div>
              <div style="flex:1;min-width:0;">
                <div style="font-weight:700;font-size:12.5px;line-height:1.35;">
                  ${pinned ? '<span style="background:#fef3c7;color:#92400e;padding:1px 6px;border-radius:4px;font-size:10px;margin-right:6px;display:inline-block;vertical-align:middle;">📌 置顶</span>' : ''}
                  <span style="vertical-align:middle;">${esc(title)}</span>
                </div>
                ${content ? `<div style="font-size:11.5px;opacity:.92;margin-top:3px;line-height:1.5;word-break:break-word;">${esc(content).replace(/&lt;br&gt;/g, "<br>")}</div>` : ''}
              </div>
            </div>
          </div>`;
        }).join("");
      })();
    } catch (_) {}
  }
  function show(which) {
    const l = document.getElementById("screen-login");
    const d = document.getElementById("screen-dashboard");
    if (!l || !d) return;
    if (which === "login") {
      l.classList.remove("hidden");
      d.classList.add("hidden");
      _renderLoginAnnouncements();
    } else {
      l.classList.add("hidden");
      d.classList.remove("hidden");
      const host = document.getElementById("login-ann-wrap");
      if (host) try { host.innerHTML = ""; } catch (_) {}
    }
  }

  const _inited = {};

  function showModule(name) {
    try {
      const names = Object.keys(MODULE_MAP);
      names.forEach(function (n) {
        const el = document.getElementById("module-" + n);
        if (el) {
          if (!el.classList.contains("hidden")) {
            el.classList.add("hidden");
          }
        }
      });
      const target = document.getElementById("module-" + name);
      if (target) {
        if (target.classList.contains("hidden")) {
          target.classList.remove("hidden");
        }
      }
      try {
        const main = document.querySelector(".dashboard-main") || document.getElementById("dash-scroll-root");
        if (main) {
          main.scrollTop = 0;
          if (typeof main.scrollTo === "function") main.scrollTo({ top: 0, left: 0, behavior: "auto" });
        }
      } catch (_) {}
      const init = MODULE_INIT[name];
      if (typeof init === "function") {
        if (!_inited[name]) {
          _inited[name] = 1;
          try { init(); } catch (e) { console.warn("[module init fail]", name, e); }
        } else {
          // 重新进入模块：轻量刷新（列表页重新加载）
          try {
            if (name === "bills" && window.ModBills && typeof window.ModBills.reload === "function") window.ModBills.reload();
            if (name === "reminders" && window.ModReminders && typeof window.ModReminders.reload === "function") window.ModReminders.reload();
            if (name === "home" && window.DashApp && typeof window.DashApp.init === "function") { _inited[name] = 0; window.DashApp.init(); _inited[name] = 1; }
          } catch (_) {}
        }
      }
    } catch (e) {}
  }

  function highlightActiveMenu() {
    try {
      let hash = (location.hash || "").replace(/^#/, "");
      let name = "home";
      if (hash === "/dashboard") {
        name = "home";
      } else if (hash.length > "/dashboard/".length) {
        name = hash.slice("/dashboard/".length);
        const slashIdx = name.indexOf("/");
        if (slashIdx !== -1) name = name.slice(0, slashIdx);
      }
      const items = document.querySelectorAll("nav a.menu-item");
      items.forEach(function (a) {
        a.classList.remove("bg-[#1b3567]");
        a.classList.remove("text-white");
        a.classList.add("hover:bg-white/10");
        a.classList.add("text-white/80");
      });
      let matched = null;
      items.forEach(function (a) {
        const href = (a.getAttribute("href") || "");
        const target = "#/dashboard/" + name;
        if (href === target) {
          matched = a;
        }
      });
      if (matched) {
        matched.classList.add("bg-[#1b3567]");
        matched.classList.add("text-white");
        matched.classList.remove("hover:bg-white/10");
        matched.classList.remove("text-white/80");
      }
      const bottomItems = document.querySelectorAll(".bottom-nav .grid-cols-5 > a");
      const bottomTarget = "#/dashboard/" + name;
      bottomItems.forEach(function (a) {
        const href = a.getAttribute("href") || "";
        const isAct = href === bottomTarget;
        const isCenterBig = !!a.querySelector(".w-14.h-14.rounded-full");
        const textSpan = a.querySelector("span");
        if (isCenterBig) {
          if (isAct) {
            a.classList.add("bottom-nav-center-active");
          } else {
            a.classList.remove("bottom-nav-center-active");
          }
          return;
        }
        a.classList.remove("text-cblue");
        a.classList.add("text-gray-500");
        if (textSpan) {
          textSpan.classList.remove("font-medium");
          textSpan.classList.add("font-normal");
        }
        if (isAct) {
          a.classList.add("text-cblue");
          a.classList.remove("text-gray-500");
          if (textSpan) {
            textSpan.classList.add("font-medium");
            textSpan.classList.remove("font-normal");
          }
        }
      });
    } catch (e) {}
  }

  function route() {
    const rawHash = (location.hash || "");
    let hash = rawHash;
    if (hash.length >= 1 && hash.charAt(0) === "#") {
      hash = hash.slice(1);
    }
    const hasToken = !!localStorage.getItem(TOKEN_KEY);

    if (hash.startsWith("/dashboard")) {
      if (!hasToken) { location.replace("#/login"); return; }

      let name = "home";
      let needRedirect = false;

      if (hash === "/dashboard") {
        needRedirect = true;
      } else if (hash.length > "/dashboard/".length && hash.slice(0, "/dashboard/".length) === "/dashboard/") {
        const rest = hash.slice("/dashboard/".length);
        const slashIdx = rest.indexOf("/");
        const candidate = (slashIdx !== -1) ? rest.slice(0, slashIdx) : rest;
        if (MODULE_MAP.hasOwnProperty(candidate)) {
          name = candidate;
        } else {
          needRedirect = true;
        }
      } else {
        needRedirect = true;
      }

      // 前端守卫：管理员模块只允许 role=1 的用户访问
      if (!needRedirect && name === "admin") {
        try {
          let curRole = 0;
          try {
            const u = JSON.parse(localStorage.getItem("account_app_user") || "null");
            curRole = parseInt((u && u.role) || 0, 10) || 0;
          } catch (_) { curRole = 0; }
          if (curRole !== 1) {
            needRedirect = true;
          }
        } catch (_) { needRedirect = true; }
      }

      if (needRedirect) {
        location.replace("#/dashboard/home");
        return;
      }

      try { if (window.DashApp && typeof window.DashApp.applyRoleUI === "function") window.DashApp.applyRoleUI(); } catch (_) {}
      show("dashboard");
      highlightActiveMenu();
      showModule(name);
      return;
    }
    if (hash.startsWith("/login")) {
      if (hasToken) { location.replace("#/dashboard"); return; }
      show("login"); return;
    }
    location.replace(hasToken ? "#/dashboard" : "#/login");
  }

  window.addEventListener("hashchange", route);
  window.addEventListener("DOMContentLoaded", function () {
    route();
    setTimeout(function () {
      try { highlightActiveMenu(); } catch (e) {}
    }, 0);
  });
  window.Router = window.Router || {};
  window.Router.showScreen = show;
  window.Router.showModule = showModule;
  window.Router.highlightActiveMenu = highlightActiveMenu;
  window.Router.route = route;
  window.Router.go = (hash) => {
    if (!hash) hash = "#/login";
    if (hash.charAt(0) !== "#") hash = "#" + hash;
    location.hash = hash;
  };
  window.Router.resetInit = (name) => { if (name) delete _inited[name]; else Object.keys(_inited).forEach((k) => delete _inited[k]); };
  window.Router.logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem("userInfo");
    Object.keys(_inited).forEach((k) => delete _inited[k]);
    const cur = (location.hash || "").replace(/^#/, "");
    show("login");
    if (cur !== "/login") { location.hash = "#/login"; }
  };
  window.App = {
    gotoLogin: () => {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem("userInfo");
      const cur = (location.hash || "").replace(/^#/, "");
      show("login");
      if (cur !== "/login") { location.hash = "#/login"; }
    },
    gotoDashboard: () => { location.hash = "#/dashboard"; }
  };
})();
