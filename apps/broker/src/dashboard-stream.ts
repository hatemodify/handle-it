import type WebSocket from "ws";
import { encodeDashboardEvent } from "./protocol.js";

const dashboardClients = new Set<WebSocket>();

export const addDashboardClient = (ws: WebSocket) => {
  dashboardClients.add(ws);
};

export const removeDashboardClient = (ws: WebSocket) => {
  dashboardClients.delete(ws);
};

export const broadcastJobEvent = (event: {
  id: number;
  jobId: string;
  type: "status" | "log" | "result";
  payload: Record<string, unknown>;
  createdAt: string;
}) => {
  const wire = encodeDashboardEvent({ type: "JOB_EVENT", event });
  for (const client of dashboardClients) {
    if (client.readyState === client.OPEN) {
      client.send(wire);
    }
  }
};
