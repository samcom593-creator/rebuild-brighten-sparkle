/// <reference lib="es2022.intl" />
/** Read whole graphemes so emoji and combined letters never become broken surrogates. */
export function firstGrapheme(value: string | null | undefined): string {
  const text = (value ?? "").trim();
  if (!text) return "";
  if (typeof Intl.Segmenter === "function") {
    return new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)[Symbol.iterator]().next().value?.segment ?? "";
  }
  return Array.from(text)[0] ?? "";
}

export function personInitials(name: string | null | undefined, fallback = "?"): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map(firstGrapheme).join("").toUpperCase() || fallback;
}
