// 账号池页:搜索/筛选工具条 + 精简列表;添加走两步表单(必填 → 高级折叠),编辑同构。
// 数据逻辑与 API 契约与 v2 一致，仅交互重组。
import { api } from "../api.js";
import { state, POOLS, MODALITIES, TYPES, DEFAULT_BASE_BY_TYPE } from "../state.js";
import { esc, num, toast, openModal, closeModal, emptyBlock } from "../ui.js";
import { icon } from "../icons.js";
import { renderCurrent } from "../app.js";

/* ---------- 页内筛选状态（模块私有，重进页面保留） ---------- */
const FILTER = { q:"", status:"all", group:"all" };

function visibleAccounts(accs){
  const q = FILTER.q.trim().toLowerCase();
  return accs.filter(a=>{
    if(FILTER.status==="on" && !a.enabled) return false;
    if(FILTER.status==="off" && a.enabled) return false;
    if(FILTER.status==="cool" && !(a.penalty_remaining_ms>0)) return false;
    if(FILTER.group!=="all" && (a.group||"")!==FILTER.group) return false;
    if(q){
      const hay = [a.name,a.access_type,a.group,a.base_url,a.api_key_masked].join(" ").toLowerCase();
      if(!hay.includes(q)) return false;
    }
    return true;
  });
}

function manifestEditor(id, manifest){
  const m = manifest || {};
  return MODALITIES.map(mod=>`
    <div><label>${mod} 模型清单（逗号分隔；留空 = 不支持）</label>
    <input id="${id}_${mod}" value="${esc((m[mod]||[]).join(", "))}" placeholder="例如 model-a, model-b"></div>`).join("");
}

export function viewAccounts(){
  const all = (state.accounts&&state.accounts.accounts)||[];
  const groups = [...new Set(all.map(a=>a.group).filter(Boolean))];
  return `
  <div class="toolbar">
    <div style="position:relative;flex:1;min-width:180px;max-width:320px">
      <span style="position:absolute;left:8px;top:50%;transform:translateY(-50%);color:var(--muted);pointer-events:none">${icon("search",14)}</span>
      <input id="accSearch" placeholder="搜索名称 / Key / 分组 / 地址" value="${esc(FILTER.q)}" style="padding-left:28px">
    </div>
    <select id="accFStatus" style="width:110px">
      <option value="all">全部状态</option>
      <option value="on" ${FILTER.status==="on"?"selected":""}>启用</option>
      <option value="off" ${FILTER.status==="off"?"selected":""}>停用</option>
      <option value="cool" ${FILTER.status==="cool"?"selected":""}>冷却中</option>
    </select>
    <select id="accFGroup" style="width:130px">
      <option value="all">全部分组</option>
      ${groups.map(g=>`<option value="${esc(g)}" ${FILTER.group===g?"selected":""}>${esc(g)}</option>`).join("")}
    </select>
    <span class="muted" style="font-size:12px" id="accCount"></span>
    <span style="flex:1"></span>
    <select id="bulkGroup" style="width:150px" title="批量启用/停用的目标分组">
      <option value="">全部分组</option>
      ${groups.map(g=>`<option value="${esc(g)}">${esc(g)}</option>`).join("")}
    </select>
    <select id="bulkOp" style="width:92px">
      <option value="enable">全部启用</option><option value="disable">全部停用</option>
    </select>
    <button id="btnBulkUpdate">应用</button>
    <button id="btnOpenBulk">${icon("upload",14)}导入</button>
    <button class="primary" id="btnOpenAdd">${icon("plus",14)}添加账号</button>
  </div>
  <div class="card">
    <div class="card-head"><h2>账号列表</h2><span class="grow"></span><span class="desc">校准后 RPM = 标称 × 安全阀 × 429 自适应系数</span></div>
    <div class="tbl-wrap"><table>
      <thead><tr><th>账号</th><th>状态</th><th>各池有效 RPM</th><th>模型清单</th><th>请求</th><th>操作</th></tr></thead>
      <tbody id="accTbody"></tbody>
    </table></div>
  </div>`;
}

/* 只重绘表格行 + 计数（搜索输入时不重建工具栏，避免丢焦点） */
function paintRows(){
  const all = (state.accounts&&state.accounts.accounts)||[];
  const accs = visibleAccounts(all);
  const rows = accs.map(a=>{
    const eff = a.rpm_effective||{}, base = a.rpm_base||{};
    const rpm = POOLS.filter(p=>(base[p]||0)>0).map(p=>{
      const b = base[p], e = eff[p];
      // 安全阀(0.9)本身就让 e<b 恒成立；只有 429 自适应重度降速才值得标 warn
      return `<span class="badge ${e<b*0.5?"warn":""}" title="标称 ${b} → 校准后 ${e}">${p} ${e}</span>`;
    }).join(" ");
    const st = [];
    st.push(a.enabled?'<span class="badge ok">启用</span>':'<span class="badge off">停用</span>');
    if(a.penalty_remaining_ms>0) st.push('<span class="badge warn">冷却</span>');
    if(a.stats?.rate_limited) st.push(`<span class="badge warn" title="累计被限流 ${a.stats.rate_limited} 次">限流 ${a.stats.rate_limited}</span>`);
    return `<tr>
      <td>
        <b>${esc(a.name)}</b> <span class="badge">${esc(a.access_type)}</span>${a.group?` <span class="badge info">${esc(a.group)}</span>`:""}
        <div class="cell-sub mono">${esc(a.api_key_masked)}</div>
        <div class="cell-sub" title="${esc(a.base_url)}">${esc(a.base_url)}</div>
      </td>
      <td style="white-space:nowrap">${st.join(" ")}</td>
      <td>${rpm||'<span class="muted">—</span>'}</td>
      <td>${MODALITIES.map(mod=>{
        const list=a.model_manifest?.[mod]||[];
        return list.length? `<div class="cell-sub"><b style="color:var(--ink-2)">${mod}</b> <span class="mono">${esc(list.join(", "))}</span></div>`:"";
      }).join("")||'<span class="muted">未声明</span>'}</td>
      <td class="num" style="white-space:nowrap">${num(a.stats?.requests)}<div class="cell-sub">错 ${num(a.stats?.errors)}</div></td>
      <td style="white-space:nowrap">
        <button class="sm" data-act="test" data-id="${esc(a.id)}">测试</button>
        <button class="sm" data-act="edit" data-id="${esc(a.id)}">编辑</button>
        <button class="sm ghost icon-btn" data-act="toggle" data-id="${esc(a.id)}" data-on="${a.enabled?1:0}"
          title="${a.enabled?"停用":"启用"}">${icon(a.enabled?"x":"play",13)}</button>
        <button class="sm ghost icon-btn danger" data-act="del" data-id="${esc(a.id)}" title="删除">${icon("trash",13)}</button>
      </td>
    </tr>`;
  }).join("");
  const tb = document.getElementById("accTbody");
  if(!tb) return;
  tb.innerHTML = rows||`<tr><td colspan="6">${emptyBlock(all.length?"search":"users", all.length?"没有匹配筛选条件的账号":"暂无账号 · 点「添加账号」或「导入」开始")}</td></tr>`;
  const cnt = document.getElementById("accCount");
  if(cnt) cnt.textContent = `${accs.length}/${all.length}`;
  tb.querySelectorAll("button[data-act]").forEach(b=>b.onclick=()=>accountAction(b.dataset.act,b.dataset.id,b.dataset.on));
}

/* ---------- 两步表单（添加 / 编辑共用骨架） ----------
   第 1 步：必填三项 name / api_key / access_type。
   第 2 步：<details> 折叠的高级项：base_url、分组、并发、优先级、兜底模型、
           各池 RPM 覆盖、模型清单。默认折叠，不挡新手路径。 */
function accountFormModal(acc){
  const isEdit = !!acc;
  const id = isEdit ? acc.id : null;
  const v = (k, d="") => esc(isEdit ? (acc[k]??d) : d);
  const rpmOv = isEdit ? (acc.rpm_overrides||{}) : {};
  const mf = isEdit ? (acc.model_manifest||{}) : {};
  openModal(`
  <div class="modal-back" data-close="1">
    <div class="modal wide">
      <h2>${isEdit?`编辑账号 · ${v("name")}`:"添加账号"}</h2>
      <div class="modal-sub">${isEdit?"API Key 留空 = 保留原 Key":"只需名称、Key、类型三项即可创建；其余保持默认"}</div>

      <div class="grid" style="grid-template-columns:1fr 1fr;gap:10px">
        <div><label>名称 *</label><input id="fName" value="${v("name")}" placeholder="agnes-1"></div>
        <div><label>${isEdit?"API Key（留空保留）":"API Key *"}</label><input id="fKey" placeholder="sk-..." autocomplete="off"></div>
        <div><label>账号类型 *</label>
          <select id="fType">${TYPES.map(t=>`<option value="${t}" ${isEdit&&t===acc.access_type?"selected":""}>${t}</option>`).join("")}</select>
          <div class="hint">Base URL 留空按类型自动套用</div></div>
        <div><label>分组（可选）</label><input id="fGroup" value="${v("group")}" placeholder="cn-free"></div>
      </div>

      <details ${isEdit?"":"open"} style="margin-top:6px">
        <summary style="cursor:pointer;font-size:12.5px;font-weight:600;color:var(--ink-2);padding:8px 0;user-select:none">
          高级选项${isEdit?"":"（可留空，全部有默认值）"}
        </summary>
        <div class="grid" style="grid-template-columns:1fr 1fr 1fr;gap:10px;margin-top:8px">
          <div><label>Base URL</label><input id="fBase" value="${v("base_url")}" placeholder="自动套用"></div>
          <div><label>单账号并发</label><input id="fConc" type="number" min="1" value="${isEdit?acc.max_concurrency||8:8}"></div>
          <div><label>优先级（越大越优先）</label><input id="fPriority" type="number" min="0" value="${isEdit?acc.priority||0:0}"></div>
          <div><label>兜底模型</label><input id="fDefaultModel" value="${v("default_model")}" placeholder="留空=auto"></div>
        </div>
        <div class="sec">
          <h3>各池 RPM 覆盖 · 留空 = 按类型档位表</h3>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            ${POOLS.map(p=>`<div style="flex:1;min-width:90px"><label>${p}</label><input id="fRPM_${p}" type="number" min="0" value="${rpmOv[p]||""}" placeholder="按档位"></div>`).join("")}
          </div>
        </div>
        <div class="sec">
          <h3>模型清单（按模态声明）</h3>
          ${manifestEditor("fMf", mf)}
          <div class="hint">留空的模态视为该账号不支持，调度自动跳过</div>
        </div>
      </details>

      <div style="margin-top:16px;display:flex;justify-content:flex-end;gap:8px">
        <button data-close="1">取消</button>
        <button class="primary" id="btnSaveAcc">${isEdit?"保存":"添加账号"}</button>
      </div>
    </div>
  </div>`);
  const typeSel = document.getElementById("fType");
  const syncBaseHint = ()=>{
    const baseEl = document.getElementById("fBase");
    if(baseEl && baseEl.value.trim()==="") baseEl.placeholder = "自动套用：" + (DEFAULT_BASE_BY_TYPE[typeSel.value]||"");
  };
  typeSel.onchange = syncBaseHint; syncBaseHint();

  document.getElementById("btnSaveAcc").onclick = async ()=>{
    const manifest = {}; MODALITIES.forEach(m=>manifest[m]=document.getElementById("fMf_"+m).value.split(",").map(s=>s.trim()).filter(Boolean));
    const rpm = {}; POOLS.forEach(p=>{ const val=document.getElementById("fRPM_"+p).value.trim(); if(val!=="") rpm[p]=Number(val); });
    const body = {
      name:document.getElementById("fName").value,
      base_url:document.getElementById("fBase").value,
      access_type:document.getElementById("fType").value,
      group:document.getElementById("fGroup").value,
      max_concurrency:Number(document.getElementById("fConc").value)||8,
      priority:Number(document.getElementById("fPriority").value)||0,
      default_model:document.getElementById("fDefaultModel").value,
      model_manifest:manifest, rpm_overrides:rpm
    };
    if(!body.name.trim()){ toast("名称必填","bad"); document.getElementById("fName").focus(); return; }
    const k = document.getElementById("fKey").value.trim();
    if(isEdit){ if(k!=="") body.api_key = k; }
    else {
      if(!k){ toast("API Key 必填","bad"); document.getElementById("fKey").focus(); return; }
      body.api_key = k;
    }
    try{
      if(isEdit) await api("/api/accounts/"+id,{method:"PATCH",body:JSON.stringify(body)});
      else await api("/api/accounts",{method:"POST",body:JSON.stringify(body)});
      toast(isEdit?"已保存":"账号已添加","good"); closeModal(); renderCurrent();
    }catch(e){ toast(e.message,"bad"); }
  };
  document.getElementById("fName").focus();
}

/* ---------- 批量导入弹窗 ---------- */
function bulkImportModal(){
  openModal(`
  <div class="modal-back" data-close="1">
    <div class="modal">
      <h2>批量导入账号</h2>
      <div class="modal-sub">每行：<span class="mono">名称,key[,base_url[,access_type[,group]]]</span>，# 开头的行忽略</div>
      <textarea id="bulkText" style="min-height:150px" placeholder="agnes-1,sk-xxxx,https://api.example.com/v1,free,cn
agnes-2,sk-yyyy,https://api.example.com/v1,free,cn"></textarea>
      <div style="margin-top:12px;display:flex;justify-content:flex-end;gap:8px">
        <button data-close="1">取消</button>
        <button class="primary" id="btnBulk">导入</button>
      </div>
      <div id="bulkResult" style="margin-top:10px"></div>
    </div>
  </div>`);
  document.getElementById("btnBulk").onclick = async ()=>{
    try{
      const r = await api("/api/accounts/bulk",{method:"POST",body:JSON.stringify({text:document.getElementById("bulkText").value})});
      const f = (r.failed||[]).map(x=>`<div class="banner bad">第 ${x.line} 行：${esc(x.reason)}<br><span class="mono">${esc(x.text)}</span></div>`).join("");
      document.getElementById("bulkResult").innerHTML =
        `<div class="banner good">成功导入 ${r.added_count} 个账号</div>${f}`;
      renderCurrent();
    }catch(e){ toast(e.message,"bad"); }
  };
  document.getElementById("bulkText").focus();
}

/* ---------- 测试结果弹窗 ---------- */
function testResultModal(r){
  const drift = (r.drift||[]).map(d=>`<div class="banner warn">${esc(d.modality)} 的 <span class="mono">${esc(d.model)}</span>：${esc(d.issue)}</div>`).join("");
  openModal(`
  <div class="modal-back" data-close="1">
    <div class="modal reqbox">
      <div class="card-head"><h2>账号测试结果</h2><span class="grow"></span>
        <button class="sm ghost icon-btn" data-close="1">${icon("x",14)}</button></div>
      <div style="padding:0 20px 20px">
        <div class="banner ${r.ok?"good":"bad"}">HTTP ${r.status} · ${r.latency_ms}ms · ${esc(r.hint)}</div>
        ${drift}
        ${r.models&&r.models.length?`<div class="sec"><h3>上游真实可用模型（${r.models.length}）</h3>
          <div class="mono" style="font-size:12px;line-height:1.6;color:var(--ink-2)">${esc(r.models.join(", "))}</div></div>`:""}
        ${r.body?`<div class="sec"><h3>响应体</h3><pre>${esc(r.body)}</pre></div>`:""}
      </div>
    </div>
  </div>`);
}

export function bindAccountEvents(){
  document.getElementById("btnOpenAdd").onclick = ()=>accountFormModal(null);
  document.getElementById("btnOpenBulk").onclick = bulkImportModal;
  // 搜索/筛选：输入即筛，只重绘表格行（不重建工具栏，避免输入丢焦点）
  const si = document.getElementById("accSearch");
  si.oninput = ()=>{ FILTER.q = si.value; paintRows(); };
  document.getElementById("accFStatus").onchange = e=>{ FILTER.status = e.target.value; paintRows(); };
  document.getElementById("accFGroup").onchange = e=>{ FILTER.group = e.target.value; paintRows(); };
  document.getElementById("btnBulkUpdate").onclick = async ()=>{
    const op = document.getElementById("bulkOp").value;
    try{
      const r = await api("/api/accounts/bulk-update",{method:"POST",body:JSON.stringify({
        group:document.getElementById("bulkGroup").value.trim(), enabled: op==="enable"
      })});
      toast(`已更新 ${r.updated} / ${r.matched} 个账号`,"good"); renderCurrent();
    }catch(e){ toast(e.message,"bad"); }
  };
  paintRows();
}

async function accountAction(act,id,on){
  try{
    if(act==="test"){
      toast("正在测试…（向上游发一个最小请求）","warn");
      const r = await api("/api/accounts/"+id+"/test",{method:"POST"});
      testResultModal(r);
      return;
    }
    if(act==="toggle"){ await api("/api/accounts/"+id,{method:"PATCH",body:JSON.stringify({enabled:on!=="1"})}); }
    if(act==="del"){ if(!confirm("确认删除该账号？")) return; await api("/api/accounts/"+id,{method:"DELETE"}); }
    if(act==="edit"){
      const acc = ((state.accounts&&state.accounts.accounts)||[]).find(x=>x.id===id); if(!acc) return;
      accountFormModal(acc);
      return;
    }
    renderCurrent();
  }catch(e){ toast(e.message,"bad"); }
}

/* 按需加载：本页只拉 /api/accounts */
export async function loadAccounts(){
  state.accounts = await api("/api/accounts");
}
