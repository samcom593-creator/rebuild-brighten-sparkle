// The interview confirmation email this function sends, built without a
// database or network so it can be tested (PL-WIB-CONFIRM-NO-DEAD-LINK). It
// lives here, not in _shared/, because a _shared change makes Deploy Supabase
// redeploy every edge function.
//
// Until 2026-10-19 the email's only "if anything changes" CTA was
// calendly.com/apexfinancialempire/interview: the value of
// system_settings.seminar_calendly_url, and the hardcoded fallback when that
// key was empty. Calendly deleted that event type with the seminar, so the
// button opened "this Calendly URL is not valid". Clearing the setting would
// have fixed nothing, because the fallback was the same dead URL. There is no
// fallback now. With no usable link the email says to reply, and the send
// already sets reply_to.

export function stripWrappedQuotes(raw: string | null | undefined): string {
  if (!raw) return "";
  const trimmed = raw.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

// A reschedule link is rendered only when it is an absolute https URL. Anything
// else (empty, a to_jsonb-quoted value that survived, a bare path) renders the
// reply line instead of a button that goes nowhere.
export function resolveRescheduleUrl(raw: string | null | undefined): string | null {
  const v = stripWrappedQuotes(raw);
  return /^https:\/\/\S+$/i.test(v) ? v : null;
}

export function firstName(fullName: string | null | undefined): string {
  if (!fullName) return "there";
  const cleaned = fullName.trim();
  if (!cleaned) return "there";
  return cleaned.split(/\s+/)[0];
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function formatScheduled(scheduledAt: string): { day: string; time: string; full: string } {
  // Format in US/Central since Sam runs on CT.
  const d = new Date(scheduledAt);
  if (Number.isNaN(d.getTime())) {
    return { day: scheduledAt, time: "", full: scheduledAt };
  }
  const dayFmt = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "America/Chicago",
  });
  const timeFmt = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Chicago",
    timeZoneName: "short",
  });
  const day = dayFmt.format(d);
  const time = timeFmt.format(d);
  return { day, time, full: `${day} at ${time}` };
}

export function buildConfirmationEmail(
  candidateName: string,
  scheduledAt: string,
  rescheduleUrl: string | null,
): { subject: string; html: string; text: string } {
  const fn = firstName(candidateName);
  const fnHtml = escapeHtml(fn);
  const { day, time, full } = formatScheduled(scheduledAt);
  const dayHtml = escapeHtml(day);
  const timeHtml = escapeHtml(time);
  const url = resolveRescheduleUrl(rescheduleUrl);

  const subject = `Confirmed — our call on ${day} ${time} CT`;

  const changeText = url
    ? `If anything changes, you can reschedule here: ${url}`
    : `If the time no longer works, reply to this email.`;

  const text = [
    `Hey ${fn},`,
    ``,
    `Confirmed for ${full}. I'll be there. Bring questions.`,
    ``,
    changeText,
    ``,
    `— Sam`,
    `Galaxy Financial`,
  ].join("\n");

  const changeHtml = url
    ? `<p>If anything changes, you can reschedule here:</p>
  <p><a href="${escapeHtml(url)}" style="display:inline-block;padding:12px 20px;background:#0a0a0a;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;">Reschedule</a></p>`
    : `<p>If the time no longer works, reply to this email.</p>`;

  const html = `
<!doctype html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111;line-height:1.55;">
  <p>Hey ${fnHtml},</p>
  <p>Confirmed for <strong>${dayHtml} at ${timeHtml}</strong>. I'll be there. Bring questions.</p>
  ${changeHtml}
  <p style="margin-top:24px;">— Sam<br/>Galaxy Financial</p>
</body></html>`.trim();

  return { subject, html, text };
}
