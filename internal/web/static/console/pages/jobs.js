// 视频任务页:job_id → video_id 映射表。
import { api } from "../api.js";
import { state } from "../state.js";
import { esc, emptyBlock } from "../ui.js";
import { icon } from "../icons.js";
import { renderCurrent } from "../app.js";

const STATUS_TONE = {
  completed:"ok", succeeded:"ok", done:"ok",
  failed:"off", error:"off", cancelled:"off",
  processing:"info", running:"info", pending:"info", queued:"info",
  expired:"warn"
};
export function viewJobs(){
  const jobs = state.jobs||[];
  const rows = jobs.map(j=>`<tr>
    <td class="mono" style="font-size:11.5px">${esc(j.job_id)}</td>
    <td class="mono" style="font-size:11.5px">${esc(j.video_id)}</td>
    <td>${esc(j.model)}</td>
    <td class="mono" style="font-size:11.5px">${esc(j.account_id)}</td>
    <td><span class="badge ${STATUS_TONE[(j.status||"").toLowerCase()]||""}">${esc(j.status)}</span></td>
    <td class="num" style="font-size:12px">${j.created_at?new Date(j.created_at*1000).toLocaleString():""}</td>
    <td><button class="sm ghost icon-btn danger" data-del="${esc(j.job_id)}" title="删除记录">${icon("trash",13)}</button></td></tr>`).join("");
  return `<div class="card">
    <div class="card-head"><h2>视频任务</h2><span class="grow"></span>
      <span class="count">${jobs.length} 条</span>
      <button class="sm danger" id="btnClearJobs">清空记录</button></div>
    <div class="tbl-wrap"><table>
      <thead><tr><th>job_id</th><th>video_id</th><th>模型</th><th>承载账号</th><th>状态</th><th>创建时间</th><th></th></tr></thead>
      <tbody>${rows||`<tr><td colspan="7">${emptyBlock("film","暂无视频任务")}</td></tr>`}</tbody></table></div></div>`;
}

export function bindJobs(){
  const view = document.getElementById("view");
  view.querySelectorAll("button[data-del]").forEach(x=>x.onclick=async ()=>{
    try{ await api("/api/video-jobs/"+encodeURIComponent(x.dataset.del),{method:"DELETE"}); renderCurrent(); }
    catch(e){ alert(e.message); }
  });
  const c = document.getElementById("btnClearJobs");
  if(c) c.onclick = async ()=>{
    if(!confirm("清空全部视频任务记录？")) return;
    try{ await api("/api/video-jobs/clear",{method:"POST"}); renderCurrent(); }
    catch(e){ alert(e.message); }
  };
}

/* 按需加载：本页只拉 /api/video-jobs */
export async function loadJobs(){
  state.jobs = (await api("/api/video-jobs")).jobs||[];
}
