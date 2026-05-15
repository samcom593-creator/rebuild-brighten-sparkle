/**
 * PortalLinkSender — admin picks which agents, fires send-agent-portal-login
 * per-recipient. Lets Sam blast login links to a subset (new hires, slumping
 * agents, etc.) without spamming the whole roster.
 */

import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Search, Send, Loader2, CheckCircle2, XCircle, Mail, Users } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Agent = {
  id: string;
  name: string;
  email: string | null;
  avatar: string | null;
  stage: string | null;
  lastLogin: string | null;
};

export function PortalLinkSender() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<Array<{ id: string; ok: boolean; error?: string }>>([]);

  useEffect(() => {
    (async () => {
      const { data: rows } = await supabase.from("agents")
        .select("id, user_id, onboarding_stage, is_deactivated, profile:profiles(full_name, email, avatar_url)")
        .eq("is_deactivated", false);

      // Pull last sign-in in one roundtrip if possible — falls back gracefully otherwise
      const userIds = (rows ?? []).map((a: any) => a.user_id).filter(Boolean);
      const lastLoginMap = new Map<string, string>();
      if (userIds.length) {
        // auth.users not directly readable; skip last-login (would need admin API)
      }

      setAgents(((rows ?? []) as any[]).map(a => ({
        id: a.id,
        name: a.profile?.full_name ?? "Agent",
        email: a.profile?.email ?? null,
        avatar: a.profile?.avatar_url ?? null,
        stage: a.onboarding_stage,
        lastLogin: lastLoginMap.get(a.user_id) ?? null,
      })).filter(a => a.email));
      setLoading(false);
    })();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return agents;
    return agents.filter(a =>
      a.name.toLowerCase().includes(q) || (a.email ?? "").toLowerCase().includes(q)
    );
  }, [agents, search]);

  const toggle = (id: string) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };
  const selectAll = () => setSelected(new Set(filtered.map(a => a.id)));
  const clear = () => setSelected(new Set());

  const send = async () => {
    if (selected.size === 0) { toast.error("Pick at least one agent"); return; }
    setSending(true);
    setResults([]);
    const out: typeof results = [];
    for (const id of selected) {
      const agent = agents.find(a => a.id === id);
      if (!agent) continue;
      try {
        const { error } = await supabase.functions.invoke("send-agent-portal-login", {
          body: { agentId: id, email: agent.email, destination: "portal" },
        });
        if (error) throw error;
        out.push({ id, ok: true });
      } catch (e: any) {
        out.push({ id, ok: false, error: e?.message ?? "failed" });
      }
      setResults([...out]);
    }
    setSending(false);
    const ok = out.filter(r => r.ok).length;
    if (ok === out.length) toast.success(`Portal links sent to ${ok} agent${ok === 1 ? "" : "s"}`);
    else toast.error(`Sent ${ok}/${out.length} — some failed (see list)`);
  };

  return (
    <GlassCard className="p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Mail className="h-4 w-4 text-primary" />
        <span className="text-sm font-bold">Send Portal Links</span>
        <Badge variant="outline" className="ml-auto text-[10px]">{selected.size} selected</Badge>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          className="pl-9 h-8 text-sm"
          placeholder="Search agents by name or email…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={selectAll} disabled={filtered.length === 0}>
          Select all ({filtered.length})
        </Button>
        <Button size="sm" variant="ghost" onClick={clear} disabled={selected.size === 0}>Clear</Button>
        <div className="flex-1" />
        <Button size="sm" onClick={send} disabled={sending || selected.size === 0}>
          {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Send className="h-3.5 w-3.5 mr-1" />}
          Send to {selected.size || "—"}
        </Button>
      </div>

      <div className="max-h-80 overflow-y-auto border border-border/30 rounded-md divide-y divide-border/20">
        {loading ? (
          <div className="p-6 text-center text-xs text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin mx-auto mb-1" /> Loading agents…
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-6 text-center text-xs text-muted-foreground">
            <Users className="h-6 w-6 mx-auto mb-1 opacity-40" />
            No agents match "{search}"
          </div>
        ) : filtered.map(a => {
          const result = results.find(r => r.id === a.id);
          return (
            <label key={a.id}
              className={cn("flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-muted/30 transition-colors",
                selected.has(a.id) && "bg-primary/5")}>
              <Checkbox checked={selected.has(a.id)} onCheckedChange={() => toggle(a.id)} />
              {a.avatar
                ? <img src={a.avatar} alt="" className="h-6 w-6 rounded-full" />
                : <div className="h-6 w-6 rounded-full bg-muted/50 flex items-center justify-center text-[9px] font-semibold">
                    {a.name.split(" ").map(n => n[0]).slice(0,2).join("")}
                  </div>}
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium truncate">{a.name}</div>
                <div className="text-[10px] text-muted-foreground truncate">{a.email}</div>
              </div>
              {a.stage && <Badge variant="outline" className="text-[9px]">{a.stage.replace(/_/g, " ")}</Badge>}
              {result?.ok && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />}
              {result && !result.ok && (
                <span title={result.error} className="inline-flex">
                  <XCircle className="h-3.5 w-3.5 text-rose-400" />
                </span>
              )}
            </label>
          );
        })}
      </div>
    </GlassCard>
  );
}
