import { NextResponse } from "next/server";
import { env } from "@/lib/env";

export async function GET() {
  if (env.localDevAuthBypass) {
    return NextResponse.redirect(`${env.appBaseUrl}/jobs`);
  }
  if (!env.googleClientId || !env.googleRedirectUri) {
    return NextResponse.json({ error: "google_oauth_not_configured" }, { status: 500 });
  }

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", env.googleClientId);
  authUrl.searchParams.set("redirect_uri", env.googleRedirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", "openid email profile");
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");

  return NextResponse.redirect(authUrl.toString());
}
