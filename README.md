# autodev-teams

> 아이디어 한 줄 → PRD → 코드 → 테스트 → PR — **사람 개입 없이 자동 완주**

[![npm version](https://badge.fury.io/js/autodev-teams.svg)](https://www.npmjs.com/package/autodev-teams)

## 설치

```bash
# 글로벌 설치
npm install -g autodev-teams

# 또는 설치 없이 바로 실행
npx autodev-teams "AI 일기 앱, 감정 분석, 다크모드"

# curl 원라이너
curl -fsSL https://raw.githubusercontent.com/your-id/autodev-teams/main/install.sh | bash
```

## 사용법

```bash
# 기본 실행
autodev "AI 일기 앱, 감정 분석, 다크모드 지원"

# 출력 경로 지정
autodev "가계부 앱" ~/projects/my-budget

# 프로젝트 설정 생성 (커스터마이징)
autodev init
autodev "내 앱 아이디어"

# 진행 상황 확인
autodev status
```

## 프로젝트별 설정 (autodev.config.json)

```bash
autodev init   # 현재 폴더에 autodev.config.json 생성
```

```json
{
  "version": "1.0",
  "agents": ["planner", "architect", "designer", "dev1", "dev2", "qa", "git"],
  "timeout": 7200,
  "claude_bin": "claude",
  "project_dir": null,
  "prompts_dir": "./my-prompts"
}
```

## 커스텀 프롬프트

`prompts_dir`을 지정하면 해당 폴더의 프롬프트가 기본값을 덮어씁니다.

```
my-project/
├── autodev.config.json
└── my-prompts/
    ├── planner.md    ← 덮어쓰기
    └── developer.md  ← 덮어쓰기
```

## 요구사항

- Node.js 18+
- Claude Code CLI (`claude`)
- `jq` (`brew install jq`)
- macOS / Linux

## 아키텍처

자체 구현 멀티에이전트 팀 (Claude Code Agent Teams 동일 구조):

```
아이디어 입력
    ↓
[planner]  [architect]  ← 병렬
    ↓
[designer] [태스크분해]  ← 병렬
    ↓
[dev1] [dev2]           ← 병렬
    ↓
[qa] → 자동 수정 (최대 3회)
    ↓
[git] → PR 생성
```

에이전트 간 통신은 `~/.autodev/teams/{팀ID}/inbox/` 기반 양방향 메시지.
