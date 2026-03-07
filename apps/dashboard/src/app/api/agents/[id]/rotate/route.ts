import { NextRequest, NextResponse } from "next/server";
import { requireSessionUserFromRequest } from "@/lib/auth";
import { generateAgentKey, hashAgentKey } from "@/lib/agent-key";
import { pool } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const user = await requireSessionUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!checkRateLimit(`agents:rotate:${user.id}`)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const { id } = await context.params;
  const newKey = generateAgentKey();
  const newHash = hashAgentKey(newKey);

  const result = await pool.query(
    `UPDATE agents
     SET agent_key_hash = $1, status = 'offline', revoked_at = NULL, updated_at = NOW()
     WHERE id = $2
     RETURNING id, status, updated_at`,
    [newHash, id]
  );

  if (result.rowCount === 0) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({ agent: result.rows[0], agentKey: newKey });
}
