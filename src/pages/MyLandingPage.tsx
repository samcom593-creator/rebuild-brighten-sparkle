// MyLandingPage · mirrors AgentLink's "My Landing Page" sidebar item
// Per-agent public landing page · shareable URL · branded · CTA to contact agent.
//
// Live URL pattern: /agent/:userId. Public route, no auth required.
// This page is the AGENT-FACING settings/preview for that public surface.

import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Globe, Phone, Mail, ExternalLink, Copy, Check, Eye, Share2,
  Sparkles, Image as ImageIcon,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { usePageTitle } from "@/hooks/usePageTitle";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

export default function MyLandingPage() {
  usePageTitle("My Landing Page · APEX");
  const { user } = useAuth();
  const userId = (user as any)?.id ?? null;
  const [copied, setCopied] = useState(false);

  const profile = useQuery({
    queryKey: ["profile-for-landing", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles" as any)
        .select("full_name, email, phone, avatar_url, bio, city, state, instagram_handle, photo_url")
        .eq("user_id", userId)
        .maybeSingle();
      return data as any;
    },
  });

  // Wave-15 brand-truth (parity with wave-6 PublicAgentLanding fix): the
  // hardcoded "Licensed · Active" badge on the preview surface told any
  // unlicensed agent viewing their own landing page that they were "Licensed
  // · Active" — same fake-credential disease that was killed on the public
  // /agent/:userId surface. Data-bind to agents.license_status + status.
  const agentStatus = useQuery({
    queryKey: ["agent-status-for-landing", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase
        .from("agents" as any)
        .select("license_status, status")
        .eq("user_id", userId)
        .maybeSingle();
      return (data as any) ?? null;
    },
  });

  const url = userId && typeof window !== "undefined" ? `${window.location.origin}/agent/${userId}` : "";
  const p = profile.data;
  const a = agentStatus.data;
  const isLicensedActive = a?.license_status === "licensed" && a?.status === "active";
  const name = p?.full_name || (user as any)?.email?.split("@")[0] || "APEX Agent";
  const avatar = p?.avatar_url || p?.photo_url;

  // Hero metrics. Derived from profile data.
  const urlStatus = userId ? "LIVE" : "—";
  const profileFields = ["full_name", "email", "phone", "bio", "city", "state", "instagram_handle"] as const;
  const profileFilled = p ? profileFields.filter((k) => !!(p as any)?.[k]).length : 0;
  const profilePct = Math.round((profileFilled / profileFields.length) * 100);
  const bioLen = p?.bio ? String(p.bio).length : 0;
  const hasPhoto = !!avatar;

  const copyUrl = async () => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    toast.success("Landing URL copied");
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="page-enter px-4 sm:px-6 pb-24 space-y-5">
      <PageHeader
        eyebrow="Account"
        eyebrowIcon={<Globe className="h-3 w-3" />}
        title="My Landing Page"
        subtitle="Your personal public landing page. Share with prospects. Profile fields drive the content."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" asChild>
              <a href={url} target="_blank" rel="noopener noreferrer">
                <Eye className="h-3.5 w-3.5 mr-1.5" /> Preview Live
              </a>
            </Button>
            <Button size="sm" onClick={copyUrl}>
              {copied ? <><Check className="h-3.5 w-3.5 mr-1.5" /> Copied</> : <><Copy className="h-3.5 w-3.5 mr-1.5" /> Copy URL</>}
            </Button>
          </div>
        }
      />

      {/* Premium gradient hero. v6 §31. */}
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
              <p className="text-[11px] uppercase tracking-[0.32em] font-bold text-amber-300">YOUR PUBLIC LANDING · LIVE</p>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
            <div>
              <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">PUBLIC URL</p>
              <p className="text-[28px] leading-none font-black tabular-nums text-foreground">{urlStatus}</p>
              <p className="text-[10px] text-white/40 tabular-nums">{userId ? "shareable now" : "sign in to publish"}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">PROFILE COMPLETE</p>
              <p className="text-[28px] leading-none font-black tabular-nums text-foreground">{profilePct}%</p>
              <p className="text-[10px] text-white/40 tabular-nums">{profileFilled}/{profileFields.length} fields</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">BIO LENGTH</p>
              <p className="text-[28px] leading-none font-black tabular-nums text-foreground">{bioLen}</p>
              <p className="text-[10px] text-white/40 tabular-nums">characters</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">HAS PHOTO</p>
              <p className="text-[28px] leading-none font-black tabular-nums text-foreground">{hasPhoto ? "YES" : "NO"}</p>
              <p className="text-[10px] text-white/40 tabular-nums">{hasPhoto ? "avatar set" : "add one. 3x more clicks"}</p>
            </div>
          </div>
        </div>
      </div>

      {/* URL banner */}
      <Card className="border-amber-500/30 bg-amber-500/5">
        <CardContent className="p-4 flex items-center gap-3">
          <Globe className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-11 text-muted-foreground uppercase tracking-wider mb-0.5">Public URL</p>
            <p className="text-13 font-mono truncate">{url}</p>
          </div>
          <Button variant="outline" size="sm" asChild>
            <a href={url} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </Button>
        </CardContent>
      </Card>

      {/* Preview */}
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardContent className="p-0 overflow-hidden">
            {profile.isLoading ? (
              <Skeleton className="h-96" />
            ) : (
              <div>
                {/* Hero band */}
                <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-amber-900 text-white p-8 text-center">
                  {avatar ? (
                    <img src={avatar} alt="" className="h-24 w-24 rounded-full object-cover mx-auto ring-4 ring-amber-400/40 mb-3" />
                  ) : (
                    <div className="h-24 w-24 rounded-full bg-amber-500/30 mx-auto ring-4 ring-amber-400/40 mb-3 flex items-center justify-center text-24 font-bold">
                      {name.split(" ").map((s: string) => s[0]).slice(0, 2).join("")}
                    </div>
                  )}
                  <p className="text-11 uppercase tracking-[0.25em] text-amber-300 mb-1">APEX Financial Producer</p>
                  <h2 className="text-22 font-bold">{name}</h2>
                  {(p?.city || p?.state) && (
                    <p className="text-12 text-white/70 mt-1">{[p?.city, p?.state].filter(Boolean).join(", ")}</p>
                  )}
                  {isLicensedActive ? (
                    <Badge className="mt-3 bg-amber-500 text-slate-900 hover:bg-amber-500">Licensed · Active</Badge>
                  ) : null}
                </div>

                {/* Bio */}
                {p?.bio && (
                  <div className="p-6 border-b border-border">
                    <p className="text-11 uppercase tracking-wider text-muted-foreground mb-2">About Me</p>
                    <p className="text-13 text-foreground/85 leading-relaxed whitespace-pre-line">{p.bio}</p>
                  </div>
                )}

                {/* Contact CTAs */}
                <div className="p-6 space-y-2">
                  <p className="text-11 uppercase tracking-wider text-muted-foreground mb-2">Get in Touch</p>
                  {p?.phone && (
                    <a href={`tel:${p.phone}`} className="flex items-center gap-3 p-3 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 transition-base">
                      <Phone className="h-4 w-4 text-emerald-600" />
                      <span className="text-13 font-medium">{p.phone}</span>
                    </a>
                  )}
                  {p?.email && (
                    <a href={`mailto:${p.email}`} className="flex items-center gap-3 p-3 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 transition-base">
                      <Mail className="h-4 w-4 text-amber-600" />
                      <span className="text-13 font-medium truncate">{p.email}</span>
                    </a>
                  )}
                  {p?.instagram_handle && (
                    <a
                      href={`https://instagram.com/${p.instagram_handle.replace("@", "")}`}
                      target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-3 p-3 rounded-lg bg-pink-500/10 hover:bg-pink-500/20 transition-base"
                    >
                      <Sparkles className="h-4 w-4 text-pink-600" />
                      <span className="text-13 font-medium">{p.instagram_handle}</span>
                    </a>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Editor sidebar */}
        <div className="space-y-3">
          <Card>
            <CardContent className="p-4 space-y-3">
              <h3 className="text-13 font-bold">Your Profile Drives This Page</h3>
              <p className="text-12 text-muted-foreground leading-relaxed">
                Your landing page reads directly from your Producer Profile:
              </p>
              <ul className="text-12 space-y-1.5 text-foreground/80">
                <li className="flex items-center gap-2"><ImageIcon className="h-3 w-3 text-amber-500" /> Avatar URL → hero photo</li>
                <li className="flex items-center gap-2"><Globe className="h-3 w-3 text-amber-500" /> Bio → "About Me" block</li>
                <li className="flex items-center gap-2"><Phone className="h-3 w-3 text-amber-500" /> Phone/Email/IG → CTAs</li>
              </ul>
              <Button asChild className="w-full" variant="outline">
                <Link to="/dashboard/profile">Edit Profile →</Link>
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <h3 className="text-13 font-bold mb-2 flex items-center gap-1.5"><Share2 className="h-3.5 w-3.5 text-emerald-500" /> Share Tips</h3>
              <ul className="text-12 text-foreground/80 space-y-1.5">
                <li>• Pin the URL in your IG bio</li>
                <li>• Drop it in your email signature</li>
                <li>• QR code on physical biz cards (Calling Cards page)</li>
                <li>• DM the link instead of asking for phone numbers</li>
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
