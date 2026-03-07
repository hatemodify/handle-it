import crypto from "node:crypto";
import { env } from "./env";

export const generateAgentKey = (): string => {
  return `agent_${crypto.randomBytes(24).toString("hex")}`;
};

export const hashAgentKey = (raw: string): string => {
  return crypto.createHmac("sha256", env.agentKeyPepper).update(raw).digest("hex");
};
