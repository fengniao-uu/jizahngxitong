﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿(function () {
  const TOKEN_KEY = "account_app_token";

  document.addEventListener("DOMContentLoaded", function () {
    if (window._lpAuthInitRan === true) return;
    window._lpAuthInitRan = true;
    const cardInner = document.querySelector(".lp-card-inner");
    if (cardInner && !document.getElementById("lp-auth-tabs")) {
      const oldHtml = cardInner.innerHTML;
      cardInner.innerHTML = `
        <div id="lp-auth-tabs" class="lp-tabs">
          <div class="lp-tab active" data-tab="login">登录</div>
          <div class="lp-tab" data-tab="register">注册</div>
        </div>
        <div id="lp-tab-login">
          ${oldHtml}
        </div>
        <div id="lp-tab-register" class="hidden">
          <div class="lp-title">记账系统管理平台</div>
          <div class="lp-subtitle">新用户注册</div>
          <div class="lp-input-group">
            <span class="lp-input-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="#8ea4c9" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            </span>
            <input id="reg-account" class="lp-input" type="text" placeholder="请输入 6 位数字账号或 11 位手机号" maxlength="11" autocomplete="username"/>
          </div>
          <div class="lp-input-group">
            <span class="lp-input-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="#8ea4c9" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            </span>
            <input id="reg-password" class="lp-input lp-is-password" type="password" placeholder="请输入 6~12 位数字密码" maxlength="12" autocomplete="new-password"/>
          </div>
          <div class="lp-input-group">
            <span class="lp-input-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="#8ea4c9" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
            </span>
            <input id="reg-password2" class="lp-input lp-is-password" type="password" placeholder="再次输入密码" maxlength="12" autocomplete="new-password"/>
          </div>
          <div class="lp-input-group">
            <span class="lp-input-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="#8ea4c9" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 11h-6"/></svg>
            </span>
            <input id="reg-nickname" class="lp-input" type="text" placeholder="昵称（可选）" maxlength="20"/>
          </div>
          <button id="reg-btn" type="button" class="lp-login-btn">立即注册</button>
          <div id="reg-msg" class="lp-error"></div>
        </div>`;
      cardInner.querySelectorAll(".lp-tab").forEach((t) => {
        t.addEventListener("click", () => {
          cardInner.querySelectorAll(".lp-tab").forEach((x) => x.classList.remove("active"));
          t.classList.add("active");
          const tab = t.getAttribute("data-tab");
          var loginDiv = document.getElementById("lp-tab-login");

          loginDiv.classList.toggle("hidden", tab !== "login");

          loginDiv.style.display = (tab === "login") ? "" : "none";

          var registerDiv = document.getElementById("lp-tab-register");

          registerDiv.classList.toggle("hidden", tab !== "register");

          registerDiv.style.display = (tab === "register") ? "" : "none";

          const lm = document.getElementById("login-msg");
          if (lm) { lm.textContent = ""; lm.classList.remove("lp-error","lp-success"); lm.classList.add("lp-error"); }
          const rm = document.getElementById("reg-msg");
          if (rm) { rm.textContent = ""; rm.classList.remove("lp-error","lp-success"); rm.classList.add("lp-error"); }
          if (tab === "register") {
            ["reg-account","reg-password","reg-password2","reg-nickname"].forEach((id) => {
              const el = document.getElementById(id);
              if (el) {
                el.value = "";
                try { el.removeAttribute("value"); } catch (_) {}
                try { el.setAttribute("autocomplete","off"); } catch (_) {}
                try { el.dispatchEvent(new Event("input", { bubbles:true })); } catch (_) {}
              }
            });
          }
        });
      });
    }

    const eye = document.getElementById("show-password-eye");
    const pwd = document.getElementById("login-password");
    const btn = document.getElementById("login-btn");
    const form = document.getElementById("login-form");
    const msg = document.getElementById("login-msg");
    const userInput = document.getElementById("login-username");
    const captchaInput = document.getElementById("login-captcha");
    const captchaImg = document.getElementById("login-captcha-img");
    const captchaWrap = document.querySelector(".lp-captcha-img-wrap");
    const captchaRefreshBtn = document.getElementById("login-captcha-refresh");
    const regBtn = document.getElementById("reg-btn");
    const regMsg = document.getElementById("reg-msg");
    // JS 兜底 captcha 布局：不依赖 CSS @media 是否被吞，直接 inline style + important 保证生效
    (function applyCaptchaAllScreenLayout() {
      try {
        const row = document.querySelector(".lp-captcha-row");
        const wrap = document.querySelector(".lp-captcha-img-wrap");
        const img = document.getElementById("login-captcha-img");
        const inp = document.getElementById("login-captcha");
        const btn = document.getElementById("login-captcha-refresh");
        const isSmallMobile = Boolean(
          (window.matchMedia && window.matchMedia("(max-width: 768px)").matches) ||
          (typeof window.innerWidth === "number" && window.innerWidth < 769) ||
          (document.documentElement && document.documentElement.clientWidth < 769)
        );
        if (row) {
          row.style.setProperty("display", "flex", "important");
          row.style.setProperty("justify-content", "space-between", "important");
          row.style.setProperty("width", "100%", "important");
          if (isSmallMobile) {
            row.style.setProperty("flex-direction", "column", "important");
            row.style.setProperty("align-items", "stretch", "important");
            row.style.setProperty("gap", "10px", "important");
            row.style.setProperty("margin", "10px 0 2px", "important");
          } else {
            row.style.setProperty("flex-direction", "row", "important");
            row.style.setProperty("align-items", "stretch", "important");
            row.style.setProperty("gap", "10px", "important");
            row.style.setProperty("margin", "12px 0 4px", "important");
          }
        }
        if (wrap) {
          wrap.style.setProperty("display", "flex", "important");
          wrap.style.setProperty("align-items", "center", "important");
          wrap.style.setProperty("border-radius", "10px", "important");
          wrap.style.setProperty("background", "rgba(255,255,255,.72)", "important");
          wrap.style.setProperty("border", "1px solid rgba(148,163,184,.45)", "important");
          wrap.style.setProperty("box-shadow", "0 2px 8px rgba(15,23,42,.08)", "important");
          wrap.style.setProperty("cursor", "pointer", "important");
          if (isSmallMobile) {
            wrap.style.setProperty("width", "100%", "important");
            wrap.style.setProperty("max-width", "100%", "important");
            wrap.style.setProperty("min-width", "0", "important");
            wrap.style.setProperty("min-height", "64px", "important");
            wrap.style.setProperty("padding", "8px 12px", "important");
            wrap.style.setProperty("justify-content", "space-between", "important");
            wrap.style.setProperty("gap", "6px", "important");
            wrap.style.setProperty("flex", "1 1 100%", "important");
          } else {
            wrap.style.setProperty("flex", "0 0 auto", "important");
            wrap.style.setProperty("gap", "6px", "important");
            wrap.style.setProperty("justify-content", "center", "important");
            wrap.style.setProperty("min-width", "168px", "important");
            wrap.style.setProperty("max-width", "180px", "important");
            wrap.style.setProperty("min-height", "60px", "important");
            wrap.style.setProperty("padding", "4px 8px", "important");
          }
        }
        if (img) {
          img.style.setProperty("display", "block", "important");
          img.style.setProperty("border-radius", isSmallMobile ? "8px" : "6px", "important");
          img.style.setProperty("object-fit", "contain", "important");
          img.style.setProperty("border", "1px solid rgba(148,163,184,.3)", "important");
          img.style.setProperty("background", "#fff", "important");
          img.style.setProperty("opacity", "1", "important");
          if (isSmallMobile) {
            img.style.setProperty("width", "auto", "important");
            img.style.setProperty("height", "56px", "important");
            img.style.setProperty("min-height", "56px", "important");
            img.style.setProperty("min-width", "172px", "important");
            img.style.setProperty("max-width", "76%", "important");
            img.style.setProperty("object-position", "left center", "important");
          } else {
            img.style.setProperty("width", "160px", "important");
            img.style.setProperty("height", "52px", "important");
            img.style.setProperty("min-height", "52px", "important");
            img.style.setProperty("min-width", "160px", "important");
            img.style.setProperty("object-position", "center", "important");
          }
        }
        if (inp) {
          inp.style.setProperty("text-transform", "uppercase", "important");
          inp.style.setProperty("font-weight", "600", "important");
          if (isSmallMobile) {
            inp.style.setProperty("height", "46px", "important");
            inp.style.setProperty("font-size", "16px", "important");
            inp.style.setProperty("letter-spacing", "3px", "important");
          } else {
            inp.style.setProperty("height", "40px", "important");
            inp.style.setProperty("font-size", "14px", "important");
            inp.style.setProperty("letter-spacing", "2px", "important");
          }
        }
        if (btn) {
          btn.style.setProperty("display", "inline-flex", "important");
          btn.style.setProperty("align-items", "center", "important");
          btn.style.setProperty("gap", "2px", "important");
          btn.style.setProperty("border-radius", "6px", "important");
          btn.style.setProperty("white-space", "nowrap", "important");
          btn.style.setProperty("cursor", "pointer", "important");
          btn.style.setProperty("border", "none", "important");
          btn.style.setProperty("color", "#6366f1", "important");
          btn.style.setProperty("background", "rgba(99,102,241,.08)", "important");
          if (isSmallMobile) {
            btn.style.setProperty("font-size", "12px", "important");
            btn.style.setProperty("padding", "5px 8px", "important");
          } else {
            btn.style.setProperty("font-size", "11px", "important");
            btn.style.setProperty("padding", "2px 6px", "important");
          }
        }
      } catch (_) {}
    })();

    const _toastMsg = (el, text, type) => {
      if (!el) return;
      const raw = (text === undefined || text === null) ? "" : String(text);
      try { el.textContent = raw; } catch (_) {}
      try { el.innerText = raw; } catch (_) {}
      if (raw && !raw.includes("<")) { try { el.innerHTML = raw.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); } catch (_) {} }
      const t = (type === "success") ? "success" : "error";
      try { el.classList.remove("lp-error", "lp-success", "show"); } catch (_) {}
      try { el.classList.add((t === "success") ? "lp-success" : "lp-error"); } catch (_) {}
      try {
        el.style.setProperty("display", "block", "important");
        el.style.setProperty("visibility", "visible", "important");
        el.style.setProperty("opacity", "1", "important");
        el.style.setProperty("min-height", "18px", "important");
        el.style.setProperty("padding", "10px 12px", "important");
        el.style.setProperty("border-radius", "8px", "important");
        el.style.setProperty("font-size", "13px", "important");
        el.style.setProperty("font-weight", "700", "important");
        el.style.setProperty("line-height", "1.7", "important");
        el.style.setProperty("letter-spacing", "0.5px", "important");
        el.style.setProperty("word-break", "break-all", "important");
        el.style.setProperty("white-space", "pre-wrap", "important");
        if (t === "success") {
          el.style.setProperty("color", "#059669", "important");
          el.style.setProperty("background", "rgba(16, 185, 129, 0.10)", "important");
          el.style.setProperty("border", "1px solid rgba(16, 185, 129, 0.45)", "important");
          el.style.setProperty("box-shadow", "0 1px 6px rgba(16,185,129,.12)", "important");
          try { el.classList.add("show"); } catch (_) {}
        } else {
          el.style.setProperty("color", "#dc2626", "important");
          el.style.setProperty("background", "rgba(239, 68, 68, 0.08)", "important");
          el.style.setProperty("border", "1px solid rgba(239, 68, 68, 0.35)", "important");
          el.style.setProperty("box-shadow", "0 1px 6px rgba(239,68,68,.10)", "important");
        }
      } catch (_) {}
    };

    const _afterLogin = (res) => {
      if (!res || !res.data) return;
      const token = res.data.token;
      let user = res.data.user || res.data.userInfo || null;
      if (!user) {
        user = {
          id: res.data.user_id || res.data.id,
          user_id: res.data.user_id || res.data.id,
          account_no: res.data.account_no || "",
          nickname: res.data.nickname || "",
          phone: res.data.phone || "",
          created_at: res.data.created_at || "",
          last_login_at: res.data.last_login_at || "",
          role: parseInt(res.data.role, 10) || 0,
        };
      } else {
        if (user && !user.account_no && res.data.account_no) {
          try { user.account_no = res.data.account_no; } catch (_) {}
          try { if (!user.user_id) user.user_id = res.data.user_id || user.id; } catch (_) {}
        }
        if (res.data.role !== undefined && res.data.role !== null) {
          try { user.role = parseInt(res.data.role, 10) || 0; } catch (_) { user.role = 0; }
        } else if (user.role === undefined || user.role === null) {
          user.role = 0;
        }
      }
      if (window.API && typeof window.API.store === "function") window.API.store(token, user);
      else {
        localStorage.setItem(TOKEN_KEY, token);
        try { localStorage.setItem("account_app_user", JSON.stringify(user)); } catch (_) {}
        try { localStorage.setItem("userInfo", JSON.stringify(user)); } catch (_) {}
      }
      try {
        if (window.DashApp && typeof window.DashApp.applyRoleUI === "function") {
          window.DashApp.applyRoleUI();
        } else {
          const roleI = parseInt((user && user.role) || (res.data && res.data.role) || 0, 10) || 0;
          const adminMenu = document.querySelector('[data-admin-menu]');
          if (adminMenu) adminMenu.style.display = (roleI === 1) ? "flex" : "none";
          const sbUserCard = document.querySelector('.sidebar .mx-2.mt-4');
          if (sbUserCard) {
            const sbNickEl = sbUserCard.querySelector('.flex-1 .truncate');
            const sbRoleEl = sbUserCard.querySelector('.flex-1 .text-xs');
            const sbAvatarEl = sbUserCard.querySelector('.w-10.h-10.rounded-full');
            const nickText = (user && (user.nickname || user.account_no)) || "用户";
            if (sbNickEl) sbNickEl.textContent = nickText;
            if (sbRoleEl) {
              sbRoleEl.textContent = roleI === 1 ? "超级管理员" : "普通用户";
              sbRoleEl.style.color = roleI === 1 ? "#fbbf24" : "";
            }
            if (sbAvatarEl) {
              const firstChar = (user && user.nickname) ? user.nickname.charAt(0) : ((user && user.account_no) ? user.account_no.charAt(0) : "用");
              sbAvatarEl.textContent = firstChar;
              if (roleI === 1) {
                sbAvatarEl.style.background = "linear-gradient(135deg,#f59e0b,#fbbf24)";
                sbAvatarEl.style.color = "#78350f";
              }
            }
          }
        }
      } catch (_) {}
      const roleI = parseInt((user && user.role) || (res.data && res.data.role) || 0, 10) || 0;
      const target = (roleI === 1) ? "#/dashboard/admin" : "#/dashboard/home";
      if (window.Router && typeof window.Router.go === "function") window.Router.go(target);
      else location.hash = target;
    };

    // ============ 注册成功弹窗 ============
    let _regSuccessModalTimer = null;
    const _destroyRegisterSuccessModal = () => {
      if (_regSuccessModalTimer) { try { clearTimeout(_regSuccessModalTimer); } catch (_) {} _regSuccessModalTimer = null; }
      const old = document.getElementById("__reg_success_modal__");
      if (old) { try { old.remove(); } catch (_) { try { old.parentNode && old.parentNode.removeChild(old); } catch (_) {} } }
      try {
        const overlays = document.querySelectorAll("[data-reg-success-overlay]");
        overlays.forEach((o) => { try { o.remove(); } catch (_) { try { o.parentNode && o.parentNode.removeChild(o); } catch (_) {} } });
      } catch (_) {}
    };
    const _afterRegModalClose = (account) => {
      try {
        const emptyIds = ["reg-account", "reg-password", "reg-password2", "reg-nickname",
                          "login-username", "login-password", "login-captcha"];
        emptyIds.forEach((id) => {
          const el = document.getElementById(id);
          if (el) {
            el.value = "";
            try { el.removeAttribute("value"); } catch (_) {}
            try { el.setAttribute("autocomplete", "off"); } catch (_) {}
            try { el.dispatchEvent(new Event("input", { bubbles: true })); } catch (_) {}
            try { el.dispatchEvent(new Event("change", { bubbles: true })); } catch (_) {}
          }
        });
        try {
          const allInputs = document.querySelectorAll(".lp-card-inner input");
          allInputs.forEach((inp) => {
            try { inp.removeAttribute("value"); inp.setAttribute("autocomplete", "off"); } catch (_) {}
            if (inp.type !== "button" && inp.type !== "submit" && inp.type !== "hidden") {
              inp.value = "";
            }
          });
          const f = document.querySelector(".lp-card-inner form");
          if (f && typeof f.reset === "function") try { f.reset(); } catch (_) {}
        } catch (_) {}
        const cardInner = document.querySelector(".lp-card-inner");
        const loginTab = (cardInner ? cardInner.querySelector('.lp-tab[data-tab="login"]') : null) || document.querySelector('.lp-tab[data-tab="login"]');
        if (loginTab && typeof loginTab.click === "function") {
          loginTab.click();
        } else {
          const allTabs = document.querySelectorAll(".lp-tab");
          allTabs.forEach((t) => t.classList.remove("active"));
          const loginDiv = document.getElementById("lp-tab-login");
          const regDiv = document.getElementById("lp-tab-register");
          if (loginDiv) { loginDiv.classList.remove("hidden"); loginDiv.style.display = ""; }
          if (regDiv)   { regDiv.classList.add("hidden");   regDiv.style.display = "none"; }
          const tabLogin = Array.from(allTabs).find((t) => (t.getAttribute("data-tab") || "") === "login");
          if (tabLogin) tabLogin.classList.add("active");
        }
        setTimeout(() => {
          const loginMsg = document.getElementById("login-msg");
          _toastMsg(loginMsg, "注册成功！请使用新账号 " + (account || "") + " + 密码登录", "success");
          try {
            const u = document.getElementById("login-username");
            if (u && account) { u.value = account; try { u.dispatchEvent(new Event("input", { bubbles:true })); } catch (_) {} try { u.focus(); } catch (_) {} }
          } catch (_) {}
        }, 280);
        if (typeof refreshCaptcha === "function") refreshCaptcha();
        try {
          const cap = document.getElementById("login-captcha");
          if (cap && typeof cap.focus === "function") { cap.blur(); }
        } catch (_) {}
      } catch (_) {}
    };
    const _showRegisterSuccessModal = (account) => {
      _destroyRegisterSuccessModal();
      const wrap = document.createElement("div");
      wrap.id = "__reg_success_modal__";
      wrap.setAttribute("data-reg-success-overlay", "1");
      wrap.setAttribute("role", "dialog");
      wrap.setAttribute("aria-modal", "true");
      wrap.setAttribute("aria-labelledby", "__reg_success_title__");
      wrap.style.cssText = [
        "position:fixed","inset:0","z-index:2147483647",
        "display:flex","align-items:center","justify-content:center",
        "background:rgba(15,23,42,0.58)",
        "-webkit-backdrop-filter:blur(4px)","backdrop-filter:blur(4px)",
        "padding:20px","margin:0","border:none","outline:none","box-sizing:border-box",
        "font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
        "opacity:0","transition:opacity 180ms ease-out","animation:none"
      ].join(" !important;") + " !important;";
      const card = document.createElement("div");
      card.setAttribute("data-reg-success-card", "1");
      card.style.cssText = [
        "position:relative","width:100%","max-width:420px",
        "background:#ffffff","border-radius:20px",
        "box-shadow:0 20px 60px rgba(15,23,42,0.28), 0 0 0 1px rgba(15,23,42,0.05)",
        "padding:36px 28px 26px 28px","box-sizing:border-box","text-align:center",
        "transform:translateY(8px) scale(0.98)","transition:transform 220ms cubic-bezier(.2,.8,.2,1),opacity 220ms ease-out",
        "opacity:0","overflow:hidden","margin:0"
      ].join(" !important;") + " !important;";
      const topAccent = document.createElement("div");
      topAccent.style.cssText = [
        "position:absolute","top:0","left:0","right:0","height:4px",
        "background:linear-gradient(90deg,#10b981 0%, #059669 50%, #047857 100%)"
      ].join(" !important;") + " !important;";
      const iconWrap = document.createElement("div");
      iconWrap.style.cssText = [
        "position:relative","width:84px","height:84px","margin:0 auto 20px auto",
        "background:linear-gradient(135deg,rgba(16,185,129,0.16),rgba(16,185,129,0.06))",
        "border:2px solid rgba(16,185,129,0.32)","border-radius:50%",
        "display:flex","align-items:center","justify-content:center",
        "box-shadow:0 10px 24px rgba(16,185,129,0.18)"
      ].join(" !important;") + " !important;";
      iconWrap.innerHTML = `<svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#059669" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>`;
      const title = document.createElement("div");
      title.id = "__reg_success_title__";
      title.style.cssText = [
        "font-size:24px","font-weight:800","line-height:1.3","letter-spacing:0.5px",
        "color:#064e3b","margin:0 0 10px 0","text-align:center"
      ].join(" !important;") + " !important;";
      title.textContent = "注册成功！";
      const desc = document.createElement("div");
      desc.style.cssText = [
        "font-size:14px","font-weight:600","line-height:1.7","letter-spacing:0.3px",
        "color:#1f2937","margin:0 0 8px 0","text-align:center"
      ].join(" !important;") + " !important;";
      desc.textContent = "您的账号：";
      const accBox = document.createElement("div");
      accBox.style.cssText = [
        "display:inline-block","padding:10px 18px","margin:4px auto 22px auto",
        "background:rgba(16,185,129,0.10)","border:1px solid rgba(16,185,129,0.30)",
        "color:#047857","border-radius:10px",
        "font-size:18px","font-weight:800","letter-spacing:2px","line-height:1.4",
        "font-family:'SF Mono',Menlo,Consolas,ui-monospace,monospace"
      ].join(" !important;") + " !important;";
      accBox.textContent = String(account || "");
      const hint = document.createElement("div");
      hint.style.cssText = [
        "font-size:13px","line-height:1.6","letter-spacing:0.3px","color:#6b7280",
        "margin:0 0 26px 0","text-align:center","font-weight:500"
      ].join(" !important;") + " !important;";
      hint.textContent = "现已为您创建账号，请使用该账号 + 注册时设置的密码登录";
      const btns = document.createElement("div");
      btns.style.cssText = [
        "display:flex","flex-direction:row-reverse","gap:12px","align-items:center","justify-content:center",
        "margin:0","padding:0"
      ].join(" !important;") + " !important;";
      const btnPrimary = document.createElement("button");
      btnPrimary.type = "button";
      btnPrimary.setAttribute("data-reg-success-btn", "primary");
      btnPrimary.style.cssText = [
        "flex:1","min-height:44px","border:none","outline:none","cursor:pointer",
        "background:linear-gradient(180deg,#10b981,#059669)",
        "color:#ffffff","font-size:15px","font-weight:700","letter-spacing:0.5px",
        "border-radius:12px","padding:12px 18px","line-height:1.4",
        "box-shadow:0 8px 18px rgba(16,185,129,0.32), inset 0 1px 0 rgba(255,255,255,0.18)",
        "transition:transform 120ms ease-out, box-shadow 120ms ease-out, filter 120ms ease-out"
      ].join(" !important;") + " !important;";
      btnPrimary.textContent = "立即去登录";
      const btnClose = document.createElement("button");
      btnClose.type = "button";
      btnClose.setAttribute("data-reg-success-btn", "close");
      btnClose.style.cssText = [
        "flex:1","min-height:44px","border:1px solid #e5e7eb","outline:none","cursor:pointer",
        "background:#f9fafb",
        "color:#374151","font-size:15px","font-weight:600","letter-spacing:0.3px",
        "border-radius:12px","padding:12px 18px","line-height:1.4",
        "transition:background 120ms ease-out, color 120ms ease-out"
      ].join(" !important;") + " !important;";
      btnClose.textContent = "知道了";
      btns.appendChild(btnPrimary);
      btns.appendChild(btnClose);
      const countdown = document.createElement("div");
      countdown.style.cssText = [
        "margin-top:16px","font-size:12px","line-height:1.5","letter-spacing:0.3px",
        "color:#9ca3af","text-align:center","font-weight:500"
      ].join(" !important;") + " !important;";
      countdown.textContent = "3.5 秒后自动关闭并跳转登录…";
      card.appendChild(topAccent);
      card.appendChild(iconWrap);
      card.appendChild(title);
      card.appendChild(desc);
      const descBox = document.createElement("div"); descBox.style.margin = "0"; descBox.appendChild(desc);
      card.appendChild(descBox);
      card.appendChild(accBox);
      card.appendChild(hint);
      card.appendChild(btns);
      card.appendChild(countdown);
      wrap.appendChild(card);
      (document.body || document.documentElement).appendChild(wrap);
      try {
        const y = document.body.scrollTop || document.documentElement.scrollTop || 0;
        if (y > 0) window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
      } catch (_) {}
      requestAnimationFrame(() => {
        try { wrap.style.opacity = "1"; } catch (_) {}
        try {
          card.style.transform = "translateY(0) scale(1)";
          card.style.opacity = "1";
        } catch (_) {}
      });
      let autoSec = 35;
      const cdTick = () => {
        if (!document.getElementById("__reg_success_modal__")) return;
        autoSec -= 1;
        if (autoSec <= 0) return;
        try { countdown.textContent = ((autoSec / 10).toFixed(1)) + " 秒后自动关闭并跳转登录…"; } catch (_) {}
      };
      const cdTimer = setInterval(cdTick, 100);
      const closeAndGo = () => {
        try { clearInterval(cdTimer); } catch (_) {}
        _destroyRegisterSuccessModal();
        _afterRegModalClose(account || "");
      };
      const onKey = (e) => {
        if (e.key === "Escape" || e.keyCode === 27) closeAndGo();
      };
      document.addEventListener("keydown", onKey, { once: true, passive: true, capture: false });
      btnPrimary.addEventListener("click", (e) => { try { e.preventDefault(); e.stopPropagation(); } catch (_) {} closeAndGo(); }, { once: true, passive: false, capture: false });
      btnClose.addEventListener("click", (e) => { try { e.preventDefault(); e.stopPropagation(); } catch (_) {} closeAndGo(); }, { once: true, passive: false, capture: false });
      wrap.addEventListener("click", (e) => {
        if (e.target === wrap || e.target && String(e.target.getAttribute && e.target.getAttribute("data-reg-success-overlay")) === "1") {
          try { e.preventDefault(); e.stopPropagation(); } catch (_) {} closeAndGo();
        }
      }, { passive: false, capture: false });
      try { btnPrimary.focus && btnPrimary.focus(); } catch (_) {}
      _regSuccessModalTimer = setTimeout(() => {
        try { clearInterval(cdTimer); } catch (_) {}
        closeAndGo();
      }, 3500);
    };

    // ============ 验证码 ============
    // 用运行时动态生成 SVG data URL（UTF-8 + encodeURIComponent）→ 中文永不乱码（之前写死 base64 会把"加载失败"编码成"加龅失败"）
    const _mkCaptchaSvg = function (text, bgColor, borderColor, textColor, accentColor) {
      const w = 160, h = 52;
      const pad = 10;
      const accentBar = accentColor ? `<rect x="1" y="1" width="18" height="${h-2}" fill="${accentColor}" opacity="0.15" rx="4"/>` : '';
      const dashedHint = accentColor ? `<rect x="${w-22}" y="4" width="18" height="${h-8}" rx="4" fill="none" stroke="${accentColor}" stroke-width="1" stroke-dasharray="3,2" opacity="0.5"/>` : '';
      const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="-${pad} -${pad/2} ${w + pad*2} ${h + pad}" preserveAspectRatio="xMidYMid meet">
  <rect x="0" y="0" width="${w}" height="${h}" fill="${bgColor}" stroke="${borderColor}" stroke-width="1" rx="6" ry="6"/>
  <defs>
    <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#3b82f6"/>
      <stop offset="100%" stop-color="#8b5cf6"/>
    </linearGradient>
  </defs>
  ${accentBar}
  <text x="${w/2}" y="${h/2}" font-family="-apple-system,Segoe UI,Microsoft YaHei,\"PingFang SC\",\"Hiragino Sans GB\",Meiryo UI,system-ui,sans-serif" font-size="12" font-weight="500" fill="${textColor}" text-anchor="middle" dominant-baseline="central" dy="0.05em">${text}</text>
  ${dashedHint}
</svg>`;
      return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg);
    };
    const CAPTCHA_PENDING = _mkCaptchaSvg(
      "加载验证码中…请稍候或点击图片刷新",
      "#ffffff", "#b5c2d0", "#64748b",
      "#3b82f6"
    );
    const CAPTCHA_FAIL = _mkCaptchaSvg(
      "加载失败·点击图片或换一张按钮重试",
      "#fef2f2", "#f87171", "#dc2626",
      "#ef4444"
    );
    if (!window._captcha) window._captcha = { id: null };
    let _captcha_id = null;
    let _refreshing_captcha = false;
    function _setCaptchaSrc(svgOrUrl, altText) {
      if (!captchaImg) return;
      captchaImg.removeAttribute("srcset");
      captchaImg.onload = function () { try { captchaImg.style.opacity = "1"; captchaImg.style.filter = "none"; } catch (_) {} };
      captchaImg.onerror = function () { try { captchaImg.src = CAPTCHA_FAIL; captchaImg.style.opacity = "0.95"; captchaImg.style.filter = "none"; captchaImg.alt = "验证码加载失败，请点击重试"; } catch (_) {} };
      captchaImg.src = svgOrUrl;
      if (altText) captchaImg.alt = altText;
    }
    async function refreshCaptcha() {
      if (!captchaImg) return;
      if (_refreshing_captcha) return;
      _refreshing_captcha = true;
      try {
        _setCaptchaSrc(CAPTCHA_PENDING, "验证码加载中…请稍候，或点击图片立即刷新");
        captchaImg.style.opacity = "0.7";
        captchaImg.style.filter = "blur(1px)";
        if (!window.API || typeof window.API.captcha !== "function") {
          throw new Error("系统还没准备好");
        }
        const res = await window.API.captcha();
        if (!res || res.code !== 0 || !res.data || !res.data.image) {
          throw new Error((res && res.msg) || "验证码加载失败");
        }
        _captcha_id = res.data.captcha_id || null;
        if (window._captcha) window._captcha.id = _captcha_id;
        _setCaptchaSrc(res.data.image, "验证码（长度" + (res.data.length || 4) + "，点击刷新）");
        if (captchaWrap) captchaWrap.title = res.data.ttl ? `验证码 ${Math.round(res.data.ttl/60)} 分钟内有效，点击刷新` : "点击刷新验证码";
        if (captchaInput) captchaInput.value = "";
      } catch (e) {
        console.warn("[captcha] 刷新失败：", e);
        _setCaptchaSrc(CAPTCHA_FAIL, "验证码加载失败，点击图片或换一张按钮重试");
        captchaImg.style.opacity = "0.95";
        captchaImg.style.filter = "none";
        _captcha_id = null;
        if (window._captcha) window._captcha.id = null;
        if (msg) msg.textContent = "验证码加载失败，请点击刷新或稍后重试";
      } finally {
        _refreshing_captcha = false;
      }
    }
    if (captchaWrap) captchaWrap.addEventListener("click", (e) => { if (e.target !== captchaRefreshBtn && !captchaRefreshBtn.contains(e.target)) refreshCaptcha(); });
    if (captchaRefreshBtn) captchaRefreshBtn.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); refreshCaptcha(); });
    // 初始加载：1 次
    setTimeout(() => { refreshCaptcha(); }, 80);

    // ========== 密码可见性切换 ==========
    if (eye && pwd) {
      eye.addEventListener("click", function () {
        const isHidden = pwd.type === "password";
        pwd.type = isHidden ? "text" : "password";
        const svg = eye.querySelector("svg");
        if (svg) {
          svg.innerHTML = isHidden
            ? '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'
            : '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/><line x1="3" y1="3" x2="21" y2="21" stroke-width="2"/>';
        }
      });
    }

    // ========== 登录 ==========
    let _loginSubmitting = false;
    if (btn) {
      btn.addEventListener("click", async function () {
        if (_loginSubmitting) return;
        _loginSubmitting = true;
        try {
        _toastMsg(msg, "");
        const u = userInput ? userInput.value.trim() : "";
        const p = pwd ? pwd.value.trim() : "";
        const cc = captchaInput ? captchaInput.value.trim() : "";
        const cid = _captcha_id || (window._captcha && window._captcha.id) || null;
        if (!u || !p) return _toastMsg(msg, "请输入账号和密码");
        if (!(/^\d{6}$/.test(u) || /^1[3-9]\d{9}$/.test(u))) return _toastMsg(msg, "账号必须是 6 位数字或 11 位手机号");
        if (!/^\d{6,12}$/.test(p)) return _toastMsg(msg, "密码必须是 6~12 位数字");
        if (!cid) return _toastMsg(msg, "验证码还没加载好，请稍候或点击图片刷新");
        if (!cc) return _toastMsg(msg, "请输入验证码");
        if (cc.length < 3) return _toastMsg(msg, "请输入完整的验证码（4位）");
        if (!window.API || !window.Router) return _toastMsg(msg, "系统初始化失败，请稍后重试");
        try {
          const res = await window.API.login(u, p, cid, cc);
          if (res && res.code === 0) {
            // 登录成功后：清空所有输入（登录3项 + 注册4项 = 共7项），避免保留登录/注册信息
            const emptyAll = ["login-username", "login-password", "login-captcha",
                              "reg-account", "reg-password", "reg-password2", "reg-nickname"];
            emptyAll.forEach((id) => {
              const el = document.getElementById(id);
              if (el) {
                el.value = "";
                try { el.removeAttribute("value"); } catch (_) {}
                try { el.setAttribute("autocomplete", "off"); } catch (_) {}
                try { el.dispatchEvent(new Event("input", { bubbles: true })); } catch (_) {}
                try { el.dispatchEvent(new Event("change", { bubbles: true })); } catch (_) {}
              }
            });
            try {
              const allInputs = document.querySelectorAll(".lp-card-inner input");
              allInputs.forEach((inp) => {
                try { inp.removeAttribute("value"); inp.setAttribute("autocomplete", "off"); } catch (_) {}
                if (inp.type !== "button" && inp.type !== "submit" && inp.type !== "hidden") {
                  inp.value = "";
                }
              });
              const f = document.querySelector(".lp-card-inner form");
              if (f && typeof f.reset === "function") try { f.reset(); } catch (_) {}
            } catch (_) {}
            [document.getElementById("login-msg"), document.getElementById("reg-msg")].forEach((msgEl) => {
              if (!msgEl) return;
              msgEl.textContent = "";
              msgEl.innerText = "";
              msgEl.classList.remove("lp-error","lp-success");
              msgEl.classList.add("lp-error");
              try {
                msgEl.style.color = "";
                msgEl.removeAttribute("style");
              } catch (_) {}
            });
            _afterLogin(res);
          } else {
            // 登录失败：强制刷新验证码 + 清空输入，防止重放
            const err = (res && res.msg) || "登录失败";
            _toastMsg(msg, err);
            captchaInput.value = "";
            refreshCaptcha();
          }
        } catch (err) {
          const errText = (err && (err.message || err.msg)) ? String(err.message || err.msg) : "请稍后重试";
          _toastMsg(msg, "登录失败：" + errText.substring(0, 78));
          captchaInput.value = "";
          refreshCaptcha();
        }
        } finally { _loginSubmitting = false; }
      });
    }
    if (form) {
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        if (btn) btn.click();
      });
    }
    // 验证码输入完毕按回车自动登录
    if (captchaInput) {
      captchaInput.addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
          e.preventDefault();
          if (btn) btn.click();
        }
      });
    }

    // ========== 注册 ==========
    let _regSubmitting = false;
    if (regBtn) {
      regBtn.addEventListener("click", async function () {
        if (_regSubmitting) return;
        _regSubmitting = true;
        try {
        _toastMsg(regMsg, "");
        const no = document.getElementById("reg-account").value.trim();
        const p1 = document.getElementById("reg-password").value.trim();
        const p2 = document.getElementById("reg-password2").value.trim();
        const nick = document.getElementById("reg-nickname").value.trim();
        if (!(/^\d{6}$/.test(no) || /^1[3-9]\d{9}$/.test(no))) return _toastMsg(regMsg, "账号必须是 6 位数字或 11 位手机号");
        if (!/^\d{6,12}$/.test(p1)) return _toastMsg(regMsg, "密码必须是 6~12 位数字");
        if (p1 !== p2) return _toastMsg(regMsg, "两次输入的密码不一致");
        if (!window.API) return _toastMsg(regMsg, "系统初始化失败");
        try {
          const res = await window.API.register(no, p1, nick);
          if (res && res.code === 0) {
            const account = res.data && res.data.account_no ? res.data.account_no : no;
            _toastMsg(regMsg, "注册成功！账号：" + account + "，已为您弹出确认窗口", "success");
            try {
              if (typeof _showRegisterSuccessModal === "function") {
                _showRegisterSuccessModal(no);
              } else {
                setTimeout(() => _afterRegModalClose(no), 2200);
              }
            } catch (_) {
              setTimeout(() => _afterRegModalClose(no), 2200);
            }
          } else {
            _toastMsg(regMsg, (res && res.msg) || "注册失败");
          }
        } catch (e) {
          _toastMsg(regMsg, "注册失败");
        }
        } finally { _regSubmitting = false; }
      });
    }

    // ========== 全局 doLogout ==========
    window.doLogout = async function () {
      try {
        if (window.API && typeof window.API.logout === "function") await window.API.logout();
      } catch (_) {}
      if (window.API && typeof window.API.clear === "function") window.API.clear();
      else {
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem("userInfo");
        localStorage.removeItem("account_app_user");
      }
      if (window.Router && typeof window.Router.go === "function") window.Router.go("#/login");
      else location.hash = "#/login";
    };
    const logoutBtn = document.getElementById("logout-btn");
    if (logoutBtn) logoutBtn.addEventListener("click", () => window.doLogout && window.doLogout());
  });
})();
