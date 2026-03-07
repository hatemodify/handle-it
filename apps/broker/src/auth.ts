import crypto from "node:crypto";
import { pool } from "./db.js";

const agentPepper = process.env.AGENT_KEY_PEPPER;
if (!agentPepper) {
  throw new Error("AGENT_KEY_PEPPER is required");
}

export const hashAgentKey = (rawKey: string): string => {
  return crypto.createHmac("sha256", agentPepper).update(rawKey).digest("hex");
};

export const authenticateAgentByKey = async (rawKey: string) => {
  const hash = hashAgentKey(rawKey);
  const result = await pool.query(
    `SELECT id, name FROM agents WHERE agent_key_hash = $1 AND status <> 'revoked' LIMIT 1`,
    [hash]
  );
  if (result.rowCount === 0) {
    return null;
  }
  return result.rows[0] as { id: string; name: string };
};

export const verifyDashboardToken = (token: string): { sub: string; exp: number } | null => {
  try {
    const secret = process.env.DASHBOARD_STREAM_TOKEN_SECRET;
    if (!secret) {
      throw new Error("DASHBOARD_STREAM_TOKEN_SECRET is required");
    }
    const [payloadEncoded, sig] = token.split(".");
    if (!payloadEncoded || !sig) {
      return null;
    }
    const expectedSig = crypto.createHmac("sha256", secret).update(payloadEncoded).digest("hex");
    if (!crypto.timingSafeEqual(Buffer.from(expectedSig), Buffer.from(sig))) {
      return null;
    }
    const payload = JSON.parse(Buffer.from(payloadEncoded, "base64url").toString("utf8"));
    if (typeof payload.sub !== "string" || typeof payload.exp !== "number") {
      return null;
    }
    if (payload.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
};
