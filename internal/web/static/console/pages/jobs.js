// 视频任务页。
import { state } from "../state.js";
import { esc, emptyBlock } from "../ui.js";

const STATUS_TONE = {
  completed:"ok", succeeded:"ok", done:"ok",
  failed:"off", error:"off", cancelled:"off",
  processing:"info", running:"info", pending:"info", queued:"info",
  expired:"warn"
};
export function viewJobs(){
  const rows = (state.jobs||[]).map(j=>`<tr>
    <td class="mono" style="font-size:11.5px">${esc(j.job_id)}</td>
    <td class="mono" style="font-size:11.5px">${esc(j.video_id)}</td>
    <td>${esc(j.model)}</td>
    <td class="mono" style="font-size:11.5px">${esc(j.account_id)}</td>
    <td><span class="pill ${STATUS_TONE[(j.status||"").toLowerCase()]||""}">${esc(j.status)}</span></td>
    <td class="num" style="font-size:12px">${j.created_at?new Date(j.created_at*1000).toLocaleString():""}</td></tr>`).join("");
  return `<div class="card">
    <div class="card-head"><h2>视频任务<span class="tag">${(state.jobs||[]).length} 条</span></h2>
      <span class="desc">下游 job_id → 上游 video_id 映射</span></div>
    <div class="hint" style="margin-bottom:10px">客户端只认 job_id，上游语义（video_id / model_name）由网关维护，从根上避免「轮询用错字段」导致的卡住。</div>
    <div class="tbl-wrap"><table>
      <thead><tr><th>job_id</th><th>video_id</th><th>模型</th><th>承载账号</th><th>状态</th><th>创建时间</th></tr></thead>
      <tbody>${rows||`<tr><td colspan="6">${emptyBlock("🎬","暂无视频任务")}</td></tr>`}</tbody></table></div></div>`;
}

export function bindJobs(){}
