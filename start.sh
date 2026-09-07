#!/usr/bin/env bash
# 免费视频聚合导航 - 一键启动（Linux / macOS）
set -e
cd "$(dirname "$0")"

PORT="${1:-${PORT:-3000}}"
export PORT

echo ""
echo " ══════════════════════════════════════════"
echo "  免费视频聚合导航 - 一键启动"
echo " ══════════════════════════════════════════"
echo ""

if ! command -v node >/dev/null 2>&1; then
    echo "[错误] 未检测到 Node.js，请先安装：https://nodejs.org"
    exit 1
fi

if [ ! -d "server/node_modules" ]; then
    echo "[1/3] 首次运行：安装后端依赖..."
    (cd server && npm install --no-audit --no-fund)
else
    echo "[1/3] 后端依赖已就绪"
fi

if [ ! -d "client/node_modules" ]; then
    echo "[2/3] 首次运行：安装前端依赖..."
    (cd client && npm install --no-audit --no-fund)
else
    echo "[2/3] 前端依赖已就绪"
fi

if [ ! -f "client/dist/index.html" ]; then
    echo "[3/3] 首次运行：构建前端页面..."
    (cd client && npm run build)
else
    echo "[3/3] 前端页面已构建"
fi

open_page() {
    [ -n "$NO_BROWSER" ] && return 0
    xdg-open "http://localhost:$PORT" >/dev/null 2>&1 \
        || open "http://localhost:$PORT" >/dev/null 2>&1 \
        || echo "请手动打开 http://localhost:$PORT"
    return 0
}

# 端口上已有响应 = 服务多半已在运行，直接开浏览器，不重复启动
if command -v curl >/dev/null 2>&1 && curl -s -o /dev/null --max-time 2 "http://localhost:$PORT"; then
    echo "检测到服务已在 http://localhost:$PORT 运行，直接打开页面。"
    open_page
    exit 0
fi

echo ""
echo "启动服务中... 就绪后会自动打开 http://localhost:$PORT （Ctrl+C 停止）"
echo ""

(cd server && exec node src/index.js) &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT

# 轮询等待服务就绪（最多约 20 秒）再打开浏览器
if command -v curl >/dev/null 2>&1; then
    for _ in {1..20}; do
        curl -s -o /dev/null --max-time 2 "http://localhost:$PORT" && break
        sleep 1
    done
else
    sleep 3
fi

open_page
echo "服务已就绪，浏览器已打开 http://localhost:$PORT （Ctrl+C 停止）"

wait "$SERVER_PID"
