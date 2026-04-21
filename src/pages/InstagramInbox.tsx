import { useState, useEffect, useMemo } from "react";
import { formatDistanceToNowStrict } from "date-fns";
import {
  MessageCircle, Search, Send, RefreshCw, Loader2,
  CheckCircle2, AlertTriangle, Clock, Link as LinkIcon,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { GlassCard } from "@/components/ui/glass-card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Thread {
  id?: string;
  ig_user_id: string;
  conversation_id?: string | null;
  username?: string | null;
  display_name?: string | null;
  profile_pic_url?: string | null;
  last_msg_at?: string | null;
  last_sender?: "me" | "them" | null;
  last_msg_preview?: string | null;
  bucket: "fresh" | "recent" | "stale";
  outreach_status?: string | null;
  last_sent_at?: string | null;
}

interface Template {
  id: string;
  name: string;
  body: string;
  category?: string | null;
  use_count?: number | null;
}

interface Connection {
  access_token: string;
  instagram_user_id: string;
  instagram_username: string | null;
  token_expires_at: string | null;
}

const GRAPH_BASE = "https://graph.instagram.com";

function bucketOf(lastMsgAt: string | null | undefined, lastSender: string | null | undefined): Thread["bucket"] {
  if (!lastMsgAt) return "stale";
  const age = Date.now() - new Date(lastMsgAt).getTime();
  if (lastSender === "them" && age < 24 * 3600 * 1000) return "fresh";
  if (age < 7 * 24 * 3600 * 1000) return "recent";
  return "stale";
}

export default function InstagramInbox() {
  const { user } = useAuth();
  const [connection, setConnection] = useState<Connection | null>(null);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selected, setSelected] = useState<Thread | null>(null);
  const [replyText, setReplyText] = useState("");
  const [bucketFilter, setBucketFilter] = useState<"all" | Thread["bucket"]>("fresh");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [sending, setSending] = useState(false);

  // ─── Load connection + threads + templates ──
  const load = async () => {
    if (!user?.id) { setLoading(false); return; }
    setLoading(true);
    try {
      const [{ data: conn }, { data: thr }, { data: tmpl }] = await Promise.all([
        supabase.from("instagram_connections" as any)
          .select("access_token, instagram_user_id, instagram_username, token_expires_at")
          .eq("user_id", user.id).order("connected_at", { ascending: false }).limit(1).maybeSingle(),
        supabase.from("instagram_dm_threads" as any)
          .select("*").eq("user_id", user.id).order("last_msg_at", { ascending: false }).limit(500),
        supabase.from("instagram_dm_templates" as any)
          .select("*").eq("user_id", user.id).order("updated_at", { ascending: false }),
      ]);
      setConnection((conn as any) ?? null);
      setThreads(((thr as any) ?? []).map((t: any) => ({ ...t, bucket: bucketOf(t.last_msg_at, t.last_sender) })));
      setTemplates((tmpl as any) ?? []);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [user?.id]);

  // ─── Pull conversations fresh from Instagram Graph API ──
  const syncFromInstagram = async () => {
    if (!connection?.access_token || !user?.id) {
      toast.error("Connect Instagram first at Settings → Integrations");
      return;
    }
    setSyncing(true);
    try {
      const r = await fetch(
        `${GRAPH_BASE}/v19.0/${connection.instagram_user_id}/conversations?platform=instagram&fields=id,updated_time,participants,messages.limit(1){from,message,created_time}&access_token=${connection.access_token}`,
      );
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error?.message ?? `HTTP ${r.status}`);
      const convs: any[] = data.data ?? [];

      const upserts: any[] = convs.map(c => {
        const other = (c.participants?.data ?? []).find((p: any) => p.id !== connection.instagram_user_id);
        const lastMsg = c.messages?.data?.[0];
        const senderIsMe = lastMsg?.from?.id === connection.instagram_user_id;
        return {
          user_id: user.id,
          ig_user_id: other?.id ?? c.id,
          conversation_id: c.id,
          username: other?.username ?? null,
          last_msg_at: lastMsg?.created_time ?? c.updated_time ?? null,
          last_sender: senderIsMe ? "me" : "them",
          last_msg_preview: (lastMsg?.message ?? "").slice(0, 160),
          bucket: bucketOf(lastMsg?.created_time ?? c.updated_time, senderIsMe ? "me" : "them"),
          updated_at: new Date().toISOString(),
        };
      });

      if (upserts.length) {
        const { error } = await supabase.from("instagram_dm_threads" as any)
          .upsert(upserts, { onConflict: "user_id,ig_user_id" });
        if (error) throw error;
      }
      toast.success(`Synced ${upserts.length} conversations`);
      await load();
    } catch (e: any) {
      toast.error(`Sync failed: ${e?.message ?? e}`);
    } finally { setSyncing(false); }
  };

  const sendReply = async () => {
    if (!selected || !replyText.trim() || !connection?.access_token) return;
    if (selected.bucket === "stale") {
      toast.error("Meta blocks DMs to conversations older than 7 days. Get them to message first via a story / post CTA.");
      return;
    }
    setSending(true);
    try {
      const r = await fetch(
        `${GRAPH_BASE}/v19.0/${connection.instagram_user_id}/messages?access_token=${connection.access_token}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            recipient: { id: selected.ig_user_id },
            message: { text: replyText.trim() },
            ...(selected.bucket === "recent" ? { messaging_type: "MESSAGE_TAG", tag: "HUMAN_AGENT" } : {}),
          }),
        },
      );
      const body = await r.json();
      if (!r.ok) throw new Error(body?.error?.message ?? `HTTP ${r.status}`);

      // Log outreach
      await Promise.all([
        supabase.from("instagram_events" as any).insert({
          user_id: user!.id,
          event_type: "dm_sent",
          external_id: body?.message_id ?? selected.ig_user_id,
          payload: { to: selected.ig_user_id, username: selected.username, text: replyText.trim(), bucket: selected.bucket },
        }),
        supabase.from("instagram_dm_threads" as any).update({
          last_sent_at: new Date().toISOString(),
          outreach_status: "contacted",
          updated_at: new Date().toISOString(),
        }).eq("user_id", user!.id).eq("ig_user_id", selected.ig_user_id),
      ]);

      toast.success(`Sent to @${selected.username ?? selected.ig_user_id}`);
      setReplyText("");
      await load();
    } catch (e: any) {
      toast.error(`Send failed: ${e?.message ?? e}`);
    } finally { setSending(false); }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return threads
      .filter(t => bucketFilter === "all" || t.bucket === bucketFilter)
      .filter(t => !q || (t.username ?? "").toLowerCase().includes(q) || (t.last_msg_preview ?? "").toLowerCase().includes(q));
  }, [threads, bucketFilter, search]);

  const counts = useMemo(() => {
    const c = { fresh: 0, recent: 0, stale: 0 };
    for (const t of threads) c[t.bucket]++;
    return c;
  }, [threads]);

  const applyTemplate = (tmpl: Template) => {
    const name = selected?.username ? `@${selected.username}` : "there";
    setReplyText(tmpl.body.replace(/\{name\}/g, name));
  };

  if (loading) return <div className="p-8 text-center text-muted-foreground">Loading inbox…</div>;

  if (!connection) {
    return (
      <div className="p-6 max-w-xl mx-auto mt-16">
        <GlassCard className="p-8 text-center space-y-4">
          <MessageCircle className="h-12 w-12 text-primary mx-auto" />
          <h2 className="text-xl font-bold">Connect Instagram first</h2>
          <p className="text-sm text-muted-foreground">
            Your Instagram account isn't linked yet. Connect it to see and reply to DMs from here.
          </p>
          <Button asChild size="lg">
            <a href="/dashboard/integrations" className="gap-2">
              <LinkIcon className="h-4 w-4" /> Open Integrations
            </a>
          </Button>
        </GlassCard>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-[1400px] mx-auto space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <MessageCircle className="h-6 w-6 text-primary" />
        <h1 className="apex-headline text-2xl md:text-3xl font-bold">Instagram Inbox</h1>
        <Badge variant="outline" className="text-[10px] border-primary/40 text-primary">
          @{connection.instagram_username ?? connection.instagram_user_id}
        </Badge>
        <Button variant="outline" size="sm" onClick={syncFromInstagram} disabled={syncing} className="ml-auto gap-1.5">
          {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Sync from Instagram
        </Button>
      </div>

      {/* Bucket tabs */}
      <div className="flex flex-wrap gap-2">
        {([
          { key: "fresh",  label: "Fresh (24h)",   count: counts.fresh,  icon: CheckCircle2,   tint: "text-emerald-400 border-emerald-500/30" },
          { key: "recent", label: "Recent (7d)",   count: counts.recent, icon: Clock,          tint: "text-amber-400 border-amber-500/30" },
          { key: "stale",  label: "Stale (7d+)",   count: counts.stale,  icon: AlertTriangle,  tint: "text-rose-400 border-rose-500/30" },
          { key: "all",    label: "All",           count: threads.length, icon: MessageCircle, tint: "text-muted-foreground border-border" },
        ] as const).map(b => (
          <button
            key={b.key}
            onClick={() => setBucketFilter(b.key)}
            className={cn(
              "px-3 py-1.5 rounded-lg border text-xs font-medium flex items-center gap-1.5 transition-all",
              bucketFilter === b.key ? "bg-primary/15 border-primary text-primary" : b.tint + " hover:bg-muted/30",
            )}
          >
            <b.icon className="h-3.5 w-3.5" /> {b.label}
            <span className="font-bold">{b.count}</span>
          </button>
        ))}
      </div>

      <div className="grid lg:grid-cols-[minmax(300px,360px)_1fr] gap-4">
        {/* Thread list */}
        <GlassCard className="p-0 overflow-hidden flex flex-col max-h-[75vh]">
          <div className="p-2.5 border-b border-border/40">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search user or message…" className="h-8 pl-8" />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="p-8 text-center text-xs text-muted-foreground">
                {threads.length === 0 ? "Click Sync to pull your DMs." : "No conversations match."}
              </div>
            ) : filtered.map(t => (
              <button
                key={t.ig_user_id}
                onClick={() => setSelected(t)}
                className={cn(
                  "w-full text-left px-3 py-2.5 border-b border-border/30 transition-colors",
                  selected?.ig_user_id === t.ig_user_id ? "bg-primary/15" : "hover:bg-muted/20",
                )}
              >
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-sm font-semibold truncate flex-1">@{t.username ?? t.ig_user_id.slice(0, 8)}</span>
                  <span className={cn(
                    "text-[9px] px-1.5 py-0.5 rounded-full uppercase tracking-wider font-bold",
                    t.bucket === "fresh"  && "bg-emerald-500/20 text-emerald-300",
                    t.bucket === "recent" && "bg-amber-500/20 text-amber-300",
                    t.bucket === "stale"  && "bg-rose-500/20 text-rose-300",
                  )}>{t.bucket}</span>
                </div>
                <div className="text-[11px] text-muted-foreground truncate">{t.last_msg_preview || "—"}</div>
                <div className="text-[10px] text-muted-foreground/60 mt-0.5">
                  {t.last_msg_at ? formatDistanceToNowStrict(new Date(t.last_msg_at), { addSuffix: true }) : "—"}
                  {t.outreach_status === "contacted" && " · sent"}
                </div>
              </button>
            ))}
          </div>
        </GlassCard>

        {/* Thread detail + compose */}
        <GlassCard className="p-4 md:p-5 min-h-[50vh]">
          {!selected ? (
            <div className="h-full min-h-[40vh] flex flex-col items-center justify-center text-center text-muted-foreground">
              <MessageCircle className="h-12 w-12 mb-3 opacity-40" />
              <p className="text-sm">Pick a conversation from the left.</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-bold">@{selected.username ?? selected.ig_user_id}</h2>
                  <p className="text-xs text-muted-foreground">
                    Last activity {selected.last_msg_at ? formatDistanceToNowStrict(new Date(selected.last_msg_at), { addSuffix: true }) : "—"} ·{" "}
                    <span className={cn(
                      selected.bucket === "fresh"  && "text-emerald-400",
                      selected.bucket === "recent" && "text-amber-400",
                      selected.bucket === "stale"  && "text-rose-400",
                    )}>{selected.bucket.toUpperCase()}</span>
                  </p>
                </div>
                {selected.last_sent_at && (
                  <Badge variant="outline" className="text-[10px]">last sent {formatDistanceToNowStrict(new Date(selected.last_sent_at), { addSuffix: true })}</Badge>
                )}
              </div>

              {selected.last_msg_preview && (
                <div className="rounded-lg bg-muted/30 border border-border/40 p-3 text-sm">
                  <div className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">
                    Last message {selected.last_sender === "me" ? "(you)" : "(them)"}
                  </div>
                  <div>{selected.last_msg_preview}</div>
                </div>
              )}

              {selected.bucket === "stale" && (
                <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-3 text-xs text-rose-200">
                  Meta's 7-day rule blocks DMs to this conversation. Post a story or feed comment-for-DM to get them to reply first, then they'll move to Fresh.
                </div>
              )}
              {selected.bucket === "recent" && (
                <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200">
                  Will send with <code className="font-mono">HUMAN_AGENT</code> message tag. Requires the permission to be approved in your Meta app review.
                </div>
              )}

              {templates.length > 0 && (
                <div className="flex gap-2 flex-wrap">
                  {templates.map(t => (
                    <button key={t.id} onClick={() => applyTemplate(t)}
                      className="text-[11px] px-2.5 py-1 rounded-md border border-border/60 hover:border-primary/50 hover:bg-primary/5 transition-colors">
                      {t.name}
                    </button>
                  ))}
                </div>
              )}

              <div className="space-y-2">
                <Textarea value={replyText} onChange={e => setReplyText(e.target.value)} placeholder="Type your reply…" rows={4}
                  disabled={selected.bucket === "stale"} />
                <div className="flex justify-end">
                  <Button onClick={sendReply} disabled={sending || !replyText.trim() || selected.bucket === "stale"} className="gap-1.5">
                    {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                    Send DM
                  </Button>
                </div>
              </div>
            </div>
          )}
        </GlassCard>
      </div>
    </div>
  );
}
