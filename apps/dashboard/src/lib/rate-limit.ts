const bucket = new Map<string, { count: number; resetAt: number }>();

const LIMIT_PER_MIN = Number(process.env.RATE_LIMIT_PER_MIN ?? 120);

export const checkRateLimit = (key: string): boolean => {
  const now = Date.now();
  const state = bucket.get(key);
  if (!state || state.resetAt <= now) {
    bucket.set(key, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (state.count >= LIMIT_PER_MIN) {
    return false;
  }
  state.count += 1;
  return true;
};
