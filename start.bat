@echo off
title 免费视频聚合导航
cd /d "%~dp0"

if "%PORT%"=="" set "PORT=3000"
if not "%~1"=="" set "PORT=%~1"

echo.
echo  ══════════════════════════════════════════
echo   免费视频聚合导航 - 一键启动
echo  ══════════════════════════════════════════
echo.

where node >nul 2>nul
if errorlevel 1 (
    echo [错误] 未检测到 Node.js，请先安装：https://nodejs.org （装 LTS 版即可）
    pause
    exit /b 1
)

if not exist "server\node_modules" (
    echo [1/3] 首次运行：安装后端依赖...
    cd server
    call npm install --no-audit --no-fund
    if errorlevel 1 (
        echo [错误] 后端依赖安装失败，请检查网络后重试
        cd ..
        pause
        exit /b 1
    )
    cd ..
) else (
    echo [1/3] 后端依赖已就绪
)

if not exist "client\node_modules" (
    echo [2/3] 首次运行：安装前端依赖...
    cd client
    call npm install --no-audit --no-fund
    if errorlevel 1 (
        echo [错误] 前端依赖安装失败，请检查网络后重试
        cd ..
        pause
        exit /b 1
    )
    cd ..
) else (
    echo [2/3] 前端依赖已就绪
)

if not exist "client\dist\index.html" (
    echo [3/3] 首次运行：构建前端页面（约十几秒）...
    cd client
    call npm run build
    if errorlevel 1 (
        echo [错误] 前端构建失败
        cd ..
        pause
        exit /b 1
    )
    cd ..
) else (
    echo [3/3] 前端页面已构建
)

rem 端口上已有响应 = 服务多半已在运行，直接开浏览器，不重复启动
where curl >nul 2>nul
if not errorlevel 1 (
    curl -s -o nul --max-time 2 "http://localhost:%PORT%" >nul 2>nul
    if not errorlevel 1 (
        echo 检测到服务已在 http://localhost:%PORT% 运行，直接打开页面。
        if defined NO_BROWSER exit /b 0
        start "" "http://localhost:%PORT%"
        pause
        exit /b 0
    )
)

echo.
echo 启动服务中... 就绪后会自动打开 http://localhost:%PORT%
echo （关闭本窗口即可停止服务；修改了前端代码请删除 client\dist 后重新运行）
echo.

cd server
start /b "" node src/index.js

rem 轮询等待服务就绪（最多约 20 秒），就绪后再打开浏览器，避免打开时还连不上
where curl >nul 2>nul
if errorlevel 1 (
    rem 没有 curl 就退化为固定等待 3 秒
    ping -n 4 127.0.0.1 >nul
    goto openbrowser
)

set /a TRIES=0
:waitloop
ping -n 2 127.0.0.1 >nul
curl -s -o nul --max-time 2 "http://localhost:%PORT%" >nul 2>nul
if not errorlevel 1 goto openbrowser
set /a TRIES+=1
if %TRIES% lss 20 goto waitloop
echo [提示] 等待超时，仍会尝试打开页面；若打不开请查看上方错误日志。

:openbrowser
if defined NO_BROWSER (
    echo [NO_BROWSER] 服务已就绪 http://localhost:%PORT%
) else (
    start "" "http://localhost:%PORT%"
    echo 服务已就绪，浏览器已打开 http://localhost:%PORT%
    echo 本窗口可最小化，关闭窗口（或按 Ctrl+C）即停止服务。
)
pause >nul
