# 前端重构方案（控制台现代化）

> 对象：`internal/web/static/console.html`（1538 行单文件）。
> 原则：**保持零运行时依赖 + go:embed 单二进制交付**；渐进式分阶段改造，
> 每阶段独立可交付、可回滚；不做一次性大重写。

## 1. 现状审计

### 1.1 结构

| 维度 | 现状 | 问题 |
|---|---|---|
| 文件形态 | 单 HTML 内联全部 CSS/JS（1538 行） | 无法单测、无法 tree-shake；改一处全文件 review |
| 渲染模型 | `state` 全局对象 + `render()` 全量 innerHTML 重绘 | 切 tab / 任意保存都重绘整页；表单输入中途被打断 |
| 路由 | `state.tab` 内存变量，无 URL 同步 | 刷新回 overview、无法分享/收藏某页、浏览器前进后退无效 |
| 数据流 | `refresh()` 一次性拉 8 个接口再全量渲染 | 打开任意页都拉全部数据；无按 tab 惰性加载；`/api/queue` 串行二次请求拖慢首屏 |
| 轮询 | 无自动刷新（仅手动刷新按钮） | 挂机监控场景需手动点刷新；无新旧数据 diff，图表跳变 |
| 表单 | 手写 `fld()` 拼接 + 手动收集 payload | 校验靠浏览器默认；错误提示只有 toast；无 dirty 状态提示 |
| 错误处理 | toast 单例（4s 自动消失） | 批量操作部分失败无定位；401 被动跳登录 |
| 加载态 | 无骨架/spinner（除登录页） | 慢网下像"白屏卡死" |
| 图表 | 手写 canvas 折线/柱状（约 200 行） | 无 tooltip、无缩放、无数据点 hover；主题切换靠 cssVar 兜底 |
| 可访问性 | 无 aria 标签、无键盘导航、无焦点管理、对比度未系统校验 | 屏幕阅读器不可用；纯键盘操作无法完成主流程 |

### 1.2 页面与功能清单（信息架构素材）

现有 7 个 tab（TABS 数组）承载 25+ 卡片：

1. **overview** — 密度图表、账号负载、当前排队
2. **accounts** — 添加/批量导入/分组批量改/账号列表/编辑/测试
3. **keys** — 新建/列表（下游密钥）
4. **runtime** — 粘性绑定、视频任务、用量日志
5. **intent** — 意图判定测试
6. **settings** — 情景、auto、节流、路由、优化、迁移、动态模型清单（约 40 个字段）
7. **update** — 版本自更新、运行环境

### 1.3 数据接口盘点（前端消费）

已就绪的管理 API 共 30+：accounts(CRUD/bulk/test)、keys(CRUD)、stats/queue/
metrics-history/logs、video-jobs/image-jobs(CRUD)、settings/scenarios/export/import、
probe/rpm-table/intent-preview、update(check/apply/status)。
**前端能力齐备，瓶颈纯在组织方式。**

## 2. 参考项目 UI 模式（联网检索结论）

| 项目 | 技术栈 | 可借鉴的模式 |
|---|---|---|
| **gpt-load** | Vue 3 + TS + Naive UI | 左侧分组树 + 右侧详情；密钥表格带健康度徽标（绿/黄/红）与权重列；请求日志表格 + 时间范围过滤；Layout.vue 统一框架 |
| **new-api** | React + Semi Design | 顶部数据看板（请求数/RPM/余额卡片）；渠道表格状态开关内联；日志页按渠道/模型/时间三维过滤；令牌页复制即用 |
| **sub2api** | Web 管理台 | 账号资源卡片化（状态/配额/过期时间醒目）；API Key 一键复制 + 用量进度条 |

**共性模式提炼**（与本项目对应）：

1. **左侧导航 + 顶栏全局状态**（当前 tab 机制可平移）；
2. **Dashboard 卡片网格**：请求数/429 率/排队/账号健康 4 个关键指标卡；
3. **表格优先 + 行内操作**：账号/密钥/任务用数据表格（排序、筛选、行内启停）；
4. **健康度可视化**：账号负载用色点/进度条而非纯数字；
5. **一键复制**：下游密钥、endpoint、compose 示例；
6. **表单分区 + 即时校验**：40 个设置字段按语义分组、必填/格式前置校验。

## 3. 目标信息架构

```
/console
├── 顶栏：Logo · 全局搜索(账号/模型) · 主题切换 · 刷新 · 用户菜单
├── 左侧导航（URL 同步：/console#/<tab>）
│   ├── 概览      Dashboard(指标卡+吞吐图+排队)
│   ├── 账号      列表+分组筛选+添加/批量/测试
│   ├── 密钥      下游密钥 CRUD+一键复制
│   ├── 任务      视频任务+图片库(双 tab 子页)
│   ├── 日志      用量日志+完整请求查看+过滤
│   ├── 调试      意图判定测试+raw_capture 导出
│   └── 设置      情景/模型/节流/路由/维护(分组表单)
└── 全局：Toast 队列 + Modal(编辑/确认) + 401 统一跳登录
```

- URL hash 路由：`#/overview`…`#/settings`，刷新/前进后退/分享均可；
- 每页只拉自己的数据（概览页合并为一次 `/api/stats` + `/api/queue` 并行）；
- 15s 可配置自动轮询（仅概览页），页不可见时暂停（`document.visibilityState`）。

## 4. 组件拆分（渐进式，先 ES Module 化）

**技术选型（关键决策）**：不引入框架/构建链，采用 **原生 ES Modules 多文件 +
零依赖微组件**。理由：项目铁律是"无 Node 机器 go build"（embed 静态文件），
引入 Vite+Preact 意味着 CI 加前端构建、仓库加 lockfile、贡献者加工具链——
收益（组件化 DX）不抵成本（交付复杂度）。ES Modules 让逻辑拆文件、
可测试、按需加载，同时保留"浏览器直接跑"。

```
internal/web/static/console/
├── index.html          # 壳:导航+<main id="page">
├── app.js              # hash 路由 + 页面注册表
├── api.js              # fetch 封装(401 统一处理/错误归一)
├── store.js            # 每页独立 state + 订阅(10 行的极简 reactive)
├── ui.js               # toast/modal/table/fld/badge 复用件
├── theme.js            # 现有三态主题逻辑平移
├── charts.js           # 现有 canvas 图表平移(cssVar 已就绪)
└── pages/
    ├── overview.js     # 指标卡+图表+排队(轮询)
    ├── accounts.js     # 表格+分组筛选+编辑 Modal
    ├── keys.js         # 表格+复制按钮
    ├── tasks.js        # 视频/图片双子页
    ├── logs.js         # 过滤表格+请求详情抽屉
    ├── debug.js        # 意图测试
    └── settings.js     # 分区表单(每区独立保存/校验)
```

## 5. 视觉规范

- **令牌**：沿用现有 CSS 变量（--bg/--panel/--line/--ink/--muted/--brand/
  --good/--warn/--bad），补充 `--radius(10px)`、`--shadow`、`--focus`；
- **布局**：12 列网格；卡片间距 16px；页面最大宽 1280px 居中；
- **状态色**：healthy=--good、degraded=--warn、disabled=--muted、error=--bad，
  一律"色点+文字"双编码（不单靠颜色）；
- **排版**：中文界面 14px 正文/13px 表格/12px 辅助；数字用 mono；
- **暗色**：现有 data-theme 三态机制保留，新增令牌自动继承双主题。

## 6. 可访问性（WCAG AA 目标）

1. 导航用 `<nav>`+`aria-current="page"`；表格用语义化 `<table>`+`<th scope>`；
2. 全部交互控件可 Tab 到达，`:focus-visible` 统一描边（--focus）；
3. Modal：打开时焦点陷阱 + `Esc` 关闭 + 关闭后焦点归还；
4. toast 加 `role="status"`；错误 toast 加 `role="alert"`；
5. 对比度：正文 ≥4.5:1、大字/图形 ≥3:1（暗色 --muted 需从 #8b98a5 提到 #98a4b3）；
6. 图表提供数据表格降级（`<details>` 展开数值）。

## 7. 分阶段实施（每阶段独立交付、可回滚）

| 阶段 | 内容 | 改动面 | 验收 |
|---|---|---|---|
| **P1 骨架** | ES Module 目录结构 + hash 路由 + api/store/ui/theme 迁移 + 顶栏/导航 | 新增目录；旧 console.html 保留为 `/console-legacy`（一个版本周期后删） | 全 7 页可导航、刷新保持位置、401 统一处理 |
| **P2 概览+账号+密钥** | 三个高频页重写：指标卡、表格化、行内启停、一键复制、15s 轮询 | pages/3 文件 | 功能与旧版对齐清单逐项勾验；交互不回退 |
| **P3 日志+任务+调试** | 过滤表格、请求详情抽屉、双任务子页、意图测试平移 | pages/3 文件 | 大日志(300 条)渲染 <100ms；过滤不整页刷新 |
| **P4 设置** | 40 字段分区表单：每区独立保存、即时校验、dirty 提示、情景应用反馈 | pages/settings.js | 每区保存独立生效；校验消息可读 |
| **P5 收尾** | 旧版下线、a11y 走查（键盘全流程+对比度）、E2E 冒烟脚本化 | 删旧文件+文档 | a11y 清单全过；go test/E2E 绿 |

**工作量级**：P1≈1 天、P2≈1-2 天、P3≈1 天、P4≈1 天、P5≈0.5 天（人日估算，
可按阶段拆多次提交）。

## 8. 风险与回滚

| 风险 | 缓解 |
|---|---|
| 双版本并存期 API 行为漂移 | P1-P4 期间旧版保持可用；任何后端 API 变更需同时验证两版 |
| ES Module 老浏览器兼容 | 目标为现代浏览器（项目 NAS 管理面场景成立）；`<script type="module">` 天然严格模式 |
| embed 路径变化 | `//go:embed static/console/*` 目录级嵌入；go test 校验文件齐备 |
| 回滚 | 旧版 `/console-legacy` 保留至 P5；任何阶段出问题把路由切回旧入口即可 |
