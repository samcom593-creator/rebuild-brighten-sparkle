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
