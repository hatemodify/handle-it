import http from "node:http";
import { URL } from "node:url";
import { WebSocketServer } from "ws";
import type WebSocket from "ws";
import { authenticateAgentByKey, verifyDashboardToken } from "./auth.js";
import { pool, addJobEvent, type JobRow } from "./db.js";
import { assignOneQueuedJob, type AgentSocketState } from "./dispatcher.js";
import { addDashboardClient, broadcastJobEvent, removeDashboardClient } from "./dashboard-stream.js";
import { encodeAgentMessage, safeParseAgentMessage } from "./protocol.js";
import { startTimeoutReaper } from "./timeout-reaper.js";

const brokerPort = Number(process.env.BROKER_PORT ?? 8081);
const heartbeatTimeoutSec = Number(process.env.HEARTBEAT_TIMEOUT_SEC ?? 30);
const assignIntervalMs = Number(process.env.ASSIGN_INTERVAL_MS ?? 1000);
const reassignIntervalMs = Number(process.env.REASSIGN_INTERVAL_MS ?? 3000);
const brokerInternalSecret = process.env.BROKER_INTERNAL_SECRET;
if (!brokerInternalSecret) {
  throw new Error("BROKER_INTERNAL_SECRET is required");
}

type ConnectedAgent = AgentSocketState & {
  ws: WebSocket;
  currentJobId: string | null;
};

const agentSockets = new Map<string, ConnectedAgent>();

const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/internal/cancel") {
    const auth = req.headers["x-broker-internal-secret"];
    if (auth !== brokerInternalSecret) {
      res.writeHead(401).end("unauthorized");
      return;
    }
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
    });
    req.on("end", () => {
      try {
        const parsed = JSON.parse(body) as { jobId: string; agentId: string };
        const agent = agentSockets.get(parsed.agentId);
        if (agent && agent.ws.readyState === 1) {
          agent.send(encodeAgentMessage({ type: "JOB_CANCEL", jobId: parsed.jobId }));
        }
        res.writeHead(200).end("ok");
      } catch {
        res.writeHead(400).end("invalid_json");
      }
    });
    return;
  }

  if (req.url === "/healthz") {
    res.writeHead(200).end("ok");
    return;
  }
  res.writeHead(404).end("not found");
});

const agentWss = new WebSocketServer({ noServer: true });
const dashboardWss = new WebSocketServer({ noServer: true });

const persistAndBroadcast = async (
  jobId: string,
  type: "status" | "log" | "result",
  payload: Record<string, unknown>
) => {
  const inserted = await addJobEvent(jobId, type, payload);
  broadcastJobEvent({
    id: inserted.id,
    jobId,
    type,
    payload,
    createdAt: inserted.created_at.toISOString()
  });
};

const updateAgentHeartbeat = async (agentId: string) => {
  await pool.query(
    `UPDATE agents SET status = 'online', last_heartbeat_at = NOW(), updated_at = NOW() WHERE id = $1`,
    [agentId]
  );
};

agentWss.on("connection", (ws) => {
  let agentId: string | null = null;

  ws.on("message", async (raw) => {
    try {
      const message = safeParseAgentMessage(raw.toString());
      if (!message) {
        return;
      }

      if (message.type === "AUTH") {
        const agent = await authenticateAgentByKey(message.key);
        if (!agent) {
          ws.send(encodeAgentMessage({ type: "AUTH_FAIL", reason: "invalid_key" }));
          ws.close();
          return;
        }
        agentId = agent.id;
        agentSockets.set(agent.id, {
          agentId: agent.id,
          currentJobId: null,
          isBusy: false,
          ws,
          send: (data) => ws.send(data)
        });
        await updateAgentHeartbeat(agent.id);
        ws.send(encodeAgentMessage({ type: "AUTH_OK", agentId: agent.id }));
        return;
      }

      if (!agentId) {
        ws.send(encodeAgentMessage({ type: "AUTH_FAIL", reason: "auth_required" }));
        ws.close();
        return;
      }

      if (message.type === "HEARTBEAT") {
        await updateAgentHeartbeat(agentId);
        return;
      }

      if (message.type === "JOB_ACK") {
        await persistAndBroadcast(message.jobId, "status", { status: "assigned", ack: true, agentId });
        return;
      }

      if (message.type === "JOB_STATUS") {
        await pool.query(
          `UPDATE jobs
           SET status = $1, error_message = $2, updated_at = NOW()
           WHERE id = $3 AND assigned_agent_id = $4`,
          [message.status, message.error ?? null, message.jobId, agentId]
        );

        const sock = agentSockets.get(agentId);
        if (sock && (message.status === "succeeded" || message.status === "failed" || message.status === "canceled")) {
          sock.isBusy = false;
          sock.currentJobId = null;
        }

        await persistAndBroadcast(message.jobId, "status", {
          status: message.status,
          error: message.error ?? null,
          agentId
        });
        return;
      }

      if (message.type === "JOB_LOG") {
        await persistAndBroadcast(message.jobId, "log", { line: message.line, agentId });
        return;
      }

      if (message.type === "JOB_RESULT") {
        await pool.query(`UPDATE jobs SET result = $1::jsonb, updated_at = NOW() WHERE id = $2`, [
          JSON.stringify(message.result),
          message.jobId
        ]);
        await persistAndBroadcast(message.jobId, "result", message.result);
      }
    } catch (error) {
      console.error("[agent-message] failed", error);
    }
  });

  ws.on("close", async () => {
    if (!agentId) {
      return;
    }
    agentSockets.delete(agentId);
    await pool.query(`UPDATE agents SET status = 'offline', updated_at = NOW() WHERE id = $1`, [agentId]);
  });
});

dashboardWss.on("connection", (ws) => {
  addDashboardClient(ws);
  ws.on("close", () => removeDashboardClient(ws));
});

server.on("upgrade", (req, socket, head) => {
  const base = `http://${req.headers.host ?? "localhost"}`;
  const url = new URL(req.url ?? "/", base);

  if (url.pathname === "/ws/agent") {
    agentWss.handleUpgrade(req, socket, head, (ws) => {
      agentWss.emit("connection", ws, req);
    });
    return;
  }

  if (url.pathname === "/ws/dashboard") {
    const token = url.searchParams.get("token");
    if (!token || !verifyDashboardToken(token)) {
      socket.write("HTTP/1.1 401 Unauthorized\\r\\n\\r\\n");
      socket.destroy();
      return;
    }
    dashboardWss.handleUpgrade(req, socket, head, (ws) => {
      dashboardWss.emit("connection", ws, req);
    });
    return;
  }

  socket.write("HTTP/1.1 404 Not Found\\r\\n\\r\\n");
  socket.destroy();
});

setInterval(async () => {
  try {
    await assignOneQueuedJob(agentSockets, (agent, job: JobRow) => {
      const connected = agentSockets.get(agent.agentId);
      if (!connected) {
        return;
      }
      connected.currentJobId = job.id;
      connected.send(
        encodeAgentMessage({
          type: "JOB_ASSIGN",
          job: {
            id: job.id,
            type: job.type,
            engine: job.engine,
            workspacePath: job.workspace_path,
            prompt: job.prompt,
            inputs: job.inputs
          }
        })
      );
    });
  } catch (error) {
    console.error("[dispatcher] failed", error);
  }
}, assignIntervalMs);

startTimeoutReaper(heartbeatTimeoutSec, reassignIntervalMs, (jobId) => {
  void persistAndBroadcast(jobId, "status", { status: "queued", reason: "assignment_timeout" });
});

server.listen(brokerPort, () => {
  console.log(`[broker] listening on :${brokerPort}`);
});
