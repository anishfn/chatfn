import { randomUUID } from "crypto";
import { getRedis } from "@/lib/redis";

const ROOM_TTL_SECONDS = Number.parseInt(process.env.ROOM_TTL_SECONDS ?? "86400", 10);
const MESSAGE_LIMIT = Number.parseInt(process.env.MESSAGE_LIMIT ?? "200", 10);

export type ChatRoom = {
  id: string;
  createdAt: number;
  createdBy: string;
};

export type ChatMessage = {
  id: string;
  user: string;
  text: string;
  createdAt: number;
};

export type RoomMeta = {
  ttlSeconds: number | null;
  messageLimit: number;
  messagesRemaining: number;
};

function roomKey(roomId: string) {
  return `room:${roomId}`;
}

function messagesKey(roomId: string) {
  return `room:${roomId}:messages`;
}

function generateRoomId() {
  return randomUUID().replace(/-/g, "").slice(0, 8);
}

export async function createRoom(createdBy: string) {
  const redis = await getRedis();

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const roomId = generateRoomId();
    const payload: ChatRoom = {
      id: roomId,
      createdAt: Date.now(),
      createdBy,
    };

    const result = await redis.set(roomKey(roomId), JSON.stringify(payload), {
      nx: true,
      ex: ROOM_TTL_SECONDS,
    });

    if (result) {
      return payload;
    }
  }

  throw new Error("Failed to create a unique room id");
}

export async function getRoom(roomId: string) {
  const redis = await getRedis();
  const raw = await redis.get<string>(roomKey(roomId));
  if (!raw) return null;
  if (typeof raw === "string") {
    return JSON.parse(raw) as ChatRoom;
  }
  return raw as ChatRoom;
}

export async function getRoomWithMessages(roomId: string) {
  const redis = await getRedis();
  const pipeline = redis.pipeline();
  pipeline.get<string>(roomKey(roomId));
  pipeline.lrange<string>(messagesKey(roomId), 0, -1);
  pipeline.ttl(roomKey(roomId));
  const [roomRaw, entriesRaw, ttlRaw] = await pipeline.exec();
  if (!roomRaw) return null;

  const room = typeof roomRaw === "string" ? (JSON.parse(roomRaw) as ChatRoom) : (roomRaw as ChatRoom);
  const entries = Array.isArray(entriesRaw) ? entriesRaw : [];
  const messages = entries.map((entry) => {
    if (typeof entry === "string") {
      return JSON.parse(entry) as ChatMessage;
    }
    return entry as ChatMessage;
  });

  const ttlSeconds = typeof ttlRaw === "number" && ttlRaw > 0 ? ttlRaw : null;
  const messagesRemaining = Math.max(0, MESSAGE_LIMIT - messages.length);

  const meta: RoomMeta = {
    ttlSeconds,
    messageLimit: MESSAGE_LIMIT,
    messagesRemaining,
  };

  return { room, messages, meta };
}

export async function addMessage(roomId: string, message: ChatMessage) {
  const redis = await getRedis();
  const stored = await redis.eval(
    `
    if redis.call("EXISTS", KEYS[1]) == 0 then
      return 0
    end
    redis.call("RPUSH", KEYS[2], ARGV[1])
    redis.call("LTRIM", KEYS[2], -tonumber(ARGV[2]), -1)
    redis.call("EXPIRE", KEYS[2], tonumber(ARGV[3]))
    redis.call("EXPIRE", KEYS[1], tonumber(ARGV[3]))
    return 1
    `,
    [roomKey(roomId), messagesKey(roomId)],
    [JSON.stringify(message), MESSAGE_LIMIT, ROOM_TTL_SECONDS],
  );
  return Number(stored) === 1;
}
