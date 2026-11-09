# 接口兼容性审计（双协议：OpenAI 兼容 + Agnes 私有）

> 审计范围：对外暴露的全部 `/v1/*` 端点与 Agnes 私有透传端点。
> 方法：逐端点核对请求结构、响应结构、字段命名、状态码、错误格式、流式行为；
> 以 OpenAI 官方 API 规范与 Agnes 官方文档（docs/ 内勘误文档）为对照基准。
> 结论基于源码级核对 + 端到端实测（本地起网关、真实上游）。

## 1. 端点矩阵总览

| 端点 | 协议 | 方法 | 鉴权 | 状态 |
|---|---|---|---|---|
| `/v1/models` | OpenAI | GET | Bearer/x-api-key | ✅ 兼容 |
| `/v1/chat/completions` | OpenAI(+auto) | POST | 同上 | ✅ 兼容 |
| `/v1/messages` | Anthropic 兼容 | POST | 同上 | ✅ 兼容（本轮修错误体） |
| `/v1/responses` | OpenAI Responses | POST | — | ⛔ 501 明确拒绝（本轮改） |
| `/v1/images/generations` | OpenAI(+auto) | POST | 同上 | ✅ 兼容 |
| `/v1/videos`（提交/列表） | OpenAI 视频 API | POST/GET | 同上 | ✅ 兼容（本轮补 list 与对象键） |
| `/v1/videos/{job_id}`（轮询/删除） | OpenAI 视频 API | GET/DELETE | 同上 | ✅ 兼容（本轮补 delete 与别名） |
| `/agnesapi?video_id=` | Agnes 私有 | GET | 同上 | ✅ 透传 |
| `/v1/intent/preview` | 网关自有 | POST | 同上 | ✅ |

## 2. 逐端点核对结论

### 2.1 GET /v1/models — ✅

- 响应 `{object:"list", data:[{id,object:"model",created,owned_by,metadata}]}`：
  符合 OpenAI schema；`metadata` 为扩展字段（OpenAI SDK 容忍未知字段），合法。
- 模型清单 = 内置表 + 用户别名 + 各启用账号声明清单并集，动态（free/dead_models 过滤）。

### 2.2 POST /v1/chat/completions — ✅

- 请求：原样透传 rawBody（`model` 为别名时按账号改写），OpenAI 全部字段
  （`tools`/`response_format`/`stream_options` 等）不丢失。
- 显式模型：`bodyFor` 复用原始 body，model 字段语义不变。
- auto 模型：按账号声明清单改写 `model`，其余字段不动。
- 流式：真 SSE 转发 + 空闲看门狗；`stream=true` 时上游异常合成 SSE 帧；
  非流式请求 `stream=true` 时合成 SSE（writeSyntheticSSE）。
- 错误：OpenAI 格式 `{error:{message,type,code?}}`；429 透传补 `Retry-After`。
- 响应头：`X-Agnes-Hub-*`（intent/model/account/wait_ms/attempts）+ `X-Request-Id`。

### 2.3 POST /v1/messages — ✅（本轮修复）

- 请求：Anthropic 语义（`x-api-key` + `anthropic-version` 头、cache_control 注入）。
- **本轮修复**：错误体此前是 OpenAI 格式（anthropic-sdk 无法解析错误原因），
  现按路径输出 Anthropic 结构 `{"type":"error","error":{"type","message"}}`，
  `error.type` 按状态码映射（invalid_request/authentication/permission/not_found/
  rate_limit/api_error）。

### 2.4 POST /v1/responses — ⛔ 501（本轮从透传改为明确拒绝）

- 上游无可用 Responses 端点（实测：要求 `input` 且返回 500 bad_response_body）；
  此前透传 = 把上游 500 原样漏给客户端。
- 现返回 **501** + OpenAI 错误体，`code=unsupported_endpoint`，消息给出替代端点
  （`/v1/chat/completions` 或 `/v1/messages`）。
- 回滚方式：删除 `handleResponsesUnsupported`，路由恢复 `handleTextish`。

### 2.5 POST /v1/images/generations — ✅

- 请求：字段白名单透传（含 `ratio`/`extra_body` 嵌套/`return_base64`）；
  `size` 档位只做大小写归一（1k→1K），像素串原样透传。
- 响应：上游结构原样（URL 或 b64_json），失败分支带 `X-Agnes-Hub-*` 头。
- 记账正确性：失败（≥400）不扣配额、不落 completed 历史。
- auto 意图：chat 语义进入此端点时自动路由生图（chatShape 形态返回）。

### 2.6 POST /v1/videos — ✅（本轮补对象键）

- 提交：双协议入站——OpenAI 官方视频 API（`input[]`/`instructions`/
  `input_reference`/`duration`）经 `openaiVideoToAgnes` 转换；Agnes 私有形
  （`prompt`+`mode`+`size`+`seconds`+`first_frame`/`audios`）零改动直通；
  `extra_body` 解包合并（顶层优先）。
- 响应：上游结构原样 + 网关补 `job_id`/`video_id`/`poll_url`；
  **本轮补齐 OpenAI 视频对象基础键**：`id`（=job_id）、`object:"video"`、
  `status:"submitted"`、`model`、`created_at`（仅缺失时补，不覆盖上游同名字段）——
  OpenAI SDK 按 `id` 轮询、按 `status` 判断，缺这些键 SDK 直接报错。
- 失败分支：不建任务、不扣配额，错误体 OpenAI 格式。
- 非幂等：`Idempotent=false`，不自动重试（避免重复扣费/重复建任务）。

### 2.7 GET /v1/videos/{job_id}（轮询）— ✅（本轮补别名）

- 轮询上游 `/agnesapi`（按账号粘回原账号），响应原样透传 + `job_id`/`video_id`；
  **本轮补 `id`/`object`/`created_at`/`model` 别名键（缺失才补）**。

### 2.8 GET /v1/videos（列表）与 DELETE /v1/videos/{job_id} — ✅（本轮新增）

- OpenAI 视频 API 的配套端点，此前缺失：SDK 的 `list`/`delete` 调用会 404。
- list：`{object:"list", data:[{id,object:"video",status,model,created_at,video_id}]}`。
- delete：删除本地任务记录（不取消上游任务），返回
  `{id, object:"video.deleted", deleted:true}`。

### 2.9 GET /agnesapi（Agnes 私有轮询）— ✅

- query 原样透传（含 `video_id`/`model_name`），按 video_id 反查归属账号、
  找不到时回退到任一启用视频账号；鉴权走下游 key。
- 已知限制（可接受）：轮询无 key 归属校验（任意有效 key 可查任意 video_id），
  上游响应结构完全透传。

### 2.10 流式行为核对 — ✅

| 项 | 行为 |
|---|---|
| SSE 帧 | `data: {json}\n\n`，逐帧 flush |
| 心跳 | SSE comment 保活（间隔可配） |
| 空闲看门狗 | 600s 无新字节断开（推理模型友好） |
| 断流自动重连续写 | 默认开（StreamAutoResume） |
| MAX_TOKENS 截断续写 | 默认 2 轮（ContinuationMaxRounds） |
| 非流式墙钟 | 30s（RequestTimeoutMS），仅非流式生效 |

### 2.11 状态码与错误格式核对 — ✅

| 场景 | 状态码 | 格式 |
|---|---|---|
| 缺/错 key | 401 | OpenAI 错误体（/v1/messages 下为 Anthropic 体） |
| key 不允许该池 | 403 | 同上 |
| 模型不存在/请求体错 | 400 | 同上 |
| 排队满/无可用账号 | 503（ErrNoCapacity/ErrQueueFull/ErrQueueTimeout） | 同上 |
| 上游 429 | 内部换号重试，预算耗尽透传 + Retry-After | 同上 |
| 上游 5xx | 幂等路径换号重试后透传 | 同上 |
| /v1/responses | 501 unsupported_endpoint | OpenAI 错误体 |

## 3. 本轮修补清单

1. `/v1/responses`：透传 → 501 明确拒绝（`handleResponsesUnsupported`）。
2. `/v1/messages` 错误体：OpenAI 格式 → Anthropic 格式（`writeErrFor`/`writeAnthropicErr`，
   覆盖 handleTextish 与 proxy 的全部错误出口）。
3. 视频提交/轮询响应补 OpenAI 对象基础键（`id`/`object`/`status`/`model`/`created_at`，
   仅缺失时补）。
4. 新增 `GET /v1/videos`（列表）与 `DELETE /v1/videos/{job_id}`（删除本地记录）。

## 4. 需要补充的回归测试（按优先级）

> 现有 e2e_test.go 覆盖：文本显式/auto/流式、图像 chat 形态、显式模型尊重、
> 未声明模型 503、熔断。以下为缺口，建议补进 internal/web/e2e_test.go：

| # | 用例 | 断言要点 | 优先级 |
|---|---|---|---|
| R1 | Anthropic 错误体形态 | `/v1/messages` 用无效 key → 401 且 body 为 `{"type":"error","error":{...}}`，`error.type=authentication_error` | P0 |
| R2 | /v1/responses 501 | POST 合法 key → 501、`code=unsupported_endpoint`、错误体为 OpenAI 格式 | P0 |
| R3 | 视频提交响应对象键 | mock 上游返回无 `id/object` 的提交响应 → 网关补齐 `id`(=job_id)/`object:"video"`/`status`/`model`/`created_at`，且不覆盖上游已有值 | P0 |
| R4 | 视频轮询别名键 | 轮询响应含 `id`/`object`/`created_at`，上游字段不覆盖 | P1 |
| R5 | 视频列表/删除 | `GET /v1/videos` 返回 `{object:"list",data:[...]}`；DELETE 后 list 不再含该 id；DELETE 未知 id → 404；未鉴权 → 401 | P1 |
| R6 | chat 流式 SSE 帧格式 | 逐帧 `data: {json}\n\n`、末帧含 usage、异常路径发 error 帧 | P1 |
| R7 | Anthropic 正常路径 | `/v1/messages` 显式模型 → 上游收到 `x-api-key`+`anthropic-version` 头、`system` 未被改写 | P1 |
| R8 | 429 透传补 Retry-After | mock 上游 429 且重试预算耗尽 → 客户端收到 429 + Retry-After 头 | P2 |
| R9 | 图像错误路径响应头 | 上游 400 → 客户端收到 400 + `X-Agnes-Hub-Account/Wait-Ms/Attempts` 头 | P2 |
| R10 | OpenAI 视频入站等价性 | `input[]` 形与等价私有形（同 prompt/size/seconds）经网关产出的上游请求体字段一致 | P2 |

## 5. 明确不做（记录取舍）

- `/v1/embeddings`、`/v1/audio/*`：上游无对应能力，不伪造 404 之外的语义；
  OpenAI 错误体 404 已足够（SDK 报"模型不支持"类错误，属预期）。
- `/v1/responses` 的语义翻译降级：上游端点实测必败，翻译层只会放大故障面。
- 视频任务的 key 归属校验：单租户自部署场景收益低，记录为已知限制。
