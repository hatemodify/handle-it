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
  const result = await pool.query(
    `SELECT id, type, engine, workspace_path, prompt, inputs, status, assigned_agent_id, result, error_message, created_at, updated_at
     FROM jobs WHERE id = $1 AND user_id = $2 LIMIT 1`,
    [id, user.id]
  );

  if (result.rowCount === 0) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({ job: result.rows[0] });
}
