import { createServer } from "http";
import { randomUUID } from "crypto";
import { WebSocketServer } from "ws";
import { createClient } from "redis";
import { PostHog } from "posthog-node";
import next from "next";

const dev = process.env.NODE_ENV !== "production";
const port = Number.parseInt(process.env.PORT ?? "3000", 10);

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
const roomTtlSeconds = Number.parseInt(process.env.ROOM_TTL_SECONDS ?? "86400", 10);
const messageLimit = Number.parseInt(process.env.MESSAGE_LIMIT ?? "200", 10);
const wsMessageLimit = Number.parseInt(process.env.MESSAGE_RATE_LIMIT ?? "20", 10);
const wsMessageWindowSeconds = Number.parseInt(process.env.MESSAGE_RATE_WINDOW_SECONDS ?? "10", 10);
const wsMessageHourlyLimit = Number.parseInt(process.env.MESSAGE_RATE_HOURLY_LIMIT ?? "200", 10);
const wsMessageHourlyWindowSeconds = Number.parseInt(process.env.MESSAGE_RATE_HOURLY_WINDOW_SECONDS ?? "3600", 10);
const wsConnectLimit = Number.parseInt(process.env.WS_CONNECT_LIMIT ?? "30", 10);
const wsConnectWindowSeconds = Number.parseInt(process.env.WS_CONNECT_WINDOW_SECONDS ?? "60", 10);
const trustProxyHops = Number.parseInt(process.env.TRUST_PROXY_HOPS ?? "0", 10);

const posthogKey = process.env.POSTHOG_API_KEY ?? process.env.NEXT_PUBLIC_POSTHOG_KEY ?? "";
const posthogHost =
  process.env.POSTHOG_HOST ?? process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com";
const posthog = posthogKey
  ? new PostHog(posthogKey, { host: posthogHost, flushAt: 1, flushInterval: 0 })
  : null;

function captureEvent(event, distinctId, properties) {
  if (!posthog) return;
  try {
    posthog.capture({ distinctId: distinctId || "anonymous", event, properties });
  } catch {
    // Analytics must never break the socket path.
  }
}

const app = next({ dev });
const handle = app.getRequestHandler();

const redis = createClient({ url: redisUrl });
redis.on("error", (error) => {
  console.error("Redis error:", error);
});

const roomClients = new Map();

function roomKey(roomId) {
  return `room:${roomId}`;
}

function messagesKey(roomId) {
  return `room:${roomId}:messages`;
}

function getRequestIp(request) {
  // Only trust client-supplied forwarding headers when a trusted proxy is
  // configured; the client IP added by our own proxy is the Nth entry from the
  // right of X-Forwarded-For (see TRUST_PROXY_HOPS in src/server/ip.ts).
  if (trustProxyHops > 0) {
    const forwarded = request.headers["x-forwarded-for"];
    if (typeof forwarded === "string" && forwarded.length > 0) {
      const parts = forwarded
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean);
      if (parts.length > 0) {
        const clientIp = parts[Math.max(0, parts.length - trustProxyHops)];
        if (clientIp) return clientIp;
      }
    }

    const realIp = request.headers["x-real-ip"] ?? request.headers["cf-connecting-ip"];
    if (typeof realIp === "string" && realIp.length > 0) {
      return realIp.trim();
    }
  }

  return request.socket?.remoteAddress ?? "unknown";
}

async function rateLimit(key, limit, windowSeconds) {
  if (limit <= 0 || windowSeconds <= 0) {
    return { allowed: true };
  }

  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, windowSeconds);
  }

  return { allowed: count <= limit };
}

async function loadRoom(roomId) {
  const raw = await redis.get(roomKey(roomId));
  return raw ? JSON.parse(raw) : null;
}

async function loadMessages(roomId) {
  const entries = await redis.lRange(messagesKey(roomId), 0, -1);
  return entries.map((entry) => JSON.parse(entry));
}

async function storeMessage(roomId, message) {
  const exists = await redis.exists(roomKey(roomId));
  if (!exists) return false;

  const pipeline = redis.multi();
  pipeline.rPush(messagesKey(roomId), JSON.stringify(message));
  pipeline.lTrim(messagesKey(roomId), -messageLimit, -1);
  pipeline.expire(messagesKey(roomId), roomTtlSeconds);
  pipeline.expire(roomKey(roomId), roomTtlSeconds);
  await pipeline.exec();
  return true;
}

function broadcast(roomId, payload) {
  const clients = roomClients.get(roomId);
  if (!clients) return;
  const data = JSON.stringify(payload);
  for (const client of clients) {
    if (client.readyState === 1) {
      client.send(data);
    }
  }
}

function attachClient(roomId, socket) {
  if (!roomClients.has(roomId)) {
    roomClients.set(roomId, new Set());
  }
  roomClients.get(roomId).add(socket);
}

function detachClient(roomId, socket) {
  const clients = roomClients.get(roomId);
  if (!clients) return;
  clients.delete(socket);
  if (clients.size === 0) {
    roomClients.delete(roomId);
  }
}

await app.prepare();
await redis.connect();

const server = createServer((req, res) => {
  // Stamp the real socket peer address as a trusted header, overwriting any
  // client-supplied value, so the HTTP API (which only sees a reconstructed web
  // Request without socket access) can attribute requests to an IP. See
  // getRequestIp in src/server/ip.ts.
  const peer = req.socket?.remoteAddress;
  if (peer) {
    req.headers["x-chatfn-remote-addr"] = peer;
  } else {
    delete req.headers["x-chatfn-remote-addr"];
  }
  handle(req, res);
});

const wss = new WebSocketServer({ noServer: true });

wss.on("connection", async (socket, request) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
  const roomId = url.searchParams.get("roomId");
  const username = url.searchParams.get("username")?.trim() ?? "";
  const ip = getRequestIp(request);

  if (!roomId || !username) {
    socket.send(JSON.stringify({ type: "error", error: "Missing roomId or username." }));
    socket.close();
    return;
  }

  const room = await loadRoom(roomId);
  if (!room) {
    socket.send(JSON.stringify({ type: "error", error: "Room not found." }));
    socket.close();
    return;
  }

  attachClient(roomId, socket);

  const history = await loadMessages(roomId);
  socket.send(JSON.stringify({ type: "history", messages: history }));

  socket.on("message", async (data) => {
    let payload;
    try {
      payload = JSON.parse(data.toString());
    } catch {
      socket.send(JSON.stringify({ type: "error", error: "Invalid message payload." }));
      return;
    }

    // Share the same Redis keys as the HTTP POST route so a client cannot get a
    // second budget by switching transports.
    const perWindow = await rateLimit(`ratelimit:messages:${ip}`, wsMessageLimit, wsMessageWindowSeconds);
    const hourly = perWindow.allowed
      ? await rateLimit(
          `ratelimit:messages:${ip}:${roomId}:hourly`,
          wsMessageHourlyLimit,
          wsMessageHourlyWindowSeconds,
        )
      : { allowed: false };
    if (!perWindow.allowed || !hourly.allowed) {
      captureEvent("rate_limit_exceeded", ip, {
        route: perWindow.allowed ? "ws_message_hourly" : "ws_message",
        room_id: roomId,
      });
      socket.send(JSON.stringify({ type: "error", error: "Too many messages. Please slow down." }));
      return;
    }

    const text = typeof payload?.text === "string" ? payload.text.trim() : "";
    const user = typeof payload?.user === "string" ? payload.user.trim() : "";
    if (!text || !user) {
      socket.send(JSON.stringify({ type: "error", error: "Message text and user are required." }));
      return;
    }

    const message = {
      id: randomUUID(),
      user: user.slice(0, 32),
      text: text.slice(0, 500),
      createdAt: Date.now(),
    };

    const stored = await storeMessage(roomId, message);
    if (!stored) {
      socket.send(JSON.stringify({ type: "error", error: "Room not found." }));
      return;
    }

    broadcast(roomId, { type: "message", message });
  });

  socket.on("close", () => {
    detachClient(roomId, socket);
  });
});

server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
  if (url.pathname !== "/ws") {
    socket.destroy();
    return;
  }

  const ip = getRequestIp(request);
  void (async () => {
    const limited = await rateLimit(`ratelimit:ws:connect:${ip}`, wsConnectLimit, wsConnectWindowSeconds);
    if (!limited.allowed) {
      captureEvent("rate_limit_exceeded", ip, {
        route: "ws_connect",
        limit: wsConnectLimit,
        window_seconds: wsConnectWindowSeconds,
      });
      socket.write(
        `HTTP/1.1 429 Too Many Requests\r\nRetry-After: ${wsConnectWindowSeconds}\r\nConnection: close\r\n\r\n`,
      );
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (client) => {
      wss.emit("connection", client, request);
    });
  })();
});

server.listen(port, () => {
  console.log(`> Ready on http://localhost:${port}`);
});
