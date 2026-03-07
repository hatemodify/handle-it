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
  const cursor = Number(req.nextUrl.searchParams.get("cursor") ?? "0");

  const owned = await pool.query(`SELECT id FROM jobs WHERE id = $1 AND user_id = $2 LIMIT 1`, [id, user.id]);
  if (owned.rowCount === 0) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const events = await pool.query(
    `SELECT id, job_id, type, payload, created_at
     FROM job_events
     WHERE job_id = $1 AND id > $2
     ORDER BY id ASC
     LIMIT 1000`,
    [id, cursor]
  );

  return NextResponse.json({
    events: events.rows,
    nextCursor: events.rowCount ? events.rows[events.rows.length - 1].id : cursor
  });
}
