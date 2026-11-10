// 账号池页:搜索/筛选/分页工具条 + tbody 事件委托 + 行操作收敛。
// 弹窗走 ui.js 统一关闭通路；表单带字段级校验与错误恢复。
// v2：危险操作全部走 confirmModal（带账号名/数量明细）；批量操作
// 「选范围→选动作→确认」三段式；行操作分主要(编辑)/次要(测试/toggle)/危险(删除红色)。
import { api } from "../api.js";
import { state, POOLS, MODALITIES, TYPES, DEFAULT_BASE_BY_TYPE } from "../state.js";
import { esc, num, toast, openModal, closeModal, confirmModal, emptyBlock, setFieldError, clearFieldErrors } from "../ui.js";
import { icon } from "../icons.js";
import { renderCurrent } from "../app.js";

/* ---------- 页内状态（模块私有，重进页面保留） ---------- */
const FILTER = { q:"", status:"all", group:"all" };
const PAGE_SIZE = 20;
const PAGER = { page:1 };

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

function rowHtml(a, idx){
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
  return `<tr data-id="${esc(a.id)}">
    <td>
      <b>${esc(a.name)}</b> <span class="badge">${esc(a.access_type)}</span>${a.group?` <span class="badge info">${esc(a.group)}</span>`:""}
      <div class="cell-sub mono">${esc(a.api_key_masked)}${a.base_url?` · ${esc(a.base_url)}`:""}</div>
    </td>
    <td style="white-space:nowrap">${st.join(" ")}</td>
    <td>${rpm||'<span class="muted">—</span>'}</td>
    <td>${MODALITIES.map(mod=>{
      const list=a.model_manifest?.[mod]||[];
      return list.length? `<div class="cell-sub"><b style="color:var(--ink-2)">${mod}</b> <span class="mono">${esc(list.join(", "))}</span></div>`:"";
    }).join("")||'<span class="muted">未声明</span>'}</td>
    <td class="num" style="white-space:nowrap">${num(a.stats?.requests)}<div class="cell-sub">错 ${num(a.stats?.errors)}</div></td>
    <td style="white-space:nowrap">
      <button class="sm primary" data-act="edit" data-id="${esc(a.id)}">编辑</button>
      <button class="sm ghost" data-act="test" data-id="${esc(a.id)}">测试</button>
      <button class="sm ghost" data-act="toggle" data-id="${esc(a.id)}" data-on="${a.enabled?1:0}">${a.enabled?"停用":"启用"}</button>
      <button class="sm ghost danger" data-act="del" data-id="${esc(a.id)}" data-name="${esc(a.name)}" title="删除">${icon("trash",13)} 删除</button>
    </td>
  </tr>`;
}

export function viewAccounts(){
  const all = (state.accounts&&state.accounts.accounts)||[];
  const groups = [...new Set(all.map(a=>a.group).filter(Boolean))];
  const enabled = all.filter(a=>a.enabled).length;
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
    <button id="btnBulkMenu">${icon("layers",14)}批量操作</button>
    <button id="btnOpenBulk">${icon("upload",14)}导入</button>
    <button class="primary" id="btnOpenAdd">${icon("plus",14)}添加账号</button>
  </div>
  <div class="card">
    <div class="card-head"><h2>账号列表</h2><span class="grow"></span>
      <span class="desc">${all.length} 个账号 · ${enabled} 启用 · 校准后 RPM = 标称 × 安全阀 × 429 自适应系数</span></div>
    <div class="tbl-wrap"><table>
      <thead><tr><th>账号</th><th>状态</th><th>各池有效 RPM</th><th>模型清单</th><th>请求</th><th>操作</th></tr></thead>
      <tbody id="accTbody"></tbody>
    </table></div>
    <div id="accPager" style="display:flex;align-items:center;gap:6px;padding:10px 16px;border-top:1px solid var(--line-soft)"></div>
  </div>`;
}

/* 只重绘表格行 + 计数 + 分页（搜索输入时不重建工具栏，避免丢焦点） */
function paintRows(){
  const all = (state.accounts&&state.accounts.accounts)||[];
  const accs = visibleAccounts(all);
  const pages = Math.max(1, Math.ceil(accs.length/PAGE_SIZE));
  if(PAGER.page>pages) PAGER.page = pages;
  const slice = accs.slice((PAGER.page-1)*PAGE_SIZE, PAGER.page*PAGE_SIZE);
  const rows = slice.map((a,i)=>rowHtml(a,(PAGER.page-1)*PAGE_SIZE+i+1)).join("");
  const tb = document.getElementById("accTbody");
  if(!tb) return;
  tb.innerHTML = rows||`<tr><td colspan="6">${emptyBlock(all.length?"search":"users", all.length?"没有匹配筛选条件的账号":"暂无账号 · 点「添加账号」或「导入」开始")}</td></tr>`;
  const cnt = document.getElementById("accCount");
  if(cnt) cnt.textContent = `${accs.length}/${all.length}`;
  // 分页控件
  const pager = document.getElementById("accPager");
  if(pager){
    if(pages<=1){ pager.innerHTML=""; }
    else{
      pager.innerHTML = `
        <button class="sm ghost" data-pg="prev" ${PAGER.page<=1?"disabled":""}>上一页</button>
        <span class="muted" style="font-size:12px">第 ${PAGER.page} / ${pages} 页 · ${accs.length} 条</span>
        <button class="sm ghost" data-pg="next" ${PAGER.page>=pages?"disabled":""}>下一页</button>`;
      pager.querySelectorAll("button[data-pg]").forEach(b=>b.onclick=()=>{
        PAGER.page += b.dataset.pg==="next"?1:-1; paintRows();
      });
    }
  }
}

export function bindAccountEvents(){
  document.getElementById("btnOpenAdd").onclick = ()=>accountFormModal(null);
  document.getElementById("btnOpenBulk").onclick = bulkImportModal;
  document.getElementById("btnBulkMenu").onclick = bulkOpsModal;
  // 搜索/筛选：输入即筛并回第一页，只重绘表格行（不重建工具栏，避免丢焦点）
  const si = document.getElementById("accSearch");
  si.oninput = ()=>{ FILTER.q = si.value; PAGER.page = 1; paintRows(); };
  document.getElementById("accFStatus").onchange = e=>{ FILTER.status = e.target.value; PAGER.page = 1; paintRows(); };
  document.getElementById("accFGroup").onchange = e=>{ FILTER.group = e.target.value; PAGER.page = 1; paintRows(); };
  // 行操作：tbody 级事件委托——重绘天然免疫，重复绑定问题根治
  const tb = document.getElementById("accTbody");
  tb.addEventListener("click", (ev)=>{
    const b = ev.target.closest("button[data-act]");
    if(!b) return;
    accountAction(b.dataset.act, b.dataset.id, b.dataset.on, b.dataset.name);
  });
  paintRows();
}

/* ---------- 批量操作弹窗：范围 → 动作 → 确认明细（替代裸的「应用」直发） ---------- */
function bulkOpsModal(){
  const all = (state.accounts&&state.accounts.accounts)||[];
  const groups = [...new Set(all.map(a=>a.group).filter(Boolean))];
  openModal(`
  <div class="modal-back">
    <div class="modal confirm-box">
      <h2>批量启用 / 停用</h2>
      <div class="modal-sub">先选范围，再选动作；确认后会列出受影响账号数</div>
      <label>目标范围</label>
      <select id="bkGroup">
        <option value="">全部账号（${all.length} 个）</option>
        ${groups.map(g=>`<option value="${esc(g)}">${esc(g)}（${all.filter(a=>(a.group||"")===g).length} 个）</option>`).join("")}
      </select>
      <label style="margin-top:10px">执行动作</label>
      <select id="bkOp">
        <option value="enable">全部启用</option>
        <option value="disable">全部停用</option>
      </select>
      <div id="bkPreview" style="margin-top:10px"></div>
      <div style="margin-top:14px;display:flex;justify-content:flex-end;gap:8px">
        <button data-close="1">取消</button>
        <button class="primary" id="btnBkNext">下一步</button>
      </div>
    </div>
  </div>`);
  document.getElementById("btnBkNext").onclick = ()=>{
    const group = document.getElementById("bkGroup").value;
    const op = document.getElementById("bkOp").value;
    const targets = all.filter(a=>group==="" || (a.group||"")===group);
    if(!targets.length){ toast("该范围内没有账号","warn"); return; }
    const toChange = targets.filter(a=>op==="enable" ? !a.enabled : a.enabled);
    bulkConfirm(targets, toChange, group, op);
  };
}
async function bulkConfirm(targets, toChange, group, op){
  const scopeName = group===""?"全部账号":`分组「${group}」`;
  const enableOp = op==="enable";
  const lines = [
    `范围：${scopeName}，共 ${targets.length} 个账号`,
    `其中 ${toChange.length} 个将被${enableOp?"启用":"停用"}`,
  ];
  if(!enableOp && toChange.length>0){
    const names = toChange.slice(0,8).map(a=>a.name||a.id);
    lines.push("将停用：" + names.join("、") + (toChange.length>8?` 等 ${toChange.length} 个`:""));
  }
  const ok = await confirmModal({
    title: enableOp?"确认批量启用":"确认批量停用",
    message: enableOp?"启用后账号立即参与调度。":"停用后这些账号不再接任何请求，进行中的请求不受影响。",
    detail: lines,
    confirmText: `${enableOp?"启用":"停用"} ${toChange.length} 个账号`,
    danger: !enableOp,
  });
  if(!ok) return;
  try{
    const r = await api("/api/accounts/bulk-update",{method:"POST",body:JSON.stringify({
      group, enabled: enableOp
    })});
    toast(`已${enableOp?"启用":"停用"} ${r.updated} / ${r.matched} 个账号`,"good"); renderCurrent();
  }catch(e){ toast(e.message,"bad"); }
}

/* ---------- 两步表单（添加 / 编辑共用骨架） ----------
   必填：name / api_key(编辑可留空) / access_type；高级项收进 details。
   提交：字段级校验（红框+行内文案），失败保留输入可重试。 */
function accountFormModal(acc){
  const isEdit = !!acc;
  const id = isEdit ? acc.id : null;
  const v = (k, d="") => esc(isEdit ? (acc[k]??d) : d);
  const rpmOv = isEdit ? (acc.rpm_overrides||{}) : {};
  const mf = isEdit ? (acc.model_manifest||{}) : {};
  openModal(`
  <div class="modal-back">
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

      <div id="formErr" style="margin-top:10px"></div>
      <div style="margin-top:12px;display:flex;justify-content:flex-end;gap:8px">
        <button data-close="1">取消</button>
        <button class="primary" id="btnSaveAcc">${isEdit?"保存":"添加账号"}</button>
      </div>
    </div>
  </div>`, {noFocus:false});
  const typeSel = document.getElementById("fType");
  const syncBaseHint = ()=>{
    const baseEl = document.getElementById("fBase");
    if(baseEl && baseEl.value.trim()==="") baseEl.placeholder = "自动套用：" + (DEFAULT_BASE_BY_TYPE[typeSel.value]||"");
  };
  typeSel.onchange = syncBaseHint; syncBaseHint();

  document.getElementById("btnSaveAcc").onclick = async ()=>{
    const btn = document.getElementById("btnSaveAcc");
    clearFieldErrors(document.querySelector(".modal"));
    const name = document.getElementById("fName").value.trim();
    const key = document.getElementById("fKey").value.trim();
    let bad = false;
    if(!name){ setFieldError("fName","名称必填"); bad = true; }
    if(!isEdit && !key){ setFieldError("fKey","API Key 必填"); bad = true; }
    if(bad) return;
    const manifest = {}; MODALITIES.forEach(m=>manifest[m]=document.getElementById("fMf_"+m).value.split(",").map(s=>s.trim()).filter(Boolean));
    const rpm = {}; POOLS.forEach(p=>{ const val=document.getElementById("fRPM_"+p).value.trim(); if(val!=="") rpm[p]=Number(val); });
    const body = {
      name, base_url:document.getElementById("fBase").value,
      access_type:document.getElementById("fType").value,
      group:document.getElementById("fGroup").value,
      max_concurrency:Number(document.getElementById("fConc").value)||8,
      priority:Number(document.getElementById("fPriority").value)||0,
      default_model:document.getElementById("fDefaultModel").value,
      model_manifest:manifest, rpm_overrides:rpm
    };
    if(key) body.api_key = key;
    btn.disabled = true; btn.textContent = "保存中…";
    try{
      if(isEdit) await api("/api/accounts/"+id,{method:"PATCH",body:JSON.stringify(body)});
      else await api("/api/accounts",{method:"POST",body:JSON.stringify(body)});
      toast(isEdit?"已保存":"账号已添加","good"); closeModal(); renderCurrent();
    }catch(e){
      btn.disabled = false; btn.textContent = isEdit?"保存":"添加账号";
      // 错误保留输入（弹窗未关），显示在表单内可重试
      document.getElementById("formErr").innerHTML = `<div class="banner bad" style="margin-bottom:0">${esc(e.message)}</div>`;
    }
  };
}

/* ---------- 批量导入弹窗 ---------- */
function bulkImportModal(){
  openModal(`
  <div class="modal-back">
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
    }catch(e){
      document.getElementById("bulkResult").innerHTML = `<div class="banner bad">${esc(e.message)}</div>`;
    }
  };
}

/* ---------- 测试结果弹窗 ---------- */
function testResultModal(r){
  const drift = (r.drift||[]).map(d=>`<div class="banner warn">${esc(d.modality)} 的 <span class="mono">${esc(d.model)}</span>：${esc(d.issue)}</div>`).join("");
  openModal(`
  <div class="modal-back">
    <div class="modal reqbox">
      <div class="card-head"><h2>账号测试结果</h2><span class="grow"></span>
        <button class="sm ghost icon-btn" data-close="1" title="关闭">${icon("x",14)}</button></div>
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

async function accountAction(act,id,on,name){
  try{
    if(act==="test"){
      toast("正在测试…（向上游发一个最小请求）","warn");
      const r = await api("/api/accounts/"+id+"/test",{method:"POST"});
      testResultModal(r);
      return;
    }
    if(act==="toggle"){
      await api("/api/accounts/"+id,{method:"PATCH",body:JSON.stringify({enabled:on!=="1"})});
      const acc = ((state.accounts&&state.accounts.accounts)||[]).find(x=>x.id===id);
      if(acc){ acc.enabled = !acc.enabled; paintRows(); }  // 局部更新：只重绘行，不重拉
      toast(acc&&acc.enabled?"已启用":"已停用","good");
      return;
    }
    if(act==="del"){
      const ok = await confirmModal({
        title:"删除账号",
        message:"删除后该账号从账号池移除，配置不可恢复（密钥需重新填写）。",
        detail:[`账号：${name||id}`],
        confirmText:"确认删除",
        danger:true,
      });
      if(!ok) return;
      await api("/api/accounts/"+id,{method:"DELETE"});
    }
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
