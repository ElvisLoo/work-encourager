@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

REM ==========================================================
REM  牛马鼓励器 · 一键发布到 GitHub（Token 模式）
REM  双击本文件 → 粘贴 token（输入时不显示）→ 自动建仓/推送/发版
REM  Token 不会写入本文件，也不会上传到任何地方
REM ==========================================================

title 牛马鼓励器 - 发布到 GitHub

echo.
echo ============================================================
echo   牛马鼓励器 · 发布到 GitHub
echo ============================================================
echo.
echo  需要一个 GitHub Token（只需一次）：
echo.
echo   1. 打开 https://github.com/settings/tokens
echo   2. Generate new token ^-^> Generate new token (classic)
echo   3. Note 随便填，Expiration 选 7 days
echo   4. 勾选 [v] repo  （只要这一个就够）
echo   5. 点最下面 Generate token，复制那串 ghp_ 开头的字符
echo.
echo  ------------------------------------------------------------
echo   下面是隐藏输入，粘贴后按回车即可（屏幕上不会显示）
echo  ------------------------------------------------------------
echo.

powershell -NoProfile -Command ^
  "$s = Read-Host -AsSecureString '请粘贴 Token 后回车'; $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s); $t = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b); [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b); if ($t.Length -lt 20) { Write-Host 'Token 太短，可能没粘贴成功' -ForegroundColor Red; exit 1 }; $t | Set-Content -NoNewline -Encoding ascii '%TEMP%\we_token.txt'; Write-Host ('已接收，长度 ' + $t.Length) -ForegroundColor Green"

if errorlevel 1 (
    echo.
    echo   [!] 没有拿到有效的 Token，退出。
    pause
    exit /b 1
)

echo.
echo ------------------------------------------------------------
echo   开始执行：建仓库 -^> 推送代码 -^> 打 tag -^> 发 Release
echo ------------------------------------------------------------
echo.

set "TOKEN_FILE=%TEMP%\we_token.txt"
set /p GH_TOKEN=<"%TOKEN_FILE%"

python "%~dp0scripts\push_all.py" "%GH_TOKEN%"
if errorlevel 1 (
    echo.
    echo   [!] 执行失败，请把上面的报错发给助手。
    del "%TOKEN_FILE%" >nul 2>&1
    pause
    exit /b 1
)

del "%TOKEN_FILE%" >nul 2>&1
echo.
echo   Token 已从本机临时文件中清除。
echo.
pause
