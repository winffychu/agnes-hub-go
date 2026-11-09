// 三态主题（auto/dark/light），localStorage 持久化；首帧引导脚本在 index.html 内。
export function setTheme(t){
  document.documentElement.setAttribute("data-theme", t);
  localStorage.setItem("agnes_theme", t);
  const b = document.getElementById("btnTheme");
  if (b) b.textContent = t === "dark" ? "🌙" : (t === "light" ? "☀️" : "🌓");
}
export function cycleTheme(){
  const cur = document.documentElement.getAttribute("data-theme") || "auto";
  setTheme(cur === "auto" ? "dark" : (cur === "dark" ? "light" : "auto"));
}
export function syncThemeIcon(){
  const t = document.documentElement.getAttribute("data-theme") || "auto";
  const b = document.getElementById("btnTheme");
  if (b) b.textContent = t === "dark" ? "🌙" : (t === "light" ? "☀️" : "🌓");
}
