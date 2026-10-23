#!/usr/bin/env bash
# Qwen2API 服务控制脚本（源码 + Bun，无需 systemd）
#
#   ./scripts/qwen2api.sh start      后台启动（写 PID，日志到 logs/qwen2api.out）
#   ./scripts/qwen2api.sh stop       停止（先 TERM，15 秒不退再 KILL）
#   ./scripts/qwen2api.sh restart    重启
#   ./scripts/qwen2api.sh status     运行状态 + 健康检查
#   ./scripts/qwen2api.sh logs [-n]  跟踪日志（默认最近 100 行）
#
# 为什么还要这个脚本：systemd 是生产推荐，但很多人只是想在 VPS 上临时跑起来、
# 或者没有 root。这个脚本只依赖 bun 和 bash，把「起/停/看」三件事固化下来，
# 顺带避免最常见的两个坑：重复启动（进程内状态会各算各的）和找不到 .env。

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT" || exit 1

PID_FILE="$REPO_ROOT/logs/qwen2api.pid"
LOG_FILE="$REPO_ROOT/logs/qwen2api.out"
ENTRY="src/server.js"
SERVICE_NAME="qwen2api"

color() { printf '\033[%sm%s\033[0m\n' "$1" "$2"; }
info() { color '36' "$*"; }
ok() { color '32' "$*"; }
warn() { color '33' "$*"; }
fail() { color '31' "$*" >&2; }

# 从 .env 读端口（没有就用默认 3000）
read_port() {
  local port=""
  if [ -f .env ]; then
    port="$(grep -E '^SERVICE_PORT=' .env 2>/dev/null | tail -n 1 | cut -d= -f2- | tr -d '[:space:]')"
  fi
  printf '%s' "${port:-3000}"
}

find_bun() {
  if command -v bun >/dev/null 2>&1; then
    command -v bun
    return 0
  fi
  for candidate in "$HOME/.bun/bin/bun" /usr/local/bin/bun; do
    if [ -x "$candidate" ]; then
      printf '%s' "$candidate"
      return 0
    fi
  done
  return 1
}

running_pid() {
  [ -f "$PID_FILE" ] || return 1
  local pid
  pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  [ -n "$pid" ] || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  printf '%s' "$pid"
}

http_ok() {
  local port="$1"
  if command -v curl >/dev/null 2>&1; then
    curl -fsS --max-time 2 "http://127.0.0.1:${port}/api/health" >/dev/null 2>&1
    return $?
  fi
  # 没有 curl 时退化成「端口能不能连上」
  (exec 3<>"/dev/tcp/127.0.0.1/${port}") 2>/dev/null && exec 3>&- && return 0
  return 1
}

preflight() {
  local bun
  if ! bun="$(find_bun)"; then
    fail "✗ 没有找到 bun。先安装：curl -fsSL https://bun.sh/install | bash"
    return 1
  fi

  if [ ! -f .env ]; then
    cp .env.example .env 2>/dev/null || true
    warn "⚠ 没有 .env，已从 .env.example 复制一份。请先编辑它，至少设置："
    warn "    API_KEY=sk-你的密钥"
    warn "    DATA_SAVE_MODE=file      # 要在管理面板里加账号必须用 file"
    return 1
  fi

  if ! grep -qE '^API_KEY=.+' .env; then
    warn "⚠ .env 里没有设置 API_KEY，服务会拒绝启动。"
    return 1
  fi

  if ! grep -qE '^DATA_SAVE_MODE=(file|redis)' .env; then
    warn "⚠ .env 里 DATA_SAVE_MODE 不是 file/redis：管理面板里添加的账号不会保存。"
  fi

  if [ ! -f public/dist/index.html ]; then
    fail "✗ 前端还没构建（public/dist 不存在），先执行："
    fail "    bun install --cwd public --frozen-lockfile && bun run build:frontend"
    return 1
  fi

  if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
    fail "✗ 检测到 systemd 服务 $SERVICE_NAME 正在运行，别用这个脚本再起一份（会双实例）。"
    fail "    用 systemctl restart $SERVICE_NAME，或先 systemctl stop $SERVICE_NAME"
    return 1
  fi
  return 0
}

do_start() {
  local pid
  if pid="$(running_pid)"; then
    warn "⚠ 已经在运行了（PID $pid）——同一份数据不能起两个实例。"
    return 0
  fi
  preflight || return 1

  mkdir -p logs
  local bun port
  bun="$(find_bun)"
  port="$(read_port)"

  info "启动中…（工作目录 $REPO_ROOT，端口 $port）"
  nohup "$bun" --no-env-file "$ENTRY" >> "$LOG_FILE" 2>&1 &
  local new_pid=$!
  printf '%s' "$new_pid" > "$PID_FILE"

  local i
  for i in $(seq 1 20); do
    sleep 0.5
    if ! kill -0 "$new_pid" 2>/dev/null; then
      rm -f "$PID_FILE"
      fail "✗ 进程启动后就退出了，最后 20 行日志："
      tail -n 20 "$LOG_FILE" 2>/dev/null
      return 1
    fi
    if http_ok "$port"; then
      ok "✓ 已启动（PID $new_pid）"
      ok "  面板：http://127.0.0.1:${port}    健康检查：/api/health"
      ok "  日志：$LOG_FILE"
      return 0
    fi
  done

  # 进程还在但健康检查没通：多半是端口被占或配置有误，把日志尾巴给用户
  warn "⚠ 进程在跑（PID $new_pid），但 10 秒内没通过健康检查，检查日志："
  tail -n 20 "$LOG_FILE" 2>/dev/null
  return 1
}

do_stop() {
  local pid
  if ! pid="$(running_pid)"; then
    # PID 文件可能过期，顺手清掉
    rm -f "$PID_FILE"
    info "没有在运行。"
    return 0
  fi

  info "停止中（PID $pid）…"
  kill "$pid" 2>/dev/null || true
  local i
  for i in $(seq 1 30); do
    sleep 0.5
    if ! kill -0 "$pid" 2>/dev/null; then
      rm -f "$PID_FILE"
      ok "✓ 已停止。"
      return 0
    fi
  done

  warn "⚠ 15 秒内没退出，强制结束。"
  kill -9 "$pid" 2>/dev/null || true
  rm -f "$PID_FILE"
  ok "✓ 已强制停止。"
}

do_status() {
  local pid port
  port="$(read_port)"
  if pid="$(running_pid)"; then
    if http_ok "$port"; then
      ok "✓ 运行中（PID $pid，端口 $port，健康检查通过）"
    else
      warn "⚠ 进程在（PID $pid），但 http://127.0.0.1:${port}/api/health 不通"
    fi
  else
    info "○ 未运行"
  fi
  if [ -f "$LOG_FILE" ]; then
    info "最近日志：$LOG_FILE"
    tail -n 5 "$LOG_FILE" 2>/dev/null
  fi
}

do_logs() {
  if [ ! -f "$LOG_FILE" ]; then
    fail "✗ 还没有日志文件（服务没启动过？）：$LOG_FILE"
    return 1
  fi
  tail -n "${1:-100}" -f "$LOG_FILE"
}

case "${1:-}" in
  start) do_start ;;
  stop) do_stop ;;
  restart) do_stop && echo && do_start ;;
  status) do_status ;;
  logs) shift || true; do_logs "${1:-100}" ;;
  *)
    cat <<'USAGE'
用法：./scripts/qwen2api.sh <命令>

  start      后台启动服务（PID 写到 logs/qwen2api.pid，日志 logs/qwen2api.out）
  stop       停止服务（TERM，15 秒不退则 KILL）
  restart    重启
  status     运行状态 + 健康检查
  logs [n]   跟踪日志（默认最近 100 行）

首次使用前请先准备好：
  1) .env（至少 API_KEY、DATA_SAVE_MODE=file）
  2) bun install --frozen-lockfile && bun install --cwd public --frozen-lockfile && bun run build:frontend
装了 systemd 的机器请优先用 systemctl（脚本检测到会拒绝启动，避免双实例）。
USAGE
    exit 1
    ;;
esac
