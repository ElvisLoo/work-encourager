# 发布到自己的 GitHub

这个目录已经是一个可以独立发布的完整仓库（`package.json` / `README.md` / `LICENSE` / `.gitignore` 都齐了）。

## 1. 先在 GitHub 建仓库

打开 <https://github.com/new>，填：

- **Repository name**：`work-encourager`
- **Description**：`牛马鼓励器 · 上班鼓励器 —— 把每一秒的进账变成看得见的小快乐（Windows / macOS / Linux）`
- 选 **Public**，**不要**勾选 "Add a README file"（本地已经有）
- 点 **Create repository**

## 2. 在本地推上去

把下面的 `你的用户名` 换成你的 GitHub 用户名，在 `work-encourager` 目录里逐行执行：

```bash
git init
git add .
git commit -m "feat: 牛马鼓励器 v1.0.0 — 实时计薪 + 下班倒计时 + 迷你悬浮窗"
git branch -M main
git remote add origin https://github.com/你的用户名/work-encourager.git
git push -u origin main
```

如果推送时要账号密码，密码填 **Personal Access Token**（GitHub 已经不支持用登录密码推送）：
<https://github.com/settings/tokens> → Generate new token (classic) → 勾选 `repo` → 生成后复制，当作密码粘贴。

## 3. 发一个 Release 挂安装包

安装包已经打好了，在 `release/` 目录：

| 文件 | 大小 | 说明 |
| --- | --- | --- |
| `WorkEncourager-Setup-1.0.0.exe` | ~78 MB | 安装版，可选安装目录，自动建快捷方式 |
| `WorkEncourager-Portable-1.0.0.exe` | ~71 MB | 便携版，免安装 |

操作：

1. 打开仓库页面 → 右侧 **Releases** → **Create a new release**
2. **Choose a tag** 填 `v1.0.0` → 点 "Create new tag"
3. **Release title**：`v1.0.0 首个版本`
4. 描述里可以贴一段：

   > 实时看见每一秒的进账。Windows 安装版与便携版，macOS / Linux 可自行编译，也可直接用 `src/index.html` 网页版。

5. 把 `release/` 里两个 `.exe` 拖到 "Attach binaries" 区域
6. 点 **Publish release**

## 4. 可选：让 README 更好看

- 仓库 **Settings → General → Social preview** 上传 `docs/shot-main.png`，分享出去会有缩略图
- 仓库右侧 **About** 的 Description 填一句话，Topics 加上：`electron` `desktop` `salary` `work` `windows` `productivity` `chinese`

## 5. 以后改版本

1. 改 `package.json` 里的 `version`
2. 重新打包（需要本地已有 NSIS 缓存，这条命令带的三个环境变量就是指定缓存）：

```bash
export ELECTRON_BUILDER_NSIS_DIR="$LOCALAPPDATA/electron-builder/Cache/nsis-3.0.4.1/nsis-3.0.4.1-1mx3n"
npx electron-builder --win nsis --x64
npx electron-builder --win portable --x64
```

3. 按第 3 步发新 Release

---

## 一点提醒

- 安装包**没有代码签名**，Windows 首次运行会弹 SmartScreen「未知发布者」，这是正常的，点「更多信息 → 仍要运行」。要消掉得买代码签名证书（一年几千块），个人小工具一般没必要。
- 仓库里不要提交 `node_modules/`、`release/`、`.qa/`，`.gitignore` 已经挡住了。
- 推送前想再扫一遍有没有敏感信息：

```bash
grep -rInE "(api[_-]?key|secret|token|password|ghp_|sk-[A-Za-z0-9]{20,})" src scripts test README.md
```

本次交付前已扫描：无凭据、无任何运行时网络请求。
