import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

export const pool = new Pool({ connectionString: databaseUrl });

export type JobRow = {
  id: string;
  type: "code" | "doc";
  engine: "codex" | "claude_code";
  workspace_path: string | null;
  prompt: string;
  inputs: Record<string, unknown>;
  status: string;
  assigned_agent_id: string | null;
};

export const addJobEvent = async (
  jobId: string,
  type: "status" | "log" | "result",
  payload: Record<string, unknown>
): Promise<{ id: number; created_at: Date }> => {
  const result = await pool.query(
    `INSERT INTO job_events (job_id, type, payload) VALUES ($1, $2, $3::jsonb) RETURNING id, created_at`,
    [jobId, type, JSON.stringify(payload)]
  );
  return result.rows[0];
};
