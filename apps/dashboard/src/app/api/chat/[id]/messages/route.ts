import { NextRequest, NextResponse } from "next/server";
import { requireSessionUserFromRequest } from "@/lib/auth";
import { pool } from "@/lib/db";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const user = await requireSessionUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await context.params;
  const owned = await pool.query(`SELECT id FROM chat_sessions WHERE id = $1 AND user_id = $2 LIMIT 1`, [id, user.id]);
  if (owned.rowCount === 0) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const rows = await pool.query(
    `SELECT id, role, content, proposed_job, approved_job_id, created_at
     FROM chat_messages
     WHERE session_id = $1
     ORDER BY id ASC`,
    [id]
  );

  return NextResponse.json({ messages: rows.rows });
}
