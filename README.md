# handle-it

> 아이디어 한 줄 → PRD → 코드 → 테스트 → PR — **사람 개입 없이 자동 완주**

[![npm version](https://badge.fury.io/js/handle-it.svg)](https://www.npmjs.com/package/handle-it)

## 설치

```bash
# 글로벌 설치
npm install -g handle-it

# 또는 설치 없이 바로 실행
npx handle-it "AI 일기 앱, 감정 분석, 다크모드"
```

## 사용법

```bash
# 기본 실행
handle-it "AI 일기 앱, 감정 분석, 다크모드 지원"

# 출력 경로 지정
handle-it "가계부 앱" ~/projects/my-budget

# 프로젝트 설정 생성
handle-it init

# 진행 상황 확인
handle-it status

# 실시간 모니터링 (터미널 TUI)
handle-it watch

# 웹 대시보드
handle-it dashboard

# 중단된 세션 복구
handle-it resume
```

## 프로젝트별 설정

```bash
handle-it init   # handle-it.config.json 생성
```

```json
{
  "version": "1.0",
  "agents": ["planner", "architect", "designer", "dev1", "dev2", "qa", "git"],
  "timeout": 7200,
  "health_interval": 5,
  "task_timeout": 300,
  "claude_bin": "claude",
  "project_dir": null,
  "prompts_dir": "./my-prompts"
}
```

| 옵션 | 설명 | 기본값 |
|------|------|--------|
| `agents` | 활성화할 에이전트 목록 | 7개 전체 |
| `timeout` | 전체 파이프라인 타임아웃 (초) | 7200 |
| `health_interval` | 리드 에이전트 헬스체크 간격 (초) | 5 |
| `task_timeout` | 개별 태스크 타임아웃 (초) | 300 |
| `project_dir` | 출력 경로 | CLI 인수 또는 `~/projects/` |
| `prompts_dir` | 커스텀 프롬프트 경로 | 패키지 기본값 |

## 아키텍처

자체 구현 멀티에이전트 시스템 (Claude Code CLI 기반):

```
아이디어 입력
    ↓
[planner]  [architect]  ← Phase 1 병렬
    ↓
[designer] [태스크분해]  ← Phase 2 (PRD 완료 후)
    ↓
[dev1] [dev2]           ← Phase 3 병렬
    ↓
[qa] → 자동 수정        ← Phase 4
    ↓
[git] → PR 생성         ← Phase 5

    ⤴ 리드 에이전트가 전체 모니터링
      (헬스체크, 리스폰, 태스크 타임아웃)
```

### 에이전트별 역할

| 에이전트 | 역할 | 도구 |
|---------|------|------|
| planner | PRD 작성 | WebSearch, WebFetch |
| architect | 기술스택 + 태스크 분해 | Glob, Grep |
| designer | UI/UX 디자인 스펙 | Glob, Grep |
| dev1/dev2 | 코드 생성 (병렬) | Glob, Grep, WebSearch |
| qa | 테스트 + 자동 수정 | Glob, Grep |
| git | 커밋 + PR | Glob, Grep |

### 핵심 설계

- **flock-free 동시성**: macOS 호환 mkdir 기반 스핀락
- **의존성 기반 자율 실행**: 각 에이전트가 독립적으로 태스크 클레임
- **Ralph loop**: 태스크마다 새 `claude --print` 인스턴스 (컨텍스트 오염 방지)
- **리드 에이전트**: 헬스체크, 자동 리스폰 (최대 3회), 타임아웃 태스크 리셋
- **작업 보고서**: `reports/task_XXX_agent.json` — 구조화된 결과 추적
- **세션 복구**: `handle-it resume`로 중단된 파이프라인 재개

## 모니터링

### 터미널 TUI
```bash
handle-it watch           # 최신 팀 모니터링
handle-it watch ad_xxx    # 특정 팀 지정
```

### 웹 대시보드
```bash
handle-it dashboard              # http://localhost:3847
handle-it dashboard ad_xxx 8080  # 팀 + 포트 지정
```

## 요구사항

- Node.js 18+
- Claude Code CLI (`claude`)
- `jq` (`brew install jq`)
- macOS / Linux

## 라이선스

MIT
