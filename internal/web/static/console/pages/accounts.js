// 账号池页:添加/批量导入/分组批量改/列表/编辑弹窗/测试。
import { api } from "../api.js";
import { state, POOLS, MODALITIES, TYPES, DEFAULT_BASE_BY_TYPE } from "../state.js";
import { esc, num, toast, openModal, closeModal } from "../ui.js";
import { refresh } from "../app.js";

function manifestEditor(id, manifest){
  const m = manifest || {};
  return MODALITIES.map(mod=>`
    <div>
      <label>${mod} 模型（逗号分隔；<b>留空 = 明示不支持该模态</b>）</label>
      <input id="${id}_${mod}" value="${esc((m[mod]||[]).join(", "))}" placeholder="例如 default-model, default-model">
    </div>`).join("");
}

export function viewAccounts(){
  const data = state.accounts || {accounts:[]};
  const rows = (data.accounts||[]).map(a=>{
    const eff = a.rpm_effective||{}, base = a.rpm_base||{};
    const rpm = POOLS.filter(p=>(base[p]||0)>0).map(p=>{
      const b = base[p], e = eff[p];
      return `<span class="pill ${e<b?"warn":""}" title="标称 ${b} → 校准后 ${e}">${p} ${e}</span>`;
    }).join(" ");
    return `<tr>
      <td><b>${esc(a.name)}</b>
        <div class="muted" style="font-size:11px">${esc(a.group||"—")} · ${esc(a.access_type)} · <span class="mono">${esc(a.api_key_masked)}</span></div>
        <div class="muted" style="font-size:11px" title="${esc(a.base_url)}">${esc(a.base_url)}</div>
        <div class="muted mono" style="font-size:11px">text: ${esc((a.model_manifest?.text||[]).join(", ")||"（不支持）")}</div>
        <div class="muted mono" style="font-size:11px">image: ${esc((a.model_manifest?.image||[]).join(", ")||"（不支持）")}</div>
        <div class="muted mono" style="font-size:11px">video: ${esc((a.model_manifest?.video||[]).join(", ")||"（不支持）")}</div>
      </td>
      <td>${a.enabled?'<span class="pill ok">启用</span>':'<span class="pill off">停用</span>'}
        ${a.penalty_remaining_ms>0?`<span class="pill warn">冷却</span>`:""}
        ${a.stats?.rate_limited?`<span class="pill warn">限流 ${a.stats.rate_limited}</span>`:""}</td>
      <td style="min-width:220px">${rpm}</td>
      <td class="row" style="gap:4px">
        <button class="sm" data-act="test" data-id="${esc(a.id)}">测试</button>
        <button class="sm" data-act="toggle" data-id="${esc(a.id)}" data-on="${a.enabled?1:0}">${a.enabled?"停用":"启用"}</button>
        <button class="sm" data-act="edit" data-id="${esc(a.id)}">编辑</button>
        <button class="sm" data-act="factors" data-id="${esc(a.id)}">复位校准</button>
        <button class="sm danger" data-act="del" data-id="${esc(a.id)}">删除</button>
      </td>
    </tr>`;
  }).join("");
  return `
  <div class="grid g2">
    <div class="card">
      <h2>添加账号</h2>
      <div class="grid">
        <div><label>名称</label><input id="aName" placeholder="agnes-1"></div>
        <div><label>API Key</label><input id="aKey" placeholder="sk-..."></div>
        <div><label>Base URL（留空按类型自动套用）</label><input id="aBase" placeholder="https://api.api.example.cn/v1"></div>
        <div class="row">
          <div style="flex:1"><label>账号类型</label>
            <select id="aType">${TYPES.map(t=>`<option>${t}</option>`).join("")}</select></div>
          <div style="flex:1"><label>分组（可选）</label><input id="aGroup" placeholder="cn-free"></div>
          <div style="flex:1"><label>单账号并发</label><input id="aConc" type="number" value="8" min="1"></div>
          <div style="flex:1"><label>兜底模型（可选）</label><input id="aDefaultModel" placeholder="留空=auto"></div>
          <div style="flex:1"><label>优先级（数字越大越优先，默认 0）</label><input id="aPriority" type="number" value="0" min="0"></div>
        </div>
        <details style="margin-top:8px">
          <summary>各池 RPM 覆盖（留空 = 按类型档位表）</summary>
          <div class="row" style="margin-top:8px">
            ${POOLS.map(p=>`<div style="flex:1"><label>${p}</label><input id="aRPM_${p}" type="number" min="0" placeholder="按档位"></div>`).join("")}
          </div>
          <div class="hint">AMD / OpenRouter 等自定义渠道的官方速率未知，默认套用保守值；实测可承受更高就在这里上调，网关会按你设的值排队。</div>
        </details>
        ${manifestEditor("aMf", (data.default_manifest)||{})}
        <div class="hint">留空的模态会被视为「该账号不支持」，调度时自动跳过 —— 这正是「多账号按模态分工」的开关。</div>
        <div><button class="primary" id="btnAddAcc">添加账号</button></div>
      </div>
    </div>
    <div class="card">
      <h2>批量导入</h2>
      <label>每行一个账号：<span class="mono">名称,key[,base_url[,access_type[,group]]]</span>，以 # 开头的行会被忽略</label>
      <textarea id="bulkText" placeholder="agnes-1,sk-xxxx,https://api.example.cn/v1,free,cn
agnes-2,sk-yyyy,https://api.example.cn/v1,free,cn"></textarea>
      <div class="row" style="margin-top:10px">
        <button class="primary" id="btnBulk">批量导入</button>
        <span class="muted">逐行校验，失败的行会单独回报原因</span>
      </div>
      <div id="bulkResult" style="margin-top:10px"></div>
      <hr style="border:none;border-top:1px solid var(--line);margin:14px 0">
      <h2>按分组批量改配置</h2>
      <div class="row">
        <div style="flex:1"><label>分组名（留空 = 全部账号）</label><input id="bulkGroup" placeholder="cn-free"></div>
        <div style="flex:1"><label>操作</label><select id="bulkOp">
          <option value="enable">全部启用</option><option value="disable">全部停用</option>
        </select></div>
        <div style="align-self:flex-end"><button id="btnBulkUpdate">执行</button></div>
      </div>
    </div>
  </div>
  <div class="card">
    <div class="spread"><h2>账号列表（${(data.accounts||[]).length}）</h2>
      <div class="muted">标称 RPM 来自官方档位表；「校准后」是吃 429 反馈自适应后的实际节拍</div></div>
    <div class="scroll"><table>
      <thead><tr><th>账号 / 模型清单</th><th>状态</th><th>各池有效 RPM</th><th>操作</th></tr></thead>
      <tbody>${rows||'<tr><td colspan="4" class="muted">暂无账号</td></tr>'}</tbody>
    </table></div>
  </div>`;
}

export function bindAccountEvents(){
  const view = document.getElementById("view");
  const add = document.getElementById("btnAddAcc");
  const typeSel = document.getElementById("aType");
  if(typeSel) typeSel.onchange = ()=>{
    const baseEl = document.getElementById("aBase");
    if(baseEl && baseEl.value.trim()==="") baseEl.placeholder = "留空将自动套用：" + (DEFAULT_BASE_BY_TYPE[typeSel.value]||"");
  };
  if(add) add.onclick = async ()=>{
    const manifest = {}; MODALITIES.forEach(m=>manifest[m] = document.getElementById("aMf_"+m).value.split(",").map(s=>s.trim()).filter(Boolean));
    const rpm = {}; POOLS.forEach(p=>{ const v=document.getElementById("aRPM_"+p).value.trim(); if(v!=="") rpm[p]=Number(v); });
    try{
      await api("/api/accounts",{method:"POST",body:JSON.stringify({
        name:document.getElementById("aName").value, api_key:document.getElementById("aKey").value,
        base_url:document.getElementById("aBase").value, access_type:document.getElementById("aType").value,
        group:document.getElementById("aGroup").value, max_concurrency:Number(document.getElementById("aConc").value)||8,
        priority:Number(document.getElementById("aPriority").value)||0,
        default_model:document.getElementById("aDefaultModel").value,
        model_manifest:manifest, rpm_overrides:rpm
      })});
      toast("账号已添加","good"); await refresh();
    }catch(e){ toast(e.message,"bad"); }
  };
  const bulk = document.getElementById("btnBulk");
  if(bulk) bulk.onclick = async ()=>{
    try{
      const r = await api("/api/accounts/bulk",{method:"POST",body:JSON.stringify({text:document.getElementById("bulkText").value})});
      const f = (r.failed||[]).map(x=>`<div class="banner bad">第 ${x.line} 行：${esc(x.reason)}<br><span class="mono">${esc(x.text)}</span></div>`).join("");
      document.getElementById("bulkResult").innerHTML =
        `<div class="banner good">成功导入 ${r.added_count} 个账号</div>${f}`;
      await refresh();
    }catch(e){ toast(e.message,"bad"); }
  };
  const bu = document.getElementById("btnBulkUpdate");
  if(bu) bu.onclick = async ()=>{
    const op = document.getElementById("bulkOp").value;
    try{
      const r = await api("/api/accounts/bulk-update",{method:"POST",body:JSON.stringify({
        group:document.getElementById("bulkGroup").value.trim(), enabled: op==="enable"
      })});
      toast(`已更新 ${r.updated} / ${r.matched} 个账号`,"good"); await refresh();
    }catch(e){ toast(e.message,"bad"); }
  };
  view.querySelectorAll("button[data-act]").forEach(b=>b.onclick=()=>accountAction(b.dataset.act,b.dataset.id,b.dataset.on));
}

function editAccountModal(acc){
  const id = acc.id;
  const rpm = acc.rpm_overrides || {};
  const mf = acc.model_manifest || {};
  const html = `
  <div class="modal-back" onclick="if(event.target===this)closeModal()">
    <div class="modal">
      <div class="spread"><h2>编辑账号 · ${esc(acc.name)}</h2>
        <button class="sm" onclick="closeModal()">✕</button></div>
      <div class="grid">
        <div><label>名称</label><input id="eName" value="${esc(acc.name)}"></div>
        <div><label>API Key（留空 = 保留原 Key）</label><input id="eKey" placeholder="留空保留原 Key"></div>
        <div><label>Base URL（留空按类型自动套用）</label><input id="eBase" value="${esc(acc.base_url)}"></div>
        <div class="row">
          <div style="flex:1"><label>账号类型</label>
            <select id="eType">${TYPES.map(t=>`<option value="${t}" ${t===acc.access_type?"selected":""}>${t}</option>`).join("")}</select></div>
          <div style="flex:1"><label>分组</label><input id="eGroup" value="${esc(acc.group||"")}"></div>
          <div style="flex:1"><label>单账号并发</label><input id="eConc" type="number" value="${acc.max_concurrency||8}" min="1"></div>
          <div style="flex:1"><label>优先级（越大越优先）</label><input id="ePriority" type="number" value="${acc.priority||0}" min="0"></div>
        </div>
        <div><label>兜底模型（可选）</label><input id="eDefaultModel" value="${esc(acc.default_model||"")}" placeholder="留空=auto"></div>
        ${manifestEditor("eMf", mf)}
        <details open><summary>各池 RPM 覆盖（留空 = 按类型档位表）</summary>
          <div class="row" style="margin-top:8px">
            ${POOLS.map(p=>`<div style="flex:1"><label>${p}</label><input id="eRPM_${p}" type="number" min="0" value="${rpm[p]||""}" placeholder="按档位"></div>`).join("")}
          </div>
          <div class="hint">AMD / OpenRouter 等自定义渠道的官方速率未知，默认套用保守值；实测可承受更高就在这里上调。</div>
        </details>
        <div class="row" style="margin-top:12px">
          <button class="primary" id="btnSaveAcc">保存</button>
          <button onclick="closeModal()">取消</button>
        </div>
      </div>
    </div>
  </div>`;
  openModal(html);
  const eType = document.getElementById("eType");
  eType.onchange = ()=>{
    const baseEl = document.getElementById("eBase");
    if(baseEl && baseEl.value.trim()==="") baseEl.placeholder = "留空将自动套用：" + (DEFAULT_BASE_BY_TYPE[eType.value]||"");
  };
  document.getElementById("btnSaveAcc").onclick = async ()=>{
    try{
      const manifest = {}; MODALITIES.forEach(m=>manifest[m]=document.getElementById("eMf_"+m).value.split(",").map(s=>s.trim()).filter(Boolean));
      const rpmOv = {}; POOLS.forEach(p=>{ const v=document.getElementById("eRPM_"+p).value.trim(); if(v!=="") rpmOv[p]=Number(v); });
      const body = {
        name:document.getElementById("eName").value, base_url:document.getElementById("eBase").value,
        access_type:document.getElementById("eType").value, group:document.getElementById("eGroup").value,
        max_concurrency:Number(document.getElementById("eConc").value)||8,
        priority:Number(document.getElementById("ePriority").value)||0,
        default_model:document.getElementById("eDefaultModel").value, model_manifest:manifest, rpm_overrides:rpmOv
      };
      const k = document.getElementById("eKey").value.trim(); if(k!=="") body.api_key = k;
      await api("/api/accounts/"+id,{method:"PATCH",body:JSON.stringify(body)});
      toast("已保存","good"); closeModal(); await refresh();
    }catch(e){ toast(e.message,"bad"); }
  };
}

async function accountAction(act,id,on){
  try{
    if(act==="test"){
      toast("正在测试…（会向上游发一个最小请求）","warn");
      const r = await api("/api/accounts/"+id+"/test",{method:"POST"});
      const drift = (r.drift||[]).map(d=>`<div class="banner warn">${esc(d.modality)} 的 <span class="mono">${esc(d.model)}</span>：${esc(d.issue)}</div>`).join("");
      document.getElementById("view").insertAdjacentHTML("afterbegin",
        `<div class="card"><div class="spread"><h2>测试结果</h2><button class="sm" onclick="this.closest('.card').remove()">关闭</button></div>
          <div class="banner ${r.ok?"good":"bad"}">HTTP ${r.status} · ${r.latency_ms}ms · ${esc(r.hint)}</div>
          ${drift}
          ${r.models&&r.models.length?`<details open><summary>上游真实可用模型（${r.models.length}）</summary>
            <div class="mono" style="margin-top:8px;font-size:12px">${esc(r.models.join(", "))}</div></details>`:""}
          ${r.body?`<details><summary>响应体</summary><pre class="mono">${esc(r.body)}</pre></details>`:""}
        </div>`);
      return;
    }
    if(act==="toggle"){ await api("/api/accounts/"+id,{method:"PATCH",body:JSON.stringify({enabled:on!=="1"})}); }
    if(act==="factors"){ await api("/api/accounts/"+id+"/reset-factors",{method:"POST"}); toast("校准系数已复位","good"); }
    if(act==="del"){ if(!confirm("确认删除该账号？")) return; await api("/api/accounts/"+id,{method:"DELETE"}); }
    if(act==="edit"){
      const acc = (state.accounts.accounts||[]).find(x=>x.id===id); if(!acc) return;
      editAccountModal(acc);
    }
    await refresh();
  }catch(e){ toast(e.message,"bad"); }
}

