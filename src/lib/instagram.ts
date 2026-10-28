export type InstagramProfileLink = {
  handle: string;
  href: string;
};

export function instagramProfileLink(value: string | null | undefined): InstagramProfileLink | null {
  const handle = (value ?? "")
    .trim()
    .replace(/^(?:https?:\/\/)?(?:www\.)?instagram\.com\//i, "")
    .replace(/^@+/, "")
    .split(/[/?#]/, 1)[0]
    .trim();

  if (!/^[a-z0-9._]{1,30}$/i.test(handle)) return null;

  return {
    handle,
    href: `https://www.instagram.com/${handle}/`,
  };
}

// ---------------------------------------------------------------------------------------------
// IG desk deep links (MP-305 W5, 2026-10-28).
//
// ig.me/m/<handle> is Instagram's "message me" link and opens the DM thread in the app; it is the
// gold button on a 'closed' row because a human replying from the app is not bound by the Graph
// API's 24h window. Numeric or missing handles (an IGSID with no username on file) fall back to
// the inbox, never to a profile URL built from an id.
export const IG_INBOX_URL = "https://www.instagram.com/direct/inbox/";

export function cleanHandle(handle: string | null | undefined): string | null {
  const h = (handle ?? "").replace(/^@/, "").trim();
  if (!h || /^\d+$/.test(h) || /^igc:/.test(h)) return null;
  return h;
}

export function igProfileUrl(handle: string | null | undefined): string {
  const h = cleanHandle(handle);
  return h ? `https://www.instagram.com/${encodeURIComponent(h)}/` : IG_INBOX_URL;
}

export function igThreadUrl(handle: string | null | undefined): string {
  const h = cleanHandle(handle);
  return h ? `https://ig.me/m/${encodeURIComponent(h)}` : IG_INBOX_URL;
}
