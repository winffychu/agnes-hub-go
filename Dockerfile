# syntax=docker/dockerfile:1.7
# ---------------------------------------------------------------------------
# agnes-hub-go 容器镜像
#   构建：在 BUILDPLATFORM 上原生交叉编译（arm64 不走 QEMU，CI 快 5-10x）
#   运行：alpine + 静态二进制 + 非 root(10001) + /data 卷
#
#   构建示例：
#     docker build -t agnes-hub-go:local .
#     docker buildx build --platform linux/amd64,linux/arm64 \
#       -t ghcr.io/winffychu/agnes-hub-go:latest --push .
# ---------------------------------------------------------------------------

# ---------- build ----------
FROM --platform=$BUILDPLATFORM golang:1.22-alpine AS build

# buildx 会为每个目标平台注入 TARGETOS / TARGETARCH。
# 这里**故意不写默认值**（`ARG TARGETARCH=amd64` 这种写法是陷阱）：
#   - buildx 注入真实值时，默认值本来就不会生效，写了也没用；
#   - 一旦被 `--build-arg TARGETARCH=` 传成空串，ARG 的默认值同样不会生效，
#     GOARCH 变空 → Go 静默回落到「构建机架构」→ arm64 镜像里塞进 amd64
#     二进制，只有在真机 docker run 时才以 exec format error 暴露。
# 所以兜底放在 RUN 的 shell 里（${TARGETARCH:-amd64}），并在构建期做 ELF 头自检。
ARG TARGETOS
ARG TARGETARCH

WORKDIR /src
# 零第三方依赖：不需要 go mod download，也没有 vendor 目录 / go.sum
COPY . .

# -trimpath -ldflags "-s -w" 与本仓库既有构建参数（bat / release.py / README）一致。
# -buildvcs=false：构建上下文不含 .git（.dockerignore 已排除），避免 VCS stamping 失败。
#
# 末尾的 ELF 头自检不是洁癖：GOARCH 出错时 go build 依然成功，问题只在
# `docker run` 时以 exec format error 暴露，且往往只在生产用的 arm64 上暴露。
# 读 ELF 头即可在构建期拦住：魔数 127 69 76 70，e_machine（偏移 18）amd64=62、arm64=183。
RUN set -eu; \
    target_os="${TARGETOS:-linux}"; \
    target_arch="${TARGETARCH:-amd64}"; \
    if [ "$target_os" != "linux" ]; then \
        echo "ERROR: 本镜像只支持 linux，收到 TARGETOS=$target_os" >&2; exit 1; \
    fi; \
    case "$target_arch" in \
        amd64) want_machine=62 ;; \
        arm64) want_machine=183 ;; \
        *) echo "ERROR: 不支持的 TARGETARCH=$target_arch（仅 amd64 / arm64）" >&2; exit 1 ;; \
    esac; \
    echo "==> building linux/$target_arch"; \
    CGO_ENABLED=0 GOOS="$target_os" GOARCH="$target_arch" GOTOOLCHAIN=local \
        go build -trimpath -buildvcs=false -ldflags "-s -w" -o /out/agnes-hub-go . ; \
    test -s /out/agnes-hub-go; \
    magic="$(dd if=/out/agnes-hub-go bs=1 count=4 2>/dev/null | od -An -tu1 | tr -s ' ' | sed 's/^ //; s/ $//')"; \
    if [ "$magic" != "127 69 76 70" ]; then \
        echo "ERROR: 产物不是 ELF（头部字节=[$magic]），GOOS/GOARCH 可能未生效" >&2; exit 1; \
    fi; \
    machine="$(dd if=/out/agnes-hub-go bs=1 skip=18 count=1 2>/dev/null | od -An -tu1 | tr -d ' \n')"; \
    if [ "$machine" != "$want_machine" ]; then \
        echo "ERROR: ELF e_machine=$machine 与 TARGETARCH=$target_arch 不符（期望 $want_machine）" >&2; exit 1; \
    fi; \
    echo "==> ok: linux/$target_arch（e_machine=$machine）"

# ---------- runtime ----------
FROM alpine:3.20

# ca-certificates：访问 https://apihub.agnes-ai.com 与 api.github.com 必需
# tzdata：usage.jsonl / app.log 的时间戳按 TZ 输出，排障必需
# wget 来自 busybox，供 HEALTHCHECK 使用，无需额外安装
RUN apk add --no-cache ca-certificates tzdata \
    && addgroup -g 10001 app \
    && adduser -D -u 10001 -G app app \
    && mkdir -p /data && chown app:app /data

COPY --from=build /out/agnes-hub-go /usr/local/bin/agnes-hub-go

USER app
WORKDIR /data
VOLUME ["/data"]

# 容器内自更新不成立：替换的只是容器可写层里的二进制，重启即回滚到镜像版本，
# 表现为「显示已更新 + 中断一次 + 版本没变」，比直接报错更坏。
# AGNES_HUB_UPDATE_REPO=off 由 main.go 的 updateRepo() 解析 → 自更新整体关闭。
# 换镜像即换版本：升级请 docker pull 新 tag 后重建容器。
#
# HOME=/data：alpine 给 app 用户建的家目录 /home/app 在 read_only 根文件系统下
# 不可写，任何想往 $HOME 落地的逻辑都会失败。指到卷上，最坏情况也只是多一个文件。
# TMPDIR=/tmp：容器内 /tmp 由 tmpfs 提供（compose 已声明），保证可写。
ENV AGNES_HUB_UPDATE_REPO=off \
    TZ=Asia/Shanghai \
    HOME=/data \
    TMPDIR=/tmp

EXPOSE 4142

# 复用现成 GET /healthz（internal/web/server.go handleHealth，免鉴权、恒 200 + 富 JSON）
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://127.0.0.1:4142/healthz >/dev/null 2>&1 || exit 1

# exec 形式：PID 1 直接是网关，能正确收到 SIGTERM 走优雅停机
# （main.go 的 signal.NotifyContext + 排空依赖它，shell 形式会吞信号）。
# 必须显式 -host 0.0.0.0，否则监听 127.0.0.1 只在容器内可达。
ENTRYPOINT ["/usr/local/bin/agnes-hub-go"]
CMD ["-host", "0.0.0.0", "-port", "4142", "-data", "/data"]

STOPSIGNAL SIGTERM
