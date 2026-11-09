// 系统页(版本自更新+运行环境)。
import { api } from "../api.js";
import { state } from "../state.js";
import { esc, num, toast, kpiCard } from "../ui.js";

export function viewAbout(){
  return `
  <div class="card">
    <div class="card-head"><h2>版本与自更新</h2>
      <a class="muted" style="font-size:12px" target="_blank" rel="noopener noreferrer"
         href="https://github.com/winffychu/agnes-hub-go/releases">查看全部版本 ↗</a></div>
    <div class="hint" style="margin-bottom:12px">程序定时向本项目 GitHub Releases 查询新版本；更新包只从本仓库 release 下载，并做尺寸与可执行文件魔数校验，防止把错误页当成新版本换上。</div>
    <div class="grid g4" id="updKpi"></div>
    <div id="updBox" style="margin-top:12px"></div>
    <div class="row" style="margin-top:12px">
      <button id="btnChk">检查更新</button>
      <button class="primary" id="btnApply">立即更新</button>
    </div>
  </div>
  <div class="card">
    <div class="card-head"><h2>运行环境</h2></div>
    <div class="grid g4" id="envKpi"></div>
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
      kpiCard({icon:"⏱",tone:"violet",label:"已运行",value:esc(uptimeText)})+
      kpiCard({icon:"⚡",tone:"",label:"请求总数",value:num(m.requests_total)})+
      kpiCard({icon:"🛡",tone:ulsTone(m.upstream_429),label:"上游 429",value:num(m.upstream_429)})+
      kpiCard({icon:"👥",tone:"cyan",label:"账号数",value:num((s.accounts||[]).length)});
  };
  const ulsTone = n => Number(n)>0 ? "good" : "";

  const paint = (s, err)=>{
    const cur = s.current_version || "—";
    const last = s.last_check || {};
    const avail = !!last.is_update_available;
    kpi.innerHTML =
      kpiCard({icon:"📦",tone:"",label:"当前版本",value:esc(cur)})+
      kpiCard({icon:"🆕",tone:avail?"warn":"good",label:"最新版本",value:esc(last.latest_version || "—")})+
      kpiCard({icon:avail?"⬆":"✓",tone:avail?"warn":"good",label:"更新状态",
        value:`<span style="font-size:14px;font-family:inherit">${avail?'有可用更新':'已是最新'}</span>`})+
      kpiCard({icon:"🗓",tone:"",label:"发布时间",value:`<span style="font-size:14px;font-family:inherit">${esc(last.release_date || "—")}</span>`});

    if(err || last.error){
      box.innerHTML = `<div class="banner warn">${esc(err || last.error)}</div>`;
      return;
    }
    if(!avail){
      box.innerHTML = `<div class="banner good" style="margin-bottom:0">✓ 当前已是最新版本，无需更新。</div>`;
      return;
    }
    const notes = (last.changelog||"").trim();
    box.innerHTML = `<div class="banner warn">
        发现新版本 <b>${esc(last.latest_version)}</b>（当前 ${esc(cur)}）。点「立即更新」会下载对应平台的二进制并替换，随后程序自动退出并重启。
      </div>
      ${notes? `<pre class="scroll" style="background:var(--panel-2);border:1px solid var(--line);
        border-radius:10px;padding:12px;margin:0;color:var(--ink)">${esc(notes)}</pre>`:""}`;
  };

  const load = async ()=>{
    try{ paint(await api("/api/update/status")); }
    catch(e){ box.innerHTML = `<div class="banner warn">${esc(e.message)}</div>`; }
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
