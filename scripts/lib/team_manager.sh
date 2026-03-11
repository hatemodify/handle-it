#!/bin/bash
# ═══════════════════════════════════════════════════════
#  team_manager.sh — 팀/에이전트 생명주기 관리
# ═══════════════════════════════════════════════════════
AUTODEV_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
source "$AUTODEV_ROOT/lib/logger.sh"
source "$AUTODEV_ROOT/lib/task_queue.sh"
source "$AUTODEV_ROOT/lib/messenger.sh"

TEAMS_ROOT="${HANDLE_IT_TEAMS_ROOT:-${AUTODEV_TEAMS_ROOT:-$HOME/.handle-it/teams}}"
CLAUDE_BIN="${CLAUDE_BIN:-claude}"

# ═══════════════════════════════════════
#  team_create: 팀 디렉토리 + 메타데이터 초기화
# ═══════════════════════════════════════
team_create() {
  local team_name="$1"
  local team_dir="$TEAMS_ROOT/$team_name"

  mkdir -p \
    "$team_dir/inbox" \
    "$team_dir/tasks" \
    "$team_dir/agents" \
    "$team_dir/logs" \
    "$team_dir/output"

  cat > "$team_dir/config.json" <<EOF
{
  "team_name": "$team_name",
  "created_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "status": "active",
  "agents": []
}
EOF

  tq_init "$team_dir/tasks/queue.json"
  log_success "팀 생성: $team_name"
  echo "$team_dir"
}

# ═══════════════════════════════════════
#  agent_spawn: 에이전트 프로세스 생성
#  $1: team_name  $2: agent_name  $3: role
#  $4: allowed_tools (선택, 기본값 있음)
# ═══════════════════════════════════════
agent_spawn() {
  local team_name="$1"
  local agent_name="$2"
  local role="$3"
  local allowed_tools="${4:-Read,Write,Edit,Bash}"
  local team_dir="$TEAMS_ROOT/$team_name"
  local runner="$team_dir/agents/${agent_name}.sh"
  local log_file="$team_dir/logs/${agent_name}.log"
  local pid_file="$team_dir/agents/${agent_name}.pid"

  # 에이전트 러너 스크립트 생성
  cat > "$runner" <<RUNNER_EOF
#!/bin/bash
# ── 에이전트: $agent_name / 역할: $role ──
set -euo pipefail

AUTODEV_ROOT="$AUTODEV_ROOT"
TEAMS_ROOT="$TEAMS_ROOT"
TEAM_NAME="$team_name"
AGENT_NAME="$agent_name"
TEAM_DIR="$team_dir"
QUEUE_FILE="\$TEAM_DIR/tasks/queue.json"
INBOX_DIR="\$TEAM_DIR/inbox"
LOG_FILE="$log_file"
CLAUDE_BIN="$CLAUDE_BIN"
PROJECT_DIR="\$(cat "\$TEAM_DIR/../project_dir" 2>/dev/null || echo '/tmp/autodev_project')"

source "\$AUTODEV_ROOT/lib/logger.sh"
source "\$AUTODEV_ROOT/lib/task_queue.sh"
source "\$AUTODEV_ROOT/lib/messenger.sh"

export AUTODEV_LOG_FILE="\$LOG_FILE"

log_agent "$agent_name" "시작"

# ── 메인 루프 ──
while true; do
  # 1. inbox 확인
  MESSAGES=\$(msg_read "\$INBOX_DIR" "$agent_name")
  MSG_COUNT=\$(echo "\$MESSAGES" | jq 'length')
  if [ "\$MSG_COUNT" -gt 0 ]; then
    log_agent "$agent_name" "수신 메시지 \${MSG_COUNT}건"
    # 종료 메시지 확인
    SHUTDOWN=\$(echo "\$MESSAGES" | jq -r '.[] | select(.type=="shutdown") | .content' | head -1)
    if [ -n "\$SHUTDOWN" ]; then
      log_agent "$agent_name" "종료 신호 수신, 종료"
      break
    fi
  fi

  # 2. 태스크 클레임 시도
  TASK_ID=\$(tq_claim "\$QUEUE_FILE" "$agent_name")

  if [ "\$TASK_ID" = "none" ]; then
    # 큐 전체 완료 확인
    if tq_all_done "\$QUEUE_FILE"; then
      log_agent "$agent_name" "큐 완료, 종료"
      break
    fi
    # 의존성 대기
    sleep 2
    continue
  fi

  # 3. 태스크 실행
  TASK_DATA=\$(tq_get "\$QUEUE_FILE" "\$TASK_ID")
  TASK_SUBJECT=\$(echo "\$TASK_DATA" | jq -r '.subject')
  TASK_DESC=\$(echo "\$TASK_DATA" | jq -r '.description')

  log_agent "$agent_name" "태스크 시작: \$TASK_ID [\$TASK_SUBJECT]"

  # 4. Claude 실행
  CLAUDE_PROMPT=\$(cat <<PROMPT_EOF
당신은 AutoDev 팀의 전문 에이전트입니다.

## 에이전트 정보
- 이름: $agent_name
- 역할: $role

## 프로젝트 컨텍스트
\$(cat "$HOME/.handle-it/CLAUDE.md" 2>/dev/null || echo '컨텍스트 없음')

## 현재 태스크
- ID: \$TASK_ID
- 제목: \$TASK_SUBJECT
- 설명: \$TASK_DESC

## 팀 현황 (태스크 큐)
\$(cat "\$QUEUE_FILE")

## 이전 에이전트 메시지
\$MESSAGES

## 실행 규칙
1. 태스크를 완전히 완료할 것
2. 결과물은 반드시 \$PROJECT_DIR 에 저장
3. 다른 에이전트에게 전달할 내용은 \$TEAM_DIR/inbox/{에이전트명}_{timestamp}.json 으로 저장
4. 완료 후 마지막 줄에 반드시 출력: TASK_RESULT: [완료 요약]
PROMPT_EOF
  )

  RESULT=\$(\$CLAUDE_BIN --print \
    --allowedTools "$allowed_tools" \
    --dangerously-skip-permissions \
    -p "\$CLAUDE_PROMPT" 2>&1) || RESULT="실행 실패"

  # 5. 결과 파싱 + 태스크 완료
  TASK_RESULT=\$(echo "\$RESULT" | grep '^TASK_RESULT:' | sed 's/TASK_RESULT: //' | tail -1)
  [ -z "\$TASK_RESULT" ] && TASK_RESULT="완료"

  tq_complete "\$QUEUE_FILE" "\$TASK_ID" "\$TASK_RESULT"
  log_agent "$agent_name" "태스크 완료: \$TASK_ID → \$TASK_RESULT"

  # 6. lead에게 완료 알림
  msg_send "\$INBOX_DIR" "$agent_name" "lead" \
    "태스크 완료: \$TASK_ID [\$TASK_SUBJECT] — \$TASK_RESULT" "task_done"

done

log_agent "$agent_name" "종료"
RUNNER_EOF

  chmod +x "$runner"

  # 백그라운드 실행
  bash "$runner" >> "$log_file" 2>&1 &
  local pid=$!
  echo "$pid" > "$pid_file"

  # config에 에이전트 등록
  local config="$team_dir/config.json"
  jq --arg name "$agent_name" \
     --arg role "$role" \
     --argjson pid "$pid" \
     '.agents += [{name: $name, role: $role, pid: $pid, status: "running"}]' \
     "$config" > "${config}.tmp" && mv "${config}.tmp" "$config"

  log_agent "$agent_name" "스폰 완료 (PID: $pid)"
  echo "$pid"
}

# ═══════════════════════════════════════
#  team_status: 팀 현황 출력
# ═══════════════════════════════════════
team_status() {
  local team_name="$1"
  local team_dir="$TEAMS_ROOT/$team_name"
  local queue="$team_dir/tasks/queue.json"

  echo -e "\n${_W}팀: $team_name${_N}"
  echo -e "${_DIM}─────────────────────────────────────${_N}"

  # 태스크 통계
  local stats
  stats=$(tq_stats "$queue")
  local total pending in_progress completed failed
  total=$(echo "$stats" | jq '.total')
  pending=$(echo "$stats" | jq '.pending')
  in_progress=$(echo "$stats" | jq '.in_progress')
  completed=$(echo "$stats" | jq '.completed')
  failed=$(echo "$stats" | jq '.failed')

  # 진행 바
  local progress=0
  [ "$total" -gt 0 ] && progress=$(( completed * 30 / total ))
  local bar="" i
  for ((i=0; i<30; i++)); do
    [ $i -lt $progress ] && bar+="█" || bar+="░"
  done

  echo -e "  [${_G}${bar}${_N}] ${_G}$completed${_N}/$total 완료"
  echo -e "  대기 ${_Y}$pending${_N}  진행중 ${_C}$in_progress${_N}  실패 ${_R}$failed${_N}"
  echo ""

  # 태스크 목록
  jq -r '.tasks[] | "  [\(.id)] \(.subject) — \(.status) \(if .owner then "(\(.owner))" else "" end)"' \
    "$queue" | while read -r line; do
    case "$line" in
      *completed*) echo -e "${_G}$line${_N}" ;;
      *in_progress*) echo -e "${_C}$line${_N}" ;;
      *failed*) echo -e "${_R}$line${_N}" ;;
      *) echo -e "${_DIM}$line${_N}" ;;
    esac
  done

  echo ""

  # 에이전트 목록
  echo -e "  ${_DIM}에이전트:${_N}"
  jq -r '.agents[] | "  • \(.name) [\(.role)] PID:\(.pid)"' \
    "$team_dir/config.json" 2>/dev/null | while read -r line; do
    echo -e "${_M}$line${_N}"
  done

  echo -e "${_DIM}─────────────────────────────────────${_N}"
}

# ═══════════════════════════════════════
#  team_wait: 모든 태스크 완료까지 대기 + 진행 표시
# ═══════════════════════════════════════
team_wait() {
  local team_name="$1"
  local timeout="${2:-3600}"   # 기본 1시간 타임아웃
  local queue="$TEAMS_ROOT/$team_name/tasks/queue.json"
  local spinner=('⠋' '⠙' '⠹' '⠸' '⠼' '⠴' '⠦' '⠧' '⠇' '⠏')
  local i=0 elapsed=0

  echo ""
  while true; do
    local stats total completed failed
    stats=$(tq_stats "$queue")
    total=$(echo "$stats" | jq '.total')
    completed=$(echo "$stats" | jq '.completed')
    failed=$(echo "$stats" | jq '.failed')

    local progress=0
    [ "$total" -gt 0 ] && progress=$(( completed * 20 / total ))
    local bar="" j
    for ((j=0; j<20; j++)); do
      [ $j -lt $progress ] && bar+="█" || bar+="░"
    done

    printf "\r  %s [${_G}%s${_N}] ${_G}%d${_N}/${_W}%d${_N}  실패:${_R}%d${_N}  %ds " \
      "${spinner[$i]}" "$bar" "$completed" "$total" "$failed" "$elapsed"

    # 완료 확인
    if tq_all_done "$queue"; then
      echo -e "\n\n${_G}✓ 모든 태스크 완료${_N}"
      return 0
    fi

    # 타임아웃
    if [ "$elapsed" -ge "$timeout" ]; then
      echo -e "\n\n${_R}✗ 타임아웃 ($timeout 초)${_N}"
      return 1
    fi

    i=$(( (i+1) % 10 ))
    elapsed=$((elapsed + 1))
    sleep 1
  done
}

# ═══════════════════════════════════════
#  team_monitor_tmux: tmux split pane 시각화
# ═══════════════════════════════════════
team_monitor_tmux() {
  local team_name="$1"
  local team_dir="$TEAMS_ROOT/$team_name"
  local session="ad-$team_name"

  if ! command -v tmux &>/dev/null; then
    log_warn "tmux 없음. 로그 확인: $team_dir/logs/"
    return 0
  fi

  # 세션 생성
  tmux new-session -d -s "$session" -x 240 -y 60 2>/dev/null || true

  # 첫 번째 창: 전체 진행 상황
  tmux send-keys -t "$session" \
    "watch -n 1 'cat $team_dir/tasks/queue.json | jq -r .tasks[]'" Enter

  # 각 에이전트 로그 pane
  local pane=1
  for log_file in "$team_dir/logs/"*.log; do
    local agent_name
    agent_name=$(basename "$log_file" .log)
    tmux split-window -t "$session" \
      "tail -f $log_file | awk '{print \"[$agent_name] \" \$0}'" 2>/dev/null || true
    pane=$((pane + 1))
  done

  tmux select-layout -t "$session" tiled 2>/dev/null || true
  log_info "tmux 모니터: ${_C}tmux attach -t $session${_N}"
}

# ═══════════════════════════════════════
#  team_cleanup: 팀 종료 + 리소스 정리
# ═══════════════════════════════════════
team_cleanup() {
  local team_name="$1"
  local team_dir="$TEAMS_ROOT/$team_name"
  local session="ad-$team_name"

  log_info "팀 종료: $team_name"

  # 에이전트 종료 신호
  local config="$team_dir/config.json"
  if [ -f "$config" ]; then
    jq -r '.agents[].name' "$config" 2>/dev/null | while read -r agent; do
      msg_send "$team_dir/inbox" "system" "$agent" "종료" "shutdown"
    done
  fi

  sleep 2  # 정상 종료 대기

  # PID 강제 종료
  for pid_file in "$team_dir/agents/"*.pid; do
    [ -f "$pid_file" ] || continue
    local pid
    pid=$(cat "$pid_file")
    # 자식 프로세스 포함 종료
    pkill -P "$pid" 2>/dev/null || true
    kill "$pid" 2>/dev/null || true
    rm -f "$pid_file"
  done

  # tmux 세션 종료
  tmux kill-session -t "$session" 2>/dev/null || true

  # config 상태 업데이트
  if [ -f "$config" ]; then
    jq '.status = "terminated" | .terminated_at = now | todate' \
      "$config" > "${config}.tmp" && mv "${config}.tmp" "$config"
  fi

  log_success "팀 정리 완료: $team_name"
}
