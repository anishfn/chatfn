import { Elysia, t } from "elysia";
import { addMessage, createRoom, getRoom, listMessages } from "@/lib/rooms";
import { randomUUID } from "crypto";

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
    async ({ body, set }) => {
      const username = body.username.trim();
      if (!username) {
        set.status = 400;
        return { error: "Username is required." };
      }

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
    const room = await getRoom(params.roomId);
    if (!room) {
      set.status = 404;
      return { error: "Room not found." };
    }

    const messages = await listMessages(params.roomId);
    return { messages };
  })
  .post(
    "/rooms/:roomId/messages",
    async ({ params, body, set }) => {
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
