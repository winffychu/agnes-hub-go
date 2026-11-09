// 总览页:信息层级对标 sub2api——状态横幅 → 4 主 KPI → 运行实况 → 账号负载 Top5。
// 首屏回答四问：网关活着吗 / 有没有限流 / 谁在消耗 / 量级多大。
// v2：429 横幅改近 5 分钟口径（累计值导致自愈后横幅常驻）；账号>20 时
// 「多账号分配」直方图降级为 Top8 堆叠条 + 计数徽章（51 根 1px 竖线噪音根治）。
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
  const accs = s.accounts||[];
  const okRate = m.requests_total ? Math.round(m.requests_ok/m.requests_total*100) : null;
  const errTotal = m.requests_error ?? 0;
  const cooldown = accs.filter(a=>a.penalty_remaining_ms>0).length;
  const breakerOpen = m.breaker_opened||0, breakerRevived = m.breaker_revived||0;
  const breakerLive = breakerOpen - breakerRevived; // 还在熔断里的（打开未复活）

  // 状态横幅：只反映「现在还在发生」的异常，自愈即消失。
  // requests_error / upstream_429 是进程启动以来累计值，用作横幅会让黄条常驻一整天；
  // 横幅口径 = 冷却中账号 + 未复活熔断（一旦恢复归零，横幅自动消失）。
  const active429 = cooldown + Math.max(0, breakerLive);
  const banner = active429 === 0 ? "" :
    `<div class="banner warn">${cooldown>0?`${cooldown} 个账号限流冷却中`:""}${cooldown>0&&Math.max(0,breakerLive)>0?" · ":""}${Math.max(0,breakerLive)>0?`${Math.max(0,breakerLive)} 个账号熔断未恢复`:""} —— 网关已自动降调节拍，<a href="#/accounts">查看账号 →</a></div>`;

  // 账号负载表：Top5（按请求量），其余引导到账号池页
  const sorted = accs.slice().sort((a,b)=>((b.stats?.requests)||0)-((a.stats?.requests)||0));
  const top5 = sorted.slice(0,5);
  const accRows = top5.map(a=>{
    const buckets = a.buckets||{};
    const active = POOLS.filter(p=>buckets[p] && buckets[p].rpm>0);
    const bars = active.slice(0,3).map(p=>{
      const b = buckets[p]||{};
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
    ${kpiCard({tone:ulsKpiTone(s),label:"上游 429",value:num(m.upstream_429),note:ulsNote(s)})}
    ${kpiCard({label:"账号 / 密钥",value:`${num(accs.length)} <small>/</small> ${num(s.keys)}`,note:accs.filter(a=>a.enabled).length+` 个启用`})}
  </div>

  <div class="card">
    <div class="card-head"><h2>运行指标</h2><span class="grow"></span>
      <span class="desc">排队 ${num(m.queued_total)} · 平均等待 ${num(s.avg_wait_ms)}ms · 粘性溢出 ${num(m.spillovers)} · 熔断 ${num(breakerOpen)}/${num(breakerRevived)}</span></div>
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

/* 429 KPI 的语义：看「现在还在不在被限流」（冷却中账号数），而非累计值 */
function ulsKpiTone(s){
  const cooling = (s.accounts||[]).filter(a=>a.penalty_remaining_ms>0).length;
  return cooling>0 ? "warn" : "good";
}
function ulsNote(s){
  const cooling = (s.accounts||[]).filter(a=>a.penalty_remaining_ms>0).length;
  return cooling>0 ? `${cooling} 个账号冷却中` : "零限流";
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
