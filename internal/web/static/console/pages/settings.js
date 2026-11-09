// 设置页:分区块 + 侧锚点;情景/auto/节流/路由/优化/迁移各自成区。
import { api } from "../api.js";
import { state, MODALITIES } from "../state.js";
import { esc, num, toast } from "../ui.js";
import { refresh } from "../app.js";

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
  return `
  <div class="card">
    <div class="card-head"><h2>运行情景<span class="tag">按网关执行方向一键侧重</span></h2></div>
    <div class="hint" style="margin-bottom:12px">选一个情景，网关按该方向自动调安全阀 / 文本 RPM / 重试 / 队列 / 并发等旋钮并即时生效；账号级 RPM 覆盖仍优先，不被冲掉。参数按 8 个免费号基准设计。</div>
    <div class="row" style="align-items:flex-end">
      <div style="flex:1;min-width:280px"><label>当前情景</label>
        <select id="s_scenario">${scOpts||`<option value="default">default · 默认均衡</option>`}</select></div>
      <button class="primary" id="btnApplyScenario">一键应用</button>
    </div>
    <div class="hint" style="margin-top:6px">切到「多任务并行」默认打开两级队列（短调用优先）；「挂机批量」拉高空闲容忍与队列。</div>
    <div class="sec">
      ${check("s_two_level", s.text_two_level_queue,
        "文本两级队列：同池内非流式（工具/短调用）优先于流式（长生成）出队",
        "仅改出队顺序、不破坏该池 RPM 节拍；多任务并发卡顿明显时打开。")}
      ${check("s_auto_scenario", state.scenarioData&&state.scenarioData.auto_scenario,
        "自动检测接入方负载 → 一键匹配推荐情景",
        "后台每 30s 采一次负载画像（文/图/视频占比、流式比、并发、429 压力），自动切到最贴合的情景；手动应用情景会同时保留此开关。")}
      ${rec?`
      <div style="margin-top:8px;padding:12px 14px;border:1px solid var(--brand-line);background:var(--brand-soft);border-radius:10px">
        <div class="row" style="justify-content:space-between">
          <span class="pill info">推荐情景：${esc(rec.name)}</span>
          <button class="primary sm" id="btnApplyRec">按推荐一键应用</button>
        </div>
        <div class="hint" style="color:var(--brand);margin-top:6px">${esc(rec.reason||"")}</div>
        <div class="muted" style="font-size:12px;margin-top:4px">当前画像：${esc(rec.describe||"暂无负载数据")}</div>
      </div>`:`<div class="hint" style="margin-top:6px">暂无负载数据（还没请求过），画像积累后即可给出推荐。</div>`}
    </div>
    <div class="sec">
      <h3>429 网关内自动重试<span class="tag">不中断客户端任务</span></h3>
      <div class="grid g2" style="margin-top:10px">
        ${fld("s_rl_retry_max","429 自动重试次数上限", s.rate_limit_retry_max??6,"number","0=沿用普通 retry_max；限流时网关换号+重新排队自动重试到成功或到此为止")}
        ${fld("s_rl_wait_budget_s","429 总等待预算（秒）", Math.round((s.rate_limit_wait_budget_ms??180000)/1000),"number","0=不限（仅按次数停）；累计退避等待超此即停并透传 429，防止持续限流时挂死")}
      </div>
      <div class="hint">上游「达到最大限制/429」不再直接弹给客户端，而是网关内部排队+退避自动重试直到成功或预算耗尽。</div>
    </div>
  </div>

  <div class="card">
    <div class="card-head"><h2>统一模型入口（auto）</h2></div>
    <div class="grid g2">
      ${fld("s_auto_name","对外统一模型名", s.auto_model_name||"auto","text","客户端只填这个名字，网关自动判定模态")}
      <div><label>内容判定（关闭则只看端点/参数）</label>
        <select id="s_scan"><option value="1" ${ai.content_scan?"selected":""}>开启</option><option value="0" ${!ai.content_scan?"selected":""}>关闭（最保守）</option></select>
        <div class="hint">开启后才会读「画一张…」这类措辞；agent 请求（带 tools）永远不走内容判定</div></div>
      ${fld("s_conf","内容判定阈值", ai.min_confidence??0.6,"number","越高越保守；0.6 表示需命中较强措辞")}
      ${fld("s_isize","生图默认尺寸", ai.default_image_size||"1K","text","上游只接受 1K/2K/3K/4K 或 WIDTHxHEIGHT")}
      ${fld("s_ifield","图生图输入图字段名", ai.image_input_field||"image","text","留空则不自动带图；上游规范变更时改这里")}
      ${fld("s_vfield","图生视频输入图字段名", ai.video_input_field||"image","text","")}
      ${fld("s_vwait","视频阻塞等待秒数", ai.video_wait_sec??0,"number","0 = 立即返回 job_id 让客户端轮询")}
    </div>
    <div class="sec">
      <h3>模型偏好顺序<span class="tag">只在账号已声明的清单内生效，绝不越界</span></h3>
      <div class="grid g3">
        ${MODALITIES.map(m=>`<div><label>${m}</label>
          <input id="s_pref_${m}" value="${esc((pref[m]||[]).join(", "))}"></div>`).join("")}
      </div>
    </div>
    <div class="sec">
      <h3>动态模型清单<span class="tag">改完保存即生效，无需重编译</span></h3>
      <div class="grid g2">
        <div><label>免费模型清单（free_models）</label>
          <input id="s_free_models" value="${esc((s.free_models||[]).join(", "))}" placeholder="agnes-3.0-flash, agnes-2.5-flash, ...">
          <div class="hint">逗号分隔；为空时按官方口径启发式（-flash 后缀视为免费）。上游新增免费模型改这里即可</div></div>
        <div><label>失效模型清单（dead_models）</label>
          <input id="s_dead_models" value="${esc((s.dead_models||[]).join(", "))}" placeholder="agnes-1.5-flash, agnes-2.0-flash, ...">
          <div class="hint">逗号分隔；命中的模型在调度/偏好/别名处一律剔除，请求快速失败而非盲发上游</div></div>
      </div>
    </div>
  </div>

  <div class="card">
    <div class="card-head"><h2>节流与排队</h2></div>
    <div class="grid g2">
      ${fld("s_safety","安全阀系数", s.safety_factor??0.9,"number","有效 RPM = 标称 × 安全阀 × 校准；默认 0.9 留 10% 余量")}
      ${fld("s_window","节拍窗口（秒）", s.pacing_window_sec??60,"number","生产保持 60；仅本地压测压缩时间轴用")}
      <div><label>自适应校准</label><select id="s_cal">
        <option value="1" ${s.calibration_enabled?"selected":""}>开启</option><option value="0" ${!s.calibration_enabled?"selected":""}>关闭</option></select>
        <div class="hint">吃 429 反馈自动下调（账号 × 池）节拍；其它池不受影响</div></div>
      ${fld("s_penalty","429 冷阱时长（秒）", s.penalty_cooldown_sec??65)}
      ${fld("s_pfactor","每次 429 的降幅系数", s.penalty_factor??0.8)}
      ${fld("s_floor","校准下限", s.min_learned_factor??0.5)}
      ${fld("s_recover","回升所需连续成功次数", s.recover_successes??20,"number","按成功次数回升，而不是按墙钟 —— 低流量账号也能恢复")}
      ${fld("s_qwait","单请求最长排队（毫秒）", s.queue_max_wait_ms??120000)}
      ${fld("s_qsize","每池最大排队人数", s.queue_max_size??200)}
      ${fld("s_keep","流式心跳间隔（毫秒）", s.keepalive_interval_ms??5000)}
      ${fld("s_imconc","图片并发上限", s.image_concurrency??4)}
      ${fld("s_vconc","视频在任务上限", s.video_max_inflight??2,"number","独立于 RPM 的任务级限制：只做 RPM 不做任务数会出现「RPM 没超但视频一直失败」")}
      ${fld("s_brev","熔断自动复活（秒）", s.breaker_revive_sec??1800,"number","401/403/402 熔断后到这个时间自动复活低速试探")}
      ${fld("s_rqtimeout","请求超时（毫秒）", s.request_timeout_ms??30000,"number","单次上游请求最长等待时间，防 hang 死连接")}
      ${fld("s_free_text_rpm","agnes 免费档文本 RPM", s.free_text_rpm??10,"number","agnes 免费账号文本池标称 RPM；修改后立即生效。per-account 的 rpm_overrides 仍优先此值")}
    </div>
  </div>

  <div class="card">
    <div class="card-head"><h2>路由与重试</h2></div>
    <div class="grid g2">
      <div><label>任务粘性口径</label><select id="s_affinity">
        <option value="session_then_key" ${s.affinity_mode==="session_then_key"?"selected":""}>先看会话头，无则用下游 Key（推荐）</option>
        <option value="key" ${s.affinity_mode==="key"?"selected":""}>仅按下游 Key</option>
        <option value="session" ${s.affinity_mode==="session"?"selected":""}>仅按会话头</option>
        <option value="none" ${s.affinity_mode==="none"?"selected":""}>不粘性（纯负载均衡）</option>
      </select><div class="hint">绑定账号拥堵（预计等待 &gt; 3s）或冷却时自动改派并更新绑定</div></div>
      <div><label>站点优先级（401/403 自动换站）</label><select id="s_region">
        <option value="cn_first" ${s.region_priority==="cn_first"||!s.region_priority?"selected":""}>国内优先（401/403 自动切国际）</option>
        <option value="com_first" ${s.region_priority==="com_first"?"selected":""}>国际优先（401/403 自动切国内）</option>
        <option value="cn_only" ${s.region_priority==="cn_only"?"selected":""}>仅国内（不换站直接熔断）</option>
        <option value="com_only" ${s.region_priority==="com_only"?"selected":""}>仅国际（不换站直接熔断）</option>
        <option value="random" ${s.region_priority==="random"?"selected":""}>随机选择（401/403 自动切另一站）</option>
      </select><div class="hint">cn_first / com_first / random：API Key 被拒时自动切另一官方站点重发同一账号，成功后持久化该账号 base_url；cn_only / com_only：只打指定站点</div></div>
      ${fld("s_tier","生图默认档位", s.default_image_tier||"1k","text")}
      ${fld("s_retry","最大重试次数", s.retry_max??3,"number","生图/视频提交不参与 5xx 重试，避免重复扣费")}
      ${fld("s_rbase","退避基数（毫秒）", s.retry_base_backoff_ms??500)}
      ${fld("s_rmax","退避上限（毫秒）", s.retry_max_backoff_ms??8000)}
      ${fld("s_probe","探测模型", s.probe_model||"default-model","text","账号测试按钮用的最小文本模型")}
      ${fld("s_ttl","粘性绑定 TTL（小时）", s.session_ttl_hours??72)}
    </div>
    <div class="sec" style="display:flex;justify-content:flex-end">
      <button class="primary" id="btnSaveSettings" style="min-width:140px">保存全部设置</button>
    </div>
  </div>

  <div class="card">
    <div class="card-head"><h2>优化模式与记录</h2></div>
    <div class="grid g2">
      <div><label>优化模式</label><select id="s_opt_mode">
        <option value="serial" ${s.optimization_mode==="serial"?"selected":""}>串行 (Serial)</option>
        <option value="concurrent_batch" ${s.optimization_mode==="concurrent_batch"?"selected":""}>并发批处理 (Concurrent Batch)</option>
        <option value="concurrent_parallel" ${s.optimization_mode==="concurrent_parallel"?"selected":""}>并发并行 (Concurrent Parallel)</option>
      </select><div class="hint">concurrent_batch: 多账号并发处理批次请求; concurrent_parallel: 完全并行处理</div></div>
      ${fld("s_img_ret","图片记录保留天数", s.image_record_retention_days||30,"number","超过天数后自动清理历史记录")}
      ${fld("s_img_cap","图库最大容量（条）", s.image_max_capacity||500,"number","超过后自动淘汰最旧记录；0 = 不限制")}
      ${fld("s_vid_cap","视频库最大容量（条）", s.video_max_capacity||200,"number","超过后自动淘汰最旧记录；0 = 不限制")}
    </div>
  </div>

  <div class="card">
    <div class="card-head"><h2>迁移</h2>
      <span class="desc">导出不含密钥明文可安全归档；导入为追加模式，不覆盖现有账号</span></div>
    <div class="row">
      <button id="btnExport">导出配置（不含密钥）</button>
      <button id="btnExportFull">导出含密钥</button>
      <button id="btnExportCapture">导出 RawCapture 分析</button>
      <button id="btnImport" class="primary">导入配置</button>
    </div>
  </div>`;
}

export function bindSettingsEvents(){
  const save = document.getElementById("btnSaveSettings");
  if(!save) return;
  save.onclick = async ()=>{
    const g = id=>document.getElementById(id).value;
    const payload = {
      auto_model_name:g("s_auto_name"),
      free_models:g("s_free_models").split(",").map(x=>x.trim()).filter(Boolean),
      dead_models:g("s_dead_models").split(",").map(x=>x.trim()).filter(Boolean),
      auto_intent:{content_scan:g("s_scan")==="1", min_confidence:Number(g("s_conf")),
        default_image_size:g("s_isize"), image_input_field:g("s_ifield"),
        video_input_field:g("s_vfield"), video_wait_sec:Number(g("s_vwait")),
        preferred_models:{}},
      safety_factor:Number(g("s_safety")), pacing_window_sec:Number(g("s_window")),
      calibration_enabled:g("s_cal")==="1", penalty_cooldown_sec:Number(g("s_penalty")),
      penalty_factor:Number(g("s_pfactor")), min_learned_factor:Number(g("s_floor")),
      recover_successes:Number(g("s_recover")), queue_max_wait_ms:Number(g("s_qwait")),
      queue_max_size:Number(g("s_qsize")), keepalive_interval_ms:Number(g("s_keep")),
      image_concurrency:Number(g("s_imconc")), video_max_inflight:Number(g("s_vconc")),
      breaker_revive_sec:Number(g("s_brev")), affinity_mode:g("s_affinity"),
      region_priority:g("s_region"), default_image_tier:g("s_tier"), retry_max:Number(g("s_retry")),
      retry_base_backoff_ms:Number(g("s_rbase")), retry_max_backoff_ms:Number(g("s_rmax")),
      probe_model:g("s_probe"), session_ttl_hours:Number(g("s_ttl")),
      optimization_mode:g("s_opt_mode"), image_record_retention_days:Number(g("s_img_ret")),
      image_max_capacity:Number(g("s_img_cap")), video_max_capacity:Number(g("s_vid_cap")),
      free_text_rpm:Number(g("s_free_text_rpm")),
      scenario:g("s_scenario"),
      text_two_level_queue:document.getElementById("s_two_level")?document.getElementById("s_two_level").checked:false,
      auto_scenario:document.getElementById("s_auto_scenario")?document.getElementById("s_auto_scenario").checked:false,
      rate_limit_retry_max:Number(document.getElementById("s_rl_retry_max")?document.getElementById("s_rl_retry_max").value:0),
      rate_limit_wait_budget_ms:Number(document.getElementById("s_rl_wait_budget_s")?document.getElementById("s_rl_wait_budget_s").value*1000:0)
    };
    MODALITIES.forEach(m=>payload.auto_intent.preferred_models[m] =
      g("s_pref_"+m).split(",").map(x=>x.trim()).filter(Boolean));
    try{ await api("/api/settings",{method:"POST",body:JSON.stringify(payload)});
      toast("设置已保存并立即生效","good"); await refresh(); }
    catch(e){ toast(e.message,"bad"); }
  };
  const exp = ()=>()=>{ window.open("/api/export","_blank"); };
  document.getElementById("btnExport").onclick = exp();
  document.getElementById("btnExportFull").onclick = exp();
  document.getElementById("btnExportCapture").onclick = () => {
    window.open("/api/export/capture-analysis", "_blank");
  };
  const applySc = document.getElementById("btnApplyScenario");
  if(applySc) applySc.onclick = async ()=>{
    const name = document.getElementById("s_scenario").value;
    if(!name){ toast("请选择一个情景","warn"); return; }
    try{
      // 只发 scenario（后端 ApplyScenario 覆写整套旋钮），保留账号级 RPM 覆盖。
      await api("/api/settings",{method:"POST",body:JSON.stringify({scenario:name})});
      toast(`已应用「${name}」情景并即时生效`,"good");
      await refresh();
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
        await refresh();
      }catch(e){ toast(e.message,"bad"); }
    };
  }
  document.getElementById("btnImport").onclick = async ()=>{
    const text = prompt("粘贴导出的 JSON（会追加账号，不覆盖现有）"); if(!text) return;
    try{
      const data = JSON.parse(text);
      data.mode = "append";
      const r = await api("/api/import",{method:"POST",body:JSON.stringify(data)});
      toast(`已导入 ${r.accounts_imported} 个账号`,"good"); await refresh();
    }catch(e){ toast("导入失败："+e.message,"bad"); }
  };
}
