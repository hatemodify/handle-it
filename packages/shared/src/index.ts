export type JobType = "code" | "doc";
export type JobEngine = "codex" | "claude_code";
export type JobStatus =
  | "queued"
  | "assigned"
  | "running"
  | "succeeded"
  | "failed"
  | "canceled";

export type AgentInboundMessage =
  | { type: "AUTH"; key: string }
  | { type: "HEARTBEAT" }
  | { type: "JOB_ACK"; jobId: string }
  | { type: "JOB_STATUS"; jobId: string; status: JobStatus; error?: string }
  | { type: "JOB_LOG"; jobId: string; line: string }
  | { type: "JOB_RESULT"; jobId: string; result: Record<string, unknown> };

export type AgentOutboundMessage =
  | { type: "AUTH_OK"; agentId: string }
  | { type: "AUTH_FAIL"; reason: string }
  | {
      type: "JOB_ASSIGN";
      job: {
        id: string;
        type: JobType;
        engine: JobEngine;
        workspacePath: string | null;
        prompt: string;
        inputs: Record<string, unknown>;
      };
    }
  | { type: "JOB_CANCEL"; jobId: string };

export type DashboardOutboundMessage = {
  type: "JOB_EVENT";
  event: {
    id: number;
    jobId: string;
    type: "status" | "log" | "result";
    payload: Record<string, unknown>;
    createdAt: string;
  };
};
