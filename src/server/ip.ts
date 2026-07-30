// Number of trusted reverse proxies in front of the app. Each proxy appends
// the address it received the connection from to `X-Forwarded-For`, so the
// client IP added by our own (trusted) proxy is the Nth entry counted from the
// right — a client can prepend spoofed entries but cannot control the ones our
// proxies add. `0` (the default) means we are not behind a trusted proxy, so
// client-supplied forwarding headers must not be trusted at all.
const TRUST_PROXY_HOPS = Number.parseInt(process.env.TRUST_PROXY_HOPS ?? "0", 10);

function clientFromForwarded(forwarded: string | null): string | null {
  if (!forwarded) return null;
  const parts = forwarded
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  const index = Math.max(0, parts.length - TRUST_PROXY_HOPS);
  return parts[index] ?? null;
}

export function getRequestIp(request: Request): string {
  if (TRUST_PROXY_HOPS > 0) {
    const fromForwarded = clientFromForwarded(request.headers.get("x-forwarded-for"));
    if (fromForwarded) return fromForwarded;

    const direct =
      request.headers.get("x-real-ip") ??
      request.headers.get("cf-connecting-ip") ??
      request.headers.get("x-client-ip");
    if (direct) return direct.trim();
  }

  // Stamped by the custom server (server.mjs) from the real socket peer address
  // and overwritten on every request, so — unlike X-Forwarded-For — it cannot
  // be spoofed by the client. Behind a proxy this is the proxy's address (use
  // TRUST_PROXY_HOPS above); direct/local it is the real client IP.
  const peer = request.headers.get("x-chatfn-remote-addr");
  if (peer) return peer.trim();

  return "unknown";
}
