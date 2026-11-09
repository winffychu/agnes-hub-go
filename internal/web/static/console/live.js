// 运行实况：每秒采样 /api/metrics-history，三块 canvas 图 + 缓动直方图。
// 事件委托只绑一次；类名对齐 v3（.seg 时间窗 / .live-block 分块）。
import { api } from "./api.js";
import { state } from "./state.js";
import { esc } from "./ui.js";
import { cssVar, emptyHint, drawLines, drawAccountBars, liveAccCols } from "./charts.js";

const LIVE = { timer:null, win:"60s", hist:null, meta:[] };
function liveWantPoints(){ return LIVE.win==="30s"?30:(LIVE.win==="5m"?300:(LIVE.win==="1h"?360:60)); }
function liveUseCoarse(){ return LIVE.win==="1h"; }

export function liveSection(){
  const w = LIVE.win==="30s"?"最近 30 秒":(LIVE.win==="5m"?"最近 5 分钟":(LIVE.win==="1h"?"最近 1 小时":"最近 60 秒"));
  return `
  <div class="card">
    <div class="card-head" style="flex-wrap:wrap">
      <h2 style="display:flex;align-items:center;gap:8px"><span class="live-dot" title="每秒自动采样"></span>运行实况</h2>
      <span id="liveBusy" class="busy-pill">网关空闲</span>
      <span class="desc">${w} · 每秒采样 · 自动滚动</span>
      <span class="grow"></span>
      <div class="seg" role="group" aria-label="时间窗口">
        ${["30s","60s","5m","1h"].map(x=>`<button class="win-pill ${LIVE.win===x?"on":""}" data-win="${x}">${x}</button>`).join("")}
      </div>
    </div>
    <div style="padding:4px 16px 12px">
    <div class="live-block">
      <h3>多账号分配 <span class="muted">窗口内各账号完成请求占比</span></h3>
      <canvas class="live-canvas" id="cvAcc"></canvas>
      <div class="live-legend" id="lgAcc"></div>
    </div>
    <div class="live-block">
      <h3>负载率 <span class="muted">到达速率 ÷ text 池容量</span></h3>
      <canvas class="live-canvas" id="cvLoad"></canvas>
      <div class="live-readout" id="roLoad"></div>
    </div>
    <div class="live-block">
      <h3>处理规模 <span class="muted">到达 / 完成 / 在途 / 排队</span></h3>
      <canvas class="live-canvas" id="cvScale"></canvas>
      <div class="live-readout" id="roScale"></div>
    </div>
    <div class="muted" style="font-size:11px;margin-top:2px">底部刻度：<span style="color:var(--bad)">红 = 上游 429</span> · <span style="color:var(--warn)">橙 = 熔断打开</span></div>
    </div>
  </div>`;
}

export function drawLive(){
  if(!LIVE.hist) return;
  const cvL=document.getElementById("cvLoad"), cvS=document.getElementById("cvScale"), cvA=document.getElementById("cvAcc");
  if(!cvL||!cvS||!cvA) return;
  const slice=(LIVE.hist.points||[]).slice(-liveWantPoints());
  if(!slice.length){
    emptyHint(cvL,"采样中…"); emptyHint(cvS,"采样中…"); emptyHint(cvA,"采样中…"); return;
  }
  const events=slice.map(p=>p.events||0);

  // 「网关在干活吗」：低频大任务下负载率恒近 0，用绝对数说话。
  const last0=slice[slice.length-1]||{};
  const busy=(last0.pending||0)+(last0.queue_depth||0)+(last0.inflight||0);
  const busyEl=document.getElementById("liveBusy");
  if(busyEl){
    const half=Math.max(1,Math.round(slice.length/2));
    const sustained=slice.slice(-half).every(p=>((p.pending||0)+(p.inflight||0))>0);
    busyEl.className="busy-pill "+(busy===0?"":(sustained?"busy-warn":"busy-on"));
    busyEl.textContent = busy===0?"网关空闲":`正在处理 ${busy} 个请求`;
  }

  // ① 负载率
  const load=slice.map(p=>p.load_pct||0);
  const cur=load[load.length-1]||0;
  const peak=Math.max.apply(null,load);
  const avg=load.reduce((a,b)=>a+b,0)/load.length;
  const c1=cur>=100?cssVar("--bad","#dc2626"):(cur>=70?cssVar("--warn","#a16207"):cssVar("--good","#15803d"));
  drawLines(cvL,[{data:load,color:c1,fill:true}],{leftMax:Math.max(120,peak)*1.1,refY:[{v:100,color:cssVar("--bad","#dc2626")}],events});
  document.getElementById("roLoad").innerHTML=
    `<div class="ro"><b style="color:${c1}">${cur.toFixed(0)}%</b><span>当前</span></div>
     <div class="ro"><b>${peak.toFixed(0)}%</b><span>峰值</span></div>
     <div class="ro"><b>${avg.toFixed(0)}%</b><span>均值</span></div>`;

  // ② 处理规模
  const arrive=slice.map(p=>p.arrive_rps||0), done=slice.map(p=>p.done_rps||0);
  const inf=slice.map(p=>p.inflight||0), q=slice.map(p=>p.queue_depth||0);
  const lmax=Math.max(5,Math.max.apply(null,arrive.concat(done,inf)))*1.25;
  const rmax=Math.max(2,Math.max.apply(null,q))*1.3;
  drawLines(cvS,[
    {data:q,color:cssVar("--warn","#a16207"),fill:true,axis:"r"},
    {data:arrive,color:cssVar("--accent","#2563eb")},
    {data:done,color:cssVar("--good","#15803d")},
    {data:inf,color:cssVar("--muted","#71717a"),width:1.5,dash:[4,3]}
  ],{leftMax:lmax,rightMax:rmax,events});
  const last=slice[slice.length-1]||{};
  document.getElementById("roScale").innerHTML=
    `<div class="ro"><b style="color:var(--accent)">${(last.arrive_rps||0).toFixed(1)}</b><span>到达 req/s</span></div>
     <div class="ro"><b style="color:var(--good)">${(last.done_rps||0).toFixed(1)}</b><span>完成 req/s</span></div>
     <div class="ro"><b>${last.inflight||0}</b><span>上游在途</span></div>
     <div class="ro"><b style="color:var(--warn)">${last.queue_depth||0}</b><span>排队</span></div>
     <div class="ro"><b>${last.pending||0}</b><span>待转发</span></div>
     <div class="ro"><b style="color:var(--bad)">${last.r429_pm||0}</b><span>429/分</span></div>`;

  // ③ 多账号分配（动态直方图）
  const meta=LIVE.meta||[];
  const cols=liveAccCols(slice, meta);
  drawAccountBars(cvA,meta,cols,events);
  const sums=new Array(meta.length).fill(0);
  for(const col of cols){ for(let i=0;i<meta.length;i++){ sums[i]+=(col[i]||0); } }
  const lt=sums.reduce((a,b)=>a+b,0)||0;
  document.getElementById("lgAcc").innerHTML = meta.map((m,i)=>{
    const pct = lt>0 ? Math.round((sums[i]||0)/lt*100) : 0;
    return `<span class="lg"><i style="background:${m.color}"></i>${esc(m.name||m.id)} ${pct}%</span>`;
  }).join("") || `<span class="muted" style="font-size:12px">还没有账号</span>`;
}

async function liveTick(){
  if(state.tab!=="overview" || document.visibilityState!=="visible") return;
  if(!document.getElementById("cvLoad")) return;
  try{
    LIVE.hist = await api("/api/metrics-history?win="+(liveUseCoarse()?"coarse":"fine"));
    LIVE.meta = LIVE.hist.accounts||[];
    drawLive();
  }catch(e){ /* 静默：下一次 tick 自动重试 */ }
}

function startLiveTimer(){
  if(LIVE.timer) return;
  LIVE.timer = setInterval(liveTick, 1000);
  document.addEventListener("visibilitychange", ()=>{ if(document.visibilityState==="visible") liveTick(); });
  window.addEventListener("resize", ()=>{ if(state.tab==="overview") drawLive(); });
  // 直方图缓动：两次采样之间用 rAF 让条形连续滑动（读到 moving=false 就只做空转）
  const loop=()=>{
    if(state.tab==="overview" && document.visibilityState==="visible" && drawAccountBars.moving){
      const cv=document.getElementById("cvAcc");
      if(cv && LIVE.meta && LIVE.meta.length && LIVE.hist){
        const sl=(LIVE.hist.points||[]).slice(-liveWantPoints());
        drawAccountBars(cv, LIVE.meta, liveAccCols(sl, LIVE.meta), sl.map(p=>p.events||0));
      }
    }
    LIVE.barRaf=requestAnimationFrame(loop);
  };
  LIVE.barRaf=requestAnimationFrame(loop);
}

let liveDelegated=false;
export function bindLive(){
  startLiveTimer();
  // 时间窗按钮走事件委托：HTML 重插后依然生效
  if(!liveDelegated){
    liveDelegated=true;
    document.addEventListener("click",(ev)=>{
      const b=ev.target.closest(".win-pill");
      if(!b) return;
      LIVE.win=b.dataset.win;
      document.querySelectorAll(".win-pill").forEach(x=>x.classList.toggle("on",x.dataset.win===LIVE.win));
      liveTick();
    });
  }
  liveTick();
}
