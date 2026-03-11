# Handle It — Claude Code 컨텍스트

## 프로젝트 한 줄 요약
아이디어 한 줄 입력 → PRD → 코드 → 테스트 → PR **자동 완성** 파이프라인.
Claude Code CLI 기반 자체 구현 멀티에이전트 시스템.

---

## 아키텍처 개요

```
handle-it/
├── bin/autodev.js          ← npx handle-it 진입점 (Node → bash 브릿지)
├── package.json            ← npm 패키지 ("handle-it")
├── scripts/
│   ├── autodev.sh          ← 메인 파이프라인 오케스트레이터 (5단계)
│   ├── install.sh          ← curl 원라이너 설치용
│   └── lib/
│       ├── logger.sh       ← 색상 로깅 유틸
│       ├── task_queue.sh   ← flock 기반 태스크 큐 (핵심 동시성 제어)
│       ├── messenger.sh    ← 에이전트 간 inbox 메시지
│       └── team_manager.sh ← 에이전트 생명주기 관리
└── prompts/
    ├── planner.md          ← PRD 작성 에이전트 지시문
    ├── architect.md        ← 기술스택 + 태스크 분해 에이전트 지시문
    ├── developer.md        ← 코드 생성 에이전트 지시문 (Ralph loop)
    ├── qa.md               ← 테스트 + 자동수정 에이전트 지시문
    └── git.md              ← 커밋 + PR 생성 에이전트 지시문
```

---

## 실행 흐름 (5단계)

```
npx handle-it "AI 일기 앱, 감정 분석, 다크모드"
        ↓
STEP 1: 초기화 — 프로젝트 디렉토리 + CLAUDE.md(공유 컨텍스트) + 팀 디렉토리
        ↓
STEP 2: 태스크 등록 — 9개 태스크를 의존성과 함께 큐에 등록
        ↓
STEP 3: 에이전트 스폰 — 7개 백그라운드 프로세스 실행
        │
        ├── planner   — PRD 작성           │
        ├── architect — 기술스택 결정      │ Phase 1 병렬
        │
        ├── designer  — 디자인 스펙        │
        │                                  │ Phase 2 병렬 (Phase 1 완료 후)
        │
        ├── dev1      — 핵심 기능 구현     │
        ├── dev2      — UI 컴포넌트 구현   │ Phase 3 병렬
        │
        ├── qa        — 테스트 + 자동수정  │ Phase 4 (Phase 3 완료 후)
        └── git       — 커밋 + PR 생성     │ Phase 5 (QA 완료 후)
        ↓
STEP 4: 완료 대기 — 스피너 + 진행 바 + tmux 시각화(선택)
        ↓
STEP 5: 결과 요약 — 생성 파일 목록 + QA 리포트 + PR 링크
```

---

## 핵심 설계 원칙

### 1. Agent Teams 자체 구현 (실험적 플래그 불필요)
Claude Code의 공식 Agent Teams(`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`)와
**동일한 구조**를 bash로 직접 구현. 안정적으로 지금 당장 사용 가능.

| Agent Teams 공식 | Handle It 구현 |
|---|---|
| TeammateTool inbox | `~/.handle-it/teams/{name}/inbox/` JSON 파일 |
| 태스크 자율 클레임 | `tq_claim()` — flock 파일 잠금 |
| Teammate 스폰 | `agent_spawn()` — 백그라운드 `claude --print` |
| tmux split pane | `team_monitor_tmux()` |
| peer-to-peer 메시지 | `msg_send()` / `msg_read()` |

### 2. flock 기반 Race Condition 방지
7개 에이전트가 동시에 같은 태스크 클레임 시도할 때:
```bash
(
  flock -x 9        # 배타적 파일 잠금
  # pending + 의존성 완료된 태스크 원자적 클레임
) 9>"$lockfile"
```

### 3. 의존성 기반 자율 실행
각 에이전트는 루프를 돌며 "내가 지금 실행 가능한 태스크"를 스스로 클레임.
의존 태스크 미완료 시 2초 대기 후 재시도. 오케스트레이터가 스케줄링 불필요.

### 4. Ralph loop 패턴 (컨텍스트 오염 방지)
태스크마다 새로운 `claude --print` 인스턴스 생성.
이전 태스크 컨텍스트가 다음 태스크에 영향 안 줌.

---

## 런타임 디렉토리 구조

```
~/.handle-it/
├── CLAUDE.md                    ← 모든 에이전트 공유 컨텍스트
└── teams/
    └── ad_{timestamp}/
        ├── config.json          ← 팀 메타데이터 + 에이전트 목록
        ├── project_dir          ← 프로젝트 출력 경로
        ├── inbox/               ← 에이전트 간 메시지 (JSON 파일)
        ├── tasks/
        │   ├── queue.json       ← 태스크 큐 (상태: pending/in_progress/completed/failed)
        │   └── queue.json.lock  ← flock 잠금 파일
        ├── agents/
        │   ├── planner.sh       ← 생성된 러너 스크립트
        │   ├── planner.pid      ← PID 파일
        │   └── ...
        └── logs/
            ├── planner.log
            └── ...
```

---

## npm 패키지 구성

```json
{
  "name": "handle-it",
  "bin": {
    "handle-it": "./bin/autodev.js",
    "autodev": "./bin/autodev.js"
  }
}
```

### CLI 명령어
```bash
handle-it "아이디어"              # 메인 실행
handle-it "아이디어" ~/my-project # 출력 경로 지정
handle-it init                    # 프로젝트 루트에 handle-it.config.json 생성
handle-it status                  # 진행 중인 팀 상태 확인
handle-it --version
```

### 프로젝트별 설정 (handle-it.config.json)
```json
{
  "version": "1.0",
  "agents": ["planner", "architect", "designer", "dev1", "dev2", "qa", "git"],
  "timeout": 7200,
  "claude_bin": "claude",
  "project_dir": null,
  "prompts_dir": null
}
```
`prompts_dir` 지정 시 해당 폴더의 프롬프트가 기본값 덮어씀.

---

## GitHub Actions 자동 배포

`.github/workflows/publish.yml` — `git tag v1.x.x` push 시 npm 자동 배포.

```bash
# 배포 방법
git tag v1.0.0
git push --tags
# → GitHub Actions가 npm publish 자동 실행
```

---

## 현재 상태 및 TODO

### 완료
- [x] 전체 파이프라인 설계 (6단계)
- [x] lib/ 라이브러리 4종 (logger, task_queue, messenger, team_manager)
- [x] 에이전트 프롬프트 5종 (planner, architect, developer, qa, git)
- [x] npm 패키지 구성 (bin/autodev.js, package.json)
- [x] GitHub Actions 배포 워크플로우
- [x] GitHub 레포 연결 (hatemodify/handle-it)

### 다음 할 일
- [x] package.json name을 "handle-it"으로 변경
- [x] bin/autodev.js 명령어를 handle-it으로 업데이트
- [x] handle-it.config.json 지원 추가 (autodev.config.json 하위 호환 유지)
- [x] 런타임 경로 ~/.autodev → ~/.handle-it 마이그레이션
- [x] designer.md 프롬프트 생성
- [x] 실제 실행 테스트 (`claude --print` 동작 확인)
- [x] macOS 호환 (flock → mkdir 락, bash 3.2 호환, CLAUDECODE 환경변수 해제)
- [x] **리드/오케스트레이터 에이전트** — 에이전트 헬스체크, 실패 태스크 재할당, 타임아웃 감지, 리스폰
- [x] **에이전트 작업 보고서** — `reports/task_XXX_agent.json` (생성/수정 파일, 결정사항, 블로커, handoff). 리드가 읽고 충돌 감지·결정 불일치·태스크 재조정
- [x] **에이전트별 도구/스킬 세팅** — 역할별 `--allowedTools` 분리 + 스킬 연동 (planner: WebSearch/prd-check, dev: Glob,Grep/frontend-patterns, qa: qa/e2e-test 등)
- [ ] **실시간 모니터링 대시보드** — 두 가지 방식:
  - **터미널 TUI**: `handle-it watch` — 에이전트 상태, 현재 태스크, 진행률 실시간 표시 (blessed/ink 기반)
  - **웹 대시보드**: `handle-it dashboard` — 브라우저에서 확인. 에이전트별 타임라인, 태스크 의존성 그래프, 로그 스트리밍, 생성 파일 목록
- [ ] **`handle-it resume [팀ID]`** — 세션 끊김 복구 (in_progress → pending 리셋, 에이전트 재스폰)
- [ ] npm 배포 (npm login → npm publish)
- [ ] README 업데이트 (handle-it 명칭으로)

---

## 개발 환경 요구사항

- macOS (bash 3.2+, flock 불필요)
- Claude Code CLI (`claude`)
- Node.js 18+
- jq (`brew install jq`)
- tmux (선택, 시각화용)
- gh CLI (선택, PR 생성용)

---

## 레포
https://github.com/hatemodify/handle-it