import { useMemo, useState } from "react";
import { Loader2, Mail, MessageSquare, Send, X } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface BulkRecipient {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
}

export type BulkChannel = "sms" | "email";

interface BulkComposeDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recipients: BulkRecipient[];
  /** Default channel — drawer still lets the user switch. */
  defaultChannel?: BulkChannel;
  /** Optional title shown at the top of the drawer. */
  title?: string;
  /** Called after a successful send so the parent can clear selection. */
  onSent?: (channel: BulkChannel, sentCount: number) => void;
}

/**
 * Reusable drawer for previewing + sending bulk SMS or Email.
 * - SMS: routes through `send-sms-auto-detect` (one call per recipient).
 * - Email: routes through Resend via the `send-bulk-email` edge function.
 *   No fallback: if it errors, nothing else is sent (see handleSend).
 *
 * Both flows skip recipients missing the relevant contact field and
 * surface the count in the result toast.
 */
export function BulkComposeDrawer({
  open,
  onOpenChange,
  recipients,
  defaultChannel = "sms",
  title = "Bulk message",
  onSent,
}: BulkComposeDrawerProps) {
  const [channel, setChannel] = useState<BulkChannel>(defaultChannel);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  const reachable = useMemo(() => {
    if (channel === "sms") return recipients.filter((r) => !!r.phone);
    return recipients.filter((r) => !!r.email);
  }, [channel, recipients]);

  const skipped = recipients.length - reachable.length;

  const charCount = message.length;
  const smsOver160 = channel === "sms" && charCount > 160;

  async function handleSend() {
    if (reachable.length === 0) {
      toast.error("No recipients have a valid contact for this channel.");
      return;
    }
    if (!message.trim()) {
      toast.error("Message is empty.");
      return;
    }
    if (channel === "email" && !subject.trim()) {
      toast.error("Email subject is required.");
      return;
    }

    setSending(true);
    let success = 0;
    let failed = 0;
    let optedOut = 0;

    try {
      if (channel === "sms") {
        // Per-recipient send via existing auto-detect function.
        // Sequential to avoid burst rate limits — same pattern as existing blasts.
        for (const r of reachable) {
          try {
            const { error } = await supabase.functions.invoke(
              "send-sms-auto-detect",
              { body: { phone: r.phone, message: message.trim() } }
            );
            if (error) {
              failed++;
              console.error(`SMS failed for ${r.name}`, error);
            } else {
              success++;
            }
          } catch (e) {
            failed++;
            console.error(`SMS exception for ${r.name}`, e);
          }
        }
      } else {
        // PL-WIB-BULK-NO-FALLBACK (2026-10-11). On any error this used to loop
        // send-email over every recipient. send-email does not read
        // email_unsubscribes, so the loop mailed opt-outs, and an error does not
        // mean nothing went out: the 503 means the opt-out list was unreadable
        // and nothing was sent ON PURPOSE, while a gateway timeout or a dropped
        // connection comes back with the function still sending, so the loop
        // mailed the same people twice. An error now sends nothing more.
        const bulkResult = await supabase.functions.invoke("send-bulk-email", {
          body: {
            recipients: reachable.map((r) => ({ email: r.email, name: r.name })),
            subject: subject.trim(),
            html: message.trim().replace(/\n/g, "<br/>"),
            text: message.trim(),
          },
        });

        if (bulkResult.error) {
          const err = bulkResult.error as { message?: string; context?: Response };
          const status = err.context instanceof Response ? err.context.status : null;
          let detail = err.message || "unknown error";
          try {
            const body = err.context instanceof Response ? await err.context.json() : null;
            if (body?.error) detail = String(body.error);
          } catch {
            detail = `${detail}, response body unreadable`;
          }
          // send-bulk-email answers 4xx and 503 before its send loop starts.
          // Anything else (504, dropped connection) can land mid-loop.
          const nothingSent = status !== null && ((status >= 400 && status < 500) || status === 503);
          toast.error(
            nothingSent
              ? `Nothing sent: ${detail}`
              : `Email send not confirmed (${detail}). Some may already have gone out, so do not resend the whole list.`
          );
          return;
        }

        const data = bulkResult.data as { sent?: number; failed?: number; skipped?: number } | null;
        success = data?.sent ?? 0;
        failed = data?.failed ?? 0;
        optedOut = data?.skipped ?? 0;
      }

      if (success > 0) {
        toast.success(
          `Sent to ${success}${failed > 0 ? ` (${failed} failed)` : ""}${
            optedOut > 0 ? ` · ${optedOut} unsubscribed, not sent` : ""
          }${
            skipped > 0 ? ` · ${skipped} skipped (no ${channel === "sms" ? "phone" : "email"})` : ""
          }`
        );
        onSent?.(channel, success);
        setMessage("");
        setSubject("");
        onOpenChange(false);
      } else if (failed > 0) {
        toast.error(`All ${failed} sends failed.`);
      } else {
        toast.error(`Nothing sent: all ${optedOut} unsubscribed.`);
      }
    } finally {
      setSending(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl flex flex-col">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>
            Preview recipients and message before sending.
          </SheetDescription>
        </SheetHeader>

        <Tabs
          value={channel}
          onValueChange={(v) => setChannel(v as BulkChannel)}
          className="flex-1 flex flex-col mt-4 min-h-0"
        >
          <TabsList className="grid grid-cols-2 w-full">
            <TabsTrigger value="sms" className="gap-1.5">
              <MessageSquare className="h-3.5 w-3.5" /> SMS
            </TabsTrigger>
            <TabsTrigger value="email" className="gap-1.5">
              <Mail className="h-3.5 w-3.5" /> Email
            </TabsTrigger>
          </TabsList>

          <div className="flex items-center justify-between mt-3 text-xs">
            <div className="flex items-center gap-2">
              <Badge variant="secondary">{reachable.length} reachable</Badge>
              {skipped > 0 && (
                <Badge variant="outline" className="text-muted-foreground">
                  {skipped} skipped
                </Badge>
              )}
            </div>
            {channel === "sms" && (
              <span
                className={`tabular-nums ${
                  smsOver160 ? "text-destructive" : "text-muted-foreground"
                }`}
              >
                {charCount}/160
              </span>
            )}
          </div>

          <TabsContent value="email" className="mt-3 space-y-2">
            <Input
              placeholder="Subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              disabled={sending}
            />
          </TabsContent>

          <Textarea
            placeholder={
              channel === "sms"
                ? "Type SMS message (≤160 chars recommended)…"
                : "Type email body (plain text or simple HTML)…"
            }
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={channel === "sms" ? 4 : 8}
            className="mt-2 resize-none"
            disabled={sending}
          />

          <div className="mt-3 flex-1 min-h-0 flex flex-col">
            <div className="text-xs font-medium text-muted-foreground mb-1.5">
              Recipients
            </div>
            <ScrollArea className="flex-1 border border-border/40 rounded-md">
              <ul className="divide-y divide-border/30">
                {recipients.map((r) => {
                  const ok =
                    channel === "sms" ? !!r.phone : !!r.email;
                  return (
                    <li
                      key={r.id}
                      className="flex items-center justify-between px-3 py-2 text-xs"
                    >
                      <span className="truncate">{r.name}</span>
                      <span
                        className={`tabular-nums ml-2 truncate ${
                          ok ? "text-muted-foreground" : "text-destructive/80"
                        }`}
                      >
                        {ok
                          ? channel === "sms"
                            ? r.phone
                            : r.email
                          : `no ${channel === "sms" ? "phone" : "email"}`}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </ScrollArea>
          </div>
        </Tabs>

        <SheetFooter className="mt-4 flex-row gap-2 sm:justify-end">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={sending}
          >
            <X className="h-4 w-4 mr-1.5" /> Cancel
          </Button>
          <Button onClick={handleSend} disabled={sending || reachable.length === 0}>
            {sending ? (
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <Send className="h-4 w-4 mr-1.5" />
            )}
            Send to {reachable.length}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
