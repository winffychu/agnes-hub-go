// API 封装：401 统一跳登录，错误归一为 Error(message)。
// 附带陈旧版本检测：服务端每次响应带 X-App-Version（构建版本），
// 与页面加载时的 __CONSOLE_BUILD__ 不一致 → 说明服务端已更新而本页还是旧模块，
// 顶部弹「刷新」提示条（v1.0.46 日志页 "api is not defined" 即此类陈旧模块问题）。
let verMismatchShown = false;
function checkVersion(r){
  if(verMismatchShown) return;
  const server = r.headers.get("X-App-Version");
  const mine = window.__CONSOLE_BUILD__;
  if(!server || !mine || server === mine) return;
  verMismatchShown = true;
  const bar = document.createElement("div");
  bar.className = "verbar";
  bar.innerHTML = `<span>检测到服务端已更新（${server}），当前页面仍是旧版本，部分功能可能异常。</span>
    <button class="primary" id="btnVerReload">立即刷新</button>`;
  document.body.appendChild(bar);
  bar.querySelector("#btnVerReload").onclick = ()=>location.reload();
}
export async function api(path, opts={}){
  const r = await fetch(path, {credentials:"same-origin",
    headers:{"Content-Type":"application/json"}, ...opts});
  checkVersion(r);
  const text = await r.text();
  let data = null;
  try{ data = text ? JSON.parse(text) : null; }catch(e){ data = {raw:text}; }
  if(!r.ok){
    if(r.status===401 && window.__on401){ window.__on401(); }
    const msg = (data && data.error && data.error.message) || ("HTTP "+r.status);
    const err = new Error(msg); err.status = r.status; err.data = data; throw err;
  }
  return data;
}
