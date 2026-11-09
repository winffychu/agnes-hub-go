// 概览页:KPI 语义色卡 + 实时三图 + 到达密度 + 账号负载。
import { api } from "../api.js";
import { state, POOLS, MODALITIES } from "../state.js";
import { esc, num, kpiCard, emptyBlock } from "../ui.js";
import { liveSection, bindLive } from "../live.js";

function arrivalCard(s){
  const a = s.arrival;
  if(!a || !Array.isArray(a.per_second) || a.per_second.length===0) return "";
  const maxVal = Math.max(1, ...a.per_second);
  const intervalSec = a.text_interval_ms ? a.text_interval_ms/1000 : 3.0;
  const bars = a.per_second.map((v,i)=>{
    const h = Math.max(4, Math.round(v/maxVal*100));
    const over = intervalSec>0 && v > intervalSec;
    const color = over ? "var(--warn)" : (v>0 ? "var(--good)" : "var(--line)");
    return `<div class="mh" title="${i}s 前 · ${v} req"><i style="height:${h}%;background:${color}"></i></div>`;
  }).join("");
  const ratio = a.ratio||0;
  const ratioTone = ratio>=1?"good":"warn";
  const ratioPill = `<span class="pill ${ratioTone}">比值 ${ratio}</span>`;
  const ratioLabel = ratio>=1?"到达密度 ≥ 节拍，多账号已被吃满":
    ratio>=0.5?"到达密度接近节拍，账号数基本用满":
    "到达密度低于节拍，账号数不是瓶颈（宿主在串行）";
  return `
  <div class="card">
    <div class="card-head">
      <h2>到达密度 vs 文本池节拍<span class="tag">多账号吞吐判定</span></h2>
      ${ratioPill}
    </div>
    <div style="display:flex;gap:20px;flex-wrap:wrap;align-items:flex-start">
      <div style="flex:1;min-width:240px">
        <div class="mini-hist">${bars}</div>
        <div class="muted" style="font-size:11px">最近 60 秒到达时间线 · <span style="color:var(--good)">绿 = 节拍内</span> · <span style="color:var(--warn)">橙 = 超节拍</span></div>
      </div>
      <div style="min-width:200px">
        <div class="num" style="font-size:22px;font-weight:700">${num(a.active_60s)}<small class="muted" style="font-size:12px;font-weight:500"> / 60s</small></div>
        <div class="cell-sub muted" style="font-size:12px">均值 ${a.avg_per_sec} req/s · text ${a.text_rpm||"—"} RPM · 节拍 ${a.text_interval_ms||"—"}ms</div>
        <div class="hint" style="margin-top:8px;padding:8px 10px;background:var(--panel-2);border-radius:8px;line-height:1.5">${ratioLabel}</div>
      </div>
    </div>
  </div>`;
}

export function viewOverview(){
  const s = state.stats || {}, m = s.metrics || {};
  const uls = m.upstream_429 || 0;
  const banner = uls === 0
    ? `<div class="banner good">✓ 上游 429 次数为 0 —— 限流排队生效，客户端没有被限流过。</div>`
    : `<div class="banner warn">⚠ 上游已返回 ${uls} 次 429。系统自动下调该账号该池的节拍（其它池不受影响），并已把客户端请求排队而非报错。</div>`;
  const accRows = (s.accounts||[]).map(a=>{
    const buckets = a.buckets||{};
    const active = POOLS.filter(p=>buckets[p] && buckets[p].rpm>0);
    const bars = active.map(p=>{
      const b = buckets[p]||{};
      const load = Math.min(100, Math.round((b.waiting? (b.projected_wait_ms/1000)*100/6 : 0)));
      return `<div style="margin-bottom:6px">
        <span class="pill ${b.factor<1?"warn":""}">${esc(p)} · ${b.rpm} RPM</span>
        <span class="cell-sub">排队 ${b.waiting} · 预计 ${Math.round((b.projected_wait_ms||0)/100)/10}s · 校准 ${b.factor}</span>
        <div class="bar" style="margin-top:3px"><i style="width:${load}%"></i></div>
      </div>`;
    }).join("");
    const declared = MODALITIES.map(mod=>{
      const list = [];
      active.forEach(p=>{ (buckets[p]?.declared||[]).forEach(x=>{ if(!list.includes(x)) list.push(x); }); });
      return list.length? `<div class="cell-sub">${esc(mod)}: <span class="mono">${esc(list.join(", "))}</span></div>`:"";
    }).join("");
    const statusPills = [];
    statusPills.push(a.enabled?'<span class="pill ok">启用</span>':'<span class="pill off">停用</span>');
    if(a.penalty_remaining_ms>0) statusPills.push(`<span class="pill warn" title="429 冷却中">冷却 ${Math.round(a.penalty_remaining_ms/1000)}s</span>`);
    if(a.consecutive_failures && a.stats?.errors) statusPills.push(`<span class="pill warn" title="连续失败 ${a.consecutive_failures}">连续失败 ${a.consecutive_failures}</span>`);
    return `<tr>
      <td><b>${esc(a.name)}</b>${a.group?` <span class="pill">${esc(a.group)}</span>`:""}
        <div class="cell-sub">${esc(a.access_type)}</div></td>
      <td style="white-space:nowrap">${statusPills.join(" ")}</td>
      <td style="min-width:230px">${bars||'<span class="muted">无可用池</span>'}${declared}</td>
      <td class="num" style="white-space:nowrap">${num(a.stats?.requests)}<div class="cell-sub">错 ${num(a.stats?.errors)} · 限流 ${num(a.stats?.rate_limited)}</div></td>
    </tr>`;
  }).join("");
  return `
  ${banner}
  <div class="grid g4" style="margin-bottom:14px">
    ${kpiCard({icon:"⚡",tone:"",label:"请求总数",value:num(m.requests_total)})}
    ${kpiCard({icon:"✓",tone:"good",label:"成功",value:num(m.requests_ok)})}
    ${kpiCard({icon:"🛡",tone:uls?"good":"",label:"上游 429",value:num(uls),note:uls?"已自动排队兜底":"零限流"})}
    ${kpiCard({icon:"⏳",tone:"cyan",label:"排队过",value:num(m.queued_total)})}
    ${kpiCard({icon:"🕐",tone:"violet",label:"平均等待",value:num(s.avg_wait_ms),unit:"ms"})}
    ${kpiCard({icon:"🔀",tone:"cyan",label:"粘性溢出",value:num(m.spillovers),note:"绑定拥堵时改派次数"})}
    ${kpiCard({icon:"🔥",tone:"bad",label:"熔断 / 复活",value:`${num(m.breaker_opened)} <small>/</small> ${num(m.breaker_revived)}`})}
    ${kpiCard({icon:"👥",tone:"",label:"账号 / 密钥",value:`${num((s.accounts||[]).length)} <small>/</small> ${num(s.keys)}`})}
  </div>
  ${arrivalCard(s)}
  ${liveSection()}
  <div class="card">
    <div class="card-head">
      <h2>账号负载</h2>
      <span class="desc">各池节拍、排队与校准状态；模型声明按模态归并展示</span>
    </div>
    <div class="tbl-wrap"><table>
      <thead><tr><th>账号</th><th>状态</th><th>各池节拍与已声明模型</th><th>累计</th></tr></thead>
      <tbody>${accRows||`<tr><td colspan="4">${emptyBlock("👥","还没有账号，请到「账号池」添加")}</td></tr>`}</tbody>
    </table></div>
  </div>`;
}

export function bindOverview(){
  bindLive();
}
