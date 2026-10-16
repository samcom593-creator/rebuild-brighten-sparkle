/**
 * MD5 of a string's UTF-8 bytes as 32 lower-case hex characters, the same
 * value Postgres md5(text) returns on this UTF8 database.
 *
 * Why it exists: v_production_comp_truth keys every AgentLink deal by
 * agentlink_book.deal_key, and both book writers (agentlink_pull_book_of_business
 * and agentlink_book_rebuild) compute that key as md5(<AgentLink deal id>)
 * whenever AgentLink sends an id. deals.external_deal_id holds the same id, so
 * src/lib/commissionLedger.ts can pair a commission_ledger row with its own
 * production row by deal identity instead of guessing from a policy number.
 *
 * Not for security: MD5 is broken as a cryptographic hash. It only reproduces
 * a key the database already computed. Verified against Postgres output in
 * src/tests/lib/md5.test.ts.
 */

/** Per-step left-rotation amounts, four per round (RFC 1321). */
const SHIFTS = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];

/** K[i] = floor(abs(sin(i + 1)) * 2^32), written out so no floating-point sine runs at load time. */
const K = new Uint32Array([
  0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
  0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
  0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
  0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
  0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
  0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
  0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
  0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
]);

function rotateLeft(value: number, bits: number): number {
  return (value << bits) | (value >>> (32 - bits));
}

/** The four bytes of a 32-bit word, least significant first, as hex. */
function wordToHex(word: number): string {
  let out = "";
  for (let i = 0; i < 4; i += 1) out += ((word >>> (i * 8)) & 0xff).toString(16).padStart(2, "0");
  return out;
}

export function md5Hex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  // Message, one 0x80 byte, zero padding, then the bit length as a 64-bit little-endian integer: a multiple of 64 bytes.
  const total = (Math.floor((bytes.length + 8) / 64) + 1) * 64;
  const padded = new Uint8Array(total);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(total - 8, (bytes.length * 8) >>> 0, true);
  view.setUint32(total - 4, Math.floor(bytes.length / 0x20000000), true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;
  const words = new Array<number>(16);

  for (let offset = 0; offset < total; offset += 64) {
    for (let j = 0; j < 16; j += 1) words[j] = view.getUint32(offset + j * 4, true);
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;
    for (let i = 0; i < 64; i += 1) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      const sum = (f + a + K[i] + words[g]) | 0;
      a = d;
      d = c;
      c = b;
      b = (b + rotateLeft(sum, SHIFTS[(i >> 4) * 4 + (i & 3)])) | 0;
    }
    a0 = (a0 + a) | 0;
    b0 = (b0 + b) | 0;
    c0 = (c0 + c) | 0;
    d0 = (d0 + d) | 0;
  }

  return wordToHex(a0) + wordToHex(b0) + wordToHex(c0) + wordToHex(d0);
}
