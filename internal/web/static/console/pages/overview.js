// 总览页:KPI + 到达密度 + 运行实况 + 账号负载。
import { api } from "../api.js";
import { state, POOLS, MODALITIES } from "../state.js";
import { esc, num, kpiCard, emptyBlock, badge } from "../ui.js";
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
  const over = ratio>=1;
  return `
  <div class="card">
    <div class="card-head">
      <h2>到达密度 vs 文本池节拍</h2>
      <span class="count">比值 ${ratio} · 均值 ${a.avg_per_sec} req/s · text ${a.text_rpm||"—"} RPM · 节拍 ${a.text_interval_ms||"—"}ms</span>
      <span class="grow"></span>
      ${badge(over?"warn":"ok", over?"账号吃满":"余量充足")}
    </div>
    <div style="padding:12px 16px">
      <div class="mini-hist">${bars}</div>
      <div class="muted" style="font-size:11px">最近 60 秒到达时间线 · <span style="color:var(--good)">绿 = 节拍内</span> · <span style="color:var(--warn)">橙 = 超节拍</span> · ${over?"多账号已被吃满":"到达密度低于节拍，账号数不是瓶颈"}</div>
    </div>
  </div>`;
}

export function viewOverview(){
  const s = state.stats || {}, m = s.metrics || {};
  const uls = m.upstream_429 || 0;
  const banner = uls === 0 ? "" :
    `<div class="banner warn">${uls} 次上游 429 —— 已自动下调该账号该池节拍，客户端请求排队兜底。</div>`;
  const accRows = (s.accounts||[]).map(a=>{
    const buckets = a.buckets||{};
    const active = POOLS.filter(p=>buckets[p] && buckets[p].rpm>0);
    const bars = active.map(p=>{
      const b = buckets[p]||{};
      const load = Math.min(100, Math.round((b.waiting? (b.projected_wait_ms/1000)*100/6 : 0)));
      return `<div style="margin-bottom:6px">
        <span class="badge ${b.factor<0.5?"warn":""}">${esc(p)} · ${b.rpm} RPM</span>
        <span class="cell-sub">排队 ${b.waiting} · 预计 ${Math.round((b.projected_wait_ms||0)/100)/10}s · 校准 ${b.factor}</span>
        <div class="bar" style="margin-top:3px"><i style="width:${load}%"></i></div>
      </div>`;
    }).join("");
    const declared = MODALITIES.map(mod=>{
      const list = [];
      active.forEach(p=>{ (buckets[p]?.declared||[]).forEach(x=>{ if(!list.includes(x)) list.push(x); }); });
      return list.length? `<div class="cell-sub">${esc(mod)}: <span class="mono">${esc(list.join(", "))}</span></div>`:"";
    }).join("");
    const st = [];
    st.push(a.enabled?badge("ok","启用"):badge("off","停用"));
    if(a.penalty_remaining_ms>0) st.push(`<span class="badge warn" title="429 冷却中">冷却 ${Math.round(a.penalty_remaining_ms/1000)}s</span>`);
    if(a.consecutive_failures && a.stats?.errors) st.push(`<span class="badge warn" title="连续失败 ${a.consecutive_failures}">连续失败 ${a.consecutive_failures}</span>`);
    return `<tr>
      <td><b>${esc(a.name)}</b>${a.group?` <span class="badge">${esc(a.group)}</span>`:""}
        <div class="cell-sub">${esc(a.access_type)}</div></td>
      <td style="white-space:nowrap">${st.join(" ")}</td>
      <td style="min-width:230px">${bars||'<span class="muted">无可用池</span>'}${declared}</td>
      <td class="num" style="white-space:nowrap">${num(a.stats?.requests)}<div class="cell-sub">错 ${num(a.stats?.errors)} · 限流 ${num(a.stats?.rate_limited)}</div></td>
    </tr>`;
  }).join("");
  return `
  ${banner}
  <div class="grid g4" style="margin-bottom:14px">
    ${kpiCard({label:"请求总数",value:num(m.requests_total)})}
    ${kpiCard({tone:"good",label:"成功",value:num(m.requests_ok)})}
    ${kpiCard({tone:uls?"good":"",label:"上游 429",value:num(uls),note:uls?"已自动排队兜底":"零限流"})}
    ${kpiCard({label:"排队过",value:num(m.queued_total)})}
    ${kpiCard({label:"平均等待",value:num(s.avg_wait_ms),unit:"ms"})}
    ${kpiCard({label:"粘性溢出",value:num(m.spillovers)})}
    ${kpiCard({tone:m.breaker_opened?"bad":"",label:"熔断 / 复活",value:`${num(m.breaker_opened)} <small>/</small> ${num(m.breaker_revived)}`})}
    ${kpiCard({label:"账号 / 密钥",value:`${num((s.accounts||[]).length)} <small>/</small> ${num(s.keys)}`})}
  </div>
  ${arrivalCard(s)}
  ${liveSection()}
  <div class="card">
    <div class="card-head"><h2>账号负载</h2><span class="grow"></span><span class="desc">各池节拍 · 排队 · 校准</span></div>
    <div class="tbl-wrap"><table>
      <thead><tr><th>账号</th><th>状态</th><th>各池节拍与已声明模型</th><th>累计</th></tr></thead>
      <tbody>${accRows||`<tr><td colspan="4">${emptyBlock("users","还没有账号，到「账号池」添加")}</td></tr>`}</tbody>
    </table></div>
  </div>`;
}

export function bindOverview(){
  bindLive();
}

/* 按需加载：本页只拉 /api/stats */
export async function loadOverview(){
  const s = await api("/api/stats");
  state.stats = s;
  state.overviewStats = s;
}
