import { Link2, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ToneBubble, TonePill } from "@/components/ui/delight/ToneBubble";
import { useAuth } from "@/hooks/useAuth";
import { ownLinkUrl } from "@/lib/recruitLinks";
import { linkLifetimeTone } from "@/lib/tones";
import { LinkShareRow } from "./LinkShareRow";
import { WrappableUrl } from "./WrappableUrl";
import { useMyRecruitingLink } from "./invitationApi";

/**
 * "Your link": the viewer's own permanent /r/<slug> link at the top of Invite an agent and
 * Refer a recruit (OVERHAUL-1, 2026-10-29). One tap, no form: Copy, or Share through the
 * phone's own share sheet.
 *
 * The slug comes only from my_recruiting_link() (auth.uid()-scoped). Everyone who applies
 * through the link is credited to its owner: /r/<slug> -> /apply?ref=<slug> -> resolve-ref-slug
 * -> submit-application writes recruiter_id, referral_manager_id and referral_recruiter_id, and
 * add-agent places the hire under that person (MP-342). Nothing on this card can expire it.
 */
export function MyLinkCard({ blurb }: { blurb: string }) {
  const { user } = useAuth();
  const linkQ = useMyRecruitingLink(user?.id);
  const url = linkQ.data?.active ? ownLinkUrl(linkQ.data.ref_slug) : null;

  return (
    <section aria-labelledby="my-link-title" className="rounded-xl border border-border bg-card p-4 sm:p-5" data-testid="my-link-card">
      <div className="flex items-start gap-3">
        <ToneBubble tone="gold" size="md" className="mt-0.5">
          <Link2 />
        </ToneBubble>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h2 id="my-link-title" className="text-lg font-semibold leading-6 text-foreground">Your link</h2>
            {url && <TonePill tone={linkLifetimeTone("permanent")}>Permanent</TonePill>}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{blurb}</p>
        </div>
      </div>

      {linkQ.isLoading ? (
        <p className="mt-3 flex min-h-11 items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading your link…
        </p>
      ) : linkQ.error ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <p role="alert" className="text-sm text-destructive">
            Your link could not be loaded{typeof (linkQ.error as { message?: unknown }).message === "string" && (linkQ.error as { message: string }).message
              ? `: ${(linkQ.error as { message: string }).message}`
              : "."}
          </p>
          <Button variant="outline" className="h-11" onClick={() => void linkQ.refetch()}>Try again</Button>
        </div>
      ) : url ? (
        <>
          {/* The whole link, selectable. It wraps after the last slash first, so on a phone the slug
              keeps to one line, and breaks inside a word only when a slug is longer than the line. */}
          <p className="mt-3 select-all rounded-lg border border-border bg-background px-3 py-2.5 font-mono text-[15px] leading-snug text-foreground [overflow-wrap:anywhere]" data-testid="my-link-url">
            <WrappableUrl url={url.replace(/^https:\/\//, "")} />
          </p>
          <LinkShareRow url={url} kind="own" actions={["copy", "share"]} className="mt-3" />
        </>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">
          You do not have a personal link yet. Every active agent account gets one.
        </p>
      )}
    </section>
  );
}
