// API 封装：401 统一跳登录，错误归一为 Error(message)。
export async function api(path, opts={}){
  const r = await fetch(path, {credentials:"same-origin",
    headers:{"Content-Type":"application/json"}, ...opts});
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
