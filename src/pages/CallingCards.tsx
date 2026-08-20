// CallingCards · mirrors AgentLink's "Calling Cards" sidebar item
// Digital business card generator — agents share with prospects via link or PDF.

import { useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  CreditCard, Download, Copy, Check, Share2, Phone, Mail, MapPin,
  Globe, Instagram, QrCode,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { usePageTitle } from "@/hooks/usePageTitle";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

const TEMPLATES = [
  { key: "classic",  label: "Classic Black",  bg: "bg-card",                 accent: "text-amber-400" },
  { key: "amber",    label: "APEX Amber",     bg: "bg-gradient-to-br from-amber-500 to-amber-700", accent: "text-white" },
  { key: "emerald",  label: "Producer Green", bg: "bg-gradient-to-br from-emerald-600 to-emerald-800", accent: "text-white" },
  { key: "white",    label: "Clean White",    bg: "bg-white text-slate-900 border border-slate-200", accent: "text-amber-600" },
] as const;

export default function CallingCards() {
  usePageTitle("Calling Cards · APEX");
  const { user } = useAuth();
  const userId = (user as any)?.id ?? null;
  const [template, setTemplate] = useState<typeof TEMPLATES[number]["key"]>("classic");
  const [copied, setCopied] = useState(false);

  const profile = useQuery({
    queryKey: ["profile-for-card", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles" as any)
        .select("full_name, email, phone, avatar_url, city, state, instagram_handle, photo_url")
        .eq("user_id", userId)
        .maybeSingle();
      return data as any;
    },
  });

  const shareUrl = useMemo(() => {
    if (typeof window === "undefined" || !userId) return "";
    return `${window.location.origin}/agent/${userId}`;
  }, [userId]);

  const t = TEMPLATES.find((x) => x.key === template)!;
  const p = profile.data;
  const name = p?.full_name || (user as any)?.email?.split("@")[0] || "APEX Agent";
  const avatar = p?.avatar_url || p?.photo_url;

  // Hero metrics
  const styleOptions = TEMPLATES.length;
  const shareReady = !!shareUrl && !!userId;
  const qrScannable = shareReady; // QR generates from shareUrl
  const profileFields = ["full_name", "email", "phone", "city", "state", "instagram_handle"] as const;
  const filledCount = profileFields.reduce((n, f) => n + (p?.[f] ? 1 : 0), 0);
  const fieldsPct = Math.round((filledCount / profileFields.length) * 100);

  const copyLink = async () => {
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    toast.success("Card link copied");
    setTimeout(() => setCopied(false), 2000);
  };

  const shareCard = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: `${name} · APEX Financial`, text: "My APEX calling card", url: shareUrl });
      } catch { /* user cancelled */ } // empty-catch-allow:user-cancelled
    } else copyLink();
  };

  return (
    <div className="page-enter px-4 sm:px-6 pb-24 space-y-5">
      <PageHeader
        eyebrow="Account"
        eyebrowIcon={<CreditCard className="h-3 w-3" />}
        title="Calling Cards"
        subtitle="Your digital business card. Share via link, QR code, or screenshot. Profile data pulls from /dashboard/profile."
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link to="/dashboard/profile">Edit Profile →</Link>
          </Button>
        }
      />

      {/* Premium gradient hero — v6 §31 */}
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
              <p className="text-[11px] uppercase tracking-[0.32em] font-bold text-amber-300">CALLING CARD · LIVE</p>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
            <div>
              <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">STYLE OPTIONS</p>
              <p className="text-[28px] leading-none font-black tabular-nums text-white">{styleOptions}</p>
              <p className="text-[10px] text-white/40 tabular-nums">templates to pick</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">SHARE URL</p>
              <p className="text-[28px] leading-none font-black tabular-nums text-white">{shareReady ? "Ready" : "—"}</p>
              <p className="text-[10px] text-white/40 tabular-nums">{shareReady ? "link is live" : "sign in to generate"}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">QR SCANNABLE</p>
              <p className="text-[28px] leading-none font-black tabular-nums text-white">{qrScannable ? "Yes" : "—"}</p>
              <p className="text-[10px] text-white/40 tabular-nums">{qrScannable ? "tap Show QR" : "link required"}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">PROFILE FILLED</p>
              <p className="text-[28px] leading-none font-black tabular-nums text-white">{fieldsPct}%</p>
              <p className="text-[10px] text-white/40 tabular-nums">{filledCount}/{profileFields.length} fields</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* Template picker */}
        <div className="space-y-3">
          <h3 className="text-13 font-bold">Pick a style</h3>
          <div className="space-y-2">
            {TEMPLATES.map((tpl) => (
              <button
                key={tpl.key}
                onClick={() => setTemplate(tpl.key)}
                className={`w-full p-3 rounded-lg border text-left transition-base ${
                  template === tpl.key ? "border-amber-500 bg-amber-500/10" : "border-border hover:bg-muted/30"
                }`}
              >
                <div className={`h-8 w-full rounded ${tpl.bg} ${tpl.accent} flex items-center justify-center text-11 font-bold`}>
                  {tpl.label}
                </div>
              </button>
            ))}
          </div>

          <div className="pt-3 border-t border-border space-y-2">
            <h3 className="text-13 font-bold">Share</h3>
            <Button onClick={copyLink} className="w-full" variant="outline">
              {copied ? <><Check className="h-3.5 w-3.5 mr-2" /> Copied!</> : <><Copy className="h-3.5 w-3.5 mr-2" /> Copy Link</>}
            </Button>
            <Button onClick={shareCard} className="w-full">
              <Share2 className="h-3.5 w-3.5 mr-2" /> Share Card
            </Button>
            <Button
              className="w-full"
              variant="outline"
              onClick={() => {
                window.open(`https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(shareUrl)}`, "_blank", "noopener,noreferrer");
              }}
            >
              <QrCode className="h-3.5 w-3.5 mr-2" /> Show QR
            </Button>
          </div>
        </div>

        {/* Card preview */}
        <div className="lg:col-span-2">
          <Card>
            <CardContent className="p-5">
              <div className="aspect-[1.75/1] w-full max-w-md mx-auto rounded-2xl shadow-2xl overflow-hidden">
                <div className={`h-full w-full ${t.bg} p-6 flex flex-col justify-between`}>
                  <div className="flex items-start justify-between">
                    <div>
                      <p className={`text-10 uppercase tracking-[0.2em] font-bold ${t.accent}`}>APEX FINANCIAL</p>
                      <p className={`text-11 mt-0.5 ${template === "white" ? "text-slate-600" : "text-white/70"}`}>
                        Hold the Standard
                      </p>
                    </div>
                    {avatar ? (
                      <img src={avatar} alt="" className="h-12 w-12 rounded-full object-cover ring-2 ring-white/30" />
                    ) : (
                      <div className="h-12 w-12 rounded-full bg-white/20 flex items-center justify-center text-13 font-bold text-white">
                        {name.split(" ").map((s: string) => s[0]).slice(0, 2).join("")}
                      </div>
                    )}
                  </div>
                  <div>
                    <p className={`text-18 font-bold ${template === "white" ? "text-slate-900" : "text-white"}`}>{name}</p>
                    <p className={`text-11 mt-0.5 ${template === "white" ? "text-slate-600" : "text-white/80"}`}>
                      Licensed Insurance Producer
                    </p>
                    <div className={`mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-11 ${template === "white" ? "text-slate-700" : "text-white/90"}`}>
                      {p?.phone && <p className="flex items-center gap-1.5"><Phone className="h-2.5 w-2.5" /> {p.phone}</p>}
                      {p?.email && <p className="flex items-center gap-1.5 truncate"><Mail className="h-2.5 w-2.5 shrink-0" /> {p.email}</p>}
                      {(p?.city || p?.state) && <p className="flex items-center gap-1.5"><MapPin className="h-2.5 w-2.5" /> {[p?.city, p?.state].filter(Boolean).join(", ")}</p>}
                      {p?.instagram_handle && <p className="flex items-center gap-1.5"><Instagram className="h-2.5 w-2.5" /> {p.instagram_handle}</p>}
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-5 text-center">
                <p className="text-12 text-muted-foreground mb-1">Shareable link:</p>
                <Badge variant="outline" className="text-11 break-all">{shareUrl}</Badge>
              </div>

              {!profile.data?.full_name && (
                <div className="mt-4 p-3 rounded-md bg-amber-500/10 border border-amber-500/30">
                  <p className="text-12 text-amber-700 dark:text-amber-300">
                    Your profile is missing a full name. Go to <Link to="/dashboard/profile" className="underline font-semibold">Producer Profile</Link> to fill it in — your card uses that info.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
