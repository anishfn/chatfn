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
      NX: true,
      EX: ROOM_TTL_SECONDS,
    });

    if (result) {
      await redis.expire(messagesKey(roomId), ROOM_TTL_SECONDS);
      return payload;
    }
  }

  throw new Error("Failed to create a unique room id");
}

export async function getRoom(roomId: string) {
  const redis = await getRedis();
  const raw = await redis.get(roomKey(roomId));
  if (!raw) return null;
  return JSON.parse(raw) as ChatRoom;
}

export async function listMessages(roomId: string) {
  const redis = await getRedis();
  const entries = await redis.lRange(messagesKey(roomId), 0, -1);
  return entries.map((entry) => JSON.parse(entry) as ChatMessage);
}

export async function addMessage(roomId: string, message: ChatMessage) {
  const redis = await getRedis();
  const exists = await redis.exists(roomKey(roomId));
  if (!exists) return false;

  const pipeline = redis.multi();
  pipeline.rPush(messagesKey(roomId), JSON.stringify(message));
  pipeline.lTrim(messagesKey(roomId), -MESSAGE_LIMIT, -1);
  pipeline.expire(messagesKey(roomId), ROOM_TTL_SECONDS);
  pipeline.expire(roomKey(roomId), ROOM_TTL_SECONDS);
  await pipeline.exec();
  return true;
}
