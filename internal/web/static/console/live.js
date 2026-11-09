// 运行实况:每秒采样 /metrics-history,canvas 三图 + 缓动直方图。
import { api } from "./api.js";
import { state } from "./state.js";
import { esc } from "./ui.js";
import { setupCanvas, inkColor, cssVar, emptyHint, drawLines, drawAccountBars, liveAccCols } from "./charts.js";

const LIVE = { timer:null, win:"60s", hist:null, meta:[],
                barCur:null, barMoving:false, barDirty:true, barRaf:null };
function liveWantPoints(){ return LIVE.win==="30s"?30:(LIVE.win==="5m"?300:(LIVE.win==="1h"?360:60)); }
function liveUseCoarse(){ return LIVE.win==="1h"; }

export function liveSection(){
  const w = LIVE.win==="30s"?"最近 30 秒":(LIVE.win==="5m"?"最近 5 分钟":(LIVE.win==="1h"?"最近 1 小时":"最近 60 秒"));
  return `
  <div class="card">
    <div class="live-head">
      <h2 style="display:flex;align-items:center;gap:8px"><span class="live-dot" title="每秒自动采样，图表自动滚动"></span>运行实况</h2>
      <span id="liveBusy" class="busy-pill" title="正在被网关处理的请求：排队中 + 上游在途 + 还未进入转发的（读请求体/解析/意图判定）">网关空闲</span>
      <span class="muted" style="font-size:12px">每秒采样 · 自动滚动 · ${w}</span>
      <div style="flex:1"></div>
      <div class="win-pills" role="group" aria-label="时间窗口">
        ${["30s","60s","5m","1h"].map(x=>`<button class="win-pill ${LIVE.win===x?"on":""}" data-win="${x}">${x}</button>`).join("")}
      </div>
    </div>
    <div class="live-card">
      <h3>多账号分配 <span class="muted">各账号完成的请求占比</span></h3>
      <div class="sub2">Y 轴 = 账号名，X 轴 = 该账号在窗口内完成的请求占比。条形每秒平滑滑动，一眼看出「活都让谁干了」；条消失 = 该账号被限流 / 冷却 / 熔断中。</div>
      <canvas class="live-canvas" id="cvAcc"></canvas>
      <div class="live-legend" id="lgAcc"></div>
    </div>
    <div class="live-card">
      <h3>负载率 % <span class="muted">到达速率 ÷ text 池容量</span></h3>
      <div class="sub2"><span style="color:var(--good)">绿 &lt;70% 有余量</span> · <span style="color:var(--warn)">黄 70~100% 接近打满</span> · <span style="color:var(--bad)">红 ≥100% 排队兜底</span>。红虚线 = 池容量 100%。</div>
      <canvas class="live-canvas" id="cvLoad"></canvas>
      <div class="live-readout" id="roLoad"></div>
    </div>
    <div class="live-card">
      <h3>处理规模 <span class="muted">到达 / 完成 / 在途 / 排队</span></h3>
      <div class="sub2"><span style="color:var(--brand)">蓝</span>=到达 req/s · <span style="color:var(--good)">绿</span>=完成 req/s · <span style="color:var(--violet)">紫虚线</span>=在途 · <span style="color:var(--warn)">黄面积</span>=排队深度（右轴）。到达贴着完成 = 没积压。</div>
      <canvas class="live-canvas" id="cvScale"></canvas>
      <div class="live-readout" id="roScale"></div>
    </div>
    <div class="muted" style="font-size:11px">图表底部竖线：<span style="color:var(--bad)">红 = 上游 429</span> · <span style="color:var(--warn)">橙 = 熔断打开</span></div>
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

  // 「网关正在干活吗」——低频大任务时负载率恒接近 0，这里用绝对数说话。
  const last0=slice[slice.length-1]||{};
  const busy=(last0.pending||0)+(last0.queue_depth||0)+(last0.inflight||0);
  const busyEl=document.getElementById("liveBusy");
  if(busyEl){
    const half=Math.max(1,Math.round(slice.length/2));
    const sustained=slice.slice(-half).every(p=>((p.pending||0)+(p.inflight||0))>0);
    busyEl.className="busy-pill "+(busy===0?"":(sustained?"busy-warn":"busy-on"));
    busyEl.textContent = busy===0?"网关空闲":`网关正在处理 ${busy} 个请求`;
    busyEl.title = sustained
      ? "连续多个采样点都有请求没走完——若客户端一直在等，说明请求卡在网关内（见 healthz 的 pending）"
      : "正在被处理的请求数：待转发 + 排队 + 上游在途";
  }

  // ① 负载率
  const load=slice.map(p=>p.load_pct||0);
  const cur=load[load.length-1]||0;
  const peak=Math.max.apply(null,load);
  const avg=load.reduce((a,b)=>a+b,0)/load.length;
  const c1=cur>=100?cssVar("--bad","#d64545"):(cur>=70?cssVar("--warn","#e08a1e"):cssVar("--good","#2f9e6f"));
  drawLines(cvL,[{data:load,color:c1,fill:true}],{leftMax:Math.max(120,peak)*1.1,refY:[{v:100,color:cssVar("--bad","#d64545")}],events});
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
    {data:q,color:cssVar("--warn","#e08a1e"),fill:true,axis:"r"},
    {data:arrive,color:cssVar("--brand","#2f6fd6")},
    {data:done,color:cssVar("--good","#2f9e6f")},
    {data:inf,color:cssVar("--violet","#7a52c7"),width:1.5,dash:[4,3]}
  ],{leftMax:lmax,rightMax:rmax,events});
  const last=slice[slice.length-1]||{};
  document.getElementById("roScale").innerHTML=
    `<div class="ro"><b style="color:var(--brand)">${(last.arrive_rps||0).toFixed(1)}</b><span>到达 req/s</span></div>
     <div class="ro"><b style="color:var(--good)">${(last.done_rps||0).toFixed(1)}</b><span>完成 req/s</span></div>
     <div class="ro"><b style="color:var(--violet)">${last.inflight||0}</b><span>上游在途</span></div>
     <div class="ro"><b style="color:var(--warn)">${last.queue_depth||0}</b><span>排队</span></div>
     <div class="ro"><b>${last.pending||0}</b><span>待转发</span></div>
     <div class="ro"><b style="color:var(--bad)">${last.r429_pm||0}</b><span>429/分钟</span></div>`;

  // ③ 多账号分配（动态直方图）
  const meta=LIVE.meta||[];
  const cols=liveAccCols(slice);
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
  // 直方图缓动：两次采样之间用 rAF 让条形连续滑动
  const loop=()=>{
    if(state.tab==="overview" && document.visibilityState==="visible" && LIVE.barMoving){
      const cv=document.getElementById("cvAcc");
      if(cv && LIVE.meta && LIVE.meta.length && LIVE.hist){
        const sl=(LIVE.hist.points||[]).slice(-liveWantPoints());
        drawAccountBars(cv, LIVE.meta, liveAccCols(sl), sl.map(p=>p.events||0));
      }
    }
    LIVE.barRaf=requestAnimationFrame(loop);
  };
  LIVE.barRaf=requestAnimationFrame(loop);
}

let liveDelegated=false;
export function bindLive(){
  startLiveTimer();
  // 事件委托只绑一次：时间窗口按钮 HTML 重插后依然生效
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
