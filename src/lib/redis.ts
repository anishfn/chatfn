import { Redis } from "@upstash/redis";

const globalForRedis = globalThis as typeof globalThis & {
  redisClient?: Redis;
};

function resolveUpstashConfig() {
  const url =
    process.env.UPSTASH_REDIS_REST_URL ??
    process.env.UPSTASH_REDIS_URL ??
    process.env.REDIS_URL ??
    "";
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ??
    process.env.UPSTASH_REDIS_TOKEN ??
    process.env.REDIS_TOKEN ??
    "";

  if (!url || !token) {
    throw new Error(
      "Missing Upstash REST env vars. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.",
    );
  }
  if (url.startsWith("redis://") || url.startsWith("rediss://")) {
    throw new Error(
      "Invalid Upstash REST URL. Use the REST URL (https://...), not the TCP/redis URL.",
    );
  }
  if (!url.startsWith("https://")) {
    throw new Error("Invalid Upstash REST URL. Expected an https:// URL.");
  }

  return { url, token };
}

export async function getRedis() {
  if (!globalForRedis.redisClient) {
    const { url, token } = resolveUpstashConfig();
    globalForRedis.redisClient = new Redis({ url, token });
  }
  return globalForRedis.redisClient;
}
