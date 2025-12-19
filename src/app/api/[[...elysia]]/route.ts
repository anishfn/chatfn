import { app } from "@/server/elysia";

export const runtime = "nodejs";

async function withApiBase(request: Request) {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api")) {
    url.pathname = url.pathname.slice(4) || "/";
  }

  const init: RequestInit = {
    method: request.method,
    headers: request.headers,
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = await request.arrayBuffer();
    init.duplex = "half";
  }

  return new Request(url, init);
}

export async function GET(request: Request) {
  return app.handle(await withApiBase(request));
}

export async function POST(request: Request) {
  return app.handle(await withApiBase(request));
}

export async function PUT(request: Request) {
  return app.handle(await withApiBase(request));
}

export async function PATCH(request: Request) {
  return app.handle(await withApiBase(request));
}

export async function DELETE(request: Request) {
  return app.handle(await withApiBase(request));
}
