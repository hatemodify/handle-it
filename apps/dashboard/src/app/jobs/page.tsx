import Link from "next/link";
import { requireSessionUser } from "@/lib/auth";
import { pool } from "@/lib/db";

export const dynamic = "force-dynamic";

const statusClass = (status: string) => {
  if (["succeeded"].includes(status)) {
    return "ok";
  }
  if (["failed", "canceled"].includes(status)) {
    return "danger";
  }
  return "warn";
};

export default async function JobsPage() {
  const user = await requireSessionUser();
  const jobs = await pool.query(
    `SELECT id, type, engine, workspace_path, status, created_at
     FROM jobs WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100`,
    [user.id]
  );

  return (
    <main className="page stack">
      <div className="card hero">
        <div className="stack" style={{ gap: 6 }}>
          <h1>운영 대시보드</h1>
          <p>{user.email}</p>
        </div>
        <div className="hero-links">
          <Link className="button-link" href="/chat">챗 화면</Link>
        </div>
      </div>

      <div className="card">
        <h2>최근 작업 {jobs.rows.length}건</h2>
        <ul className="job-list" style={{ marginTop: 12 }}>
          {jobs.rows.map((job) => (
            <li key={job.id} className="job-item">
              <Link href={`/jobs/${job.id}`}>{job.id}</Link>
              <div className="job-meta">
                <span className="tag">{job.type}</span>
                <span className="tag">{job.engine}</span>
                <span className={`tag ${statusClass(job.status)}`}>{job.status}</span>
                <span className="tag">{job.workspace_path ?? "null"}</span>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
