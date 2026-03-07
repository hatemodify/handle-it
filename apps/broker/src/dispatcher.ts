import { pool, type JobRow } from "./db.js";

export type AgentSocketState = {
  agentId: string;
  isBusy: boolean;
  send: (data: string) => void;
};

export const assignOneQueuedJob = async (
  agents: Map<string, AgentSocketState>,
  sendJobAssign: (agent: AgentSocketState, job: JobRow) => void
): Promise<void> => {
  const idleAgent = [...agents.values()].find((a) => !a.isBusy);
  if (!idleAgent) {
    return;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `WITH picked AS (
        SELECT id
        FROM jobs
        WHERE status = 'queued'
        ORDER BY created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE jobs j
      SET status = 'assigned', assigned_agent_id = $1, locked_at = NOW(), updated_at = NOW()
      FROM picked
      WHERE j.id = picked.id
      RETURNING j.id, j.type, j.engine, j.workspace_path, j.prompt, j.inputs, j.status, j.assigned_agent_id`,
      [idleAgent.agentId]
    );

    if (result.rowCount === 0) {
      await client.query("ROLLBACK");
      return;
    }

    const job = result.rows[0] as JobRow;
    await client.query(
      `INSERT INTO job_events (job_id, type, payload) VALUES ($1, 'status', $2::jsonb)`,
      [job.id, JSON.stringify({ status: "assigned", assignedAgentId: idleAgent.agentId })]
    );

    await client.query("COMMIT");

    idleAgent.isBusy = true;
    sendJobAssign(idleAgent, job);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

export const requeueTimedOutAssignedJobs = async (heartbeatTimeoutSec: number): Promise<string[]> => {
  const result = await pool.query(
    `UPDATE jobs
     SET status = 'queued', assigned_agent_id = NULL, locked_at = NULL, updated_at = NOW()
     WHERE status = 'assigned'
       AND (
         locked_at < NOW() - ($1 || ' seconds')::interval
         OR assigned_agent_id IN (
           SELECT id
           FROM agents
           WHERE status <> 'online'
             OR last_heartbeat_at IS NULL
             OR last_heartbeat_at < NOW() - ($1 || ' seconds')::interval
         )
       )
     RETURNING id`,
    [heartbeatTimeoutSec]
  );

  const requeuedIds: string[] = [];
  for (const row of result.rows) {
    requeuedIds.push(row.id);
  }
  return requeuedIds;
};
