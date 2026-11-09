// 概览页：KPI + 实时三图 + 到达密度 + 账号负载。
import { api } from "../api.js";
import { state, POOLS, MODALITIES } from "../state.js";
import { esc, num, toast } from "../ui.js";
import { cssVar } from "../charts.js";
import { liveSection, bindLive } from "../live.js";

function arrivalCard(s){
  const a = s.arrival;
  if(!a || !Array.isArray(a.per_second) || a.per_second.length===0) return "";
  const maxVal = Math.max(1, ...a.per_second);
  // 迷你直方图（60 格，绿 = 节拍内，橙 = 超节拍）
  const intervalSec = a.text_interval_ms ? a.text_interval_ms/1000 : 3.0;
  const bars = a.per_second.map((v,i)=>{
    const h = Math.round(v/maxVal*100)||0;
    const over = intervalSec>0 && v > intervalSec;
    const color = over ? "var(--warn, #f59e0b)" : "var(--good, #22c55e)";
    return `<div title="${i}s 前 · ${v} req" style="height:28px;align-items:flex-end;display:flex">
      <div style="width:100%;height:${Math.max(2,h)}%;background:${v>0?color:cssVar("--muted","#555")};border-radius:1px;min-height:${v>0?2:0}px"></div></div>`;
  }).join("");
  const ratio = a.ratio||0;
  const ratioColor = ratio>=1?"var(--good,#22c55e)":"var(--warn,#f59e0b)";
  const ratioLabel = ratio>=1?"到达密度 ≥ 节拍，多账号已被吃到":
    ratio>=0.5?"到达密度接近节拍，账号数基本用满":
    "到达密度低于节拍，账号数不是瓶颈（宿主在串行）";
  return `
  <div class="card" style="margin-bottom:14px">
    <h2>到达密度 vs 文本池节拍 <span class="muted" style="font-size:12px">（多账号吞吐判定）</span></h2>
    <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start">
      <div style="flex:1;min-width:240px">
        <div style="display:flex;gap:2px;align-items:flex-end;height:28px;margin-bottom:4px">${bars}</div>
        <div class="muted" style="font-size:11px">最近 60 秒到达时间线（绿 = 节拍内 · 橙 = 超节拍）</div>
      </div>
      <div style="min-width:180px">
        <div style="font-size:24px;font-weight:600;color:${ratioColor}">${num(a.active_60s)}<span style="font-size:13px;color:inherit;font-weight:400"> / 60s</span></div>
        <div class="muted" style="font-size:12px">均值 ${a.avg_per_sec} req/s · text ${a.text_rpm||"—"} RPM · 节拍 ${a.text_interval_ms||"—"}ms</div>
        <div class="muted" style="font-size:12px;margin-top:6px;padding:6px 10px;background:rgba(0,0,0,.04);border-radius:6px">
          <span style="color:${ratioColor};font-weight:600">比值 ${ratio}</span>：${ratioLabel}
        </div>
      </div>
    </div>
  </div>`;
}


export function viewOverview(){
  const s = state.stats || {}, m = s.metrics || {};
  const uls = m.upstream_429 || 0;
  const banner = uls === 0
    ? `<div class="banner good">上游 429 次数为 0 —— 限流排队生效，客户端没有被限流过。</div>`
    : `<div class="banner warn">上游已返回 ${uls} 次 429。系统会自动下调该账号该池的节拍（其它池不受影响），并已把客户端请求排队而非报错。</div>`;
  const accRows = (s.accounts||[]).map(a=>{
    const buckets = a.buckets||{};
    const active = POOLS.filter(p=>buckets[p] && buckets[p].rpm>0);
    const bars = active.map(p=>{
      const b = buckets[p]||{};
      const load = Math.min(100, Math.round((b.waiting? (b.projected_wait_ms/1000)*100/6 : 0)));
      return `<div style="margin-bottom:4px">
        <span class="pill ${b.factor<1?"warn":""}">${esc(p)} · ${b.rpm} RPM</span>
        <span class="muted" style="font-size:11px">排队 ${b.waiting} 人 · 预计 ${Math.round((b.projected_wait_ms||0)/100)/10}s · 校准 ${b.factor}</span>
        <div class="bar"><i style="width:${load}%"></i></div>
      </div>`;
    }).join("");
    const declared = MODALITIES.map(mod=>{
      const list = [];
      active.forEach(p=>{ (buckets[p]?.declared||[]).forEach(x=>{ if(!list.includes(x)) list.push(x); }); });
      return list.length? `<div class="muted" style="font-size:11px">${esc(mod)}: <span class="mono">${esc(list.join(", "))}</span></div>`:"";
    }).join("");
    return `<tr>
      <td><b>${esc(a.name)}</b>${a.group?` <span class="pill">${esc(a.group)}</span>`:""}
        <div class="muted" style="font-size:11px">${esc(a.access_type)}</div></td>
      <td>${a.enabled?'<span class="pill ok">启用</span>':'<span class="pill off">停用</span>'}
        ${a.penalty_remaining_ms>0?`<span class="pill warn">冷却 ${Math.round(a.penalty_remaining_ms/1000)}s</span>`:""}
        ${a.consecutive_failures && a.stats?.errors ? `<span class="pill warn" title="连续失败 ${a.consecutive_failures}">连续失败 ${a.consecutive_failures}</span>` : ''}</td>
      <td style="min-width:210px">${bars||'<span class="muted">无可用池</span>'}${declared}</td>
      <td class="mono">${num(a.stats?.requests)} / 错误 ${num(a.stats?.errors)} / 限流 ${num(a.stats?.rate_limited)}</td>
    </tr>`;
  }).join("");
  return `
  ${banner}
  ${liveSection()}
  <div class="grid g4" style="margin-bottom:14px">
    <div class="kpi"><div class="k">请求总数</div><div class="v">${num(m.requests_total)}</div></div>
    <div class="kpi"><div class="k">成功</div><div class="v">${num(m.requests_ok)}</div></div>
    <div class="kpi"><div class="k" style="color:${uls?"var(--good)":"var(--muted)"}">上游 429</div><div class="v" style="color:${uls?"var(--good)":"inherit"}">${num(uls)}</div></div>
    <div class="kpi"><div class="k">排队过</div><div class="v">${num(m.queued_total)}</div></div>
    <div class="kpi"><div class="k">平均等待</div><div class="v">${num(s.avg_wait_ms)}<span style="font-size:13px">ms</span></div></div>
    <div class="kpi"><div class="k">粘性溢出</div><div class="v">${num(m.spillovers)}</div><div class="muted" style="font-size:11px">绑定账号拥堵时改派次数</div></div>
    <div class="kpi"><div class="k">熔断 / 复活</div><div class="v">${num(m.breaker_opened)} / ${num(m.breaker_revived)}</div></div>
    <div class="kpi"><div class="k">账号 / 密钥</div><div class="v">${num((s.accounts||[]).length)} / ${num(s.keys)}</div></div>
  </div>
  ${arrivalCard(s)}
  <div class="card">
    <h2>账号负载</h2>
    <div class="scroll"><table>
      <thead><tr><th>账号</th><th>状态</th><th>各池节拍与已声明模型</th><th>累计</th></tr></thead>
      <tbody>${accRows||'<tr><td colspan="4" class="muted">还没有账号，请到「账号池」添加</td></tr>'}</tbody>
    </table></div>
  </div>`;
}


export function bindOverview(){
  bindLive();
}
