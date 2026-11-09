// 设置页:按域分区（情景/auto/节流/路由/记录与迁移），每区独立保存、只提交本区字段。
// 导入走弹窗预览（append/replace 显式选择）；导出按钮区分含/不含密钥。
import { api } from "../api.js";
import { state, MODALITIES } from "../state.js";
import { esc, toast, openModal, closeModal } from "../ui.js";
import { icon } from "../icons.js";
import { renderCurrent } from "../app.js";

export function viewSettings(){
  const s = state.settings || {};
  const ai = s.auto_intent || {};
  const pref = ai.preferred_models || {};
  const fld = (id,label,val,type="number",hint="")=>`
    <div><label>${label}</label><input id="${id}" type="${type}" value="${esc(val)}">
    ${hint?`<div class="hint">${hint}</div>`:""}</div>`;
  const scenarios = state.scenarios || [];
  const scOpts = scenarios.map(p=>`<option value="${esc(p.name)}" ${s.scenario===p.name?"selected":""}>${esc(p.name)} · ${esc(p.desc)}</option>`).join("");
  const rec = (state.scenarioData && state.scenarioData.recommend) || null;
  const check = (id, on, text, hint)=>`
    <label class="check-row" for="${id}">
      <input type="checkbox" id="${id}" ${on?"checked":""}>
      <span><span class="t">${text}</span>${hint?`<div class="hint">${hint}</div>`:""}</span>
    </label>`;
  // 每区独立保存按钮
  const saveBtn = zone=>`<div class="sec" style="display:flex;justify-content:flex-end;gap:8px">
    <button class="primary sm" data-save="${zone}">保存本区</button></div>`;
  return `
  <div class="card" data-zone="scenario">
    <div class="card-head"><h2>运行情景</h2><span class="grow"></span><span class="desc">一键侧重网关执行方向，即时生效；账号级 RPM 覆盖不受影响</span></div>
    <div style="padding:14px 16px">
    <div class="row" style="align-items:flex-end">
      <div style="flex:1;min-width:280px"><label>当前情景</label>
        <select id="s_scenario">${scOpts||`<option value="default">default · 默认均衡</option>`}</select></div>
      <button class="primary" id="btnApplyScenario">一键应用</button>
    </div>
    <div class="sec">
      ${check("s_two_level", s.text_two_level_queue,
        "文本两级队列：非流式（工具/短调用）优先于流式出队",
        "仅改出队顺序、不破坏该池 RPM 节拍。")}
      ${check("s_auto_scenario", state.scenarioData&&state.scenarioData.auto_scenario,
        "自动检测接入方负载 → 匹配推荐情景",
        "每 30s 采一次负载画像，自动切到最贴合的情景。")}
      ${rec?`
      <div style="margin-top:8px;padding:10px 12px;border:1px solid var(--line);background:var(--panel-2);border-radius:8px">
        <div class="row" style="justify-content:space-between">
          <span class="badge info">推荐：${esc(rec.name)}</span>
          <button class="primary sm" id="btnApplyRec">按推荐应用</button>
        </div>
        <div class="hint" style="margin-top:6px">${esc(rec.reason||"")}<br><span class="muted">${esc(rec.describe||"")}</span></div>
      </div>`:""}
    </div>
    <div class="sec">
      <h3>429 网关内自动重试</h3>
      <div class="grid g2" style="margin-top:10px">
        ${fld("s_rl_retry_max","429 自动重试次数上限", s.rate_limit_retry_max??6,"number","0=沿用普通 retry_max")}
        ${fld("s_rl_wait_budget_s","429 总等待预算（秒）", Math.round((s.rate_limit_wait_budget_ms??180000)/1000),"number","0=不限；超此即停并透传 429")}
      </div>
    </div>
    ${saveBtn("scenario")}
    </div>
  </div>

  <div class="card" data-zone="auto">
    <div class="card-head"><h2>统一模型入口（auto）</h2><span class="grow"></span><span class="desc">意图判定 / 模型偏好 / 动态模型清单</span></div>
    <div style="padding:14px 16px">
    <div class="grid g2">
      ${fld("s_auto_name","对外统一模型名", s.auto_model_name||"auto","text","客户端只填这个名字，网关自动判定模态")}
      <div><label>内容判定</label>
        <select id="s_scan"><option value="1" ${ai.content_scan?"selected":""}>开启</option><option value="0" ${!ai.content_scan?"selected":""}>关闭（最保守）</option></select>
        <div class="hint">开启后才会读「画一张…」这类措辞；agent 请求（带 tools）不走内容判定</div></div>
      ${fld("s_conf","内容判定阈值", ai.min_confidence??0.6,"number","越高越保守")}
      ${fld("s_isize","生图默认尺寸", ai.default_image_size||"1K","text","上游只接受 1K/2K/3K/4K 或 WIDTHxHEIGHT")}
      ${fld("s_ifield","图生图输入图字段名", ai.image_input_field||"image","text","")}
      ${fld("s_vfield","图生视频输入图字段名", ai.video_input_field||"image","text","")}
      ${fld("s_vwait","视频阻塞等待秒数", ai.video_wait_sec??0,"number","0 = 立即返回 job_id 轮询")}
    </div>
    <div class="sec">
      <h3>模型偏好顺序 · 只在账号已声明的清单内生效</h3>
      <div class="grid g3">
        ${MODALITIES.map(m=>`<div><label>${m}</label>
          <input id="s_pref_${m}" value="${esc((pref[m]||[]).join(", "))}"></div>`).join("")}
      </div>
    </div>
    <div class="sec">
      <h3>动态模型清单 · 保存即生效</h3>
      <div class="grid g2">
        <div><label>免费模型清单（free_models）</label>
          <input id="s_free_models" value="${esc((s.free_models||[]).join(", "))}" placeholder="agnes-3.0-flash, ...">
          <div class="hint">为空时按官方口径启发式（-flash 后缀视为免费）</div></div>
        <div><label>失效模型清单（dead_models）</label>
          <input id="s_dead_models" value="${esc((s.dead_models||[]).join(", "))}" placeholder="agnes-1.5-flash, ...">
          <div class="hint">命中的模型在调度/偏好/别名处一律剔除</div></div>
      </div>
    </div>
    ${saveBtn("auto")}
    </div>
  </div>

  <div class="card" data-zone="throttle">
    <div class="card-head"><h2>节流与排队</h2><span class="grow"></span><span class="desc">RPM / 队列 / 并发 / 熔断</span></div>
    <div style="padding:14px 16px">
    <div class="grid g2">
      ${fld("s_safety","安全阀系数", s.safety_factor??0.9,"number","有效 RPM = 标称 × 安全阀 × 校准")}
      ${fld("s_window","节拍窗口（秒）", s.pacing_window_sec??60,"number","生产保持 60")}
      <div><label>自适应校准</label><select id="s_cal">
        <option value="1" ${s.calibration_enabled?"selected":""}>开启</option><option value="0" ${!s.calibration_enabled?"selected":""}>关闭</option></select>
        <div class="hint">吃 429 反馈自动下调（账号 × 池）节拍</div></div>
      ${fld("s_penalty","429 冷阱时长（秒）", s.penalty_cooldown_sec??65)}
      ${fld("s_pfactor","每次 429 的降幅系数", s.penalty_factor??0.8)}
      ${fld("s_floor","校准下限", s.min_learned_factor??0.5)}
      ${fld("s_recover","回升所需连续成功次数", s.recover_successes??20,"number","按成功次数回升，不按墙钟")}
      ${fld("s_qwait","单请求最长排队（毫秒）", s.queue_max_wait_ms??120000)}
      ${fld("s_qsize","每池最大排队人数", s.queue_max_size??200)}
      ${fld("s_keep","流式心跳间隔（毫秒）", s.keepalive_interval_ms??5000)}
      ${fld("s_imconc","图片并发上限", s.image_concurrency??4)}
      ${fld("s_vconc","视频在任务上限", s.video_max_inflight??2,"number","独立于 RPM 的任务级限制")}
      ${fld("s_brev","熔断自动复活（秒）", s.breaker_revive_sec??1800,"number","401/403/402 熔断后定时复活试探")}
      ${fld("s_rqtimeout","请求超时（毫秒）", s.request_timeout_ms??30000,"number","防 hang 死连接")}
      ${fld("s_free_text_rpm","agnes 免费档文本 RPM", s.free_text_rpm??10,"number","per-account 的 rpm_overrides 优先此值")}
    </div>
    ${saveBtn("throttle")}
    </div>
  </div>

  <div class="card" data-zone="route">
    <div class="card-head"><h2>路由与重试</h2><span class="grow"></span><span class="desc">粘性 / 换站 / 退避</span></div>
    <div style="padding:14px 16px">
    <div class="grid g2">
      <div><label>任务粘性口径</label><select id="s_affinity">
        <option value="session_then_key" ${s.affinity_mode==="session_then_key"?"selected":""}>先看会话头，无则用下游 Key（推荐）</option>
        <option value="key" ${s.affinity_mode==="key"?"selected":""}>仅按下游 Key</option>
        <option value="session" ${s.affinity_mode==="session"?"selected":""}>仅按会话头</option>
        <option value="none" ${s.affinity_mode==="none"?"selected":""}>不粘性（纯负载均衡）</option>
      </select><div class="hint">绑定账号拥堵或冷却时自动改派并更新绑定</div></div>
      <div><label>站点优先级（401/403 自动换站）</label><select id="s_region">
        <option value="cn_first" ${s.region_priority==="cn_first"||!s.region_priority?"selected":""}>国内优先（401/403 自动切国际）</option>
        <option value="com_first" ${s.region_priority==="com_first"?"selected":""}>国际优先（401/403 自动切国内）</option>
        <option value="cn_only" ${s.region_priority==="cn_only"?"selected":""}>仅国内（不换站直接熔断）</option>
        <option value="com_only" ${s.region_priority==="com_only"?"selected":""}>仅国际（不换站直接熔断）</option>
        <option value="random" ${s.region_priority==="random"?"selected":""}>随机选择（401/403 自动切另一站）</option>
      </select></div>
      ${fld("s_tier","生图默认档位", s.default_image_tier||"1k","text")}
      ${fld("s_retry","最大重试次数", s.retry_max??3,"number","生图/视频提交不参与 5xx 重试")}
      ${fld("s_rbase","退避基数（毫秒）", s.retry_base_backoff_ms??500)}
      ${fld("s_rmax","退避上限（毫秒）", s.retry_max_backoff_ms??8000)}
      ${fld("s_probe","探测模型", s.probe_model||"default-model","text","账号测试用的最小文本模型")}
      ${fld("s_ttl","粘性绑定 TTL（小时）", s.session_ttl_hours??72)}
    </div>
    ${saveBtn("route")}
    </div>
  </div>

  <div class="card" data-zone="record">
    <div class="card-head"><h2>优化模式与记录</h2><span class="grow"></span><span class="desc">并发模式 / 图视频库容量</span></div>
    <div style="padding:14px 16px">
    <div class="grid g2">
      <div><label>优化模式</label><select id="s_opt_mode">
        <option value="serial" ${s.optimization_mode==="serial"?"selected":""}>串行 (Serial)</option>
        <option value="concurrent_batch" ${s.optimization_mode==="concurrent_batch"?"selected":""}>并发批处理 (Concurrent Batch)</option>
        <option value="concurrent_parallel" ${s.optimization_mode==="concurrent_parallel"?"selected":""}>并发并行 (Concurrent Parallel)</option>
      </select></div>
      ${fld("s_img_ret","图片记录保留天数", s.image_record_retention_days||30,"number","")}
      ${fld("s_img_cap","图库最大容量（条）", s.image_max_capacity||500,"number","0 = 不限制")}
      ${fld("s_vid_cap","视频库最大容量（条）", s.video_max_capacity||200,"number","0 = 不限制")}
    </div>
    ${saveBtn("record")}
    </div>
  </div>

  <div class="card">
    <div class="card-head"><h2>迁移</h2><span class="grow"></span><span class="desc">导出/导入配置与账号</span></div>
    <div style="padding:14px 16px" class="row">
      <button id="btnExport" title="不含账号 API Key 明文，可安全归档分享">${icon("file",14)}导出（不含密钥）</button>
      <button id="btnExportFull" title="含明文 Key，仅用于迁移">${icon("lock",14)}导出含密钥</button>
      <button id="btnExportCapture">导出 RawCapture 分析</button>
      <button id="btnImport" class="primary">${icon("upload",14)}导入配置</button>
    </div>
  </div>`;
}

/* 各区 payload 构造：只收集本区控件（分区保存，后端白名单合并） */
function zonePayload(zone){
  const g = id=>{ const el=document.getElementById(id); return el?(el.type==="checkbox"?el.checked:el.value):null; };
  const n = id=>{ const v=g(id); return v==null?null:Number(v); };
  const s = state.settings||{}, ai = s.auto_intent||{};
  if(zone==="scenario"){
    const p = {scenario:g("s_scenario")};
    const rl1 = n("s_rl_retry_max"), rl2 = n("s_rl_wait_budget_s");
    if(rl1!=null) p.rate_limit_retry_max = rl1;
    if(rl2!=null) p.rate_limit_wait_budget_ms = Math.round(rl2*1000);
    const t1 = g("s_two_level"); if(t1!=null) p.text_two_level_queue = !!t1;
    const t2 = g("s_auto_scenario"); if(t2!=null) p.auto_scenario = !!t2;
    return p;
  }
  if(zone==="auto"){
    const p = {auto_intent:{}};
    const name = g("s_auto_name"); if(name!=null) p.auto_model_name = name;
    const scan = g("s_scan"); if(scan!=null) p.auto_intent.content_scan = scan==="1";
    const conf = n("s_conf"); if(conf!=null) p.auto_intent.min_confidence = conf;
    const isz = g("s_isize"); if(isz!=null) p.auto_intent.default_image_size = isz;
    const if1 = g("s_ifield"); if(if1!=null) p.auto_intent.image_input_field = if1;
    const vf1 = g("s_vfield"); if(vf1!=null) p.auto_intent.video_input_field = vf1;
    const vw = n("s_vwait"); if(vw!=null) p.auto_intent.video_wait_sec = vw;
    p.auto_intent.preferred_models = {};
    MODALITIES.forEach(m=>{ p.auto_intent.preferred_models[m] =
      (g("s_pref_"+m)||"").split(",").map(x=>x.trim()).filter(Boolean); });
    const fm = g("s_free_models"); if(fm!=null) p.free_models = fm.split(",").map(x=>x.trim()).filter(Boolean);
    const dm = g("s_dead_models"); if(dm!=null) p.dead_models = dm.split(",").map(x=>x.trim()).filter(Boolean);
    return p;
  }
  if(zone==="throttle"){
    const keys = {s_safety:"safety_factor",s_window:"pacing_window_sec",s_penalty:"penalty_cooldown_sec",
      s_pfactor:"penalty_factor",s_floor:"min_learned_factor",s_recover:"recover_successes",
      s_qwait:"queue_max_wait_ms",s_qsize:"queue_max_size",s_keep:"keepalive_interval_ms",
      s_imconc:"image_concurrency",s_vconc:"video_max_inflight",s_brev:"breaker_revive_sec",
      s_rqtimeout:"request_timeout_ms",s_free_text_rpm:"free_text_rpm"};
    const p = {};
    for(const [id,key] of Object.entries(keys)){ const v=n(id); if(v!=null) p[key]=v; }
    const cal = g("s_cal"); if(cal!=null) p.calibration_enabled = cal==="1";
    return p;
  }
  if(zone==="route"){
    const p = {};
    const af = g("s_affinity"); if(af) p.affinity_mode = af;
    const rg = g("s_region"); if(rg) p.region_priority = rg;
    const tier = g("s_tier"); if(tier!=null) p.default_image_tier = tier;
    const keys = {s_retry:"retry_max",s_rbase:"retry_base_backoff_ms",s_rmax:"retry_max_backoff_ms",s_ttl:"session_ttl_hours"};
    for(const [id,key] of Object.entries(keys)){ const v=n(id); if(v!=null) p[key]=v; }
    const probe = g("s_probe"); if(probe!=null) p.probe_model = probe;
    return p;
  }
  // record
  const p = {};
  const om = g("s_opt_mode"); if(om) p.optimization_mode = om;
  const keys = {s_img_ret:"image_record_retention_days",s_img_cap:"image_max_capacity",s_vid_cap:"video_max_capacity"};
  for(const [id,key] of Object.entries(keys)){ const v=n(id); if(v!=null) p[key]=v; }
  return p;
}

export function bindSettingsEvents(){
  // 分区保存：按钮 → 只 POST 本区字段
  document.querySelectorAll("button[data-save]").forEach(b=>{
    b.onclick = async ()=>{
      const zone = b.dataset.save;
      const payload = zonePayload(zone);
      b.disabled = true;
      try{
        await api("/api/settings",{method:"POST",body:JSON.stringify(payload)});
        toast("本区设置已保存并生效","good");
      }catch(e){ toast("保存失败："+e.message,"bad"); }
      finally{ b.disabled = false; }
    };
  });
  // 导出：区分含/不含密钥（后端 /api/export?keys=0 脱敏）；含密钥需二次确认
  document.getElementById("btnExport").onclick = ()=>window.open("/api/export?keys=0","_blank");
  document.getElementById("btnExportFull").onclick = ()=>{
    if(!confirm("将导出含明文 API Key 的完整配置，确认继续？")) return;
    window.open("/api/export","_blank");
  };
  document.getElementById("btnExportCapture").onclick = ()=>window.open("/api/export/capture-analysis", "_blank");
  const applySc = document.getElementById("btnApplyScenario");
  if(applySc) applySc.onclick = async ()=>{
    const name = document.getElementById("s_scenario").value;
    if(!name){ toast("请选择一个情景","warn"); return; }
    try{
      // 只发 scenario（后端 ApplyScenario 覆写整套旋钮），保留账号级 RPM 覆盖。
      await api("/api/settings",{method:"POST",body:JSON.stringify({scenario:name})});
      toast(`已应用「${name}」情景并即时生效`,"good");
      renderCurrent();
    }catch(e){ toast(e.message,"bad"); }
  };
  const applyRec = document.getElementById("btnApplyRec");
  if(applyRec){
    const rec = (state.scenarioData && state.scenarioData.recommend) || null;
    applyRec.onclick = async ()=>{
      if(!rec || !rec.name){ toast("暂无推荐（负载数据积累中）","warn"); return; }
      try{
        await api("/api/settings",{method:"POST",body:JSON.stringify({scenario:rec.name, auto_scenario:true})});
        toast(`已按推荐应用「${rec.name}」情景并开启自动检测`,"good");
        renderCurrent();
      }catch(e){ toast(e.message,"bad"); }
    };
  }
  document.getElementById("btnImport").onclick = ()=>importModal();
}

/* 导入弹窗：粘贴 + 校验预览 + 显式选择 append/replace，替换 prompt() */
function importModal(){
  openModal(`
  <div class="modal-back">
    <div class="modal">
      <h2>导入配置</h2>
      <div class="modal-sub">粘贴此前导出的 JSON；预览确认后再执行</div>
      <textarea id="impText" style="min-height:140px" placeholder='{"version":2,"accounts":[...],"settings":{...}}'></textarea>
      <div id="impPreview" style="margin-top:10px"></div>
      <div style="margin-top:12px;display:flex;justify-content:flex-end;gap:8px">
        <button data-close="1">取消</button>
        <button class="primary" id="btnImpDo" disabled>执行导入</button>
      </div>
    </div>
  </div>`);
  const ta = document.getElementById("impText");
  const pv = document.getElementById("impPreview");
  const doBtn = document.getElementById("btnImpDo");
  let parsed = null;
  const preview = ()=>{
    parsed = null; doBtn.disabled = true; pv.innerHTML = "";
    const text = ta.value.trim();
    if(!text) return;
    try{
      const d = JSON.parse(text);
      if(!d || typeof d!=="object") throw new Error("不是对象");
      const nAcc = (d.accounts||[]).length, hasSettings = !!d.settings, nKeys = (d.keys||d.downstream_keys||[]).length;
      pv.innerHTML = `<div class="banner" style="margin-bottom:8px;background:var(--panel-2);color:var(--ink-2)">
        账号 ${nAcc} 个 · 下游密钥 ${nKeys} 条 · ${hasSettings?"含":"不含"}网关设置</div>
        <label>导入模式</label>
        <select id="impMode">
          <option value="append">追加（保留现有账号）</option>
          <option value="replace">替换（覆盖现有配置）</option>
        </select>
        <div class="hint" id="impModeHint">追加模式：不覆盖现有账号，逐条新增</div>`;
      parsed = d;
      doBtn.disabled = false;
      document.getElementById("impMode").onchange = (e)=>{
        document.getElementById("impModeHint").textContent = e.target.value==="append"
          ? "追加模式：不覆盖现有账号，逐条新增"
          : "替换模式：会覆盖现有账号与设置，请先导出备份";
      };
    }catch(e){
      pv.innerHTML = `<div class="banner bad">JSON 解析失败：${esc(e.message)}</div>`;
    }
  };
  ta.oninput = preview;
  doBtn.onclick = async ()=>{
    if(!parsed) return;
    const mode = document.getElementById("impMode") ? document.getElementById("impMode").value : "append";
    if(mode==="replace" && !confirm("替换模式会覆盖现有账号与设置，确认继续？")) return;
    doBtn.disabled = true;
    try{
      const body = Object.assign({}, parsed, {mode});
      const r = await api("/api/import",{method:"POST",body:JSON.stringify(body)});
      toast(`已导入 ${r.accounts_imported!=null?r.accounts_imported:r.added||0} 个账号`,"good");
      closeModal(); renderCurrent();
    }catch(e){
      toast("导入失败："+e.message,"bad");
      doBtn.disabled = false;
    }
  };
}

/* 按需加载：并行拉 /api/settings + /api/scenarios */
export async function loadSettings(){
  const [st, sc] = await Promise.all([api("/api/settings"), api("/api/scenarios")]);
  state.settings = st;
  state.scenarios = sc.scenarios||[];
  state.scenarioData = sc;
}
