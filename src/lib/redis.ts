import { Redis } from "@upstash/redis";

const upstashUrl =
  process.env.UPSTASH_REDIS_REST_URL ?? process.env.UPSTASH_REDIS_URL ?? "";
const upstashToken =
  process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.UPSTASH_REDIS_TOKEN ?? "";

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
  if (!upstashUrl.startsWith("https://")) {
    throw new Error(
      "Invalid Upstash REST URL. Use the REST URL (https://...), not the TCP/redis URL.",
    );
  }
  return redisClient;
}
