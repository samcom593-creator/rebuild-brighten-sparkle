// Dial taps in My Leads (MP-ONBOARD-ANCHOR-PKG2, 2026-11-12).
//
// The dialer (ReadyMode) was canceled for non-payment on 2026-11-10, so the call links in My Leads (tel: on a
// phone, Google Voice on a desktop) are how agents dial now. Until this change a tap on those links wrote nothing,
// so a logged outcome could not be told apart from a real attempt (readymode_block 6b). Each tap now records one
// lead_bundle_events row (action 'dial_tap') through my_lead_dial_tap; the server only accepts it from the holder of
// a live grant on that lead and folds a double tap inside 30 seconds into one.
//
// The call itself must never wait on this: the click handler does not await it, and a failure is logged, never shown.
import { supabase } from "@/integrations/supabase/client";

type RpcReply = { error: { message: string } | null };
export type DialTapRpc = (itemId: string) => PromiseLike<RpcReply>;

const recordViaSupabase: DialTapRpc = (itemId) =>
  supabase.rpc("my_lead_dial_tap" as never, { p_item_id: itemId } as never) as unknown as PromiseLike<RpcReply>;

/** Records one tap on a lead's call link. Resolves true when the server stored it; never rejects. */
export function recordDialTap(itemId: string | null | undefined, rpc: DialTapRpc = recordViaSupabase): Promise<boolean> {
  if (!itemId) return Promise.resolve(false);
  let pending: PromiseLike<RpcReply>;
  try {
    pending = rpc(itemId);
  } catch (e) {
    console.warn(`[my-leads] dial tap not recorded: ${e instanceof Error ? e.message : String(e)}`);
    return Promise.resolve(false);
  }
  return Promise.resolve(pending).then(
    ({ error }) => {
      if (error) console.warn(`[my-leads] dial tap not recorded: ${error.message}`);
      return !error;
    },
    (e: unknown) => {
      console.warn(`[my-leads] dial tap not recorded: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    },
  );
}

/** onClick for a call link: records the tap and lets the link navigate as before. */
export const dialTapHandler = (itemId: string, rpc?: DialTapRpc) => () => {
  void recordDialTap(itemId, rpc);
};
