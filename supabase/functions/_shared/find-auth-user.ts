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

const PAGE_SIZE = 1000;
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
  let pagesScanned = 0;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: PAGE_SIZE });
    if (error) throw new Error(`findAuthUserByEmail failed on page ${page}: ${error.message}`);

    const users = data?.users ?? [];
    pagesScanned++;

    const hit = users.find((u) => (u.email ?? "").trim().toLowerCase() === target);
    if (hit) return { user: hit, pagesScanned, exhaustive: true };

    // A short page is the last page.
    if (users.length < PAGE_SIZE) return { user: null, pagesScanned, exhaustive: true };
  }

  console.error(
    `[find-auth-user] stopped after ${MAX_PAGES} pages without exhausting auth.users; ` +
      `"not found" is NOT proven for ${target}`,
  );
  return { user: null, pagesScanned, exhaustive: false };
}
