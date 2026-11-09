// 共享 UI 工具（toast/复制/弹窗/转义/数字格式化/KPI/空态/错误态）。
// 弹窗关闭走 document 级一次性事件委托：任何带 data-close 的元素点击即关、Escape 即关。
import { icon } from "./icons.js";
export function esc(s){ return String(s==null?"":s).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
export function num(n){ return Number(n||0).toLocaleString("en-US"); }
export function toast(msg, kind){ const el=document.getElementById("toast"); if(!el) return;
  el.className = "banner "+(kind||"good"); el.textContent = msg; el.classList.remove("hide");
  clearTimeout(el._t); el._t=setTimeout(()=>el.classList.add("hide"), 4200); }
export function openModal(html, opts={}){
  let r = document.getElementById("modalRoot");
  if(!r){ r = document.createElement("div"); r.id="modalRoot"; document.body.appendChild(r); }
  r.innerHTML = html;
  window.closeModal = closeModal;
  // 自动聚焦第一个 input/select/textarea（modal 标记 data-nofocus 可跳过）
  if(!opts.noFocus){
    const f = r.querySelector(".modal input:not([type=hidden]), .modal select, .modal textarea");
    if(f) setTimeout(()=>f.focus(), 30);
  }
  return r;
}
export function closeModal(){ const r = document.getElementById("modalRoot"); if(r) r.innerHTML = ""; }
window.closeModal = closeModal;

/* 模态关闭通路（绑一次，对所有弹窗生效）：
   1) 点击任何 [data-close] 元素（背景 / 取消按钮 / X 图标）
   2) Escape 键
   3) 点击 .modal-back 自身（未命中内部元素时） */
(function bindModalCloseOnce(){
  if(window.__modalCloseBound) return;
  window.__modalCloseBound = true;
  document.addEventListener("click", (ev)=>{
    const root = document.getElementById("modalRoot");
    if(!root || !root.firstElementChild) return;
    if(ev.target.closest("[data-close]")){ ev.preventDefault(); closeModal(); return; }
    // 点背景：目标是 .modal-back 本体（不是内部内容）
    if(ev.target.classList && ev.target.classList.contains("modal-back")) closeModal();
  });
  document.addEventListener("keydown", (ev)=>{
    if(ev.key!=="Escape") return;
    const root = document.getElementById("modalRoot");
    if(root && root.firstElementChild) closeModal();
  });
})();

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
/* KPI 卡片：极简数值卡。tone 只染数值（tgood/twarn/tbad），不再有图标彩块。 */
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
/* 错误态：内联错误卡 + 重试按钮（load 失败时替代 toast 吞错，QA 决议） */
export function errorBlock(msg, retryFn){
  return `<div class="card"><div style="padding:20px;text-align:center">
    <div style="color:var(--bad);margin-bottom:6px;display:flex;justify-content:center">${icon("alert",22)}</div>
    <div style="font-size:13px;color:var(--ink-2);margin-bottom:4px">加载失败</div>
    <div class="muted" style="font-size:12px;margin-bottom:14px">${esc(msg||"未知错误")}</div>
    <button class="sm" id="__retryLoad">重试</button>
  </div></div>`;
}
/* 给 errorBlock 的重试按钮绑事件（渲染后调用） */
export function bindErrorRetry(retryFn){
  const b = document.getElementById("__retryLoad");
  if(b) b.onclick = retryFn;
}
/* 状态徽章：仅状态语义（ok/off/warn/info），普通标签不带 tone */
export function badge(tone, text, title){
  return `<span class="badge ${tone||""}"${title?` title="${esc(title)}"`:""}>${text}</span>`;
}
/* 行内字段错误：给 input 加红框 + 下方错误文案；clearFieldError 还原 */
export function setFieldError(id, msg){
  const el = document.getElementById(id);
  if(!el) return;
  el.style.borderColor = "var(--bad)";
  let tip = document.getElementById(id+"_err");
  if(!tip){ tip = document.createElement("div"); tip.id = id+"_err"; tip.className = "hint";
    tip.style.color = "var(--bad)"; el.insertAdjacentElement("afterend", tip); }
  tip.textContent = msg;
}
export function clearFieldErrors(root){
  (root||document).querySelectorAll("input,select,textarea").forEach(el=>{ el.style.borderColor=""; });
  (root||document).querySelectorAll("[id$=_err]").forEach(el=>el.remove());
}
