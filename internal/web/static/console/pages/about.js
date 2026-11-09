// 系统页(版本自更新+运行环境)。about 无页面快照：更新状态在 bind 时拉一次。
import { api } from "../api.js";
import { state } from "../state.js";
import { esc, num, toast, kpiCard } from "../ui.js";
import { icon } from "../icons.js";

export function viewAbout(){
  return `
  <div class="card">
    <div class="card-head"><h2>版本与自更新</h2><span class="grow"></span>
      <a class="muted" style="font-size:12px;display:inline-flex;align-items:center;gap:4px" target="_blank" rel="noopener noreferrer"
         href="https://github.com/winffychu/agnes-hub-go/releases">全部版本 ${icon("external",12)}</a></div>
    <div style="padding:14px 16px">
    <div class="grid g4" id="updKpi"></div>
    <div id="updBox" style="margin-top:12px"></div>
    <div class="row" style="margin-top:12px">
      <button id="btnChk">检查更新</button>
      <button class="primary" id="btnApply">立即更新</button>
    </div>
    </div>
  </div>
  <div class="card">
    <div class="card-head"><h2>运行环境</h2></div>
    <div style="padding:14px 16px"><div class="grid g4" id="envKpi"></div></div>
  </div>`;
}

export function bindAboutEvents(){
  const kpi = document.getElementById("updKpi");
  const box = document.getElementById("updBox");
  const envK = document.getElementById("envKpi");

  const paintEnv = ()=>{
    const s = state.stats || {}, m = s.metrics || {};
    const up = Number(m.uptime_sec||0);
    const d = Math.floor(up/86400), h = Math.floor(up%86400/3600), mi = Math.floor(up%3600/60);
    const uptimeText = `${d?d+"天 ":""}${h}小时${mi}分`;
    envK.innerHTML =
      kpiCard({label:"已运行",value:esc(uptimeText)})+
      kpiCard({label:"请求总数",value:num(m.requests_total)})+
      kpiCard({tone:"good",label:"上游 429",value:num(m.upstream_429)})+
      kpiCard({label:"账号数",value:num((s.accounts||[]).length)});
  };

  const paint = (s, err)=>{
    const cur = s.current_version || "—";
    const last = s.last_check || {};
    const avail = !!last.is_update_available;
    kpi.innerHTML =
      kpiCard({label:"当前版本",value:esc(cur)})+
      kpiCard({tone:avail?"warn":"good",label:"最新版本",value:esc(last.latest_version || "—")})+
      kpiCard({tone:avail?"warn":"good",label:"更新状态",
        value:`<span style="font-size:14px;font-family:inherit">${avail?'有可用更新':'已是最新'}</span>`})+
      kpiCard({label:"发布时间",value:`<span style="font-size:14px;font-family:inherit">${esc(last.release_date || "—")}</span>`});

    if(err || last.error){ box.innerHTML = `<div class="banner warn">${esc(err || last.error)}</div>`; return; }
    if(!avail){ box.innerHTML = `<div class="banner good" style="margin-bottom:0">当前已是最新版本。</div>`; return; }
    const notes = (last.changelog||"").trim();
    box.innerHTML = `<div class="banner warn">
        发现新版本 <b>${esc(last.latest_version)}</b>（当前 ${esc(cur)}）。更新会下载对应平台二进制并替换，随后程序自动重启。
      </div>
      ${notes? `<pre class="scroll" style="background:var(--panel-2);border:1px solid var(--line);
        border-radius:10px;padding:12px;margin:0;color:var(--ink)">${esc(notes)}</pre>`:""}`;
  };

  document.getElementById("btnChk").onclick = async (ev)=>{
    const b = ev.currentTarget; b.disabled = true; b.textContent = "检查中…";
    try{ paint(await api("/api/update/check")); toast("已检查更新","good"); }
    catch(e){ toast(e.message,"bad"); }
    finally{ b.disabled = false; b.textContent = "检查更新"; }
  };

  document.getElementById("btnApply").onclick = async (ev)=>{
    const b = ev.currentTarget;
    if(!confirm("确认下载并更新到最新版本？\n更新完成后程序会自动重启。")) return;
    b.disabled = true; b.textContent = "更新中…";
    try{
      const r = await api("/api/update/apply",{method:"POST"});
      if(r.success){
        toast("更新已就位，程序即将重启","good");
        box.innerHTML = `<div class="banner good">已更新到 <b>${esc(r.new_version)}</b>，
          程序正在退出以便替换二进制，稍后会自动重启。</div>`;
      }else{
        toast(r.error||"更新失败","bad");
        box.innerHTML = `<div class="banner warn">更新失败：${esc(r.error||"未知原因")}</div>`;
      }
    }catch(e){ toast(e.message,"bad"); }
    finally{ b.disabled = false; b.textContent = "立即更新"; }
  };

  paintEnv();
  api("/api/update/status").then(s=>paint(s)).catch(e=>{ box.innerHTML = `<div class="banner warn">${esc(e.message)}</div>`; });
}

/* 按需加载：本页拉 /api/stats 供运行环境卡用 */
export async function loadAbout(){
  try{ state.stats = await api("/api/stats"); }catch(e){ state.stats = state.stats||{}; }
}
