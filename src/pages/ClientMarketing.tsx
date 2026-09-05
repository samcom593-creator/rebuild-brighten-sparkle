// ClientMarketing · mirrors AgentLink's "Client Marketing" sidebar item
// Pre-built marketing templates agents send to clients (DMs, post-sale follow-up,
// referral asks, holiday touches). Click-to-copy.

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Copy, Check, Search, Heart, Filter, Users, ArrowRight,
} from "lucide-react";
import { usePageTitle } from "@/hooks/usePageTitle";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

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

function MarketingTabs({ view, onChange }: { view: "clients" | "funnels"; onChange: (view: "clients" | "funnels") => void }) {
  return <div className="flex gap-1 border-b border-border"><Button variant="ghost" className={cn("rounded-none border-b-2", view === "clients" ? "border-primary text-foreground" : "border-transparent text-muted-foreground")} onClick={() => onChange("clients")}>Client Marketing</Button><Button variant="ghost" className={cn("rounded-none border-b-2", view === "funnels" ? "border-primary text-foreground" : "border-transparent text-muted-foreground")} onClick={() => onChange("funnels")}>Recruiting Funnels</Button></div>;
}

export default function ClientMarketing() {
  usePageTitle("Client Marketing · APEX");
  const [view, setView] = useState<"clients" | "funnels">("clients");
  const [search, setSearch] = useState("");
  const [activeCat, setActiveCat] = useState("All");
  const [copied, setCopied] = useState<string | null>(null);

  const [copyCounts, setCopyCounts] = useState<Record<string, number>>({});
  const funnelQ = useQuery({
    queryKey: ["recruiting-funnel-overview"],
    staleTime: 60_000,
    queryFn: async () => { const { data, error } = await supabase.from("applications").select("contacted_at,licensed_at,first_deal_at").or("is_duplicate.eq.false,is_duplicate.is.null"); if (error) throw error; return data; },
  });

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

  if (view === "funnels") {
    const records = funnelQ.data ?? [];
    const stages = [
      { label: "New", value: records.length, description: "Applications in scope" },
      { label: "Contacted", value: records.filter((row) => row.contacted_at).length, description: "First contact completed" },
      { label: "Licensed", value: records.filter((row) => row.licensed_at).length, description: "License approved" },
      { label: "First Sale", value: records.filter((row) => row.first_deal_at).length, description: "Activated producer" },
    ];
    return <div className="page-enter space-y-5 px-4 pb-24 sm:px-6">
      <PageHeader eyebrow="Recruiting" eyebrowIcon={<Users className="h-4 w-4" />} title="Recruiting Funnels" subtitle="See where applicants convert—and where follow-up is leaking." actions={<Button asChild size="sm"><Link to="/dashboard/recruiting">Open pipeline <ArrowRight className="ml-1 h-4 w-4" /></Link></Button>} />
      <MarketingTabs view={view} onChange={setView} />
      {funnelQ.error ? <Card><CardContent className="p-5 text-sm text-rose-600">Could not load funnel data: {(funnelQ.error as Error).message}</CardContent></Card> : <div className="grid gap-3 md:grid-cols-4">{stages.map((stage, index) => { const prior = index === 0 ? stage.value : stages[index - 1].value; const conversion = prior > 0 ? Math.round(stage.value / prior * 100) : 0; return <Card key={stage.label}><CardContent className="p-5"><p className="text-xs font-medium text-muted-foreground">{stage.label}</p><p className="mt-2 text-3xl font-semibold tabular-nums">{funnelQ.isLoading ? "—" : stage.value}</p><p className="mt-1 text-xs text-muted-foreground">{stage.description}</p>{index > 0 && <p className="mt-4 border-t border-border pt-3 text-xs"><span className="font-semibold">{conversion}%</span> from prior stage</p>}</CardContent></Card>; })}</div>}
      <Card><CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-semibold">Move the bottleneck</p><p className="mt-1 text-xs text-muted-foreground">Open the recruiting pipeline to contact, license, and activate the people represented here.</p></div><Button asChild variant="outline"><Link to="/dashboard/recruiting">Manage applicants</Link></Button></CardContent></Card>
    </div>;
  }

  return (
    <div className="page-enter px-4 sm:px-6 pb-24 space-y-5">
      <PageHeader
        eyebrow="Client"
        eyebrowIcon={<Heart className="h-3 w-3" />}
        title="Client Marketing"
        subtitle="Pre-written DM/SMS/email templates to send your clients post-sale. Pre-appointment confirms, onboarding, referrals, holidays. Click to copy."
        actions={<Badge variant="outline" className="text-11">{TEMPLATES.length} templates</Badge>}
      />
      <MarketingTabs view={view} onChange={setView} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[{ label: "Templates", value: TEMPLATES.length, note: "ready to send" }, { label: "Channels", value: `${channelCounts.sms}/${channelCounts.email}/${channelCounts.dm}`, note: "SMS · Email · DM" }, { label: "Categories", value: CATEGORIES.length, note: "touchpoint types" }, { label: "Most copied", value: mostCopied.title, note: mostCopied.count > 0 ? `${mostCopied.count}× this session` : "copy one to track" }].map((metric) => <Card key={metric.label}><CardContent className="p-4"><p className="text-xs text-muted-foreground">{metric.label}</p><p className="mt-1 truncate text-xl font-semibold tabular-nums" title={String(metric.value)}>{metric.value}</p><p className="text-xs text-muted-foreground">{metric.note}</p></CardContent></Card>)}
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
