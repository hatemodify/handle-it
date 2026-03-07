import WebSocket from "ws";
import type { AgentInboundMessage, AgentOutboundMessage } from "@orchestrator/shared";
import { env } from "./env.js";
import { executeCodeJob } from "./jobs/code-job.js";
import { executeDocJob } from "./jobs/doc-job.js";

type AssignedJob = Extract<AgentOutboundMessage, { type: "JOB_ASSIGN" }>["job"];

let ws: WebSocket | null = null;
let heartbeatTimer: NodeJS.Timeout | null = null;
let currentJobId: string | null = null;

const send = (payload: AgentInboundMessage) => {
  ws?.send(JSON.stringify(payload));
};

const startHeartbeat = () => {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
  }
  heartbeatTimer = setInterval(() => {
    send({ type: "HEARTBEAT" });
  }, env.heartbeatIntervalMs);
};

const handleJob = async (job: AssignedJob) => {
  currentJobId = job.id;
  send({ type: "JOB_ACK", jobId: job.id });
  send({ type: "JOB_STATUS", jobId: job.id, status: "running" });

  const onLine = (line: string) => {
    send({ type: "JOB_LOG", jobId: job.id, line });
  };

  try {
    if (job.type === "code") {
      if (!job.workspacePath) {
        throw new Error("code job requires workspacePath");
      }

      const result = await executeCodeJob(
        {
          id: job.id,
          engine: job.engine,
          workspacePath: job.workspacePath,
          prompt: job.prompt,
          inputs: job.inputs,
          codexCmd: env.codexCmd,
          claudeCmd: env.claudeCmd,
          worktreeBase: env.worktreeBase
        },
        onLine
      );

      send({ type: "JOB_RESULT", jobId: job.id, result });
      send({ type: "JOB_STATUS", jobId: job.id, status: "succeeded" });
      currentJobId = null;
      return;
    }

    const doc = await executeDocJob(
      {
        id: job.id,
        engine: job.engine,
        prompt: job.prompt,
        codexCmd: env.codexCmd,
        claudeCmd: env.claudeCmd,
        artifactDir: env.artifactDir
      },
      onLine
    );

    send({ type: "JOB_RESULT", jobId: job.id, result: doc });
    send({ type: "JOB_STATUS", jobId: job.id, status: "succeeded" });
    currentJobId = null;
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown_error";
    send({ type: "JOB_STATUS", jobId: job.id, status: "failed", error: message });
    currentJobId = null;
  }
};

const connect = () => {
  ws = new WebSocket(env.brokerWsUrl);

  ws.on("open", () => {
    send({ type: "AUTH", key: env.agentKey });
  });

  ws.on("message", async (raw) => {
    const parsed = JSON.parse(raw.toString()) as AgentOutboundMessage;

    if (parsed.type === "AUTH_OK") {
      startHeartbeat();
      return;
    }

    if (parsed.type === "AUTH_FAIL") {
      console.error("authentication failed", parsed.reason);
      ws?.close();
      return;
    }

    if (parsed.type === "JOB_ASSIGN") {
      if (currentJobId) {
        send({ type: "JOB_LOG", jobId: parsed.job.id, line: "agent busy; assignment ignored" });
        return;
      }
      void handleJob(parsed.job);
      return;
    }

    if (parsed.type === "JOB_CANCEL") {
      if (currentJobId === parsed.jobId) {
        send({ type: "JOB_STATUS", jobId: parsed.jobId, status: "canceled" });
        currentJobId = null;
      }
    }
  });

  ws.on("close", () => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    setTimeout(connect, 3000);
  });

  ws.on("error", (error) => {
    console.error("ws error", error);
  });
};

connect();
