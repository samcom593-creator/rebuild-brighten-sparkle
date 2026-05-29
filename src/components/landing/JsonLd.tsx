import { useEffect } from "react";

/**
 * JsonLd — drops a <script type="application/ld+json"> tag into the
 * document head for the lifetime of the component, then cleans it up
 * on unmount so SPA route changes never leave stale schema behind.
 *
 * Used by per-state Career landing pages (PL-AHO-WEB-006) to emit
 * Google for Jobs JobPosting schema so APEX's contractor recruiting
 * roles can claim the free Google for Jobs SERP slot.
 *
 * id: required, stable per route so we update-in-place instead of
 *     stacking multiple tags on hot reload.
 * data: any valid JSON-LD object (or array). Stringified safely so
 *     embedded angle-brackets / quotes never break the page.
 */
interface JsonLdProps {
  id: string;
  data: Record<string, unknown> | Array<Record<string, unknown>>;
}

export function JsonLd({ id, data }: JsonLdProps) {
  useEffect(() => {
    const existing = document.getElementById(id);
    const tag = existing ?? document.createElement("script");
    tag.setAttribute("type", "application/ld+json");
    tag.setAttribute("id", id);
    // Escape angle brackets defensively per Google's structured-data guidelines.
    tag.textContent = JSON.stringify(data).replace(/</g, "\\u003c");
    if (!existing) document.head.appendChild(tag);
    return () => {
      const el = document.getElementById(id);
      if (el && el.parentNode) el.parentNode.removeChild(el);
    };
  }, [id, data]);

  return null;
}
