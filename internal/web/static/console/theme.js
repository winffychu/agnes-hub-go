// 三态主题（auto/dark/light），localStorage 持久化；首帧引导脚本在 index.html 内。
import { icon } from "./icons.js";
const THEME_ICON = { dark:"moon", light:"sun", auto:"monitor" };
export function setTheme(t){
  document.documentElement.setAttribute("data-theme", t);
  localStorage.setItem("agnes_theme", t);
  const b = document.getElementById("btnTheme");
  if (b) b.innerHTML = icon(THEME_ICON[t]||"monitor", 15);
}
export function cycleTheme(){
  const cur = document.documentElement.getAttribute("data-theme") || "auto";
  setTheme(cur === "auto" ? "dark" : (cur === "dark" ? "light" : "auto"));
}
export function syncThemeIcon(){
  const t = document.documentElement.getAttribute("data-theme") || "auto";
  const b = document.getElementById("btnTheme");
  if (b) b.innerHTML = icon(THEME_ICON[t]||"monitor", 15);
}
