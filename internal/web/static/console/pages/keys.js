// 下游密钥页。
import { api } from "../api.js";
import { state } from "../state.js";
import { esc, num, toast } from "../ui.js";
import { refresh } from "../app.js";

export function viewKeys(){
  const rows = (state.keys||[]).map(k=>`
    <tr>
      <td><b>${esc(k.name)}</b><div class="muted" style="font-size:11px">${esc(k.UsedDate||k.used_date||"")}</div></td>
      <td><span class="mono" style="font-size:11px">${esc(k.Key||k.key)}</span></td>
      <td>${esc((k.Classes||k.classes||[]).join(", "))}</td>
      <td class="mono">${num(k.UsedToday??k.used_today)} / ${num(k.DailyQuota??k.daily_quota)||"∞"}</td>
      <td class="mono">${num(k.UsedTotal??k.used_total)} / ${num(k.TotalQuota??k.total_quota)||"∞"}</td>
      <td class="mono" title="今日 token / 累计 token">${num(k.UsedTokensToday??k.used_tokens_today)} / ${num(k.UsedTokensTotal??k.used_tokens_total)}</td>
      <td>${(k.Enabled??k.enabled)?'<span class="pill ok">启用</span>':'<span class="pill off">停用</span>'}</td>
      <td><button class="sm danger" data-del="${esc(k.Key||k.key)}">删除</button></td>
    </tr>`).join("");
  return `
  <div class="card">
    <h2>新建下游密钥</h2>
    <div class="row">
      <div style="flex:2"><label>名称</label><input id="kName" placeholder="WorkBuddy / Claude Code"></div>
      <div style="flex:1"><label>允许的池（逗号分隔，* 表示全部）</label><input id="kClasses" value="*"></div>
      <div style="flex:1"><label>每日额度（0=不限）</label><input id="kDaily" type="number" value="0"></div>
      <div style="flex:1"><label>总额度（0=不限）</label><input id="kTotal" type="number" value="0"></div>
      <div style="align-self:flex-end"><button class="primary" id="btnAddKey">签发</button></div>
    </div>
    <div class="hint">客户端把 Base URL 指向 <span class="mono">http://127.0.0.1:4142/v1</span>，模型填 <span class="mono">auto</span>，Key 填这里签发的值。</div>
  </div>
  <div class="card">
    <h2>密钥列表</h2>
    <div class="scroll"><table>
      <thead><tr><th>名称</th><th>密钥</th><th>允许池</th><th>今日</th><th>累计</th><th>token</th><th>状态</th><th></th></tr></thead>
      <tbody>${rows||'<tr><td colspan="8" class="muted">暂无密钥</td></tr>'}</tbody>
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
  document.getElementById("view").querySelectorAll("button[data-del]").forEach(x=>x.onclick=async ()=>{
    if(!confirm("确认删除该密钥？")) return;
    try{ await api("/api/keys?key="+encodeURIComponent(x.dataset.del),{method:"DELETE"}); await refresh(); }
    catch(e){ toast(e.message,"bad"); }
  });
}

