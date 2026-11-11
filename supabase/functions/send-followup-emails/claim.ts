// Claim-before-send for the applicant follow-ups (2026-11-11).
//
// Each drip used to send first and stamp its applications column afterwards, with the stamp's
// error mostly unchecked. Two overlapping runs (the cron and a manual POST) could both select and
// mail the same person, and a failed stamp after a real send meant the next run mailed them again.
// Now the stamp IS the claim: a conditional update sets it only while it is still null, so one
// run wins; a send that does not return a Resend id releases the claim so a later run can retry
// inside the drip's window. A crash between claim and send loses one email and never duplicates
// one, which is the right failure for Sam's "never message twice".
//
// Every delivered follow-up also gets a row in email_delivery_log (template followup-<step>, the
// Resend id as provider_message_id) so v_recruit_touches sees it; 'followup-%' is registered
// there as kind 'ladder'.

export type StampColumn =
  | "day1_nudge_sent_at"
  | "followup_sent_at"
  | "followup_unlicensed_2_sent_at"
  | "followup_licensed_sent_at";

// deno-lint-ignore no-explicit-any
type Db = any;

export async function claimStamp(db: Db, appId: string, column: StampColumn, now: Date = new Date()): Promise<string | null> {
  const stamp = now.toISOString();
  const { data, error } = await db
    .from("applications")
    .update({ [column]: stamp })
    .eq("id", appId)
    .is(column, null)
    .select("id");
  if (error) {
    console.error(`claim ${column} failed for application:`, appId, error.message ?? error);
    return null;
  }
  return Array.isArray(data) && data.length === 1 ? stamp : null;
}

export async function releaseStamp(db: Db, appId: string, column: StampColumn, stamp: string): Promise<void> {
  const { error } = await db
    .from("applications")
    .update({ [column]: null })
    .eq("id", appId)
    .eq(column, stamp);
  if (error) console.error(`release ${column} failed for application:`, appId, error.message ?? error);
}

export async function recordReceipt(
  db: Db,
  app: { id: string; email: string },
  template: string,
  messageId: string,
  now: Date = new Date(),
): Promise<void> {
  const { error } = await db.from("email_delivery_log").insert({
    template,
    recipient_email: app.email,
    provider: "resend",
    provider_message_id: messageId,
    status: "sent",
    sent_at: now.toISOString(),
    related_record_type: "application",
    related_record_id: app.id,
  });
  if (error) console.error("receipt insert failed for application:", app.id, template, error.message ?? error);
}

export interface ClaimedSend {
  sent: boolean;
  stamp: string | null;
}

export async function sendClaimed(
  db: Db,
  app: { id: string; email: string },
  column: StampColumn,
  template: string,
  send: () => Promise<string | null>,
): Promise<ClaimedSend> {
  const stamp = await claimStamp(db, app.id, column);
  if (!stamp) return { sent: false, stamp: null };
  let messageId: string | null = null;
  try {
    messageId = await send();
  } catch (e) {
    console.error(`send threw for application ${app.id} (${template}):`, e);
    messageId = null;
  }
  if (!messageId) {
    await releaseStamp(db, app.id, column, stamp);
    return { sent: false, stamp: null };
  }
  await recordReceipt(db, app, template, messageId);
  return { sent: true, stamp };
}
