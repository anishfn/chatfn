"use client";

import { Button } from "@/components/ui/button";
import { Check, Copy, Link2, Loader2, Plus } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useMemo, useState, useEffect } from "react";
import { useRouter } from "next/navigation";

const STORAGE_KEY = "chatfn:username";

export default function RoomLobby() {
  const router = useRouter();
  const [mode, setMode] = useState<"create" | "join">("create");
  const [username, setUsername] = useState("username-here-anishfn");
  const [invite, setInvite] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      setUsername(stored);
      return;
    }

    // Keep an identity available even before the first room is created.
    const generated = `guest-${crypto.randomUUID().slice(0, 6)}`;
    localStorage.setItem(STORAGE_KEY, generated);
    setUsername(generated);
  }, []);

  const parsedCode = useMemo(() => {
    const trimmed = invite.trim();
    if (!trimmed) return "";

    // Allow pasting full invites or raw codes.
    try {
      const url = new URL(trimmed);
      const parts = url.pathname.split("/").filter(Boolean);
      return parts[parts.length - 1] ?? trimmed;
    } catch {
      return trimmed;
    }
  }, [invite]);

  async function handleCreate() {
    if (!username.trim()) return;
    setBusy(true);
    setError(null);

    try {
      const response = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error ?? "Unable to create room.");
      }

      const payload = (await response.json()) as { roomId: string };
      router.push(`/room/${payload.roomId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create room.");
    } finally {
      setBusy(false);
    }
  }

  async function handleJoin() {
    if (!parsedCode || !username.trim()) return;
    setBusy(true);
    setError(null);

    try {
      const response = await fetch(`/api/rooms/${parsedCode}`, { cache: "no-store" });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error ?? "Room not found.");
      }

      router.push(`/room/${parsedCode}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to join room.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar mode={mode} setMode={setMode} />

      <main className="mx-auto flex w-full max-w-lg flex-1 flex-col px-4 py-12 sm:px-6">
        <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: "easeOut" }} className="space-y-6">
          <header className="space-y-2">
            <h1 className="text-2xl font-semibold sm:text-3xl">chatfn</h1>
            <p className="text-sm text-foreground/60">Private rooms that disappear when you are done.</p>
          </header>

          <IdentityCard username={username} mode={mode} invite={invite} onInviteChange={setInvite} parsedCode={parsedCode} onCreate={handleCreate} onJoin={handleJoin} busy={busy} error={error} />
        </motion.section>
      </main>
    </div>
  );
}

function Navbar({ mode, setMode }: { mode: "create" | "join"; setMode: (m: "create" | "join") => void }) {
  return (
    <header className="sticky top-0 z-10 w-full border-b bg-background/80 backdrop-blur">
      <div className="mx-auto flex w-full max-w-lg items-center justify-end gap-3 px-4 py-3 sm:px-6">
        <ModeToggle mode={mode} setMode={setMode} />
      </div>
    </header>
  );
}

function ModeToggle({ mode, setMode }: { mode: "create" | "join"; setMode: (m: "create" | "join") => void }) {
  return (
    <div className="w-[220px] sm:w-[260px]">
      <div className="relative border bg-accent/20 p-1">
        <motion.div
          className="absolute top-1 bottom-1 w-[calc(50%-0.25rem)] border bg-background"
          animate={{ left: mode === "create" ? "0.25rem" : "calc(50% + 0.1rem)" }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          aria-hidden="true"
        />

        <div className="relative grid grid-cols-2">
          <SegmentButton active={mode === "create"} onClick={() => setMode("create")} icon={<Plus className="size-4" />} label="Create" />
          <SegmentButton active={mode === "join"} onClick={() => setMode("join")} icon={<Link2 className="size-4" />} label="Join" />
        </div>
      </div>
    </div>
  );
}

function SegmentButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button type="button" onClick={onClick} className={["flex items-center justify-center gap-2 py-2 text-sm transition-colors cursor-pointer", active ? "text-foreground" : "text-foreground/70 hover:text-foreground"].join(" ")}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

function IdentityCard({
  username,
  mode,
  invite,
  onInviteChange,
  parsedCode,
  onCreate,
  onJoin,
  busy,
  error,
}: {
  username: string;
  mode: "create" | "join";
  invite: string;
  onInviteChange: (value: string) => void;
  parsedCode: string;
  onCreate: () => void;
  onJoin: () => void;
  busy: boolean;
  error: string | null;
}) {
  return (
    <section className="w-full space-y-4">
      <div className="space-y-2">
        <h2 className="text-xs uppercase tracking-[0.2em] text-foreground/50">Identity</h2>
        <UsernameRow username={username} />
      </div>

      <AnimatePresence mode="wait">
        {mode === "create" ? (
          <motion.div key="create" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}>
            <CreateRoomPanel onCreate={onCreate} disabled={!username.trim() || busy} busy={busy} />
          </motion.div>
        ) : (
          <motion.div key="join" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}>
            <JoinRoomCard invite={invite} onInviteChange={onInviteChange} parsedCode={parsedCode} onJoin={onJoin} disabled={!username.trim() || !parsedCode || busy} busy={busy} />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {error ? (
          <motion.p key="error" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </motion.p>
        ) : null}
      </AnimatePresence>
    </section>
  );
}

function UsernameRow({ username }: { username: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(username);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="overflow-hidden border bg-background">
      <div className="flex items-center justify-between">
        <span className="min-w-0 truncate px-4 py-2 text-sm">{username}</span>

        <Button className="h-10 border-l" variant="ghost" size="icon-lg" onClick={handleCopy} aria-label="Copy username">
          {copied ? <Check className="size-4" /> : <Copy className="size-3" />}
        </Button>
      </div>
    </div>
  );
}

function CreateRoomPanel({ onCreate, disabled, busy }: { onCreate: () => void; disabled: boolean; busy: boolean }) {
  return (
    <div className="space-y-2">
      <Button className="w-full" onClick={onCreate} disabled={disabled}>
        {busy ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            Creating room
          </>
        ) : (
          "Create Room"
        )}
      </Button>
      <p className="text-xs text-foreground/50">Creates a new room and generates an invite code.</p>
    </div>
  );
}

function JoinRoomCard({
  invite,
  onInviteChange,
  parsedCode,
  onJoin,
  disabled,
  busy,
}: {
  invite: string;
  onInviteChange: (value: string) => void;
  parsedCode: string;
  onJoin: () => void;
  disabled: boolean;
  busy: boolean;
}) {
  return (
    <div className="space-y-2">
      <div className="overflow-hidden border bg-background">
        <input value={invite} onChange={(e) => onInviteChange(e.target.value)} placeholder="Paste invite link or enter code" className="w-full bg-transparent px-4 py-2 text-sm outline-none" autoComplete="off" spellCheck={false} />
      </div>

      <Button className="w-full" disabled={disabled} onClick={onJoin}>
        {busy ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            Joining room
          </>
        ) : (
          "Join Room"
        )}
      </Button>

      <div className="text-xs text-foreground/50">
        {parsedCode ? (
          <span>
            Code detected: <span className="font-medium text-foreground">{parsedCode}</span>
          </span>
        ) : (
          <span>Tip: paste a full link — we will grab the code for you.</span>
        )}
      </div>
    </div>
  );
}
