export const env = {
  brokerWsUrl: process.env.BROKER_WS_URL ?? "ws://localhost:8081/ws/agent",
  agentKey: process.env.AGENT_KEY ?? "",
  codexCmd: process.env.CODEX_CMD ?? "codex",
  claudeCmd: process.env.CLAUDE_CMD ?? "claude",
  worktreeBase: process.env.WORKTREE_BASE ?? "/tmp/orchestrator-worktrees",
  artifactDir: process.env.ARTIFACT_DIR ?? "/tmp/orchestrator-artifacts",
  heartbeatIntervalMs: Number(process.env.HEARTBEAT_INTERVAL_MS ?? 10000)
};

if (!env.agentKey) {
  throw new Error("AGENT_KEY is required");
}
