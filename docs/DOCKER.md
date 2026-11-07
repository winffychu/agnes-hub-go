# 容器部署手册(docker compose)

> agnes-hub-go 官方镜像:`ghcr.io/winffychu/agnes-hub-go`
> 本手册面向「用 Docker / Docker Compose 跑网关」的场景。

---

## 1. 快速开始

仓库根目录已提供 `docker-compose.yml`:

```yaml
services:
  agnes-hub:
    image: ghcr.io/winffychu/agnes-hub-go:latest
    container_name: agnes-hub
    restart: unless-stopped
    ports:
      - "4142:4142"
    volumes:
      - ./data:/data
    environment:
      AGNES_HUB_UPDATE_REPO: "off"
      TZ: "Asia/Shanghai"
    read_only: true
    tmpfs:
      - /tmp
    security_opt:
      - no-new-privileges:true
```

启动:

```bash
mkdir -p data                              # 首次先建目录,否则会被 root 占为属主
sudo chown -R 10001:10001 data             # 容器内进程 UID=10001,属主不对会写不进去
docker compose up -d
docker compose logs -f                     # 看启动日志:端口、数据目录、可用账号数
```

打开 <http://<主机IP>:4142/console> 登录并配置账号池。

> **首次登录**:默认管理员密码是 `admin123`,登录页会提示「首次登录请改密」,
> 进去后立刻在「系统」里改掉(改密后所有会话立即失效)。

停止(数据保留在 `./data`):

```bash
docker compose down
```

### 不用 compose,直接 `docker run`

```bash
docker run -d --name agnes-hub \
  -p 4142:4142 \
  -v "$PWD/data:/data" \
  -e AGNES_HUB_UPDATE_REPO=off \
  -e TZ=Asia/Shanghai \
  --read-only --tmpfs /tmp \
  --security-opt no-new-privileges:true \
  ghcr.io/winffychu/agnes-hub-go:latest
```

---

## 2. 镜像设计要点

| 项 | 值 | 说明 |
| --- | --- | --- |
| 基础镜像 | `alpine:3.20` | 静态 ELF(构建时 `CGO_ENABLED=0`),无需 glibc |
| 构建方式 | 多阶段 + `BUILDPLATFORM` 交叉编译 | arm64 不在 QEMU 下编译,CI 快 5–10x |
| 运行用户 | `app`(UID/GID `10001`) | 非 root |
| 入口 | `agnes-hub-go -host 0.0.0.0 -port 4142 -data /data` | exec 形式,PID 1 能收到 SIGTERM 走优雅停机 |
| 数据卷 | `/data` | 所有运行期数据 |
| 健康检查 | `wget -qO- http://127.0.0.1:4142/healthz` | 免鉴权、恒 200 |
| 时区 | `TZ`(默认 `Asia/Shanghai`) | 影响 `usage.jsonl` / 日志时间戳 |

镜像内置 `ca-certificates`(访问上游 HTTPS 必需)与 `tzdata`(时间戳按 TZ 输出)。

---

## 3. 数据持久化

容器是无状态的,**全部状态都在 `/data`**:

```
/data/settings.json          全局设置
/data/accounts.json          账号池(含上游 API Key,注意保密)
/data/downstream_keys.json   下游密钥
/data/bindings.json          会话粘性绑定
/data/video_jobs.json        视频任务映射
/data/usage.jsonl            用量日志
```

`docker-compose.yml` 把宿主 `./data` 挂到容器 `/data`。
**升级容器前先备份 `./data`**,拷贝目录即为完整备份。

> 权限提示:容器内进程 UID 为 `10001`。若宿主目录属主不同,可能写不进去,
> 先执行 `sudo chown -R 10001:10001 ./data`。

---

## 4. 为什么容器里关闭自更新

镜像里预设 `AGNES_HUB_UPDATE_REPO=off`,即在容器内**完全关闭内置自更新**。

原因是:容器内的自更新替换的只是**容器可写层**里的二进制,容器一重启就
回滚到镜像里的版本。表现为「控制台显示已更新 + 服务中断一次 + 版本却没变」,
比直接报错更难排查。

**容器的版本 = 镜像 tag。升级方式就是换镜像。**

---

## 5. 升级

```bash
docker compose pull          # 拉取新 tag
docker compose up -d         # 用新镜像重建容器(./data 原样保留)
```

固定版本(不用 latest):

```yaml
image: ghcr.io/winffychu/agnes-hub-go:1.0.39
```

回滚同样简单:把 tag 改回上一个版本号,再 `up -d`。

---

## 6. 常见问题

### 端口被占用

```
Error ... bind: address already in use
```

改宿主侧映射端口即可(容器内始终 4142):

```yaml
ports:
  - "8080:4142"      # 宿主 8080 → 容器 4142
```

### 时间戳不对(差 8 小时等)

设 `TZ` 环境变量:

```yaml
environment:
  TZ: "Asia/Shanghai"
```

### IPv6

容器默认走 IPv4。若宿主只有 IPv6 出口,给 compose 显式开 IPv6:

```yaml
services:
  agnes-hub:
    sysctls:
      net.ipv6.conf.all.disable_ipv6: 0
networks:
  default:
    enable_ipv6: true
```

上游域名解析出来的地址族取决于宿主 DNS,容器本身无需额外配置。

### 健康检查一直是 starting

正常:启动后 10s(`start-period`)内不判失败。若持续 unhealthy,
`docker inspect --format '{{json .State.Health}}' agnes-hub` 看最后一次输出。

### 只读根文件系统导致写入失败

本镜像所有写盘都走 `/data`,根文件系统设为 `read_only: true` 是安全的。
若你把数据目录改到了别处,记得同时挂卷,否则会因只读而启动失败。

### 想在本机构建镜像

```bash
docker build -t agnes-hub-go:local .
docker run -d -p 4142:4142 -v "$PWD/data:/data" agnes-hub-go:local
```

---

## 7. 相关文档

- 发版流程与镜像 tag 约定:见 [`RELEASE.md`](RELEASE.md)
- 上游自更新机制(非容器场景):见根目录 `README.md` 第 7.5 节
