import { NextRequest, NextResponse } from "next/server";
import { isAllowedEmail } from "@/lib/allowlist";
import { pool } from "@/lib/db";
import { env } from "@/lib/env";
import { createSessionForUser } from "@/lib/session";

export async function GET(req: NextRequest) {
  if (env.localDevAuthBypass) {
    return NextResponse.redirect(`${env.appBaseUrl}/jobs`);
  }

  if (!env.googleClientId || !env.googleClientSecret || !env.googleRedirectUri) {
    return NextResponse.json({ error: "google_oauth_not_configured" }, { status: 500 });
  }

  const code = req.nextUrl.searchParams.get("code");
  if (!code) {
    return NextResponse.json({ error: "missing_code" }, { status: 400 });
  }

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.googleClientId,
      client_secret: env.googleClientSecret,
      redirect_uri: env.googleRedirectUri,
      grant_type: "authorization_code"
    })
  });

  if (!tokenRes.ok) {
    return NextResponse.json({ error: "token_exchange_failed" }, { status: 401 });
  }

  const token = (await tokenRes.json()) as { access_token: string };
  const userRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${token.access_token}` }
  });

  if (!userRes.ok) {
    return NextResponse.json({ error: "userinfo_failed" }, { status: 401 });
  }

  const userInfo = (await userRes.json()) as { email?: string };
  const email = (userInfo.email ?? "").toLowerCase();
  if (!isAllowedEmail(email)) {
    return NextResponse.json({ error: "email_not_allowed" }, { status: 403 });
  }

  const userResult = await pool.query(
    `INSERT INTO users (email) VALUES ($1)
     ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
     RETURNING id`,
    [email]
  );

  await createSessionForUser(userResult.rows[0].id as string);
  return NextResponse.redirect(`${env.appBaseUrl}/jobs`);
}
