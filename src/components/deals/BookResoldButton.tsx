// BookResoldButton — "Resold" on a Book of Business row. Sam resells (rewrites) clients
// from the book, so the row posts the new policy through the same dialog Book Flips uses,
// prefilled with the client's name, phone and date of birth. When the policy is in a
// carrier book (Book Flips), the original is marked resold there too, with the new
// policy's number and premium, exactly as Book Flips records it.
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { SubmitDealDialog, type PostedDealReceipt } from "@/components/deals/SubmitDealDialog";
import { BOOK_CLIENT_DETAILS_KEY, type BookClientDetails } from "@/hooks/useBookClientDetails";
import { splitClientName } from "@/lib/clientFacts";

export function BookResoldButton({ clientName, details }: { clientName: string | null; details: BookClientDetails | undefined }) {
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);
  const { firstName, lastName } = splitClientName(clientName);
  const inBook = Boolean(details?.flip_carrier && details?.flip_policy_number);

  const markResold = async (receipt?: PostedDealReceipt): Promise<void> => {
    if (!details?.flip_carrier || !details.flip_policy_number) return;
    setSaving(true);
    const { error } = await supabase.rpc("book_flip_set", {
      p_carrier: details.flip_carrier,
      p_policy_number: details.flip_policy_number,
      p_client_key: details.flip_client_key ?? undefined,
      p_status: "resold",
      p_count_attempt: true,
      ...(receipt ? {
        p_resold_deal_id: receipt.dealId,
        p_resold_policy_number: receipt.policyNumber,
        p_resold_annual_premium: receipt.annualPaid,
      } : {}),
    });
    setSaving(false);
    if (error) {
      toast.error(receipt
        ? `The new policy posted, but this one was not marked resold (${error.message}). Tap Resold, then "Already posted" to retry.`
        : `Not marked resold: ${error.message}`);
      return;
    }
    toast.success("Marked resold.");
    void qc.invalidateQueries({ queryKey: [BOOK_CLIENT_DETAILS_KEY] });
    void qc.invalidateQueries({ queryKey: ["book-flip-counts"] });
  };

  return (
    <SubmitDealDialog
      trigger={<Button size="sm" variant="outline" className="h-8" disabled={saving}>Resold</Button>}
      title="Post the new policy"
      description={inBook
        ? "Posting counts the sale in production and marks this policy resold in Book Flips."
        : "Posting counts the new sale in production."}
      initialClient={{ firstName, lastName, phone: details?.phone ?? "", dob: details?.dob ?? "" }}
      onPosted={(receipt) => {
        if (inBook) void markResold(receipt);
        else toast.success("New policy posted.");
      }}
      secondaryAction={inBook ? { label: "Already posted: just mark resold", onClick: () => void markResold() } : undefined}
    />
  );
}
