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
    "$(sed "s|{{IDEA}}|$IDEA|g; s|{{PROJECT_DIR}}|$PROJECT_DIR|g" \
      "$AUTODEV_PROMPTS/planner.md")")

  T_STACK=$(tq_add "$queue" \
    "기술스택 결정" \
    "$(sed "s|{{PROJECT_DIR}}|$PROJECT_DIR|g" \
      "$AUTODEV_PROMPTS/architect.md")")

  # ── Phase 2: PRD 완료 후 ──
  T_DESIGN=$(tq_add "$queue" \
    "디자인 스펙 생성" \
    "PRD($PROJECT_DIR/prd.md)를 읽고 UI 컴포넌트 목록, 색상 팔레트, 타이포그래피를 design_spec.json으로 저장. 다크 프리미엄 톤 기본값." \
    "$T_PRD")

  T_TASKS=$(tq_add "$queue" \
    "개발 태스크 분해" \
    "$(sed "s|{{PROJECT_DIR}}|$PROJECT_DIR|g" \
      "$AUTODEV_PROMPTS/architect.md") — 태스크 분해 단계만 실행" \
    "$T_PRD,$T_STACK")

  # ── Phase 3: 태스크 분해 완료 후 ──
  T_SETUP=$(tq_add "$queue" \
    "프로젝트 초기 세팅" \
    "$(sed "s|{{PROJECT_DIR}}|$PROJECT_DIR|g; s|{{TASK_DESCRIPTION}}|stack.json의 기술스택으로 프로젝트 초기화. package.json, tsconfig, eslint, tailwind 설정|g" \
      "$AUTODEV_PROMPTS/developer.md")" \
    "$T_TASKS")

  T_AUTH=$(tq_add "$queue" \
    "인증 시스템 구현" \
    "$(sed "s|{{PROJECT_DIR}}|$PROJECT_DIR|g; s|{{TASK_DESCRIPTION}}|stack.json의 auth 스택으로 로그인/회원가입 구현. 소셜 로그인 포함|g" \
      "$AUTODEV_PROMPTS/developer.md")" \
    "$T_SETUP")

  T_CORE=$(tq_add "$queue" \
    "핵심 기능 구현" \
    "$(sed "s|{{PROJECT_DIR}}|$PROJECT_DIR|g; s|{{TASK_DESCRIPTION}}|prd.md의 P0 기능 구현. 각 기능은 독립 컴포넌트로 분리|g" \
      "$AUTODEV_PROMPTS/developer.md")" \
    "$T_AUTH")

  T_UI=$(tq_add "$queue" \
    "UI 컴포넌트 구현" \
    "$(sed "s|{{PROJECT_DIR}}|$PROJECT_DIR|g; s|{{TASK_DESCRIPTION}}|design_spec.json 기반 공통 UI 컴포넌트 구현. Button, Card, Input, Modal, Navigation|g" \
      "$AUTODEV_PROMPTS/developer.md")" \
    "$T_DESIGN,$T_SETUP")

  # ── Phase 4: 코드 완성 후 ──
  T_QA=$(tq_add "$queue" \
    "QA 및 자동 수정" \
    "$(sed "s|{{PROJECT_DIR}}|$PROJECT_DIR|g" \
      "$AUTODEV_PROMPTS/qa.md")" \
    "$T_CORE,$T_UI")

  T_GIT=$(tq_add "$queue" \
    "Git 커밋 및 PR 생성" \
    "$(sed "s|{{PROJECT_DIR}}|$PROJECT_DIR|g" \
      "$AUTODEV_PROMPTS/git.md")" \
    "$T_QA")

  log_success "태스크 등록 완료 (총 9개)"

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
  agent_spawn "$team" "planner"   "PRD 작성 및 제품 기획 전문가"
  agent_spawn "$team" "architect" "기술스택 결정 및 시스템 아키텍처 전문가"

  sleep 1

  # designer: Phase 2 대기 후 처리
  agent_spawn "$team" "designer"  "UI/UX 디자인 스펙 전문가"

  # developer: Phase 3~4 핵심 에이전트 (2개 병렬)
  agent_spawn "$team" "dev1"      "풀스택 개발자 — 핵심 기능 담당"
  agent_spawn "$team" "dev2"      "풀스택 개발자 — UI 컴포넌트 담당"

  # qa + git: 마지막 단계
  agent_spawn "$team" "qa"        "QA 엔지니어 — 테스트 및 품질 보증"
  agent_spawn "$team" "git"       "Git 관리자 — 커밋 및 PR 생성"

  log_success "에이전트 7개 스폰 완료"
}

# ════════════════════════════════════════
#  STEP 4: 완료 대기
# ════════════════════════════════════════
step_wait() {
  local team="$1"

  log_step "STEP 4/5  실행 중..."

  # tmux 시각화 (tmux 있는 경우)
  if command -v tmux &>/dev/null && [ -n "${TMUX:-}" ]; then
    team_monitor_tmux "$team"
    echo -e "  실시간 확인: ${_C}tmux attach -t ad-$team${_N}"
  fi

  # 완료 대기 (최대 2시간)
  team_wait "$team" 7200
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
    echo -e "  ${_G}+${_N} ${f#$PROJECT_DIR/}"
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
