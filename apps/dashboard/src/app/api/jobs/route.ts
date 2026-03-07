import { NextRequest, NextResponse } from "next/server";
import { requireSessionUserFromRequest } from "@/lib/auth";
import { pool } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { createJobSchema } from "@/lib/validators";

export async function POST(req: NextRequest) {
  const user = await requireSessionUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!checkRateLimit(`jobs:create:${user.id}`)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const payload = await req.json();
  const parsed = createJobSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const value = parsed.data;
  const created = await pool.query(
    `INSERT INTO jobs (user_id, type, engine, workspace_path, prompt, inputs, status)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'queued')
     RETURNING id, status`,
    [
      user.id,
      value.type,
      value.engine,
      value.workspacePath,
      value.prompt,
      JSON.stringify(value.inputs ?? {})
    ]
  );

  await pool.query(
    `INSERT INTO job_events (job_id, type, payload)
     VALUES ($1, 'status', $2::jsonb)`,
    [created.rows[0].id, JSON.stringify({ status: "queued" })]
  );

  return NextResponse.json({ id: created.rows[0].id, status: created.rows[0].status });
}

export async function GET(req: NextRequest) {
  const user = await requireSessionUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const rows = await pool.query(
    `SELECT id, type, engine, workspace_path, prompt, status, assigned_agent_id, created_at, updated_at
     FROM jobs
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT 100`,
    [user.id]
  );

  return NextResponse.json({ jobs: rows.rows });
}
