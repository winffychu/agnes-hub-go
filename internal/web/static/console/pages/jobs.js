// 视频任务页。
import { state } from "../state.js";
import { esc } from "../ui.js";

export function viewJobs(){
  const rows = (state.jobs||[]).map(j=>`<tr>
    <td class="mono" style="font-size:11px">${esc(j.job_id)}</td>
    <td class="mono" style="font-size:11px">${esc(j.video_id)}</td>
    <td>${esc(j.model)}</td>
    <td class="mono" style="font-size:11px">${esc(j.account_id)}</td>
    <td><span class="pill info">${esc(j.status)}</span></td>
    <td class="mono">${j.created_at?new Date(j.created_at*1000).toLocaleString():""}</td></tr>`).join("");
  return `<div class="card"><h2>视频任务（下游 job_id → 上游 video_id）</h2>
    <div class="muted" style="margin-bottom:8px">客户端只认 job_id，上游语义（video_id / model_name）由网关维护，从根上避免「轮询用错字段」导致的卡住。</div>
    <div class="scroll"><table><thead><tr><th>job_id</th><th>video_id</th><th>模型</th><th>承载账号</th><th>状态</th><th>创建时间</th></tr></thead>
      <tbody>${rows||'<tr><td colspan="6" class="muted">暂无任务</td></tr>'}</tbody></table></div></div>`;
}

export function bindJobs(){}
