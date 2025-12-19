import { createClient } from "redis";

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";

const globalForRedis = globalThis as typeof globalThis & {
  redisClient?: ReturnType<typeof createClient>;
};

const redisClient = globalForRedis.redisClient ?? createClient({ url: redisUrl });

if (!globalForRedis.redisClient) {
  globalForRedis.redisClient = redisClient;
}

export async function getRedis() {
  if (!redisClient.isOpen) {
    await redisClient.connect();
  }

  return redisClient;
}
