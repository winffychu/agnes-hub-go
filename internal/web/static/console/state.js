// 全局会话与数据状态（各页共享快照，页面内部状态各自持有）。
export const POOLS = ["text","image_1k","image_2k","image_3k","image_4k","video"];
export const MODALITIES = ["text","image","video"];
export const TYPES = ["free","enterprise","tokenplan","amd","openrouter"];
export const DEFAULT_BASE_BY_TYPE = {
  free: "https://apihub.agnes-ai.com/v1",
  enterprise: "https://apihub.agnes-ai.com/v1",
  tokenplan: "https://apihub.agnes-ai.com/v1",
  amd: "https://developer.amd.com.cn/radeon/api/v1",
  openrouter: "https://openrouter.ai/api/v1"
};
export const state = {
  tab:"overview", session:null, stats:null, accounts:null,
  keys:[], logs:[], settings:null, jobs:[], bindings:[],
  scenarios:[], scenarioData:null
};
