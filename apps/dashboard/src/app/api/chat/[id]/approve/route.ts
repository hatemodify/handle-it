import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireSessionUserFromRequest } from "@/lib/auth";
import { pool } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { createJobSchema } from "@/lib/validators";

const approveSchema = z.object({
  messageId: z.number().int().positive()
});

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const user = await requireSessionUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!checkRateLimit(`chat:approve:${user.id}`)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const body = await req.json();
  const parsedBody = approveSchema.safeParse(body);
  if (!parsedBody.success) {
    return NextResponse.json({ error: parsedBody.error.flatten() }, { status: 400 });
  }

  const { id: sessionId } = await context.params;

  const msg = await pool.query(
    `SELECT m.id, m.proposed_job, m.approved_job_id
     FROM chat_messages m
     JOIN chat_sessions s ON s.id = m.session_id
     WHERE m.id = $1 AND m.session_id = $2 AND s.user_id = $3 AND m.role = 'assistant'
     LIMIT 1`,
    [parsedBody.data.messageId, sessionId, user.id]
  );

  if (msg.rowCount === 0) {
    return NextResponse.json({ error: "message_not_found" }, { status: 404 });
  }

  if (msg.rows[0].approved_job_id) {
    return NextResponse.json({ error: "already_approved" }, { status: 409 });
  }

  const proposed = msg.rows[0].proposed_job as unknown;
  const validated = createJobSchema.safeParse(proposed);
  if (!validated.success) {
    return NextResponse.json({ error: "invalid_proposed_job", detail: validated.error.flatten() }, { status: 400 });
  }

  const job = validated.data;
  const createdJob = await pool.query(
    `INSERT INTO jobs (user_id, type, engine, workspace_path, prompt, inputs, status)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'queued')
     RETURNING id, status`,
    [user.id, job.type, job.engine, job.workspacePath, job.prompt, JSON.stringify(job.inputs ?? {})]
  );

  await pool.query(
    `INSERT INTO job_events (job_id, type, payload)
     VALUES ($1, 'status', $2::jsonb)`,
    [createdJob.rows[0].id, JSON.stringify({ status: "queued", source: "chat_approval", messageId: msg.rows[0].id })]
  );

  await pool.query(`UPDATE chat_messages SET approved_job_id = $1 WHERE id = $2`, [
    createdJob.rows[0].id,
    msg.rows[0].id
  ]);

  return NextResponse.json({ jobId: createdJob.rows[0].id, status: createdJob.rows[0].status });
}
