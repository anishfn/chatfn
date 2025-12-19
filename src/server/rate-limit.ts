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
  const countRaw = await redis.incr(key);
  if (countRaw === 1) {
    await redis.expire(key, windowSeconds);
  }

  const count = Number(countRaw);
  const remaining = Math.max(0, limit - count);
  return {
    allowed: count <= limit,
    remaining,
    resetSeconds: windowSeconds,
  };
}
