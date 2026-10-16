// BookRowWork — where a client stands and what you can do next, on a Book of Business
// row. Sam (2026-10-16): the book should tell him the status and give him the same
// options Book Flips does, because he resells these clients from either page.
//
// Work state (To call, No answer, Callback, Resold...) lives in book_flips, keyed by
// carrier + policy + client, so a call logged here shows on the Book Flips card and the
// other way round. Admins and the manager over the writing agent can log outcomes
// (book_flip_set enforces it); everyone else gets Resold, which posts the new policy.
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { FlipActions, type FlipSetOptions } from "@/components/books/FlipActions";
import { BookResoldButton } from "@/components/deals/BookResoldButton";
import { BOOK_CLIENT_DETAILS_KEY, type BookClientDetails } from "@/hooks/useBookClientDetails";
import { FLIP_LABEL, FLIP_TONE, money, phoenixTime, type FlipStatus } from "@/lib/bookFlips";
import { formatTimeAgo } from "@/lib/dateUtils";
import { splitClientName } from "@/lib/clientFacts";
import { cn } from "@/lib/utils";
import { EASY_RESELLS_KEY } from "@/lib/easyResells";

const FLIP_STATUSES = new Set<string>(Object.keys(FLIP_LABEL));

export function BookRowWork({ clientName, details, canWork }: {
  clientName: string | null;
  details: BookClientDetails | undefined;
  /** Admin or manager: the logins book_flip_set lets log an outcome. */
  canWork: boolean;
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const { firstName, lastName } = splitClientName(clientName);
  const inBook = Boolean(details?.flip_carrier && details?.flip_policy_number);
  const status: FlipStatus = details?.flip_status && FLIP_STATUSES.has(details.flip_status)
    ? (details.flip_status as FlipStatus)
    : "to_call";

  const onSet = async (next: FlipStatus, opts: FlipSetOptions = {}): Promise<boolean> => {
    if (!details?.flip_carrier || !details.flip_policy_number || busy) return false;
    setBusy(true);
    try {
      const { error } = await supabase.rpc("book_flip_set", {
        p_carrier: details.flip_carrier,
        p_policy_number: details.flip_policy_number,
        p_client_key: details.flip_client_key ?? undefined,
        p_status: next,
        p_count_attempt: !!opts.countAttempt,
        ...(opts.note ? { p_note: opts.note } : {}),
        ...(opts.callbackAt ? { p_callback_at: opts.callbackAt } : {}),
        ...(opts.receipt ? {
          p_resold_deal_id: opts.receipt.dealId,
          p_resold_policy_number: opts.receipt.policyNumber,
          p_resold_annual_premium: opts.receipt.annualPaid,
        } : {}),
      });
      if (error) throw new Error(error.message);
      if (next === "resold") toast.success("Marked resold.");
      void qc.invalidateQueries({ queryKey: [BOOK_CLIENT_DETAILS_KEY] });
      void qc.invalidateQueries({ queryKey: ["book-flip-counts"] });
      void qc.invalidateQueries({ queryKey: ["book-flips"] });
      void qc.invalidateQueries({ queryKey: [EASY_RESELLS_KEY], refetchType: "none" });
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not save.";
      toast.error(opts.receipt
        ? `The new policy posted, but this one was not marked resold (${msg}). Tap Resold, then "Already posted" to retry.`
        : `Not saved: ${msg}`);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const lastTouch = details?.last_contact_at ? `last ${formatTimeAgo(details.last_contact_at)}` : "";
  const attempts = details?.attempts ?? 0;
  const latestNote = details?.notes?.split("\n")[0] ?? "";

  return (
    <div className="space-y-2">
      {inBook && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className={cn("rounded-full border px-2 py-0.5 font-semibold", FLIP_TONE[status])}>{FLIP_LABEL[status]}</span>
          <span>{attempts} {attempts === 1 ? "attempt" : "attempts"}{lastTouch ? ` · ${lastTouch}` : ""}</span>
          {status === "callback" && details?.callback_at && (
            <span className="font-semibold text-sky-700 dark:text-sky-300">Call back {phoenixTime(details.callback_at)} (Phoenix)</span>
          )}
          {status === "resold" && (
            <span className="font-semibold text-emerald-700 dark:text-emerald-300">
              Resold{details?.resold_carrier ? ` with ${details.resold_carrier}` : ""}
              {details?.resold_annual_premium ? ` · ${money(details.resold_annual_premium)}/yr` : ""}
              {details?.resold_policy_number ? ` · #${details.resold_policy_number}` : ""}
            </span>
          )}
        </div>
      )}
      {latestNote && <p className="line-clamp-2 text-xs text-muted-foreground">{latestNote}</p>}
      {canWork && inBook ? (
        <FlipActions
          idBase={`${details?.flip_carrier}|${details?.flip_policy_number}|${details?.flip_client_key ?? ""}`}
          status={status}
          busy={busy}
          client={{ firstName, lastName, phone: details?.phone ?? "", dob: details?.dob ?? "" }}
          onSet={onSet}
        />
      ) : (
        <BookResoldButton clientName={clientName} details={details} />
      )}
    </div>
  );
}
