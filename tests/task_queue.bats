#!/usr/bin/env bats
# ═══════════════════════════════════════
#  task_queue.sh unit tests (bats)
#
#  Run: bats tests/task_queue.bats
# ═══════════════════════════════════════

setup() {
  export AUTODEV_LOG_FILE="/dev/null"
  source "$BATS_TEST_DIRNAME/../scripts/lib/logger.sh"
  source "$BATS_TEST_DIRNAME/../scripts/lib/task_queue.sh"

  TEST_DIR=$(mktemp -d)
  QUEUE="$TEST_DIR/queue.json"
}

teardown() {
  rm -rf "$TEST_DIR"
}

# ── tq_init ──

@test "tq_init creates empty queue file" {
  tq_init "$QUEUE"
  [ -f "$QUEUE" ]
  result=$(jq '.tasks | length' "$QUEUE")
  [ "$result" -eq 0 ]
}

# ── tq_add ──

@test "tq_add first task ID is task_001" {
  tq_init "$QUEUE"
  id=$(tq_add "$QUEUE" "Test Task" "Description")
  [ "$id" = "task_001" ]
}

@test "tq_add increments task ID" {
  tq_init "$QUEUE"
  tq_add "$QUEUE" "Task 1" "Desc 1"
  id=$(tq_add "$QUEUE" "Task 2" "Desc 2")
  [ "$id" = "task_002" ]
}

@test "tq_add sets dependency" {
  tq_init "$QUEUE"
  t1=$(tq_add "$QUEUE" "Task 1" "Desc 1")
  t2=$(tq_add "$QUEUE" "Task 2" "Desc 2" "$t1")
  deps=$(jq -r --arg id "$t2" '.tasks[] | select(.id == $id) | .depends_on[0]' "$QUEUE")
  [ "$deps" = "$t1" ]
}

@test "tq_add multiple dependencies" {
  tq_init "$QUEUE"
  t1=$(tq_add "$QUEUE" "Task 1" "Desc 1")
  t2=$(tq_add "$QUEUE" "Task 2" "Desc 2")
  t3=$(tq_add "$QUEUE" "Task 3" "Desc 3" "$t1,$t2")
  dep_count=$(jq -r --arg id "$t3" '.tasks[] | select(.id == $id) | .depends_on | length' "$QUEUE")
  [ "$dep_count" -eq 2 ]
}

@test "tq_add task status is pending" {
  tq_init "$QUEUE"
  tq_add "$QUEUE" "Task" "Desc"
  status=$(jq -r '.tasks[0].status' "$QUEUE")
  [ "$status" = "pending" ]
}

# ── tq_claim ──

@test "tq_claim returns pending task" {
  tq_init "$QUEUE"
  tq_add "$QUEUE" "Task 1" "Desc"
  id=$(tq_claim "$QUEUE" "agent1")
  [ "$id" = "task_001" ]
}

@test "tq_claim sets status to in_progress" {
  tq_init "$QUEUE"
  tq_add "$QUEUE" "Task 1" "Desc"
  tq_claim "$QUEUE" "agent1"
  status=$(jq -r '.tasks[0].status' "$QUEUE")
  [ "$status" = "in_progress" ]
}

@test "tq_claim sets owner" {
  tq_init "$QUEUE"
  tq_add "$QUEUE" "Task 1" "Desc"
  tq_claim "$QUEUE" "agent1"
  owner=$(jq -r '.tasks[0].owner' "$QUEUE")
  [ "$owner" = "agent1" ]
}

@test "tq_claim returns none on empty queue" {
  tq_init "$QUEUE"
  id=$(tq_claim "$QUEUE" "agent1")
  [ "$id" = "none" ]
}

@test "tq_claim skips already claimed task" {
  tq_init "$QUEUE"
  tq_add "$QUEUE" "Task 1" "Desc"
  tq_claim "$QUEUE" "agent1"
  id=$(tq_claim "$QUEUE" "agent2")
  [ "$id" = "none" ]
}

@test "tq_claim skips task with unmet dependencies" {
  tq_init "$QUEUE"
  t1=$(tq_add "$QUEUE" "Task 1" "Desc 1")
  tq_add "$QUEUE" "Task 2" "Desc 2" "$t1"

  tq_claim "$QUEUE" "agent1"
  id=$(tq_claim "$QUEUE" "agent2")
  [ "$id" = "none" ]
}

@test "tq_claim allows task after dependency completed" {
  tq_init "$QUEUE"
  t1=$(tq_add "$QUEUE" "Task 1" "Desc 1")
  tq_add "$QUEUE" "Task 2" "Desc 2" "$t1"

  tq_claim "$QUEUE" "agent1"
  tq_complete "$QUEUE" "$t1" "done"

  id=$(tq_claim "$QUEUE" "agent2")
  [ "$id" = "task_002" ]
}

# ── tq_complete ──

@test "tq_complete sets status to completed" {
  tq_init "$QUEUE"
  tq_add "$QUEUE" "Task 1" "Desc"
  tq_claim "$QUEUE" "agent1"
  tq_complete "$QUEUE" "task_001" "success"
  status=$(jq -r '.tasks[0].status' "$QUEUE")
  [ "$status" = "completed" ]
}

@test "tq_complete saves result" {
  tq_init "$QUEUE"
  tq_add "$QUEUE" "Task 1" "Desc"
  tq_claim "$QUEUE" "agent1"
  tq_complete "$QUEUE" "task_001" "PRD created"
  result=$(jq -r '.tasks[0].result' "$QUEUE")
  [ "$result" = "PRD created" ]
}

# ── tq_fail ──

@test "tq_fail sets status to failed" {
  tq_init "$QUEUE"
  tq_add "$QUEUE" "Task 1" "Desc"
  tq_claim "$QUEUE" "agent1"
  tq_fail "$QUEUE" "task_001" "timeout"
  status=$(jq -r '.tasks[0].status' "$QUEUE")
  [ "$status" = "failed" ]
}

# ── tq_reset ──

@test "tq_reset resets in_progress to pending" {
  tq_init "$QUEUE"
  tq_add "$QUEUE" "Task 1" "Desc"
  tq_claim "$QUEUE" "agent1"
  tq_reset "$QUEUE" "task_001" "reset reason"

  status=$(jq -r '.tasks[0].status' "$QUEUE")
  owner=$(jq -r '.tasks[0].owner' "$QUEUE")
  [ "$status" = "pending" ]
  [ "$owner" = "null" ]
}

# ── tq_all_done ──

@test "tq_all_done returns true when all completed" {
  tq_init "$QUEUE"
  tq_add "$QUEUE" "Task 1" "Desc"
  tq_claim "$QUEUE" "agent1"
  tq_complete "$QUEUE" "task_001"
  tq_all_done "$QUEUE"
}

@test "tq_all_done returns false when pending exists" {
  tq_init "$QUEUE"
  tq_add "$QUEUE" "Task 1" "Desc"
  ! tq_all_done "$QUEUE"
}

@test "tq_all_done treats failed as done" {
  tq_init "$QUEUE"
  tq_add "$QUEUE" "Task 1" "Desc"
  tq_claim "$QUEUE" "agent1"
  tq_fail "$QUEUE" "task_001" "error"
  tq_all_done "$QUEUE"
}

# ── tq_stats ──

@test "tq_stats returns correct counts" {
  tq_init "$QUEUE"
  tq_add "$QUEUE" "Task 1" "Desc 1"
  tq_add "$QUEUE" "Task 2" "Desc 2"
  tq_add "$QUEUE" "Task 3" "Desc 3"
  tq_claim "$QUEUE" "agent1"
  tq_complete "$QUEUE" "task_001"

  stats=$(tq_stats "$QUEUE")
  [ "$(echo "$stats" | jq '.total')" -eq 3 ]
  [ "$(echo "$stats" | jq '.completed')" -eq 1 ]
  [ "$(echo "$stats" | jq '.pending')" -eq 2 ]
}

# ── _safe_jq_write ──

@test "_safe_jq_write rejects empty file" {
  tq_init "$QUEUE"
  echo -n "" > "${QUEUE}.tmp"
  ! _safe_jq_write "$QUEUE"
}

@test "_safe_jq_write rejects invalid JSON" {
  tq_init "$QUEUE"
  echo "not json" > "${QUEUE}.tmp"
  ! _safe_jq_write "$QUEUE"
}

@test "_safe_jq_write rejects JSON without tasks array" {
  tq_init "$QUEUE"
  echo '{"foo": "bar"}' > "${QUEUE}.tmp"
  ! _safe_jq_write "$QUEUE"
}

@test "_safe_jq_write accepts valid queue" {
  tq_init "$QUEUE"
  echo '{"tasks": []}' > "${QUEUE}.tmp"
  _safe_jq_write "$QUEUE"
  [ -f "$QUEUE" ]
}

@test "_safe_jq_write preserves original on failure" {
  tq_init "$QUEUE"
  tq_add "$QUEUE" "Task" "Desc"
  original=$(cat "$QUEUE")

  echo "corrupt" > "${QUEUE}.tmp"
  ! _safe_jq_write "$QUEUE"

  [ "$(cat "$QUEUE")" = "$original" ]
}

# ── tq_validate_dag ──

@test "tq_validate_dag passes on empty queue" {
  tq_init "$QUEUE"
  tq_validate_dag "$QUEUE"
}

@test "tq_validate_dag passes linear dependencies" {
  tq_init "$QUEUE"
  t1=$(tq_add "$QUEUE" "Task 1" "Desc 1")
  t2=$(tq_add "$QUEUE" "Task 2" "Desc 2" "$t1")
  tq_add "$QUEUE" "Task 3" "Desc 3" "$t2"
  tq_validate_dag "$QUEUE"
}

@test "tq_validate_dag passes parallel dependencies" {
  tq_init "$QUEUE"
  t1=$(tq_add "$QUEUE" "Task 1" "Desc 1")
  t2=$(tq_add "$QUEUE" "Task 2" "Desc 2")
  tq_add "$QUEUE" "Task 3" "Desc 3" "$t1,$t2"
  tq_validate_dag "$QUEUE"
}

@test "tq_validate_dag detects direct cycle (A<->B)" {
  tq_init "$QUEUE"
  cat > "$QUEUE" <<'EOF'
{"tasks": [
  {"id": "t1", "subject": "A", "description": "D", "depends_on": ["t2"], "status": "pending", "owner": null, "created_at": "2024-01-01T00:00:00Z", "started_at": null, "completed_at": null, "result": null},
  {"id": "t2", "subject": "B", "description": "D", "depends_on": ["t1"], "status": "pending", "owner": null, "created_at": "2024-01-01T00:00:00Z", "started_at": null, "completed_at": null, "result": null}
]}
EOF
  ! tq_validate_dag "$QUEUE"
}

@test "tq_validate_dag detects indirect cycle (A->B->C->A)" {
  tq_init "$QUEUE"
  cat > "$QUEUE" <<'EOF'
{"tasks": [
  {"id": "t1", "subject": "A", "description": "D", "depends_on": ["t3"], "status": "pending", "owner": null, "created_at": "2024-01-01T00:00:00Z", "started_at": null, "completed_at": null, "result": null},
  {"id": "t2", "subject": "B", "description": "D", "depends_on": ["t1"], "status": "pending", "owner": null, "created_at": "2024-01-01T00:00:00Z", "started_at": null, "completed_at": null, "result": null},
  {"id": "t3", "subject": "C", "description": "D", "depends_on": ["t2"], "status": "pending", "owner": null, "created_at": "2024-01-01T00:00:00Z", "started_at": null, "completed_at": null, "result": null}
]}
EOF
  ! tq_validate_dag "$QUEUE"
}

@test "tq_validate_dag detects nonexistent dependency" {
  tq_init "$QUEUE"
  cat > "$QUEUE" <<'EOF'
{"tasks": [
  {"id": "t1", "subject": "A", "description": "D", "depends_on": ["nonexistent"], "status": "pending", "owner": null, "created_at": "2024-01-01T00:00:00Z", "started_at": null, "completed_at": null, "result": null}
]}
EOF
  ! tq_validate_dag "$QUEUE"
}
