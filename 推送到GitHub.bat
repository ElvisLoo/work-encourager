@echo off
chcp 65001 >nul
setlocal

REM ============================================================
REM  牛马鼓励器 · 一键推送到 GitHub
REM  用法：双击本文件即可（需要本机已有 GitHub 登录凭据）
REM ============================================================

cd /d "%~dp0"

echo.
echo ============================================
echo   牛马鼓励器 - 推送到 GitHub
echo ============================================
echo.

REM 1) 检查是否已配置 remote
git remote get-url origin >nul 2>&1
if errorlevel 1 (
    echo [1/4] 创建 GitHub 仓库...
    where gh >nul 2>&1
    if errorlevel 1 (
        echo.
        echo   [!] 本机没有安装 GitHub CLI ^(gh^)。
        echo.
        echo   两种办法，任选一种：
        echo.
        echo   A. 手动建仓库后回到这里再双击一次：
        echo      打开 https://github.com/new
        echo      仓库名填 work-encourager ，选 Public，不要勾选任何初始化文件
        echo.
        echo   B. 安装 GitHub CLI 后运行：
        echo      winget install --id GitHub.cli
        echo      gh auth login
        echo      gh repo create work-encourager --public --source=. --push
        echo.
        pause
        exit /b 1
    )
    gh repo create work-encourager --public --source=. --remote=origin --description "牛马鼓励器 · 上班鼓励器 —— 把每一秒的进账变成看得见的小快乐（Windows / macOS / Linux）"
    if errorlevel 1 (
        echo   [!] 自动创建失败，请手动到 https://github.com/new 建 work-encourager 后重试
        pause
        exit /b 1
    )
    echo   仓库已创建
) else (
    echo [1/4] 远程仓库已配置:
    git remote get-url origin
)

echo.
echo [2/4] 检查改动...
git add -A
git -c core.quotepath=false status --short

echo.
echo [3/4] 提交...
git -c core.quotepath=false diff --cached --quiet
if errorlevel 1 (
    git commit -m "chore: 更新文档与截图"
) else (
    echo   没有新的改动需要提交
)

echo.
echo [4/4] 推送...
git push -u origin main
if errorlevel 1 (
    echo.
    echo   [!] 推送失败。常见原因：
    echo       1. GitHub 网络不通 —— 稍后重试，或检查代理
    echo       2. 需要重新登录 —— 运行: git credential-manager github login
    echo.
    pause
    exit /b 1
)

echo.
echo ============================================
echo   完成！仓库地址：
git remote get-url origin
echo ============================================
echo.

REM 打开仓库页面
for /f "delims=" %%u in ('git remote get-url origin') do (
    set "URL=%%u"
)
set "URL=%URL:.git=%"
start "" "%URL%"

pause
