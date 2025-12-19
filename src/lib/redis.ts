import { Redis } from "@upstash/redis";

const upstashUrl = process.env.UPSTASH_REDIS_REST_URL ?? "";
const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN ?? "";

const globalForRedis = globalThis as typeof globalThis & {
  redisClient?: Redis;
};

const redisClient =
  globalForRedis.redisClient ??
  new Redis({
    url: upstashUrl,
    token: upstashToken,
  });

if (!globalForRedis.redisClient) {
  globalForRedis.redisClient = redisClient;
}

export async function getRedis() {
  if (!upstashUrl || !upstashToken) {
    throw new Error("Missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN");
  }
  return redisClient;
}
