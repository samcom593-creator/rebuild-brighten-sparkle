import { useState, useEffect, useRef } from "react";
import { formatDistanceToNowStrict } from "date-fns";
import { Send, MessageSquare, Loader2, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { GlassCard } from "@/components/ui/glass-card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Message {
  id: string;
  user_id: string;
  author_name: string;
  author_avatar: string | null;
  body: string;
  created_at: string | null;
}

export default function TeamChat() {
  const { user, profile } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    const { data } = await supabase.from("team_chat_messages")
      .select("id, user_id, author_name, author_avatar, body, created_at")
      .order("created_at", { ascending: true }).limit(200);
    setMessages((data ?? []) as Message[]);
    setLoading(false);
    setTimeout(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }), 50);
  };

  useEffect(() => { load(); }, []);

  // Realtime subscription
  useEffect(() => {
    // PL: stable channel name. Math.random() was creating a fresh channel +
    // websocket on every render so Supabase couldn't dedupe — same disease
    // that hit BookOfBusiness in wave-6. Channel scope is global team-chat,
    // so a constant key is correct here.
    const ch = supabase.channel("team-chat-global")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "team_chat_messages" },
        (p) => {
          const m = p.new as any as Message;
          setMessages(prev => [...prev, m]);
          setTimeout(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }), 30);
        })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const send = async () => {
    if (!input.trim() || !user?.id) return;
    setSending(true);
    try {
      const { error } = await supabase.from("team_chat_messages").insert({
        user_id: user.id,
        author_name: profile?.full_name ?? "Agent",
        author_avatar: (profile as any)?.avatar_url ?? null,
        body: input.trim(),
      });
      if (error) throw error;
      setInput("");
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to send");
    } finally { setSending(false); }
  };

  const groupedByUser = (i: number) => {
    if (i === 0) return false;
    const prev = messages[i - 1];
    const cur = messages[i];
    return prev.user_id === cur.user_id &&
      (new Date(cur.created_at).getTime() - new Date(prev.created_at).getTime()) < 2 * 60_000;
  };

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto h-[calc(100vh-6rem)] flex flex-col">
      <div className="flex items-center gap-3 mb-4">
        <div className="h-11 w-11 rounded-md bg-white dark:bg-slate-900 flex items-center justify-center">
          <MessageSquare className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1">
          <h1 className="apex-headline text-2xl md:text-3xl font-bold">APEX Team Chat</h1>
          <p className="text-xs text-muted-foreground">Live · everyone on the roster sees this.</p>
        </div>
        <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-300"><span className="radar-pulse inline-block h-1.5 w-1.5 rounded-full bg-emerald-400 mr-1.5 align-middle" />LIVE</Badge>
      </div>

      <GlassCard className="flex-1 flex flex-col overflow-hidden">
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-1.5">
          {loading ? (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground">
              <Users className="h-10 w-10 mb-3 opacity-40" />
              <p className="text-sm">Chat's quiet. Say hi.</p>
            </div>
          ) : messages.map((m, i) => {
            const mine = m.user_id === user?.id;
            const grouped = groupedByUser(i);
            return (
              <div key={m.id} className={cn("flex gap-2 max-w-full", mine && "flex-row-reverse")}>
                <div className="w-9 shrink-0">
                  {!grouped && (
                    m.author_avatar
                      ? <img src={m.author_avatar} alt="" className="h-9 w-9 rounded-full object-cover" />
                      : <div className="h-9 w-9 rounded-full bg-white dark:bg-slate-900 flex items-center justify-center text-xs font-bold text-white">
                          {m.author_name.split(" ").map(p => p[0]).slice(0, 2).join("").toUpperCase()}
                        </div>
                  )}
                </div>
                <div className={cn("flex flex-col max-w-[70%]", mine && "items-end")}>
                  {!grouped && (
                    <div className={cn("text-[10px] text-muted-foreground mb-0.5 px-2", mine && "text-right")}>
                      <span className="font-semibold text-foreground/80">{m.author_name}</span>
                      <span className="ml-1.5">{formatDistanceToNowStrict(new Date(m.created_at), { addSuffix: true })}</span>
                    </div>
                  )}
                  <div className={cn(
                    "px-3.5 py-2 rounded-md text-sm leading-relaxed break-words bounce-in",
                    mine
                      ? "bg-white dark:bg-slate-900 text-gray-950 rounded-br-md"
                      : "bg-muted/40 text-foreground rounded-bl-md",
                  )}>
                    {m.body}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="p-3 border-t border-border/40 flex gap-2">
          <Input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder="Drop in the team chat…"
            className="h-10"
          />
          <Button onClick={send} disabled={sending || !input.trim()} className="gap-1.5 h-10">
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Send
          </Button>
        </div>
      </GlassCard>
    </div>
  );
}
