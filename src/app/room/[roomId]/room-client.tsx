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

const STORAGE_KEY = "chatfn:username";

export default function RoomClient({ roomId }: { roomId: string }) {
  const [username, setUsername] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messageText, setMessageText] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const socketRef = useRef<WebSocket | null>(null);

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
    if (!username) return;

    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const socket = new WebSocket(`${protocol}://${window.location.host}/ws?roomId=${encodeURIComponent(roomId)}&username=${encodeURIComponent(username)}`);
    socketRef.current = socket;

    socket.onmessage = (event) => {
      let payload: { type?: string; messages?: ChatMessage[]; message?: ChatMessage; error?: string };
      try {
        payload = JSON.parse(event.data as string);
      } catch {
        setError("Invalid server response.");
        return;
      }

      if (payload.type === "history" && payload.messages) {
        setMessages(payload.messages);
        setLoading(false);
        setError(null);
        return;
      }

      if (payload.type === "message" && payload.message) {
        setMessages((prev) => [...prev, payload.message as ChatMessage]);
        setError(null);
        return;
      }

      if (payload.type === "error" && payload.error) {
        setError(payload.error);
        setLoading(false);
      }
    };

    socket.onerror = () => {
      setError("Connection error.");
      setLoading(false);
    };

    socket.onclose = () => {
      socketRef.current = null;
      setLoading(false);
    };

    return () => {
      socket.close();
    };
  }, [roomId, username]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: <>
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const canSend = Boolean(messageText.trim()) && Boolean(username.trim()) && !sending;

  async function handleSend() {
    if (!canSend) return;
    setSending(true);
    setError(null);

    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setError("Connection lost. Refresh to reconnect.");
      setSending(false);
      return;
    }

    socket.send(JSON.stringify({ user: username, text: messageText }));
    setMessageText("");
    setSending(false);
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
          <div className="text-xs text-foreground/60">
            Signed in as <span className="font-medium text-foreground">{username || "..."}</span>
          </div>
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
