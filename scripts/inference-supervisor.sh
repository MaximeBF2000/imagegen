#!/bin/bash
# Keeps the native FLUX inference server (apps/inference, Apple GPU) in sync with
# the Docker Compose stack: it runs while the `api` container of the `imagegen`
# project runs, and is stopped (model unloaded, memory freed) when it stops.
#
# Started at login by launchd (scripts/install-inference-agent.sh). It is idle
# (just listening to `docker events`) while the containers are off.

set -u

REPO="$(cd "$(dirname "$0")/.." && pwd)"
PROJECT="${IMAGEGEN_COMPOSE_PROJECT:-imagegen}"
SERVICE="api"
PYTHON="$REPO/apps/inference/.venv/bin/python"
STATE_DIR="${IMAGEGEN_STATE_DIR:-$HOME/Library/Application Support/imagegen}"
LOG_DIR="${IMAGEGEN_LOG_DIR:-$HOME/Library/Logs/imagegen}"
PIDFILE="$STATE_DIR/inference.pid"
PORT="${INFERENCE_PORT:-8000}"

export PATH="$HOME/.docker/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin"
mkdir -p "$STATE_DIR" "$LOG_DIR"

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*"; }

running_pid() {
  [ -f "$PIDFILE" ] || return 1
  local pid
  pid="$(cat "$PIDFILE")"
  if kill -0 "$pid" 2>/dev/null; then echo "$pid"; return 0; fi
  rm -f "$PIDFILE"
  return 1
}

start_inference() {
  if running_pid >/dev/null; then return; fi
  if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    log "port $PORT already in use (probably \`pnpm dev\`), not starting a second server"
    return
  fi
  if [ ! -x "$PYTHON" ]; then
    log "ERROR: $PYTHON missing. Run \`pnpm setup:model\` once."
    return
  fi
  log "api container is up: starting inference server"
  cd "$REPO/apps/inference" || return
  # Model weights come from the local Hugging Face cache only.
  HF_HUB_OFFLINE=1 HF_HUB_DISABLE_TELEMETRY=1 nohup "$PYTHON" server.py >>"$LOG_DIR/inference.log" 2>&1 &
  echo $! >"$PIDFILE"
  log "inference server started (pid $!)"
}

stop_inference() {
  local pid
  pid="$(running_pid)" || return
  log "api container is down: stopping inference server (pid $pid)"
  kill "$pid" 2>/dev/null
  for _ in $(seq 1 20); do kill -0 "$pid" 2>/dev/null || break; sleep 0.5; done
  kill -9 "$pid" 2>/dev/null
  rm -f "$PIDFILE"
  log "inference server stopped"
}

api_running() {
  [ -n "$(docker ps -q \
    --filter "label=com.docker.compose.project=$PROJECT" \
    --filter "label=com.docker.compose.service=$SERVICE" \
    --filter status=running 2>/dev/null)" ]
}

reconcile() {
  if api_running; then start_inference; else stop_inference; fi
}

trap 'stop_inference; exit 0' TERM INT

log "supervisor started (repo: $REPO)"
while true; do
  if docker info >/dev/null 2>&1; then
    reconcile
    # Blocks until Docker goes away; each container lifecycle event triggers a reconcile.
    docker events \
      --filter "label=com.docker.compose.project=$PROJECT" \
      --filter "label=com.docker.compose.service=$SERVICE" \
      --filter type=container \
      --filter event=start --filter event=stop --filter event=die --filter event=kill \
      --format '{{.Action}}' 2>>"$LOG_DIR/supervisor-errors.log" |
      while read -r _; do reconcile; done
  fi
  # Docker isn't running (or just quit): containers are necessarily down.
  docker info >/dev/null 2>&1 || stop_inference
  sleep 5
done
