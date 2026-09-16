// btoa() encodes a BINARY STRING: it reads each UTF-16 code unit as one byte and
// throws InvalidCharacterError on any code point above 0xFF. It does not encode
// text. Handing it a human-authored string works right up until that string
// contains one character outside Latin1, and then it throws — it never degrades,
// never truncates, and produces no partial output to notice.
//
// MP-550: this killed seminar-confirmation for every applicant who ever applied.
// The .ics event title was the literal "Apex Seminar — Welcome Zoom" with a
// U+2014 em-dash, so `btoa(icsBody)` threw on EVERY invocation, uncaught, before
// the email send and before all three database writes. submit-application fires
// that function on every submission; 825 applications produced 0 stamped rows.
// The throw was unconditional and data-independent: it crashed just as hard on a
// pure-ASCII applicant, because the offending character was in the template.
//
// Same family as MP-274, where Deno threw while CONSTRUCTING a Request because an
// HTTP header value carried an emoji. Both are validation at an encoding boundary
// that fires before any byte reaches the network, so status-code monitoring is
// structurally blind to them: there is no response to inspect.
//
// Encoding to UTF-8 bytes FIRST is what the callers actually mean. It is also
// what their payloads already claim — the .ics attachment declares
// `charset=utf-8`, so the bytes must be UTF-8, not Latin1 code units.
//
// The chunked fromCharCode is load-bearing, not decoration: spreading a large
// Uint8Array into apply() blows the argument limit and throws RangeError on
// bodies that are merely big rather than non-ASCII.
export function base64Utf8(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}
