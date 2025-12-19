# chatfn

Private chatrooms with Redis-backed storage and expiring rooms.

## Features

- Create a room and share a short invite code or URL.
- Join by pasting a full link or the room code.
- Messages are stored in Redis and automatically trimmed.
- Live chat uses WebSockets for real-time updates.
- API routes are powered by Elysia and mounted under Next.js.
- Rooms expire automatically based on TTL.

## Requirements

- Node.js 20+
- pnpm (or npm/yarn)
- Redis 7+

## Quick Start (local)

1. Install dependencies:

```bash
pnpm install
```

2. Start Redis (Docker example):

```bash
docker run --name chatfn-redis -p 6379:6379 -d redis:7
```

3. Add environment variables:

Create `.env.local` in the project root:

```bash
REDIS_URL=redis://localhost:6379
ROOM_TTL_SECONDS=86400
MESSAGE_LIMIT=200
```

4. Run the app:

```bash
pnpm dev
```

Open http://localhost:3000

## Production (self-hosted)

1. Build and start:

```bash
pnpm build
pnpm start
```

2. Set environment variables on your host:

- `REDIS_URL`: Redis connection string.
- `ROOM_TTL_SECONDS`: Room and message TTL in seconds.
- `MESSAGE_LIMIT`: Max number of messages stored per room.
- `PORT`: Server port (default 3000).

## Usage

- Visit `/room` to create or join a room.
- Share the invite button from inside the room.
- Messages expire with the room TTL (default 24 hours).

## API (Elysia)

The Elysia app is mounted at `/api` via a catch-all Next.js route.

- `POST /api/rooms` → `{ roomId }`
- `GET /api/rooms/:roomId` → `{ room }`
- `GET /api/rooms/:roomId/messages` → `{ messages }`
- `POST /api/rooms/:roomId/messages` → `{ message }`

## Notes

- Usernames are stored in localStorage on the client.
- Rooms without activity are removed automatically by Redis TTL.
