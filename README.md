# AI Remote Orchestrator MVP

PRD: `AI_Remote_Orchestrator_PRD.md` 기준 구현.

## 구성
- `apps/dashboard`: Next.js Dashboard (운영 화면 + 챗 화면 + REST API)
- `apps/broker`: Node WebSocket Broker (별도 프로세스)
- `apps/agent`: Local Mac Agent reference
- `packages/shared`: 공통 타입
- `infra/migrations`: PostgreSQL 스키마/전이 트리거
- `infra/nginx`: 최소 프록시 설정

## 화면 분리
- 운영 대시보드: `/jobs`
  - 잡 상태/이벤트 확인
- 챗 화면: `/chat`
  - 요청 입력 -> AI 초안 응답 확인 -> 승인 후 job 생성

## 빠른 시작
1. 환경변수 복사
```bash
cp .env.example .env
```

2. 로컬 개발 권장 설정
- `LOCAL_DEV_AUTH_BYPASS=true` (OAuth 우회)
- `LOCAL_DEV_USER_EMAIL=local-dev@example.com`
- 시크릿 값 채우기 (`SESSION_SECRET`, `AGENT_KEY_PEPPER`, `DASHBOARD_STREAM_TOKEN_SECRET`, `BROKER_INTERNAL_SECRET`)

3. 컨테이너 실행
```bash
docker compose -f infra/docker-compose.yml up -d --build
```

4. 마이그레이션 반영 (기존 DB 재사용 시)
```bash
docker compose -f infra/docker-compose.yml exec -T postgres psql -U postgres -d orchestrator < infra/migrations/002_workspace_path.sql
docker compose -f infra/docker-compose.yml exec -T postgres psql -U postgres -d orchestrator < infra/migrations/003_chat.sql
```

## 잡 입력 스키마
`POST /api/jobs`
- `type: "code" | "doc"`
- `engine: "codex" | "claude_code"`
- `workspacePath: string | null` (code job 필수, doc job은 null)
- `prompt: string`
- `inputs?: object`

## 챗 승인 스키마
- `POST /api/chat/message`
  - 입력: `message`, `type`, `engine`, `workspacePath`, `inputs`
  - 출력: user/assistant 메시지 + assistant의 `proposed_job`
- `POST /api/chat/:id/approve`
  - 입력: `messageId`
  - 동작: `proposed_job` 검증 후 `jobs`에 `queued` 생성

## WebSocket
- Agent: `/ws/agent`
- Dashboard stream: `/ws/dashboard?token=...`

## 상태 전이
- `queued -> assigned`
- `assigned -> running | queued(timeout) | canceled`
- `running -> succeeded | failed | canceled`

DB trigger로 강제.

## 보안
- 에이전트 키는 DB에 `agent_key_hash`만 저장
- 세션은 랜덤 토큰 + 해시 저장
- 내부 취소 API는 `x-broker-internal-secret` 검증
- 운영 시 HTTPS/WSS는 Nginx TLS 종단으로 강제
