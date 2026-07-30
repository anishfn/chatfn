import { PostHog } from "posthog-node";

const globalForPosthog = globalThis as typeof globalThis & {
  posthogClient?: PostHog | null;
};

function resolveClient(): PostHog | null {
  if (globalForPosthog.posthogClient !== undefined) {
    return globalForPosthog.posthogClient;
  }

  const key = process.env.POSTHOG_API_KEY ?? process.env.NEXT_PUBLIC_POSTHOG_KEY ?? "";
  if (!key) {
    globalForPosthog.posthogClient = null;
    return null;
  }

  const host =
    process.env.POSTHOG_HOST ?? process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com";

  // flushAt/flushInterval of 1/0 send each event immediately, which suits the
  // serverless API route where the process may freeze right after the response.
  globalForPosthog.posthogClient = new PostHog(key, {
    host,
    flushAt: 1,
    flushInterval: 0,
  });
  return globalForPosthog.posthogClient;
}

export async function captureServer(
  event: string,
  distinctId: string,
  properties?: Record<string, unknown>,
): Promise<void> {
  const client = resolveClient();
  if (!client) return;

  try {
    client.capture({ distinctId: distinctId || "anonymous", event, properties });
    await client.flush();
  } catch {
    // Analytics must never break request handling.
  }
}
