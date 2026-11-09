# 项目变更史（HISTORY）

> 本文档承接源码注释中的进度记录、变更依据与排障结论，作为项目演进的单一留痕处。
> 源码注释只保留对理解代码逻辑真正必要的内容；叙事性记录一律沉淀到这里。

## 2026-11-09 — 减法清理：移除网页 chat + 注释瘦身

- **移除网页 chat 功能**（存在认证缺陷且与纯网关定位不符）：
  - 删除静态页 `internal/web/static/chat.html`、`chat.main.js`；
  - 删除路由：`GET /chat`、`/chat.main.js`、`/api/chat/login`、`/api/chat/session`、
    `/api/models`、`/api/chat/v1/*`（文本/生图/视频代理）、`/api/chat-logs*` 四端点；
  - 删除对应 handler（handleChat/apiChatLogin/apiChatSession/apiChatModels/
    apiChatLogs/apiCreateChatLog/apiDeleteChatLog/apiClearChatLogs/
    handleChatProxy/handleChatMediaProxy/chatAuthed/authedOrChat）；
  - 删除 Store 层：ChatLog 类型与 chat_logs.json 持久化、ChatPasswordHash/Salt
    字段、VerifyChatPassword/SetChatPassword/ChatToken；
  - 控制台移除「对话 UI」按钮与「Chat 密码设置」卡片；图片/视频库端点回归 admin-only。
  - 注意：OpenAI 兼容端点 `/v1/chat/completions` 是网关核心能力，**不在移除范围**。
- **注释瘦身**：生产代码中的日期戳、审计编号（P0-x/P1-x）、内部任务号（#20~#29）、
  「owner 裁定/可回滚/上轮」等叙事表述全部移除；技术结论（如 gzip 关闭原因、
  流式看门狗 600s 依据）保留。本文件承接完整记录。

## 2026-11-09 — 认证修复（v1.0.41）

- `/api/chat/v1/*` 三端点补鉴权（此前完全无鉴权，任何能访问网关者可免密烧上游配额）。
- chat cookie 从字面量 `"authenticated"` 改为 `ChatToken()` 派生令牌（从密码哈希+盐
  派生、不落地、反推不出），校验用常量时间比较；cookie Path 从 `/chat` 改 `/`
  （修复 `/api/video-jobs` 等端点收不到 cookie 的 Path 不匹配问题）。
- 上述功能随 chat 移除一并下线；控制台与 jobs 端点全程仅 admin 会话。

## 2026-11-08 — 双协议视频入站 + 白名单收窄

- 新增 `internal/intent/openai_video.go`：识别 OpenAI 官方视频 API 形态
  （`input[]`/`instructions`/`input_reference`/`duration`）转换为 Agnes 私有形；
  Agnes 私有形零改动直通。转换规则含：input[].text→prompt、image→first_frame/
  images（≥3 图→reference）、input_reference→first_frame、duration→seconds
  （字符串归一）、aspect_ratio=auto 消解、width/height→size（视频档位口径：
  flash 仅 720P）、num_frames→seconds（24fps）、有媒体自动 mode=keyframe/reference。
- 视频白名单按官方 U8 禁止清单收窄：移除 width/height/num_frames/frame_rate/
  quality/num_inference_steps/duration（实测全部 400 forbidden）。
- normalizeSize 边界定案：只做「数字+k/K」大小写归一；不做像素→档位换算、
  档位数值变更、模糊匹配（像素串原样透传）。
- mode 缺省注入 text 的评估结论：官方 U8 mode 必填缺失必 400；无媒体时 text 是
  唯一合理语义，无产出质量损失，保留注入。

## 2026-11-08 — 官方文档对照审计整改

- 视频 `extra_body` 解包合并（U8 SDK 机制；实测上游服务端同样解包校验）；
  图像侧 `extra_body` 语义相反（官方要求嵌套形态），保持整体透传。
- 图像白名单补 `return_base64`（官方合法字段，此前 b64 输出被静默丢弃）。
- 调度 `Candidates` 拒绝盲发：requiredModel 无人声明时返回空候选（上层
  ErrNoCapacity 快速失败），不再退化为模态全集盲发（盲发=上游 400+烧满重试预算）。

## 2026-11-08 — reveric 兼容性修复

- 视频白名单补 `size`/`aspect_ratio`/`first_frame`/`last_frame`/`audios`
  （reveric 客户端发送这些字段，此前被静默裁剪致上游 400）。
- `ratio` 视频路径上游明确 400（"not an allowed request field"），改为刻意剔除；
  新增 `VideoBlockedFields` 剔除表（带原因记日志），与"白名单外静默丢弃"区分。
- 图像白名单补 `ratio`（档位+比例形式，上游合法）与 `extra_body`。
- 类型判定修复：数组/对象字段（audios/images/extra_body）此前被 asString 判空误丢。

## 2026-11-07 — 全面审计优化（v1.0.40 后）

- 模型清单动态化：Settings 新增 `free_models`/`dead_models`（settings.json 可维护，
  免费口径不硬编码；空配置时 IsFree 按 -flash 后缀启发式、IsDead 回落内置种子）。
- 记账正确性：生图/视频路径"先记账后判状态"缺陷修复（上游 4xx/5xx 不再扣计次
  配额、不再记 completed）。
- 控制台暗色主题：CSS 变量 + data-theme 三态（auto/dark/light）+ localStorage
  持久化 + 首帧引导防闪白；canvas 图表经 cssVar() 运行时取值跟随主题。
- `.workbuddy/` 历史记忆脱敏（内网 IP/原作者路径/代理端口/NAS 域名/凭证形态串）。

## 2026-11-07 — 模型表校准

- 实测校准：`agnes-1.5-flash`/`agnes-2.0-flash` 上游已下线（500
  get_channel_failed）、`agnes-2.5-pro` 404、`agnes-video-v2.0` 不在 /models。
- 内置别名全部改指活模型（旧别名指向死模型会烧满重试预算，客户端挂死 20s+）。

## 2026-11-06 — 品牌统一 + Docker + CI（v1.0.40）

- 全量品牌改名（baipiao/白嫖 → agnes-hub-go），含协议契约项（请求头/SSE 字段/
  Prometheus 指标/cookie/盐）；`baipiao-hub.bat` 删除。
- 新增 Dockerfile（多阶段交叉编译 + 非 root + /data 卷 + 构建期 ELF 自检）、
  docker-compose、GitHub Actions（ci.yml + release.yml 版本闸门）。
- 修复 updater.pickAsset 误选安装包、main.go 硬编码上游仓库（新增
  AGNES_HUB_UPDATE_REPO 环境变量，容器内 off 关闭自更新）。

## 历史排障结论（承接自旧注释）

- **UpstreamRequestGzip 默认关**：上游对大体积 gzip 请求体解压失败时返回误导性
  401 "Invalid token"（直连同请求如实报 400 ContextWindowExceededError），
  401 触发账号熔断 30 分钟，轮询撞上即抽干账号池。小请求正常，症状随上下文
  渐进出现。开启前必须对 ≥2MB 请求体做压缩回归测试。
- **StripContentPolicy 默认关**：请求体改写历史版本曾实证跨字符串误配对打坏
  JSON；与 gzip 同批默认关闭以收敛变量。重开前先做大体积/多标签字面量回归。
- **StreamIdleTimeoutMS=600000**：推理模型思考可远超 90s，短阈值会在"思考后
  才吐首 token"场景把流掐断（线上卡死根因）。
- **服务端 keep-alive 关闭**：网关重启/热更后客户端连接池仍持半死连接，写入
  触发 TCP 重传超时（十几分钟无进展）；关掉后每次请求新建连接到当前进程。
- **上下文超长误报 401**：个别上游站点把上下文超长误报为 401，网关识别后改写
  400 交还客户端，不做账号熔断/换站（换站解决不了超长）。

## 兼容性提示

- 移除的端点（`/chat`、`/api/chat/*`、`/api/chat-logs*`、`/api/models`）如被
  外部脚本引用，请改走 `/v1/*` OpenAI 兼容端点 + 下游密钥。
- chat 相关 Settings 字段（chat_password_hash/salt）已删；旧 settings.json 中的
  残留键会被 JSON 解析忽略，无迁移成本。
