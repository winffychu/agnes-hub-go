// 应用入口:URL hash 路由 + 侧栏导航外壳 + 数据拉取。
import { api } from "./api.js";
import { state } from "./state.js";
import { esc, num, toast } from "./ui.js";
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
    const m = stats.metrics||{};
    const sub = document.getElementById("subline");
    if(sub) sub.textContent =
      `账号 ${(stats.accounts||[]).length} · 请求 ${num(m.requests_total)} · 上游 429 ${num(m.upstream_429)} · 排队 ${num(m.queued_total)}`;
    render();
  }catch(e){
    if(e.status===401){ renderLogin(false); return; }
    toast(e.message,"bad");
  }
}

const PAGES = {
  overview:  { label:"总览",   view:viewOverview,  bind:bindOverview },
  accounts:  { label:"账号池", view:viewAccounts,  bind:bindAccountEvents },
  keys:      { label:"下游密钥", view:viewKeys,    bind:bindKeyEvents },
  queue:     { label:"队列",   view:viewQueue,     bind:bindQueue },
  jobs:      { label:"视频任务", view:viewJobs,    bind:bindJobs },
  intent:    { label:"意图测试", view:viewIntent,  bind:bindIntentEvents },
  logs:      { label:"日志",   view:viewLogs,      bind:bindLogs },
  settings:  { label:"设置",   view:viewSettings,  bind:bindSettingsEvents },
  about:     { label:"系统",   view:viewAbout,     bind:bindAboutEvents },
};

function render(){
  const page = PAGES[state.tab] || PAGES.overview;
  const v = document.getElementById("view");
  v.innerHTML = page.view();
  if(page.bind) page.bind();
  // 导航高亮
  document.querySelectorAll(".nav a").forEach(a=>{
    const on = a.getAttribute("href") === "#/"+state.tab;
    a.classList.toggle("on", on);
    if(on) a.setAttribute("aria-current","page"); else a.removeAttribute("aria-current");
  });
  document.title = `Agnes Hub · ${page.label}`;
}

function renderShell(){
  document.getElementById("app").innerHTML = `
  <div class="shell">
    <aside class="sidebar" aria-label="主导航">
      <div class="brand"><img src="/logo.png" alt="Agnes Hub" width="26" height="26">
        <div><b>Agnes Hub</b><div class="muted" style="font-size:11px" id="subline">加载中…</div></div></div>
      <nav class="nav">
        ${Object.entries(PAGES).map(([k,p])=>`<a href="#/${k}">${p.label}</a>`).join("")}
      </nav>
      <div class="side-foot">
        <button class="sm" id="btnTheme" onclick="cycleTheme()" title="主题：自动/暗/亮">🌓</button>
        <button class="sm" id="btnRefresh">刷新</button>
        <button class="sm" id="btnPw">改密</button>
        <button class="sm danger" id="btnLogout">退出</button>
      </div>
    </aside>
    <main class="main">
      <div id="toast" class="banner hide" role="status" aria-live="polite"></div>
      <div id="mustChange" class="hide"></div>
      <div id="view"></div>
    </main>
  </div>`;
  window.cycleTheme = cycleTheme; // 内联 onclick 需要
  document.getElementById("btnRefresh").onclick = ()=>refresh();
  document.getElementById("btnLogout").onclick = async ()=>{ await api("/api/logout",{method:"POST"}); location.reload(); };
  document.getElementById("btnPw").onclick = changePassword;
  syncThemeIcon();
}

async function changePassword(){
  const a = prompt("输入新密码（至少 6 位）"); if(!a) return;
  const b = prompt("再输入一次确认"); if(a!==b){ alert("两次输入不一致"); return; }
  try{ await api("/api/password",{method:"POST",body:JSON.stringify({new_password:a})});
    state.session.must_change_password=false; toast("密码已修改","good"); }
  catch(e){ alert(e.message); }
}

function renderLogin(mustChange){
  document.getElementById("app").innerHTML = `
  <div class="login">
    <div class="card">
      <div class="spread">
        <h1>Agnes Hub 控制台</h1>
        <button class="sm" id="btnTheme" onclick="cycleTheme()" title="主题：自动/暗/亮">🌓</button>
      </div>
      <p class="muted">Agnes Hub 聚合网关 · RPM 排队限流</p>
      <div id="toast" class="banner hide" role="status" aria-live="polite"></div>
      <label for="pw">管理员密码</label>
      <input id="pw" type="password" placeholder="请输入管理员密码" autocomplete="current-password">
      <div class="row" style="margin-top:12px">
        <button class="primary" id="btnLogin">登录</button>
        ${mustChange?`<span class="pill warn">首次登录请改密</span>`:""}
      </div>
      <div class="hint">登录状态保持 7 天；改密后所有会话立即失效。</div>
    </div>
  </div>`;
  window.cycleTheme = cycleTheme;
  syncThemeIcon();
  const go = async ()=>{
    try{
      const r = await api("/api/login",{method:"POST",body:JSON.stringify({password:document.getElementById("pw").value})});
      state.session = {logged_in:true, must_change_password:r.must_change_password};
      await boot();
    }catch(e){ toast(e.message,"bad"); }
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
