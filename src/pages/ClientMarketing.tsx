// ClientMarketing · mirrors AgentLink's "Client Marketing" sidebar item
// Pre-built marketing templates agents send to clients (DMs, post-sale follow-up,
// referral asks, holiday touches). Click-to-copy.

import { useState, useMemo } from "react";
import {
  Copy, Check, Search, Heart, Filter,
} from "lucide-react";
import { usePageTitle } from "@/hooks/usePageTitle";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

interface Template {
  title: string;
  category: string;
  channel: "sms" | "email" | "dm";
  body: string;
}

const TEMPLATES: Template[] = [
  {
    title: "Pre-Appointment Confirm", category: "Pre-Sale", channel: "sms",
    body: `Hey {first_name}, this is {agent_name} confirming our appointment at {time} today to go over your protection options. Looking forward to it — reply C to confirm or R to reschedule.`,
  },
  {
    title: "Quote Follow-Up (24h)", category: "Pre-Sale", channel: "sms",
    body: `Hi {first_name}, {agent_name} again — I'm holding your quote at the rate we discussed. Carrier locks the rate based on today's health, so the longer we wait, the more your premium could go up. Want me to circle back at {time_slot}?`,
  },
  {
    title: "Welcome to APEX Coverage", category: "Onboarding", channel: "email",
    body: `Hi {first_name},

Welcome to {carrier_name}. Your coverage is officially in force as of {effective_date}.

Quick things to keep handy:
• Policy #: {policy_number}
• Carrier contact: {carrier_phone}
• Your draft date: {draft_date}
• My direct line: {agent_phone}

If you ever need to update your beneficiary, change your bank info, or file a claim, message me first. I'll walk you through it.

Talk soon,
{agent_name}`,
  },
  {
    title: "30-Day Check-In", category: "Onboarding", channel: "sms",
    body: `Hey {first_name}, {agent_name} here. It's been ~30 days since we put your coverage in place. Two quick questions: (1) did the first draft hit your bank cleanly? (2) any questions you want me to answer? I'm here.`,
  },
  {
    title: "60/90-Day Retention", category: "Onboarding", channel: "sms",
    body: `Hi {first_name}, hope all is well. Just doing my routine check-in — your coverage is active and protecting your family. If anyone close to you needs the same conversation, I'd be honored to help. Anyone come to mind?`,
  },
  {
    title: "Referral Ask (Soft)", category: "Referral", channel: "sms",
    body: `Hey {first_name} — quick favor. If you know 2-3 people who'd benefit from the kind of conversation we had, would you mind sending them my way? I treat them as well as I treated you. No pressure — only if it feels right.`,
  },
  {
    title: "Referral Ask (Direct)", category: "Referral", channel: "dm",
    body: `Hey {first_name} 👋 do you have 2 names of friends/family I could help with the same coverage convo? I'll keep it short, treat them right, and report back to you either way. Worth a try?`,
  },
  {
    title: "Birthday Touch", category: "Touch", channel: "sms",
    body: `Happy birthday {first_name}! Hope you celebrate well today. Reminder — your coverage is locked at the rate we set, so this birthday doesn't change a thing for you. Talk soon.`,
  },
  {
    title: "Holiday — Thanksgiving", category: "Touch", channel: "sms",
    body: `Hey {first_name}, hope you and the family have a great Thanksgiving. Just wanted to say I'm grateful you trusted me with your family's protection. Talk soon.`,
  },
  {
    title: "Holiday — Christmas", category: "Touch", channel: "sms",
    body: `Hey {first_name}, Merry Christmas from my family to yours. Hope it's a great one — wishing you peace and rest this season.`,
  },
  {
    title: "Beneficiary Update Reminder", category: "Maintenance", channel: "sms",
    body: `Hi {first_name}, quick reminder — life changes (marriage, new baby, divorce, etc) can mean your beneficiary needs an update. If anything has changed, message me and we'll update the carrier in 2 min.`,
  },
  {
    title: "Annual Review", category: "Maintenance", channel: "email",
    body: `Hi {first_name},

It's been about a year since we set up your coverage. Time for a 10-minute annual review:

• Has your income, family size, or financial picture changed?
• Have you taken on new debt (mortgage, kids' college, business)?
• Is your beneficiary still correct?
• Are there any close family members who SHOULD have coverage but don't?

Reply with a good time and I'll run through this with you on the phone. Won't take long.

— {agent_name}`,
  },
];

const CHANNEL_LABEL: Record<string, string> = {
  sms: "SMS", email: "Email", dm: "DM",
};

const CHANNEL_COLOR: Record<string, string> = {
  sms:   "bg-emerald-500/15 border-emerald-500/30 text-emerald-700 dark:text-emerald-300",
  email: "bg-amber-500/15 border-amber-500/30 text-amber-700 dark:text-amber-300",
  dm:    "bg-slate-500/15 border-slate-500/30 text-slate-700 dark:text-slate-300",
};

const CATEGORIES = Array.from(new Set(TEMPLATES.map((t) => t.category)));

export default function ClientMarketing() {
  usePageTitle("Client Marketing · APEX");
  const [search, setSearch] = useState("");
  const [activeCat, setActiveCat] = useState("All");
  const [copied, setCopied] = useState<string | null>(null);

  const [copyCounts, setCopyCounts] = useState<Record<string, number>>({});

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return TEMPLATES.filter((t) => {
      if (activeCat !== "All" && t.category !== activeCat) return false;
      if (!q) return true;
      return t.title.toLowerCase().includes(q) || t.body.toLowerCase().includes(q);
    });
  }, [search, activeCat]);

  const channelCounts = useMemo(() => {
    const sms = TEMPLATES.filter((t) => t.channel === "sms").length;
    const email = TEMPLATES.filter((t) => t.channel === "email").length;
    const dm = TEMPLATES.filter((t) => t.channel === "dm").length;
    return { sms, email, dm };
  }, []);

  const mostCopied = useMemo(() => {
    const entries = Object.entries(copyCounts);
    if (entries.length === 0) return { title: "—", count: 0 };
    const top = entries.sort((a, b) => b[1] - a[1])[0];
    return { title: top[0], count: top[1] };
  }, [copyCounts]);

  const copy = async (t: Template) => {
    await navigator.clipboard.writeText(t.body);
    setCopied(t.title);
    setCopyCounts((prev) => ({ ...prev, [t.title]: (prev[t.title] ?? 0) + 1 }));
    toast.success(`Copied: ${t.title}`);
    setTimeout(() => setCopied(null), 2000);
  };

  return (
    <div className="page-enter px-4 sm:px-6 pb-24 space-y-5">
      <PageHeader
        eyebrow="Client"
        eyebrowIcon={<Heart className="h-3 w-3" />}
        title="Client Marketing"
        subtitle="Pre-written DM/SMS/email templates to send your clients post-sale. Pre-appointment confirms, onboarding, referrals, holidays. Click to copy."
        actions={<Badge variant="outline" className="text-11">{TEMPLATES.length} templates</Badge>}
      />

      <div className="relative overflow-hidden rounded-3xl border border-amber-500/25 bg-gradient-to-br from-slate-950 via-slate-900 to-amber-950 text-white shadow-[0_0_48px_-12px_hsl(168_70%_45%/0.25)]">
        <div className="absolute -top-24 -right-24 h-72 w-72 rounded-full bg-amber-500/15 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-32 -left-24 h-80 w-80 rounded-full bg-emerald-500/10 blur-3xl pointer-events-none" />
        <div className="relative p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75 animate-ping" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-500" />
              </span>
              <p className="text-[11px] uppercase tracking-[0.32em] font-bold text-amber-300">CLIENT MARKETING · LIVE</p>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
            <div>
              <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">TEMPLATES</p>
              <p className="text-[28px] leading-none font-black tabular-nums text-white">{TEMPLATES.length}</p>
              <p className="text-[10px] text-white/40 tabular-nums">ready to send</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">CHANNELS</p>
              <p className="text-[28px] leading-none font-black tabular-nums text-white">
                {channelCounts.sms}<span className="text-white/40">/</span>{channelCounts.email}<span className="text-white/40">/</span>{channelCounts.dm}
              </p>
              <p className="text-[10px] text-white/40 tabular-nums">SMS · Email · DM</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">CATEGORIES</p>
              <p className="text-[28px] leading-none font-black tabular-nums text-white">{CATEGORIES.length}</p>
              <p className="text-[10px] text-white/40 tabular-nums">touchpoint types</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">MOST COPIED</p>
              <p className="text-[18px] leading-tight font-black text-white truncate" title={mostCopied.title}>{mostCopied.title}</p>
              <p className="text-[10px] text-white/40 tabular-nums">{mostCopied.count > 0 ? `${mostCopied.count}× this session` : "copy one to track"}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search templates…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex gap-1 overflow-x-auto pb-1">
          <button
            onClick={() => setActiveCat("All")}
            className={`px-3 py-1.5 rounded-md text-12 font-medium whitespace-nowrap transition-base ${
              activeCat === "All" ? "bg-amber-500 text-white" : "bg-muted text-foreground hover:bg-muted/80"
            }`}
          >All ({TEMPLATES.length})</button>
          {CATEGORIES.map((c) => {
            const count = TEMPLATES.filter((t) => t.category === c).length;
            return (
              <button
                key={c}
                onClick={() => setActiveCat(c)}
                className={`px-3 py-1.5 rounded-md text-12 font-medium whitespace-nowrap transition-base ${
                  activeCat === c ? "bg-amber-500 text-white" : "bg-muted text-foreground hover:bg-muted/80"
                }`}
              >{c} ({count})</button>
            );
          })}
        </div>
      </div>

      {filtered.length === 0 ? (
        <Card><CardContent className="p-8 text-center text-13 text-muted-foreground">
          <Filter className="h-6 w-6 mx-auto mb-2 opacity-50" />
          Nothing in this filter. Loosen the search or jump back to "All" — your clients can't read a template you don't send.
        </CardContent></Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {filtered.map((t) => {
            const isCopied = copied === t.title;
            return (
              <Card key={t.title} className="hover:bg-muted/20 transition-base">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-14 font-bold leading-tight">{t.title}</p>
                      <div className="flex items-center gap-1.5 mt-1">
                        <Badge variant="outline" className="text-11">{t.category}</Badge>
                        <Badge variant="outline" className={`text-11 ${CHANNEL_COLOR[t.channel]}`}>
                          {CHANNEL_LABEL[t.channel]}
                        </Badge>
                      </div>
                    </div>
                    <Button
                      variant={isCopied ? "default" : "outline"}
                      size="sm"
                      className={isCopied ? "bg-emerald-600 hover:bg-emerald-700" : ""}
                      onClick={() => copy(t)}
                    >
                      {isCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                  <pre className="text-12 text-foreground/85 whitespace-pre-wrap font-sans leading-relaxed bg-muted/30 rounded-md p-3 max-h-44 overflow-auto">
                    {t.body}
                  </pre>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
