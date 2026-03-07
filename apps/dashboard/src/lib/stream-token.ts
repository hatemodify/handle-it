import crypto from "node:crypto";
import { env } from "./env";

export const issueDashboardStreamToken = (userId: string): string => {
  const payload = {
    sub: userId,
    exp: Math.floor(Date.now() / 1000) + 60 * 15
  };
  const payloadEncoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", env.dashboardStreamTokenSecret).update(payloadEncoded).digest("hex");
  return `${payloadEncoded}.${sig}`;
};
