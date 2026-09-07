/** Raw Responses HTTP JSON has message content; output_text is an SDK convenience. */
export function responseText(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const body = value as { output_text?: unknown; output?: unknown };
  if (typeof body.output_text === "string" && body.output_text.trim()) return body.output_text.trim();
  if (!Array.isArray(body.output)) return "";
  return body.output.flatMap((item) => item?.type === "message" && Array.isArray(item.content)
    ? item.content.filter((part: { type?: string; text?: unknown }) => part?.type === "output_text" && typeof part.text === "string").map((part: { text: string }) => part.text)
    : []).join("\n").trim();
}
