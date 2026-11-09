// 下游密钥页:签发表单为工具条 + 列表主视图。
import { api } from "../api.js";
import { state } from "../state.js";
import { esc, num, toast, emptyBlock, copyText } from "../ui.js";
import { icon } from "../icons.js";
import { renderCurrent } from "../app.js";

export function viewKeys(){
  const keys = state.keys||[];
  const rows = keys.map(k=>{
    const key = k.Key||k.key;
    return `<tr>
      <td><b>${esc(k.name)}</b><div class="cell-sub">${esc(k.UsedDate||k.used_date||"")}</div></td>
      <td><span class="mono" style="font-size:11.5px">${esc(key)}</span>
        <button class="sm ghost icon-btn" data-copy="${esc(key)}" title="复制">${icon("key",13)}</button></td>
      <td>${(k.Classes||k.classes||[]).map(c=>`<span class="badge">${esc(c)}</span>`).join(" ")||"—"}</td>
      <td class="num">${num(k.UsedToday??k.used_today)} <span class="muted">/</span> ${num(k.DailyQuota??k.daily_quota)||"∞"}</td>
      <td class="num">${num(k.UsedTotal??k.used_total)} <span class="muted">/</span> ${num(k.TotalQuota??k.total_quota)||"∞"}</td>
      <td class="num">${num(k.UsedTokensToday??k.used_tokens_today)}<div class="cell-sub">累计 ${num(k.UsedTokensTotal??k.used_tokens_total)}</div></td>
      <td>${(k.Enabled??k.enabled)?'<span class="badge ok">启用</span>':'<span class="badge off">停用</span>'}</td>
      <td><button class="sm ghost icon-btn danger" data-del="${esc(key)}" title="删除">${icon("trash",13)}</button></td>
    </tr>`;
  }).join("");
  return `
  <div class="toolbar">
    <input id="kName" placeholder="名称 · WorkBuddy / Claude Code" style="max-width:200px">
    <input id="kClasses" value="*" title="允许的池，* = 全部" style="max-width:130px">
    <input id="kDaily" type="number" value="0" title="每日额度，0 = 不限" style="max-width:110px">
    <input id="kTotal" type="number" value="0" title="总额度，0 = 不限" style="max-width:110px">
    <button class="primary" id="btnAddKey">${icon("plus",14)}签发</button>
  </div>
  <div class="card">
    <div class="card-head"><h2>密钥列表</h2><span class="grow"></span><span class="desc">客户端接入：Base URL · /v1，模型 · auto，Key · 此处签发</span></div>
    <div class="tbl-wrap"><table>
      <thead><tr><th>名称</th><th>密钥</th><th>允许池</th><th>今日</th><th>累计</th><th>token</th><th>状态</th><th></th></tr></thead>
      <tbody>${rows||`<tr><td colspan="8">${emptyBlock("key","暂无密钥 · 上方签发第一个下游密钥")}</td></tr>`}</tbody>
    </table></div>
  </div>`;
}

export function bindKeyEvents(){
  const b = document.getElementById("btnAddKey");
  if(b) b.onclick = async ()=>{
    try{
      await api("/api/keys",{method:"POST",body:JSON.stringify({
        name:document.getElementById("kName").value,
        classes:document.getElementById("kClasses").value.split(",").map(s=>s.trim()).filter(Boolean),
        daily_quota:Number(document.getElementById("kDaily").value)||0,
        total_quota:Number(document.getElementById("kTotal").value)||0
      })});
      toast("密钥已签发","good"); renderCurrent();
    }catch(e){ toast(e.message,"bad"); }
  };
  const view = document.getElementById("view");
  view.querySelectorAll("button[data-copy]").forEach(x=>x.onclick=()=>copyText(x.dataset.copy,()=>toast("已复制","good")));
  view.querySelectorAll("button[data-del]").forEach(x=>x.onclick=async ()=>{
    if(!confirm("确认删除该密钥？")) return;
    try{ await api("/api/keys?key="+encodeURIComponent(x.dataset.del),{method:"DELETE"}); renderCurrent(); }
    catch(e){ toast(e.message,"bad"); }
  });
}

/* 按需加载：本页只拉 /api/keys */
export async function loadKeys(){
  state.keys = (await api("/api/keys")).keys||[];
}
