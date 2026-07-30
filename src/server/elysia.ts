import { Elysia, t } from "elysia";
import { addMessage, addReport, createRoom, getRoom, getRoomWithMessages } from "@/lib/rooms";
import { randomUUID } from "crypto";
import { getRequestIp } from "@/server/ip";
import { captureServer } from "@/server/analytics";
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

// Read routes are polled by every client (messages every 2s), so the limit is
// generous enough for legitimate polling across a few tabs while still capping
// scraping and room-id brute forcing.
const READ_RATE_LIMIT = Number.parseInt(process.env.READ_RATE_LIMIT ?? "120", 10);
const READ_RATE_WINDOW_SECONDS = Number.parseInt(process.env.READ_RATE_WINDOW_SECONDS ?? "60", 10);

const REPORT_RATE_LIMIT = Number.parseInt(process.env.REPORT_RATE_LIMIT ?? "10", 10);
const REPORT_RATE_WINDOW_SECONDS = Number.parseInt(process.env.REPORT_RATE_WINDOW_SECONDS ?? "60", 10);

type ElysiaSet = {
  status?: number | string;
  headers: Record<string, string | number>;
};

async function enforceRateLimit(options: {
  key: string;
  limit: number;
  windowSeconds: number;
  set: ElysiaSet;
  ip: string;
  route: string;
  error?: string;
}) {
  const result = await rateLimit(options.key, options.limit, options.windowSeconds);

  options.set.headers["X-RateLimit-Limit"] = String(options.limit);
  options.set.headers["X-RateLimit-Remaining"] = String(result.remaining);
  options.set.headers["X-RateLimit-Reset"] = String(result.resetSeconds);

  if (!result.allowed) {
    options.set.status = 429;
    options.set.headers["Retry-After"] = String(result.resetSeconds);
    void captureServer("rate_limit_exceeded", options.ip, {
      route: options.route,
      limit: options.limit,
      window_seconds: options.windowSeconds,
    });
    return { error: options.error ?? "Too many requests. Please slow down." };
  }
  return null;
}

export const app = new Elysia()
  .get("/rooms/:roomId", async ({ params, set, request }) => {
    const ip = getRequestIp(request);
    const limitResult = await enforceRateLimit({
      key: `ratelimit:read:${ip}`,
      limit: READ_RATE_LIMIT,
      windowSeconds: READ_RATE_WINDOW_SECONDS,
      set,
      ip,
      route: "room_get",
    });
    if (limitResult) return limitResult;

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
          ip,
          route: "room_create",
          error: "Too many rooms created. Please wait a bit.",
        })) ??
        (await enforceRateLimit({
          key: `ratelimit:rooms:create:daily:${ip}`,
          limit: ROOM_CREATE_DAILY_LIMIT,
          windowSeconds: ROOM_CREATE_DAILY_WINDOW_SECONDS,
          set,
          ip,
          route: "room_create_daily",
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
  .get("/rooms/:roomId/messages", async ({ params, set, request }) => {
    const ip = getRequestIp(request);
    const limitResult = await enforceRateLimit({
      key: `ratelimit:read:${ip}`,
      limit: READ_RATE_LIMIT,
      windowSeconds: READ_RATE_WINDOW_SECONDS,
      set,
      ip,
      route: "messages_get",
    });
    if (limitResult) return limitResult;

    const result = await getRoomWithMessages(params.roomId);
    if (!result) {
      set.status = 404;
      return { error: "Room not found." };
    }

    return { messages: result.messages, meta: result.meta };
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
          ip,
          route: "message_send",
          error: "Too many messages. Please slow down.",
        })) ??
        (await enforceRateLimit({
          key: `ratelimit:messages:${ip}:${params.roomId}:hourly`,
          limit: MESSAGE_RATE_HOURLY_LIMIT,
          windowSeconds: MESSAGE_RATE_HOURLY_WINDOW_SECONDS,
          set,
          ip,
          route: "message_send_hourly",
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
  )
  .post(
    "/rooms/:roomId/messages/:messageId/report",
    async ({ params, body, set, request }) => {
      const ip = getRequestIp(request);
      const limitResult = await enforceRateLimit({
        key: `ratelimit:reports:${ip}`,
        limit: REPORT_RATE_LIMIT,
        windowSeconds: REPORT_RATE_WINDOW_SECONDS,
        set,
        ip,
        route: "message_report",
        error: "Too many reports. Please slow down.",
      });
      if (limitResult) return limitResult;

      const reason = (body.reason ?? "").trim().slice(0, 280);
      const reporter = (body.username ?? "").trim().slice(0, 32);

      const report = {
        id: randomUUID(),
        messageId: params.messageId,
        reason,
        reporter,
        createdAt: Date.now(),
      };

      const status = await addReport(params.roomId, report);
      if (status === "room_not_found") {
        set.status = 404;
        return { error: "Room not found." };
      }
      if (status === "message_not_found") {
        set.status = 404;
        return { error: "Message not found." };
      }

      void captureServer("message_reported", ip, {
        room_id: params.roomId,
        message_id: params.messageId,
        has_reason: reason.length > 0,
      });

      return { ok: true };
    },
    {
      body: t.Object({
        reason: t.Optional(t.String()),
        username: t.Optional(t.String()),
      }),
    },
  );
