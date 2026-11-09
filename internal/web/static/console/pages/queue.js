// 队列与粘性绑定页。
import { api } from "../api.js";
import { state } from "../state.js";
import { esc, num, toast } from "../ui.js";
import { refresh } from "../app.js";

export function viewQueue(){
  const q = state.stats?.queue || [];
  const b = state.bindings||[];
  return `
  <div class="card"><h2>当前排队</h2>
    ${q.length? `<table><thead><tr><th>账号</th><th>池</th><th>排队人数</th><th>节拍 RPM</th><th>队尾预计等待</th></tr></thead>
      <tbody>${q.map(r=>`<tr><td>${esc(r.account)}</td><td><span class="pill">${esc(r.pool_class)}</span></td>
        <td class="mono">${r.waiting}</td><td class="mono">${r.rpm}</td><td class="mono">${Math.round(r.projected_wait_ms/100)/10}s</td></tr>`).join("")}</tbody></table>`
      : `<div class="banner good">当前没有排队请求 —— 节拍跟得上负载。</div>`}
  </div>
  <div class="card">
    <div class="spread"><h2>粘性绑定（${b.length}）</h2><button class="sm danger" id="btnClearBind">全部清空</button></div>
    <div class="muted" style="margin-bottom:8px">绑定只是「优先候选」：绑定账号拥堵或冷却时会自动改派并更新绑定。</div>
    <div class="scroll"><table><thead><tr><th>会话</th><th>账号</th><th>更新时间</th></tr></thead>
      <tbody>${b.slice(0,200).map(r=>`<tr><td class="mono" style="font-size:11px">${esc(r.session)}</td><td>${esc(r.account)}</td>
        <td class="mono">${r.updated?new Date(r.updated*1000).toLocaleString():""}</td></tr>`).join("")||'<tr><td colspan="3" class="muted">暂无绑定</td></tr>'}</tbody></table></div>
  </div>`;
}

export function bindQueue(){
  const b = document.getElementById("btnClearBind");
  if(b) b.onclick = async ()=>{ if(!confirm("清空全部粘性绑定？")) return;
    await api("/api/bindings/clear",{method:"POST"}); await refresh(); };
}
