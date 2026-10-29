import { useEffect, useRef, useState } from "react";
import { Check, Copy, Mail, MessageSquare, Share2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { playSoundEffect } from "@/hooks/useSoundEffects";
import { resolveBrand } from "@/config/brand";
import {
  canTextFromDevice,
  emailHref,
  linkSentence,
  linkText,
  shareLink,
  textHref,
  type InviteLinkKind,
  type ShareChannel,
} from "@/lib/recruitLinks";
import { cn } from "@/lib/utils";

const BRAND = resolveBrand();

export type ShareAction = "copy" | "share" | "text" | "email";

const ALL_ACTIONS: readonly ShareAction[] = ["copy", "share", "text", "email"];

/**
 * Copy, Share, Text, Email for one link, in one row (OVERHAUL-1, 2026-10-29).
 *
 * Every button hands the link to the person and nothing is sent by the app: Copy writes the
 * clipboard, Share opens the phone's own share sheet (a browser without one copies instead and
 * says so), Text opens Messages with the message filled in on a phone and copies the message on
 * a computer with no texting app, Email opens a draft in the person's own mail app. Each one
 * that happened is reported through onShared so the invitation records it as SHARED, never
 * delivered. A pop plays only once the clipboard or the share sheet confirmed; a refusal plays
 * nothing and says why.
 */
export function LinkShareRow({
  url,
  kind,
  firstName,
  phone,
  email,
  permanent,
  expiresAt,
  recipientLocked = false,
  goldCopy = false,
  actions = ALL_ACTIONS,
  onShared,
  className,
}: {
  url: string;
  kind: InviteLinkKind | "own";
  firstName?: string | null;
  phone?: string | null;
  email?: string | null;
  permanent?: boolean | null;
  expiresAt?: string | null;
  recipientLocked?: boolean;
  /** The page's one gold button, when this row's Copy is the next thing to do. */
  goldCopy?: boolean;
  actions?: readonly ShareAction[];
  onShared?: (channel: ShareChannel) => void | Promise<void>;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);

  const message = { kind, url, orgName: BRAND.legalName, firstName };
  const report = (channel: ShareChannel) => {
    void Promise.resolve(onShared?.(channel)).catch((err) => console.warn("record share failed", err));
  };

  const markCopied = () => {
    setCopied(true);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 2000);
  };

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
    } catch (err) {
      console.warn("clipboard blocked", err);
      toast.error("Clipboard blocked. Select the link and copy it manually.");
      return;
    }
    // The clipboard has it; a blocked clipboard returned above, silent.
    playSoundEffect("pop");
    markCopied();
    toast.success("Link copied.");
    report("copy");
  }

  async function share() {
    const outcome = await shareLink({ title: `Join ${BRAND.legalName}`, text: linkSentence(message), url });
    if (outcome === "shared") {
      playSoundEffect("pop");
      report("share");
    } else if (outcome === "copied") {
      playSoundEffect("pop");
      markCopied();
      toast.success("Link copied. This browser has no share menu, so paste it where you want it.");
      report("copy");
    } else if (outcome === "failed") {
      toast.error("Sharing is blocked here. Select the link and copy it manually.");
    }
    // "cancelled": the person closed the share sheet. Nothing to say, nothing recorded.
  }

  async function copyMessage() {
    try {
      await navigator.clipboard.writeText(linkText(message));
    } catch (err) {
      console.warn("clipboard blocked", err);
      toast.error("Clipboard blocked. Select the link and copy it manually.");
      return;
    }
    playSoundEffect("pop");
    toast.success("Message copied. Paste it into a text.");
    report("text");
  }

  // Four words do not fit one 390px row beside their icons, so under 640px each button stacks its
  // icon over its word (a 56px tile) and the row stays one row; from 640px they sit inline at 44px.
  // Two buttons always fit inline.
  const stacked = actions.length > 2;
  const cell = stacked
    ? "h-14 min-w-0 flex-col gap-1 px-1 text-sm sm:h-11 sm:flex-row sm:gap-1.5 sm:px-3 sm:text-[15px]"
    : "h-11 min-w-0 gap-1.5 px-2 text-[15px] sm:px-3";
  // The quiet buttons sit on a card ground with a full-strength hairline, so they still read as
  // buttons on a tinted card in the light theme (a transparent outline all but vanished there).
  const quietCell = cn(cell, "border-border bg-card");
  const textOnDevice = canTextFromDevice();

  return (
    <div className={cn("grid gap-2", actions.length === 4 ? "grid-cols-4" : actions.length === 3 ? "grid-cols-3" : "grid-cols-2", className)}>
      {actions.includes("copy") && (
        // The visible word stays short so four fit one row on a phone; the name says what it copies.
        <Button variant={goldCopy ? "default" : "outline"} className={goldCopy ? cell : quietCell} aria-label={copied ? "Copied" : "Copy link"} onClick={() => void copy()}>
          {copied ? <Check className="h-4 w-4 shrink-0" /> : <Copy className="h-4 w-4 shrink-0" />}
          <span className="truncate">{copied ? "Copied" : "Copy"}</span>
        </Button>
      )}
      {actions.includes("share") && (
        <Button variant="outline" className={quietCell} aria-label="Share link" onClick={() => void share()}>
          <Share2 className="h-4 w-4 shrink-0" />
          <span className="truncate">Share</span>
        </Button>
      )}
      {actions.includes("text") && (textOnDevice ? (
        <Button asChild variant="outline" className={quietCell}>
          <a href={textHref(phone, linkText(message))} aria-label="Text the link" onClick={() => report("text")}>
            <MessageSquare className="h-4 w-4 shrink-0" />
            <span className="truncate">Text</span>
          </a>
        </Button>
      ) : (
        <Button variant="outline" className={quietCell} aria-label="Text the link" onClick={() => void copyMessage()}>
          <MessageSquare className="h-4 w-4 shrink-0" />
          <span className="truncate">Text</span>
        </Button>
      ))}
      {actions.includes("email") && (
        <Button asChild variant="outline" className={quietCell}>
          <a
            href={emailHref({ to: email, kind, url, orgName: BRAND.legalName, firstName, permanent, expiresAt, recipientLocked })}
            aria-label="Email the link"
            onClick={() => report("email_draft")}
          >
            <Mail className="h-4 w-4 shrink-0" />
            <span className="truncate">Email</span>
          </a>
        </Button>
      )}
    </div>
  );
}
