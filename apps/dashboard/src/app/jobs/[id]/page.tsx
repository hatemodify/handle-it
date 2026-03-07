import Link from "next/link";
import { JobEventStream } from "@/app/components/job-event-stream";
import { JobActions } from "@/app/components/job-actions";
import { requireSessionUser } from "@/lib/auth";
import { env } from "@/lib/env";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireSessionUser();
  const { id } = await params;

  const result = await pool.query(
    `SELECT id, type, engine, workspace_path, prompt, inputs, status, result, error_message, created_at, updated_at
     FROM jobs
     WHERE id = $1 AND user_id = $2
     LIMIT 1`,
    [id, user.id]
  );

  if (result.rowCount === 0) {
    return (
      <main className="page stack">
        <div className="card">job not found</div>
      </main>
    );
  }

  const job = result.rows[0] as Record<string, unknown>;

  return (
    <main className="page stack">
      <div className="card hero">
        <div className="stack" style={{ gap: 6 }}>
          <h1>Job {id}</h1>
          <div className="meta-row">
            <span className="tag">{String(job.type)}</span>
            <span className="tag">{String(job.engine)}</span>
            <span className="tag warn">{String(job.status)}</span>
            <span className="tag">{String(job.workspace_path ?? "null")}</span>
          </div>
        </div>
        <div className="hero-links">
          <Link className="button-link secondary" href="/jobs">목록으로</Link>
        </div>
      </div>

      <div className="card">
        <h2>요청 본문</h2>
        <pre>{String(job.prompt)}</pre>
      </div>

      <div className="card">
        <h2>Job Payload</h2>
        <pre>{JSON.stringify(job, null, 2)}</pre>
      </div>

      <JobActions jobId={id} />
      <JobEventStream jobId={id} wsBaseUrl={`${env.appBaseUrl}/ws/dashboard`} />
    </main>
  );
}
