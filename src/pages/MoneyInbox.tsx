import { useLayoutEffect, useRef, useState } from "react";
import { Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { usePageTitle } from "@/hooks/usePageTitle";
import { isSamEmail } from "@/lib/samOnly";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// This live table has not reached the generated database types yet.
const db = supabase as unknown as SupabaseClient;

interface Thread {
  id: string;
  handle: string | null;
  display_name: string | null;
  is_group: boolean;
  category: string | null;
  money_score: number;
  money_reasons: string[];
  rank: number | null;
  awaiting_reply: boolean;
  last_inbound_at: string | null;
  last_inbound_text: string | null;
  excerpt: { t: string; from: "me" | "them"; text: string }[];
  draft_reply: string | null;
  final_reply: string | null;
  status: "pending" | "approved" | "sending" | "sent" | "failed" | "skipped";
  sent_at: string | null;
  send_receipt: string | null;
  send_error: string | null;
  updated_at: string;
}

type ThreadUpdate = {
  final_reply?: string;
  status?: "approved" | "skipped";
  approved_at?: string;
  muted?: boolean;
};

function timeLabel(value: string): string {
  return new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function ThreadCard({ row, refresh }: { row: Thread; refresh: () => Promise<unknown> }) {
  const [showThread, setShowThread] = useState(false);
  const [edit, setEdit] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const actionInFlight = useRef(false);
  const reply = edit ?? row.final_reply ?? row.draft_reply ?? "";
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const resize = () => {
      textarea.style.height = "auto";
      textarea.style.height = `${textarea.scrollHeight}px`;
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(textarea);
    return () => observer.disconnect();
  }, [reply]);
  const editable = row.status === "pending" || row.status === "failed";
  const waitingHours = row.last_inbound_at
    ? Math.max(0, (Date.now() - new Date(row.last_inbound_at).getTime()) / 3_600_000)
    : null;

  async function update(patch: ThreadUpdate) {
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      // A stale tab must not re-approve a send already claimed by the daemon.
      const { data, error: updateError } = await db.from("money_inbox_threads")
        .update(patch).eq("id", row.id).eq("status", row.status)
        .eq("updated_at", row.updated_at).select("id");
      if (updateError) throw updateError;
      if (!data?.length) throw new Error("This thread changed. Review the refreshed thread and try again.");
      setEdit(null);
    } catch (cause) {
      console.warn("Money Inbox update failed", cause);
      setError(cause instanceof Error ? cause.message : "Could not update this thread. Please try again.");
    } finally {
      await refresh();
      actionInFlight.current = false;
      setBusy(false);
    }
  }

  async function copyReply() {
    try {
      await navigator.clipboard.writeText(reply);
      toast.success("Reply copied");
    } catch (cause) {
      console.warn("Money Inbox copy failed", cause);
      setError("Could not copy. Select the reply text and copy it manually.");
    }
  }

  return (
    <Card className="min-w-0 border-primary/20 bg-card">
      <CardContent className="space-y-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge className="bg-primary text-primary-foreground">#{row.rank ?? "—"}</Badge>
          <h2 className="min-w-0 flex-1 break-words text-base font-semibold">
            {row.is_group ? "Group: " : ""}{row.display_name || row.handle || "Unknown contact"}
          </h2>
          <Badge variant="outline" className="capitalize">{row.category ?? "intent"}</Badge>
          <span className="text-sm font-semibold text-primary">Score {row.money_score}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {(row.money_reasons ?? []).map((reason) => (
            <Badge key={reason} variant="secondary" className="max-w-full whitespace-normal break-words">{reason}</Badge>
          ))}
          {row.awaiting_reply && waitingHours !== null && (
            <span className="text-sm text-primary">waiting {waitingHours.toFixed(1)}h</span>
          )}
        </div>
        {row.last_inbound_text && (
          <blockquote className="whitespace-pre-wrap break-words border-l-2 border-primary/60 pl-3 text-sm leading-relaxed">
            {row.last_inbound_text}
          </blockquote>
        )}
        <Button variant="ghost" className="min-h-11 px-0" onClick={() => setShowThread(!showThread)}
          aria-expanded={showThread} aria-controls={`thread-${row.id}`}>
          {showThread ? "Hide thread" : "Show thread"}
        </Button>
        {showThread && (
          <div id={`thread-${row.id}`} className="space-y-3 rounded-lg bg-muted/40 p-3">
            {(row.excerpt ?? []).length === 0 && <p className="text-sm text-muted-foreground">No thread excerpt yet.</p>}
            {(row.excerpt ?? []).map((message, index) => (
              <div key={`${message.t}-${message.from}-${index}`} className={message.from === "me" ? "border-l-2 border-primary pl-3" : "border-l-2 border-border pl-3"}>
                <p className="text-xs text-muted-foreground">{message.from === "me" ? "Me" : "Them"} · {timeLabel(message.t)}</p>
                <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{message.text}</p>
              </div>
            ))}
          </div>
        )}
        <div className="space-y-2">
          <label htmlFor={`reply-${row.id}`} className="text-sm font-medium">Reply</label>
          <Textarea ref={textareaRef} id={`reply-${row.id}`} value={reply} onChange={(event) => setEdit(event.target.value)}
            placeholder="Draft on the way…" readOnly={!editable} disabled={busy}
            className="min-h-32 resize-none overflow-hidden text-base leading-relaxed"
            rows={Math.max(4, reply.split("\n").length)} />
        </div>
        <div aria-live="polite" className="space-y-2 text-sm">
          {row.status === "approved" && <p className="text-primary">Queued — waiting for your Mac.</p>}
          {row.status === "sending" && <p className="text-primary">Sending from your Mac…</p>}
          {row.status === "sent" && (
            <div className="space-y-1">
              <p className="font-medium text-primary">Sent{row.sent_at ? ` · ${timeLabel(row.sent_at)}` : ""}</p>
              {row.send_receipt && <p className="whitespace-pre-wrap break-words text-muted-foreground">{row.send_receipt}</p>}
            </div>
          )}
          {row.status === "skipped" && <p className="text-muted-foreground">Skipped</p>}
          {row.status === "failed" && <p className="whitespace-pre-wrap break-words text-destructive">{row.send_error || "Send failed. Retry when your Mac is available."}</p>}
          {error && <p role="alert" className="text-destructive">{error}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {row.status === "pending" && (
            <Button className="min-h-11 flex-1 bg-primary text-primary-foreground hover:bg-primary/90"
              disabled={busy || !reply.trim()}
              onClick={() => update({ final_reply: reply, status: "approved", approved_at: new Date().toISOString() })}>
              {busy ? "Saving…" : "Approve & send"}
            </Button>
          )}
          {row.status === "failed" && (
            <>
              <Button className="min-h-11" disabled={busy || !reply.trim()}
                onClick={() => update({ final_reply: reply, status: "approved", approved_at: new Date().toISOString() })}>Retry</Button>
              <Button variant="outline" className="min-h-11" disabled={!reply} onClick={copyReply}>Copy text</Button>
            </>
          )}
          {editable && <Button variant="outline" className="min-h-11" disabled={busy} onClick={() => update({ status: "skipped" })}>Skip</Button>}
          <Button variant="ghost" className="min-h-11" disabled={busy} onClick={() => update({ muted: true })}>Not money</Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function MoneyInbox() {
  const { user } = useAuth();
  usePageTitle("Money Inbox");
  const isSam = isSamEmail(user?.email);
  const query = useQuery({
    queryKey: ["money-inbox", user?.id],
    enabled: isSam,
    queryFn: async () => {
      const { data, error } = await db.from("money_inbox_threads").select("*")
        .eq("in_scan", true).eq("muted", false).order("rank", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as Thread[];
    },
    refetchInterval: 30_000,
  });

  if (!isSam) return <Navigate to="/dashboard" replace />;

  const rows = query.data ?? [];
  const queued = rows.filter((row) => row.status === "approved" || row.status === "sending");
  const needsReply = rows.filter((row) => row.status === "pending" && row.awaiting_reply);
  const sentToday = rows.filter((row) => row.status === "sent" && row.sent_at
    && new Date(row.sent_at).toDateString() === new Date().toDateString()).length;
  const tabs = [
    { id: "needs", label: "Needs reply", rows: needsReply },
    { id: "open", label: "All open", rows: rows.filter((row) => row.status === "pending") },
    { id: "sent", label: "Sent", rows: rows.filter((row) => row.status === "sent") },
    { id: "closed", label: "Skipped & failed", rows: rows.filter((row) => row.status === "skipped" || row.status === "failed") },
  ];
  const stats = [
    { id: "needs", label: "Needs reply", value: needsReply.length },
    { id: "queued", label: "Queued", value: queued.length },
    { id: "sent", label: "Sent today", value: sentToday },
    { id: "failed", label: "Failed", value: rows.filter((row) => row.status === "failed").length },
  ];

  return (
    <main className="mx-auto w-full max-w-4xl space-y-5 p-4 pb-24 text-foreground sm:p-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight">Money Inbox</h1>
        <p className="text-sm text-muted-foreground">Texts that make you money, ranked. Approve a reply and your Mac sends it from your number.</p>
      </header>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((row) => (
          <Card key={row.id} className="border-primary/20">
            <CardContent className="p-3">
              <p className="text-xs text-muted-foreground">{row.label}</p>
              <p className="text-2xl font-semibold text-primary">{query.isPending ? "—" : row.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>
      {query.isError && (
        <div role="alert" className="space-y-2 rounded-lg border border-destructive p-4">
          <p>Could not refresh Money Inbox. {query.error.message}</p>
          <Button variant="outline" onClick={() => query.refetch()}>Try again</Button>
        </div>
      )}
      {query.isPending && <p role="status" className="text-muted-foreground">Loading your threads…</p>}
      {queued.length > 0 && (
        <section aria-label="Queued replies" className="space-y-3">
          <h2 className="text-sm font-semibold text-primary">Queued replies</h2>
          {queued.map((row) => <ThreadCard key={row.id} row={row} refresh={query.refetch} />)}
        </section>
      )}
      <Tabs defaultValue="needs">
        <TabsList aria-label="Filter money threads">
          {tabs.map((row) => <TabsTrigger key={row.id} value={row.id}>{row.label}</TabsTrigger>)}
        </TabsList>
        {tabs.map((row) => (
          <TabsContent key={row.id} value={row.id} className="space-y-4">
            {row.rows.map((row) => <ThreadCard key={row.id} row={row} refresh={query.refetch} />)}
            {!query.isPending && !query.isError && row.rows.length === 0 && (
              <Card><CardContent className="p-6 text-center text-muted-foreground">Nothing waiting. The scanner runs every 2 minutes.</CardContent></Card>
            )}
          </TabsContent>
        ))}
      </Tabs>
    </main>
  );
}
