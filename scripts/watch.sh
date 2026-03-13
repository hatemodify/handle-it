#!/bin/bash
# ═══════════════════════════════════════
#  watch.sh — 실시간 모니터링 TUI
#  사용법: watch.sh <team_dir>
# ═══════════════════════════════════════
set -euo pipefail

TEAM_DIR="${1:?'사용법: watch.sh <team_dir>'}"
QUEUE="$TEAM_DIR/tasks/queue.json"
CONFIG="$TEAM_DIR/config.json"

# 색상
R='\033[0;31m' G='\033[0;32m' Y='\033[1;33m'
# shellcheck disable=SC2034
B='\033[0;34m' M='\033[0;35m' C='\033[0;36m'
W='\033[1;37m' N='\033[0m' DIM='\033[2m'
# shellcheck disable=SC2034
BG_G='\033[42m' BG_R='\033[41m' BG_Y='\033[43m' BG_B='\033[44m'

# Ctrl+C로 깨끗하게 종료
trap 'tput cnorm; clear; exit 0' INT TERM

# 커서 숨기기
tput civis

render() {
  local team_name queue_data stats
  team_name=$(jq -r '.team_name' "$CONFIG" 2>/dev/null || echo "unknown")

  if [ ! -f "$QUEUE" ]; then
    echo "큐 파일 없음"
    return
  fi

  queue_data=$(cat "$QUEUE")
  stats=$(echo "$queue_data" | jq '{
    total: (.tasks | length),
    pending: [.tasks[] | select(.status=="pending")] | length,
    in_progress: [.tasks[] | select(.status=="in_progress")] | length,
    completed: [.tasks[] | select(.status=="completed")] | length,
    failed: [.tasks[] | select(.status=="failed")] | length
  }')

  local total pending in_progress completed failed
  total=$(echo "$stats" | jq '.total')
  pending=$(echo "$stats" | jq '.pending')
  in_progress=$(echo "$stats" | jq '.in_progress')
  completed=$(echo "$stats" | jq '.completed')
  failed=$(echo "$stats" | jq '.failed')

  # 화면 클리어 + 커서 홈
  printf '\033[H\033[2J'

  # 헤더
  echo -e "${W}╔══════════════════════════════════════════════════╗${N}"
  echo -e "${W}║       handle-it  ·  Live Monitor                ║${N}"
  echo -e "${W}╚══════════════════════════════════════════════════╝${N}"
  echo ""
  echo -e "  팀: ${C}$team_name${N}    $(date '+%H:%M:%S')"
  echo ""

  # 진행률 바
  local progress=0
  [ "$total" -gt 0 ] && progress=$(( completed * 40 / total ))
  local bar="" i
  for ((i=0; i<40; i++)); do
    if [ $i -lt $progress ]; then
      bar+="█"
    else
      bar+="░"
    fi
  done
  local pct=0
  [ "$total" -gt 0 ] && pct=$(( completed * 100 / total ))
  echo -e "  [${G}${bar}${N}] ${W}${pct}%${N}  (${G}$completed${N}/$total)"
  echo ""

  # 상태 요약 한 줄
  echo -e "  ${DIM}대기${N} ${Y}$pending${N}  ${DIM}진행${N} ${C}$in_progress${N}  ${DIM}완료${N} ${G}$completed${N}  ${DIM}실패${N} ${R}$failed${N}"
  echo ""

  # 태스크 목록
  echo -e "  ${W}─── 태스크 ─────────────────────────────────────${N}"
  echo "$queue_data" | jq -r '.tasks[] | "\(.status)|\(.id)|\(.subject)|\(.owner // "-")"' | \
    while IFS='|' read -r status id subject owner; do
      local icon color
      case "$status" in
        completed)   icon="✓"; color="$G" ;;
        in_progress) icon="→"; color="$C" ;;
        failed)      icon="✗"; color="$R" ;;
        pending)     icon="○"; color="$DIM" ;;
        *)           icon="?"; color="$N" ;;
      esac
      printf "  ${color}%s %-10s %-30s %s${N}\n" "$icon" "$id" "$subject" "($owner)"
    done
  echo ""

  # 에이전트 상태
  echo -e "  ${W}─── 에이전트 ───────────────────────────────────${N}"
  if [ -f "$CONFIG" ]; then
    jq -r '.agents[] | "\(.name)|\(.role)|\(.pid)|\(.status)|\(.respawn_count // 0)"' "$CONFIG" 2>/dev/null | \
      while IFS='|' read -r name role pid status respawns; do
        local alive="dead"
        local alive_color="$R"
        if kill -0 "$pid" 2>/dev/null; then
          alive="alive"
          alive_color="$G"
        fi
        local respawn_info=""
        [ "$respawns" -gt 0 ] && respawn_info=" ${Y}(리스폰: $respawns)${N}"
        printf "  ${M}%-12s${N} ${DIM}%-35s${N} PID:%-6s ${alive_color}%s${N}%s\n" \
          "$name" "$role" "$pid" "$alive" "$respawn_info"
      done
  fi
  echo ""

  # 최근 보고서
  echo -e "  ${W}─── 최근 보고서 ────────────────────────────────${N}"
  if [ -d "$TEAM_DIR/reports" ]; then
    find "$TEAM_DIR/reports" -name "*.json" -type f 2>/dev/null | head -5 | while read -r report; do
      local agent summary
      agent=$(jq -r '.agent' "$report" 2>/dev/null)
      summary=$(jq -r '.summary' "$report" 2>/dev/null | cut -c1-60)
      printf "  ${M}%-12s${N} %s\n" "$agent" "$summary"
    done
  fi
  if [ ! -d "$TEAM_DIR/reports" ] || [ -z "$(ls "$TEAM_DIR/reports/"*.json 2>/dev/null)" ]; then
    echo -e "  ${DIM}보고서 없음${N}"
  fi
  echo ""
  echo -e "  ${DIM}Ctrl+C로 종료  |  1초마다 갱신${N}"
}

# 메인 루프
while true; do
  render
  sleep 1
done
