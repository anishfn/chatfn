import { createServer } from "http";
import { randomUUID } from "crypto";
import { WebSocketServer } from "ws";
import { createClient } from "redis";
import next from "next";

const dev = process.env.NODE_ENV !== "production";
const port = Number.parseInt(process.env.PORT ?? "3000", 10);

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
const roomTtlSeconds = Number.parseInt(process.env.ROOM_TTL_SECONDS ?? "86400", 10);
const messageLimit = Number.parseInt(process.env.MESSAGE_LIMIT ?? "200", 10);
const wsMessageLimit = Number.parseInt(process.env.MESSAGE_RATE_LIMIT ?? "20", 10);
const wsMessageWindowSeconds = Number.parseInt(process.env.MESSAGE_RATE_WINDOW_SECONDS ?? "10", 10);

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
  const forwarded = request.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }

  const realIp = request.headers["x-real-ip"] ?? request.headers["cf-connecting-ip"];
  if (typeof realIp === "string" && realIp.length > 0) {
    return realIp.trim();
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

    const limited = await rateLimit(
      `ratelimit:ws:messages:${ip}:${roomId}`,
      wsMessageLimit,
      wsMessageWindowSeconds,
    );
    if (!limited.allowed) {
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

  wss.handleUpgrade(request, socket, head, (client) => {
    wss.emit("connection", client, request);
  });
});

server.listen(port, () => {
  console.log(`> Ready on http://localhost:${port}`);
});
