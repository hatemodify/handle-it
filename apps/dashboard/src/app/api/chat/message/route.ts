import { NextRequest, NextResponse } from "next/server";
import { requireSessionUserFromRequest } from "@/lib/auth";
import { pool } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { buildAssistantReply, buildDraftJob, chatMessageInputSchema } from "@/lib/chat-draft";

export async function POST(req: NextRequest) {
  const user = await requireSessionUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!checkRateLimit(`chat:message:${user.id}`)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const body = await req.json();
  const parsed = chatMessageInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const draftResult = buildDraftJob(parsed.data);
  if (!draftResult.success) {
    return NextResponse.json({ error: draftResult.error.flatten() }, { status: 400 });
  }

  const draft = draftResult.data;
  const sessionId = parsed.data.sessionId ?? (
    await pool.query(
      `INSERT INTO chat_sessions (user_id, title) VALUES ($1, $2) RETURNING id`,
      [user.id, parsed.data.message.slice(0, 80)]
    )
  ).rows[0].id;

  await pool.query(`UPDATE chat_sessions SET updated_at = NOW() WHERE id = $1 AND user_id = $2`, [sessionId, user.id]);

  const userMessage = await pool.query(
    `INSERT INTO chat_messages (session_id, role, content)
     VALUES ($1, 'user', $2)
     RETURNING id, role, content, created_at`,
    [sessionId, parsed.data.message]
  );

  const assistantContent = buildAssistantReply(draft);
  const assistantMessage = await pool.query(
    `INSERT INTO chat_messages (session_id, role, content, proposed_job)
     VALUES ($1, 'assistant', $2, $3::jsonb)
     RETURNING id, role, content, proposed_job, approved_job_id, created_at`,
    [sessionId, assistantContent, JSON.stringify(draft)]
  );

  return NextResponse.json({
    sessionId,
    messages: [userMessage.rows[0], assistantMessage.rows[0]]
  });
}
