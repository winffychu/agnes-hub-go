// 账号池页:列表为主视图;添加/批量导入/编辑均为弹窗;分组批量改入工具条。
import { api } from "../api.js";
import { state, POOLS, MODALITIES, TYPES, DEFAULT_BASE_BY_TYPE } from "../state.js";
import { esc, num, toast, openModal, closeModal, emptyBlock } from "../ui.js";
import { refresh } from "../app.js";

function manifestEditor(id, manifest){
  const m = manifest || {};
  return MODALITIES.map(mod=>`
    <div>
      <label>${mod} 模型清单（逗号分隔；留空 = 不支持该模态）</label>
      <input id="${id}_${mod}" value="${esc((m[mod]||[]).join(", "))}" placeholder="例如 model-a, model-b">
    </div>`).join("");
}

export function viewAccounts(){
  const data = state.accounts || {accounts:[]};
  const accs = data.accounts||[];
  const rows = accs.map(a=>{
    const eff = a.rpm_effective||{}, base = a.rpm_base||{};
    const rpm = POOLS.filter(p=>(base[p]||0)>0).map(p=>{
      const b = base[p], e = eff[p];
      return `<span class="pill ${e<b?"warn":""}" title="标称 ${b} → 校准后 ${e}">${p} ${e}</span>`;
    }).join(" ");
    const statusPills = [];
    statusPills.push(a.enabled?'<span class="pill ok">启用</span>':'<span class="pill off">停用</span>');
    if(a.penalty_remaining_ms>0) statusPills.push('<span class="pill warn">冷却</span>');
    if(a.stats?.rate_limited) statusPills.push(`<span class="pill warn" title="累计被限流 ${a.stats.rate_limited} 次">限流 ${a.stats.rate_limited}</span>`);
    return `<tr>
      <td>
        <b>${esc(a.name)}</b> <span class="pill">${esc(a.access_type)}</span>${a.group?` <span class="pill cyan">${esc(a.group)}</span>`:""}
        <div class="cell-sub mono">${esc(a.api_key_masked)}</div>
        <div class="cell-sub" title="${esc(a.base_url)}">${esc(a.base_url)}</div>
      </td>
      <td style="white-space:nowrap">${statusPills.join(" ")}</td>
      <td>${rpm||'<span class="muted">—</span>'}</td>
      <td>${MODALITIES.map(mod=>{
        const list=a.model_manifest?.[mod]||[];
        return list.length? `<div class="cell-sub"><b style="color:var(--ink-2)">${mod}</b> <span class="mono">${esc(list.join(", "))}</span></div>`:"";
      }).join("")||'<span class="muted">未声明</span>'}</td>
      <td class="num" style="white-space:nowrap">${num(a.stats?.requests)}<div class="cell-sub">错 ${num(a.stats?.errors)}</div></td>
      <td style="white-space:nowrap">
        <button class="sm" data-act="test" data-id="${esc(a.id)}">测试</button>
        <button class="sm" data-act="edit" data-id="${esc(a.id)}">编辑</button>
        <button class="sm" data-act="toggle" data-id="${esc(a.id)}" data-on="${a.enabled?1:0}">${a.enabled?"停用":"启用"}</button>
        <button class="sm" data-act="factors" data-id="${esc(a.id)}" title="吃 429 自适应的校准系数复位为 1">复位校准</button>
        <button class="sm danger" data-act="del" data-id="${esc(a.id)}">删除</button>
      </td>
    </tr>`;
  }).join("");
  return `
  <div class="toolbar">
    <button class="primary" id="btnOpenAdd">＋ 添加账号</button>
    <button id="btnOpenBulk">⇪ 批量导入</button>
    <div style="flex:1"></div>
    <input id="bulkGroup" placeholder="分组名（留空 = 全部）" style="width:180px">
    <select id="bulkOp" style="width:120px">
      <option value="enable">全部启用</option><option value="disable">全部停用</option>
    </select>
    <button id="btnBulkUpdate" title="按分组批量启用/停用">应用到分组</button>
  </div>
  <div class="card">
    <div class="card-head">
      <h2>账号列表<span class="tag">${accs.length} 个</span></h2>
      <span class="desc">标称 RPM 来自官方档位表；「校准后」是吃 429 反馈自适应后的实际节拍</span>
    </div>
    <div class="tbl-wrap"><table>
      <thead><tr><th>账号</th><th>状态</th><th>各池有效 RPM</th><th>模型清单</th><th>请求</th><th>操作</th></tr></thead>
      <tbody>${rows||`<tr><td colspan="6">${emptyBlock("👥","暂无账号 · 点右上「＋ 添加账号」或「批量导入」开始")}</td></tr>`}</tbody>
    </table></div>
  </div>`;
}

/* ---------- 添加账号弹窗 ---------- */
function addAccountModal(){
  openModal(`
  <div class="modal-back" onclick="if(event.target===this)closeModal()">
    <div class="modal">
      <h2>添加账号</h2>
      <div class="modal-sub">Base URL 留空按账号类型自动套用；模态清单留空 = 该账号不支持此模态，调度自动跳过。</div>
      <div class="grid">
        <div><label>名称</label><input id="aName" placeholder="agnes-1"></div>
        <div><label>API Key</label><input id="aKey" placeholder="sk-..."></div>
        <div><label>Base URL（留空按类型自动套用）</label><input id="aBase" placeholder="https://api.example.com/v1"></div>
        <div class="row" style="gap:10px">
          <div style="flex:1"><label>账号类型</label>
            <select id="aType">${TYPES.map(t=>`<option>${t}</option>`).join("")}</select></div>
          <div style="flex:1"><label>分组（可选）</label><input id="aGroup" placeholder="cn-free"></div>
        </div>
        <div class="row" style="gap:10px">
          <div style="flex:1"><label>单账号并发</label><input id="aConc" type="number" value="8" min="1"></div>
          <div style="flex:1"><label>优先级（越大越优先）</label><input id="aPriority" type="number" value="0" min="0"></div>
          <div style="flex:1"><label>兜底模型（可选）</label><input id="aDefaultModel" placeholder="留空=auto"></div>
        </div>
      </div>
      <div class="sec">
        <h3>各池 RPM 覆盖<span class="tag">留空 = 按类型档位表</span></h3>
        <div class="row" style="gap:8px">
          ${POOLS.map(p=>`<div style="flex:1;min-width:90px"><label>${p}</label><input id="aRPM_${p}" type="number" min="0" placeholder="按档位"></div>`).join("")}
        </div>
        <div class="hint">自定义渠道（AMD / OpenRouter 等）官方速率未知，默认套用保守值；实测可承受更高就在这里上调。</div>
      </div>
      <div class="sec">
        <h3>模型清单（按模态声明）</h3>
        ${manifestEditor("aMf", {})}
        <div class="hint">留空的模态视为「该账号不支持」，调度自动跳过 —— 这正是「多账号按模态分工」的开关。</div>
      </div>
      <div class="row" style="margin-top:16px;justify-content:flex-end">
        <button onclick="closeModal()">取消</button>
        <button class="primary" id="btnAddAcc">添加账号</button>
      </div>
    </div>
  </div>`);
  const typeSel = document.getElementById("aType");
  typeSel.onchange = ()=>{
    const baseEl = document.getElementById("aBase");
    if(baseEl && baseEl.value.trim()==="") baseEl.placeholder = "留空将自动套用：" + (DEFAULT_BASE_BY_TYPE[typeSel.value]||"");
  };
  document.getElementById("btnAddAcc").onclick = async ()=>{
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
      toast("账号已添加","good"); closeModal(); await refresh();
    }catch(e){ toast(e.message,"bad"); }
  };
  document.getElementById("aName").focus();
}

/* ---------- 批量导入弹窗 ---------- */
function bulkImportModal(){
  openModal(`
  <div class="modal-back" onclick="if(event.target===this)closeModal()">
    <div class="modal">
      <h2>批量导入账号</h2>
      <div class="modal-sub">每行一个账号：<span class="mono">名称,key[,base_url[,access_type[,group]]]</span>，以 # 开头的行会被忽略</div>
      <textarea id="bulkText" style="min-height:160px" placeholder="agnes-1,sk-xxxx,https://api.example.com/v1,free,cn
agnes-2,sk-yyyy,https://api.example.com/v1,free,cn"></textarea>
      <div class="row" style="margin-top:14px;justify-content:space-between">
        <span class="muted" style="font-size:12px">逐行校验，失败的行会单独回报原因</span>
        <span><button onclick="closeModal()">取消</button>
        <button class="primary" id="btnBulk">导入</button></span>
      </div>
      <div id="bulkResult" style="margin-top:10px"></div>
    </div>
  </div>`);
  document.getElementById("btnBulk").onclick = async ()=>{
    try{
      const r = await api("/api/accounts/bulk",{method:"POST",body:JSON.stringify({text:document.getElementById("bulkText").value})});
      const f = (r.failed||[]).map(x=>`<div class="banner bad">第 ${x.line} 行：${esc(x.reason)}<br><span class="mono">${esc(x.text)}</span></div>`).join("");
      document.getElementById("bulkResult").innerHTML =
        `<div class="banner good">✓ 成功导入 ${r.added_count} 个账号</div>${f}`;
      await refresh();
    }catch(e){ toast(e.message,"bad"); }
  };
  document.getElementById("bulkText").focus();
}

/* ---------- 编辑账号弹窗 ---------- */
function editAccountModal(acc){
  const id = acc.id;
  const rpm = acc.rpm_overrides || {};
  const mf = acc.model_manifest || {};
  openModal(`
  <div class="modal-back" onclick="if(event.target===this)closeModal()">
    <div class="modal">
      <h2>编辑账号 · ${esc(acc.name)}</h2>
      <div class="modal-sub">API Key 留空 = 保留原 Key；Base URL 留空按类型自动套用。</div>
      <div class="grid">
        <div><label>名称</label><input id="eName" value="${esc(acc.name)}"></div>
        <div><label>API Key（留空保留）</label><input id="eKey" placeholder="留空保留原 Key"></div>
        <div><label>Base URL</label><input id="eBase" value="${esc(acc.base_url)}"></div>
        <div class="row" style="gap:10px">
          <div style="flex:1"><label>账号类型</label>
            <select id="eType">${TYPES.map(t=>`<option value="${t}" ${t===acc.access_type?"selected":""}>${t}</option>`).join("")}</select></div>
          <div style="flex:1"><label>分组</label><input id="eGroup" value="${esc(acc.group||"")}"></div>
        </div>
        <div class="row" style="gap:10px">
          <div style="flex:1"><label>单账号并发</label><input id="eConc" type="number" value="${acc.max_concurrency||8}" min="1"></div>
          <div style="flex:1"><label>优先级（越大越优先）</label><input id="ePriority" type="number" value="${acc.priority||0}" min="0"></div>
          <div style="flex:1"><label>兜底模型</label><input id="eDefaultModel" value="${esc(acc.default_model||"")}" placeholder="留空=auto"></div>
        </div>
      </div>
      <div class="sec">
        <h3>各池 RPM 覆盖<span class="tag">留空 = 按类型档位表</span></h3>
        <div class="row" style="gap:8px">
          ${POOLS.map(p=>`<div style="flex:1;min-width:90px"><label>${p}</label><input id="eRPM_${p}" type="number" min="0" value="${rpm[p]||""}" placeholder="按档位"></div>`).join("")}
        </div>
      </div>
      <div class="sec">
        <h3>模型清单</h3>
        ${manifestEditor("eMf", mf)}
      </div>
      <div class="row" style="margin-top:16px;justify-content:flex-end">
        <button onclick="closeModal()">取消</button>
        <button class="primary" id="btnSaveAcc">保存</button>
      </div>
    </div>
  </div>`);
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

export function bindAccountEvents(){
  const view = document.getElementById("view");
  const openAdd = document.getElementById("btnOpenAdd");
  if(openAdd) openAdd.onclick = addAccountModal;
  const openBulk = document.getElementById("btnOpenBulk");
  if(openBulk) openBulk.onclick = bulkImportModal;
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

async function accountAction(act,id,on){
  try{
    if(act==="test"){
      toast("正在测试…（会向上游发一个最小请求）","warn");
      const r = await api("/api/accounts/"+id+"/test",{method:"POST"});
      const drift = (r.drift||[]).map(d=>`<div class="banner warn">${esc(d.modality)} 的 <span class="mono">${esc(d.model)}</span>：${esc(d.issue)}</div>`).join("");
      openModal(`
      <div class="modal-back" onclick="if(event.target===this)closeModal()">
        <div class="modal reqbox">
          <div class="card-head"><h2>账号测试结果</h2><button class="sm icon-btn" onclick="closeModal()">✕</button></div>
          <div class="banner ${r.ok?"good":"bad"}">HTTP ${r.status} · ${r.latency_ms}ms · ${esc(r.hint)}</div>
          ${drift}
          ${r.models&&r.models.length?`<div class="sec"><h3>上游真实可用模型（${r.models.length}）</h3>
            <div class="mono" style="font-size:12px;line-height:1.6;color:var(--ink-2)">${esc(r.models.join(", "))}</div></div>`:""}
          ${r.body?`<div class="sec"><h3>响应体</h3><pre style="background:var(--panel-2);border:1px solid var(--line);border-radius:8px;padding:10px;max-height:200px;overflow:auto;margin:6px 0 0">${esc(r.body)}</pre></div>`:""}
        </div>
      </div>`);
      return;
    }
    if(act==="toggle"){ await api("/api/accounts/"+id,{method:"PATCH",body:JSON.stringify({enabled:on!=="1"})}); }
    if(act==="factors"){ await api("/api/accounts/"+id+"/reset-factors",{method:"POST"}); toast("校准系数已复位","good"); }
    if(act==="del"){ if(!confirm("确认删除该账号？")) return; await api("/api/accounts/"+id,{method:"DELETE"}); }
    if(act==="edit"){
      const acc = (state.accounts.accounts||[]).find(x=>x.id===id); if(!acc) return;
      editAccountModal(acc);
      return;
    }
    await refresh();
  }catch(e){ toast(e.message,"bad"); }
}
