import { useEffect } from "react";

/**
 * Sets `document.title` for the lifetime of the calling component, then
 * restores the previous title on unmount.
 *
 * Why this exists: nearly every public route was rendering with the
 * generic "APEX Financial - Build Your Career in Financial Services"
 * title from index.html. That hurts SEO, sharing previews, and trust.
 * Drop this one-liner into a page component to give it a real title:
 *
 *   usePageTitle("Apply to APEX Financial — pre-licensing pathway");
 */
export function usePageTitle(title: string) {
  useEffect(() => {
    if (!title) return;
    const previous = document.title;
    document.title = title;
    return () => {
      document.title = previous;
    };
  }, [title]);
}
