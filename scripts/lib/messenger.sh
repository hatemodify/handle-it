#!/bin/bash
# ═══════════════════════════════════════
#  messenger.sh — 에이전트 간 inbox 통신
# ═══════════════════════════════════════
source "$(dirname "$0")/logger.sh" 2>/dev/null || true

# ───────────────────────────────────────
#  msg_send: 메시지 전송
#  $1: inbox_dir  $2: from  $3: to  $4: content  $5: type(선택)
# ───────────────────────────────────────
msg_send() {
  local inbox_dir="$1"
  local from="$2"
  local to="$3"
  local content="$4"
  local msg_type="${5:-info}"

  mkdir -p "$inbox_dir"
  local msg_file="$inbox_dir/${to}_$(date +%s%N).json"

  cat > "$msg_file" <<EOF
{
  "from": "$from",
  "to": "$to",
  "type": "$msg_type",
  "content": $(echo "$content" | jq -Rs .),
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "read": false
}
EOF
  log_msg "$from" "$to" "$content" 2>/dev/null || true
}

# ───────────────────────────────────────
#  msg_read: 내 메시지 읽기 (읽은 후 삭제)
#  $1: inbox_dir  $2: agent_name
#  반환: 메시지 배열 JSON
# ───────────────────────────────────────
msg_read() {
  local inbox_dir="$1"
  local agent_name="$2"
  local messages="[]"

  for msg_file in "$inbox_dir/${agent_name}_"*.json 2>/dev/null; do
    [ -f "$msg_file" ] || continue
    local msg
    msg=$(cat "$msg_file")
    messages=$(echo "$messages" | jq --argjson m "$msg" '. += [$m]')
    rm -f "$msg_file"
  done

  echo "$messages"
}

# ───────────────────────────────────────
#  msg_peek: 읽지 않고 확인만 (삭제 안함)
# ───────────────────────────────────────
msg_peek() {
  local inbox_dir="$1"
  local agent_name="$2"
  local count=0

  for msg_file in "$inbox_dir/${agent_name}_"*.json 2>/dev/null; do
    [ -f "$msg_file" ] && count=$((count + 1))
  done
  echo "$count"
}

# ───────────────────────────────────────
#  msg_broadcast: 전체 에이전트에게 전송
#  $1: inbox_dir  $2: from  $3: content  $4: agent_names (공백 구분)
# ───────────────────────────────────────
msg_broadcast() {
  local inbox_dir="$1"
  local from="$2"
  local content="$3"
  shift 3
  for agent in "$@"; do
    msg_send "$inbox_dir" "$from" "$agent" "$content" "broadcast"
  done
}
