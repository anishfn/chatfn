import { Elysia, t } from "elysia";
import { addMessage, createRoom, getRoom, getRoomWithMessages } from "@/lib/rooms";
import { randomUUID } from "crypto";
import { getRequestIp } from "@/server/ip";
import { rateLimit } from "@/server/rate-limit";

const ROOM_CREATE_LIMIT = Number.parseInt(process.env.ROOM_CREATE_LIMIT ?? "5", 10);
const ROOM_CREATE_WINDOW_SECONDS = Number.parseInt(process.env.ROOM_CREATE_WINDOW_SECONDS ?? "600", 10);
const ROOM_CREATE_DAILY_LIMIT = Number.parseInt(process.env.ROOM_CREATE_DAILY_LIMIT ?? "50", 10);
const ROOM_CREATE_DAILY_WINDOW_SECONDS = Number.parseInt(process.env.ROOM_CREATE_DAILY_WINDOW_SECONDS ?? "86400", 10);

const MESSAGE_RATE_LIMIT = Number.parseInt(process.env.MESSAGE_RATE_LIMIT ?? "20", 10);
const MESSAGE_RATE_WINDOW_SECONDS = Number.parseInt(process.env.MESSAGE_RATE_WINDOW_SECONDS ?? "10", 10);
const MESSAGE_RATE_HOURLY_LIMIT = Number.parseInt(process.env.MESSAGE_RATE_HOURLY_LIMIT ?? "200", 10);
const MESSAGE_RATE_HOURLY_WINDOW_SECONDS = Number.parseInt(
  process.env.MESSAGE_RATE_HOURLY_WINDOW_SECONDS ?? "3600",
  10,
);

async function enforceRateLimit(options: {
  key: string;
  limit: number;
  windowSeconds: number;
  set: { status?: number | string };
  error?: string;
}) {
  const result = await rateLimit(options.key, options.limit, options.windowSeconds);
  if (!result.allowed) {
    options.set.status = 429;
    return { error: options.error ?? "Too many requests. Please slow down." };
  }
  return null;
}

export const app = new Elysia()
  .get("/rooms/:roomId", async ({ params, set }) => {
    const room = await getRoom(params.roomId);
    if (!room) {
      set.status = 404;
      return { error: "Room not found." };
    }

    return { room };
  })
  .post(
    "/rooms",
    async ({ body, set, request }) => {
      const username = body.username.trim();
      if (!username) {
        set.status = 400;
        return { error: "Username is required." };
      }

      const ip = getRequestIp(request);
      const limitResult =
        (await enforceRateLimit({
          key: `ratelimit:rooms:create:${ip}`,
          limit: ROOM_CREATE_LIMIT,
          windowSeconds: ROOM_CREATE_WINDOW_SECONDS,
          set,
          error: "Too many rooms created. Please wait a bit.",
        })) ??
        (await enforceRateLimit({
          key: `ratelimit:rooms:create:daily:${ip}`,
          limit: ROOM_CREATE_DAILY_LIMIT,
          windowSeconds: ROOM_CREATE_DAILY_WINDOW_SECONDS,
          set,
          error: "Room creation limit reached for today.",
        }));
      if (limitResult) return limitResult;

      const room = await createRoom(username.slice(0, 32));
      return { roomId: room.id };
    },
    {
      body: t.Object({
        username: t.String(),
      }),
    },
  )
  .get("/rooms/:roomId/messages", async ({ params, set }) => {
    const result = await getRoomWithMessages(params.roomId);
    if (!result) {
      set.status = 404;
      return { error: "Room not found." };
    }

    return { messages: result.messages };
  })
  .post(
    "/rooms/:roomId/messages",
    async ({ params, body, set, request }) => {
      const text = body.text.trim();
      const username = body.username.trim();

      if (!text) {
        set.status = 400;
        return { error: "Message cannot be empty." };
      }

      if (!username) {
        set.status = 400;
        return { error: "Username is required." };
      }

      const ip = getRequestIp(request);
      const limitResult =
        (await enforceRateLimit({
          key: `ratelimit:messages:${ip}`,
          limit: MESSAGE_RATE_LIMIT,
          windowSeconds: MESSAGE_RATE_WINDOW_SECONDS,
          set,
          error: "Too many messages. Please slow down.",
        })) ??
        (await enforceRateLimit({
          key: `ratelimit:messages:${ip}:${params.roomId}:hourly`,
          limit: MESSAGE_RATE_HOURLY_LIMIT,
          windowSeconds: MESSAGE_RATE_HOURLY_WINDOW_SECONDS,
          set,
          error: "Message limit reached for the last hour.",
        }));
      if (limitResult) return limitResult;

      const message = {
        id: randomUUID(),
        user: username.slice(0, 32),
        text: text.slice(0, 500),
        createdAt: Date.now(),
      };

      const stored = await addMessage(params.roomId, message);
      if (!stored) {
        set.status = 404;
        return { error: "Room not found." };
      }

      return { message };
    },
    {
      body: t.Object({
        username: t.String(),
        text: t.String(),
      }),
    },
  );
