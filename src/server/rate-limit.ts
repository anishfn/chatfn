import { getRedis } from "@/lib/redis";

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetSeconds: number;
};

export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
  if (limit <= 0 || windowSeconds <= 0) {
    return { allowed: true, remaining: 0, resetSeconds: 0 };
  }

  const redis = await getRedis();
  const countRaw = await redis.eval(
    `
    local current = redis.call("INCR", KEYS[1])
    if current == 1 then
      redis.call("EXPIRE", KEYS[1], tonumber(ARGV[1]))
    end
    return current
    `,
    [key],
    [windowSeconds],
  );

  const count = Number(countRaw);
  const remaining = Math.max(0, limit - count);
  return {
    allowed: count <= limit,
    remaining,
    resetSeconds: windowSeconds,
  };
}
