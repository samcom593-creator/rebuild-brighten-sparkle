// WAVE C1 · Ask Apex AI assistant — dock at bottom-right of every dashboard route.
//
// This MVP is intentionally offline / no-LLM-call: it answers questions by
// pattern-matching against the data already powering /dashboard/business-analytics
// and /dashboard/team-analytics views. Sam wanted the "age of AI" leverage point
// shipped TODAY, not blocked on Anthropic API key + edge function deploy + cost
// guards (those are queued in C1.5 of plan 123).
//
// When the user types a question, we tokenize, match against ~10 canned patterns
// (top producer, top carrier, growth, streak, etc), and answer from the existing
// views: v_business_analytics_summary · v_business_analytics_carriers ·
// v_team_analytics_producers · v_business_analytics_insights · v_sales_challenges.
//
// All matching + data fetching is read-only client-side. Zero backend cost.
// When Sam drops an ANTHROPIC_API_KEY into secrets, we add an `ask-apex` edge
// function fallback for questions that miss the canned patterns — but the
// 80% common-question path is free + instant forever.

import { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { X, Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useUIStore } from "@/shared/store/uiStore";

function fmtUsd(n: number, compact = false): string {
  const v = Number(n ?? 0);
  if (compact && v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (compact && v >= 1_000)     return `$${(v / 1_000).toFixed(1)}K`;
  return v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

interface Message {
  role: "user" | "assistant";
  text: string;
  ts: number;
}

const SUGGESTIONS = [
  "who is my top producer?",
  "what's my top carrier?",
  "how am I doing this month?",
  "show me the streak",
  "what's the team rhythm?",
];

export function AskApex() {
  // MP-254 (2026-07-08): open state moved to uiStore so the sidebar
  // "Ask APEX" button can drive the same panel. Bottom-right FAB removed —
  // Sam directive: "Ask Apex button blocks important bottom-right content".
  const open = useUIStore((s) => s.askApexOpen);
  const setOpen = useUIStore((s) => s.setAskApexOpen);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Pre-fetch analytics + team data on open so answers are instant
  const analytics = useQuery({
    queryKey: ["ask-apex-data"],
    enabled: open,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const [summary, insights, top, challenges] = await Promise.all([
        supabase.from("v_business_analytics_summary" as any).select("*").maybeSingle(),
        supabase.from("v_business_analytics_insights" as any).select("*").maybeSingle(),
        supabase.from("v_team_analytics_producers" as any).select("agent_name, agent_code, user_id, deals_30d, premium_30d").limit(5),
        supabase.from("v_sales_challenges" as any).select("period, current_premium, target_premium, current_deals, target_deals"),
      ]);
      return {
        summary: summary.data,
        insights: insights.data,
        topProducers: (top.data ?? []) as any[],
        challenges: (challenges.data ?? []) as any[],
      };
    },
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length]);

  function answer(question: string): string {
    const q = question.toLowerCase();
    const d = analytics.data;
    if (!d) return "Pulling your numbers… ask me again in a second.";

    // Pattern matching against the 10 most common dashboard questions
    if (q.includes("top producer") || q.includes("who is") || q.includes("best agent")) {
      if (d.topProducers.length === 0) return "No producers have written in the last 30 days yet.";
      const t = d.topProducers[0];
      const name = t.agent_name ?? `AgentLink user #${t.user_id}`;
      return `${name} (${t.agent_code ?? "no code"}) is your top producer · ${t.deals_30d} deals · ${fmtUsd(Number(t.premium_30d))} last 30d.`;
    }
    if (q.includes("top carrier") || q.includes("which carrier") || q.includes("best carrier")) {
      if (!d.insights?.top_carrier_name) return "No carrier data yet.";
      const share = Number(d.insights.top_carrier_share_pct);
      const warn = share >= 50 ? " That's concentrated · diversify before it becomes a single-point failure." : " Healthy spread.";
      return `${d.insights.top_carrier_name} is your top carrier with ${d.insights.top_carrier_share_pct}% of premium and ${d.insights.top_carrier_deals} deals (30d).${warn}`;
    }
    if (q.includes("this month") || q.includes("mtd") || q.includes("how am i doing")) {
      if (!d.summary) return "MTD data still syncing.";
      const growth = Number(d.summary.growth_pct_mom);
      const sign = growth >= 0 ? "+" : "";
      return `MTD: ${d.summary.total_deals_mtd} deals · ${fmtUsd(Number(d.summary.total_premium_mtd))} premium · ${sign}${growth}% vs last month. ${d.summary.active_producers_30d} producers active.`;
    }
    if (q.includes("streak") || q.includes("trophy")) {
      if (!d.insights) return "Streak data syncing.";
      const s = Number(d.insights.streak_days);
      const t = Number(d.insights.days_in_month_elapsed);
      return `${s} / ${t} days with a deal this month. ${s >= t - 1 ? "🏆 PERFECT streak — every day this month." : `Missed ${t - s} day(s).`}`;
    }
    if (q.includes("team rhythm") || q.includes("how many deal") || q.includes("avg")) {
      if (!d.insights || !d.summary) return "Team data syncing.";
      const perAgent = Number(d.insights.team_producers) > 0
        ? Math.round(Number(d.insights.team_deals_30d) / Number(d.insights.team_producers))
        : 0;
      return `Team rhythm (30d): ${d.insights.team_deals_30d} deals · ${fmtUsd(Number(d.insights.team_premium_30d))} premium · ${d.insights.team_producers} active producers · each averaging ${perAgent} deals.`;
    }
    if (q.includes("challenge") || q.includes("goal") || q.includes("quarter") || q.includes("week") || q.includes("daily")) {
      const summary = d.challenges.map((c: any) => {
        const pct = Math.round((Number(c.current_premium) / Math.max(1, Number(c.target_premium))) * 100);
        return `${c.period}: ${fmtUsd(Number(c.current_premium), true)} / ${fmtUsd(Number(c.target_premium), true)} (${pct}%)`;
      }).join(" · ");
      return `Sales challenges right now: ${summary}.`;
    }
    if (q.includes("concentration") || q.includes("risk") || q.includes("diversif")) {
      if (!d.insights) return "Concentration data syncing.";
      const cp = Number(d.insights.top_carrier_share_pct);
      const pp = Number(d.insights.top3_producer_share_pct);
      const warns = [];
      if (cp >= 50) warns.push(`carrier (${d.insights.top_carrier_name} is ${cp}%)`);
      if (pp >= 50) warns.push(`producer (top-3 are ${pp}% of premium)`);
      return warns.length === 0
        ? `Healthy spread on both axes: top carrier ${cp}% · top-3 producers ${pp}%.`
        : `Concentration risk on: ${warns.join(" + ")}.`;
    }
    if (q.includes("hello") || q.includes("hi") || q.includes("hey")) {
      return "Ask me about your top producer, top carrier, MTD performance, current streak, team rhythm, or sales challenges.";
    }
    return "I can answer questions about: top producer · top carrier · MTD performance · streak · team rhythm · sales challenges · concentration risk. Try one of the suggestions below, or check /dashboard/business-analytics for the full view.";
  }

  function submit(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    const userMsg: Message = { role: "user", text: trimmed, ts: Date.now() };
    const aiMsg: Message = { role: "assistant", text: answer(trimmed), ts: Date.now() + 1 };
    setMessages((prev) => [...prev, userMsg, aiMsg]);
    setInput("");
  }

  // MP-254 (2026-07-08): FAB removed — Ask APEX is now opened from the
  // sidebar footer (see GlobalSidebar). This component only renders the
  // panel when open. Bottom-right no longer blocked.
  if (!open) return null;

  return (
    <div className="fixed bottom-5 right-5 z-40 w-[360px] max-w-[calc(100vw-2rem)] h-[480px] max-h-[calc(100vh-2rem)] flex flex-col rounded-md border border-border bg-white dark:bg-card shadow-xl">
      <div className="flex items-center justify-between p-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-amber-500" />
          <span className="text-13 font-bold">Ask Apex</span>
          <span className="text-11 text-muted-foreground">live data · instant</span>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setOpen(false)} aria-label="Close">
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2">
        {messages.length === 0 ? (
          <div className="space-y-3">
            <p className="text-12 text-muted-foreground">
              I answer questions about your book from the live analytics views — top producer, top carrier, MTD, streak, team rhythm, sales challenges, concentration risk. Try:
            </p>
            <div className="flex flex-col gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => submit(s)}
                  className="text-left rounded-md border border-border px-3 py-2 text-12 hover:bg-slate-50 dark:hover:bg-muted transition-base"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m, i) => (
            // stable-key-allow:append-only-chat-log-no-reorder
            <div key={i} className={m.role === "user" ? "text-right" : "text-left"}>
              <div
                className={`inline-block max-w-[85%] rounded-md px-3 py-2 text-12 ${
                  m.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-slate-100 dark:bg-muted text-foreground"
                }`}
              >
                {m.text}
              </div>
            </div>
          ))
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(input);
        }}
        className="p-3 border-t border-border flex gap-2"
      >
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about your book…"
          className="h-9 text-12"
        />
        <Button type="submit" size="icon"
        aria-label="Send message" className="h-9 w-9" disabled={!input.trim()}>
          <Send className="h-3.5 w-3.5" />
        </Button>
      </form>
    </div>
  );
}
