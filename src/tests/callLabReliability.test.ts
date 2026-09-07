import { describe, expect, it, vi, afterEach } from "vitest";
import { responseText } from "../../supabase/functions/_shared/call-lab/response-text";
import { speakWithBrowser } from "@/lib/callLab/audio";

afterEach(() => vi.unstubAllGlobals());
describe("Call Lab response decoding", () => {
  it("reads message text after reasoning and function-call output", () => {
    expect(responseText({ output: [{ type: "reasoning" }, { type: "function_call", arguments: "{}" }, { type: "message", content: [{ type: "output_text", text: "Who is calling?" }] }] })).toBe("Who is calling?");
  });
  it("decodes structured evaluation JSON from raw HTTP content", () => {
    expect(JSON.parse(responseText({ output: [{ type: "message", content: [{ type: "output_text", text: '{"score":75}' }] }] }))).toEqual({ score: 75 });
  });
  it("does not treat refusals or incomplete output as a spoken answer", () => {
    expect(responseText({ output: [{ type: "message", content: [{ type: "refusal", refusal: "No" }] }] })).toBe("");
    expect(responseText(null)).toBe("");
  });
});
it("interruption settles browser speech even when cancel emits no end event", async () => {
  vi.stubGlobal("speechSynthesis", { getVoices: () => [], cancel: vi.fn(), speak: vi.fn() });
  vi.stubGlobal("SpeechSynthesisUtterance", class { constructor(public text: string) {} });
  const speech = speakWithBrowser("Hello", {});
  speech.cancel();
  await expect(speech.done).resolves.toBe("cancelled");
});
