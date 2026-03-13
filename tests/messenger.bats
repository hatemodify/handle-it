#!/usr/bin/env bats
# ═══════════════════════════════════════
#  messenger.sh unit tests (bats)
# ═══════════════════════════════════════

setup() {
  export AUTODEV_LOG_FILE="/dev/null"
  source "$BATS_TEST_DIRNAME/../scripts/lib/logger.sh"
  source "$BATS_TEST_DIRNAME/../scripts/lib/messenger.sh"

  TEST_DIR=$(mktemp -d)
  INBOX="$TEST_DIR/inbox"
}

teardown() {
  rm -rf "$TEST_DIR"
}

@test "msg_send creates message file" {
  msg_send "$INBOX" "planner" "architect" "PRD done"
  count=$(ls "$INBOX"/architect_*.json 2>/dev/null | wc -l | tr -d ' ')
  [ "$count" -eq 1 ]
}

@test "msg_send writes correct fields" {
  msg_send "$INBOX" "planner" "architect" "PRD done" "task_done"
  msg_file=$(ls "$INBOX"/architect_*.json | head -1)
  from=$(jq -r '.from' "$msg_file")
  to=$(jq -r '.to' "$msg_file")
  type=$(jq -r '.type' "$msg_file")
  [ "$from" = "planner" ]
  [ "$to" = "architect" ]
  [ "$type" = "task_done" ]
}

@test "msg_read returns messages and deletes files" {
  msg_send "$INBOX" "planner" "dev1" "start"
  msg_send "$INBOX" "architect" "dev1" "stack ready"

  messages=$(msg_read "$INBOX" "dev1")
  count=$(echo "$messages" | jq 'length')
  [ "$count" -eq 2 ]

  remaining=$(find "$INBOX" -name "dev1_*.json" 2>/dev/null | wc -l | tr -d ' ')
  [ "$remaining" -eq 0 ]
}

@test "msg_read returns empty array when no messages" {
  mkdir -p "$INBOX"
  messages=$(msg_read "$INBOX" "agent1")
  count=$(echo "$messages" | jq 'length')
  [ "$count" -eq 0 ]
}

@test "msg_peek counts without deleting" {
  msg_send "$INBOX" "a" "b" "msg1"
  msg_send "$INBOX" "a" "b" "msg2"

  count=$(msg_peek "$INBOX" "b")
  [ "$count" -eq 2 ]

  remaining=$(ls "$INBOX"/b_*.json 2>/dev/null | wc -l | tr -d ' ')
  [ "$remaining" -eq 2 ]
}

@test "msg_broadcast sends to all agents" {
  msg_broadcast "$INBOX" "lead" "announcement" "dev1" "dev2" "qa"

  [ "$(find "$INBOX" -name "dev1_*.json" 2>/dev/null | wc -l | tr -d ' ')" -eq 1 ]
  [ "$(ls "$INBOX"/dev2_*.json 2>/dev/null | wc -l | tr -d ' ')" -eq 1 ]
  [ "$(ls "$INBOX"/qa_*.json 2>/dev/null | wc -l | tr -d ' ')" -eq 1 ]
}
