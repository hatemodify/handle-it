import { NextRequest, NextResponse } from "next/server";
import { requireSessionUserFromRequest } from "@/lib/auth";
import { pool } from "@/lib/db";
import { env } from "@/lib/env";
import { checkRateLimit } from "@/lib/rate-limit";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const user = await requireSessionUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!checkRateLimit(`jobs:cancel:${user.id}`)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const { id } = await context.params;

  const updated = await pool.query(
    `UPDATE jobs
     SET status = 'canceled', updated_at = NOW()
     WHERE id = $1
       AND user_id = $2
       AND status IN ('queued','assigned','running')
     RETURNING id, assigned_agent_id`,
    [id, user.id]
  );

  if (updated.rowCount === 0) {
    return NextResponse.json({ error: "invalid_state_or_not_found" }, { status: 409 });
  }

  await pool.query(
    `INSERT INTO job_events (job_id, type, payload) VALUES ($1, 'status', $2::jsonb)`,
    [id, JSON.stringify({ status: "canceled" })]
  );

  if (updated.rows[0].assigned_agent_id) {
    await fetch(`${env.appBaseUrl}/broker/internal/cancel`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-broker-internal-secret": env.brokerInternalSecret
      },
      body: JSON.stringify({ jobId: id, agentId: updated.rows[0].assigned_agent_id })
    }).catch(() => {
      // 브로커 취소 알림 실패는 재시도 대상이며, 상태 자체는 canceled로 유지한다.
    });
  }

  return NextResponse.json({ ok: true });
}
