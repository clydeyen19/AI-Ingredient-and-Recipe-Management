#!/usr/bin/env zsh
set -e

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

cd "$ROOT_DIR/backend"
if [ ! -d ".venv" ]; then
  python3 -m venv .venv
fi
"$ROOT_DIR/backend/.venv/bin/pip" install -r requirements.txt
"$ROOT_DIR/backend/.venv/bin/python" app.py &
BACKEND_PID=$!

cd "$ROOT_DIR/frontend"
if [ ! -d "node_modules" ]; then
  npm install
fi
npm run dev -- --port 5173 &
FRONTEND_PID=$!

sleep 2
open "http://127.0.0.1:5173/" >/dev/null 2>&1 || true
echo "食材飲食管理已啟動："
echo "  前端 http://127.0.0.1:5173/"
echo "  後端 http://127.0.0.1:8000/"
echo ""
echo "按 Ctrl+C 停止。"

trap 'kill $BACKEND_PID $FRONTEND_PID 2>/dev/null || true' INT TERM EXIT
wait
