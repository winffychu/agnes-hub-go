// Canvas 图表（实时三图 + 账号分配直方图），主题色经 cssVar 运行时取值。
export function setupCanvas(cv){
  const dpr = window.devicePixelRatio||1;
  const w = cv.clientWidth||600, h = cv.clientHeight||150;
  const cw = Math.round(w*dpr), ch = Math.round(h*dpr);
  if(cv.width!==cw||cv.height!==ch){ cv.width=cw; cv.height=ch; }
  const ctx = cv.getContext("2d");
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.clearRect(0,0,w,h);
  return {ctx,w,h};
}

export function inkColor(){ return getComputedStyle(document.body).color || "#5b6573"; }

export function cssVar(name, fallback){
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export function emptyHint(cv, text){
  const {ctx,w,h}=setupCanvas(cv);
  ctx.globalAlpha=.55; ctx.fillStyle=inkColor(); ctx.font="12px sans-serif"; ctx.textAlign="center";
  ctx.fillText(text, w/2, h/2); ctx.globalAlpha=1;
}


export function drawLines(cv, series, opts){
  const {ctx,w,h}=setupCanvas(cv);
  const padL=36, padR=opts.rightMax?34:12, padT=8, padB=18;
  const plotW=w-padL-padR, plotH=h-padT-padB;
  const ink=inkColor();
  ctx.strokeStyle="rgba(140,140,140,.22)"; ctx.lineWidth=1; ctx.font="10px sans-serif";
  for(let g=0;g<=4;g++){
    const y=padT+plotH*g/4;
    ctx.beginPath(); ctx.moveTo(padL,y); ctx.lineTo(w-padR,y); ctx.stroke();
    ctx.globalAlpha=.7; ctx.fillStyle=ink;
    ctx.textAlign="right"; ctx.textBaseline="middle";
    ctx.fillText(String(Math.round(opts.leftMax*(1-g/4))), padL-5, y);
    if(opts.rightMax){ ctx.textAlign="left"; ctx.fillText(String(Math.round(opts.rightMax*(1-g/4))), w-padR+5, y); }
    ctx.globalAlpha=1;
  }
  const n = Math.max(1, Math.max.apply(null, series.map(s=>s.data.length||0)));
  if(n<2){ emptyHint(cv,"采样中…每秒一个点，稍等即出"); return; }
  const xAt=i=>padL+(i/(n-1))*plotW;
  series.forEach(s=>{
    const max=(s.axis==="r"?opts.rightMax:opts.leftMax)||1;
    const yAt=v=>padT+plotH-Math.max(0,Math.min((v||0)/max,1))*plotH;
    if(s.fill){
      ctx.beginPath(); ctx.moveTo(xAt(0),padT+plotH);
      s.data.forEach((v,i)=>ctx.lineTo(xAt(i),yAt(v)));
      ctx.lineTo(xAt(s.data.length-1),padT+plotH); ctx.closePath();
      ctx.fillStyle=s.color; ctx.globalAlpha=.17; ctx.fill(); ctx.globalAlpha=1;
    }
    ctx.beginPath();
    s.data.forEach((v,i)=>{ const x=xAt(i),y=yAt(v); if(i===0)ctx.moveTo(x,y); else ctx.lineTo(x,y); });
    ctx.strokeStyle=s.color; ctx.lineWidth=s.width||2;
    if(s.dash) ctx.setLineDash(s.dash);
    ctx.stroke(); ctx.setLineDash([]);
  });
  (opts.refY||[]).forEach(r=>{
    const max=(r.axis==="r"?opts.rightMax:opts.leftMax)||1;
    const y=padT+plotH-Math.min(r.v/max,1)*plotH;
    ctx.beginPath(); ctx.moveTo(padL,y); ctx.lineTo(w-padR,y);
    ctx.strokeStyle=r.color; ctx.setLineDash([4,4]); ctx.lineWidth=1; ctx.stroke(); ctx.setLineDash([]);
  });
  (opts.events||[]).forEach((e,i)=>{
    if(!e) return;
    const x=padL+(i/(n-1))*plotW;
    ctx.fillStyle=(e&1)?cssVar("--bad","#d64545"):cssVar("--warn","#e08a1e");
    ctx.fillRect(x-1, h-padB+3, 2, 6);
  });
}


export function drawAccountBars(cv, meta, cols, events){
  const {ctx,w,h}=setupCanvas(cv);
  const rows=(meta||[]).length;
  if(!rows){ emptyHint(cv,"采样中…"); return; }

  const padT=8, padB=18, padR=46;
  const padL=Math.max(54, Math.min(116, Math.round(w*0.22)));
  const plotW=Math.max(20, w-padL-padR), plotH=Math.max(20, h-padT-padB);

  // 窗口内各账号完成总量 → 占比
  const sums=new Array(rows).fill(0);
  for(const col of cols){ for(let k=0;k<rows;k++){ sums[k]+=(col[k]||0); } }
  const total=sums.reduce((a,b)=>a+b,0);
  const shares=sums.map(v=> total>0 ? v/total : 0);

  // 缓动：当前显示值向目标值滑动（首帧直接对齐，避免从 0 长出来）。
  // 状态挂在函数自身属性上（barCur 当前值 / moving 是否仍在滑动），供 rAF 循环读取。
  if(!drawAccountBars.barCur || drawAccountBars.barCur.length!==rows){ drawAccountBars.barCur=shares.slice(); }
  let moving=false;
  for(let k=0;k<rows;k++){
    const d=shares[k]-drawAccountBars.barCur[k];
    if(Math.abs(d)>=0.001){ moving=true; drawAccountBars.barCur[k]+=d*0.28; }
    else { drawAccountBars.barCur[k]=shares[k]; }
  }
  drawAccountBars.moving=moving;

  const peak=shares.reduce((a,b)=>Math.max(a,b),0);
  const xMax=Math.max(0.25, Math.min(1, Math.ceil((peak+0.02)*10)/10));
  const xAt=v=>padL+Math.min(1,Math.max(0,v/xMax))*plotW;

  // 竖向网格 + x 轴百分比刻度
  ctx.font="10px sans-serif"; ctx.textBaseline="top"; ctx.textAlign="center";
  for(let g=0;g<=4;g++){
    const v=xMax*g/4, x=xAt(v);
    ctx.strokeStyle="rgba(140,140,140,.22)"; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(x,padT); ctx.lineTo(x,padT+plotH); ctx.stroke();
    ctx.fillStyle=inkColor(); ctx.globalAlpha=.6;
    ctx.fillText(Math.round(v*100)+"%", x, padT+plotH+3);
    ctx.globalAlpha=1;
  }

  const rowH=plotH/rows;
  const barH=Math.max(5, Math.min(18, rowH-3));
  // 账号多时行高变小：字号跟着缩，低于 13px 就只留条不写数字，避免文字叠行
  const fs=Math.max(8, Math.min(11, Math.round(rowH-3)));
  const showVal=rowH>=13;
  ctx.textBaseline="middle";
  for(let k=0;k<rows;k++){
    const y=padT+rowH*(k+0.5);
    const v=drawAccountBars.barCur[k]||0;
    const bw=v>0?Math.max(2, v/xMax*plotW):0;

    // 条形
    if(bw>0){
      ctx.fillStyle=meta[k].color||"#2f6fd6";
      ctx.globalAlpha=.85;
      if(typeof ctx.roundRect==="function"){ ctx.beginPath(); ctx.roundRect(padL, y-barH/2, bw, barH, 3); ctx.fill(); }
      else { ctx.fillRect(padL, y-barH/2, bw, barH); }
      ctx.globalAlpha=1;
    }

    // Y 轴账号名（窗口内零产出的账号淡显，一眼区分「没干活」）
    ctx.textAlign="right"; ctx.fillStyle=inkColor(); ctx.globalAlpha=(sums[k]>0?1:.45);
    ctx.font="600 "+fs+"px sans-serif";
    let nm=meta[k].name||meta[k].id||"";
    if(nm.length>10) nm=nm.slice(0,9)+"…";
    ctx.fillText(nm, padL-6, y);

    // 右侧数值
    if(showVal){
      ctx.textAlign="left"; ctx.font=fs+"px sans-serif";
      ctx.globalAlpha=.8;
      ctx.fillText(Math.round(v*100)+"%", padL+bw+5, y);
      ctx.globalAlpha=1;
    }
  }

  // 事件刻度：429（红）/ 熔断（橙）
  const n=cols.length;
  (events||[]).forEach((e,i)=>{
    if(!e) return;
    const x=padL+(n>1? (i/(n-1))*plotW : 0);
    ctx.fillStyle=(e&1)?cssVar("--bad","#d64545"):cssVar("--warn","#e08a1e");
    ctx.fillRect(x-1, h-padB+3, 2, 6);
  });
}


export function liveAccCols(slice, meta){
  meta = meta||[];
  return slice.map(p=>{
    const byId={}; (p.acc||[]).forEach(a=>{ byId[a.id]=a.done_delta||0; });
    return meta.map(m=>byId[m.id]||0);
  });
}
