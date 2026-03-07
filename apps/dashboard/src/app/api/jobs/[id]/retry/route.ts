import { NextRequest, NextResponse } from "next/server";
import { requireSessionUserFromRequest } from "@/lib/auth";
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
  if (!checkRateLimit(`jobs:retry:${user.id}`)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const { id } = await context.params;
  const source = await pool.query(
    `SELECT type, engine, workspace_path, prompt, inputs, status
     FROM jobs WHERE id = $1 AND user_id = $2 LIMIT 1`,
    [id, user.id]
  );

  if (source.rowCount === 0) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const row = source.rows[0] as {
    type: "code" | "doc";
    engine: "codex" | "claude_code";
    workspace_path: string | null;
    prompt: string;
    inputs: Record<string, unknown>;
    status: string;
  };

  if (!["failed", "canceled"].includes(row.status)) {
    return NextResponse.json({ error: "invalid_state" }, { status: 409 });
  }

  const created = await pool.query(
    `INSERT INTO jobs (user_id, type, engine, workspace_path, prompt, inputs, status)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'queued')
     RETURNING id, status`,
    [user.id, row.type, row.engine, row.workspace_path, row.prompt, JSON.stringify(row.inputs)]
  );

  await pool.query(
    `INSERT INTO job_events (job_id, type, payload)
     VALUES ($1, 'status', $2::jsonb)`,
    [created.rows[0].id, JSON.stringify({ status: "queued", retriedFrom: id })]
  );

  return NextResponse.json({ id: created.rows[0].id, status: created.rows[0].status });
}
