// 应用入口:hash 路由 + 侧栏/顶栏外壳 + 数据拉取。视觉遵循 index.html 设计系统。
import { api } from "./api.js";
import { state } from "./state.js";
import { esc, num, toast, openModal, closeModal } from "./ui.js";
import { cycleTheme, syncThemeIcon } from "./theme.js";
import { viewOverview, bindOverview } from "./pages/overview.js";
import { viewAccounts, bindAccountEvents } from "./pages/accounts.js";
import { viewKeys, bindKeyEvents } from "./pages/keys.js";
import { viewQueue, bindQueue } from "./pages/queue.js";
import { viewJobs, bindJobs } from "./pages/jobs.js";
import { viewLogs, bindLogs } from "./pages/logs.js";
import { viewIntent, bindIntentEvents } from "./pages/intent.js";
import { viewSettings, bindSettingsEvents } from "./pages/settings.js";
import { viewAbout, bindAboutEvents } from "./pages/about.js";

export async function refresh(){
  try{
    const [stats, accounts, keys, logs, settings, jobs, bindings, scenarios] = await Promise.all([
      api("/api/stats"), api("/api/accounts"), api("/api/keys"), api("/api/logs?limit=300"),
      api("/api/settings"), api("/api/video-jobs"), api("/api/bindings"),
      api("/api/scenarios").catch(()=>({scenarios:[]}))
    ]);
    state.stats = stats; state.accounts = accounts; state.keys = keys.keys||[];
    state.logs = logs.logs||[]; state.settings = settings;
    state.jobs = jobs.jobs||[]; state.bindings = bindings.bindings||[];
    state.scenarios = scenarios.scenarios||[];
    state.scenarioData = scenarios;
    state.stats.queue = (await api("/api/queue")).queue||[];
    updateSubline();
    render();
  }catch(e){
    if(e.status===401){ renderLogin(false); return; }
    toast(e.message,"bad");
  }
}

const PAGES = {
  overview:  { label:"总览",    icon:"📊", view:viewOverview,  bind:bindOverview },
  accounts:  { label:"账号池",  icon:"👥", view:viewAccounts,  bind:bindAccountEvents },
  keys:      { label:"下游密钥", icon:"🔑", view:viewKeys,     bind:bindKeyEvents },
  queue:     { label:"队列",    icon:"⏳", view:viewQueue,     bind:bindQueue },
  jobs:      { label:"视频任务", icon:"🎬", view:viewJobs,     bind:bindJobs },
  intent:    { label:"意图测试", icon:"🧭", view:viewIntent,   bind:bindIntentEvents },
  logs:      { label:"日志",    icon:"📄", view:viewLogs,      bind:bindLogs },
  settings:  { label:"设置",    icon:"⚙️", view:viewSettings,  bind:bindSettingsEvents },
  about:     { label:"系统",    icon:"ℹ️", view:viewAbout,     bind:bindAboutEvents },
};

function updateSubline(){
  const sub = document.getElementById("subline");
  if(!sub || !state.stats) return;
  const m = state.stats.metrics||{};
  sub.textContent = `账号 ${(state.stats.accounts||[]).length} · 请求 ${num(m.requests_total)} · 429 ${num(m.upstream_429)} · 排队 ${num(m.queued_total)}`;
}

function render(){
  const page = PAGES[state.tab] || PAGES.overview;
  const v = document.getElementById("view");
  v.innerHTML = page.view();
  if(page.bind) page.bind();
  // 导航高亮 + 顶栏面包屑
  document.querySelectorAll(".nav a").forEach(a=>{
    const on = a.getAttribute("href") === "#/"+state.tab;
    a.classList.toggle("on", on);
    if(on) a.setAttribute("aria-current","page"); else a.removeAttribute("aria-current");
  });
  const crumb = document.getElementById("crumb");
  if(crumb) crumb.textContent = page.label;
  document.title = `Agnes Hub · ${page.label}`;
}

function renderShell(){
  document.getElementById("app").innerHTML = `
  <div class="shell">
    <aside class="sidebar" aria-label="主导航">
      <div class="brand">
        <img src="/logo.png" alt="Agnes Hub">
        <div><b>Agnes Hub</b><div class="sub" id="subline">加载中…</div></div>
      </div>
      <nav class="nav">
        <div class="nav-label">监控</div>
        ${["overview","queue","jobs","logs"].map(k=>navLink(k)).join("")}
        <div class="nav-label">资源</div>
        ${["accounts","keys","intent"].map(k=>navLink(k)).join("")}
        <div class="nav-label">管理</div>
        ${["settings","about"].map(k=>navLink(k)).join("")}
      </nav>
      <div class="side-foot">
        <button class="sm icon-btn" id="btnTheme" title="主题：自动 / 暗 / 亮">🌓</button>
        <button class="sm icon-btn" id="btnRefresh" title="刷新数据">⟳</button>
        <button class="sm icon-btn" id="btnPw" title="修改密码">🔒</button>
        <button class="sm icon-btn danger" id="btnLogout" title="退出登录">⏻</button>
      </div>
    </aside>
    <main class="main">
      <header class="topbar">
        <span class="crumb" id="crumb">总览</span>
        <span class="grow"></span>
        <span class="pill ok" title="每秒自动采样运行实况"><span class="dot"></span>实时</span>
        <button class="sm" id="btnRefreshTop">刷新</button>
      </header>
      <div class="content">
        <div id="toast" class="banner hide" role="status" aria-live="polite"></div>
        <div id="mustChange" class="hide"></div>
        <div id="view"></div>
      </div>
    </main>
  </div>`;
  document.getElementById("btnTheme").onclick = cycleTheme;
  document.getElementById("btnRefresh").onclick = ()=>refresh();
  document.getElementById("btnRefreshTop").onclick = ()=>refresh();
  document.getElementById("btnLogout").onclick = async ()=>{ await api("/api/logout",{method:"POST"}); location.reload(); };
  document.getElementById("btnPw").onclick = changePasswordModal;
  syncThemeIcon();
}

function navLink(k){
  const p = PAGES[k];
  return `<a href="#/${k}" title="${p.label}"><span class="ico">${p.icon}</span>${p.label}</a>`;
}

/* 改密：模态表单（替代 prompt()），带长度校验与二次确认 */
function changePasswordModal(){
  openModal(`
  <div class="modal-back" onclick="if(event.target===this)closeModal()">
    <div class="modal" style="max-width:420px">
      <h2>修改管理员密码</h2>
      <div class="modal-sub">改密后所有已登录会话立即失效（包括本会话）。</div>
      <div><label>新密码（至少 6 位）</label><input id="npw1" type="password" autocomplete="new-password"></div>
      <div style="margin-top:10px"><label>确认新密码</label><input id="npw2" type="password" autocomplete="new-password"></div>
      <div class="row" style="margin-top:16px;justify-content:flex-end">
        <button onclick="closeModal()">取消</button>
        <button class="primary" id="btnDoPw">确认修改</button>
      </div>
    </div>
  </div>`);
  const doIt = async ()=>{
    const a=document.getElementById("npw1").value, b=document.getElementById("npw2").value;
    if(a.length<6){ toast("密码至少 6 位","bad"); return; }
    if(a!==b){ toast("两次输入不一致","bad"); return; }
    try{
      await api("/api/password",{method:"POST",body:JSON.stringify({new_password:a})});
      state.session.must_change_password=false; closeModal();
      toast("密码已修改，下次登录使用新密码","good");
    }catch(e){ toast(e.message,"bad"); }
  };
  document.getElementById("btnDoPw").onclick = doIt;
  document.getElementById("npw1").focus();
}

function renderLogin(mustChange){
  document.getElementById("app").innerHTML = `
  <div class="login-wrap">
    <div class="login">
      <div class="card">
        <div class="brand-big">
          <img src="/logo.png" alt="Agnes Hub">
          <div><h1>Agnes Hub</h1><div class="muted" style="font-size:12px">聚合网关 · RPM 排队限流控制台</div></div>
          <span style="flex:1"></span>
          <button class="sm icon-btn" id="btnTheme" title="主题：自动 / 暗 / 亮">🌓</button>
        </div>
        <div id="toast" class="banner hide" role="status" aria-live="polite"></div>
        <label for="pw">管理员密码</label>
        <input id="pw" type="password" placeholder="输入管理员密码" autocomplete="current-password">
        <button class="primary" id="btnLogin" style="width:100%;margin-top:14px;height:38px">登 录</button>
        ${mustChange?`<div class="banner warn" style="margin-top:12px">首次登录，建议先在「🔒」里修改默认密码。</div>`:""}
        <div class="hint">登录状态保持 7 天 · 改密后所有会话立即失效</div>
      </div>
    </div>
  </div>`;
  document.getElementById("btnTheme").onclick = cycleTheme;
  syncThemeIcon();
  const go = async ()=>{
    const btn = document.getElementById("btnLogin");
    btn.disabled = true; btn.textContent = "登录中…";
    try{
      const r = await api("/api/login",{method:"POST",body:JSON.stringify({password:document.getElementById("pw").value})});
      state.session = {logged_in:true, must_change_password:r.must_change_password};
      await boot();
    }catch(e){
      toast(e.message,"bad");
      btn.disabled=false; btn.textContent="登 录";
      document.getElementById("pw").focus(); document.getElementById("pw").select();
    }
  };
  document.getElementById("btnLogin").onclick = go;
  document.getElementById("pw").onkeydown = e=>{ if(e.key==="Enter") go(); };
  document.getElementById("pw").focus();
}

async function boot(){
  if(!state.session || !state.session.logged_in){ renderLogin(false); return; }
  renderShell();
  await refresh();
}

// hash 路由:#/overview ...
function routeFromHash(){
  const h = (location.hash||"").replace(/^#\/?/,"").split("?")[0];
  return PAGES[h] ? h : "overview";
}
window.addEventListener("hashchange", async ()=>{
  const t = routeFromHash();
  if(t !== state.tab){ state.tab = t; render(); }
});

window.__on401 = ()=>{ state.session=null; renderLogin(false); };

window.addEventListener("DOMContentLoaded", async ()=>{
  try{
    const s = await api("/api/session");
    state.session = s;
    state.tab = routeFromHash();
    if(s.logged_in) await boot(); else renderLogin(s.must_change_password);
  }catch(e){ renderLogin(false); }
});
