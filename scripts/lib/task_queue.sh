#!/bin/bash
# ═══════════════════════════════════════
#  task_queue.sh — 태스크 큐 (flock 동시성 제어)
# ═══════════════════════════════════════
source "$(dirname "$0")/logger.sh" 2>/dev/null || true

# ───────────────────────────────────────
#  tq_init: 태스크 큐 초기화
#  $1: queue_file 경로
# ───────────────────────────────────────
tq_init() {
  local queue_file="$1"
  mkdir -p "$(dirname "$queue_file")"
  echo '{"tasks":[]}' > "$queue_file"
}

# ───────────────────────────────────────
#  tq_add: 태스크 추가
#  $1: queue_file  $2: subject  $3: description
#  $4: depends_on (쉼표 구분, 선택)
#  반환: task_id (stdout)
# ───────────────────────────────────────
tq_add() {
  local queue_file="$1"
  local subject="$2"
  local description="$3"
  local depends_on="${4:-}"
  local lockfile="${queue_file}.lock"

  (
    flock -x 9
    local count
    count=$(jq '.tasks | length' "$queue_file")
    local task_id
    task_id="task_$(printf '%03d' $((count + 1)))"

    # depends_on을 JSON 배열로 변환
    local deps_json="[]"
    if [ -n "$depends_on" ]; then
      deps_json=$(echo "$depends_on" | tr ',' '\n' | \
        jq -R . | jq -s .)
    fi

    jq --arg id "$task_id" \
       --arg subject "$subject" \
       --arg desc "$description" \
       --argjson deps "$deps_json" \
       --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
       '.tasks += [{
         id: $id,
         subject: $subject,
         description: $desc,
         depends_on: $deps,
         status: "pending",
         owner: null,
         created_at: $ts,
         started_at: null,
         completed_at: null,
         result: null
       }]' "$queue_file" > "${queue_file}.tmp" \
    && mv "${queue_file}.tmp" "$queue_file"

    echo "$task_id"
  ) 9>"$lockfile"
}

# ───────────────────────────────────────
#  tq_claim: 에이전트가 태스크 클레임
#  $1: queue_file  $2: agent_name
#  반환: task_id or "none" (stdout)
# ───────────────────────────────────────
tq_claim() {
  local queue_file="$1"
  local agent_name="$2"
  local lockfile="${queue_file}.lock"

  (
    flock -x 9

    # 완료된 태스크 ID 목록
    local completed_ids
    completed_ids=$(jq -r '[.tasks[] | select(.status=="completed") | .id]' "$queue_file")

    # pending + 의존성 모두 완료된 첫 태스크 선택
    local task_id
    task_id=$(jq -r \
      --argjson completed "$completed_ids" \
      '.tasks[]
       | select(.status == "pending" and .owner == null)
       | select(
           (.depends_on | length) == 0 or
           (.depends_on | all(. as $dep | $completed | index($dep) != null))
         )
       | .id' \
      "$queue_file" 2>/dev/null | head -1)

    if [ -z "$task_id" ]; then
      echo "none"
    else
      jq --arg id "$task_id" \
         --arg agent "$agent_name" \
         --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
         '(.tasks[] | select(.id == $id)) |=
           (.owner = $agent | .status = "in_progress" | .started_at = $ts)' \
         "$queue_file" > "${queue_file}.tmp" \
      && mv "${queue_file}.tmp" "$queue_file"
      echo "$task_id"
    fi
  ) 9>"$lockfile"
}

# ───────────────────────────────────────
#  tq_complete: 태스크 완료 마킹
#  $1: queue_file  $2: task_id  $3: result (선택)
# ───────────────────────────────────────
tq_complete() {
  local queue_file="$1"
  local task_id="$2"
  local result="${3:-완료}"
  local lockfile="${queue_file}.lock"

  (
    flock -x 9
    jq --arg id "$task_id" \
       --arg result "$result" \
       --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
       '(.tasks[] | select(.id == $id)) |=
         (.status = "completed" | .completed_at = $ts | .result = $result)' \
       "$queue_file" > "${queue_file}.tmp" \
    && mv "${queue_file}.tmp" "$queue_file"
  ) 9>"$lockfile"
}

# ───────────────────────────────────────
#  tq_fail: 태스크 실패 마킹
# ───────────────────────────────────────
tq_fail() {
  local queue_file="$1"
  local task_id="$2"
  local reason="${3:-실패}"
  local lockfile="${queue_file}.lock"

  (
    flock -x 9
    jq --arg id "$task_id" \
       --arg reason "$reason" \
       --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
       '(.tasks[] | select(.id == $id)) |=
         (.status = "failed" | .completed_at = $ts | .result = $reason)' \
       "$queue_file" > "${queue_file}.tmp" \
    && mv "${queue_file}.tmp" "$queue_file"
  ) 9>"$lockfile"
}

# ───────────────────────────────────────
#  tq_get: 태스크 데이터 조회
# ───────────────────────────────────────
tq_get() {
  local queue_file="$1"
  local task_id="$2"
  jq -r --arg id "$task_id" '.tasks[] | select(.id == $id)' "$queue_file"
}

# ───────────────────────────────────────
#  tq_stats: 큐 통계
# ───────────────────────────────────────
tq_stats() {
  local queue_file="$1"
  jq '{
    total:       (.tasks | length),
    pending:     [.tasks[] | select(.status=="pending")]     | length,
    in_progress: [.tasks[] | select(.status=="in_progress")] | length,
    completed:   [.tasks[] | select(.status=="completed")]   | length,
    failed:      [.tasks[] | select(.status=="failed")]      | length
  }' "$queue_file"
}

# ───────────────────────────────────────
#  tq_all_done: 모든 태스크 완료 여부
#  반환: 0=완료, 1=미완료
# ───────────────────────────────────────
tq_all_done() {
  local queue_file="$1"
  local remaining
  remaining=$(jq '[.tasks[] | select(.status != "completed" and .status != "failed")] | length' "$queue_file")
  [ "$remaining" -eq 0 ]
}
