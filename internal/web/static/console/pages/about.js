// 系统页(版本自更新+运行环境)。
import { api } from "../api.js";
import { state } from "../state.js";
import { esc, num, toast } from "../ui.js";

export function viewAbout(){
  return `
  <div class="card">
    <h2>版本与自更新</h2>
    <div class="muted" style="margin-bottom:12px">
      程序会定时向本项目的 GitHub Releases 查询新版本，也可以在这里手动检查、立即更新。
      更新包只从本仓库的 release 下载，并做尺寸与可执行文件魔数校验，
      防止把一页错误信息当成新版本换上。
    </div>
    <div class="grid g4" id="updKpi"></div>
    <div id="updBox" style="margin-top:12px"></div>
    <div class="row" style="margin-top:12px">
      <button class="sm" id="btnChk">检查更新</button>
      <button class="sm primary" id="btnApply">立即更新</button>
      <a class="muted" style="font-size:12px" target="_blank" rel="noopener noreferrer"
         href="https://github.com/winffychu/agnes-hub-go/releases">查看全部版本 ↗</a>
    </div>
  </div>
  <div class="card">
    <h2>运行环境</h2>
    <div class="mono muted" style="font-size:12px" id="envBox">加载中…</div>
  </div>`;
}


export function bindAboutEvents(){
  const kpi = document.getElementById("updKpi");
  const box = document.getElementById("updBox");
  const env = document.getElementById("envBox");

  const paintEnv = ()=>{
    const s = state.stats || {}, m = s.metrics || {};
    const up = Number(m.uptime_sec||0);
    const d = Math.floor(up/86400), h = Math.floor(up%86400/3600), mi = Math.floor(up%3600/60);
    env.textContent = `已运行 ${d?d+"天 ":""}${h}小时${mi}分 · 请求总数 ${num(m.requests_total)}`
      + ` · 上游 429 ${num(m.upstream_429)} · 排队 ${num(m.queued_total)}`
      + ` · 账号 ${(s.accounts||[]).length} 个`;
  };

  const paint = (s, err)=>{
    const cur = s.current_version || "—";
    const last = s.last_check || {};
    const avail = !!last.is_update_available;
    kpi.innerHTML = `
      <div class="kpi"><div class="k">当前版本</div><div class="v">${esc(cur)}</div></div>
      <div class="kpi"><div class="k">最新版本</div><div class="v">${esc(last.latest_version || "—")}</div></div>
      <div class="kpi"><div class="k">更新状态</div><div class="v" style="font-size:15px">
        ${avail ? '<span class="pill warn">有可用更新</span>'
                : '<span class="pill ok">已是最新</span>'}</div></div>
      <div class="kpi"><div class="k">发布时间</div><div class="v" style="font-size:15px">${esc(last.release_date || "—")}</div></div>`;

    if(err || last.error){
      box.innerHTML = `<div class="banner warn">${esc(err || last.error)}</div>`;
      return;
    }
    if(!avail){
      box.innerHTML = `<div class="banner good">当前已是最新版本，无需更新。</div>`;
      return;
    }
    const notes = (last.changelog||"").trim();
    box.innerHTML = `<div class="banner warn">
        发现新版本 <b>${esc(last.latest_version)}</b>（当前 ${esc(cur)}）。
        点「立即更新」会下载对应平台的二进制并替换，随后程序自动退出并重启。
      </div>
      ${notes? `<pre class="scroll" style="background:#fafbfc;border:1px solid var(--line);
        border-radius:10px;padding:12px;margin:0">${esc(notes)}</pre>`:""}`;
  };

  const load = async ()=>{
    try{ paint(await api("/api/update/status")); }
    catch(e){ kpi.innerHTML = `<div class="kpi"><div class="k">错误</div><div class="v">—</div></div>`;
              box.innerHTML = `<div class="banner warn">${esc(e.message)}</div>`; }
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
          程序正在退出以便替换二进制，稍后会自动重启。若未自动重启，请手动重新启动一次。</div>`;
      }else{
        toast(r.error||"更新失败","bad");
        box.innerHTML = `<div class="banner warn">更新失败：${esc(r.error||"未知原因")}</div>`;
      }
    }catch(e){ toast(e.message,"bad"); }
    finally{ b.disabled = false; b.textContent = "立即更新"; }
  };

  paintEnv();
  load();
}

