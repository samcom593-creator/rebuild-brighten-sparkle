// find-auth-user.ts — look up an auth user by email without a silent ceiling.
//
// WHY THIS EXISTS
// supabase-js v2's admin API has no server-side email filter, so every caller in
// this repo fetches a PAGE of users and scans it in memory. A page is not the
// table. When the user you want sits past the page boundary, `.find()` returns
// undefined and the caller reads that as "no such account" — then creates a
// second one. Same shape as the ambiguity-reads-as-absence disease (MP-275/276):
// a bounded read reported as an exhaustive one.
//
// MEASURED 2026-08-12 against prod: auth.users holds 531 rows.
//   create-agent-from-leaderboard  listUsers()            -> default page, 50   ALREADY WRONG
//   consume-invite-token           listUsers(perPage:200) -> 200                ALREADY WRONG
//   add-agent                      listUsers(perPage:1000)-> 1000               469 of headroom
//   create-new-agent-account       listUsers(perPage:1000)-> 1000               469 of headroom
//   setup-agent-password           listUsers(perPage:1000)-> 1000               469 of headroom
// The first two are not future risks. At 531 users they can only see the first
// 50 and 200 accounts respectively, and consume-invite-token carried a comment
// reading "small-N lookup is fine while we're early" — true when written, false
// now, and nothing would ever have gone red to say so.
//
// NO SUPABASE-JS IMPORT ON PURPOSE
// The client is passed in and typed structurally. Importing the SDK here would
// risk pulling a SECOND copy of supabase-js into a function that already pins its
// own version — the exact boot-death that killed apex-alert-dispatch on
// 2026-08-11 (MP-273), where the handler crashed before it ever ran and the
// failure looked like an ordinary false return.

/** The slice of the admin client this helper needs. Structural, so any pinned SDK version satisfies it. */
export interface AuthUserLister {
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): Promise<{ data: unknown; error: { message: string } | null }>;
  auth: {
    admin: {
      listUsers(params: { page: number; perPage: number }): Promise<{
        data: { users?: Array<{ id: string; email?: string | null }> | null } | null;
        error: { message: string } | null;
      }>;
    };
  };
}

export type AuthUserLookup = {
  /** The matching auth user, or null when every page was read and none matched. */
  user: { id: string; email?: string | null } | null;
  /** Pages actually fetched — proof of how much was searched. */
  pagesScanned: number;
  /** True only when the scan reached the end of the table. */
  exhaustive: boolean;
};

// MEASURED 2026-08-24 against prod, because PAGE_SIZE = 1000 took every agent-
// creation path down with a 500. GoTrue's admin list endpoint fails above ~200:
//   per_page=50  -> 200 OK      per_page=200 -> 200 OK
//   per_page=300 -> 500 "Database error finding users"
//   per_page=500 -> 500         per_page=1000 -> 500
// So the helper written to remove a silent ceiling introduced a loud one, and
// add-agent / create-new-agent-account / setup-agent-password /
// create-agent-from-leaderboard all failed outright — while consume-invite-token
// kept working precisely because its 200 was the "already wrong" value above.
// 200 with pagination is correct AND exhaustive; the page size was never what
// made the old code unsafe, reading only ONE page was.
const PAGE_SIZE = 200;
// Backstop so a pathological account can never spin forever. 200 pages at 1000
// per page is 200k users; if Apex ever passes that, this should fail loudly
// rather than quietly degrade back into the bug it exists to prevent.
const MAX_PAGES = 200;

/**
 * Find an auth user by email, paging until found or the table is exhausted.
 *
 * Returns `exhaustive: false` only if MAX_PAGES was hit, so a caller can tell
 * "definitely no such user" from "gave up looking" — the distinction the raw
 * `.find()` over one page silently erased.
 */
export async function findAuthUserByEmail(
  admin: AuthUserLister,
  email: string,
): Promise<AuthUserLookup> {
  const target = email.trim().toLowerCase();

  // PRIMARY: ask the database the actual question. One row, no pagination, no
  // ceiling, and immune to the GoTrue admin-list failure documented above.
  const { data, error } = await admin.rpc("auth_user_id_by_email", { p_email: target });
  if (!error) {
    const id = typeof data === "string" ? data : null;
    return { user: id ? { id, email: target } : null, pagesScanned: 0, exhaustive: true };
  }

  // FALLBACK: only if the RPC itself is unavailable (not yet migrated, or
  // permissions changed). Kept because losing the lookup entirely is worse than
  // a bounded one — but it is NOT silent: a caller can see pagesScanned > 0 and
  // exhaustive === false and refuse to create a duplicate account on that basis.
  console.error(`[find-auth-user] RPC unavailable (${error.message}); falling back to paging`);
  let pagesScanned = 0;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data: pageData, error: pageErr } = await admin.auth.admin.listUsers({ page, perPage: PAGE_SIZE });
    if (pageErr) {
      // Do NOT throw. A failed lookup is "unknown", never "no such user" — the
      // caller must not read a platform error as permission to create a second
      // account for someone who already has one.
      console.error(`[find-auth-user] page ${page} failed: ${pageErr.message}`);
      return { user: null, pagesScanned, exhaustive: false };
    }
    const users = pageData?.users ?? [];
    pagesScanned++;
    const hit = users.find((u) => (u.email ?? "").trim().toLowerCase() === target);
    if (hit) return { user: hit, pagesScanned, exhaustive: true };
    if (users.length < PAGE_SIZE) return { user: null, pagesScanned, exhaustive: true };
  }
  console.error(
    `[find-auth-user] stopped after ${MAX_PAGES} pages without exhausting auth.users; ` +
      `"not found" is NOT proven for ${target}`,
  );
  return { user: null, pagesScanned, exhaustive: false };
}
