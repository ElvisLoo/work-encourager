"""
一键完成：建仓库 → 推送 → 发 Release（含安装包）
用法：python push_all.py <TOKEN>
"""
import json, os, subprocess, sys, time, urllib.request, urllib.error, mimetypes

REPO = "work-encourager"
OWNER = "ElvisLoo"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
API = "https://api.github.com"


def call(method, path, token, data=None, raw=None, content_type="application/json"):
    url = path if path.startswith("http") else API + path
    body = raw if raw is not None else (json.dumps(data).encode() if data is not None else None)
    req = urllib.request.Request(url, data=body, method=method, headers={
        "Authorization": "token " + token,
        "Accept": "application/vnd.github+json",
        "User-Agent": "we-push",
        "Content-Type": content_type,
    })
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            txt = r.read()
            return r.status, (json.loads(txt) if txt and r.headers.get_content_type() == "application/json" else txt)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(errors="replace")[:500]


def sh(cwd, *args, **kw):
    r = subprocess.run(args, cwd=cwd, capture_output=True, text=True, **kw)
    return r.returncode, (r.stdout + r.stderr).strip()


def main():
    if len(sys.argv) < 2:
        print("usage: push_all.py <TOKEN>"); return 1
    token = sys.argv[1].strip()

    # 0) 验证 token
    st, me = call("GET", "/user", token)
    if st != 200:
        print("TOKEN 无效:", st, me); return 1
    print("[0] 认证通过:", me["login"])

    # 1) 建仓库
    st, r = call("GET", f"/repos/{OWNER}/{REPO}", token)
    if st == 200:
        print("[1] 仓库已存在")
    else:
        st, r = call("POST", "/user/repos", token, data={
            "name": REPO,
            "description": "牛马鼓励器 · 上班鼓励器 —— 把每一秒的进账变成看得见的小快乐（Windows / macOS / Linux）",
            "private": False, "has_issues": True, "has_wiki": False, "has_projects": False,
        })
        if st not in (200, 201):
            print("[1] 建仓失败:", st, r); return 1
        print("[1] 仓库已创建:", r.get("html_url"))

    # 2) 配置 remote 为 HTTPS（带 token 推送，避免依赖 GCM）
    url = f"https://x-access-token:{token}@github.com/{OWNER}/{REPO}.git"
    sh(ROOT, "git", "remote", "remove", "origin")
    sh(ROOT, "git", "remote", "add", "origin", url)
    print("[2] remote 已设置为 HTTPS(token)")

    # 3) 推送
    rc, out = sh(ROOT, "git", "push", "-u", "origin", "main")
    print("[3] push:", "OK" if rc == 0 else "FAIL")
    if rc != 0:
        print(out[-800:]); return 1

    # 恢复为干净的 SSH remote，避免 token 留在 .git/config 里
    sh(ROOT, "git", "remote", "set-url", "origin", f"git@github.com:{OWNER}/{REPO}.git")
    print("[3b] remote 已还原为 SSH（token 不留在配置里）")

    # 4) 打 tag 并发 Release
    tag = "v1.0.0"
    sh(ROOT, "git", "tag", "-f", tag)
    sh(ROOT, "git", "push", "-f", "origin", tag)

    st, rel = call("POST", f"/repos/{OWNER}/{REPO}/releases", token, data={
        "tag_name": tag,
        "name": f"{tag} 首个版本",
        "body": "实时看见每一秒的进账。\n\n- Windows 安装版与便携版\n- macOS / Linux 可自行编译\n- 也可直接用 `src/index.html` 网页版\n\n> 安装包未做代码签名，SmartScreen 提示时选「更多信息 → 仍要运行」。",
        "draft": False, "prerelease": False,
    })
    if st not in (200, 201):
        print("[4] Release 创建失败:", st, rel); return 1
    upload_url = rel["upload_url"].split("{")[0]
    print("[4] Release 已创建:", rel["html_url"])

    # 5) 上传资产
    for fname in ["WorkEncourager-Setup-1.0.0.exe", "WorkEncourager-Portable-1.0.0.exe"]:
        path = os.path.join(ROOT, "release", fname)
        if not os.path.exists(path):
            print("    跳过（不存在）:", fname); continue
        size = os.path.getsize(path)
        with open(path, "rb") as f:
            data = f.read()
        st, res = call("POST", f"{upload_url}?name={fname}", token, raw=data,
                       content_type="application/octet-stream")
        print(f"    上传 {fname} ({size/1048576:.1f} MB):", "OK" if st in (200, 201) else f"FAIL {st}")

    print()
    print("=== 全部完成 ===")
    print("仓库:", f"https://github.com/{OWNER}/{REPO}")
    print("发布:", rel["html_url"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
