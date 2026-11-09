// 用量日志页(含完整请求弹窗)。
import { state } from "../state.js";
import { esc, num, toast, openModal, closeModal, copyText, emptyBlock } from "../ui.js";

const INTENT_TONE = { text:"", image:"info", video:"warn" };
export function viewLogs(){
  const logs = state.logs||[];
  const rows = logs.map((l,i)=>{
    const raw = l.user_request||"";
    const hasReq = raw.trim()!=="";
    const btn = hasReq ? `<button class="sm" style="white-space:nowrap" onclick="showUserRequest(${i})">查看请求</button>` : `<span class="muted">—</span>`;
    return `<tr>
    <td class="mono" style="font-size:11.5px;white-space:nowrap">${esc(l.ts)}</td>
    <td style="white-space:nowrap">${l.intent?`<span class="pill ${INTENT_TONE[l.intent]||""}">${esc(l.intent)}</span>
      ${l.intent_by?`<div class="cell-sub">${esc(l.intent_by)}</div>`:""}`:""}</td>
    <td style="white-space:nowrap">${esc(l.model_used||l.model||"")}</td>
    <td>${l.pool_class?`<span class="pill">${esc(l.pool_class)}</span>`:""}</td>
    <td>${esc(l.account||"")}</td>
    <td class="num" style="white-space:nowrap">${l.wait_ms!=null?Math.round(l.wait_ms)+"ms":""}</td>
    <td>${esc(l.phase||"")}</td>
    <td>${btn}</td></tr>`;}).join("");
  return `<div class="card">
    <div class="card-head"><h2>用量日志<span class="tag">${logs.length} 条</span></h2>
      <span class="desc">含意图判定依据与完整请求原文</span></div>
    <div class="tbl-wrap" style="max-height:640px"><table>
      <thead><tr><th>时间</th><th>意图</th><th>模型</th><th>池</th><th>账号</th><th>等待</th><th>阶段</th><th>用户请求</th></tr></thead>
      <tbody>${rows||`<tr><td colspan="8">${emptyBlock("📄","暂无日志")}</td></tr>`}</tbody></table></div></div>`;
}

export function showUserRequest(i){
  const l = (state.logs||[])[i];
  if(!l) return;
  const raw = l.user_request||"";
  const truncated = /…\(truncated\)$/.test(raw);
  const meta = [
    ["时间", l.ts], ["端点", l.endpoint], ["池", l.pool_class], ["意图", l.intent],
    ["意图判定", l.intent_by], ["模型(请求/实际)", `${l.model_requested||"-"} / ${l.model_used||"-"}`],
    ["账号", l.account], ["等待", l.wait_ms!=null?Math.round(l.wait_ms)+"ms":"-"],
    ["阶段", l.phase], ["stream", l.stream],
  ].filter(x=>x[1]!=null && x[1]!=="").map(x=>`<div class="kv"><span class="kk">${esc(x[0])}</span> <span class="mono">${esc(String(x[1]))}</span></div>`).join("");
  const html = `
    <div class="modal-back" onclick="if(event.target===this)closeModal()">
      <div class="modal reqbox">
        <div class="card-head"><h2>用户提出的完整请求</h2>
          <button class="sm icon-btn" onclick="closeModal()">✕</button></div>
        ${truncated?`<div class="banner warn">⚠ 该字段在落盘时已被截断到上限（仅保留前 N 字节），完整原文未持久化；以下为已保留部分。</div>`:""}
        <div class="row" style="margin-bottom:8px">
          <button class="sm" onclick="copyUserRequest(${i})">复制全文</button>
          <span class="muted" style="font-size:12px">${(raw.length/1024).toFixed(1)} KB</span>
        </div>
        <pre>${esc(raw)||"（该记录无 user_request 字段）"}</pre>
        <div class="hmeta">${meta}</div>
      </div>
    </div>`;
  openModal(html);
}
window.showUserRequest = showUserRequest;

function copyUserRequest(i){
  const l = (state.logs||[])[i]; if(!l) return;
  const raw = l.user_request||"";
  copyText(raw, ()=>toast("已复制完整请求到剪贴板","good"));
}
window.copyUserRequest = copyUserRequest;

export function bindLogs(){}
