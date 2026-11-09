// 共享 UI 工具（toast/复制/弹窗/转义/数字格式化）。
// close: 全局暴露给内联 onclick 使用。
export function esc(s){ return String(s==null?"":s).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
export function num(n){ return Number(n||0).toLocaleString("en-US"); }
export function toast(msg, kind){ const el=document.getElementById("toast"); if(!el) return;
  el.className = "banner "+(kind||"good"); el.textContent = msg; el.classList.remove("hide");
  clearTimeout(el._t); el._t=setTimeout(()=>el.classList.add("hide"), 4200); }
export function openModal(html){
  let r = document.getElementById("modalRoot");
  if(!r){ r = document.createElement("div"); r.id="modalRoot"; document.body.appendChild(r); }
  r.innerHTML = html;
  window.closeModal = closeModal;
}
export function closeModal(){ const r = document.getElementById("modalRoot"); if(r) r.innerHTML = ""; }
window.closeModal = closeModal;
export function copyText(text, onDone){
  const done=ok=>{ if(onDone) onDone(ok); };
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(String(text)).then(()=>done(true),
      ()=>fallbackCopy(String(text),done));
  } else fallbackCopy(String(text),done);
}
function fallbackCopy(text,done){
  const ta=document.createElement("textarea");
  ta.value=text; ta.style.position="fixed"; ta.style.left="-9999px";
  document.body.appendChild(ta); ta.select();
  let ok=false; try{ ok=document.execCommand("copy"); }catch(e){ ok=false; }
  document.body.removeChild(ta);
  done(ok); if(!ok && location && location.hostname!=="localhost"){ toast("复制失败，请手动全选 pre 内文本","bad"); }
}
/* KPI 卡片模板：图标 + 语义色 + 值 + 标签 + 可选注释。供各页复用，保证观感一致。 */
export function kpiCard({icon="", tone="", label="", value="", unit="", note=""}){
  return `<div class="kpi ${tone}">
    ${icon?`<div class="ico">${icon}</div>`:""}
    <div style="min-width:0">
      <div class="k">${esc(label)}</div>
      <div class="v">${value}${unit?`<small>${esc(unit)}</small>`:""}</div>
      ${note?`<div class="note">${esc(note)}</div>`:""}
    </div>
  </div>`;
}
/* 空态模板 */
export function emptyBlock(icon, text){
  return `<div class="empty"><span class="ico">${icon}</span>${esc(text)}</div>`;
}
