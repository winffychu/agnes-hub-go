// 应用入口:hash 路由 + 外壳 + 按页按需加载。
// 性能原则：每个页面只拉自己需要的接口；动作后局部刷新（不整页重绘）；顶部细进度条反馈。
import { api } from "./api.js";
import { state } from "./state.js";
import { num, toast, openModal, closeModal } from "./ui.js";
import { cycleTheme, syncThemeIcon } from "./theme.js";
import { icon } from "./icons.js";
import { viewOverview, bindOverview, loadOverview } from "./pages/overview.js";
import { viewAccounts, bindAccountEvents, loadAccounts } from "./pages/accounts.js";
import { viewKeys, bindKeyEvents, loadKeys } from "./pages/keys.js";
import { viewQueue, bindQueue, loadQueue } from "./pages/queue.js";
import { viewJobs, bindJobs, loadJobs } from "./pages/jobs.js";
import { viewLogs, bindLogs, loadLogs } from "./pages/logs.js";
import { viewIntent, bindIntentEvents, loadIntent } from "./pages/intent.js";
import { viewSettings, bindSettingsEvents, loadSettings } from "./pages/settings.js";
import { viewAbout, bindAboutEvents, loadAbout } from "./pages/about.js";

/* ---------------- 加载指示（细进度条，非阻塞） ---------------- */
let barEl = null, barTimer = null;
function progress(on){
  if(!barEl){ barEl = document.createElement("div"); barEl.className = "loadbar"; document.body.appendChild(barEl); }
  if(on){
    clearTimeout(barTimer); barEl.className = "loadbar on";
    barTimer = setTimeout(()=>{ barEl.className = "loadbar done"; }, 8000);
  } else {
    clearTimeout(barTimer); barEl.className = "loadbar done";
    setTimeout(()=>{ if(barEl.className==="loadbar done") barEl.className = "loadbar"; }, 320);
  }
}

/* ---------------- 页面注册表：每页自带 loader ---------------- */
const PAGES = {
  overview:  { label:"总览",     icon:"activity",  view:viewOverview,  bind:bindOverview,  load:loadOverview },
  queue:     { label:"队列",     icon:"hourglass", view:viewQueue,     bind:bindQueue,     load:loadQueue },
  jobs:      { label:"视频任务", icon:"film",      view:viewJobs,      bind:bindJobs,      load:loadJobs },
  logs:      { label:"日志",     icon:"file",      view:viewLogs,      bind:bindLogs,      load:loadLogs },
  accounts:  { label:"账号池",   icon:"users",     view:viewAccounts,  bind:bindAccountEvents, load:loadAccounts },
  keys:      { label:"下游密钥", icon:"key",       view:viewKeys,      bind:bindKeyEvents, load:loadKeys },
  intent:    { label:"意图测试", icon:"compass",   view:viewIntent,    bind:bindIntentEvents, load:loadIntent },
  settings:  { label:"设置",     icon:"settings",  view:viewSettings,  bind:bindSettingsEvents, load:loadSettings },
  about:     { label:"系统",     icon:"info",      view:viewAbout,     bind:bindAboutEvents, load:loadAbout },
};
const GROUPS = [
  ["监控", ["overview","queue","jobs","logs"]],
  ["资源", ["accounts","keys","intent"]],
  ["管理", ["settings","about"]],
];

/* 页面首次进入才拉数据；之后每次进入刷新当前页数据（不碰其它页） */
export async function go(tab, opts={}){
  const page = PAGES[tab] || PAGES.overview;
  const changed = state.tab !== tab;
  state.tab = tab;
  const v = document.getElementById("view");
  const firstPaint = changed || !v || v.innerHTML.trim()==="";
  if(firstPaint){
    // 立即渲染骨架（不阻塞），再拉数据。
    paint(page);
  }
  await loadPage(page);
  if(firstPaint) paint(page);   // 数据到位后只重绘本页
}

export async function loadPage(page){
  if(!page.load) return;
  progress(true);
  try{ await page.load(); }
  catch(e){
    if(e.status === 401){ renderLogin(false); return; }
    toast(e.message,"bad");
  } finally { progress(false); }
}

/* 当前页动作后刷新：重拉本页数据再重绘（只碰当前页的接口，不整页全刷） */
export async function renderCurrent(){
  const page = PAGES[state.tab]||PAGES.overview;
  await loadPage(page);
  paint(page);
}

function paint(page){
  const v = document.getElementById("view");
  if(!v) return;
  v.innerHTML = page.view();
  if(page.bind) page.bind();
  document.querySelectorAll(".nav a").forEach(a=>{
    const on = a.dataset.tab === state.tab;
    a.classList.toggle("on", on);
    if(on) a.setAttribute("aria-current","page"); else a.removeAttribute("aria-current");
  });
  const crumb = document.getElementById("crumb");
  if(crumb) crumb.textContent = page.label;
  document.title = `Agnes Hub · ${page.label}`;
  syncSubline();
}

function syncSubline(){
  const el = document.getElementById("subline");
  if(!el || !state.overviewStats) return;
  const s = state.overviewStats, m = s.metrics||{};
  el.textContent = `账号 ${(s.accounts||[]).length} · 429 ${num(m.upstream_429)}`;
}

function renderShell(){
  document.getElementById("app").innerHTML = `
  <div class="shell">
    <aside class="sidebar" aria-label="主导航">
      <div class="brand">
        <img src="/logo.png" alt="">
        <div><b>Agnes Hub</b><div class="sub" id="subline">—</div></div>
      </div>
      <nav class="nav">
        ${GROUPS.map(([g, keys])=>keys.map(k=>`
          <a href="#/${k}" data-tab="${k}">${icon(PAGES[k].icon)}${PAGES[k].label}</a>`).join("")).join("")}
      </nav>
      <div class="side-foot">
        <button class="icon-btn" id="btnTheme" title="切换主题">${icon("monitor")}</button>
        <button class="icon-btn" id="btnPw" title="修改密码">${icon("lock")}</button>
        <button class="icon-btn danger" id="btnLogout" title="退出">${icon("logout")}</button>
      </div>
    </aside>
    <main class="main">
      <header class="topbar">
        <span class="crumb" id="crumb">总览</span>
        <span class="grow"></span>
        <button class="sm" id="btnRefresh">${icon("refresh",14)}刷新</button>
      </header>
      <div class="content">
        <div id="toast" class="banner hide" role="status" aria-live="polite"></div>
        <div id="view"></div>
      </div>
    </main>
  </div>`;
  document.getElementById("btnTheme").onclick = ()=>{ cycleTheme(); };
  document.getElementById("btnRefresh").onclick = ()=>loadPage(PAGES[state.tab]||PAGES.overview);
  document.getElementById("btnLogout").onclick = async ()=>{ await api("/api/logout",{method:"POST"}); location.reload(); };
  document.getElementById("btnPw").onclick = changePasswordModal;
  syncThemeIcon();
}

function changePasswordModal(){
  openModal(`
  <div class="modal-back" data-close="1">
    <div class="modal" style="max-width:380px">
      <h2>修改密码</h2>
      <div class="modal-sub">改密后所有会话立即失效</div>
      <div><label>新密码（至少 6 位）</label><input id="npw1" type="password" autocomplete="new-password"></div>
      <div style="margin-top:10px"><label>确认新密码</label><input id="npw2" type="password" autocomplete="new-password"></div>
      <div class="row" style="margin-top:16px;display:flex;justify-content:flex-end;gap:8px">
        <button data-close="1">取消</button>
        <button class="primary" id="btnDoPw">确认修改</button>
      </div>
    </div>
  </div>`);
  document.getElementById("btnDoPw").onclick = async ()=>{
    const a=document.getElementById("npw1").value, b=document.getElementById("npw2").value;
    if(a.length<6){ toast("密码至少 6 位","bad"); return; }
    if(a!==b){ toast("两次输入不一致","bad"); return; }
    try{
      await api("/api/password",{method:"POST",body:JSON.stringify({new_password:a})});
      state.session && (state.session.must_change_password=false); closeModal();
      toast("密码已修改","good");
    }catch(e){ toast(e.message,"bad"); }
  };
  document.getElementById("npw1").focus();
}

function renderLogin(mustChange){
  document.getElementById("app").innerHTML = `
  <div class="login-wrap">
    <div class="login">
      <div class="card">
        <div style="display:flex;align-items:center;gap:9px;margin-bottom:16px">
          <img src="/logo.png" alt="" style="width:26px;height:26px;border-radius:6px">
          <div><h1>Agnes Hub</h1><div class="tagline" style="margin:0">聚合网关控制台</div></div>
          <span style="flex:1"></span>
          <button class="ghost icon-btn" id="btnTheme" title="切换主题">${icon("monitor")}</button>
        </div>
        <div id="toast" class="banner hide" role="status" aria-live="polite"></div>
        <label for="pw">管理员密码</label>
        <input id="pw" type="password" placeholder="输入密码" autocomplete="current-password">
        <button class="primary" id="btnLogin" style="width:100%;margin-top:12px;height:36px;justify-content:center">登录</button>
        ${mustChange?`<div class="banner warn" style="margin:12px 0 0">当前为默认密码，建议先修改</div>`:""}
        <div class="foot">登录状态保持 7 天</div>
      </div>
    </div>
  </div>`;
  document.getElementById("btnTheme").onclick = cycleTheme;
  syncThemeIcon();
  const goLogin = async ()=>{
    const btn = document.getElementById("btnLogin");
    btn.disabled = true; btn.textContent = "登录中…";
    try{
      const r = await api("/api/login",{method:"POST",body:JSON.stringify({password:document.getElementById("pw").value})});
      state.session = {logged_in:true, must_change_password:r.must_change_password};
      await boot();
    }catch(e){
      toast(e.message,"bad");
      btn.disabled=false; btn.textContent="登录";
      document.getElementById("pw").select();
    }
  };
  document.getElementById("btnLogin").onclick = goLogin;
  document.getElementById("pw").onkeydown = e=>{ if(e.key==="Enter") goLogin(); };
  document.getElementById("pw").focus();
}

async function boot(){
  if(!state.session || !state.session.logged_in){ renderLogin(false); return; }
  renderShell();
  // 不预置 state.tab：go() 依据 state.tab!==tab 判定首绘，提前赋值会跳过 paint
  await go(routeFromHash());
}

function routeFromHash(){
  const h = (location.hash||"").replace(/^#\/?/,"").split("?")[0];
  return PAGES[h] ? h : "overview";
}
window.addEventListener("hashchange", ()=>{ go(routeFromHash()); });
window.__on401 = ()=>{ state.session=null; renderLogin(false); };

window.addEventListener("DOMContentLoaded", async ()=>{
  try{
    const s = await api("/api/session");
    state.session = s;
    if(s.logged_in) await boot(); else renderLogin(s.must_change_password);
  }catch(e){ renderLogin(false); }
});
