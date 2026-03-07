import type { AgentInboundMessage, AgentOutboundMessage, DashboardOutboundMessage } from "@orchestrator/shared";

export const safeParseAgentMessage = (raw: string): AgentInboundMessage | null => {
  try {
    const value = JSON.parse(raw) as AgentInboundMessage;
    if (!value || typeof value !== "object" || typeof value.type !== "string") {
      return null;
    }
    return value;
  } catch {
    return null;
  }
};

export const encodeAgentMessage = (value: AgentOutboundMessage): string => JSON.stringify(value);
export const encodeDashboardEvent = (value: DashboardOutboundMessage): string => JSON.stringify(value);
