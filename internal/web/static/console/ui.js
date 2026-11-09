// 共享 UI 工具（toast/复制/弹窗/转义/数字格式化/KPI/空态）。
import { icon } from "./icons.js";
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
/* KPI 卡片：极简数值卡。tone 只染数值（tgood/twarn/tbad），不再有图标彩块。
   icon 参数兼容旧调用（被忽略），逐步迁移后移除。 */
export function kpiCard({tone="", label="", value="", unit="", note=""}){
  const cls = tone==="good"||tone==="ok" ? "tgood" : tone==="warn" ? "twarn" : (tone==="bad"||tone==="off") ? "tbad" : "";
  return `<div class="kpi ${cls}">
    <div class="k">${esc(label)}</div>
    <div class="v">${value}${unit?`<small>${esc(unit)}</small>`:""}</div>
    ${note?`<div class="note">${esc(note)}</div>`:""}
  </div>`;
}
/* 空态：SVG 图标 + 一行提示 */
export function emptyBlock(name, text){
  return `<div class="empty">${icon(name||"info",20)}<div style="margin-top:8px">${esc(text)}</div></div>`;
}
/* 状态徽章：仅状态语义（ok/off/warn/info），普通标签不带 tone */
export function badge(tone, text, title){
  return `<span class="badge ${tone||""}"${title?` title="${esc(title)}"`:""}>${text}</span>`;
}
