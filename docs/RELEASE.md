# 发版手册

> agnes-hub-go 的版本发布全部由 GitHub Actions 驱动,**唯一入口是打 tag**。
> 本地 `tools/release.py` 降级为「紧急通道」,仅在 CI 不可用时使用。

---

## 1. 版本号的单一来源

版本号只有一个地方可以改:

```go
// main.go
var version = "1.0.39"
```

`go.mod` 的 `go 1.22` 是**语言版本**,与产品版本无关,不要动它来发版。

所有产物名、fpk 版本、镜像 tag 都从这个值派生:

| 产物 | 名称 |
| --- | --- |
| 飞牛 fnOS 安装包 | `agnes-hub-go-<版本>.fpk` |
| Windows 绿色版 | `agnes-hub-go-windows-<版本>.zip` |
| Linux x64 | `agnes-hub-go-linux-amd64` |
| Linux arm64 | `agnes-hub-go-linux-arm64` |
| Windows 裸二进制 | `agnes-hub-go.exe` |
| 容器镜像 | `ghcr.io/winffychu/agnes-hub-go:<版本>` 与 `:latest` |

---

## 2. 标准发版流程(推荐)

```bash
# 1) 改版本号
#    编辑 main.go: var version = "1.0.40"

# 2) 本地自检(与 CI 完全一致的命令)
go vet ./...
go test ./... -count=1

# 3) 提交并推送
git add main.go
git commit -m "v1.0.40: <一句话说明>"
git push origin master

# 4) 打 tag 并推送 —— 这一步会触发 .github/workflows/release.yml
git tag -a v1.0.40 -m "v1.0.40"
git push origin v1.0.40
```

推 tag 之后:

1. `release` job 先做**版本闸门**(见第 3 节),不一致直接 fail,什么都不会发。
2. 通过后三平台构建 → 打包 5 个资产 → 创建 Release。
3. `docker` job 在 `release` 成功后,构建并推送多架构镜像到 ghcr.io。

在 GitHub 的 **Actions** 页可实时查看进度;产物出现在 **Releases** 页。

### Release 正文从哪里来

若 `tools/release_notes.md` 存在,workflow 会把其中的 `{{VERSION}}` 占位替换成
实际版本号作为正文;不存在则回退一段简短文案。发版前建议更新该文件的要点。

---

## 3. 版本校验闸门(为什么必须有)

> 防的是「改了代码没 bump 版本,却打了新 tag」这类事故:二进制里嵌入的版本
> 来自 `main.go`,tag 只是人写的标签,两者不一致时,自更新会把「旧版本」
> 当成新版发给用户(历史上 1.0.3 的 exe 误发即此类)。

`release.yml` 的第一步就做比较:

```
tag(去掉 v 前缀)  ===  main.go 的 var version
```

不等即 `exit 1`,并打印一行可读错误,例如:

```
tag v1.0.40 与 main.go 的 version=1.0.39 不一致,拒绝发版(请先 bump main.go 再重发 tag)
```

`docker` job 通过 `needs: release` 挂在闸门之后 —— 闸门没过,镜像也不会推。

---

## 4. 紧急通道:本地 `tools/release.py`

何时用:CI 不可用(如 Actions 配额用尽、GitHub 侧故障)、或需要**离线**产出
本地产物给现场使用。

```bash
# 只做本地产物,不推 tag / Release
python tools/release.py --no-push

# 完整发版(需要 GITHUB_PAT 环境变量,经 REST API 建 Release)
export GITHUB_PAT=ghp_xxxx
python tools/release.py
```

前置条件:

- 本机有可用 Go 工具链（脚本用 `shutil.which("go")` 查找，可用 `GO_BIN`
  环境变量指定绝对路径）；
- 代理 `127.0.0.1:3067` 在监听（脚本内置，仅完整发版需要）；
- 打包 Windows zip 要用的 `README.txt` 若不在 `dist/`，脚本会从
  `tools/windows-readme.txt` 自动生成。

发布目标仓库默认是 `winffychu/agnes-hub-go`（与 CI、README 下载链接一致），
可用 `AGNES_HUB_RELEASE_REPO=owner/repo` 覆盖。注意 `main.go` 里自更新的
默认仓库保持上游，那是两件不同的事，不要混。

脚本与 CI 产出的资产名、构建参数完全一致，`dist/README.txt` 与 zip 内容也同源，
因此两条链路可以互换。

> **PAT 绝不入库**:`GITHUB_PAT` 只能经环境变量传入,不要写进任何被 git 跟踪的文件。

---

## 5. 回滚

### 5.1 发的版本有问题,但 Release 还没被广泛下载

删除远端 tag 与 Release,修好后重打 tag:

```bash
git push origin :refs/tags/v1.0.40      # 删远端 tag
git tag -d v1.0.40                       # 删本地 tag
# 在 GitHub Releases 页删除对应 Release(或 gh release delete v1.0.40)

# 修好代码后再重新走一遍第 2 节流程
```

### 5.2 已发布,需要快速回到上一版

**代码层面**用 revert 生成一个新的补丁版本(不要删除已发布的 tag,
否则已经自更新到坏版本的用户会卡在那里):

```bash
git revert <坏提交的 hash>
git commit -m "revert: 回滚 v1.0.40 的 <问题>"
# 把 main.go 的 version bump 到 v1.0.41,再打 tag 发版
```

**用户层面**的回退方式:

- Windows:`agnes-hub-go-windows-<旧版本>.zip` 重新解压覆盖 exe(保留 `data\`);
- 飞牛:重装旧 `fpk`;
- 容器:镜像 tag 改回旧版本号后 `docker compose up -d`。

### 5.3 只回滚容器镜像

镜像按不可变 tag 推送(`:1.0.39`、`:1.0.40` …),回滚只需改 compose 里的 tag:

```yaml
image: ghcr.io/winffychu/agnes-hub-go:1.0.39
```

> 注意 `:latest` 会被最新一次推送覆盖。生产环境建议固定到具体版本号,
> 不要长期跟随 `:latest`。

---

## 6. 快速排障

| 现象 | 原因 / 处理 |
| --- | --- |
| tag push 后 Release job 立刻失败,提示「版本不一致」 | 忘了 bump `main.go`;改版本号后重新打 tag |
| Actions 里找不到 workflow | tag 名须以 `v` 开头(如 `v1.0.40`),否则 `on.push.tags: 'v*'` 不触发 |
| Release 建了但少资产 | 看 job 日志中对应步骤;fpk 步骤依赖 ROOT 下的两个 linux 二进制,缺则报「缺少交叉编译产物」 |
| 镜像没推上去 | `docker` job 依赖 `release` 成功;另外确认仓库 ghcr 包权限允许写入 |
| 本地 `release.py` 报找不到 go | 把 go 加入 PATH,或设 `GO_BIN` 为 go 可执行文件绝对路径 |

---

## 7. 相关文档

- 容器部署与镜像 tag 约定:见 [`DOCKER.md`](DOCKER.md)
- 上游自更新机制:见根目录 `README.md` 第 7.5 节
