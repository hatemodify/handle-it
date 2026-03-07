import crypto from "node:crypto";
import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { pool } from "./db";
import { env } from "./env";

const SESSION_COOKIE_NAME = "orchestrator_session";
const SESSION_TTL_SEC = 60 * 60 * 24 * 7;

const hashSessionToken = (token: string): string => {
  return crypto.createHmac("sha256", env.sessionSecret).update(token).digest("hex");
};

const getOrCreateUserByEmail = async (email: string): Promise<{ id: string; email: string }> => {
  const result = await pool.query(
    `INSERT INTO users (email)
     VALUES ($1)
     ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
     RETURNING id, email`,
    [email.toLowerCase()]
  );
  return result.rows[0] as { id: string; email: string };
};

export const getLocalDevUser = async (): Promise<{ id: string; email: string }> => {
  return getOrCreateUserByEmail(env.localDevUserEmail);
};

export const createSessionForUser = async (userId: string) => {
  const rawToken = crypto.randomBytes(32).toString("hex");
  const hash = hashSessionToken(rawToken);
  await pool.query(
    `INSERT INTO sessions (user_id, session_token_hash, expires_at)
     VALUES ($1, $2, NOW() + interval '7 days')`,
    [userId, hash]
  );

  const jar = await cookies();
  jar.set(SESSION_COOKIE_NAME, rawToken, {
    httpOnly: true,
    secure: env.appBaseUrl.startsWith("https://"),
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SEC
  });
};

export const deleteSession = async () => {
  const jar = await cookies();
  const raw = jar.get(SESSION_COOKIE_NAME)?.value;
  if (!raw) {
    return;
  }
  await pool.query(`DELETE FROM sessions WHERE session_token_hash = $1`, [hashSessionToken(raw)]);
  jar.delete(SESSION_COOKIE_NAME);
};

export const getSessionUser = async (): Promise<{ id: string; email: string } | null> => {
  if (env.localDevAuthBypass) {
    return getLocalDevUser();
  }

  const jar = await cookies();
  const raw = jar.get(SESSION_COOKIE_NAME)?.value;
  if (!raw) {
    return null;
  }
  const hash = hashSessionToken(raw);
  const result = await pool.query(
    `SELECT u.id, u.email
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.session_token_hash = $1
       AND s.expires_at > NOW()
     LIMIT 1`,
    [hash]
  );
  if (result.rowCount === 0) {
    return null;
  }
  return result.rows[0] as { id: string; email: string };
};

export const getSessionUserFromRequest = async (
  req: NextRequest
): Promise<{ id: string; email: string } | null> => {
  if (env.localDevAuthBypass) {
    return getLocalDevUser();
  }

  const raw = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!raw) {
    return null;
  }
  const hash = hashSessionToken(raw);
  const result = await pool.query(
    `SELECT u.id, u.email
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.session_token_hash = $1
       AND s.expires_at > NOW()
     LIMIT 1`,
    [hash]
  );
  if (result.rowCount === 0) {
    return null;
  }
  return result.rows[0] as { id: string; email: string };
};
