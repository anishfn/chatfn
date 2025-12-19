import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function RoomNotFound() {
  return (
    <div className="min-h-screen bg-background">
      <main className="mx-auto flex min-h-screen w-full max-w-lg flex-col items-center justify-center gap-4 px-4 py-10 text-center">
        <div className="space-y-2">
          <h1 className="text-lg font-semibold">Room not found</h1>
          <p className="text-sm text-foreground/60">This invite link has expired or the room was deleted.</p>
        </div>
        <Button asChild>
          <Link href="/room">Back to lobby</Link>
        </Button>
      </main>
    </div>
  );
}
