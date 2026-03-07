import { Pool } from "pg";
import { assertDashboardRuntimeEnv, env } from "./env";

assertDashboardRuntimeEnv();

export const pool = new Pool({ connectionString: env.databaseUrl });
