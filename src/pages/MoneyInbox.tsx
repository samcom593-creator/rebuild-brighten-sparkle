import { useEffect, useRef, useState } from "react";
import { Navigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { usePageTitle } from "@/hooks/usePageTitle";
import { phoneHref, contactLinkProps } from "@/lib/phone";
import { isSamEmail } from "@/lib/samOnly";
import {
  absoluteTime,
  relativeTime,
  phoenixDay,
  contactLabel,
  TOPICS,
  SOURCES,
} from "@/lib/moneyInbox";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { externalHref } from "@/lib/externalHref";
const db = supabase as unknown as SupabaseClient;
interface Thread {
  id: string;
  handle: string | null;
  display_name: string | null;
  source: string;
  topics: string[];
  priority: number;
  private: boolean;
  classified_at: string | null;
  awaiting_reply: boolean;
  last_inbound_at: string | null;
  last_inbound_text: string | null;
  excerpt: { t: string; from: "me" | "them"; text: string }[];
  draft_reply: string | null;
  final_reply: string | null;
  status: string;
  sent_at: string | null;
  delivered_at: string | null;
  delivery_latency_ms: number | null;
  send_error: string | null;
  updated_at: string;
  snoozed_until: string | null;
  send_supported: boolean;
  source_url: string | null;
}
interface Source {
  source: string;
  connected: boolean;
  reason: string;
  last_ingested_at: string | null;
  checked_at: string;
}
type Patch = {
  final_reply?: string;
  status?: string;
  approved_at?: string;
  snoozed_until?: string | null;
  muted?: boolean;
};
function Time({ value }: { value: string | null }) {
  return (
    <span className="text-xs text-muted-foreground">
      <span className="font-medium text-foreground">{relativeTime(value)}</span>{" "}
      · {absoluteTime(value)}
    </span>
  );
}
function ThreadCard({
  row,
  act,
}: {
  row: Thread;
  act: (row: Thread, patch: Patch) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false),
    [editing, setEditing] = useState(false),
    [edit, setEdit] = useState<string | null>(null),
    [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
  const lock = useRef(false),
    input = useRef<HTMLTextAreaElement>(null);
  const reply = edit ?? row.final_reply ?? row.draft_reply ?? "";
  const editable = ["pending", "failed"].includes(row.status);
  async function update(patch: Patch) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      await act(row, patch);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save. Try again.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const call =
    row.source === "imessage" &&
    row.handle &&
    /^\+?[\d ()-]{10,}$/.test(row.handle);
  return (
    <article className="min-w-0 space-y-3 rounded-2xl border border-primary/20 bg-card p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap gap-2">
            <Badge variant="outline">{SOURCES[row.source] ?? row.source}</Badge>
            <Badge
              className={
                row.priority === 1
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground"
              }
            >
              {row.priority === 1
                ? "High priority"
                : row.priority === 2
                  ? "Follow up"
                  : "Other"}
            </Badge>
          </div>
          <h2 className="break-words text-lg font-semibold">
            {contactLabel(row.display_name, row.handle)}
          </h2>
        </div>
        <span className="shrink-0 text-xs text-primary">
          {row.awaiting_reply ? "Unanswered" : "Replied"}
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {(row.topics ?? ["other"]).map((t) => (
          <Badge key={t} variant="secondary">
            {TOPICS[t] ?? t}
          </Badge>
        ))}
      </div>
      <p className="line-clamp-3 whitespace-pre-wrap break-words text-sm leading-relaxed">
        {row.last_inbound_text || "No text content"}
      </p>
      <Time value={row.last_inbound_at} />
      <div>
        <button
          className="min-h-10 text-sm text-primary underline-offset-4 hover:underline"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
        >
          {expanded ? "Hide conversation" : "View conversation"}
        </button>
      </div>
      {expanded && (
        <div className="max-h-96 space-y-4 overflow-auto rounded-xl bg-muted/40 p-3">
          {row.excerpt.map((m, i) => (
            <div
              key={`${m.t}-${i}`}
              className={
                m.from === "me"
                  ? "ml-5 border-l-2 border-primary pl-3"
                  : "mr-5 border-l-2 border-border pl-3"
              }
            >
              <p className="text-xs font-semibold">
                {m.from === "me" ? "You" : "Them"}
              </p>
              <p className="whitespace-pre-wrap break-words text-sm">
                {m.text}
              </p>
              <Time value={m.t} />
            </div>
          ))}
        </div>
      )}
      {editable && row.send_supported && (
        <div className="rounded-xl bg-primary/5 p-3">
          <label
            htmlFor={`reply-${row.id}`}
            className="text-xs font-semibold text-primary"
          >
            Your reply
          </label>
          {editing || !reply ? (
            <Textarea
              ref={input}
              id={`reply-${row.id}`}
              value={reply}
              onChange={(e) => setEdit(e.target.value)}
              placeholder="Write your reply…"
              className="mt-2 min-h-24 text-base"
              disabled={busy}
            />
          ) : (
            <p className="mt-1 whitespace-pre-wrap break-words text-sm">
              {reply}
            </p>
          )}
        </div>
      )}
      {!row.send_supported && (
        <p className="text-xs text-muted-foreground">
          Approve-to-send is not connected for this{" "}
          {row.source === "imessage" ? "group conversation" : "channel"}.{" "}
          {externalHref(row.source_url) && (
            <a
              className="text-primary underline"
              href={externalHref(row.source_url) ?? undefined}
              target="_blank"
              rel="noopener noreferrer"
            >
              Reply in {SOURCES[row.source] ?? row.source}
            </a>
          )}
        </p>
      )}
      <div aria-live="polite" className="text-sm">
        {row.status === "approved" && (
          <p className="text-primary">Approved · dispatching to your Mac…</p>
        )}
        {row.status === "sending" && (
          <p className="text-primary">Sending from your Mac…</p>
        )}
        {row.status === "sent" && (
          <p className="text-primary">
            {row.delivered_at
              ? "Delivered"
              : "Sent · delivery not yet confirmed"}{" "}
            · {absoluteTime(row.delivered_at ?? row.sent_at)}
          </p>
        )}
        {row.status === "skipped" && <p>Done</p>}
        {row.status === "failed" && (
          <p className="text-destructive">{row.send_error || "Send failed"}</p>
        )}
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
      </div>
      {editable && (
        <div className="flex flex-wrap gap-2">
          {row.send_supported && (
            <>
              <Button
                className="min-h-11 flex-1"
                disabled={busy || !reply.trim()}
                onClick={() =>
                  update({
                    final_reply: reply,
                    status: "approved",
                    approved_at: new Date().toISOString(),
                  })
                }
              >
                {row.status === "failed" ? "Retry send" : "Approve send"}
              </Button>
              <Button
                variant="outline"
                className="min-h-11"
                disabled={busy}
                onClick={() => {
                  setEditing(true);
                  setTimeout(() => input.current?.focus(), 0);
                }}
              >
                Edit
              </Button>
            </>
          )}
          {call && (
            <Button variant="outline" className="min-h-11" asChild>
              <a href={phoneHref(row.handle) ?? undefined} {...contactLinkProps(phoneHref(row.handle))}>Call</a>
            </Button>
          )}
          <Button
            variant="outline"
            className="min-h-11"
            disabled={busy}
            onClick={() =>
              update({
                snoozed_until: new Date(Date.now() + 86400000).toISOString(),
              })
            }
          >
            Snooze 1d
          </Button>
          <Button
            variant="ghost"
            className="min-h-11"
            disabled={busy}
            onClick={() => update({ status: "skipped" })}
          >
            Done
          </Button>
        </div>
      )}
    </article>
  );
}
export default function MoneyInbox() {
  const { user } = useAuth();
  usePageTitle("Money Inbox");
  const isSam = isSamEmail(user?.email),
    client = useQueryClient();
  const key = ["money-inbox", user?.id];
  const [topic, setTopic] = useState("all"),
    [source, setSource] = useState("all"),
    [unanswered, setUnanswered] = useState(false),
    [today, setToday] = useState(false),
    [tab, setTab] = useState("open"),
    [limit, setLimit] = useState(24),
    [sort, setSort] = useState("recent"),
    [, tick] = useState(0);
  const query = useQuery({
    queryKey: key,
    enabled: isSam,
    queryFn: async () => {
      const { data, error } = await db
        .from("money_inbox_threads")
        .select("*")
        .eq("in_scan", true)
        .eq("muted", false)
        .eq("private", false)
        .order("last_inbound_at", { ascending: false, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as Thread[];
    },
  });
  const sources = useQuery({
    queryKey: ["money-inbox-sources", user?.id],
    enabled: isSam,
    queryFn: async () => {
      const { data, error } = await db
        .from("money_inbox_sources")
        .select("*")
        .order("source");
      if (error) throw error;
      return (data ?? []) as Source[];
    },
  });
  useEffect(() => {
    if (!isSam) return;
    const channel = db
      .channel(`money-inbox-ui-${user?.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "money_inbox_threads" },
        () => {
          void client.invalidateQueries({
            queryKey: ["money-inbox", user?.id],
          });
        },
      )
      .subscribe();
    const timer = setInterval(() => tick((n) => n + 1), 30000);
    return () => {
      clearInterval(timer);
      void db.removeChannel(channel);
    };
  }, [isSam, user?.id, client]);
  async function act(row: Thread, patch: Patch) {
    await client.cancelQueries({ queryKey: key });
    client.setQueryData<Thread[]>(key, (old) =>
      old?.map((r) => (r.id === row.id ? { ...r, ...patch } : r)),
    );
    try {
      const { data, error } = await db
        .from("money_inbox_threads")
        .update(patch)
        .eq("id", row.id)
        .eq("status", row.status)
        .eq("updated_at", row.updated_at)
        .select("id");
      if (error) throw error;
      if (!data?.length)
        throw new Error("This thread changed. Review it and try again.");
    } catch (error) {
      client.setQueryData<Thread[]>(key, (old) =>
        old?.map((r) => (r.id === row.id ? row : r)),
      );
      throw error;
    } finally {
      await client.invalidateQueries({ queryKey: key });
    }
  }
  if (!isSam) return <Navigate to="/dashboard" replace />;
  const all = (query.data ?? []).filter((r) => !r.private && r.classified_at);
  const rows = all.filter(
    (r) =>
      (topic === "all" || r.topics.includes(topic)) &&
      (source === "all" || r.source === source) &&
      (!unanswered || r.awaiting_reply) &&
      (!today ||
        (r.last_inbound_at &&
          phoenixDay(r.last_inbound_at) === phoenixDay())) &&
      (tab === "done"
        ? ["sent", "skipped"].includes(r.status)
        : tab === "snoozed"
          ? r.snoozed_until && Date.parse(r.snoozed_until) > Date.now()
          : !["sent", "skipped"].includes(r.status) &&
            (!r.snoozed_until || Date.parse(r.snoozed_until) <= Date.now())),
  );
  return (
    <main className="mx-auto w-full max-w-5xl space-y-5 p-4 pb-24 sm:p-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-widest text-primary">
          Your next opportunity
        </p>
        <h1 className="mt-1 text-3xl font-bold">Money Inbox</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The conversations that move business forward. Only you can approve a
          reply.
        </p>
      </header>
      <section
        aria-label="Channel connections"
        className="flex flex-wrap gap-2"
      >
        {sources.isPending ? (
          <p>Checking connections…</p>
        ) : sources.isError ? (
          <p role="alert">
            Channel status unavailable — connection could not be verified.
          </p>
        ) : (
          Object.keys(SOURCES)
            .concat(
              (sources.data ?? [])
                .map((s) => s.source)
                .filter((s) => !SOURCES[s]),
            )
            .map((id) => {
              const s = sources.data?.find((s) => s.source === id),
                fresh = s && Date.now() - Date.parse(s.checked_at) < 10 * 60000;
              return (
                <details
                  key={id}
                  className="max-w-full rounded-lg border border-border px-3 py-2 text-xs"
                >
                  <summary className="cursor-pointer">
                    {SOURCES[id] ?? id} ·{" "}
                    {s?.connected && fresh ? "Connected" : "Not connected"}
                  </summary>
                  <p className="mt-2 max-w-sm">
                    {!fresh ? "Connection status is stale or unverified. " : ""}
                    {s?.reason ?? "No working ingest has been verified."}
                  </p>
                  {s?.last_ingested_at && (
                    <p className="mt-1">
                      Last inbound: {absoluteTime(s.last_ingested_at)}
                    </p>
                  )}
                </details>
              );
            })
        )}
      </section>
      <section
        aria-label="Filters"
        className="flex flex-wrap items-center gap-3 rounded-xl border border-primary/20 bg-card p-3"
      >
        <label className="text-sm">
          Topic{" "}
          <select
            aria-label="Topic"
            className="ml-2 max-w-48 rounded-md border bg-background p-2"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
          >
            <option value="all">All topics</option>
            {Object.entries(TOPICS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Source{" "}
          <select
            aria-label="Source"
            className="ml-2 rounded-md border bg-background p-2"
            value={source}
            onChange={(e) => setSource(e.target.value)}
          >
            <option value="all">All sources</option>
            {Object.entries(SOURCES).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Sort{" "}
          <select
            aria-label="Sort"
            className="ml-2 rounded-md border bg-background p-2"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            <option value="recent">Newest inbound</option>
            <option value="priority">High priority first</option>
          </select>
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={unanswered}
            onChange={(e) => setUnanswered(e.target.checked)}
          />
          Unanswered
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={today}
            onChange={(e) => setToday(e.target.checked)}
          />
          Today · MST
        </label>
      </section>
      <div
        className="flex flex-wrap gap-2"
        role="group"
        aria-label="Conversation status"
      >
        {[
          ["open", "Open"],
          ["snoozed", "Snoozed"],
          ["done", "Done & sent"],
        ].map(([v, l]) => (
          <Button
            key={v}
            variant={tab === v ? "default" : "outline"}
            onClick={() => setTab(v)}
          >
            {l}
          </Button>
        ))}
        <Button
          variant="ghost"
          className="ml-auto"
          onClick={() => {
            void query.refetch();
            void sources.refetch();
          }}
        >
          Refresh
        </Button>
      </div>
      {query.isError ? (
        <div role="alert">
          Could not load Money Inbox. {query.error.message}
        </div>
      ) : query.isPending ? (
        <p role="status">Loading conversations…</p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            {rows.length} conversations ·{" "}
            {sort === "recent"
              ? "newest inbound first"
              : "high priority, then newest inbound"}{" "}
            · all times Arizona
          </p>
          <div className="grid items-start gap-4 md:grid-cols-2">
            {[...rows]
              .sort((a, b) =>
                sort === "priority"
                  ? a.priority - b.priority ||
                    Date.parse(b.last_inbound_at ?? "") -
                      Date.parse(a.last_inbound_at ?? "")
                  : 0,
              )
              .slice(0, limit)
              .map((row) => (
                <ThreadCard key={row.id} row={row} act={act} />
              ))}
          </div>
          {rows.length > limit && (
            <Button
              variant="outline"
              className="w-full min-h-11"
              onClick={() => setLimit((n) => n + 24)}
            >
              Show more conversations
            </Button>
          )}
          {!rows.length && (
            <p className="rounded-xl border p-8 text-center text-muted-foreground">
              No conversations match these filters.
            </p>
          )}
        </>
      )}
    </main>
  );
}
