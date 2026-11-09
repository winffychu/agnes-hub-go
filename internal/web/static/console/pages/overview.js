// 总览页:信息层级对标 sub2api——状态横幅 → 4 主 KPI → 运行实况 → 账号负载 Top5。
// 首屏回答四问：网关活着吗 / 有没有限流 / 谁在消耗 / 量级多大。
import { api } from "../api.js";
import { state, POOLS, MODALITIES } from "../state.js";
import { esc, num, kpiCard, emptyBlock, badge, errorBlock, bindErrorRetry } from "../ui.js";
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
      <span class="count">比值 ${ratio} · 均值 ${a.avg_per_sec} req/s · text ${a.text_rpm||"—"} RPM</span>
      <span class="grow"></span>
      ${badge(over?"warn":"ok", over?"账号吃满":"余量充足")}
    </div>
    <div style="padding:12px 16px">
      <div class="mini-hist">${bars}</div>
      <div class="muted" style="font-size:11px">最近 60 秒 · <span style="color:var(--good)">绿 = 节拍内</span> · <span style="color:var(--warn)">橙 = 超节拍</span> · ${over?"多账号已被吃满，考虑补号":"账号数不是瓶颈"}</div>
    </div>
  </div>`;
}

export function viewOverview(){
  const s = state.stats || {}, m = s.metrics || {};
  const uls = m.upstream_429 || 0;
  const accs = s.accounts||[];
  const okRate = m.requests_total ? Math.round(m.requests_ok/m.requests_total*100) : null;
  const errTotal = m.requests_error ?? 0;

  // 状态横幅：只在异常时出现（绿横幅是噪音）
  const banner = uls === 0 ? "" :
    `<div class="banner warn">${uls} 次上游 429 —— 已自动下调节拍并排队兜底。<a href="#/logs" style="margin-left:6px">查看日志 →</a></div>`;

  // 账号负载表：Top5（按请求量），其余引导到账号池页
  const sorted = accs.slice().sort((a,b)=>((b.stats?.requests)||0)-((a.stats?.requests)||0));
  const top5 = sorted.slice(0,5);
  const accRows = top5.map(a=>{
    const buckets = a.buckets||{};
    const active = POOLS.filter(p=>buckets[p] && buckets[p].rpm>0);
    const bars = active.slice(0,3).map(p=>{
      const b = buckets[p]||{};
      const load = Math.min(100, Math.round((b.waiting? (b.projected_wait_ms/1000)*100/6 : 0)));
      return `<span class="badge" title="${esc(p)} 排队 ${b.waiting} · 校准 ${b.factor}">${esc(p)} ${b.rpm} RPM${b.waiting?` · 排${b.waiting}`:""}</span>`;
    }).join(" ");
    const st = [];
    st.push(a.enabled?badge("ok","启用"):badge("off","停用"));
    if(a.penalty_remaining_ms>0) st.push(`<span class="badge warn" title="429 冷却中">冷却 ${Math.round(a.penalty_remaining_ms/1000)}s</span>`);
    return `<tr>
      <td><b>${esc(a.name)}</b>${a.group?` <span class="badge">${esc(a.group)}</span>`:""}
        <div class="cell-sub">${esc(a.access_type)}</div></td>
      <td style="white-space:nowrap">${st.join(" ")}</td>
      <td>${bars||'<span class="muted">无可用池</span>'}</td>
      <td class="num" style="white-space:nowrap">${num(a.stats?.requests)}<div class="cell-sub">错 ${num(a.stats?.errors)}</div></td>
    </tr>`;
  }).join("");

  return `
  ${banner}
  <div class="grid g4" style="margin-bottom:14px">
    ${kpiCard({label:"请求总数",value:num(m.requests_total),note:okRate!=null?`成功率 ${okRate}%`:undefined})}
    ${kpiCard({tone:errTotal?"warn":"good",label:"错误",value:num(errTotal)})}
    ${kpiCard({tone:uls?"warn":"good",label:"上游 429",value:num(uls),note:uls?"已排队兜底":"零限流"})}
    ${kpiCard({label:"账号 / 密钥",value:`${num(accs.length)} <small>/</small> ${num(s.keys)}`,note:accs.filter(a=>a.enabled).length+` 个启用`})}
  </div>

  <div class="card">
    <div class="card-head"><h2>运行指标</h2><span class="grow"></span>
      <span class="desc">排队 ${num(m.queued_total)} · 平均等待 ${num(s.avg_wait_ms)}ms · 粘性溢出 ${num(m.spillovers)} · 熔断 ${num(m.breaker_opened)}/${num(m.breaker_revived)}</span></div>
    <div style="padding:12px 16px">
      ${arrivalCard(s)}
    </div>
  </div>

  ${liveSection()}

  <div class="card">
    <div class="card-head"><h2>账号负载 Top 5</h2><span class="grow"></span>
      <a href="#/accounts" class="muted" style="font-size:12.5px">全部 ${accs.length} 个账号 →</a></div>
    <div class="tbl-wrap"><table>
      <thead><tr><th>账号</th><th>状态</th><th>池节拍</th><th>累计请求</th></tr></thead>
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
