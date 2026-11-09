// 队列与粘性绑定页。清空绑定走 confirmModal（带条数明细）。
import { api } from "../api.js";
import { state } from "../state.js";
import { esc, emptyBlock, toast, confirmModal } from "../ui.js";
import { renderCurrent } from "../app.js";

export function viewQueue(){
  const q = state.queue||[];
  const b = state.bindings||[];
  const qRows = q.map(r=>`<tr><td>${esc(r.account)}</td><td><span class="badge info">${esc(r.pool_class)}</span></td>
    <td class="num">${r.waiting}</td><td class="num">${r.rpm}</td>
    <td class="num">${Math.round(r.projected_wait_ms/100)/10}s
      <div class="bar" style="margin-top:4px;max-width:120px"><i style="width:${Math.min(100, Math.round(r.projected_wait_ms/6000))}%"></i></div></td></tr>`).join("");
  const bRows = b.slice(0,200).map(r=>`<tr><td class="mono" style="font-size:11.5px">${esc(r.session)}</td><td>${esc(r.account)}</td>
    <td class="num" style="font-size:12px">${r.updated?new Date(r.updated*1000).toLocaleString():""}</td></tr>`).join("");
  return `
  <div class="card">
    <div class="card-head"><h2>当前排队</h2><span class="grow"></span><span class="count">${q.length} 个池</span></div>
    ${q.length? `<div class="tbl-wrap"><table>
      <thead><tr><th>账号</th><th>池</th><th>排队人数</th><th>节拍 RPM</th><th>队尾预计等待</th></tr></thead>
      <tbody>${qRows}</tbody></table></div>`
      : `<div class="banner good" style="margin:12px 16px 4px">当前没有排队请求 —— 节拍跟得上负载。</div>`}
  </div>
  <div class="card">
    <div class="card-head"><h2>粘性绑定</h2><span class="count">${b.length} 条</span><span class="grow"></span>
      <button class="sm danger" id="btnClearBind">全部清空</button></div>
    <div class="tbl-wrap" style="max-height:480px"><table><thead><tr><th>会话</th><th>账号</th><th>更新时间</th></tr></thead>
      <tbody>${bRows||`<tr><td colspan="3">${emptyBlock("shuffle","暂无绑定")}</td></tr>`}</tbody></table></div>
  </div>`;
}

export function bindQueue(){
  const b = document.getElementById("btnClearBind");
  if(b) b.onclick = async ()=>{
    const n = (state.bindings||[]).length;
    const ok = await confirmModal({
      title:"清空全部粘性绑定",
      message:`将删除 ${n} 条会话→账号绑定，后续请求按负载重新分配（可能短暂失去会话亲和）.`,
      confirmText:`清空 ${n} 条`,
      danger:true,
    });
    if(!ok) return;
    try{ await api("/api/bindings/clear",{method:"POST"}); renderCurrent(); }
    catch(e){ toast(e.message,"bad"); }
  };
}

/* 按需加载：本页拉 /api/queue + /api/bindings */
export async function loadQueue(){
  const [q, b] = await Promise.all([api("/api/queue"), api("/api/bindings")]);
  state.queue = q.queue||[];
  state.bindings = b.bindings||[];
}
