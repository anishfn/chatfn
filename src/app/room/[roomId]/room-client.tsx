"use client";

import { Button } from "@/components/ui/button";
import { Check, Copy, Loader2, Send } from "lucide-react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";

type ChatMessage = {
  id: string;
  user: string;
  text: string;
  createdAt: number;
};

type RoomMeta = {
  ttlSeconds: number | null;
  messageLimit: number;
  messagesRemaining: number;
};

const STORAGE_KEY = "chatfn:username";

export default function RoomClient({ roomId }: { roomId: string }) {
  const [username, setUsername] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messageText, setMessageText] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [roomMeta, setRoomMeta] = useState<RoomMeta | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const pollRef = useRef<number | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      setUsername(stored);
      return;
    }

    const generated = `guest-${crypto.randomUUID().slice(0, 6)}`;
    localStorage.setItem(STORAGE_KEY, generated);
    setUsername(generated);
  }, []);

  useEffect(() => {
    setNameDraft(username);
  }, [username]);

  useEffect(() => {
    if (!username) return;
    let cancelled = false;

    const fetchMessages = async () => {
      try {
        const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/messages`, {
          cache: "no-store",
        });
        const payload = (await response.json()) as { messages?: ChatMessage[]; meta?: RoomMeta; error?: string };
        if (!response.ok) {
          throw new Error(payload?.error ?? "Unable to load messages.");
        }
        if (!cancelled) {
          setMessages(payload.messages ?? []);
          setRoomMeta(payload.meta ?? null);
          setLoading(false);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Unable to load messages.");
          setLoading(false);
        }
      }
    };

    void fetchMessages();
    pollRef.current = window.setInterval(fetchMessages, 2000);

    return () => {
      cancelled = true;
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [roomId, username]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: <>
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const canSend = Boolean(messageText.trim()) && Boolean(username.trim()) && !sending;

  function updateUsername(next: string) {
    const trimmed = next.trim().slice(0, 32);
    if (!trimmed) return;
    localStorage.setItem(STORAGE_KEY, trimmed);
    setUsername(trimmed);
  }

  async function handleSend() {
    if (!canSend) return;
    setSending(true);
    setError(null);

    try {
      const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, text: messageText }),
      });
      const payload = (await response.json()) as { message?: ChatMessage; error?: string };
      if (!response.ok) {
        throw new Error(payload?.error ?? "Unable to send message.");
      }
      if (payload.message) {
        setMessages((prev) => [...prev, payload.message as ChatMessage]);
        setRoomMeta((prev) => {
          if (!prev) return prev;
          const nextRemaining = Math.max(0, prev.messagesRemaining - 1);
          return { ...prev, messagesRemaining: nextRemaining };
        });
      }
      setMessageText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to send message.");
    } finally {
      setSending(false);
    }
  }

  async function handleCopyInvite() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  const formattedMessages = useMemo(
    () =>
      messages.map((message) => ({
        ...message,
        timestamp: new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      })),
    [messages]
  );

  const roomStatus = useMemo(() => {
    if (!roomMeta) return null;
    const { ttlSeconds, messageLimit, messagesRemaining } = roomMeta;
    const usedMessages = Math.max(0, messageLimit - messagesRemaining);

    let ttlLabel = "Room expires soon";
    if (ttlSeconds && ttlSeconds > 0) {
      const hours = Math.floor(ttlSeconds / 3600);
      const minutes = Math.floor((ttlSeconds % 3600) / 60);
      const parts: string[] = [];
      if (hours > 0) parts.push(`${hours}h`);
      if (minutes > 0 || parts.length === 0) parts.push(`${minutes}m`);
      ttlLabel = `Room expires in ${parts.join(" ")}`;
    }

    return {
      ttlLabel,
      messageLabel: `${messagesRemaining} left • ${usedMessages}/${messageLimit} used`,
    };
  }, [roomMeta]);

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 w-full border-b bg-background/80 backdrop-blur">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <Link href="/room" className="text-xs uppercase tracking-wide text-foreground/60 hover:text-foreground">
              Lobby
            </Link>
            <div className="text-xs uppercase tracking-wide text-foreground/40">Room</div>
            <div className="truncate text-sm font-semibold">{roomId}</div>
          </div>

          <Button size="sm" variant="outline" onClick={handleCopyInvite}>
            {copied ? (
              <>
                <Check className="size-4" />
                Copied
              </>
            ) : (
              <>
                <Copy className="size-4" />
                Copy invite
              </>
            )}
          </Button>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-4 py-6 sm:px-6 sm:py-10">
        <motion.section initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: "easeOut" }} className="space-y-1">
          <h1 className="text-lg font-semibold">Chatroom</h1>
          <div className="flex flex-wrap items-center gap-2 text-xs text-foreground/60">
            <span>
              Signed in as <span className="font-medium text-foreground">{username || "..."}</span>
            </span>
            {editingName ? (
              <>
                <input
                  value={nameDraft}
                  onChange={(event) => setNameDraft(event.target.value)}
                  className="h-8 w-40 border bg-background px-2 text-xs text-foreground outline-none"
                  maxLength={32}
                  placeholder="New nickname"
                  autoComplete="off"
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    updateUsername(nameDraft);
                    setEditingName(false);
                  }}
                >
                  Save
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setNameDraft(username);
                    setEditingName(false);
                  }}
                >
                  Cancel
                </Button>
              </>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => setEditingName(true)}>
                Edit nickname
              </Button>
            )}
          </div>
          {roomStatus ? (
            <div className="flex flex-wrap items-center gap-3 text-xs text-foreground/60">
              <span>{roomStatus.ttlLabel}</span>
              <span className="text-foreground/40">•</span>
              <span>{roomStatus.messageLabel}</span>
            </div>
          ) : null}
        </motion.section>

        <section className="border bg-background">
          <div className="max-h-[55vh] min-h-[45vh] overflow-y-auto px-4 py-4 sm:px-5">
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-foreground/60">
                <Loader2 className="size-4 animate-spin" />
                Loading messages
              </div>
            ) : formattedMessages.length === 0 ? (
              <div className="text-sm text-foreground/60">No messages yet. Start the conversation.</div>
            ) : (
              <div className="flex flex-col gap-3">
                <AnimatePresence initial={false}>
                  {formattedMessages.map((message) => {
                    const isSelf = message.user === username;
                    return (
                      <motion.div key={message.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }} className={["max-w-[80%] border px-3 py-2 text-sm", isSelf ? "ml-auto bg-accent/30" : "mr-auto bg-accent/10"].join(" ")}>
                        <div className="flex items-center justify-between gap-3 text-[11px] text-foreground/60">
                          <span className="truncate">{message.user}</span>
                          <span>{message.timestamp}</span>
                        </div>
                        <p className="mt-1 whitespace-pre-wrap text-foreground">{message.text}</p>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
                <div ref={bottomRef} />
              </div>
            )}
          </div>

          <div className="border-t bg-accent/10 px-4 py-3 sm:px-5">
            <div className="space-y-2">
              <textarea
                value={messageText}
                onChange={(event) => setMessageText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void handleSend();
                  }
                }}
                placeholder="Write a message..."
                className="min-h-[70px] w-full resize-none bg-transparent text-sm outline-none"
              />

              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-foreground/50">Enter to send, Shift + Enter for a new line.</p>
                <Button onClick={handleSend} disabled={!canSend}>
                  {sending ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      Sending
                    </>
                  ) : (
                    <>
                      <Send className="size-4" />
                      Send
                    </>
                  )}
                </Button>
              </div>

              <AnimatePresence>
                {error ? (
                  <motion.p key="error" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                    {error}
                  </motion.p>
                ) : null}
              </AnimatePresence>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
