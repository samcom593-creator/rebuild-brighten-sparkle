// MyLandingPage · mirrors AgentLink's "My Landing Page" sidebar item
// Per-agent public landing page · shareable URL · branded · CTA to contact agent.
//
// Live URL pattern: /agent/:userId — public route (no auth required).
// This page is the AGENT-FACING settings/preview for that public surface.

import { useState } from "react";
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

  const url = userId && typeof window !== "undefined" ? `${window.location.origin}/agent/${userId}` : "";
  const p = profile.data;
  const name = p?.full_name || (user as any)?.email?.split("@")[0] || "APEX Agent";
  const avatar = p?.avatar_url || p?.photo_url;

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
                  <Badge className="mt-3 bg-amber-500 text-slate-900 hover:bg-amber-500">Licensed · Active</Badge>
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
              <h3 className="text-13 font-bold">Edit Profile Drives the Page</h3>
              <p className="text-12 text-muted-foreground leading-relaxed">
                Your landing page reads directly from your Producer Profile:
              </p>
              <ul className="text-12 space-y-1.5 text-foreground/80">
                <li className="flex items-center gap-2"><ImageIcon className="h-3 w-3 text-amber-500" /> Avatar URL → hero photo</li>
                <li className="flex items-center gap-2"><Globe className="h-3 w-3 text-amber-500" /> Bio → "About Me" block</li>
                <li className="flex items-center gap-2"><Phone className="h-3 w-3 text-amber-500" /> Phone/Email/IG → CTAs</li>
              </ul>
              <Button asChild className="w-full" variant="outline">
                <a href="/dashboard/profile">Edit Profile →</a>
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
