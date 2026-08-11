// HTTP header values are ByteStrings. Deno THROWS a TypeError while constructing
// the Request when any codepoint exceeds 0xFF — before a byte reaches the network,
// and before any response status exists to inspect.
//
// This bit apex-alert-dispatch for months: ntfy.sh (Sam's primary phone push)
// carries the alert subject in a `Title` header, and APEX subjects routinely lead
// with an emoji ("🎓 <name> passed their license exam", "🔴 CRITICAL: ..."). Every
// one of those pushes threw, and a `catch { return false }` reported the throw as
// an ordinary false, so the alert was marked delivered on the strength of Discord
// and email while Sam's phone stayed silent.
//
// ntfy decodes RFC 2047 encoded-words, so encoding preserves the emoji rather than
// stripping it. Verified against live ntfy: an unencoded emoji title throws, an
// encoded one round-trips back to "🎓 ...".
export function headerSafe(s: string): string {
  if (/^[\x20-\x7E]*$/.test(s)) return s;
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return `=?UTF-8?B?${btoa(bin)}?=`;
}
