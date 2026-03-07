const read = (name: string, fallback = ""): string => {
  return process.env[name] ?? fallback;
};

const localDevAuthBypass = read("LOCAL_DEV_AUTH_BYPASS") === "true";

export const env = {
  databaseUrl: read("DATABASE_URL"),
  sessionSecret: read("SESSION_SECRET"),
  appBaseUrl: read("APP_BASE_URL", "http://localhost"),
  allowedEmail: read("ALLOWED_EMAIL").toLowerCase() || undefined,
  googleClientId: read("GOOGLE_CLIENT_ID") || undefined,
  googleClientSecret: read("GOOGLE_CLIENT_SECRET") || undefined,
  googleRedirectUri: read("GOOGLE_REDIRECT_URI") || undefined,
  dashboardStreamTokenSecret: read("DASHBOARD_STREAM_TOKEN_SECRET"),
  agentKeyPepper: read("AGENT_KEY_PEPPER"),
  brokerInternalSecret: read("BROKER_INTERNAL_SECRET"),
  localDevAuthBypass,
  localDevUserEmail: read("LOCAL_DEV_USER_EMAIL", "local-dev@example.com").toLowerCase()
};

export const assertDashboardRuntimeEnv = (): void => {
  const required = [
    ["DATABASE_URL", env.databaseUrl],
    ["SESSION_SECRET", env.sessionSecret],
    ["DASHBOARD_STREAM_TOKEN_SECRET", env.dashboardStreamTokenSecret],
    ["AGENT_KEY_PEPPER", env.agentKeyPepper],
    ["BROKER_INTERNAL_SECRET", env.brokerInternalSecret]
  ] as const;

  for (const [name, value] of required) {
    if (!value) {
      throw new Error(`${name} is required`);
    }
  }

  if (!env.localDevAuthBypass) {
    if (!env.allowedEmail) {
      throw new Error("ALLOWED_EMAIL is required when LOCAL_DEV_AUTH_BYPASS is false");
    }
    if (!env.googleClientId || !env.googleClientSecret || !env.googleRedirectUri) {
      throw new Error(
        "GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI are required when LOCAL_DEV_AUTH_BYPASS is false"
      );
    }
  }
};
