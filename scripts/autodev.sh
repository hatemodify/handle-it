#!/bin/bash
# ═══════════════════════════════════════════════════════════════
#  autodev.sh — 자체 구현 Teams 기반 완전 자율 개발 파이프라인
#
#  사용법:
#    autodev.sh "아이디어" [프로젝트_경로]
#
#  예시:
#    autodev.sh "AI 기반 일기 앱, 감정 분석, 다크모드 지원"
#    autodev.sh "가계부 앱" ~/projects/my-budget
# ═══════════════════════════════════════════════════════════════
set -euo pipefail

# ── 경로 설정 ──
AUTODEV_ROOT="$(cd "$(dirname "$0")" && pwd)"
export AUTODEV_ROOT

AUTODEV_PROMPTS="${AUTODEV_PROMPTS:-$(cd "$AUTODEV_ROOT/.." && pwd)/prompts}"
export AUTODEV_PROMPTS

TEAMS_ROOT="${HANDLE_IT_TEAMS_ROOT:-${AUTODEV_TEAMS_ROOT:-$HOME/.handle-it/teams}}"
export TEAMS_ROOT

# ── 라이브러리 로드 ──
source "$AUTODEV_ROOT/lib/logger.sh"
source "$AUTODEV_ROOT/lib/task_queue.sh"
source "$AUTODEV_ROOT/lib/messenger.sh"
source "$AUTODEV_ROOT/lib/team_manager.sh"

# ── 인수 파싱 ──
IDEA="${1:?'사용법: autodev.sh <아이디어> [프로젝트_경로]'}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
PROJECT_DIR="${2:-$HOME/projects/autodev_$TIMESTAMP}"
TEAM_NAME="ad_$TIMESTAMP"
CLAUDE_BIN="${CLAUDE_BIN:-claude}"

# ── 입력 검증 ──
# 경로 검증: path traversal 방지
if [[ "$PROJECT_DIR" == *".."* ]]; then
  log_error "경로에 '..'를 사용할 수 없습니다: $PROJECT_DIR"
  exit 1
fi

# 절대 경로로 정규화
if [[ "$PROJECT_DIR" != /* ]]; then
  PROJECT_DIR="$(pwd)/$PROJECT_DIR"
fi

# 시스템 경로 보호
case "$PROJECT_DIR" in
  /etc/*|/usr/*|/bin/*|/sbin/*|/var/*|/System/*|/Library/*)
    log_error "시스템 경로에 프로젝트를 생성할 수 없습니다: $PROJECT_DIR"
    exit 1
    ;;
esac

# sed 치환용 이스케이프 (|, &, \, / 안전 처리)
_sed_escape() {
  printf '%s' "$1" | sed 's/[|\\/&]/\\&/g'
}
IDEA_ESCAPED=$(_sed_escape "$IDEA")
PROJECT_DIR_ESCAPED=$(_sed_escape "$PROJECT_DIR")

export AUTODEV_LOG_FILE="$HOME/.handle-it/logs/autodev_$TIMESTAMP.log"
mkdir -p "$(dirname "$AUTODEV_LOG_FILE")"

# ════════════════════════════════════════
#  배너
# ════════════════════════════════════════
print_banner() {
  echo -e "${_W}"
  echo "  ╔══════════════════════════════════════════╗"
  echo "  ║        handle-it  ·  Teams Edition       ║"
  echo "  ╚══════════════════════════════════════════╝${_N}"
  echo ""
  echo -e "  아이디어  ${_Y}$IDEA${_N}"
  echo -e "  프로젝트  ${_B}$PROJECT_DIR${_N}"
  echo -e "  팀        ${_G}$TEAM_NAME${_N}"
  echo -e "  로그      ${_DIM}$AUTODEV_LOG_FILE${_N}"
  echo ""
}

# ════════════════════════════════════════
#  STEP 1: 프로젝트 + 팀 초기화
# ════════════════════════════════════════
step_init() {
  log_step "STEP 1/5  초기화"

  # 프로젝트 디렉토리 생성
  mkdir -p "$PROJECT_DIR"

  # CLAUDE.md — 모든 에이전트가 공유하는 컨텍스트
  mkdir -p "$HOME/.handle-it"
  cat > "$HOME/.handle-it/CLAUDE.md" <<EOF
# AutoDev 프로젝트 컨텍스트

## 아이디어
$IDEA

## 프로젝트 경로
$PROJECT_DIR

## 팀 이름
$TEAM_NAME

## 생성 시각
$TIMESTAMP

## 공통 코딩 규칙
- TypeScript strict 모드 필수
- 함수형 컴포넌트 (클래스 컴포넌트 금지)
- async/await (Promise chain 금지)
- 에러 처리 필수
- 환경변수 .env.example 동기화
- 컴포넌트: PascalCase
- 훅: use 접두사
- 파일명: kebab-case
EOF

  # 팀 생성
  TEAM_DIR=$(team_create "$TEAM_NAME")
  echo "$PROJECT_DIR" > "$TEAMS_ROOT/$TEAM_NAME/project_dir"

  log_success "초기화 완료"
  echo "$TEAM_DIR"
}

# ════════════════════════════════════════
#  STEP 2: 태스크 큐 구성
# ════════════════════════════════════════
step_register_tasks() {
  local team="$1"
  local queue="$TEAMS_ROOT/$team/tasks/queue.json"

  log_step "STEP 2/5  태스크 등록"

  # ── Phase 1: 병렬 가능 (의존성 없음) ──
  T_PRD=$(tq_add "$queue" \
    "PRD 작성" \
    "$(sed "s|{{IDEA}}|$IDEA_ESCAPED|g; s|{{PROJECT_DIR}}|$PROJECT_DIR_ESCAPED|g" \
      "$AUTODEV_PROMPTS/planner.md")")

  T_STACK=$(tq_add "$queue" \
    "기술스택 결정" \
    "$(sed "s|{{PROJECT_DIR}}|$PROJECT_DIR_ESCAPED|g" \
      "$AUTODEV_PROMPTS/architect.md")")

  # ── Phase 2: PRD 완료 후 ──
  T_DESIGN=$(tq_add "$queue" \
    "디자인 스펙 생성" \
    "PRD($PROJECT_DIR/prd.md)를 읽고 UI 컴포넌트 목록, 색상 팔레트, 타이포그래피를 design_spec.json으로 저장. 다크 프리미엄 톤 기본값." \
    "$T_PRD")

  T_TASKS=$(tq_add "$queue" \
    "개발 태스크 분해" \
    "$(sed "s|{{PROJECT_DIR}}|$PROJECT_DIR_ESCAPED|g" \
      "$AUTODEV_PROMPTS/architect.md") — 태스크 분해 단계만 실행" \
    "$T_PRD,$T_STACK")

  # ── Phase 3: 태스크 분해 완료 후 ──
  T_SETUP=$(tq_add "$queue" \
    "프로젝트 초기 세팅" \
    "$(sed "s|{{PROJECT_DIR}}|$PROJECT_DIR_ESCAPED|g; s|{{TASK_DESCRIPTION}}|stack.json의 기술스택으로 프로젝트 초기화. package.json, tsconfig, eslint, tailwind 설정|g" \
      "$AUTODEV_PROMPTS/developer.md")" \
    "$T_TASKS")

  T_AUTH=$(tq_add "$queue" \
    "인증 시스템 구현" \
    "$(sed "s|{{PROJECT_DIR}}|$PROJECT_DIR_ESCAPED|g; s|{{TASK_DESCRIPTION}}|stack.json의 auth 스택으로 로그인/회원가입 구현. 소셜 로그인 포함|g" \
      "$AUTODEV_PROMPTS/developer.md")" \
    "$T_SETUP")

  T_CORE=$(tq_add "$queue" \
    "핵심 기능 구현" \
    "$(sed "s|{{PROJECT_DIR}}|$PROJECT_DIR_ESCAPED|g; s|{{TASK_DESCRIPTION}}|prd.md의 P0 기능 구현. 각 기능은 독립 컴포넌트로 분리|g" \
      "$AUTODEV_PROMPTS/developer.md")" \
    "$T_AUTH")

  T_UI=$(tq_add "$queue" \
    "UI 컴포넌트 구현" \
    "$(sed "s|{{PROJECT_DIR}}|$PROJECT_DIR_ESCAPED|g; s|{{TASK_DESCRIPTION}}|design_spec.json 기반 공통 UI 컴포넌트 구현. Button, Card, Input, Modal, Navigation|g" \
      "$AUTODEV_PROMPTS/developer.md")" \
    "$T_DESIGN,$T_SETUP")

  # ── Phase 4: 코드 완성 후 ──
  T_QA=$(tq_add "$queue" \
    "QA 및 자동 수정" \
    "$(sed "s|{{PROJECT_DIR}}|$PROJECT_DIR_ESCAPED|g" \
      "$AUTODEV_PROMPTS/qa.md")" \
    "$T_CORE,$T_UI")

  tq_add "$queue" \
    "Git 커밋 및 PR 생성" \
    "$(sed "s|{{PROJECT_DIR}}|$PROJECT_DIR_ESCAPED|g" \
      "$AUTODEV_PROMPTS/git.md")" \
    "$T_QA" > /dev/null

  log_success "태스크 등록 완료 (총 9개)"

  # DAG 의존성 순환 검증
  if ! tq_validate_dag "$queue"; then
    log_error "태스크 의존성 오류 — 파이프라인을 중단합니다"
    exit 1
  fi

  # 태스크 목록 출력
  echo ""
  jq -r '.tasks[] | "  [\(.id)] \(.subject) (의존: \(.depends_on | join(", ") | if . == "" then "없음" else . end))"' \
    "$queue" | while read -r line; do
    echo -e "${_DIM}$line${_N}"
  done
  echo ""
}

# ════════════════════════════════════════
#  STEP 3: 에이전트 스폰
# ════════════════════════════════════════
step_spawn_agents() {
  local team="$1"

  log_step "STEP 3/5  에이전트 스폰"

  # planner + architect: Phase 1 병렬 처리
  agent_spawn "$team" "planner"   "PRD 작성 및 제품 기획 전문가" \
    "Read,Write,Edit,Bash,WebSearch,WebFetch,Skill"
  agent_spawn "$team" "architect" "기술스택 결정 및 시스템 아키텍처 전문가" \
    "Read,Write,Edit,Bash,Glob,Grep,Skill"

  sleep 1

  # designer: Phase 2 대기 후 처리
  agent_spawn "$team" "designer"  "UI/UX 디자인 스펙 전문가" \
    "Read,Write,Edit,Bash,Glob,Grep,Skill"

  # developer: Phase 3~4 핵심 에이전트 (2개 병렬)
  agent_spawn "$team" "dev1"      "풀스택 개발자 — 핵심 기능 담당" \
    "Read,Write,Edit,Bash,Glob,Grep,WebSearch,WebFetch,Skill"
  agent_spawn "$team" "dev2"      "풀스택 개발자 — UI 컴포넌트 담당" \
    "Read,Write,Edit,Bash,Glob,Grep,WebSearch,WebFetch,Skill"

  # qa + git: 마지막 단계
  agent_spawn "$team" "qa"        "QA 엔지니어 — 테스트 및 품질 보증" \
    "Read,Write,Edit,Bash,Glob,Grep,Skill"
  agent_spawn "$team" "git"       "Git 관리자 — 커밋 및 PR 생성" \
    "Read,Write,Edit,Bash,Glob,Grep"

  log_success "에이전트 7개 스폰 완료"
}

# ════════════════════════════════════════
#  STEP 4: 완료 대기
# ════════════════════════════════════════
step_wait() {
  local team="$1"

  log_step "STEP 4/5  리드 에이전트 실행 중..."

  # tmux 시각화 (tmux 있는 경우)
  if command -v tmux &>/dev/null && [ -n "${TMUX:-}" ]; then
    team_monitor_tmux "$team"
    echo -e "  실시간 확인: ${_C}tmux attach -t ad-$team${_N}"
  fi

  # 리드 오케스트레이터 루프 (헬스체크 + 진행률 + 타임아웃 감지)
  local timeout="${AUTODEV_TIMEOUT:-7200}"
  local health_interval="${AUTODEV_HEALTH_INTERVAL:-5}"
  local task_timeout="${AUTODEV_TASK_TIMEOUT:-300}"
  lead_loop "$team" "$timeout" "$health_interval" "$task_timeout"
}

# ════════════════════════════════════════
#  STEP 5: 결과 요약
# ════════════════════════════════════════
step_summary() {
  local team="$1"

  log_step "STEP 5/5  결과 요약"

  team_status "$team"

  echo -e "\n${_W}생성된 파일:${_N}"
  find "$PROJECT_DIR" -type f \
    ! -path "*/node_modules/*" \
    ! -path "*/.next/*" \
    ! -path "*/.git/*" \
    | sort | while read -r f; do
    echo -e "  ${_G}+${_N} ${f#"$PROJECT_DIR"/}"
  done

  # QA 리포트
  if [ -f "$PROJECT_DIR/qa_report.md" ]; then
    echo -e "\n${_W}QA 리포트:${_N}"
    tail -5 "$PROJECT_DIR/qa_report.md" | while read -r line; do
      echo -e "  ${_DIM}$line${_N}"
    done
  fi

  # PR 정보
  if [ -f "$PROJECT_DIR/pr_description.md" ]; then
    echo -e "\n${_W}PR Description:${_N} $PROJECT_DIR/pr_description.md"
  fi

  echo -e "\n${_G}🎉 AutoDev 완료!${_N}"
  echo -e "   프로젝트: ${_B}$PROJECT_DIR${_N}"
  echo -e "   로그:     ${_DIM}$AUTODEV_LOG_FILE${_N}"
}

# ════════════════════════════════════════
#  RESUME 모드
# ════════════════════════════════════════
if [ "${1:-}" = "__resume__" ]; then
  TEAM_NAME="${HANDLE_IT_RESUME_TEAM:?'HANDLE_IT_RESUME_TEAM 필요'}"
  TEAM_DIR="$TEAMS_ROOT/$TEAM_NAME"
  PROJECT_DIR="$(cat "$TEAM_DIR/project_dir" 2>/dev/null || echo '/tmp/autodev_project')"

  AUTODEV_LOG_FILE="$HOME/.handle-it/logs/resume_$(date +%Y%m%d_%H%M%S).log"
  export AUTODEV_LOG_FILE
  mkdir -p "$(dirname "$AUTODEV_LOG_FILE")"

  source "$AUTODEV_ROOT/lib/logger.sh"
  source "$AUTODEV_ROOT/lib/task_queue.sh"
  source "$AUTODEV_ROOT/lib/messenger.sh"
  source "$AUTODEV_ROOT/lib/team_manager.sh"

  QUEUE="$TEAM_DIR/tasks/queue.json"

  log_step "RESUME  팀 복구: $TEAM_NAME"

  # 1. in_progress 태스크를 pending으로 리셋
  STALE=$(jq -r '.tasks[] | select(.status == "in_progress") | .id' "$QUEUE")
  for task_id in $STALE; do
    tq_reset "$QUEUE" "$task_id" "세션 복구로 리셋"
    log_info "리셋: $task_id"
  done

  # 2. config.json 상태 복원
  jq '.status = "active" | (.agents[] | .status) = "stopped"' \
    "$TEAM_DIR/config.json" > "$TEAM_DIR/config.json.tmp" \
    && mv "$TEAM_DIR/config.json.tmp" "$TEAM_DIR/config.json"

  # 3. 에이전트 재스폰
  log_step "RESUME  에이전트 재스폰"
  jq -r '.agents[] | "\(.name)|\(.role)|\(.allowed_tools // "Read,Write,Edit,Bash")"' \
    "$TEAM_DIR/config.json" | while IFS='|' read -r name role tools; do
    agent_respawn "$TEAM_NAME" "$name" 2>/dev/null || \
      agent_spawn "$TEAM_NAME" "$name" "$role" "$tools"
  done

  # 4. 리드 루프 재진입
  log_step "RESUME  리드 에이전트 재시작"
  timeout="${AUTODEV_TIMEOUT:-7200}"
  health_interval="${AUTODEV_HEALTH_INTERVAL:-5}"
  task_timeout="${AUTODEV_TASK_TIMEOUT:-300}"
  lead_loop "$TEAM_NAME" "$timeout" "$health_interval" "$task_timeout"

  # 5. 결과 요약
  step_summary "$TEAM_NAME"
  team_cleanup "$TEAM_NAME"
  exit 0
fi

# ════════════════════════════════════════
#  RERUN 모드 — 특정 태스크만 재실행
# ════════════════════════════════════════
if [ "${1:-}" = "__rerun__" ]; then
  TEAM_NAME="${HANDLE_IT_RERUN_TEAM:?'HANDLE_IT_RERUN_TEAM 필요'}"
  RERUN_TASK_ID="${HANDLE_IT_RERUN_TASK:?'HANDLE_IT_RERUN_TASK 필요'}"
  TEAM_DIR="$TEAMS_ROOT/$TEAM_NAME"
  PROJECT_DIR="$(cat "$TEAM_DIR/project_dir" 2>/dev/null || echo '/tmp/autodev_project')"
  QUEUE="$TEAM_DIR/tasks/queue.json"

  AUTODEV_LOG_FILE="$HOME/.handle-it/logs/rerun_$(date +%Y%m%d_%H%M%S).log"
  export AUTODEV_LOG_FILE
  mkdir -p "$(dirname "$AUTODEV_LOG_FILE")"

  # 태스크 존재 확인
  TASK_EXISTS=$(jq -r --arg id "$RERUN_TASK_ID" '.tasks[] | select(.id == $id) | .id' "$QUEUE")
  if [ -z "$TASK_EXISTS" ]; then
    log_error_hint "태스크를 찾을 수 없음: $RERUN_TASK_ID" \
      "handle-it status $TEAM_NAME 으로 태스크 ID를 확인하세요"
    exit 1
  fi

  log_step "RERUN  태스크 재실행: $RERUN_TASK_ID (팀: $TEAM_NAME)"

  # 1. 태스크 리셋
  tq_reset "$QUEUE" "$RERUN_TASK_ID" "수동 재실행"
  log_info "태스크 리셋: $RERUN_TASK_ID"

  # 2. 태스크 데이터 읽기
  TASK_DATA=$(tq_get "$QUEUE" "$RERUN_TASK_ID")
  TASK_SUBJECT=$(echo "$TASK_DATA" | jq -r '.subject')
  TASK_DESC=$(echo "$TASK_DATA" | jq -r '.description')

  # 3. 직접 클레임
  _lock "${QUEUE}.lock"
  jq --arg id "$RERUN_TASK_ID" \
     --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
     '(.tasks[] | select(.id == $id)) |=
       (.owner = "rerun" | .status = "in_progress" | .started_at = $ts)' \
     "$QUEUE" > "${QUEUE}.tmp" && _safe_jq_write "$QUEUE"
  _unlock "${QUEUE}.lock"
  log_info "태스크 클레임: $RERUN_TASK_ID [$TASK_SUBJECT]"

  # 4. Claude 실행 (타임아웃 적용)
  CLAUDE_PROMPT="당신은 AutoDev 팀의 전문 에이전트입니다.

## 프로젝트 컨텍스트
$(cat "$HOME/.handle-it/CLAUDE.md" 2>/dev/null || echo '컨텍스트 없음')

## 현재 태스크 (재실행)
- ID: $RERUN_TASK_ID
- 제목: $TASK_SUBJECT
- 설명: $TASK_DESC

## 실행 규칙
1. 태스크를 완전히 완료할 것
2. 결과물은 반드시 $PROJECT_DIR 에 저장
3. 완료 후 마지막 줄에 반드시 출력: TASK_RESULT: [완료 요약]"

  RERUN_TIMEOUT="${AUTODEV_TASK_TIMEOUT:-300}"
  RESULT_FILE=$(mktemp)
  log_info "Claude 실행 중 (타임아웃: ${RERUN_TIMEOUT}초)..."

  (
    unset CLAUDECODE 2>/dev/null || true
    "$CLAUDE_BIN" --print \
      --allowedTools "Read,Write,Edit,Bash,Glob,Grep,Skill" \
      --dangerously-skip-permissions \
      -p "$CLAUDE_PROMPT" > "$RESULT_FILE" 2>&1
  ) &
  CLAUDE_PID=$!

  ELAPSED_T=0
  TIMED_OUT=false
  while kill -0 $CLAUDE_PID 2>/dev/null; do
    if [ "$ELAPSED_T" -ge "$RERUN_TIMEOUT" ]; then
      kill $CLAUDE_PID 2>/dev/null || true
      wait $CLAUDE_PID 2>/dev/null || true
      TIMED_OUT=true
      break
    fi
    sleep 2
    ELAPSED_T=$((ELAPSED_T + 2))
  done

  if $TIMED_OUT; then
    RESULT="태스크 타임아웃 (${RERUN_TIMEOUT}초 초과)"
  else
    EXIT_CODE=0
    wait $CLAUDE_PID 2>/dev/null || EXIT_CODE=$?
    if [ $EXIT_CODE -ne 0 ]; then
      RESULT=$(cat "$RESULT_FILE" 2>/dev/null)
      [ -z "$RESULT" ] && RESULT="실행 실패 (exit: $EXIT_CODE)"
    else
      RESULT=$(cat "$RESULT_FILE")
    fi
  fi
  rm -f "$RESULT_FILE"

  # 5. 결과 처리
  TASK_RESULT=$(echo "$RESULT" | { grep '^TASK_RESULT:' || true; } | sed 's/TASK_RESULT: //' | tail -1)

  if $TIMED_OUT; then
    tq_fail "$QUEUE" "$RERUN_TASK_ID" "$RESULT"
    log_error_hint "RERUN  태스크 타임아웃: $RERUN_TASK_ID" \
      "AUTODEV_TASK_TIMEOUT 값을 늘려서 재시도하세요"
  elif [ -z "$TASK_RESULT" ]; then
    tq_fail "$QUEUE" "$RERUN_TASK_ID" "TASK_RESULT 미출력"
    log_error_hint "RERUN  태스크 실패 (결과 미출력): $RERUN_TASK_ID" \
      "handle-it logs $TEAM_NAME 으로 상세 로그를 확인하세요"
  else
    tq_complete "$QUEUE" "$RERUN_TASK_ID" "$TASK_RESULT"
    log_success "RERUN  태스크 완료: $RERUN_TASK_ID → $TASK_RESULT"
  fi

  exit 0
fi

# ════════════════════════════════════════
#  MAIN
# ════════════════════════════════════════
main() {
  print_banner

  # 의존성 확인
  for dep in jq claude; do
    command -v "$dep" &>/dev/null || {
      log_error "필수 의존성 없음: $dep"
      echo "  설치: brew install $dep"
      exit 1
    }
  done

  # 파이프라인 실행
  TEAM_DIR=$(step_init)
  step_register_tasks "$TEAM_NAME"
  step_spawn_agents "$TEAM_NAME"
  step_wait "$TEAM_NAME"
  step_summary "$TEAM_NAME"
  team_cleanup "$TEAM_NAME"
}

# 종료 시 자동 정리
trap 'log_warn "중단됨. 팀 정리 중..."; team_cleanup "$TEAM_NAME" 2>/dev/null || true' EXIT INT TERM

main
