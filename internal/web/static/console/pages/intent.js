// 意图判定测试页(零配额)。
import { api } from "../api.js";
import { state } from "../state.js";
import { esc, toast } from "../ui.js";

export function viewIntent(){
  return `
  <div class="card">
    <div class="card-head"><h2>意图判定测试</h2><span class="grow"></span><span class="count">零配额消耗</span></div>
    <div style="padding:14px 16px">
    <div class="hint" style="margin-bottom:12px">不发上游请求，只看网关把这句话判成什么模态、用哪个模型；判定依据会写入日志。阈值在「设置」调整。</div>
    <div class="row" style="align-items:flex-end">
      <div style="flex:1;min-width:260px"><label>判定端点</label>
        <select id="ipPath">
          <option value="/v1/chat/completions">/v1/chat/completions（走内容判定）</option>
          <option value="/v1/images/generations">/v1/images/generations（端点即生图）</option>
          <option value="/v1/videos">/v1/videos（端点即生视频）</option>
        </select></div>
      <button class="primary" id="btnIntent">判定</button>
    </div>
    <div style="margin-top:12px"><label>批量样本（每行一句）</label>
      <textarea id="ipSamples" style="min-height:140px">帮我画一张赛博朋克风格的城市夜景
生成一段海边日落的海浪视频
解释一下 Transformer 的注意力机制
how do I draw a cat in matplotlib?
生成一张产品海报，极简风格
What is the difference between RPM and QPS?</textarea></div>
    <div id="intentResult" style="margin-top:14px"></div>
    </div>
  </div>`;
}

export function bindIntentEvents(){
  const b = document.getElementById("btnIntent");
  if(!b) return;
  b.onclick = async ()=>{
    const samples = document.getElementById("ipSamples").value.split("\n").map(s=>s.trim()).filter(Boolean);
    b.disabled = true;
    try{
      const r = await api("/api/intent/preview",{method:"POST",body:JSON.stringify({
        _path:document.getElementById("ipPath").value, _samples:samples})});
      const rows = (r.cases||[]).map(c=>`<tr>
        <td style="max-width:300px">${esc(c.input)}</td>
        <td><span class="badge ${c.intent==="text"?"":c.intent==="image"?"info":"warn"}">${esc(c.intent)}</span></td>
        <td>${esc(c.label)}<div class="cell-sub">${esc(c.by)}</div></td>
        <td class="num">${c.score}</td>
        <td class="muted" style="font-size:12px">${esc(c.reason)}</td></tr>`).join("");
      document.getElementById("intentResult").innerHTML = `<div class="tbl-wrap"><table>
        <thead><tr><th>输入</th><th>判定</th><th>依据</th><th>置信度</th><th>说明</th></tr></thead>
        <tbody>${rows}</tbody></table></div>`;
    }catch(e){ toast(e.message,"bad"); }
    finally{ b.disabled = false; }
  };
}

/* 意图测试页无快照数据可拉；预留钩子保持契约一致 */
export async function loadIntent(){
  if(!state.scenarios) state.scenarios = [];
}
