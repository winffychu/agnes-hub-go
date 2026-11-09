// 下游密钥页:签发表单精简为工具条 + 连接信息卡;列表主视图。
import { api } from "../api.js";
import { state } from "../state.js";
import { esc, num, toast, emptyBlock, copyText } from "../ui.js";
import { refresh } from "../app.js";

export function viewKeys(){
  const rows = (state.keys||[]).map(k=>{
    const key = k.Key||k.key;
    return `<tr>
      <td><b>${esc(k.name)}</b><div class="cell-sub">${esc(k.UsedDate||k.used_date||"")}</div></td>
      <td><span class="mono" style="font-size:11.5px">${esc(key)}</span>
        <button class="sm icon-btn" data-copy="${esc(key)}" title="复制">⧉</button></td>
      <td>${(k.Classes||k.classes||[]).map(c=>`<span class="pill">${esc(c)}</span>`).join(" ")||"—"}</td>
      <td class="num">${num(k.UsedToday??k.used_today)} <span class="muted">/</span> ${num(k.DailyQuota??k.daily_quota)||"∞"}</td>
      <td class="num">${num(k.UsedTotal??k.used_total)} <span class="muted">/</span> ${num(k.TotalQuota??k.total_quota)||"∞"}</td>
      <td class="num" title="今日 token / 累计 token">${num(k.UsedTokensToday??k.used_tokens_today)}<div class="cell-sub">累计 ${num(k.UsedTokensTotal??k.used_tokens_total)}</div></td>
      <td>${(k.Enabled??k.enabled)?'<span class="pill ok">启用</span>':'<span class="pill off">停用</span>'}</td>
      <td><button class="sm danger" data-del="${esc(key)}">删除</button></td>
    </tr>`;
  }).join("");
  return `
  <div class="card">
    <div class="card-head"><h2>新建下游密钥</h2></div>
    <div class="row" style="align-items:flex-end">
      <div style="flex:2;min-width:160px"><label>名称</label><input id="kName" placeholder="WorkBuddy / Claude Code"></div>
      <div style="flex:1;min-width:130px"><label>允许的池（* = 全部）</label><input id="kClasses" value="*"></div>
      <div style="flex:1;min-width:110px"><label>每日额度</label><input id="kDaily" type="number" value="0" title="0 = 不限"></div>
      <div style="flex:1;min-width:110px"><label>总额度</label><input id="kTotal" type="number" value="0" title="0 = 不限"></div>
      <button class="primary" id="btnAddKey">签发</button>
    </div>
    <div class="hint" style="margin-top:10px;padding:10px 12px;background:var(--panel-2);border-radius:8px;line-height:1.7">
      客户端接入三件套：Base URL 填 <span class="mono">http://127.0.0.1:4142/v1</span> · 模型填 <span class="mono">auto</span>（网关自动判定模态）· Key 填这里签发的值
    </div>
  </div>
  <div class="card">
    <div class="card-head"><h2>密钥列表<span class="tag">${(state.keys||[]).length} 个</span></h2></div>
    <div class="tbl-wrap"><table>
      <thead><tr><th>名称</th><th>密钥</th><th>允许池</th><th>今日</th><th>累计</th><th>token</th><th>状态</th><th></th></tr></thead>
      <tbody>${rows||`<tr><td colspan="8">${emptyBlock("🔑","暂无密钥 · 上方签发第一个下游密钥")}</td></tr>`}</tbody>
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
      toast("密钥已签发","good"); await refresh();
    }catch(e){ toast(e.message,"bad"); }
  };
  const view = document.getElementById("view");
  view.querySelectorAll("button[data-copy]").forEach(x=>x.onclick=()=>copyText(x.dataset.copy,()=>toast("已复制","good")));
  view.querySelectorAll("button[data-del]").forEach(x=>x.onclick=async ()=>{
    if(!confirm("确认删除该密钥？")) return;
    try{ await api("/api/keys?key="+encodeURIComponent(x.dataset.del),{method:"DELETE"}); await refresh(); }
    catch(e){ toast(e.message,"bad"); }
  });
}
