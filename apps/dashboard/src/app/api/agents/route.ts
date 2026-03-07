import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSessionUserFromRequest } from "@/lib/auth";
import { generateAgentKey, hashAgentKey } from "@/lib/agent-key";
import { pool } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";

const createAgentSchema = z.object({
  name: z.string().min(1),
  capabilities: z.record(z.any()).optional()
});

export async function POST(req: NextRequest) {
  const user = await requireSessionUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!checkRateLimit(`agents:create:${user.id}`)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const body = await req.json();
  const parsed = createAgentSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const rawKey = generateAgentKey();
  const hashed = hashAgentKey(rawKey);

  const created = await pool.query(
    `INSERT INTO agents (name, agent_key_hash, capabilities, status)
     VALUES ($1, $2, $3::jsonb, 'offline')
     RETURNING id, name, status, created_at`,
    [parsed.data.name, hashed, JSON.stringify(parsed.data.capabilities ?? {})]
  );

  return NextResponse.json({
    agent: created.rows[0],
    agentKey: rawKey
  });
}

export async function GET(req: NextRequest) {
  const user = await requireSessionUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await pool.query(
    `SELECT id, name, capabilities, status, last_heartbeat_at, created_at, updated_at
     FROM agents
     ORDER BY created_at DESC`
  );

  return NextResponse.json({ agents: result.rows });
}
