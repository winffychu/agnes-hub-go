// 队列与粘性绑定页。
import { api } from "../api.js";
import { state } from "../state.js";
import { esc, num, emptyBlock } from "../ui.js";
import { refresh } from "../app.js";

export function viewQueue(){
  const q = state.stats?.queue || [];
  const b = state.bindings||[];
  const qRows = q.map(r=>`<tr><td>${esc(r.account)}</td><td><span class="pill info">${esc(r.pool_class)}</span></td>
    <td class="num">${r.waiting}</td><td class="num">${r.rpm}</td>
    <td class="num">${Math.round(r.projected_wait_ms/100)/10}s
      <div class="bar" style="margin-top:4px;max-width:120px"><i style="width:${Math.min(100, Math.round(r.projected_wait_ms/6000))}%"></i></div></td></tr>`).join("");
  const bRows = b.slice(0,200).map(r=>`<tr><td class="mono" style="font-size:11.5px">${esc(r.session)}</td><td>${esc(r.account)}</td>
    <td class="num" style="font-size:12px">${r.updated?new Date(r.updated*1000).toLocaleString():""}</td></tr>`).join("");
  return `
  <div class="card">
    <div class="card-head"><h2>当前排队<span class="tag">${q.length} 个池</span></h2></div>
    ${q.length? `<div class="tbl-wrap"><table>
      <thead><tr><th>账号</th><th>池</th><th>排队人数</th><th>节拍 RPM</th><th>队尾预计等待</th></tr></thead>
      <tbody>${qRows}</tbody></table></div>`
      : `<div class="banner good" style="margin-bottom:0">✓ 当前没有排队请求 —— 节拍跟得上负载。</div>`}
  </div>
  <div class="card">
    <div class="card-head">
      <h2>粘性绑定<span class="tag">${b.length} 条</span></h2>
      <button class="sm danger" id="btnClearBind">全部清空</button>
    </div>
    <div class="hint" style="margin-bottom:10px">绑定只是「优先候选」：绑定账号拥堵或冷却时会自动改派并更新绑定。</div>
    <div class="tbl-wrap" style="max-height:480px"><table><thead><tr><th>会话</th><th>账号</th><th>更新时间</th></tr></thead>
      <tbody>${bRows||`<tr><td colspan="3">${emptyBlock("🔗","暂无绑定")}</td></tr>`}</tbody></table></div>
  </div>`;
}

export function bindQueue(){
  const b = document.getElementById("btnClearBind");
  if(b) b.onclick = async ()=>{ if(!confirm("清空全部粘性绑定？")) return;
    await api("/api/bindings/clear",{method:"POST"}); await refresh(); };
}
