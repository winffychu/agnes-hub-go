#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""agnes-hub-go 一键发版脚本。

用法：
    python tools/release.py            # 完整发版（编译 + 打包 + tag + GitHub Release）
    python tools/release.py --no-push  # 只做本地产物，不推 tag 与 Release

设计要点：
- **版本单一来源**：从 main.go 的 `var version = "x.y.z"` 读取，
  不再手改 build_fpk.py / manifest / tag 多处，杜绝版本漂移。
- **前置校验**：编译出的二进制嵌入版本必须等于 main.go 的 version，
  不一致就终止（防止再发旧版，如 1.0.3 的 windows exe 误发事故）。
- **产物 5 件**（对齐历史 Release 结构）：
    fpk + linux-amd64 + linux-arm64 + windows-zip + 裸 windows exe
- **GitHub 经 REST API**（本机无 gh CLI）：
    用 PAT + 代理建 Release、传资源。

前置条件：
    1. Go 工具链：脚本用 shutil.which("go") 查找，可用 GO_BIN 环境变量
       指定绝对路径兜底（不再硬编码本机路径）
    2. agnes-hub-go.bat 存在；dist/README.txt 若缺失会从
       tools/windows-readme.txt 自动生成
    3. 代理 127.0.0.1:3067 在监听（仅完整发版需要）
    4. GITHUB_PAT 环境变量或默认 PAT 可用
"""
import os
import re
import sys
import subprocess
import zipfile
import shutil

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, "dist")


def _find_go() -> str:
    """定位 go 可执行文件：GO_BIN 环境变量 > PATH > GOROOT/bin > 常见安装位。

    不再硬编码本机用户目录（C:\\Users\\<name>\\...），换机器 / 换用户也能跑。
    """
    override = os.environ.get("GO_BIN", "").strip()
    if override:
        if os.path.exists(override):
            return override
        sys.exit(f"[FATAL] GO_BIN 指定的路径不存在: {override}")
    found = shutil.which("go")
    if found:
        return found
    goroot_env = os.environ.get("GOROOT", "").strip()
    if goroot_env:
        cand = os.path.join(goroot_env, "bin", "go.exe" if os.name == "nt" else "go")
        if os.path.exists(cand):
            return cand
    for cand in (r"C:\Program Files\Go\bin\go.exe", r"C:\Go\bin\go.exe"):
        if os.path.exists(cand):
            return cand
    sys.exit("[FATAL] 未找到 go 可执行文件：请把 go 加入 PATH，"
             "或设置 GO_BIN 指向 go 可执行文件的绝对路径")


GO = _find_go()
# GOROOT / GOPATH / GOPROXY 均可被环境变量覆盖；留空则交给 go 自行探测
# （现代 Go 会自动推导 GOROOT，显式传错值反而会破坏构建）。
GOROOT = os.environ.get("GOROOT", "").strip()
GOPATH = os.environ.get("GOPATH", "").strip()
GOPROXY = os.environ.get("GOPROXY", "https://goproxy.cn,direct")
GITHUB_PAT = os.environ.get("GITHUB_PAT", "")  # 必须经环境变量传入，绝不入 git
PROXY = "http://127.0.0.1:3067"
# 发布目标仓库：本仓库 fork 的 Release 产出在 winffychu（与 CI release.yml、
# README 的下载链接同一目标）。可用 AGNES_HUB_RELEASE_REPO 环境变量覆盖；
# 注意 main.go 里的自更新默认仓库保持上游，那是另一回事，不要在这里同步。
REPO = os.environ.get("AGNES_HUB_RELEASE_REPO", "winffychu/agnes-hub-go").strip()


def version_from_main_go() -> str:
    """从 main.go 读取 `var version = "x.y.z"`。"""
    main_go = os.path.join(ROOT, "main.go")
    with open(main_go, "r", encoding="utf-8") as f:
        src = f.read()
    m = re.search(r'var\s+version\s*=\s*"(\d+\.\d+\.\d+)"', src)
    if not m:
        sys.exit("[FATAL] 无法从 main.go 解析版本号")
    return m.group(1)


def go_build(env, goos, goarch, out):
    """交叉编译单个目标。

    -trimpath -buildvcs=false 与 CI（release.yml）/ Dockerfile / README 的
    构建参数保持一致，保证两条链路产出的二进制可互换。
    """
    args = [GO, "build", "-trimpath", "-buildvcs=false",
            "-ldflags", "-s -w", "-o", out, "."]
    cmd_env = {**os.environ, **env, "GOOS": goos, "GOARCH": goarch}
    print(f"  building {goos}/{goarch} -> {os.path.basename(out)}")
    subprocess.run(args, cwd=ROOT, env=cmd_env, check=True)


def embedded_version(binary_path: str) -> set:
    """提取二进制里嵌入的版本字符串（用于前置校验）。

    之前的正则写死 `1\\.0\\.\\d+`，版本一旦离开 1.0.x（如 1.1.0 / 2.0.0）
    会在 check_version 处误报「嵌入版本不含 x.y.z」直接终止发版。
    改为通配三段式语义化版本号。
    """
    with open(binary_path, "rb") as f:
        data = f.read()
    return set(m.decode() for m in re.findall(rb"\d+\.\d+\.\d+", data))


def check_version(binary_path: str, expected: str):
    """前置校验：二进制嵌入版本必须包含 expected。"""
    vers = embedded_version(binary_path)
    if expected not in vers:
        print(f"  [ERROR] {os.path.basename(binary_path)} 嵌入版本 {vers} 不含 {expected}")
        sys.exit("[FATAL] 版本校验失败 —— 请确认 main.go 已 bump 且重新编译")
    print(f"  [OK] {os.path.basename(binary_path)} 嵌入版本 {expected}")


def build_zip(exe, bat, readme, out):
    if os.path.exists(out):
        os.remove(out)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        z.write(exe, "agnes-hub-go.exe")
        z.write(bat, "agnes-hub-go.bat")
        z.write(readme, "README.txt")
    print(f"  zip  {out} ({os.path.getsize(out)} bytes)")


def ensure_readme() -> str:
    """返回 Windows zip 里 README.txt 的路径。

    dist/README.txt 不存在时，从 tools/windows-readme.txt（UTF-8 模板，
    与 CI release.yml 同源）拷贝生成，不再要求手工准备。
    """
    readme = os.path.join(DIST, "README.txt")
    if os.path.exists(readme):
        return readme
    template = os.path.join(ROOT, "tools", "windows-readme.txt")
    if not os.path.exists(template):
        sys.exit("[FATAL] dist/README.txt 不存在，且模板 tools/windows-readme.txt 缺失")
    shutil.copyfile(template, readme)
    print(f"  [readme] 由 tools/windows-readme.txt 生成 {readme}")
    return readme


def build_fpk(version: str) -> str:
    """调用 build_fpk.py 生成 fpk。

    build_fpk.py 的版本号已改为从 main.go 单一来源读取（_version_from_main_go），
    无需再临时 sed 替换 VERSION/VERSION_TAG。产出文件名现为 agnes-hub-go-{version}.fpk。
    返回 fpk 的完整路径，供上层组装 Release 资源列表。
    """
    bf = os.path.join(ROOT, "tools", "build_fpk.py")
    subprocess.run([sys.executable, bf], cwd=ROOT, check=True)
    fpk = os.path.join(DIST, f"agnes-hub-go-{version}.fpk")
    if not os.path.exists(fpk):
        sys.exit(f"[FATAL] 未生成 {fpk}")
    print(f"  fpk  {fpk} ({os.path.getsize(fpk)} bytes)")
    return fpk


def git_push_tag(version: str):
    tag = f"v{version}"
    cmd = ["git", "tag", "-a", tag, "-m", f"v{version}"]
    subprocess.run(cmd, cwd=ROOT, check=True)
    print(f"  git tag {tag}")
    push = subprocess.run(
        ["git", "push", f"https://{GITHUB_PAT}@github.com/{REPO}.git", tag],
        cwd=ROOT,
        env={**os.environ, "HTTPS_PROXY": PROXY, "HTTP_PROXY": PROXY,
             "https_proxy": PROXY, "http_proxy": PROXY},
        capture_output=True, text=True,
    )
    if push.returncode != 0:
        print(f"  [WARN] git push tag 失败: {push.stderr.strip()}")


def release_notes(version: str) -> str:
    """Release 正文。

    优先读 tools/release_notes.md（每版发版时手写下要点即可，不必再改本脚本），
    不存在时回退到内置文案，保证脚本永远能跑。
    """
    notes_md = os.path.join(ROOT, "tools", "release_notes.md")
    if os.path.exists(notes_md):
        with open(notes_md, "r", encoding="utf-8") as f:
            md = f.read().strip()
        if md:
            print("  [notes] 使用 tools/release_notes.md")
            return md.replace("{{VERSION}}", version)
    print("  [notes] 未找到 tools/release_notes.md，回退内置文案")
    return (
        f"## Agnes Hub v{version}\n\n"
        "多账号聚合中转网关，支持 agnes / AMD / NVIDIA / M365 / OpenRouter 等渠道统一调度与 RPM 限流排队。\n\n"
        "### 下载\n"
        f"- `agnes-hub-go-{version}.fpk` — 飞牛 fnOS 安装包\n"
        f"- `agnes-hub-go-windows-{version}.zip` — Windows 绿色版\n"
        f"- `agnes-hub-go-linux-amd64` / `agnes-hub-go-linux-arm64` — Linux 二进制\n"
        f"- `agnes-hub-go.exe` — Windows 裸可执行文件\n"
    )


def github_release(version: str, assets):
    """经 REST API 建 Release + 上传资源。"""
    import requests
    h = {"Authorization": f"Bearer {GITHUB_PAT}",
         "Accept": "application/vnd.github+json",
         "X-GitHub-Api-Version": "2022-11-28"}
    proxies = {"https": PROXY, "http": PROXY}

    # 删除已存在同名 tag 的旧 release（重发场景）
    r0 = requests.get(f"https://api.github.com/repos/{REPO}/releases/tags/v{version}",
                      headers=h, proxies=proxies, timeout=30)
    if r0.status_code == 200:
        rel_id = r0.json()["id"]
        requests.delete(f"https://api.github.com/repos/{REPO}/releases/{rel_id}",
                        headers=h, proxies=proxies, timeout=30)
        print(f"  [del] 旧 release v{version} (id={rel_id})")

    body = release_notes(version)
    r = requests.post(f"https://api.github.com/repos/{REPO}/releases", headers=h,
                      proxies=proxies, json={"tag_name": f"v{version}", "name": f"v{version}",
                                             "body": body, "draft": False, "prerelease": False},
                      timeout=60)
    r.raise_for_status()
    rel = r.json()
    print(f"  release {rel['html_url']}")
    for path, name, ct in assets:
        with open(path, "rb") as f:
            data = f.read()
        ur = requests.post(
            f"https://uploads.github.com/repos/{REPO}/releases/{rel['id']}/assets?name={name}",
            headers={**h, "Content-Type": ct}, proxies=proxies, data=data, timeout=300)
        if ur.status_code >= 300:
            sys.exit(f"[FATAL] 上传 {name} 失败: {ur.status_code} {ur.text[:200]}")
        print(f"  + {name} ({len(data)} bytes)")
    print(f"  [done] {rel['html_url']}")


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-push", action="store_true", help="只本地产物，不推 tag/Release")
    args = ap.parse_args()

    if not args.no_push and not GITHUB_PAT:
        sys.exit("[FATAL] 推 tag/Release 需要 GITHUB_PAT 环境变量：\n"
                 "    set GITHUB_PAT=ghp_xxxx   (Windows)\n"
                 "    export GITHUB_PAT=ghp_xxxx  (Linux/macOS)\n"
                 "PAT 绝不写入代码或 git，只能经环境变量传入。")

    version = version_from_main_go()
    print(f"[release] 版本 {version}（来自 main.go）")
    os.makedirs(DIST, exist_ok=True)

    go_env = {"GOFLAGS": "-mod=mod", "GOPROXY": GOPROXY}
    if GOROOT:
        go_env["GOROOT"] = GOROOT
    if GOPATH:
        go_env["GOPATH"] = GOPATH

    # 1. 交叉编译
    #    注意：build_fpk.py 的 prepare() 要求 ROOT 下存在 agnes-hub-go-linux-amd64 /
    #    agnes-hub-go-linux-arm64（与 fnOS 内部二进制同名），故此处产出名必须与之一致。
    linux_amd64 = os.path.join(ROOT, "agnes-hub-go-linux-amd64")
    linux_arm64 = os.path.join(ROOT, "agnes-hub-go-linux-arm64")
    win_exe = os.path.join(ROOT, "agnes-hub-go.exe")
    go_build(go_env, "linux", "amd64", linux_amd64)
    go_build(go_env, "linux", "arm64", linux_arm64)
    go_build(go_env, "windows", "amd64", win_exe)

    # 2. 前置校验
    check_version(linux_amd64, version)
    check_version(linux_arm64, version)
    check_version(win_exe, version)

    # 3. Windows 包
    bat = os.path.join(ROOT, "agnes-hub-go.bat")
    readme = ensure_readme()
    win_zip = os.path.join(DIST, f"agnes-hub-go-windows-{version}.zip")
    build_zip(win_exe, bat, readme, win_zip)

    # 4. fpk
    fpk = build_fpk(version)

    if args.no_push:
        print("[done --no-push] 本地产物完成，未推 tag/Release")
        return

    # 5. tag + GitHub Release
    git_push_tag(version)
    assets = [
        (fpk, f"agnes-hub-go-{version}.fpk", "application/octet-stream"),
        (linux_amd64, "agnes-hub-go-linux-amd64", "application/octet-stream"),
        (linux_arm64, "agnes-hub-go-linux-arm64", "application/octet-stream"),
        (win_zip, f"agnes-hub-go-windows-{version}.zip", "application/zip"),
        (win_exe, "agnes-hub-go.exe", "application/octet-stream"),
    ]
    github_release(version, assets)


if __name__ == "__main__":
    main()
