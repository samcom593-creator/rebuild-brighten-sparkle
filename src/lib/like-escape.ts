// like-escape.ts (client) — MP-422.
//
// The Deno copy at supabase/functions/_shared/like-escape.ts cannot be imported
// from the Vite bundle, so the rule is restated here rather than left unenforced
// on this side of the boundary. Same four metacharacters, same reason: PostgREST
// rewrites * to % before the pattern reaches SQL, so it is four, not two.
//
// Keep the two files in step. check:ilike-user-input grades both trees.
const LIKE_METACHARACTERS = /[\\%_*]/g;

/** Escape a value so `.ilike()` compares it literally. */
export function escapeLikePattern(value: string): string {
  return value.replace(LIKE_METACHARACTERS, (ch) => `\\${ch}`);
}

/** Normalize + escape an email for a case-insensitive exact lookup. */
export function emailPattern(email: string): string {
  return escapeLikePattern(email.trim().toLowerCase());
}
