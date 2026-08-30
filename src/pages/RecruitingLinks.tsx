import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Copy, Link2, MessageSquareShare, QrCode, Search, Share2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { resolveBrand } from "@/config/brand";
import { usePageTitle } from "@/hooks/usePageTitle";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * RecruitingLinks — admin surface for sending out recruiting links UNDER any
 * manager (MP-342, Sam: "make me able to send out links under managers").
 *
 * Every active agent already has a stable ref_slug; /r/<slug> is the short
 * link Sam can text or DM. Applying through it writes recruiter_id +
 * referral_manager_id + referral_recruiter_id (submit-application, with the
 * 2026-06-29 anti-theft no-overwrite), and add-agent places the hire under
 * that manager (agents.manager_id). This page is only the missing READ:
 * my_recruiting_link() is deliberately auth.uid()-scoped, so until now nobody
 * — including Sam — could grab another person's link without impersonating
 * them. admin_recruiting_links() is the admin-gated roster read.
 */

const SITE = "https://apex-financial.org";
const BRAND = resolveBrand();

interface LinkRow {
  agent_id: string;
  display_name: string | null;
  account_mode: string;
  is_manager: boolean;
  ref_slug: string | null;
  avatar_url: string | null;
}

const MODE_LABEL: Record<string, string> = {
  agency_owner: "Agency Owner",
  manager: "Manager",
  admin: "Admin",
  recruiter: "Recruiter",
  agent: "Agent",
  va: "VA",
  va_manager: "VA Manager",
};

function shortLink(slug: string): string {
  return `${SITE}/r/${slug}`;
}
function fullLink(slug: string): string {
  return `${SITE}/apply?ref=${encodeURIComponent(slug)}`;
}

async function copyText(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  } catch {
    toast.error("Could not copy — long-press the link text instead.");
  }
}

function LinkActions({ row }: { row: LinkRow }) {
  if (!row.ref_slug) {
    return <Badge variant="outline" className="text-muted-foreground">no link yet</Badge>;
  }
  const short = shortLink(row.ref_slug);
  const name = row.display_name ?? "our team";
  const smsBody = encodeURIComponent(
    `Here's the application link for ${name}'s team at ${BRAND.legalName}: ${short}`,
  );
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Button size="sm" variant="secondary" className="h-8" onClick={() => void copyText(short, "Short link")}>
        <Copy className="h-3.5 w-3.5 mr-1.5" aria-hidden />
        {`/r/${row.ref_slug}`}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-8"
        aria-label={`Copy full apply link for ${name}`}
        onClick={() => void copyText(fullLink(row.ref_slug as string), "Full link")}
      >
        <Link2 className="h-3.5 w-3.5" aria-hidden />
      </Button>
      <Button size="sm" variant="ghost" className="h-8" aria-label={`Text this link`} asChild>
        <a href={`sms:?&body=${smsBody}`}>
          <MessageSquareShare className="h-3.5 w-3.5" aria-hidden />
        </a>
      </Button>
      {typeof navigator !== "undefined" && "share" in navigator && (
        <Button
          size="sm"
          variant="ghost"
          className="h-8"
          aria-label={`Share ${name}'s link`}
          onClick={() => {
            void navigator
              .share({ title: `Join ${name} at ${BRAND.legalName}`, url: short })
              .catch(() => {/* empty-catch-allow:user-cancelled-share */});
          }}
        >
          <Share2 className="h-3.5 w-3.5" aria-hidden />
        </Button>
      )}
    </div>
  );
}

export default function RecruitingLinks() {
  usePageTitle("Recruiting Links");
  const [search, setSearch] = useState("");

  const linksQ = useQuery({
    queryKey: ["admin-recruiting-links"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_recruiting_links" as never);
      if (error) throw error;
      return (data ?? []) as unknown as LinkRow[];
    },
    staleTime: 60_000,
  });

  const rows = linksQ.data ?? [];
  const managers = rows.filter((r) => r.is_manager || r.account_mode === "agency_owner");
  const everyoneElse = useMemo(() => {
    const rest = rows.filter((r) => !(r.is_manager || r.account_mode === "agency_owner"));
    const q = search.trim().toLowerCase();
    if (!q) return rest;
    return rest.filter((r) => (r.display_name ?? "").toLowerCase().includes(q) || (r.ref_slug ?? "").includes(q));
  }, [rows, search]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Recruiting"
        eyebrowIcon={<QrCode className="h-3.5 w-3.5" aria-hidden />}
        title="Recruiting Links"
        subtitle="Send an application link under any manager. Whoever applies through it is credited to them and hired onto their team."
      />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Managers &amp; agency owners</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1">
          {linksQ.isLoading && (
            <div className="space-y-2">
              {/* stable synthetic keys for a fixed-size skeleton, never row identity */}
              {["sk-a", "sk-b", "sk-c"].map((k) => (
                <Skeleton key={k} className="h-10 w-full" />
              ))}
            </div>
          )}
          {linksQ.isError && (
            <p className="text-sm text-destructive">
              Couldn&apos;t load links: {(linksQ.error as Error).message}
            </p>
          )}
          {!linksQ.isLoading && !linksQ.isError && managers.length === 0 && (
            <p className="text-sm text-muted-foreground">No active managers found.</p>
          )}
          {managers.map((r) => (
            <div
              key={r.agent_id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/60 px-3 py-2"
            >
              <div className="min-w-0">
                <div className="font-medium text-sm truncate">{r.display_name ?? "(unnamed)"}</div>
                <div className="text-xs text-muted-foreground">{MODE_LABEL[r.account_mode] ?? r.account_mode}</div>
              </div>
              <LinkActions row={r} />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3 space-y-2">
          <CardTitle className="text-base">Everyone else</CardTitle>
          <div className="relative max-w-xs">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search agents…"
              className="pl-8 h-9"
              aria-label="Search agents"
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-1">
          {everyoneElse.map((r) => (
            <div
              key={r.agent_id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/40 px-3 py-1.5"
            >
              <div className="text-sm truncate">{r.display_name ?? "(unnamed)"}</div>
              <LinkActions row={r} />
            </div>
          ))}
          {!linksQ.isLoading && everyoneElse.length === 0 && (
            <p className="text-sm text-muted-foreground">No matches.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
